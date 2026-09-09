import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGenerateImageMarkdown,
  buildGeneratedImageFileName,
  buildImageGenerationGuidance,
  extractGenerateImageEmbedUrls,
  generatedImageEmbedUrl,
  isGenerateImageToolName,
  isImageGenerationProtocol,
  parseGenerateImageArgs,
  pickImageGenerationTarget,
  writeGeneratedImages,
} from './generate-image-tool.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('parseGenerateImageArgs', () => {
  it('requires a prompt and defaults omitted quality to 2k/high', () => {
    expect(parseGenerateImageArgs({})).toEqual({ error: '缺少生图提示词 prompt。' });
    expect(parseGenerateImageArgs({ prompt: '  湖边小屋  ' })).toEqual({
      prompt: '湖边小屋',
      count: 1,
      size: 'auto',
      quality: 'high',
    });
  });

  it('maps NewMax quality and size aliases onto the OpenAI Images contract', () => {
    expect(parseGenerateImageArgs({ prompt: 'cat', quality: '2k' })).toMatchObject({
      quality: 'high',
    });
    expect(parseGenerateImageArgs({ prompt: 'cat', quality: 'normal' })).toMatchObject({
      quality: 'auto',
    });
    expect(parseGenerateImageArgs({ prompt: 'cat', size: '1024*1024' })).toMatchObject({
      size: '1024x1024',
    });
    expect(parseGenerateImageArgs({ prompt: 'cat', aspect_ratio: '16:9' })).toMatchObject({
      size: '1536x1024',
    });
    expect(
      parseGenerateImageArgs({
        prompt: 'cat',
        count: 2,
        size: '1024x1024',
        quality: 'high',
        model: 'gpt-image-2',
      }),
    ).toEqual({
      prompt: 'cat',
      count: 2,
      size: '1024x1024',
      quality: 'high',
      model: 'gpt-image-2',
    });
  });
});

describe('writeGeneratedImages', () => {
  it('writes files under the workspace generated-images folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-gen-image-'));
    directories.push(root);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const files = writeGeneratedImages({
      workspaceRoot: root,
      prompt: 'red cube',
      images: [{ bytes: png, mimeType: 'image/png' }],
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath.replace(/\\/g, '/')).toMatch(
      /^\.sync-think\/generated-images\/.+\.png$/,
    );
    expect(readFileSync(files[0]!.absolutePath)).toEqual(Buffer.from(png));
    expect(files[0]?.embedUrl).toBe(generatedImageEmbedUrl(files[0]!.absolutePath));
  });
});

describe('generate image markdown and names', () => {
  it('names files from the prompt and builds embed markdown', () => {
    expect(buildGeneratedImageFileName('Lake House!!', 0, 'image/png')).toMatch(
      /lake-house\.png$/,
    );
    const markdown = buildGenerateImageMarkdown({
      prompt: '湖边小屋',
      providerName: 'OpenAI',
      modelId: 'gpt-image-2',
      files: [
        {
          relativePath: '.sync-think/generated-images/a.png',
          embedUrl: 'sync-think-image://generated/a.png',
        },
      ],
    });
    expect(markdown).toContain('图像已生成并保存。');
    expect(markdown).toContain('供应商：OpenAI');
    expect(markdown).toContain('模型：gpt-image-2');
    expect(markdown).toContain('![生成的图片](sync-think-image://generated/a.png)');
    expect(extractGenerateImageEmbedUrls(markdown)).toEqual([
      'sync-think-image://generated/a.png',
    ]);
  });

  it('picks the first enabled openai-images provider as default', () => {
    const missed = pickImageGenerationTarget([]);
    expect('error' in missed).toBe(true);
    const picked = pickImageGenerationTarget([
      {
        providerId: 'chat',
        name: 'Chat',
        protocol: 'openai-chat',
        enabled: true,
        sortOrder: 0,
        hasCredential: true,
        models: [{ modelId: 'm1', providerModelId: 'gpt-5', priority: 0, capabilities: ['text'] }],
      },
      {
        providerId: 'img',
        name: 'OpenAI',
        protocol: 'openai-images',
        enabled: true,
        sortOrder: 8,
        hasCredential: true,
        models: [
          {
            modelId: 'i2',
            providerModelId: 'gpt-image-2',
            priority: 0,
            capabilities: ['image-generation'],
          },
        ],
      },
    ]);
    expect(picked).toMatchObject({
      provider: { providerId: 'img' },
      model: { providerModelId: 'gpt-image-2' },
    });
    const named = pickImageGenerationTarget(
      [
        {
          providerId: 'img',
          name: 'OpenAI',
          protocol: 'openai-images',
          enabled: true,
          sortOrder: 0,
          hasCredential: true,
          models: [
            {
              modelId: 'i2',
              providerModelId: 'gpt-image-2',
              priority: 0,
              capabilities: ['image-generation'],
            },
          ],
        },
      ],
      'GPT IMAGE 2',
    );
    expect(named).toMatchObject({ model: { providerModelId: 'gpt-image-2' } });
  });

  it('recognizes NewMax-style MCP tool names', () => {
    expect(isGenerateImageToolName('generate_image')).toBe(true);
    expect(isGenerateImageToolName('mcp__image-generation__generate_image')).toBe(true);
    expect(isGenerateImageToolName('write_file')).toBe(false);
    expect(isImageGenerationProtocol('openai-images')).toBe(true);
    expect(isImageGenerationProtocol('openai-chat')).toBe(false);
  });

  it('tells the model to configure settings when no provider is ready', () => {
    const missing = buildImageGenerationGuidance({ enabled: false, externalKernel: false }).join(
      '\n',
    );
    expect(missing).toContain('设置 > 模型 > 图像生成');
    const ready = buildImageGenerationGuidance({ enabled: true, externalKernel: true }).join('\n');
    expect(ready).toContain('mcp__capability-broker__search_capability');
    expect(ready).toContain('mcp__capability-broker__use_capability');
    expect(ready).not.toContain('mcp__image-generation__generate_image');
  });
});
