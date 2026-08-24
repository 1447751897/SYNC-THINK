import { describe, expect, it } from 'vitest';
import {
  buildAttachmentGuidance,
  buildDescriptionSuffix,
  buildImageHandlingFailureSuffix,
  buildImageDescriptionPrompt,
  buildWindowsOcrSuffix,
  catalogEntryVisionCapable,
  isModelVisionCapable,
  parseVisionFallbackSetting,
  resolveVisionDescribeModel,
} from './describe-image.js';

describe('isModelVisionCapable', () => {
  it('marks known text-only providers as non-vision', () => {
    expect(isModelVisionCapable('deepseek-v4-flash')).toBe(false);
    expect(isModelVisionCapable('deepseek-chat')).toBe(false);
    expect(isModelVisionCapable('Qwen2.5-72B')).toBe(false);
    expect(isModelVisionCapable('gemma-3-27b')).toBe(false);
  });

  it('marks known multimodal providers as vision', () => {
    expect(isModelVisionCapable('gpt-4o')).toBe(true);
    expect(isModelVisionCapable('gpt-5.2')).toBe(true);
    expect(isModelVisionCapable('grok-4.5')).toBe(true);
    expect(isModelVisionCapable('gemini-2.5-pro')).toBe(true);
    expect(isModelVisionCapable('claude-sonnet-4')).toBe(true);
    expect(isModelVisionCapable('qwen2.5-vl-72b')).toBe(true);
    expect(isModelVisionCapable('deepseek-v4-flash-vision-exp')).toBe(true);
  });

  it('defaults unknown ids to non-vision until capability is confirmed', () => {
    expect(isModelVisionCapable('mystery-model-9000')).toBe(false);
    expect(isModelVisionCapable('')).toBe(false);
  });
});

describe('catalogEntryVisionCapable', () => {
  it('trusts confirmed vision tag', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm1',
        providerModelId: 'some-model',
        protocol: 'openai-chat',
        capabilities: ['vision', 'text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe(true);
  });

  it('trusts confirmed text-only tag over the name heuristic', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm2',
        providerModelId: 'gpt-4o-lookalike',
        protocol: 'openai-chat',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe(false);
  });

  it('falls back to the name heuristic without confirmed tags', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm3',
        providerModelId: 'deepseek-v3',
        protocol: 'openai-chat',
        capabilities: [],
        capabilitiesConfirmed: false,
      }),
    ).toBe(false);
  });

  it('treats a confirmed catalog without vision as non-vision even if its name looks visual', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm4',
        providerModelId: 'gpt-4o-lookalike',
        protocol: 'openai-chat',
        capabilities: [],
        capabilitiesConfirmed: true,
      }),
    ).toBe(false);
  });
});

describe('resolveVisionDescribeModel', () => {
  const catalog = [
    {
      modelId: 'deepseek-vision',
      providerModelId: 'deepseek-v4-flash-vision-exp',
      protocol: 'openai-responses',
      capabilities: ['text'],
      capabilitiesConfirmed: false,
      enabled: true,
    },
    {
      modelId: 'gpt5',
      providerModelId: 'gpt-5.2',
      protocol: 'openai-chat',
      capabilities: ['vision', 'text'],
      capabilitiesConfirmed: true,
      enabled: true,
    },
  ];

  it('resolves the configured model by catalog id', () => {
    expect(resolveVisionDescribeModel(catalog, 'deepseek-vision')?.providerModelId).toBe(
      'deepseek-v4-flash-vision-exp',
    );
  });

  it('resolves the configured model by provider-facing id', () => {
    expect(resolveVisionDescribeModel(catalog, 'gpt-5.2')?.modelId).toBe('gpt5');
  });

  it('returns undefined for unknown or empty ids (no automatic fallback)', () => {
    expect(resolveVisionDescribeModel(catalog, 'missing-model')).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, '')).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, undefined)).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, '  ')).toBeUndefined();
  });

  it('rejects a configured model that is disabled or confirmed text-only', () => {
    expect(
      resolveVisionDescribeModel(
        [
          {
            modelId: 'disabled-vision',
            providerModelId: 'gpt-4o',
            protocol: 'openai-chat',
            enabled: false,
          },
        ],
        'disabled-vision',
      ),
    ).toBeUndefined();
    expect(
      resolveVisionDescribeModel(
        [
          {
            modelId: 'text-only',
            providerModelId: 'gpt-4o-lookalike',
            protocol: 'openai-chat',
            capabilities: ['text'],
            capabilitiesConfirmed: true,
            enabled: true,
          },
        ],
        'text-only',
      ),
    ).toBeUndefined();
  });
});

describe('parseVisionFallbackSetting', () => {
  it('reads the enabled + modelId shape from the app KV value', () => {
    expect(parseVisionFallbackSetting({ enabled: true, modelId: 'm-1' })).toEqual({
      enabled: true,
      modelId: 'm-1',
    });
  });

  it('defaults to disabled/null for missing or malformed values', () => {
    expect(parseVisionFallbackSetting(undefined)).toEqual({ enabled: false, modelId: null });
    expect(parseVisionFallbackSetting(null)).toEqual({ enabled: false, modelId: null });
    expect(parseVisionFallbackSetting('nope')).toEqual({ enabled: false, modelId: null });
    expect(parseVisionFallbackSetting({ enabled: true, modelId: '' })).toEqual({
      enabled: true,
      modelId: null,
    });
  });
});

describe('prompt & suffix assembly', () => {
  it('builds an index-aware description prompt', () => {
    const prompt = buildImageDescriptionPrompt(
      { name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,xx' },
      1,
      2,
    );
    expect(prompt).toContain('第 1/2 张');
    expect(prompt).toContain('shot.png');
  });

  it('assembles the degraded suffix with per-image markers', () => {
    const suffix = buildDescriptionSuffix(
      [
        { name: 'a.png', text: '一张桌子' },
        { name: 'b.png', text: '一只猫' },
      ],
      true,
    );
    expect(suffix).toContain('【图片 1 · a.png】一张桌子');
    expect(suffix).toContain('【图片 2 · b.png】一只猫');
    expect(suffix).toContain('当前模型不含图像输入能力');
  });

  it('always guides text-only models to Windows OCR and only mentions visual fallback when enabled', () => {
    const files = [{ name: 'shot.png', relativePath: '.newmax-attachments\\shot.png' }];
    const ocrOnly = buildAttachmentGuidance(files, { visionFallbackEnabled: false });
    expect(ocrOnly).toContain('ocr_image');
    expect(ocrOnly).toContain('mcp__windows-ocr__ocr_image');
    expect(ocrOnly).not.toContain('describe_image');

    const withVision = buildAttachmentGuidance(files, { visionFallbackEnabled: true });
    expect(withVision).toContain('ocr_image');
    expect(withVision).toContain('describe_image');
  });

  it('assembles host-side OCR text and an explicit terminal degradation note', () => {
    const suffix = buildWindowsOcrSuffix([
      { name: 'error.png', text: 'Access denied', language: 'en-US' },
    ]);
    expect(suffix).toContain('Windows OCR');
    expect(suffix).toContain('【图片 1 · error.png · OCR en-US】Access denied');
    expect(suffix).toContain('不代表完整画面内容');
    expect(buildImageHandlingFailureSuffix()).toContain('图片预处理失败');
  });
});
