/**
 * Settings > 模型 > 图像生成 catalog.
 *
 * NewMax stores image backends separately from chat. SYNC-THINK already has
 * the OpenAI Images protocol (`openai-images` → POST /v1/images/generations).
 * Catalog cards are the NewMax OpenAI-compatible presets only — Grok OAuth,
 * Gemini Imagen, and DashScope async adapters are not present here.
 */
import type { ProviderSummary } from '@sync-think/protocol';

export const IMAGE_GENERATION_PROTOCOL = 'openai-images' as const;

export const IMAGE_GENERATION_COPY = {
  description:
    '这里集中配置对话中“画一张 / 生成图片”会使用的生图模型。支持 Grok 订阅登录、OpenAI/兼容接口、Google Gemini/Imagen 和 DashScope 通义万象；ChatGPT/Codex 订阅登录暂不作为生图 API Key 使用。',
  empty:
    '还没有配置过生图模型的提供商。可以点击「添加生图模型」，测试成功后会出现在左侧列表。',
  sidebarTitle: '生图供应商',
  sidebarHint: '拖拽排序，首位为默认',
  addImageProvider: '添加生图模型',
  testAndActivate: '测试连接并激活',
  customTitle: '自定义生图',
  customCardDescription: '从常见服务商目录选择，或配置自定义生图接口',
  customDialogDescription:
    '创建一个只用于图像生成的自定义配置，不会出现在聊天模型菜单里。',
  customTemplateDescription:
    '收录常见官方与聚合平台；选择后自动填写匹配的接口、Base URL 和推荐模型，API Key 不会被覆盖。',
  defaultProvider: '默认生图',
  missingKey: '缺少 Key',
  missingKeyHelperText: '填写生图 API Key 后才能测试连接并用于生图调用',
  helperText:
    '生图会使用列表第一项；拖动排序可切换默认模型，备用模型不会自动切换。不会出现在聊天模型菜单里',
  emptyFetchedModels: '该服务商模型列表里未发现图像生成模型，可手动填写模型 ID',
  returnList: '返回列表',
  modelId: '生图模型 ID',
  modelPlaceholder: '例如：gpt-image-2-vip、gpt-image-2、gpt-image-1.5、flux-1.1-pro',
  apiKeyPlaceholder: '填写用于生图的 API Key',
  namePlaceholder: '例如：我的生图接口',
} as const;

export function isImageGenerationProvider(provider: { protocol: string }): boolean {
  return provider.protocol === IMAGE_GENERATION_PROTOCOL;
}

export function isTextGenerationProvider(provider: { protocol: string }): boolean {
  return provider.protocol !== IMAGE_GENERATION_PROTOCOL;
}

export function isConfiguredImageProvider(provider: ProviderSummary): boolean {
  if (!isImageGenerationProvider(provider)) return false;
  return provider.credentials.length > 0 || provider.enabled !== false;
}

