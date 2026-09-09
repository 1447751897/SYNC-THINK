/**
 * Chat image generation (`mcp__image-generation__generate_image`).
 *
 * Settings > 模型 > 图像生成 stores OpenAI Images providers
 * (`protocol: openai-images`). When the model asks to draw, the host calls
 * that API, writes PNG/JPEG/WebP under the bound project
 * `.sync-think/generated-images/`, and returns markdown the shell can embed
 * via `sync-think-image://generated/…` (same local-image scheme as screenshots).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  DEFAULT_IMAGE_GENERATION_CONFIG,
  IMAGE_GENERATION_COUNTS,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationCount,
  type ImageGenerationQuality,
  type ImageGenerationSize,
} from '@sync-think/shared';

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image';
export const IMAGE_GENERATION_SERVER_NAME = 'image-generation';
export const GENERATED_IMAGES_DIR = '.sync-think/generated-images';

export const GENERATE_IMAGE_TOOL_DESCRIPTION =
  '使用已配置的图像生成模型生成图片。只有用户在当前这条消息中明确点名某个已配置模型时，才通过 model 参数选择它；' +
  '未点名时必须省略 model，使用默认模型，不得沿用历史轮次的模型。适用于绘图、生图、头像、海报、插画、Logo、封面或壁纸等请求。' +
  '工具会把生成的图片写入磁盘并返回保存路径。';

export const GENERATE_IMAGE_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      description: '必填的图像提示词。请包含视觉风格、主体、构图和用户约束。',
    },
    count: {
      type: 'integer',
      minimum: 1,
      maximum: 4,
      description: '生成张数，默认 1',
    },
    size: {
      type: 'string',
      description: '可选的供应商专属尺寸，例如 1024x1024、1536x1024 或 1024*1024。',
    },
    aspect_ratio: {
      type: 'string',
      description: '可选画面比例，例如 1:1、16:9、9:16。未指定 size 时用于选择画布。',
    },
    quality: {
      type: 'string',
      enum: ['normal', '2k', ...IMAGE_GENERATION_QUALITIES],
      description: '可选质量预设，默认 2k。',
    },
    model: {
      type: 'string',
      description:
        '仅当用户在当前这条消息中明确点名已配置模型时传入。未点名时必须省略，不得沿用历史轮次。',
    },
  },
};

export type GenerateImageArgs = {
  prompt: string;
  count: ImageGenerationCount;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  model?: string;
};

const ASPECT_RATIO_TO_SIZE: Record<string, ImageGenerationSize> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
};

export function compactImageModelKey(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, '');
}

export function mapImageGenerationQuality(raw: unknown): ImageGenerationQuality {
  if (raw === '2k' || raw === 'high') return 'high';
  if (raw === 'normal' || raw === 'auto') return 'auto';
  if (raw === 'low' || raw === 'medium') return raw;
  return 'high';
}

export function parseGenerateImageSize(raw: unknown, aspectRatio?: unknown): ImageGenerationSize {
  if (typeof raw === 'string') {
    const normalized = raw.trim().replace('*', 'x');
    if (IMAGE_GENERATION_SIZES.includes(normalized as ImageGenerationSize)) {
      return normalized as ImageGenerationSize;
    }
  }
  if (typeof aspectRatio === 'string') {
    const mapped = ASPECT_RATIO_TO_SIZE[aspectRatio.trim()];
    if (mapped) return mapped;
  }
  return DEFAULT_IMAGE_GENERATION_CONFIG.size;
}

export function parseGenerateImageArgs(input: Record<string, unknown>): GenerateImageArgs | { error: string } {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return { error: '缺少生图提示词 prompt。' };
  if (prompt.length > 32_000) return { error: 'prompt 过长' };

  const countRaw = input.count;
  const count =
    typeof countRaw === 'number' && IMAGE_GENERATION_COUNTS.includes(countRaw as ImageGenerationCount)
      ? (countRaw as ImageGenerationCount)
      : DEFAULT_IMAGE_GENERATION_CONFIG.count;

  const size = parseGenerateImageSize(input.size, input.aspect_ratio);
  const quality = mapImageGenerationQuality(input.quality);
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : undefined;
  return { prompt, count, size, quality, ...(model ? { model } : {}) };
}

export function isImageGenerationProtocol(protocol: string | undefined): boolean {
  return protocol === 'openai-images';
}

export type ImageGenerationCatalogEntry = {
  providerId: string;
  name: string;
  protocol: string;
  enabled: boolean;
  sortOrder: number;
  hasCredential: boolean;
  models: Array<{
    modelId: string;
    providerModelId: string;
    priority: number;
    capabilities: readonly string[];
  }>;
};

export function pickImageGenerationTarget(
  catalog: readonly ImageGenerationCatalogEntry[],
  requestedModel?: string,
):
  | { provider: ImageGenerationCatalogEntry; model: ImageGenerationCatalogEntry['models'][number] }
  | { error: string } {
  const ready = catalog
    .filter(
      (entry) =>
        entry.enabled &&
        isImageGenerationProtocol(entry.protocol) &&
        entry.hasCredential &&
        entry.models.length > 0,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const provider = ready[0];
  if (!provider) {
    return {
      error: '还没有可用的生图供应商。请先在设置 > 模型 > 图像生成里添加 OpenAI 兼容生图接口。',
    };
  }
  const sorted = [...provider.models].sort((a, b) => a.priority - b.priority);
  if (requestedModel) {
    const needle = compactImageModelKey(requestedModel);
    const matches = sorted.filter(
      (model) =>
        compactImageModelKey(model.providerModelId) === needle ||
        compactImageModelKey(model.modelId) === needle ||
        compactImageModelKey(model.providerModelId).includes(needle) ||
        compactImageModelKey(model.modelId).includes(needle),
    );
    const unique = [
      ...new Map(matches.map((model) => [model.providerModelId, model])).values(),
    ];
    if (unique.length > 1) {
      return {
        error: `生图模型名称「${requestedModel}」同时命中多个模型：${unique
          .map((model) => model.providerModelId)
          .join(', ')}。请提供更完整的名称。`,
      };
    }
    const match = unique[0];
    if (!match) {
      return { error: `未找到已配置且可用的生图模型「${requestedModel}」。` };
    }
    return { provider, model: match };
  }
  const model = sorted[0];
  if (!model) return { error: '当前生图供应商还没有模型 ID' };
  return { provider, model };
}

export function generatedImageEmbedUrl(absolutePath: string): string {
  return `sync-think-image://generated/${encodeURIComponent(resolve(absolutePath))}`;
}

export function generatedImageRelativePath(workspaceRoot: string, absolutePath: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(absolutePath)).split('\\').join('/');
  return rel || basename(absolutePath);
}

export function buildGeneratedImageFileName(prompt: string, index: number, mimeType: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const suffix = index === 0 ? '' : `-${index + 1}`;
  return `${stamp}${slug ? `-${slug}` : ''}${suffix}.${ext}`;
}

export function writeGeneratedImages(input: {
  workspaceRoot: string;
  prompt: string;
  images: ReadonlyArray<{ bytes: Uint8Array; mimeType: string }>;
}): Array<{ absolutePath: string; relativePath: string; embedUrl: string }> {
  const root = resolve(input.workspaceRoot);
  const directory = join(root, '.sync-think', 'generated-images');
  mkdirSync(directory, { recursive: true });
  return input.images.map((image, index) => {
    const fileName = buildGeneratedImageFileName(input.prompt, index, image.mimeType);
    const absolutePath = join(directory, fileName);
    writeFileSync(absolutePath, Buffer.from(image.bytes));
    return {
      absolutePath,
      relativePath: generatedImageRelativePath(root, absolutePath),
      embedUrl: generatedImageEmbedUrl(absolutePath),
    };
  });
}

export function buildGenerateImageMarkdown(input: {
  prompt: string;
  providerName: string;
  modelId: string;
  files: ReadonlyArray<{ relativePath: string; embedUrl: string }>;
}): string {
  const paths = input.files.map((file) => file.relativePath).join(', ');
  const heading =
    input.files.length > 1
      ? `已生成并保存 ${input.files.length} 张图片。`
      : '图像已生成并保存。';
  const lines = [
    heading,
    `保存路径：${paths}`,
    `供应商：${input.providerName}`,
    `模型：${input.modelId}`,
    '',
    ...input.files.map((file, index) => {
      const alt = input.files.length > 1 ? `生成的图片 ${index + 1}` : '生成的图片';
      return `![${alt}](${file.embedUrl})`;
    }),
  ];
  return lines.join('\n').trim();
}

export function extractGenerateImageEmbedUrls(markdown: string): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*]\((sync-think-image:\/\/generated\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    if (match[1]) urls.push(match[1]);
  }
  return urls;
}

export function isGenerateImageToolName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === GENERATE_IMAGE_TOOL_NAME) return true;
  return /^mcp__[a-z0-9-]+__generate_image$/i.test(trimmed);
}

export function buildImageGenerationGuidance(options: {
  enabled: boolean;
  externalKernel: boolean;
}): string[] {
  if (!options.enabled) {
    return [
      [
        '## 图像生成',
        '当前没有已启用的生图供应商。用户若要求画图，说明需要先在设置 > 模型 > 图像生成里添加 OpenAI 兼容生图接口，不要用代码或 SVG 假装已经生成。',
      ].join('\n'),
    ];
  }
  const search = '`mcp__capability-broker__search_capability`';
  const use = '`mcp__capability-broker__use_capability`';
  return [
    [
      '## 图像生成',
      `普通生图、画图、图生图、海报、封面或头像请求：先调用 ${search} 找到「图片生成」，再用本轮返回的 ref 调用 ${use}。`,
      '不要直接调用 `generate_image`。prompt 必须包含视觉风格、主体、构图和用户约束。quality 默认 2k；未指定时不要改成更低画质。',
      '只有用户在当前这条消息中明确点名已配置模型时才传入 model；未点名时省略 model，不得沿用历史轮次。',
      '宿主会使用设置 > 模型 > 图像生成里排序第一的生图供应商，并把图片写进工作区 `.sync-think/generated-images/`。',
      '回复里用工具返回的 markdown 图片嵌入结果，不要另外用 ASCII / SVG 代替。',
    ].join('\n'),
  ];
}