export function parseImageModelIds(raw: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(/[\n,，]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const IMAGE_MODEL_ID_HINTS = /(?:dall[-_ ]?e|gpt[-_ ]?image|image[-_ ]?gen|imagine[-_ ]?image|flux|imagen|midjourney|stable[-_ ]?diffusion|sdxl|glm[-_ ]?image|kolors|seedream|cogview|qwen[-_ ]?image|grok[-_ ]?imagine)/i;

/** Keep chat models out of an OpenAI Images model picker. */
export function isLikelyImageGenerationModelId(modelId: string): boolean {
  return IMAGE_MODEL_ID_HINTS.test(modelId.trim());
}

export type ImageCatalogCategory = 'recommended' | 'domestic' | 'aggregator' | 'overseas';

export const IMAGE_CATALOG_CATEGORIES: Array<{ id: ImageCatalogCategory; label: string }> = [
  { id: 'recommended', label: '推荐服务' },
  { id: 'domestic', label: '国内服务' },
  { id: 'aggregator', label: '聚合平台' },
  { id: 'overseas', label: '海外平台' },
];

export interface ImageCatalogItem {
  id: string;
  name: string;
  description: string;
  endpointMode: 'builtin' | 'custom';
  variant?: 'flat';
  draft: {
    name: string;
    baseUrl: string;
    models: string;
  };
}

const OPENAI_ITEM: ImageCatalogItem = {
  id: 'openai',
  name: 'OpenAI',
  description: 'OpenAI Images API（gpt-image-2）',
  endpointMode: 'builtin',
  draft: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: 'gpt-image-2',
  },
};

const GPTNB_ITEM: ImageCatalogItem = {
  id: 'gptnb',
  name: 'GPTNB',
  description: 'OpenAI 兼容生图中转',
  endpointMode: 'builtin',
  draft: {
    name: 'GPTNB',
    baseUrl: 'https://one-cn2.gptnb.ai/v1',
    models: 'gpt-image-2-vip, gpt-image-2',
  },
};

const CUSTOM_ITEM: ImageCatalogItem = {
  id: 'custom',
  name: IMAGE_GENERATION_COPY.customTitle,
  description: IMAGE_GENERATION_COPY.customCardDescription,
  endpointMode: 'custom',
  variant: 'flat',
  draft: {
    name: IMAGE_GENERATION_COPY.customTitle,
    baseUrl: 'https://api.openai.com/v1',
    models: 'gpt-image-2',
  },
};

export const IMAGE_PROVIDER_CATALOG: Record<ImageCatalogCategory, ImageCatalogItem[]> = {
  recommended: [CUSTOM_ITEM, OPENAI_ITEM, GPTNB_ITEM],
  domestic: [
    {
      id: 'zhipu',
      name: '智谱 BigModel',
      description: 'OpenAI 兼容生图（glm-image / cogview-4）',
      endpointMode: 'builtin',
      draft: {
        name: '智谱 BigModel',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: 'glm-image, cogview-4',
      },
    },
    {
      id: 'volcengine-ark',
      name: '火山方舟',
      description: 'OpenAI 兼容生图（doubao-seedream）',
      endpointMode: 'builtin',
      draft: {
        name: '火山方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: 'doubao-seedream-5-0-lite, doubao-seedream-4-5',
      },
    },
    {
      id: 'siliconflow-cn',
      name: '硅基流动',
      description: 'SiliconFlow Image API',
      endpointMode: 'builtin',
      draft: {
        name: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
        models: 'Kwai-Kolors/Kolors',
      },
    },
    {
      id: 'dmxapi',
      name: 'DMXAPI',
      description: 'OpenAI 兼容生图中转',
      endpointMode: 'builtin',
      draft: {
        name: 'DMXAPI',
        baseUrl: 'https://www.dmxapi.cn/v1',
        models: 'gpt-image-1.5, qwen-image',
      },
    },
    GPTNB_ITEM,
  ],
  aggregator: [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      description: 'OpenRouter Image API',
      endpointMode: 'builtin',
      draft: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: 'bytedance-seed/seedream-4.5',
      },
    },
    {
      id: 'together',
      name: 'Together AI',
      description: 'OpenAI 兼容生图',
      endpointMode: 'builtin',
      draft: {
        name: 'Together AI',
        baseUrl: 'https://api.together.ai/v1',
        models: 'black-forest-labs/FLUX.1.1-pro',
      },
    },
    {
      id: 'siliconflow-global',
      name: 'SiliconFlow',
      description: 'SiliconFlow Image API',
      endpointMode: 'builtin',
      draft: {
        name: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.com/v1',
        models: 'Kwai-Kolors/Kolors',
      },
    },
    GPTNB_ITEM,
  ],
  overseas: [
    OPENAI_ITEM,
    {
      id: 'xai-api',
      name: 'xAI API',
      description: 'OpenAI 兼容生图（grok-imagine-image）',
      endpointMode: 'builtin',
      draft: {
        name: 'xAI API',
        baseUrl: 'https://api.x.ai/v1',
        models: 'grok-imagine-image-quality, grok-imagine-image',
      },
    },
    {
      id: 'together-overseas',
      name: 'Together AI',
      description: 'OpenAI 兼容生图',
      endpointMode: 'builtin',
      draft: {
        name: 'Together AI',
        baseUrl: 'https://api.together.ai/v1',
        models: 'black-forest-labs/FLUX.1.1-pro',
      },
    },
    {
      id: 'openrouter-overseas',
      name: 'OpenRouter',
      description: 'OpenRouter Image API',
      endpointMode: 'builtin',
      draft: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: 'bytedance-seed/seedream-4.5',
      },
    },
  ],
};

export function composeTextProviderOrder(input: {
  all: ReadonlyArray<{ providerId: string; protocol: string }>;
  nextEnabledTextIds: readonly string[];
}): string[] {
  const images = input.all
    .filter((provider) => isImageGenerationProvider(provider))
    .map((provider) => provider.providerId);
  const enabled = new Set(input.nextEnabledTextIds);
  const rest = input.all
    .filter(
      (provider) =>
        isTextGenerationProvider(provider) && !enabled.has(provider.providerId),
    )
    .map((provider) => provider.providerId);
  return [...input.nextEnabledTextIds, ...rest, ...images];
}

export function composeImageProviderOrder(input: {
  all: ReadonlyArray<{ providerId: string; protocol: string }>;
  nextEnabledImageIds: readonly string[];
}): string[] {
  const text = input.all
    .filter((provider) => isTextGenerationProvider(provider))
    .map((provider) => provider.providerId);
  const enabled = new Set(input.nextEnabledImageIds);
  const rest = input.all
    .filter(
      (provider) =>
        isImageGenerationProvider(provider) && !enabled.has(provider.providerId),
    )
    .map((provider) => provider.providerId);
  return [...text, ...input.nextEnabledImageIds, ...rest];
}
