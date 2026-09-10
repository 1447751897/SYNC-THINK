// NewMax-style model source settings: dual-pane provider manager + global model prefs.
// Left: ordered provider list with enable toggles.
// Right: selected provider detail (endpoint / keys / models / priority) + global vision/plan-act.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlidingTabs } from './SlidingTabs.js';
import { DsTabBar } from './DsTabBar.js';
import {
  detectProviderConnectionInput,
  isLocalUrl,
  type DetectedApiFormat,
  type ProviderConnectionDetection,
} from './detect-provider-connection.js';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Database,
  FileText,
  Gauge,
  Globe2,
  GripVertical,
  Image,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Eye,
  EyeOff,
  Download,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type {
  CapabilityProbeSuggestion,
  CcSwitchImportPreviewItem,
  ImportCcSwitchResponse,
  ModelPricingEntry,
  PreviewCcSwitchImportResponse,
  ProviderModelSummary,
  ProviderSummary,
  UsageSummaryResponse,
} from '@sync-think/protocol';
import { splitProviderUsageTokens } from '@sync-think/shared';
import type { RendererUpdateProviderPayload } from '../../provider-payloads.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveProviderBrandLogo, resolveProviderBrandLogoByName } from './brand-icons.js';
import { useDialog } from './Dialog.js';
import { toastApi } from './Toast.js';
import {
  formatProviderDiscoveryError,
  formatRuntimeIpcError,
} from '../provider-error-copy.js';
import { REASONING_OPTIONS } from './compose-toolbar.js';
import { retryTransientRuntime } from '../runtime-connection.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { ModelOverflowMenu } from './ModelOverflowMenu.js';
import { ModelListSelect } from './ModelListSelect.js';
import { ImageGenerationSettings } from './ImageGenerationSettings.js';
import {
  AddModelInlineRow,
  ImportModelsDialog,
  type ImportDialogState,
} from './model-settings-widgets.js';
import {
  composeTextProviderOrder,
  isTextGenerationProvider,
} from './image-generation-providers.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProtocolFamily = 'openai-chat' | 'openai-responses' | 'openai-images' | 'anthropic-messages';

type ModelCapabilityTag = ProviderModelSummary['capabilities'][number];

const MODEL_CAPABILITY_OPTIONS: ReadonlyArray<{
  value: ModelCapabilityTag;
  label: string;
  description: string;
}> = [
  { value: 'text', label: '文本', description: '读取并生成文本内容' },
  { value: 'vision', label: '图片理解', description: '直接读取图片内容' },
  { value: 'tool-calling', label: '工具调用', description: '调用 MCP 与本地工具' },
  { value: 'web-search', label: '联网搜索', description: '调用模型原生网页搜索' },
  { value: 'image-generation', label: '图片生成', description: '根据提示生成图片' },
  { value: 'embeddings', label: '向量嵌入', description: '生成语义向量数据' },
];

/** Quick-pick context windows offered inside the model capability dialog. */
const CONTEXT_WINDOW_PRESETS: ReadonlyArray<number> = [
  200_000,
  272_000,
  300_000,
  1_000_000,
];

const PROTOCOL_LABELS: Record<ProtocolFamily, string> = {
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'openai-images': 'OpenAI Images',
  'anthropic-messages': 'Anthropic Messages',
};

interface VisionFallbackSetting {
  enabled: boolean;
  modelId: string | null;
}

interface PlanActSetting {
  enabled: boolean;
  planModelId: string | null;
  actModelId: string | null;
  planReasoningEffort: string | null;
  actReasoningEffort: string | null;
}

type PricingDraft = ModelPricingEntry;

interface UiOperation {
  kind:
    | 'create-provider'
    | 'reorder-provider'
    | 'toggle-provider'
    | 'save-provider'
    | 'discover-models'
    | 'import-models'
    | 'test-connection'
    | 'add-credential'
    | 'remove-credential'
    | 'reveal-credential'
    | 'update-credential'
    | 'add-model'
    | 'remove-model'
    | 'update-model'
    | 'reorder-model'
    | 'pin-credential'
    | 'save-preference';
  targetId?: string;
  label: string;
}

interface ConnectionTestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  latencyMs?: number;
  message?: string;
  /** Base URL snapshot when the last successful test ran. */
  testedBaseUrl?: string;
}

const CREDENTIAL_REVEAL_MS = 10_000;
const CREDENTIAL_MASK = '••••••••••••••••••••••••';
const EMPTY_CONNECTION_TEST: ConnectionTestState = { status: 'idle' };

interface SettingsToast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const EMPTY_PRICING_DRAFT: PricingDraft = {
  modelId: '',
  displayName: '',
  currency: 'USD',
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
};

const MODEL_PRICING_SETTING_KEY = 'model-pricing';

/** A model authored on the create form before the provider exists. */
interface DraftModel {
  providerModelId: string;
  displayName: string;
}

interface CreateDraft {
  name: string;
  baseUrl: string;
  protocol: ProtocolFamily;
  apiKey: string;
  /**
   * NewMax-style multi-key list: extra credentials created in the same hop as
   * the provider. The primary key stays in `apiKey`.
   */
  extraApiKeys: string[];
  supportsDiscovery: boolean;
  /**
   * NewMax-style: the priority chain lives in the draft until submit, so the
   * create form is the same editable surface as the provider detail page and
   * never needs a providerId to author models.
   */
  models: DraftModel[];
}

const EMPTY_CREATE: CreateDraft = {
  name: '',
  baseUrl: 'https://',
  protocol: 'openai-chat',
  apiKey: '',
  extraApiKeys: [],
  supportsDiscovery: true,
  models: [],
};

/** NewMax-style key list → ordered, trimmed, non-empty credentials. */
function collectCreateApiKeys(draft: CreateDraft): string[] {
  return [draft.apiKey, ...draft.extraApiKeys].map((key) => key.trim()).filter(Boolean);
}

type ProviderCatalogCategory = 'recommended' | 'domestic' | 'aggregator' | 'overseas' | 'local';

type CreateProviderStep = 'catalog' | 'form' | 'cc-switch';

interface ProviderCatalogItem {
  id: string;
  name: string;
  description: string;
  action: 'form' | 'cc-switch';
  endpointMode?: 'builtin' | 'custom';
  badge?: string;
  status?: string;
  variant?: 'flat';
  draft?: Partial<CreateDraft>;
}

type ModelTab = 'text' | 'image' | 'video' | 'voice' | 'recognition' | 'usage';

const MODEL_TABS: Array<{ id: ModelTab; label: string }> = [
  { id: 'text', label: '文本生成' },
  { id: 'image', label: '图像生成' },
  { id: 'video', label: '视频生成' },
  { id: 'voice', label: '语音生成' },
  { id: 'recognition', label: '语音识别' },
  { id: 'usage', label: '使用统计' },
];

const MEDIA_TAB_EMPTY: Record<
  Exclude<ModelTab, 'text' | 'usage'>,
  { description: string; empty: string }
> = {
  image: {
    description:
      '这里集中配置对话中“画一张 / 生成图片”会使用的生图模型。支持 Grok 订阅登录、OpenAI/兼容接口、Google Gemini/Imagen 和 DashScope 通义万象；ChatGPT/Codex 订阅登录暂不作为生图 API Key 使用。',
    empty: '还没有配置过生图模型的提供商。可以点击「添加生图模型」，测试成功后会出现在左侧列表。',
  },
  video: {
    description:
      '用法：在对话里描述画面，如"生成一段海边日落的 5 秒视频"。AI 会调用 generate_video 工具提交任务并等待完成（通常 1~5 分钟）。',
    empty:
      '还没有配置过视频生成的供应商。可以点击「添加视频模型」，配置成功后会出现在左侧列表，AI 即可在对话中调用生成视频。',
  },
  voice: {
    description:
      '用法：直接在对话里说"把这段文案生成语音"。AI 会调用 generate_speech 工具，用默认供应商与音色合成 mp3 保存到工作区。',
    empty:
      '还没有配置过语音生成的供应商。可以点击「添加语音模型」，配置成功后会出现在左侧列表，AI 即可在对话中调用生成语音。',
  },
  recognition: {
    description: '配置转录模型、凭证和接口地址',
    empty:
      '还没有配置过云端转录的供应商。可以点击「添加转录模型」，配置成功后语音输入和转录会走该云端渠道。',
  },
};

const API_FORMAT_LABELS: Record<DetectedApiFormat, string> = {
  openai: 'OpenAI 格式',
  anthropic: 'Anthropic 格式',
};

function protocolFamilyOf(protocol: ProtocolFamily): DetectedApiFormat {
  return protocol === 'anthropic-messages' ? 'anthropic' : 'openai';
}

function protocolFromDetection(
  current: ProtocolFamily,
  detection: ProviderConnectionDetection,
): ProtocolFamily {
  if (!detection.apiFormat) return current;
  if (detection.apiFormat === 'anthropic') return 'anthropic-messages';
  if (detection.forceResponsesApi === true) return 'openai-responses';
  if (detection.forceResponsesApi === false) return 'openai-chat';
  return current === 'openai-responses' ? 'openai-responses' : 'openai-chat';
}

function isConfiguredProvider(provider: ProviderSummary): boolean {
  if (provider.credentials.length > 0) return true;
  if (isLocalUrl(provider.baseUrl)) return provider.enabled !== false;
  return false;
}

function connectionHintText(detection: ProviderConnectionDetection | null): string {
  if (detection?.apiFormat) {
    return `已根据地址识别为 ${API_FORMAT_LABELS[detection.apiFormat]}；仍可在下方手动修改。`;
  }
  if (detection?.normalized) {
    return '已自动整理 API Base URL，并保留当前 API 格式。';
  }
  return '请从服务商接入文档复制 Base URL 或完整请求地址，离开输入框后会自动识别并整理。';
}

const PROVIDER_CATALOG_CATEGORIES: Array<{
  id: ProviderCatalogCategory;
  label: string;
}> = [
  { id: 'recommended', label: '推荐服务' },
  { id: 'domestic', label: '国内服务' },
  { id: 'aggregator', label: '聚合平台' },
  { id: 'overseas', label: '海外平台' },
  { id: 'local', label: '本地模型' },
];

const CUSTOM_PROVIDER_ITEM: ProviderCatalogItem = {
  id: 'custom',
  name: '自定义供应商',
  description: '配置自定义 API 兼容的供应商',
  action: 'form',
  endpointMode: 'custom',
  variant: 'flat',
  draft: EMPTY_CREATE,
};

const CC_SWITCH_ITEM: ProviderCatalogItem = {
  id: 'cc-switch',
  name: '从 CC Switch 导入',
  description: '读取本机 CC Switch 中已配置的 Claude 供应商',
  action: 'cc-switch',
  variant: 'flat',
};

const PROVIDER_CATALOG: Record<ProviderCatalogCategory, ProviderCatalogItem[]> = {
  recommended: [CUSTOM_PROVIDER_ITEM, CC_SWITCH_ITEM],
  domestic: [
    {
      id: 'minimax-token-plan',
      name: 'MiniMax Token Plan',
      description: 'MiniMax Token Plan 订阅套餐（国内）',
      action: 'form',
      badge: '套餐',
      draft: {
        name: 'MiniMax Token Plan',
        baseUrl: 'https://api.minimax.chat/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'minimax-api',
      name: 'MiniMax 按量 API',
      description: 'MiniMax 开放平台按量计费 API',
      action: 'form',
      badge: '按量',
      draft: {
        name: 'MiniMax 按量 API',
        baseUrl: 'https://api.minimax.chat/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'kimi-coding',
      name: 'Kimi Coding Plan',
      description: 'Kimi 智能助手的编程版，月之暗面出品',
      action: 'form',
      badge: '套餐',
      draft: { name: 'Kimi Coding Plan', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'moonshot',
      name: 'Moonshot',
      description: '月之暗面开放平台，按量付费',
      action: 'form',
      badge: '按量',
      status: '已激活',
      draft: {
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'zhipu-coding',
      name: '智谱 GLM Coding Plan',
      description: '智谱 GLM 编程模型',
      action: 'form',
      badge: '套餐',
      draft: {
        name: '智谱 GLM Coding Plan',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'zhipu-api',
      name: '智谱开放平台 API',
      description: '智谱开放平台通用 API，按实际调用量计费',
      action: 'form',
      badge: '按量',
      draft: {
        name: '智谱开放平台 API',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      description: 'DeepSeek 官方 API，按量计费',
      action: 'form',
      status: '已激活',
      draft: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'bailian-coding',
      name: '百炼 Coding Plan',
      description: '阿里云百炼面向 Qwen 模型的 Coding Plan',
      action: 'form',
      badge: '套餐',
      draft: {
        name: '百炼 Coding Plan',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'bailian-token-plan',
      name: '百炼 Token Plan',
      description: '阿里云百炼 Token Plan 订阅套餐',
      action: 'form',
      badge: '套餐',
      draft: {
        name: '百炼 Token Plan',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'bailian-api',
      name: '百炼按量 API',
      description: '阿里云百炼 Model Studio 按量计费 API',
      action: 'form',
      badge: '按量',
      draft: {
        name: '百炼按量 API',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'stepfun',
      name: '阶跃星辰',
      description: '阶跃星辰 API，可调用 Step 系列模型',
      action: 'form',
      draft: {
        name: '阶跃星辰',
        baseUrl: 'https://api.stepfun.com/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'bailing',
      name: '百聆',
      description: '百聆 API，可调用 Ling 系列模型',
      action: 'form',
      draft: { name: '百聆', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'longcat',
      name: 'Longcat',
      description: '长上下文优化服务',
      action: 'form',
      draft: { name: 'Longcat', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'xiaomi-mimo',
      name: '小米 MiMo',
      description: '小米 MiMo 模型平台',
      action: 'form',
      draft: { name: '小米 MiMo', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    CUSTOM_PROVIDER_ITEM,
    CC_SWITCH_ITEM,
  ],
  aggregator: [
    {
      id: 'volcengine-ark',
      name: '火山方舟',
      description: '通过火山方舟接入豆包模型',
      action: 'form',
      draft: {
        name: '火山方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'siliconflow-cn',
      name: '硅基流动中国',
      description: '面向国内开源模型的硅基流动中国端点',
      action: 'form',
      draft: {
        name: '硅基流动中国',
        baseUrl: 'https://api.siliconflow.cn/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'modelscope',
      name: 'ModelScope',
      description: '阿里云魔搭推理服务',
      action: 'form',
      draft: {
        name: 'ModelScope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'gptnb',
      name: 'GPTNB',
      description: '多模型聚合服务',
      action: 'form',
      draft: { name: 'GPTNB', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'pipellm',
      name: 'Pipellm',
      description: '多模型聚合与兼容转发服务',
      action: 'form',
      draft: { name: 'Pipellm', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'anthropic-gateway',
      name: 'Anthropic 兼容网关',
      description: '通过第三方 Anthropic 兼容网关使用 Claude',
      action: 'form',
      draft: {
        name: 'Anthropic 兼容网关',
        baseUrl: 'https://',
        protocol: 'anthropic-messages',
        supportsDiscovery: false,
      },
    },
    CUSTOM_PROVIDER_ITEM,
    CC_SWITCH_ITEM,
  ],
  overseas: [
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI 官方 API，可使用 GPT 与 Codex 模型',
      action: 'form',
      draft: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-responses',
      },
    },
    {
      id: 'chatgpt-subscription',
      name: 'ChatGPT 订阅',
      description: '通过兼容网关连接 ChatGPT Plus / Pro 订阅',
      action: 'form',
      draft: { name: 'ChatGPT 订阅', baseUrl: 'https://', protocol: 'openai-responses' },
    },
    {
      id: 'supergrok',
      name: 'SuperGrok',
      description: '通过兼容网关连接 SuperGrok 服务',
      action: 'form',
      draft: { name: 'SuperGrok', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      description: '通过兼容网关连接 Antigravity 服务',
      action: 'form',
      draft: { name: 'Antigravity', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'gemini-api',
      name: 'Gemini API',
      description: 'Google AI Studio 的 OpenAI 兼容 API',
      action: 'form',
      draft: {
        name: 'Gemini API',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'opencode-go',
      name: 'OpenCode Go',
      description: '低成本编程模型订阅服务',
      action: 'form',
      draft: { name: 'OpenCode Go', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'opencode-go-anthropic',
      name: 'OpenCode Go（Anthropic）',
      description: 'OpenCode Go 的 Anthropic 兼容渠道',
      action: 'form',
      draft: {
        name: 'OpenCode Go（Anthropic）',
        baseUrl: 'https://',
        protocol: 'anthropic-messages',
        supportsDiscovery: false,
      },
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Anthropic 官方 API，原生支持 Claude 系列模型',
      action: 'form',
      draft: {
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        protocol: 'anthropic-messages',
        supportsDiscovery: false,
      },
    },
    {
      id: 'minimax-global',
      name: 'MiniMax 国际',
      description: '面向海外用户的 MiniMax 国际端点',
      action: 'form',
      draft: {
        name: 'MiniMax 国际',
        baseUrl: 'https://api.minimax.io/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'z-ai',
      name: 'Z.ai',
      description: '面向 GLM 模型的 Z.ai 国际端点',
      action: 'form',
      draft: {
        name: 'Z.ai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      description: '海外多模型聚合与统一 API',
      action: 'form',
      draft: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'siliconflow-global',
      name: 'SiliconFlow',
      description: '硅基流动海外端点',
      action: 'form',
      draft: {
        name: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.com/v1',
        protocol: 'openai-chat',
      },
    },
    CUSTOM_PROVIDER_ITEM,
    CC_SWITCH_ITEM,
  ],
  local: [
    {
      id: 'ollama',
      name: 'Ollama',
      description: '本地运行开源模型，默认连接 11434 端口',
      action: 'form',
      draft: {
        name: 'Ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        protocol: 'openai-chat',
        apiKey: 'ollama-local',
      },
    },
    {
      id: 'lm-studio',
      name: 'LM Studio',
      description: '连接 LM Studio 本地 OpenAI 兼容服务器',
      action: 'form',
      draft: {
        name: 'LM Studio',
        baseUrl: 'http://127.0.0.1:1234/v1',
        protocol: 'openai-chat',
        apiKey: 'lm-studio-local',
      },
    },
    CUSTOM_PROVIDER_ITEM,
    CC_SWITCH_ITEM,
  ],
};

function bridge() {
  return window.syncThink?.runtime;
}

function formatContext(tokens?: number): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}m`;
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return String(tokens);
}

/**
 * Parse a human context-window input into absolute tokens.
 * Accepts: 372000, 372k, 372K, 1m, 1.5M, 200_000, "372 k".
 */
function parseContextTokens(raw: string): number | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/[,\s_]/g, '');
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1;
  const tokens = Math.round(amount * multiplier);
  return tokens > 0 ? tokens : null;
}

/** Single visible model title — avoid "GPT-5.6 Sol / gpt-5.6-sol" duplication. */
function modelPrimaryLabel(model: { displayName: string; providerModelId: string }): string {
  const display = model.displayName.trim();
  const providerId = model.providerModelId.trim();
  if (!display) return providerId;
  if (!providerId) return display;
  if (display.toLowerCase() === providerId.toLowerCase()) return display;
  // Prefer the friendlier display name when both exist and differ.
  return display;
}

function modelRankLabel(index: number): string {
  return index === 0 ? '主模型' : `备用${index}`;
}

function parseVisionFallback(raw: unknown): VisionFallbackSetting {
  if (!raw || typeof raw !== 'object') return { enabled: false, modelId: null };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    modelId: typeof o.modelId === 'string' && o.modelId ? o.modelId : null,
  };
}

function parsePlanAct(raw: unknown): PlanActSetting {
  if (!raw || typeof raw !== 'object')
    return {
      enabled: false,
      planModelId: null,
      actModelId: null,
      planReasoningEffort: null,
      actReasoningEffort: null,
    };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    planModelId: typeof o.planModelId === 'string' && o.planModelId ? o.planModelId : null,
    actModelId: typeof o.actModelId === 'string' && o.actModelId ? o.actModelId : null,
    planReasoningEffort:
      typeof o.planReasoningEffort === 'string' && o.planReasoningEffort
        ? o.planReasoningEffort
        : null,
    actReasoningEffort:
      typeof o.actReasoningEffort === 'string' && o.actReasoningEffort
        ? o.actReasoningEffort
        : null,
  };
}

// ─── Root ────────────────────────────────────────────────────────────────────

export interface ModelSettingsHandle {
  /** Complete gate: stage secrets → test connection → true only when ready to close. */
  complete(): Promise<boolean>;
  /** Open the provider catalog without leaving the settings page. */
  startCreate(): void;
}

export type ModelSettingsDetailView =
  | 'provider'
  | 'vision'
  | 'plan-act'
  | 'cloud-sync';

export interface ModelSettingsProps {
  initialDetailView?: ModelSettingsDetailView;
  navigationKey?: string | number;
  onCatalogChanged?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export const ModelSettings = forwardRef<ModelSettingsHandle, ModelSettingsProps>(function ModelSettings(
  { initialDetailView, navigationKey, onCatalogChanged, onDirtyChange },
  ref,
) {
  const dialog = useDialog();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<UiOperation | null>(null);
  const [, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [disabledMenuOpen, setDisabledMenuOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<CreateProviderStep>('catalog');
  const [catalogCategory, setCatalogCategory] = useState<ProviderCatalogCategory>('recommended');
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [createTemplate, setCreateTemplate] = useState<ProviderCatalogItem | null>(null);
  const [ccSwitchPreview, setCcSwitchPreview] = useState<PreviewCcSwitchImportResponse | null>(
    null,
  );
  const [selectedCcSwitchIds, setSelectedCcSwitchIds] = useState<string[]>([]);
  const [ccSwitchLoading, setCcSwitchLoading] = useState(false);
  const [ccSwitchImporting, setCcSwitchImporting] = useState(false);
  const [modelTab, setModelTab] = useState<ModelTab>('text');
  const [usageSinceDays, setUsageSinceDays] = useState<number | undefined>(7);
  const [usageReloadToken, setUsageReloadToken] = useState(0);
  const [usageRefreshing, setUsageRefreshing] = useState(false);
  const [detailView, setDetailView] = useState<ModelSettingsDetailView>(
    initialDetailView ?? 'provider',
  );
  const [visionFallback, setVisionFallback] = useState<VisionFallbackSetting>({
    enabled: false,
    modelId: null,
  });
  const [modelConfigCloudSync, setModelConfigCloudSync] = useState(false);
  const [planAct, setPlanAct] = useState<PlanActSetting>({
    enabled: false,
    planModelId: null,
    actModelId: null,
    planReasoningEffort: null,
    actReasoningEffort: null,
  });

  const [providerOrders, setProviderOrders] = useState<Record<string, ProviderModelSummary[]>>({});

  useEffect(() => {
    if (!initialDetailView) return;
    setShowCreate(false);
    setDetailView(initialDetailView);
  }, [initialDetailView, navigationKey]);
  const selectedProvider =
    providers.find(
      (provider) =>
        provider.providerId === selectedId && isTextGenerationProvider(provider),
    ) ?? null;
  const selected = selectedProvider
    ? {
        ...selectedProvider,
        models: providerOrders[selectedProvider.providerId] ?? selectedProvider.models,
      }
    : null;
  const providerListBusy =
    operation?.kind === 'reorder-provider' || operation?.kind === 'toggle-provider';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const showToast = useCallback((kind: SettingsToast['kind'], message: string) => {
    toastApi.toast({
      id: `model-settings-${kind}-${message}`,
      type: kind,
      title: message,
      duration: kind === 'error' ? 5000 : 2400,
    });
  }, []);

  const allModels = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models.map((m) => ({
          modelId: m.modelId,
          providerModelId: m.providerModelId,
          displayName: m.displayName,
          providerName: p.name,
          providerId: p.providerId,
          enabled: p.enabled,
          capabilities: m.capabilities,
          capabilitiesConfirmed: m.capabilitiesConfirmed,
        })),
      ),
    [providers],
  );

  const hydratedRef = useRef(false);
  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.listProviders) {
      showToast('error', 'Runtime 未连接，无法加载模型源');
      setLoading(false);
      return;
    }
    if (!hydratedRef.current) setLoading(true);
    try {
      const [listed, settings] = await retryTransientRuntime(() =>
        Promise.all([
          api.listProviders({}),
          api.getSettings?.({
            keys: ['vision-fallback', 'plan-act', 'model-config-cloud-sync'],
          }) ?? Promise.resolve({ settings: {} as Record<string, unknown> }),
        ]),
      );
      const next = [...listed.providers].sort((a, b) => a.sortOrder - b.sortOrder);
      setProviders(next);
      setVisionFallback(parseVisionFallback(settings.settings?.['vision-fallback']));
      setPlanAct(parsePlanAct(settings.settings?.['plan-act']));
      setModelConfigCloudSync(settings.settings?.['model-config-cloud-sync'] === true);
      setSelectedId((prev) => {
        const text = next.filter(isTextGenerationProvider);
        if (prev && text.some((p) => p.providerId === prev)) return prev;
        return text[0]?.providerId ?? null;
      });
      hydratedRef.current = true;
    } catch (e) {
      showToast('error', formatRuntimeIpcError(e, '加载模型源失败'));
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const withBusy = useCallback(
    async (
      nextOperation: UiOperation,
      fn: () => Promise<void>,
      successMessage?: string | (() => string),
    ) => {
      setOperation(nextOperation);
      setStatus(nextOperation.label);
      try {
        await fn();
        const message = typeof successMessage === 'function' ? successMessage() : successMessage;
        if (message) {
          setStatus(message);
          showToast('success', message);
        }
        return true;
      } catch (e) {
        const message = formatRuntimeIpcError(e, '操作失败');
        setStatus(null);
        showToast('error', message);
        return false;
      } finally {
        setOperation(null);
        onCatalogChanged?.();
      }
    },
    [onCatalogChanged, showToast],
  );

  /** NewMax-style connection-test result shown on the create form. */
  const [createTestResult, setCreateTestResult] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });

  /** Any edit invalidates the previous probe, exactly like markFormDirty. */
  const updateCreateDraft = useCallback((next: CreateDraft) => {
    setCreateTestResult({ status: 'idle', message: '' });
    setCreateDraft(next);
  }, []);

  /** Write ids checked in the import dialog back into the create draft. */
  const handleApplyCreateImport = useCallback(
    (dialog: ImportDialogState) => {
      const selected = new Set(dialog.selectedIds);
      const kept = createDraft.models.filter((model) => selected.has(model.providerModelId));
      const appended = dialog.discovered
        .filter(
          (item) =>
            selected.has(item.providerModelId) &&
            !kept.some((model) => model.providerModelId === item.providerModelId),
        )
        .map((item) => ({
          providerModelId: item.providerModelId,
          displayName: item.displayName || item.providerModelId,
        }));
      setCreateDraft((current) => ({ ...current, models: [...kept, ...appended] }));
      setImportDialog(null);
    },
    [createDraft.models],
  );

  /**
   * NewMax-style: discovery runs against the draft credentials, so the model
   * list can be authored before the provider row exists. Nothing is persisted.
   */
  const handleDiscoverCreateModels = () =>
    void withBusy({ kind: 'create-provider', label: '拉取模型列表…' }, async () => {
      const api = bridge();
      if (!api?.probeModels) throw new Error('Runtime 未连接');
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = collectCreateApiKeys(createDraft)[0];
      const usesCustomEndpoint = createTemplate?.endpointMode === 'custom';
      if (!baseUrl || baseUrl === 'https://') {
        throw new Error(usesCustomEndpoint ? '请填写 Base URL' : '该服务商模板尚未配置连接地址');
      }
      if (!apiKey) throw new Error('请填写 API 密钥');
      // The secret rides the clipboard, exactly like create/update.
      await navigator.clipboard.writeText(apiKey);
      const probe = await api.probeModels({
        baseUrl,
        protocol: createDraft.protocol as never,
      });
      const discoveredIds = probe.discoveredIds ?? [];
      setImportDialog({
        target: 'create',
        protocol: probe.protocol ?? createDraft.protocol,
        discovered: discoveredIds.map((id) => ({
          providerModelId: id,
          displayName: id,
          alreadyAdded: createDraft.models.some((model) => model.providerModelId === id),
        })),
        selectedIds: createDraft.models
          .map((model) => model.providerModelId)
          .filter((id) => discoveredIds.includes(id)),
        query: '',
        applying: false,
      });
    });

  /**
   * NewMax-style: probe first, persist only when the probe passes. The whole
   * provider — priority chain included — then lands in a single create hop.
   */
  const handleCreate = () =>
    void withBusy({ kind: 'create-provider', label: '测试连接中…' }, async () => {
      const api = bridge();
      if (!api?.createProvider || !api?.probeModels) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKeys = collectCreateApiKeys(createDraft);
      const apiKey = apiKeys[0];
      const protocol = createDraft.protocol;
      const usesCustomEndpoint = createTemplate?.endpointMode === 'custom';
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') {
        throw new Error(usesCustomEndpoint ? '请填写 Base URL' : '该服务商模板尚未配置连接地址');
      }
      if (!apiKey) throw new Error('请填写 API 密钥');
      if (createDraft.models.length === 0) throw new Error('请至少添加一个模型');
      // Secrets ride the clipboard (a JSON list when there is more than one),
      // exactly like create/update — they never enter the payload.
      await navigator.clipboard.writeText(
        apiKeys.length > 1 ? JSON.stringify({ keys: apiKeys }) : apiKey,
      );

      // 1) Connectivity probe — nothing is persisted at this stage.
      setCreateTestResult({ status: 'testing', message: '正在测试连接…' });
      const startedAt = Date.now();
      try {
        const probe = await api.probeModels({ baseUrl, protocol: protocol as never });
        const latencyMs =
          typeof probe.latencyMs === 'number'
            ? probe.latencyMs
            : Math.max(0, Date.now() - startedAt);
        setCreateTestResult({ status: 'success', message: `连接成功 · ${latencyMs}ms` });
      } catch (probeError) {
        setCreateTestResult({
          status: 'error',
          message: formatProviderDiscoveryError(probeError),
        });
        return;
      }

      // 2) Only a passing probe activates the provider.
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol,
        supportsDiscovery: true,
        discoverOnCreate: false,
        ...(apiKeys.length > 1 ? { apiKeyList: true } : {}),
        models: createDraft.models.map((model) => ({
          providerModelId: model.providerModelId,
          displayName: model.displayName || model.providerModelId,
        })),
      });
      setCreateTestResult({ status: 'idle', message: '' });
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      setCreateStep('catalog');
      setCreateTemplate(null);
      setSelectedId(result.provider.providerId);
      setLastSelectedId(result.provider.providerId);
      setDetailView('provider');
      await load();
    });

  /**
   * NewMax-style「仍然保存」: skip the probe entirely and persist the provider
   * flagged as unverified, so a relay that refuses the capability probes can
   * still be used. Same single create hop — the priority chain rides along.
   */
  const handleSaveUnverified = () =>
    void withBusy({ kind: 'create-provider', label: '保存中…' }, async () => {
      const api = bridge();
      if (!api?.createProvider) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKeys = collectCreateApiKeys(createDraft);
      const apiKey = apiKeys[0];
      const protocol = createDraft.protocol;
      const usesCustomEndpoint = createTemplate?.endpointMode === 'custom';
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') {
        throw new Error(usesCustomEndpoint ? '请填写 Base URL' : '该服务商模板尚未配置连接地址');
      }
      if (!apiKey) throw new Error('请填写 API 密钥');
      if (createDraft.models.length === 0) throw new Error('请至少添加一个模型');
      await navigator.clipboard.writeText(
        apiKeys.length > 1 ? JSON.stringify({ keys: apiKeys }) : apiKey,
      );
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol,
        supportsDiscovery: true,
        discoverOnCreate: false,
        unverified: true,
        ...(apiKeys.length > 1 ? { apiKeyList: true } : {}),
        models: createDraft.models.map((model) => ({
          providerModelId: model.providerModelId,
          displayName: model.displayName || model.providerModelId,
        })),
      });
      setCreateTestResult({ status: 'idle', message: '' });
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      setCreateStep('catalog');
      setCreateTemplate(null);
      setSelectedId(result.provider.providerId);
      setLastSelectedId(result.provider.providerId);
      setDetailView('provider');
      await load();
    });

  const restoreProviderSelection = useCallback(() => {
    const restoreId =
      lastSelectedId && providers.some((provider) => provider.providerId === lastSelectedId)
        ? lastSelectedId
        : (providers[0]?.providerId ?? null);
    setSelectedId(restoreId);
  }, [lastSelectedId, providers]);

  const resetCreateState = useCallback(() => {
    setCreateStep('catalog');
    setCatalogCategory('recommended');
    setCreateDraft(EMPTY_CREATE);
    setCreateTemplate(null);
    setCcSwitchPreview(null);
    setSelectedCcSwitchIds([]);
    setCcSwitchLoading(false);
    setCcSwitchImporting(false);
  }, []);

  const openCreateCatalog = useCallback(() => {
    setLastSelectedId(selectedId);
    setDetailView('provider');
    setShowCreate(true);
    setCreateStep('catalog');
    setCatalogCategory('recommended');
    setCreateDraft(EMPTY_CREATE);
    setCreateTemplate(null);
    setCcSwitchPreview(null);
    setSelectedCcSwitchIds([]);
    setSelectedId(null);
  }, [selectedId]);

  const cancelCreateFlow = useCallback(() => {
    setShowCreate(false);
    resetCreateState();
    restoreProviderSelection();
  }, [resetCreateState, restoreProviderSelection]);

  const openProviderTemplate = useCallback((item: ProviderCatalogItem) => {
    const baseUrl = item.draft?.baseUrl?.trim();
    const resolvedItem =
      item.action === 'form' && (!baseUrl || baseUrl === 'https://')
        ? { ...item, endpointMode: 'custom' as const }
        : item;
    setCreateDraft({ ...EMPTY_CREATE, ...(resolvedItem.draft ?? {}) });
    setCreateTemplate(resolvedItem);
    setCreateStep('form');
  }, []);

  const openCcSwitchImport = useCallback(async () => {
    const api = bridge();
    setCreateStep('cc-switch');
    setCreateTemplate(null);
    setCcSwitchLoading(true);
    setCcSwitchPreview(null);
    setSelectedCcSwitchIds([]);
    try {
      if (!api?.previewCcSwitchImport) throw new Error('Runtime 未连接，无法读取 CC Switch');
      const preview = await api.previewCcSwitchImport({});
      setCcSwitchPreview(preview);
      setSelectedCcSwitchIds(
        preview.items.filter((item) => item.importable).map((item) => item.sourceId),
      );
    } catch (e) {
      showToast('error', formatRuntimeIpcError(e, '读取 CC Switch 配置失败'));
    } finally {
      setCcSwitchLoading(false);
    }
  }, [showToast]);

  const handleCcSwitchImport = useCallback(async () => {
    if (selectedCcSwitchIds.length === 0 || ccSwitchImporting) return;
    const api = bridge();
    setCcSwitchImporting(true);
    try {
      if (!api?.importCcSwitch) throw new Error('Runtime 未连接，无法导入 CC Switch');
      const result: ImportCcSwitchResponse = await api.importCcSwitch({
        sourceIds: selectedCcSwitchIds,
      });
      const firstImported = result.results.find((item) => item.ok && item.providerId);
      const summary = `CC Switch 导入完成 · 成功 ${result.importedCount} · 失败 ${result.failedCount}`;
      if (!firstImported?.providerId) {
        const details = result.results
          .filter((item) => !item.ok)
          .slice(0, 3)
          .map((item) => `${item.name ?? item.sourceId}：${item.error ?? '导入失败'}`)
          .join('；');
        throw new Error(details || summary);
      }
      await load();
      setShowCreate(false);
      resetCreateState();
      setSelectedId(firstImported.providerId);
      setLastSelectedId(firstImported.providerId);
      showToast('success', summary);
      onCatalogChanged?.();
    } catch (e) {
      showToast('error', formatRuntimeIpcError(e, '导入 CC Switch 失败'));
    } finally {
      setCcSwitchImporting(false);
    }
  }, [ccSwitchImporting, load, onCatalogChanged, resetCreateState, selectedCcSwitchIds, showToast]);

  const persistProviderOrder = useCallback(
    async (orderedEnabled: ProviderSummary[], previousProviders = providers) => {
      const api = bridge();
      if (!api?.reorderProviders) throw new Error('Runtime 未连接');
      await api.reorderProviders({
        orderedProviderIds: composeTextProviderOrder({
          all: previousProviders,
          nextEnabledTextIds: orderedEnabled.map((provider) => provider.providerId),
        }) as never,
      });
    },
    [providers],
  );

  const handleProviderDragStart = (event: DragStartEvent) => {
    setActiveProviderId(String(event.active.id));
  };

  const handleProviderDragCancel = () => setActiveProviderId(null);

  const handleProviderDragEnd = (event: DragEndEvent) => {
    setActiveProviderId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId || providerListBusy) return;

    const previous = providers;
    const enabled = previous.filter(
      (provider) => provider.enabled && isTextGenerationProvider(provider),
    );
    const oldIndex = enabled.findIndex((provider) => provider.providerId === activeId);
    const newIndex = enabled.findIndex((provider) => provider.providerId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextEnabled = arrayMove(enabled, oldIndex, newIndex);
    const nextProviders = [
      ...nextEnabled,
      ...previous.filter((provider) => isTextGenerationProvider(provider) && !provider.enabled),
      ...previous.filter((provider) => !isTextGenerationProvider(provider)),
    ];
    setProviders(nextProviders);
    void withBusy(
      { kind: 'reorder-provider', targetId: activeId, label: '正在保存模型顺序…' },
      async () => {
        try {
          await persistProviderOrder(nextEnabled, previous);
        } catch (error) {
          setProviders(previous);
          throw error;
        }
      },
    );
  };

  const handleToggleEnabled = (provider: ProviderSummary, enabled: boolean) => {
    const previous = providers;
    const nextProviders = previous.map((item) =>
      item.providerId === provider.providerId ? { ...item, enabled } : item,
    );
    setProviders(nextProviders);
    if (!enabled && selectedId === provider.providerId) {
      const nextSelected =
        nextProviders.find((item) => item.enabled)?.providerId ?? provider.providerId;
      setSelectedId(nextSelected);
    }
    setDisabledMenuOpen(false);
    void withBusy(
      {
        kind: 'toggle-provider',
        targetId: provider.providerId,
        label: enabled ? '正在启用…' : '正在停用…',
      },
      async () => {
        const api = bridge();
        if (!api?.updateProvider) throw new Error('Runtime 未连接');
        try {
          await api.updateProvider({ providerId: provider.providerId, enabled });
          await load();
        } catch (error) {
          setProviders(previous);
          setSelectedId(provider.providerId);
          throw error;
        }
      },
      `${provider.name} 已${enabled ? '启用' : '停用'}`,
    );
  };

  const wipeProviderCredentials = async (provider: ProviderSummary) => {
    const api = bridge();
    if (!api?.removeProviderCredential || !api.updateProvider) throw new Error('Runtime 未连接');
    for (const credential of provider.credentials) {
      await api.removeProviderCredential({
        providerId: provider.providerId as never,
        credentialRefId: credential.credentialRefId as never,
      });
    }
    await api.updateProvider({ providerId: provider.providerId, enabled: false });
  };

  const handleRemoveProvider = (provider: ProviderSummary) => {
    const previous = providers;
    const remaining = previous.filter((item) => item.providerId !== provider.providerId);
    setProviders(remaining);
    if (selectedId === provider.providerId) {
      setSelectedId(remaining.find((item) => item.enabled)?.providerId ?? remaining[0]?.providerId ?? null);
    }
    setDisabledMenuOpen(false);
    void withBusy(
      { kind: 'toggle-provider', targetId: provider.providerId, label: '正在移除…' },
      async () => {
        try {
          await wipeProviderCredentials(provider);
          await load();
        } catch (error) {
          setProviders(previous);
          setSelectedId(provider.providerId);
          throw error;
        }
      },
    );
  };

  const handleEnableAllDisabled = () => {
    const targets = providers.filter((item) => !item.enabled);
    if (targets.length === 0) return;
    setDisabledMenuOpen(false);
    void withBusy({ kind: 'toggle-provider', label: '正在启用…' }, async () => {
      const api = bridge();
      if (!api?.updateProvider) throw new Error('Runtime 未连接');
      for (const provider of targets) {
        await api.updateProvider({ providerId: provider.providerId, enabled: true });
      }
      await load();
    });
  };

  const handleClearDisabled = () => {
    const targets = providers.filter((item) => !item.enabled);
    if (targets.length === 0) return;
    setDisabledMenuOpen(false);
    void withBusy({ kind: 'toggle-provider', label: '正在清空…' }, async () => {
      for (const provider of targets) {
        await wipeProviderCredentials(provider);
      }
      await load();
    });
  };

  const handleUpdateProvider = useCallback(
    async (providerId: string, patch: Omit<RendererUpdateProviderPayload, 'providerId'>) => {
      const api = bridge();
      if (!api?.updateProvider) {
        showToast('error', 'Runtime 未连接');
        return false;
      }
      try {
        const result = await api.updateProvider({ providerId, ...patch });
        setProviders((current) =>
          current.map((provider) =>
            provider.providerId === providerId ? result.provider : provider,
          ),
        );
        onCatalogChanged?.();
        return true;
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : '保存失败');
        return false;
      }
    },
    [onCatalogChanged, showToast],
  );

  const handleAddCredential = (providerId: string, apiKey: string, label?: string) =>
    withBusy(
      { kind: 'add-credential', targetId: providerId, label: '正在添加密钥…' },
      async () => {
        const api = bridge();
        if (!api?.addProviderCredential) throw new Error('Runtime 未连接');
        await navigator.clipboard.writeText(apiKey);
        await api.addProviderCredential({
          providerId,
          label: label?.trim() || undefined,
        });
        setStatus('密钥已写入安全存储');
        await load();
      },
      'API 密钥已添加',
    );

  const handleRemoveCredential = (providerId: string, credentialRefId: string) =>
    void withBusy(
      { kind: 'remove-credential', targetId: providerId, label: '正在删除密钥…' },
      async () => {
        const api = bridge();
        if (!api?.removeProviderCredential) throw new Error('Runtime 未连接');
        await api.removeProviderCredential({
          providerId: providerId as never,
          credentialRefId: credentialRefId as never,
        });
        setStatus('密钥已删除');
        await load();
      },
    );

  const handleRevealCredential = useCallback(
    async (providerId: string, credentialRefId: string) => {
      const api = bridge();
      if (!api?.revealProviderCredential) {
        showToast('error', 'Runtime 未连接');
        return null;
      }
      try {
        const result = await api.revealProviderCredential({
          providerId: providerId as never,
          credentialRefId: credentialRefId as never,
        });
        return result;
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : '读取密钥失败');
        return null;
      }
    },
    [showToast],
  );

  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null);
  const [connectionTests, setConnectionTests] = useState<Record<string, ConnectionTestState>>({});

  const mergeProviderModels = useCallback((providerId: string, models: ProviderModelSummary[]) => {
    const sorted = [...models].sort((a, b) => a.priority - b.priority);
    setProviderOrders((current) => ({ ...current, [providerId]: sorted }));
    setProviders((current) =>
      current.map((provider) =>
        provider.providerId === providerId ? { ...provider, models: sorted } : provider,
      ),
    );
  }, []);

  const setConnectionTest = useCallback((providerId: string, next: ConnectionTestState) => {
    setConnectionTests((current) => ({ ...current, [providerId]: next }));
  }, []);

  const invalidateConnectionTest = useCallback((providerId: string) => {
    setConnectionTests((current) => {
      if (!current[providerId] || current[providerId]?.status === 'idle') return current;
      return { ...current, [providerId]: { ...EMPTY_CONNECTION_TEST } };
    });
  }, []);

  /** T1 connectivity probe: GET /models style discovery without persisting. */
  const runConnectionTest = useCallback(
    async (providerId: string, baseUrlHint?: string): Promise<ConnectionTestState> => {
      const api = bridge();
      if (!api?.discoverModels) {
        const failed: ConnectionTestState = {
          status: 'error',
          message: 'Runtime 未连接',
        };
        setConnectionTest(providerId, failed);
        return failed;
      }
      setConnectionTest(providerId, { status: 'testing' });
      const startedAt = Date.now();
      try {
        const result = await api.discoverModels({
          providerId: providerId as never,
          persist: false,
        });
        const latencyMs =
          typeof result.latencyMs === 'number'
            ? result.latencyMs
            : Math.max(0, Date.now() - startedAt);
        const provider = providers.find((item) => item.providerId === providerId);
        const ok: ConnectionTestState = {
          status: 'success',
          latencyMs,
          message: `连接成功 · ${latencyMs}ms`,
          testedBaseUrl: baseUrlHint ?? provider?.baseUrl,
        };
        setConnectionTest(providerId, ok);
        // NewMax「测通即摘掉未验证角标」：用「仍然保存」存下来的通道，一旦测通就清掉标记。
        if (provider?.unverified) {
          const updateApi = bridge();
          if (updateApi?.updateProvider) {
            try {
              await updateApi.updateProvider({ providerId, unverified: false });
              void load();
            } catch {
              /* best-effort: the connection itself already passed */
            }
          }
        }
        return ok;
      } catch (error) {
        const latencyMs = Math.max(0, Date.now() - startedAt);
        const failed: ConnectionTestState = {
          status: 'error',
          latencyMs,
          message: formatProviderDiscoveryError(error),
        };
        setConnectionTest(providerId, failed);
        return failed;
      }
    },
    [providers, setConnectionTest, load],
  );

  /** Fetch model catalog preview and open the NewMax import picker. */
  const handleFetchModels = useCallback(
    async (provider: ProviderSummary) => {
      const api = bridge();
      if (!api?.discoverModels) {
        showToast('error', 'Runtime 未连接');
        return;
      }
      setOperation({
        kind: 'discover-models',
        targetId: provider.providerId,
        label: '正在从服务商拉取模型…',
      });
      try {
        const result = await api.discoverModels({
          providerId: provider.providerId as never,
          persist: false,
        });
        const existingIds = new Set(provider.models.map((model) => model.providerModelId));
        const discovered = result.discoveredIds.map((id) => {
          const existing = provider.models.find((model) => model.providerModelId === id);
          return {
            providerModelId: id,
            displayName: existing?.displayName || id,
            alreadyAdded: existingIds.has(id),
          };
        });
        // Pre-check models already in the priority list.
        const selectedIds = discovered
          .filter((item) => item.alreadyAdded)
          .map((item) => item.providerModelId);
        setImportDialog({
          providerId: provider.providerId,
          protocol: (provider.protocol as ProtocolFamily) || 'openai-chat',
          discovered,
          selectedIds,
          query: '',
          applying: false,
        });
      } catch (error) {
        showToast('error', formatProviderDiscoveryError(error));
      } finally {
        setOperation(null);
      }
    },
    [showToast],
  );

  const handleApplyImport = useCallback(
    async (dialog: ImportDialogState) => {
      const api = bridge();
      if (!api?.addModels || !api?.removeProviderModel || !api?.setModelPriorities) {
        showToast('error', 'Runtime 未连接');
        return;
      }
      const providerId = dialog.providerId;
      // The create flow has no provider yet — it is handled by
      // handleApplyCreateImport instead.
      if (!providerId) return;
      const provider = providers.find((item) => item.providerId === providerId);
      if (!provider) return;

      setImportDialog((current) => (current ? { ...current, applying: true } : current));
      setOperation({
        kind: 'import-models',
        targetId: providerId,
        label: '正在应用到优先级…',
      });
      try {
        const selected = new Set(dialog.selectedIds);
        const currentModels = [...provider.models].sort((a, b) => a.priority - b.priority);
        const toRemove = currentModels.filter((model) => !selected.has(model.providerModelId));
        const alreadySelected = currentModels.filter((model) =>
          selected.has(model.providerModelId),
        );
        const toAdd = dialog.discovered.filter(
          (item) =>
            selected.has(item.providerModelId) &&
            !currentModels.some((model) => model.providerModelId === item.providerModelId),
        );

        for (const model of toRemove) {
          await api.removeProviderModel({
            providerId: providerId as never,
            modelId: model.modelId as never,
          });
        }
        if (toAdd.length > 0) {
          await api.addModels({
            providerId: providerId as never,
            protocol: dialog.protocol as ProtocolFamily,
            models: toAdd.map((item) => ({
              providerModelId: item.providerModelId,
              displayName: item.displayName || item.providerModelId,
            })),
          });
        }

        // Re-read and re-order: keep previously selected order, append new ones.
        const listed = await api.listProviders({});
        const nextProviders = [...listed.providers].sort((a, b) => a.sortOrder - b.sortOrder);
        const refreshed = nextProviders.find((item) => item.providerId === providerId);
        if (refreshed) {
          const byProviderModelId = new Map(
            refreshed.models.map((model) => [model.providerModelId, model]),
          );
          const orderedIds = [
            ...alreadySelected.map((model) => model.providerModelId),
            ...toAdd.map((item) => item.providerModelId),
          ];
          const orderedModels = orderedIds
            .map((id) => byProviderModelId.get(id))
            .filter((model): model is ProviderModelSummary => Boolean(model));
          if (orderedModels.length > 0) {
            const result = await api.setModelPriorities({
              providerId: providerId as never,
              entries: orderedModels.map((model) => ({
                modelId: model.modelId as never,
                credentialRefId: (model.credentialRefId ?? undefined) as never,
              })),
            });
            // Apply priorities onto the freshly listed tree.
            setProviders(
              nextProviders.map((item) =>
                item.providerId === providerId ? { ...item, models: result.models } : item,
              ),
            );
            setProviderOrders((current) => ({
              ...current,
              [providerId]: result.models,
            }));
          } else {
            setProviders(
              nextProviders.map((item) =>
                item.providerId === providerId ? { ...item, models: [] } : item,
              ),
            );
            setProviderOrders((current) => ({ ...current, [providerId]: [] }));
          }
        } else {
          setProviders(nextProviders);
        }
        setImportDialog(null);
        onCatalogChanged?.();
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : '应用到优先级失败');
        setImportDialog((current) => (current ? { ...current, applying: false } : current));
      } finally {
        setOperation(null);
      }
    },
    [onCatalogChanged, providers, showToast],
  );

  const handleAddModel = (
    providerId: string,
    protocol: ProtocolFamily,
    providerModelId: string,
    displayName?: string,
    contextWindow?: number,
  ) =>
    withBusy(
      { kind: 'add-model', targetId: providerId, label: '正在添加模型…' },
      async () => {
        const api = bridge();
        if (!api?.addModels) throw new Error('Runtime 未连接');
        const result = await api.addModels({
          providerId: providerId as never,
          protocol,
          models: [
            {
              providerModelId,
              displayName: displayName || providerModelId,
              contextWindow,
            },
          ],
        });
        mergeProviderModels(providerId, result.models);
        setStatus(`已添加模型 ${providerModelId}`);
      },
    );

  const handleRemoveModel = (providerId: string, modelId: string) =>
    void withBusy(
      { kind: 'remove-model', targetId: providerId, label: '正在移除模型…' },
      async () => {
        const api = bridge();
        if (!api?.removeProviderModel || !api?.setModelPriorities)
          throw new Error('Runtime 未连接');
        await api.removeProviderModel({
          providerId: providerId as never,
          modelId: modelId as never,
        });
        const provider = providers.find((item) => item.providerId === providerId);
        const remaining = (provider?.models ?? [])
          .filter((model) => model.modelId !== modelId)
          .sort((a, b) => a.priority - b.priority);
        if (remaining.length > 0) {
          const result = await api.setModelPriorities({
            providerId: providerId as never,
            entries: remaining.map((model) => ({
              modelId: model.modelId as never,
              credentialRefId: (model.credentialRefId ?? undefined) as never,
            })),
          });
          mergeProviderModels(providerId, result.models);
        } else {
          mergeProviderModels(providerId, []);
        }
        setStatus('模型已移除');
      },
    );

  const handleUpdateModelContext = (
    providerId: string,
    modelId: string,
    contextWindow: number | null,
  ) =>
    void withBusy(
      { kind: 'update-model', targetId: providerId, label: '正在更新上下文…' },
      async () => {
        const api = bridge();
        if (!api?.updateModel) throw new Error('Runtime 未连接或不支持 updateModel');
        const result = await api.updateModel({
          providerId: providerId as never,
          modelId: modelId as never,
          contextWindow,
        });
        const provider = providers.find((item) => item.providerId === providerId);
        if (provider) {
          const nextModels = provider.models.map((model) =>
            model.modelId === modelId ? { ...model, ...result.model } : model,
          );
          mergeProviderModels(providerId, nextModels);
        }
        setStatus('上下文窗口已更新');
        onCatalogChanged?.();
      },
    );

  const handleProbeModelCapabilities = useCallback(
    async (providerId: string, modelId: string): Promise<CapabilityProbeSuggestion> => {
      const api = bridge();
      if (!api?.probeCapabilities) throw new Error('Runtime 未连接或不支持能力检测');
      const result = await api.probeCapabilities({
        providerId: providerId as never,
        modelId: modelId as never,
      });
      const suggestion = result.suggestions.find((item) => item.modelId === modelId);
      if (!suggestion) throw new Error('没有返回该模型的能力检测结果');
      const provider = providers.find((item) => item.providerId === providerId);
      if (provider) {
        mergeProviderModels(
          providerId,
          provider.models.map((model) =>
            model.modelId === modelId
              ? {
                  ...model,
                  capabilities: [...suggestion.capabilities],
                  capabilitiesConfirmed: false,
                }
              : model,
          ),
        );
      }
      onCatalogChanged?.();
      return suggestion;
    },
    [mergeProviderModels, onCatalogChanged, providers, showToast],
  );

  const handleConfirmModelCapabilities = useCallback(
    async (
      providerId: string,
      modelId: string,
      capabilities: ModelCapabilityTag[],
    ): Promise<ProviderModelSummary> => {
      const api = bridge();
      if (!api?.confirmCapabilities) throw new Error('Runtime 未连接或不支持保存模型能力');
      try {
        const result = await api.confirmCapabilities({
          modelId: modelId as never,
          capabilities,
          confirmed: true,
        });
        const provider = providers.find((item) => item.providerId === providerId);
        if (provider) {
          mergeProviderModels(
            providerId,
            provider.models.map((model) =>
              model.modelId === modelId ? { ...model, ...result.model } : model,
            ),
          );
        }
        onCatalogChanged?.();
        return result.model;
      } catch (error) {
        showToast('error', describeCapabilityDialogError(error, '保存模型能力失败'));
        throw error;
      }
    },
    [mergeProviderModels, onCatalogChanged, providers, showToast],
  );

  const handleReorderModels = (provider: ProviderSummary, ordered: ProviderModelSummary[]) => {
    const previous =
      providerOrders[provider.providerId] ??
      [...provider.models].sort((a, b) => a.priority - b.priority);
    const optimistic = ordered.map((model, index) => ({ ...model, priority: index }));
    // Optimistic local update only — never full reload (avoids jump-to-top flash).
    mergeProviderModels(provider.providerId, optimistic);
    void (async () => {
      const api = bridge();
      if (!api?.setModelPriorities) {
        mergeProviderModels(provider.providerId, previous);
        showToast('error', 'Runtime 未连接');
        return;
      }
      try {
        const result = await api.setModelPriorities({
          providerId: provider.providerId as never,
          entries: optimistic.map((model) => ({
            modelId: model.modelId as never,
            credentialRefId: (model.credentialRefId ?? undefined) as never,
          })),
        });
        mergeProviderModels(provider.providerId, result.models);
        onCatalogChanged?.();
      } catch (error) {
        mergeProviderModels(provider.providerId, previous);
        showToast('error', error instanceof Error ? error.message : '调整模型优先级失败');
      }
    })();
  };

  const handlePinCredential = (
    provider: ProviderSummary,
    modelId: string,
    credentialRefId: string | null,
  ) =>
    void withBusy(
      { kind: 'pin-credential', targetId: provider.providerId, label: '正在绑定密钥…' },
      async () => {
        const api = bridge();
        if (!api?.setModelPriorities) throw new Error('Runtime 未连接');
        const ordered = [...provider.models].sort((a, b) => a.priority - b.priority);
        const result = await api.setModelPriorities({
          providerId: provider.providerId as never,
          entries: ordered.map((m) => ({
            modelId: m.modelId as never,
            credentialRefId: (m.modelId === modelId
              ? credentialRefId
              : (m.credentialRefId ?? undefined)) as never,
          })),
        });
        mergeProviderModels(provider.providerId, result.models);
        setStatus(credentialRefId ? '模型已绑定密钥' : '已清除模型密钥绑定');
      },
    );

  const handleSaveVision = (next: VisionFallbackSetting) => {
    const previous = visionFallback;
    setVisionFallback(next);
    void withBusy(
      { kind: 'save-preference', label: '正在保存图片识别 Fallback…' },
      async () => {
        const api = bridge();
        if (!api?.setSetting) throw new Error('Runtime 未连接');
        try {
          await api.setSetting({ key: 'vision-fallback', value: next });
        } catch (error) {
          setVisionFallback(previous);
          throw error;
        }
      },
    );
  };

  const handleSavePlanAct = (next: PlanActSetting) => {
    const previous = planAct;
    setPlanAct(next);
    void withBusy(
      { kind: 'save-preference', label: '正在保存规划与执行模型…' },
      async () => {
        const api = bridge();
        if (!api?.setSetting) throw new Error('Runtime 未连接');
        try {
          await api.setSetting({ key: 'plan-act', value: next });
        } catch (error) {
          setPlanAct(previous);
          throw error;
        }
      },
    );
  };

  const handleSaveModelConfigCloudSync = (enabled: boolean) => {
    const previous = modelConfigCloudSync;
    setModelConfigCloudSync(enabled);
    void withBusy(
      { kind: 'save-preference', label: '正在保存模型配置云同步…' },
      async () => {
        const api = bridge();
        if (!api?.setSetting) throw new Error('Runtime 未连接');
        try {
          await api.setSetting({ key: 'model-config-cloud-sync', value: enabled });
        } catch (error) {
          setModelConfigCloudSync(previous);
          throw error;
        }
      },
    );
  };

  const createDraftDirty =
    showCreate &&
    createStep === 'form' &&
    (Boolean(createDraft.name.trim()) ||
      createDraft.baseUrl !== EMPTY_CREATE.baseUrl ||
      createDraft.protocol !== EMPTY_CREATE.protocol ||
      Boolean(createDraft.apiKey.trim()));
  const [detailDraftDirty, setDetailDraftDirty] = useState(false);
  /** credentialRefId → staged plaintext secret (not yet written to secure-store). */
  const [stagedSecrets, setStagedSecrets] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const hasCredentialDraft = Object.keys(stagedSecrets).length > 0;
  const hasTransientDraft = createDraftDirty || detailDraftDirty || hasCredentialDraft;

  useEffect(() => {
    onDirtyChange?.(hasTransientDraft);
    return () => onDirtyChange?.(false);
  }, [hasTransientDraft, onDirtyChange]);

  const stageCredentialSecret = useCallback((credentialRefId: string, apiKey: string) => {
    const trimmed = apiKey.trim();
    setStagedSecrets((current) => {
      if (!trimmed) {
        if (!(credentialRefId in current)) return current;
        const next = { ...current };
        delete next[credentialRefId];
        return next;
      }
      if (current[credentialRefId] === trimmed) return current;
      return { ...current, [credentialRefId]: trimmed };
    });
  }, []);

  const clearStagedSecrets = useCallback(() => {
    setStagedSecrets({});
  }, []);

  const completeSettings = useCallback(async () => {
    if (completing) return false;
    const api = bridge();
    if (!api) {
      showToast('error', 'Runtime 未连接');
      return false;
    }
    setCompleting(true);
    try {
      // 1) Commit staged credential secrets first.
      const stagedEntries = Object.entries(stagedSecrets);
      let secretsChanged = false;
      for (const [credentialRefId, apiKey] of stagedEntries) {
        const owner = providers.find((provider) =>
          provider.credentials.some((credential) => credential.credentialRefId === credentialRefId),
        );
        if (!owner) continue;
        if (!api.updateProviderCredential) throw new Error('Runtime 未连接');
        await navigator.clipboard.writeText(apiKey);
        await api.updateProviderCredential({
          providerId: owner.providerId,
          credentialRefId,
          rotateCredentialFromClipboard: true,
        });
        secretsChanged = true;
        invalidateConnectionTest(owner.providerId);
      }
      if (secretsChanged) {
        clearStagedSecrets();
        await load();
      }

      // 2) Connection test: skip only when last test succeeded for same Base URL.
      const target =
        providers.find((provider) => provider.providerId === selectedId) ??
        providers.find((provider) => provider.enabled) ??
        providers[0];
      if (!target) {
        showToast('error', '请先添加模型源');
        return false;
      }
      const lastTest = connectionTests[target.providerId];
      const baseUrlMatches =
        lastTest?.status === 'success' &&
        lastTest.testedBaseUrl === target.baseUrl &&
        !secretsChanged;
      if (!baseUrlMatches) {
        const result = await runConnectionTest(target.providerId, target.baseUrl);
        if (result.status !== 'success') {
          showToast('error', result.message || '连接测试失败');
          return false;
        }
      }
      onCatalogChanged?.();
      return true;
    } catch (error) {
      showToast('error', formatRuntimeIpcError(error, '连接测试失败'));
      return false;
    } finally {
      setCompleting(false);
    }
  }, [
    clearStagedSecrets,
    completing,
    connectionTests,
    invalidateConnectionTest,
    load,
    onCatalogChanged,
    providers,
    runConnectionTest,
    selectedId,
    showToast,
    stagedSecrets,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      complete: completeSettings,
      startCreate: openCreateCatalog,
    }),
    [completeSettings, openCreateCatalog],
  );

  useEffect(() => {
    const selected = providers.find((item) => item.providerId === selectedId);
    if (
      selected &&
      !selected.enabled &&
      isConfiguredProvider(selected) &&
      isTextGenerationProvider(selected) &&
      detailView === 'provider' &&
      !showCreate
    ) {
      setDisabledMenuOpen(true);
    }
  }, [detailView, providers, selectedId, showCreate]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-faint">
        <Loader2 size={16} className="animate-spin" /> 加载模型源…
      </div>
    );
  }

  const listedProviders = providers.filter(
    (provider) => isConfiguredProvider(provider) && isTextGenerationProvider(provider),
  );
  const enabledProviders = listedProviders.filter((provider) => provider.enabled);
  const disabledProviders = listedProviders.filter((provider) => !provider.enabled);
  const mediaCopy =
    modelTab !== 'text' && modelTab !== 'usage' && modelTab !== 'image'
      ? MEDIA_TAB_EMPTY[modelTab]
      : null;

  return (
    <div className="model-settings-root flex h-full min-h-0 flex-col">
      <div className="model-settings-tabs">
        <DsTabBar
          className="model-settings-tabs__rail"
          aria-label="模型类型"
          value={modelTab}
          onChange={(value) => setModelTab(value as ModelTab)}
          items={MODEL_TABS.map(({ id, label }) => ({ value: id, label }))}
        />
        {modelTab === 'text' || modelTab === 'image' ? (
          <span className="model-settings-guide">
            如果配置遇到问题，可以查阅<span>配置指南</span>。
          </span>
        ) : null}
        {modelTab === 'usage' ? (
          <UsageRangeControls
            sinceDays={usageSinceDays}
            refreshing={usageRefreshing}
            onChange={setUsageSinceDays}
            onRefresh={() => setUsageReloadToken((token) => token + 1)}
          />
        ) : null}
      </div>

      <div className="model-settings-tab-stack">
          <KeepAliveLayer
            active={modelTab === 'text'}
            className="model-settings-tab-layer"
          >
          <div className="model-settings-workspace flex min-h-0 flex-1">
            <aside className="model-enabled-list">
              <div className="model-enabled-list__header">
                <div>
                  <p>启用的模型</p>
                  <span>拖拽排序，首位为默认</span>
                </div>
                <button
                  type="button"
                  title="添加模型"
                  disabled={operation?.kind === 'create-provider'}
                  onClick={() => {
                    openCreateCatalog();
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>

              <div className="model-enabled-list__body">
                {enabledProviders.length === 0 ? null : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleProviderDragStart}
                    onDragCancel={handleProviderDragCancel}
                    onDragEnd={handleProviderDragEnd}
                  >
                    <SortableContext
                      items={enabledProviders.map((provider) => provider.providerId)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul>
                        {enabledProviders.map((provider, index) => (
                          <SortableProviderRow
                            key={provider.providerId}
                            provider={provider}
                            index={index}
                            active={
                              detailView === 'provider' &&
                              provider.providerId === selectedId &&
                              !showCreate
                            }
                            busy={providerListBusy}
                            onSelect={() => {
                              setShowCreate(false);
                              resetCreateState();
                              setDetailView('provider');
                              setSelectedId(provider.providerId);
                              setLastSelectedId(provider.providerId);
                            }}
                            onDisable={() => handleToggleEnabled(provider, false)}
                            onRemove={() => handleRemoveProvider(provider)}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                    {typeof document !== 'undefined'
                      ? createPortal(
                          <DragOverlay
                            dropAnimation={{
                              duration: 180,
                              easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                            }}
                            zIndex={10050}
                          >
                            {activeProviderId ? (
                              <ProviderRowPreview
                                provider={
                                  enabledProviders.find(
                                    (provider) => provider.providerId === activeProviderId,
                                  ) ?? null
                                }
                              />
                            ) : null}
                          </DragOverlay>,
                          document.body,
                        )
                      : null}
                  </DndContext>
                )}
                <button
                  type="button"
                  className={clsx('model-enabled-list__add', showCreate && 'is-active')}
                  disabled={operation?.kind === 'create-provider'}
                  onClick={() => {
                    openCreateCatalog();
                  }}
                >
                  <Plus size={13} /> 添加模型
                </button>
                {disabledProviders.length > 0 ? (
                  <div className="model-disabled-list">
                    <div className={clsx('model-disabled-list__bar', disabledMenuOpen && 'is-open')}>
                      <button
                        type="button"
                        className="model-disabled-list__trigger"
                        aria-expanded={disabledMenuOpen}
                        data-testid="model-settings-disabled-menu-trigger"
                        onClick={() => setDisabledMenuOpen((open) => !open)}
                      >
                        <ChevronDown size={12} className="model-disabled-list__chevron" aria-hidden="true" />
                        <span>已停用模型</span>
                        <span className="model-disabled-list__count">{disabledProviders.length}</span>
                      </button>
                      <ModelOverflowMenu
                        ariaLabel="已停用模型操作"
                        triggerClassName="model-disabled-list__more"
                        triggerTestId="model-settings-disabled-action-menu-trigger"
                        triggerSize={14}
                        items={[
                          { label: '启用全部', onSelect: handleEnableAllDisabled },
                          { label: '清空', danger: true, onSelect: handleClearDisabled },
                        ]}
                      />
                    </div>
                    {disabledMenuOpen ? (
                      <div
                        className="model-disabled-list__items"
                        data-testid="model-settings-disabled-menu-list"
                      >
                        {disabledProviders.map((provider) => (
                          <DisabledProviderRow
                            key={provider.providerId}
                            provider={provider}
                            active={
                              detailView === 'provider' &&
                              provider.providerId === selectedId &&
                              !showCreate
                            }
                            busy={providerListBusy}
                            onSelect={() => {
                              setDisabledMenuOpen(true);
                              setShowCreate(false);
                              resetCreateState();
                              setDetailView('provider');
                              setSelectedId(provider.providerId);
                              setLastSelectedId(provider.providerId);
                            }}
                            onEnable={() => handleToggleEnabled(provider, true)}
                            onRemove={() => handleRemoveProvider(provider)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="model-enabled-list__secondary">
                <button
                  type="button"
                  className={detailView === 'vision' ? 'is-active' : undefined}
                  aria-pressed={detailView === 'vision'}
                  onClick={() => {
                    setShowCreate(false);
                    resetCreateState();
                    setDetailView('vision');
                  }}
                >
                  <Image size={13} />
                  <span>图片识别 Fallback</span>
                </button>
                <button
                  type="button"
                  className={detailView === 'plan-act' ? 'is-active' : undefined}
                  aria-pressed={detailView === 'plan-act'}
                  data-testid="model-strategy-plan-act"
                  onClick={() => {
                    setShowCreate(false);
                    resetCreateState();
                    setDetailView('plan-act');
                  }}
                >
                  <Sparkles size={13} />
                  <span>规划 & 执行模型</span>
                </button>
                <button
                  type="button"
                  className={detailView === 'cloud-sync' ? 'is-active' : undefined}
                  aria-pressed={detailView === 'cloud-sync'}
                  data-testid="model-strategy-cloud-sync"
                  onClick={() => {
                    setShowCreate(false);
                    resetCreateState();
                    setDetailView('cloud-sync');
                  }}
                >
                  <Cloud size={13} />
                  <span>模型配置云同步</span>
                </button>
              </div>
            </aside>

            {/* Right: provider detail / create / special model strategies */}
            <div className="model-settings-detail">
              <div
                key={
                  showCreate
                    ? `create-provider-${createStep}`
                    : detailView === 'provider'
                      ? (selected?.providerId ?? 'empty-provider')
                      : detailView
                }
                className="model-settings-detail__transition"
              >
                {showCreate ? (
                  createStep === 'catalog' ? (
                    <ProviderCatalog
                      category={catalogCategory}
                      onCategoryChange={setCatalogCategory}
                      onSelect={(item) => {
                        if (item.action === 'cc-switch') {
                          void openCcSwitchImport();
                          return;
                        }
                        openProviderTemplate(item);
                      }}
                    />
                  ) : createStep === 'cc-switch' ? (
                    <CcSwitchImportPanel
                      preview={ccSwitchPreview}
                      selectedIds={selectedCcSwitchIds}
                      loading={ccSwitchLoading}
                      importing={ccSwitchImporting}
                      onBack={() => {
                        setCreateStep('catalog');
                        setCcSwitchPreview(null);
                        setSelectedCcSwitchIds([]);
                      }}
                      onCancel={cancelCreateFlow}
                      onRetry={() => void openCcSwitchImport()}
                      onToggle={(sourceId) => {
                        setSelectedCcSwitchIds((current) =>
                          current.includes(sourceId)
                            ? current.filter((id) => id !== sourceId)
                            : [...current, sourceId],
                        );
                      }}
                      onToggleAll={(checked) => {
                        setSelectedCcSwitchIds(
                          checked
                            ? (ccSwitchPreview?.items
                                .filter((item) => item.importable)
                                .map((item) => item.sourceId) ?? [])
                            : [],
                        );
                      }}
                      onImport={() => void handleCcSwitchImport()}
                    />
                  ) : (
                    <CreateProviderForm
                      draft={createDraft}
                      template={createTemplate ?? undefined}
                      busy={operation?.kind === 'create-provider'}
                      onChange={updateCreateDraft}
                      onDiscover={() => handleDiscoverCreateModels()}
                      onTest={() => handleCreate()}
                      onSaveUnverified={() => handleSaveUnverified()}
                      testResult={createTestResult}
                      onBackToCatalog={() => {
                        setCreateStep('catalog');
                        setCreateDraft(EMPTY_CREATE);
                        setCreateTemplate(null);
                      }}
                    />
                  )
                ) : detailView === 'vision' ? (
                  <VisionFallbackPanel
                    allModels={allModels}
                    value={visionFallback}
                    busy={operation?.kind === 'save-preference'}
                    onChange={handleSaveVision}
                  />
                ) : detailView === 'plan-act' ? (
                  <PlanActPanel
                    allModels={allModels}
                    value={planAct}
                    busy={operation?.kind === 'save-preference'}
                    onChange={handleSavePlanAct}
                  />
                ) : detailView === 'cloud-sync' ? (
                  <ModelCloudSyncPanel
                    enabled={modelConfigCloudSync}
                    busy={operation?.kind === 'save-preference'}
                    onChange={handleSaveModelConfigCloudSync}
                  />
                ) : selected ? (
                  <ProviderDetail
                    provider={selected}
                    operation={operation}
                    dialog={dialog}
                    connectionTest={connectionTests[selected.providerId] ?? EMPTY_CONNECTION_TEST}
                    onUpdateProvider={async (providerId, patch) => {
                      const ok = await handleUpdateProvider(providerId, patch);
                      if (ok && patch.baseUrl !== undefined) {
                        invalidateConnectionTest(providerId);
                      }
                      return ok;
                    }}
                    onAddCredential={handleAddCredential}
                    onRemoveCredential={handleRemoveCredential}
                    onRevealCredential={handleRevealCredential}
                    onStageCredentialSecret={(credentialRefId, apiKey) => {
                      stageCredentialSecret(credentialRefId, apiKey);
                      if (selectedId) invalidateConnectionTest(selectedId);
                    }}
                    stagedSecrets={stagedSecrets}
                    onFetchModels={() => void handleFetchModels(selected)}
                    onTestConnection={() =>
                      void runConnectionTest(selected.providerId, selected.baseUrl)
                    }
                    onAddModel={handleAddModel}
                    onRemoveModel={handleRemoveModel}
                    onUpdateModelContext={handleUpdateModelContext}
                    onProbeModelCapabilities={handleProbeModelCapabilities}
                    onConfirmModelCapabilities={handleConfirmModelCapabilities}
                    onReorderModels={handleReorderModels}
                    onTransientDraftChange={setDetailDraftDirty}
                    onPinCredential={handlePinCredential}
                  />
                ) : (
                  <EmptyDetail onAdd={openCreateCatalog} />
                )}
              </div>
            </div>
          </div>
          </KeepAliveLayer>
          <KeepAliveLayer
            active={modelTab === 'image'}
            className="model-settings-tab-layer"
          >
            <ImageGenerationSettings onCatalogChanged={onCatalogChanged} />
          </KeepAliveLayer>
          <KeepAliveLayer
            active={modelTab === 'usage'}
            className="model-settings-tab-layer"
          >
            <UsageSettings
              sinceDays={usageSinceDays}
              reloadToken={usageReloadToken}
              onRefreshingChange={setUsageRefreshing}
            />
          </KeepAliveLayer>
          {mediaCopy ? (
            <div key={modelTab} className="model-settings-tab-panel model-settings-unavailable">
              <p>{mediaCopy.description}</p>
              <span>{mediaCopy.empty}</span>
            </div>
          ) : null}
        </div>
      {importDialog ? (
        <ImportModelsDialog
          dialog={importDialog}
          onClose={() => setImportDialog(null)}
          onChange={setImportDialog}
          onApply={() =>
            void (importDialog.target === 'create'
              ? handleApplyCreateImport(importDialog)
              : handleApplyImport(importDialog))
          }
        />
      ) : null}
    </div>
  );
});

function ProviderCatalog({
  category,
  onCategoryChange,
  onSelect,
}: {
  category: ProviderCatalogCategory;
  onCategoryChange: (category: ProviderCatalogCategory) => void;
  onSelect: (item: ProviderCatalogItem) => void;
}) {
  const items = PROVIDER_CATALOG[category];
  return (
    <section className="model-provider-catalog" aria-label="添加模型">
      <DsTabBar
        className="model-provider-catalog__tabs"
        aria-label="模型服务商分类"
        stretch
        value={category}
        onChange={onCategoryChange}
        items={PROVIDER_CATALOG_CATEGORIES.map((item) => ({
          value: item.id,
          label: item.label,
        }))}
      />

      <div className="model-provider-catalog__grid" role="tabpanel">
        {items.map((item) => {
          const templateReady =
            item.action !== 'form' ||
            item.endpointMode === 'custom' ||
            Boolean(item.draft?.baseUrl && item.draft.baseUrl !== 'https://');
          return (
            <button
              key={`${category}-${item.id}`}
              type="button"
              className={clsx('model-provider-card', item.variant === 'flat' && 'is-flat')}
              disabled={!templateReady}
              title={
                templateReady ? undefined : '该服务商暂未内置固定连接地址，请使用“自定义供应商”添加'
              }
              onClick={() => onSelect(item)}
            >
              <ProviderBrandIcon providerId={item.id} providerName={item.name} />
              <span className="model-provider-card__copy">
                <strong>
                  {item.name}
                  {item.badge ? (
                    <span className="model-provider-card__badge">{item.badge}</span>
                  ) : null}
                  {item.status ? (
                    <span className="model-provider-card__badge is-status">{item.status}</span>
                  ) : null}
                </strong>
                <small>
                  {templateReady ? item.description : `${item.description} · 固定连接地址待接入`}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const PROVIDER_BRAND_GLYPHS: Record<string, string> = {
  'minimax-token-plan': 'M',
  'minimax-api': 'M',
  'kimi-coding': 'K',
  moonshot: '◐',
  'zhipu-coding': 'Z',
  'zhipu-api': 'Z',
  deepseek: 'D',
  'bailian-coding': 'Q',
  'bailian-token-plan': 'Q',
  'bailian-api': 'Q',
  stepfun: 'S',
  bailing: 'B',
  longcat: 'L',
  'xiaomi-mimo': 'M',
  'volcengine-ark': 'V',
  'siliconflow-cn': 'S',
  modelscope: 'M',
  gptnb: 'G',
  pipellm: 'P',
  'anthropic-gateway': 'A',
  openai: 'AI',
  'chatgpt-subscription': 'C',
  supergrok: 'G',
  antigravity: 'A',
  'gemini-api': 'G',
  'opencode-go': 'O',
  'opencode-go-anthropic': 'O',
  anthropic: 'A',
  'minimax-global': 'M',
  'z-ai': 'Z',
  openrouter: 'O',
  'siliconflow-global': 'S',
  ollama: 'O',
  'lm-studio': 'LM',
};

/**
 * Provider avatar in the catalog / provider list.
 *
 * Order of preference: an action glyph for the two non-brand entries → the real
 * upstream brand logo (brand-icons.ts) → the letter fallback. Providers without
 * an official logo keep the letter rather than a made-up mark.
 */
function ProviderBrandIcon({
  providerId,
  providerName,
  testIdPrefix = 'provider-icon',
}: {
  providerId: string;
  providerName: string;
  testIdPrefix?: string;
}) {
  const specialIcon =
    providerId === 'custom' ? (
      <Settings2 size={16} />
    ) : providerId === 'cc-switch' ? (
      <Download size={16} />
    ) : null;
  const brandLogo = specialIcon
    ? undefined
    : (resolveProviderBrandLogo(providerId) ?? resolveProviderBrandLogoByName(providerName));
  return (
    <span
      className={clsx(
        'model-provider-card__icon model-provider-brand-icon',
        brandLogo && 'model-provider-brand-icon--logo',
      )}
      data-brand={providerId}
      data-brand-logo={brandLogo ? 'true' : undefined}
      data-testid={`${testIdPrefix}-${providerId}`}
      aria-hidden="true"
    >
      {specialIcon ??
        (brandLogo ? (
          <BrandLogoMark logo={brandLogo} size={16} />
        ) : (
          (PROVIDER_BRAND_GLYPHS[providerId] ?? providerName.slice(0, 1).toUpperCase())
        ))}
    </span>
  );
}

function CcSwitchImportPanel({
  preview,
  selectedIds,
  loading,
  importing,
  onBack,
  onCancel,
  onRetry,
  onToggle,
  onToggleAll,
  onImport,
}: {
  preview: PreviewCcSwitchImportResponse | null;
  selectedIds: string[];
  loading: boolean;
  importing: boolean;
  onBack: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onToggle: (sourceId: string) => void;
  onToggleAll: (checked: boolean) => void;
  onImport: () => void;
}) {
  const importableItems = preview?.items.filter((item) => item.importable) ?? [];
  const allSelected =
    importableItems.length > 0 &&
    importableItems.every((item) => selectedIds.includes(item.sourceId));

  return (
    <section className="model-cc-switch" aria-labelledby="model-cc-switch-title">
      <header className="model-provider-form__header">
        <button
          type="button"
          className="model-provider-form__back"
          aria-label="返回列表"
          onClick={onBack}
          disabled={importing}
        >
          <ArrowLeft size={12} />
          返回列表
        </button>
        <div>
          <h2 id="model-cc-switch-title">从 CC Switch 导入</h2>
          <p>选择要迁移到 SYNC-THINK 的本机供应商配置。</p>
        </div>
        <button type="button" aria-label="取消添加模型源" onClick={onCancel} disabled={importing}>
          <X size={16} />
        </button>
      </header>

      {loading ? (
        <div className="model-cc-switch__loading" role="status">
          <Loader2 size={17} className="model-settings-spin" />
          正在读取 CC Switch 配置…
        </div>
      ) : preview ? (
        <>
          <div className="model-cc-switch__summary">
            <div>
              <strong>CC Switch 配置</strong>
              <span title={preview.dbPath}>{preview.dbPath}</span>
            </div>
            <label>
              <input
                type="checkbox"
                aria-label="全选可导入配置"
                checked={allSelected}
                disabled={importableItems.length === 0 || importing}
                onChange={(event) => onToggleAll(event.target.checked)}
              />
              全选可导入项
            </label>
          </div>

          <div className="model-cc-switch__list">
            {preview.items.length > 0 ? (
              preview.items.map((item) => (
                <CcSwitchImportRow
                  key={item.sourceId}
                  item={item}
                  checked={selectedIds.includes(item.sourceId)}
                  disabled={importing}
                  onToggle={() => onToggle(item.sourceId)}
                />
              ))
            ) : (
              <div className="model-cc-switch__empty">
                <Database size={22} />
                <strong>没有找到可读取的配置</strong>
                <span>确认本机已安装并配置 CC Switch 后重试。</span>
              </div>
            )}
          </div>

          <footer className="model-cc-switch__footer">
            <span>
              可导入 {preview.importableCount} 项 · 跳过 {preview.skippedCount} 项 · 已选{' '}
              {selectedIds.length} 项
            </span>
            <div>
              <button type="button" onClick={onCancel} disabled={importing}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={selectedIds.length === 0 || importing}
                onClick={onImport}
              >
                {importing ? <Loader2 size={14} className="model-settings-spin" /> : null}
                {importing ? '正在导入…' : `导入 ${selectedIds.length} 项`}
              </button>
            </div>
          </footer>
        </>
      ) : (
        <div className="model-cc-switch__empty">
          <Database size={22} />
          <strong>CC Switch 配置读取失败</strong>
          <span>检查本机数据库状态后可以再次尝试。</span>
          <button type="button" onClick={onRetry}>
            <RefreshCw size={13} /> 重新读取
          </button>
        </div>
      )}
    </section>
  );
}

function CcSwitchImportRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: CcSwitchImportPreviewItem;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const visibleModels = item.models.slice(0, 3);
  const hiddenModelCount = Math.max(0, item.models.length - visibleModels.length);

  return (
    <label
      className={clsx(
        'model-cc-switch__item',
        checked && 'is-selected',
        !item.importable && 'is-disabled',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || !item.importable}
        onChange={onToggle}
      />
      <span className="model-provider-card__icon" aria-hidden="true">
        {item.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="model-cc-switch__item-copy">
        <strong>{item.name}</strong>
        <small>
          {item.baseUrl ?? '未配置 Base URL'} · {item.models.length} 个模型 ·{' '}
          {item.hasSecret ? '包含密钥' : '缺少密钥'}
        </small>
        {visibleModels.length > 0 ? (
          <span className="model-cc-switch__item-models" title={item.models.join('\n')}>
            {visibleModels.join(' · ')}
            {hiddenModelCount > 0 ? ` · +${hiddenModelCount}` : ''}
          </span>
        ) : null}
        {item.warnings.length > 0 ? <em>{item.warnings.join('；')}</em> : null}
      </span>
    </label>
  );
}

/**
 * Model row for the create form: same visual language as SortableModelRow on the
 * detail page, but backed by the pure draft array — no providerId, no
 * credentials, no persisted context window.
 */
function DraftModelRow({
  model,
  index,
  busy,
  onRemove,
}: {
  model: DraftModel;
  index: number;
  busy: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.providerModelId,
    disabled: busy,
  });
  const title = model.displayName || model.providerModelId;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('model-priority-row', isDragging && 'is-dragging')}
    >
      <button
        type="button"
        className="model-priority-row__grip"
        disabled={busy}
        title="拖拽调整优先级"
        aria-label={`拖拽 ${title} 调整优先级`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <div className="model-priority-row__main">
        <span className={clsx('model-priority-row__rank', index === 0 && 'is-primary')}>
          {modelRankLabel(index)}
        </span>
        <span className="model-priority-row__copy">
          <span title={title}>{title}</span>
        </span>
      </div>
      <div className="model-priority-row__actions">
        <button
          type="button"
          className="is-danger"
          title="删除模型"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function CreateProviderForm({
  draft,
  template,
  busy,
  onChange,
  onDiscover,
  onTest,
  onSaveUnverified,
  onBackToCatalog,
  testResult,
}: {
  draft: CreateDraft;
  template?: ProviderCatalogItem;
  busy: boolean;
  onChange: (d: CreateDraft) => void;
  onDiscover: () => void;
  onTest: () => void;
  onSaveUnverified: () => void;
  onBackToCatalog: () => void;
  testResult: { status: 'idle' | 'testing' | 'success' | 'error'; message: string };
}) {
  const isCustomEndpoint = template?.endpointMode === 'custom';
  const isCustomProvider = template?.id === 'custom';
  const [apiFormatManual, setApiFormatManual] = useState(false);
  const [connectionDetection, setConnectionDetection] = useState<ProviderConnectionDetection | null>(
    null,
  );
  const [addingModel, setAddingModel] = useState(false);
  const [manualId, setManualId] = useState('');
  const draftSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const addDraftModel = () => {
    const id = manualId.trim();
    if (!id) return;
    if (draft.models.some((model) => model.providerModelId === id)) {
      setManualId('');
      return;
    }
    onChange({
      ...draft,
      models: [...draft.models, { providerModelId: id, displayName: id }],
    });
    setManualId('');
  };
  const title = isCustomProvider
    ? draft.name.trim() || '自定义供应商'
    : draft.name.trim() || template?.name || '自定义供应商';
  const avatarLetter = (draft.name.trim() || template?.name || '自').slice(0, 1).toUpperCase();
  const iconTestId = `provider-form-icon-${template?.id ?? 'custom'}`;
  const testing = testResult.status === 'testing';

  return (
    <div className="model-provider-form-wrap">
      <button
        type="button"
        className="model-provider-form__back"
        aria-label="返回列表"
        onClick={onBackToCatalog}
        disabled={busy}
      >
        <ArrowLeft size={12} />
        返回列表
      </button>
      <section
        className="model-provider-detail model-provider-form"
        aria-labelledby="model-provider-form-title"
      >
        <div className="model-provider-detail__head">
          <span className="model-provider-detail__avatar" data-testid={iconTestId}>
            {avatarLetter}
          </span>
          <h2 id="model-provider-form-title">{title}</h2>
        </div>

        <div className="model-provider-fields">
          <Field label="供应商名称">
            <input
              className="st-field-input"
              value={draft.name}
              placeholder="例如 New API / OpenAI / Claude"
              disabled={busy}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </Field>
          {isCustomEndpoint ? (
            <Field label="API 地址（自定义服务）">
              <input
                className="st-field-input font-mono text-[12.5px]"
                data-testid="provider-base-url"
                value={draft.baseUrl}
                placeholder="https://api.example.com/v1"
                disabled={busy}
                onChange={(e) => {
                  setConnectionDetection(null);
                  onChange({ ...draft, baseUrl: e.target.value });
                }}
                onBlur={() => {
                  const detection = detectProviderConnectionInput(draft.baseUrl);
                  const nextProtocol = apiFormatManual
                    ? draft.protocol
                    : protocolFromDetection(draft.protocol, detection);
                  if (detection.baseUrl !== draft.baseUrl || nextProtocol !== draft.protocol) {
                    onChange({
                      ...draft,
                      baseUrl: detection.baseUrl,
                      protocol: nextProtocol,
                    });
                  }
                  setConnectionDetection(
                    detection.apiFormat || detection.normalized ? detection : null,
                  );
                }}
              />
              <span className="model-field-helper" data-testid="custom-provider-connection-hint">
                {connectionHintText(connectionDetection)}
              </span>
            </Field>
          ) : null}
          <Field label="API 格式">
            <ProtocolSelector
              protocol={draft.protocol}
              disabled={busy}
              onChange={(protocol) => {
                setApiFormatManual(true);
                setConnectionDetection(null);
                onChange({ ...draft, protocol });
              }}
            />
          </Field>
        </div>

        <section className="model-newmax-section model-newmax-section--credentials">
          <div className="model-newmax-section__label">API 密钥</div>
          <div className="model-credential-list">
            <SecretInput
              value={draft.apiKey}
              placeholder="输入 API 密钥"
              disabled={busy}
              onChange={(apiKey) => onChange({ ...draft, apiKey })}
            />
            {draft.extraApiKeys.map((key, index) => (
              <div key={index} className="model-create-key-row">
                <SecretInput
                  value={key}
                  placeholder={`备用密钥 ${index + 1}`}
                  disabled={busy}
                  onChange={(next) =>
                    onChange({
                      ...draft,
                      extraApiKeys: draft.extraApiKeys.map((item, i) =>
                        i === index ? next : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  title="删除密钥"
                  aria-label={`删除备用密钥 ${index + 1}`}
                  disabled={busy}
                  onClick={() =>
                    onChange({
                      ...draft,
                      extraApiKeys: draft.extraApiKeys.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="model-add-key-trigger"
            data-testid="create-provider-add-api-key"
            disabled={busy}
            onClick={() => onChange({ ...draft, extraApiKeys: [...draft.extraApiKeys, ''] })}
          >
            <Plus size={13} /> 添加 API 密钥
          </button>
        </section>

        <section className="model-newmax-section">
          <div className="model-newmax-section__heading">
            <div>
              <span className="model-newmax-section__label">模型优先级（至少添加一个）</span>
            </div>
          </div>
          {draft.models.length === 0 ? (
            <p className="model-credential-empty">暂无模型，请从服务商拉取或手动添加</p>
          ) : (
            <DndContext
              sensors={draftSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => {
                const activeId = String(event.active.id);
                const overId = event.over ? String(event.over.id) : null;
                if (!overId || activeId === overId || busy) return;
                const oldIndex = draft.models.findIndex(
                  (model) => model.providerModelId === activeId,
                );
                const newIndex = draft.models.findIndex(
                  (model) => model.providerModelId === overId,
                );
                if (oldIndex < 0 || newIndex < 0) return;
                onChange({ ...draft, models: arrayMove(draft.models, oldIndex, newIndex) });
              }}
            >
              <SortableContext
                items={draft.models.map((model) => model.providerModelId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="model-priority-list">
                  {draft.models.map((model, index) => (
                    <DraftModelRow
                      key={model.providerModelId}
                      model={model}
                      index={index}
                      busy={busy}
                      onRemove={() =>
                        onChange({
                          ...draft,
                          models: draft.models.filter(
                            (item) => item.providerModelId !== model.providerModelId,
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {addingModel ? (
            <AddModelInlineRow
              value={manualId}
              busy={busy}
              confirmTestId="create-provider-add-model-confirm"
              onChange={setManualId}
              onConfirm={addDraftModel}
              onDismiss={() => {
                setAddingModel(false);
                setManualId('');
              }}
            />
          ) : (
            <button
              type="button"
              data-testid="create-provider-add-model"
              className="model-add-model-btn"
              disabled={busy}
              onClick={() => setAddingModel(true)}
            >
              <Plus size={14} /> 添加模型
            </button>
          )}

          <p className="model-priority-hint">拖拽调整优先级</p>

          <button
            type="button"
            className="model-fetch-models-link"
            disabled={busy}
            onClick={onDiscover}
          >
            {busy && !testing ? (
              <Loader2 size={13} className="model-settings-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {busy && !testing ? '正在拉取模型…' : '从服务商拉取模型列表'}
          </button>

          <div className="model-test-connection">
            <button
              type="button"
              className="model-test-connection__btn"
              disabled={busy || draft.models.length === 0}
              onClick={onTest}
            >
              {testing ? <Loader2 size={15} className="model-settings-spin" /> : <Plug size={15} />}
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult.status === 'success' ? (
              <p className="model-test-connection__status is-success" role="status">
                ✓ {testResult.message}
              </p>
            ) : null}
            {testResult.status === 'error' ? (
              <p className="model-test-connection__status is-error" role="alert">
                × {testResult.message}
              </p>
            ) : null}
          </div>

          {testResult.status === 'error' ? (
            <UnverifiedSaveAction busy={busy} onSave={onSaveUnverified} />
          ) : null}
        </section>
      </section>
    </div>
  );
}

/**
 * NewMax-style「仍然保存（未验证）」: shown under the primary action once the
 * connection test fails, so a relay that rejects the capability probes can still
 * be kept. Mirrors NewMax's UnverifiedSaveAction — one button plus a hint, which
 * flips to a disabled「已保存，未验证」after use.
 */
function UnverifiedSaveAction({ busy, onSave }: { busy: boolean; onSave: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="model-provider-form__unverified">
      <div className="model-provider-form__actions">
        <button
          type="button"
          className="is-full model-provider-form__secondary-action"
          data-testid="model-settings-save-unverified"
          disabled={busy || saved}
          onClick={() => {
            onSave();
            setSaved(true);
          }}
        >
          {saved ? '已保存，未验证' : '仍然保存（未验证）'}
        </button>
      </div>
      <p className="model-provider-form__unverified-hint">
        连接测试会请求服务商的模型列表（/models）。部分中转站较慢或会拒绝该接口，但实际可以正常对话。思考、识图能力要打开模型后点「检测能力」。如果你确认配置无误，可以先保存使用。
      </p>
    </div>
  );
}

function providerPrimaryModel(provider: ProviderSummary): ProviderModelSummary | undefined {
  return [...provider.models].sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Provider avatar in the enabled/disabled provider lists: real brand logo when
 * the provider maps to a known brand (preset id, or display-name fallback for
 * user-added providers whose id is a random ULID), otherwise the letter glyph.
 */
function ProviderRowAvatar({ provider }: { provider: ProviderSummary }) {
  const brandLogo =
    resolveProviderBrandLogo(provider.providerId) ?? resolveProviderBrandLogoByName(provider.name);
  if (brandLogo) {
    return (
      <span
        className="model-enabled-row__avatar model-enabled-row__avatar--logo"
        aria-hidden="true"
      >
        <BrandLogoMark logo={brandLogo} size={16} />
      </span>
    );
  }
  return (
    <span className="model-enabled-row__avatar">{provider.name[0]?.toUpperCase() ?? '?'}</span>
  );
}

function SortableProviderRow({
  provider,
  index,
  active,
  busy,
  onSelect,
  onDisable,
  onRemove,
}: {
  provider: ProviderSummary;
  index: number;
  active: boolean;
  busy: boolean;
  onSelect(): void;
  onDisable(): void;
  onRemove(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.providerId,
    disabled: busy,
  });
  const primaryModel = providerPrimaryModel(provider);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx(
        'model-enabled-row',
        active && 'is-active',
        isDragging && 'is-dragging',
        menuOpen && 'has-menu-open',
      )}
    >
      <button
        type="button"
        className="model-enabled-row__grip"
        title="拖拽排序"
        aria-label={`拖拽 ${provider.name} 调整顺序`}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button type="button" className="model-enabled-row__main" onClick={onSelect}>
        <ProviderRowAvatar provider={provider} />
        <span className="model-enabled-row__copy">
          <span>
            {provider.name}
            {index === 0 ? <em>默认</em> : null}
            {/* NewMax: showUnverifiedTag = entry.unverified === true && !disabled */}
            {provider.unverified && provider.enabled ? (
              <em
                className="is-unverified"
                data-testid={`model-settings-unverified-tag-${provider.providerId}`}
                title="连接测试未通过，由你选择保存使用。若对话报错，回到这里重新测试。"
              >
                未验证
              </em>
            ) : null}
          </span>
          <small>{primaryModel?.displayName ?? '未添加模型'}</small>
        </span>
      </button>
      <div className="model-enabled-row__menu-wrap">
        <ModelOverflowMenu
          ariaLabel={`${provider.name} 更多操作`}
          triggerClassName="model-enabled-row__menu-trigger"
          disabled={busy}
          onOpenChange={setMenuOpen}
          items={[
            { label: '停用', onSelect: onDisable },
            { label: '移除', danger: true, confirmLabel: '确认移除', onSelect: onRemove },
          ]}
        />
      </div>
    </li>
  );
}

function DisabledProviderRow({
  provider,
  active,
  busy,
  onSelect,
  onEnable,
  onRemove,
}: {
  provider: ProviderSummary;
  active: boolean;
  busy: boolean;
  onSelect(): void;
  onEnable(): void;
  onRemove(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const primaryModel = providerPrimaryModel(provider);
  return (
    <div className={clsx('model-disabled-row', active && 'is-active', menuOpen && 'has-menu-open')}>
      <button type="button" className="model-disabled-row__main" onClick={onSelect}>
        <ProviderRowAvatar provider={provider} />
        <span className="model-enabled-row__copy">
          <span>{provider.name}</span>
          <small>{primaryModel?.displayName ?? '未添加模型'}</small>
        </span>
      </button>
      <div className="model-disabled-row__menu-wrap">
        <ModelOverflowMenu
          ariaLabel={`${provider.name} 更多操作`}
          triggerClassName="model-enabled-row__menu-trigger"
          triggerSize={14}
          disabled={busy}
          onOpenChange={setMenuOpen}
          items={[
            { label: '启用', onSelect: onEnable },
            { label: '移除', danger: true, confirmLabel: '确认移除', onSelect: onRemove },
          ]}
        />
      </div>
    </div>
  );
}

function ProviderRowPreview({ provider }: { provider: ProviderSummary | null }) {
  if (!provider) return null;
  const primaryModel = providerPrimaryModel(provider);
  return (
    <div className="model-enabled-row model-enabled-row--overlay">
      <span className="model-enabled-row__grip is-static">
        <GripVertical size={14} />
      </span>
      <ProviderRowAvatar provider={provider} />
      <span className="model-enabled-row__copy">
        <span>{provider.name}</span>
        <small>{primaryModel?.displayName ?? '未添加模型'}</small>
      </span>
    </div>
  );
}

// ─── Provider detail ─────────────────────────────────────────────────────────

function ProtocolSelector({
  protocol,
  disabled,
  onChange,
}: {
  protocol: ProtocolFamily;
  disabled?: boolean;
  onChange(protocol: ProtocolFamily): void;
}) {
  const family = protocolFamilyOf(protocol);
  return (
    <div className="model-protocol-control">
      <DsTabBar
        aria-label="API 格式"
        stretch
        value={family}
        onChange={(next) => {
          if (disabled) return;
          if (next === 'anthropic') {
            onChange('anthropic-messages');
            return;
          }
          onChange(protocol === 'openai-responses' ? protocol : 'openai-chat');
        }}
        items={[
          { value: 'openai', label: 'OpenAI 格式', disabled },
          { value: 'anthropic', label: 'Anthropic 格式', disabled },
        ]}
      />
      <div className={clsx('model-responses-row', family !== 'openai' && 'is-hidden')}>
        <div>
          <strong>使用 Responses API</strong>
          <span>
            强制走 /v1/responses，中转站 prompt cache 命中率更高。仅当供应商支持 Responses
            端点时开启，否则会 404。
          </span>
        </div>
        <Toggle
          checked={protocol === 'openai-responses'}
          disabled={disabled || family !== 'openai'}
          label="使用 Responses API"
          onChange={(enabled) => onChange(enabled ? 'openai-responses' : 'openai-chat')}
        />
      </div>
    </div>
  );
}

function SecretInput({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);
  return (
    <div className="model-secret-input">
      <input
        className="st-field-input font-mono text-[12.5px]"
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        title={visible ? '隐藏密钥' : '显示密钥'}
        aria-label={visible ? '隐藏密钥' : '显示密钥'}
        disabled={disabled || !value}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function ProviderDetail({
  provider,
  operation,
  dialog,
  connectionTest,
  onUpdateProvider,
  onAddCredential,
  onRemoveCredential,
  onRevealCredential,
  onStageCredentialSecret,
  stagedSecrets,
  onFetchModels,
  onTestConnection,
  onAddModel,
  onRemoveModel,
  onUpdateModelContext,
  onProbeModelCapabilities,
  onConfirmModelCapabilities,
  onReorderModels,
  onPinCredential,
  onTransientDraftChange,
}: {
  provider: ProviderSummary;
  operation: UiOperation | null;
  dialog: ReturnType<typeof useDialog>;
  connectionTest: ConnectionTestState;
  onUpdateProvider: (
    providerId: string,
    patch: Omit<RendererUpdateProviderPayload, 'providerId'>,
  ) => Promise<boolean>;
  onAddCredential: (providerId: string, apiKey: string, label?: string) => Promise<boolean>;
  onRemoveCredential: (providerId: string, credentialRefId: string) => void;
  onRevealCredential: (
    providerId: string,
    credentialRefId: string,
  ) => Promise<{ apiKey: string; expiresAt: string } | null>;
  onStageCredentialSecret: (credentialRefId: string, apiKey: string) => void;
  stagedSecrets: Record<string, string>;
  onFetchModels: () => void;
  onTestConnection: () => void;
  onAddModel: (
    providerId: string,
    protocol: ProtocolFamily,
    providerModelId: string,
    displayName?: string,
    contextWindow?: number,
  ) => Promise<boolean>;
  onRemoveModel: (providerId: string, modelId: string) => void;
  onUpdateModelContext: (providerId: string, modelId: string, contextWindow: number | null) => void;
  onProbeModelCapabilities: (
    providerId: string,
    modelId: string,
  ) => Promise<CapabilityProbeSuggestion>;
  onConfirmModelCapabilities: (
    providerId: string,
    modelId: string,
    capabilities: ModelCapabilityTag[],
  ) => Promise<ProviderModelSummary>;
  onReorderModels: (provider: ProviderSummary, models: ProviderModelSummary[]) => void;
  onPinCredential: (
    provider: ProviderSummary,
    modelId: string,
    credentialRefId: string | null,
  ) => void;
  onTransientDraftChange(dirty: boolean): void;
}) {
  const [nameDraft, setNameDraft] = useState(provider.name);
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.baseUrl);
  const [protocolDraft, setProtocolDraft] = useState<ProtocolFamily>(
    provider.protocol as ProtocolFamily,
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [apiFormatManual, setApiFormatManual] = useState(false);
  const [connectionDetection, setConnectionDetection] = useState<ProviderConnectionDetection | null>(
    null,
  );
  const [savingField, setSavingField] = useState<'name' | 'baseUrl' | 'protocol' | null>(null);
  const [newKey, setNewKey] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [manualId, setManualId] = useState('');
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const modelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const busy = operation?.targetId === provider.providerId;
  const discovering = operation?.kind === 'discover-models' && busy;
  const testing = connectionTest.status === 'testing';
  const keyDraftDirty = addingKey && Boolean(newKey.trim());
  const manualModelDraftDirty = addingModel && Boolean(manualId.trim());

  useEffect(() => {
    onTransientDraftChange(keyDraftDirty || manualModelDraftDirty);
    return () => onTransientDraftChange(false);
  }, [keyDraftDirty, manualModelDraftDirty, onTransientDraftChange]);

  useEffect(() => {
    setNameDraft(provider.name);
    setBaseUrlDraft(provider.baseUrl);
    setProtocolDraft(provider.protocol as ProtocolFamily);
  }, [provider.name, provider.baseUrl, provider.protocol]);

  useEffect(() => {
    setNameError(null);
    setBaseUrlError(null);
    setApiFormatManual(false);
    setConnectionDetection(null);
    setNewKey('');
    setAddingKey(false);
    setAddingModel(false);
    setManualId('');
    setSelectedModelId(null);
  }, [provider.providerId]);

  const models = useMemo(
    () => [...provider.models].sort((a, b) => a.priority - b.priority),
    [provider.models],
  );

  const saveTextField = async (field: 'name' | 'baseUrl', rawValue?: string) => {
    // Prefer the live input value: blur can fire before React re-renders the draft state.
    const raw = rawValue ?? (field === 'name' ? nameDraft : baseUrlDraft);
    if (field === 'name') {
      const value = raw.trim();
      setNameDraft(value);
      if (!value) {
        setNameError('供应商名称不能为空');
        return;
      }
      setNameError(null);
      if (value === provider.name) return;
      setSavingField('name');
      const saved = await onUpdateProvider(provider.providerId, { name: value });
      setSavingField(null);
      if (!saved) setNameDraft(provider.name);
      return;
    }

    const detection = detectProviderConnectionInput(raw);
    const nextUrl = detection.baseUrl;
    const nextProtocol = apiFormatManual
      ? protocolDraft
      : protocolFromDetection(protocolDraft, detection);
    setBaseUrlDraft(nextUrl);
    setConnectionDetection(detection.apiFormat || detection.normalized ? detection : null);
    if (!nextUrl || nextUrl === 'https://') {
      setBaseUrlError('API Base URL 不能为空');
      return;
    }
    setBaseUrlError(null);
    const urlChanged = nextUrl !== provider.baseUrl;
    const protocolChanged = nextProtocol !== provider.protocol;
    if (!urlChanged && !protocolChanged) return;
    if (protocolChanged) setProtocolDraft(nextProtocol);
    setSavingField('baseUrl');
    const saved = await onUpdateProvider(provider.providerId, {
      ...(urlChanged ? { baseUrl: nextUrl } : {}),
      ...(protocolChanged ? { protocol: nextProtocol } : {}),
    });
    setSavingField(null);
    if (!saved) {
      setBaseUrlDraft(provider.baseUrl);
      setProtocolDraft(provider.protocol as ProtocolFamily);
    }
  };

  const saveProtocol = async (protocol: ProtocolFamily) => {
    if (protocol === protocolDraft) return;
    const previous = protocolDraft;
    setApiFormatManual(true);
    setConnectionDetection(null);
    setProtocolDraft(protocol);
    setSavingField('protocol');
    const saved = await onUpdateProvider(provider.providerId, { protocol });
    setSavingField(null);
    if (!saved) setProtocolDraft(previous);
  };

  return (
    <div className="model-provider-detail">
      <div className="model-provider-detail__head">
        <span className="model-provider-detail__avatar">
          {provider.name[0]?.toUpperCase() ?? '?'}
        </span>
        <h2>{provider.name}</h2>
        {!provider.enabled ? <span className="model-provider-detail__disabled">已停用</span> : null}
      </div>

      <div className="model-provider-fields">
        <Field label="供应商名称">
          <div className="model-autosave-field">
            <input
              className="st-field-input"
              value={nameDraft}
              aria-invalid={Boolean(nameError)}
              aria-label="供应商名称"
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={(event) => void saveTextField('name', event.currentTarget.value)}
            />
            {savingField === 'name' ? <Loader2 size={13} className="model-settings-spin" /> : null}
          </div>
          {nameError ? <span className="model-field-error">{nameError}</span> : null}
        </Field>
        <Field label="API 地址（自定义服务）">
          <div className="model-autosave-field">
            <input
              className="st-field-input"
              value={baseUrlDraft}
              aria-invalid={Boolean(baseUrlError)}
              aria-label="API Base URL"
              onChange={(event) => {
                setConnectionDetection(null);
                setBaseUrlDraft(event.target.value);
              }}
              onBlur={(event) => void saveTextField('baseUrl', event.currentTarget.value)}
            />
            {savingField === 'baseUrl' ? (
              <Loader2 size={13} className="model-settings-spin" />
            ) : null}
          </div>
          {baseUrlError ? <span className="model-field-error">{baseUrlError}</span> : null}
          <span className="model-field-helper" data-testid="custom-provider-connection-hint">
            {connectionHintText(connectionDetection)}
          </span>
        </Field>
        <Field label="API 格式">
          <div className="model-autosave-control">
            <ProtocolSelector
              protocol={protocolDraft}
              onChange={(protocol) => void saveProtocol(protocol)}
            />
            {savingField === 'protocol' ? (
              <Loader2 size={13} className="model-settings-spin" />
            ) : null}
          </div>
        </Field>
      </div>

      <section className="model-newmax-section model-newmax-section--credentials">
        <div className="model-newmax-section__label">API 密钥</div>
        <div className="model-credential-list">
          {provider.credentials.length === 0 ? (
            <p className="model-credential-empty">尚未配置密钥</p>
          ) : (
            provider.credentials.map((credential) => (
              <SavedCredentialRow
                key={credential.credentialRefId}
                providerId={provider.providerId}
                credential={credential}
                canRemove={provider.credentials.length > 1}
                busy={busy}
                stagedValue={stagedSecrets[credential.credentialRefId] ?? ''}
                onReveal={onRevealCredential}
                onStage={(apiKey) => onStageCredentialSecret(credential.credentialRefId, apiKey)}
                onRemove={() => {
                  void dialog
                    .confirm({
                      title: '删除 API 密钥',
                      message: `确定删除密钥「${credential.label ?? credential.credentialRefId}」吗？删除后该密钥的请求将无法使用。`,
                      confirmText: '删除',
                      danger: true,
                    })
                    .then((ok) => {
                      if (ok) onRemoveCredential(provider.providerId, credential.credentialRefId);
                    });
                }}
              />
            ))
          )}
        </div>
        {addingKey ? (
          <div className="model-add-key-form">
            <div>
              <label>API Key</label>
              <SecretInput value={newKey} placeholder="sk-…" disabled={busy} onChange={setNewKey} />
            </div>
            <div className="model-add-key-form__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAddingKey(false);
                  setNewKey('');
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy || !newKey.trim()}
                onClick={async () => {
                  const saved = await onAddCredential(provider.providerId, newKey.trim());
                  if (!saved) return;
                  setAddingKey(false);
                  setNewKey('');
                }}
              >
                {operation?.kind === 'add-credential' && busy ? '添加中…' : '添加密钥'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="model-add-key-trigger"
            disabled={busy}
            onClick={() => setAddingKey(true)}
          >
            <Plus size={13} /> 添加 API 密钥
          </button>
        )}
      </section>

      <section className="model-newmax-section">
        <div className="model-newmax-section__heading">
          <div>
            <span className="model-newmax-section__label">模型优先级（至少添加一个）</span>
          </div>
        </div>
        {models.length === 0 ? (
          <p className="model-credential-empty">暂无模型，请发现模型或手动添加</p>
        ) : (
          <DndContext
            sensors={modelSensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => setActiveModelId(String(event.active.id))}
            onDragCancel={() => setActiveModelId(null)}
            onDragEnd={(event) => {
              setActiveModelId(null);
              const activeId = String(event.active.id);
              const overId = event.over ? String(event.over.id) : null;
              if (!overId || activeId === overId || busy) return;
              const oldIndex = models.findIndex((model) => model.modelId === activeId);
              const newIndex = models.findIndex((model) => model.modelId === overId);
              if (oldIndex < 0 || newIndex < 0) return;
              onReorderModels(provider, arrayMove(models, oldIndex, newIndex));
            }}
          >
            <SortableContext
              items={models.map((model) => model.modelId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="model-priority-list">
                {models.map((model, index) => (
                  <SortableModelRow
                    key={model.modelId}
                    model={model}
                    index={index}
                    credentials={provider.credentials}
                    busy={busy}
                    onOpen={() => setSelectedModelId(model.modelId)}
                    onRemove={() => {
                      void dialog
                        .confirm({
                          title: '删除模型',
                          message: `确定删除模型「${model.displayName}」吗？删除后需要重新添加才能使用，不会影响其他模型。`,
                          confirmText: '删除',
                          danger: true,
                        })
                        .then((ok) => {
                          if (ok) onRemoveModel(provider.providerId, model.modelId);
                        });
                    }}
                    onPin={(credentialId) => onPinCredential(provider, model.modelId, credentialId)}
                    onSaveContext={(contextWindow) =>
                      onUpdateModelContext(provider.providerId, model.modelId, contextWindow)
                    }
                  />
                ))}
              </div>
            </SortableContext>
            {typeof document !== 'undefined'
              ? createPortal(
                  <DragOverlay
                    dropAnimation={{
                      duration: 180,
                      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                    }}
                    zIndex={10050}
                  >
                    {activeModelId ? (
                      <ModelRowPreview
                        model={models.find((model) => model.modelId === activeModelId) ?? null}
                      />
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
        )}

        {addingModel ? (
          <AddModelInlineRow
            value={manualId}
            busy={busy}
            onChange={setManualId}
            onConfirm={async () => {
              const id = manualId.trim();
              if (!id) return;
              const saved = await onAddModel(provider.providerId, protocolDraft, id);
              if (!saved) return;
              setManualId('');
            }}
            onDismiss={() => {
              setAddingModel(false);
              setManualId('');
            }}
          />
        ) : (
          <button
            type="button"
            className="model-add-model-btn"
            disabled={busy}
            onClick={() => setAddingModel(true)}
          >
            <Plus size={14} /> 添加模型
          </button>
        )}

        <p className="model-priority-hint">拖拽调整优先级</p>

        {provider.supportsDiscovery ? (
          <button
            type="button"
            className="model-fetch-models-link"
            disabled={busy || discovering}
            onClick={onFetchModels}
          >
            <RefreshCw size={13} className={discovering ? 'model-settings-spin' : undefined} />
            {discovering ? '正在拉取模型…' : '从服务商拉取模型列表'}
          </button>
        ) : null}

        <div className="model-test-connection">
          <button
            type="button"
            className="model-test-connection__btn"
            disabled={busy || testing}
            onClick={onTestConnection}
          >
            {testing ? <Loader2 size={15} className="model-settings-spin" /> : <Plug size={15} />}
            {testing ? '测试中…' : '测试连接'}
          </button>
          {connectionTest.status === 'success' ? (
            <p className="model-test-connection__status is-success" role="status">
              ✓ {connectionTest.message ?? `连接成功 · ${connectionTest.latencyMs ?? 0}ms`}
            </p>
          ) : null}
          {connectionTest.status === 'error' ? (
            <p className="model-test-connection__status is-error" role="alert">
              × {connectionTest.message ?? '连接失败'}
              {typeof connectionTest.latencyMs === 'number'
                ? ` · ${connectionTest.latencyMs}ms`
                : ''}
            </p>
          ) : null}
        </div>
      </section>
      <ModelCapabilityDialog
        key={selectedModelId ?? 'closed-model-capability-dialog'}
        provider={provider}
        model={models.find((model) => model.modelId === selectedModelId) ?? null}
        onClose={() => setSelectedModelId(null)}
        onProbe={(modelId) => onProbeModelCapabilities(provider.providerId, modelId)}
        onConfirm={(modelId, capabilities) =>
          onConfirmModelCapabilities(provider.providerId, modelId, capabilities)
        }
        onSaveContext={(contextWindow) => {
          if (selectedModelId) {
            onUpdateModelContext(provider.providerId, selectedModelId, contextWindow);
          }
        }}
      />
    </div>
  );
}

/**
 * NewMax-style credential row: full-width masked field + eye toggle.
 * - No primary/label text
 * - Click eye → reveal plaintext, editable inline
 * - Blur → stage draft only (secure-store write happens on 完成 + test pass)
 */
function SavedCredentialRow({
  providerId,
  credential,
  canRemove,
  busy,
  stagedValue,
  onReveal,
  onStage,
  onRemove,
}: {
  providerId: string;
  credential: ProviderSummary['credentials'][number];
  canRemove: boolean;
  busy: boolean;
  stagedValue: string;
  onReveal: (
    providerId: string,
    credentialRefId: string,
  ) => Promise<{ apiKey: string; expiresAt: string } | null>;
  onStage: (apiKey: string) => void;
  onRemove: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState(stagedValue);
  const [baseline, setBaseline] = useState('');
  const revealTimer = useRef<number | null>(null);
  const revealGeneration = useRef(0);
  const prefetchedRef = useRef<{ apiKey: string; expiresAt: string } | null>(null);
  const prefetchPromiseRef = useRef<Promise<{ apiKey: string; expiresAt: string } | null> | null>(
    null,
  );

  const clearReveal = useCallback(() => {
    revealGeneration.current += 1;
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setVisible(false);
    // Keep staged draft if present; otherwise restore mask.
    setValue(stagedValue || '');
    setBaseline('');
  }, [stagedValue]);

  // Reset reveal state only when switching credential / provider — not on every keystroke.
  useEffect(() => {
    revealGeneration.current += 1;
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setVisible(false);
    setValue(stagedValue || '');
    setBaseline('');
    prefetchedRef.current = null;
    prefetchPromiseRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on identity change
  }, [credential.credentialRefId, providerId]);

  useEffect(() => {
    if (!visible) setValue(stagedValue || '');
  }, [stagedValue, visible]);

  // Keep latest edit state in refs so blur/visibility handlers stay stable
  // without re-subscribing (and without clearReveal on every keystroke).
  const visibleRef = useRef(visible);
  const valueRef = useRef(value);
  const baselineRef = useRef(baseline);
  const onStageRef = useRef(onStage);
  const clearRevealRef = useRef(clearReveal);
  visibleRef.current = visible;
  valueRef.current = value;
  baselineRef.current = baseline;
  onStageRef.current = onStage;
  clearRevealRef.current = clearReveal;

  useEffect(() => {
    if (!credential.hasSecret) {
      prefetchedRef.current = null;
      prefetchPromiseRef.current = null;
      return;
    }
    let cancelled = false;
    const promise = onReveal(providerId, credential.credentialRefId).then((result) => {
      if (!cancelled && result?.apiKey) prefetchedRef.current = result;
      return result;
    });
    prefetchPromiseRef.current = promise;
    return () => {
      cancelled = true;
    };
  }, [credential.credentialRefId, credential.hasSecret, onReveal, providerId]);

  useEffect(() => {
    const hide = () => {
      if (
        visibleRef.current &&
        valueRef.current.trim() &&
        valueRef.current.trim() !== baselineRef.current.trim()
      ) {
        onStageRef.current(valueRef.current);
      }
      revealGeneration.current += 1;
      if (revealTimer.current !== null) {
        window.clearTimeout(revealTimer.current);
        revealTimer.current = null;
      }
      setVisible(false);
      setBaseline('');
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hide();
    };
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const showPlaintext = (result: { apiKey: string; expiresAt: string }) => {
    const generation = revealGeneration.current + 1;
    revealGeneration.current = generation;
    setValue(result.apiKey);
    setBaseline(result.apiKey);
    setVisible(true);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    const expiresMs = Date.parse(result.expiresAt);
    const delay =
      Number.isFinite(expiresMs) && expiresMs > Date.now()
        ? Math.min(CREDENTIAL_REVEAL_MS, expiresMs - Date.now())
        : CREDENTIAL_REVEAL_MS;
    revealTimer.current = window.setTimeout(() => {
      if (revealGeneration.current === generation) {
        if (
          valueRef.current.trim() &&
          valueRef.current.trim() !== result.apiKey.trim()
        ) {
          onStageRef.current(valueRef.current);
        }
        clearRevealRef.current();
      }
    }, delay);
  };

  const handleToggleReveal = async () => {
    if (visible) {
      if (value.trim() && value.trim() !== baseline.trim()) onStage(value);
      clearReveal();
      return;
    }
    // Prefer already-staged draft over re-fetching.
    if (stagedValue) {
      setValue(stagedValue);
      setBaseline(stagedValue);
      setVisible(true);
      return;
    }
    if (!credential.hasSecret) {
      setValue('');
      setBaseline('');
      setVisible(true);
      return;
    }
    if (prefetchedRef.current?.apiKey) {
      showPlaintext(prefetchedRef.current);
      return;
    }
    const result = await (prefetchPromiseRef.current ??
      onReveal(providerId, credential.credentialRefId));
    if (!result?.apiKey) return;
    prefetchedRef.current = result;
    showPlaintext(result);
  };

  const displayValue = visible
    ? value
    : stagedValue
      ? CREDENTIAL_MASK
      : credential.hasSecret
        ? CREDENTIAL_MASK
        : '';

  return (
    <div className={clsx('model-credential-row', visible && 'is-revealed')}>
      <input
        className="model-credential-row__input font-mono"
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        value={displayValue}
        readOnly={!visible}
        disabled={busy}
        placeholder={credential.hasSecret || stagedValue ? undefined : '未写入'}
        aria-label="API 密钥"
        onChange={(event) => {
          if (!visible) return;
          setValue(event.target.value);
        }}
        onBlur={() => {
          if (!visible) return;
          if (value.trim() && value.trim() !== baseline.trim()) {
            onStage(value);
          }
        }}
      />
      <button
        type="button"
        className="model-credential-row__eye"
        title={visible ? '隐藏密钥' : '显示密钥'}
        aria-label={visible ? '隐藏密钥' : '显示密钥'}
        disabled={busy || (!credential.hasSecret && !stagedValue && !visible)}
        onClick={() => void handleToggleReveal()}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      {canRemove ? (
        <button
          type="button"
          className="model-credential-row__remove"
          title="删除密钥"
          disabled={busy}
          onClick={() => {
            clearReveal();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}

function SortableModelRow({
  model,
  index,
  credentials,
  busy,
  onOpen,
  onRemove,
  onPin,
  onSaveContext,
}: {
  model: ProviderModelSummary;
  index: number;
  credentials: ProviderSummary['credentials'];
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onPin: (credentialRefId: string | null) => void;
  onSaveContext: (contextWindow: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.modelId,
    disabled: busy,
  });
  const [editingContext, setEditingContext] = useState(false);
  const [contextDraft, setContextDraft] = useState(
    model.contextWindow && model.contextWindow > 0
      ? (formatContext(model.contextWindow) ?? String(model.contextWindow))
      : '',
  );
  useEffect(() => {
    if (!editingContext) {
      setContextDraft(
        model.contextWindow && model.contextWindow > 0
          ? (formatContext(model.contextWindow) ?? String(model.contextWindow))
          : '',
      );
    }
  }, [model.contextWindow, editingContext]);

  const commitContext = () => {
    setEditingContext(false);
    const raw = contextDraft.trim();
    if (!raw) {
      if (model.contextWindow) onSaveContext(null);
      return;
    }
    const parsed = parseContextTokens(raw);
    if (parsed === null) {
      setContextDraft(
        model.contextWindow && model.contextWindow > 0
          ? (formatContext(model.contextWindow) ?? String(model.contextWindow))
          : '',
      );
      return;
    }
    if (parsed === model.contextWindow) return;
    onSaveContext(parsed);
  };

  const ctx = formatContext(model.contextWindow);
  const ctxTitle = ctx
    ? `上下文窗口 ${model.contextWindow!.toLocaleString('en-US')} tokens · 点击编辑（支持 372k / 1m）`
    : '设置上下文窗口（tokens）· 点击编辑（支持 372k / 1m）';
  const title = modelPrimaryLabel(model);
  const rankLabel = modelRankLabel(index);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('model-priority-row', isDragging && 'is-dragging')}
    >
      <button
        type="button"
        className="model-priority-row__grip"
        disabled={busy}
        title="拖拽调整优先级"
        aria-label={`拖拽 ${title} 调整优先级`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        className="model-priority-row__main"
        disabled={busy}
        aria-label={`查看模型 ${title}`}
        onClick={onOpen}
      >
        <span className={clsx('model-priority-row__rank', index === 0 && 'is-primary')}>
          {rankLabel}
        </span>
        <span className="model-priority-row__copy">
          <span title={title}>{title}</span>
        </span>
        <ChevronRight className="model-priority-row__open-icon" size={13} aria-hidden="true" />
      </button>
      <div className="model-priority-row__context">
        {editingContext ? (
          <input
            className="st-field-input model-priority-row__context-input"
            type="text"
            inputMode="text"
            value={contextDraft}
            disabled={busy}
            autoFocus
            placeholder="如 200k / 1m"
            aria-label={`${title} 上下文窗口（tokens）`}
            title="上下文窗口，单位 tokens（支持 372000、372k、1m）"
            onChange={(event) => setContextDraft(event.target.value)}
            onBlur={() => commitContext()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitContext();
              } else if (event.key === 'Escape') {
                setEditingContext(false);
                setContextDraft(
                  model.contextWindow && model.contextWindow > 0
                    ? (formatContext(model.contextWindow) ?? String(model.contextWindow))
                    : '',
                );
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={clsx(
              'model-priority-row__context-value',
              'inline-flex items-center gap-1',
              !ctx && 'is-empty',
            )}
            disabled={busy}
            title={ctxTitle}
            onClick={() => {
              setContextDraft(ctx ?? '');
              setEditingContext(true);
            }}
          >
            <Gauge size={12} aria-hidden="true" className="shrink-0" />
            {ctx || '上下文'}
          </button>
        )}
      </div>
      {credentials.length > 1 ? (
        <select
          className="model-priority-row__credential"
          value={model.credentialRefId ?? ''}
          disabled={busy}
          title="绑定密钥"
          onChange={(event) => onPin(event.target.value || null)}
        >
          <option value="">默认密钥</option>
          {credentials.map((credential) => (
            <option key={credential.credentialRefId} value={credential.credentialRefId}>
              {credential.label}
            </option>
          ))}
        </select>
      ) : null}
      <div className="model-priority-row__actions">
        <button
          type="button"
          className="is-danger"
          title="删除模型"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function ModelCapabilityIcon({ capability }: { capability: ModelCapabilityTag }) {
  switch (capability) {
    case 'text':
      return <FileText size={14} aria-hidden="true" />;
    case 'vision':
      return <Eye size={14} aria-hidden="true" />;
    case 'tool-calling':
      return <Wrench size={14} aria-hidden="true" />;
    case 'web-search':
      return <Globe2 size={14} aria-hidden="true" />;
    case 'image-generation':
      return <Image size={14} aria-hidden="true" />;
    case 'embeddings':
      return <Database size={14} aria-hidden="true" />;
  }
}

function capabilitySetKey(capabilities: readonly ModelCapabilityTag[]): string {
  return [...capabilities].sort().join('|');
}

function describeCapabilityDialogError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '').trim();
  if (!raw) return fallback;
  if (/Invalid confirm-capabilities payload/i.test(raw)) {
    return '保存失败：当前勾选的能力无法提交。请重新勾选后再保存。';
  }
  return formatRuntimeIpcError(error, fallback);
}

function ModelCapabilityDialog({
  provider,
  model,
  onClose,
  onProbe,
  onConfirm,
  onSaveContext,
}: {
  provider: ProviderSummary;
  model: ProviderModelSummary | null;
  onClose: () => void;
  onProbe: (modelId: string) => Promise<CapabilityProbeSuggestion>;
  onConfirm: (
    modelId: string,
    capabilities: ModelCapabilityTag[],
  ) => Promise<ProviderModelSummary>;
  onSaveContext: (contextWindow: number | null) => void;
}) {
  const [draft, setDraft] = useState<ModelCapabilityTag[]>(() => [
    ...(model?.capabilities ?? []),
  ]);
  const [phase, setPhase] = useState<'idle' | 'probing' | 'saving' | 'success' | 'error'>(
    'idle',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [editingContext, setEditingContext] = useState(false);
  const [contextDraft, setContextDraft] = useState('');

  useEffect(() => {
    if (!editingContext) {
      const current = model?.contextWindow;
      setContextDraft(
        current && current > 0 ? (formatContext(current) ?? String(current)) : '',
      );
    }
  }, [model?.contextWindow, editingContext]);

  if (!model) return null;

  const title = modelPrimaryLabel(model);
  const busy = phase === 'probing' || phase === 'saving';
  const draftChanged = capabilitySetKey(draft) !== capabilitySetKey(model.capabilities);
  const canSave = draft.length > 0 && (draftChanged || !model.capabilitiesConfirmed);
  const protocolLabel =
    PROTOCOL_LABELS[model.protocol as ProtocolFamily] ?? String(model.protocol);

  const toggleCapability = (capability: ModelCapabilityTag) => {
    if (busy) return;
    setDraft((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : MODEL_CAPABILITY_OPTIONS.map((option) => option.value).filter(
            (item) => current.includes(item) || item === capability,
          ),
    );
    setPhase('idle');
    setNotice(null);
  };

  const runProbe = async () => {
    setPhase('probing');
    setNotice('正在向当前接口发送实测请求…');
    try {
      const suggestion = await onProbe(model.modelId);
      setDraft([...suggestion.capabilities]);
      setPhase('success');
      const count = suggestion.capabilities.length;
      setNotice(
        suggestion.source === 'live'
          ? `检测完成：已向接口实测，建议勾选 ${count} 项。请核对后保存。`
          : `检测完成：按协议和模型名推断出 ${count} 项能力。请核对后保存。`,
      );
    } catch (error) {
      setPhase('error');
      setNotice(describeCapabilityDialogError(error, '能力检测失败，请重试'));
    }
  };

  const saveCapabilities = async () => {
    if (!canSave) return;
    setPhase('saving');
    setNotice('正在保存能力配置');
    try {
      await onConfirm(model.modelId, draft);
      // Save succeeded → close immediately. Errors keep the dialog open for retry.
      onClose();
    } catch (error) {
      setPhase('error');
      setNotice(describeCapabilityDialogError(error, '保存失败，请重试'));
    }
  };

  const commitContextWindow = () => {
    setEditingContext(false);
    const raw = contextDraft.trim();
    if (!raw) {
      if (model.contextWindow) onSaveContext(null);
      return;
    }
    const parsed = parseContextTokens(raw);
    if (parsed === null) {
      const current = model.contextWindow;
      setContextDraft(
        current && current > 0 ? (formatContext(current) ?? String(current)) : '',
      );
      return;
    }
    if (parsed === model.contextWindow) return;
    onSaveContext(parsed);
  };

  const applyContextPreset = (tokens: number) => {
    setEditingContext(false);
    if (tokens === model.contextWindow) return;
    onSaveContext(tokens);
  };

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="model-capability-dialog__overlay" />
        <RadixDialog.Content
          className="model-capability-dialog"
          data-testid="model-capability-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
        <header className="model-capability-dialog__header">
          <span className="model-capability-dialog__model-icon">
            <Cpu size={18} aria-hidden="true" />
          </span>
          <div className="model-capability-dialog__identity">
            <RadixDialog.Title>{title}</RadixDialog.Title>
            <RadixDialog.Description>
              {provider.name} / {model.providerModelId}
            </RadixDialog.Description>
          </div>
          <span
            className={clsx(
              'model-capability-dialog__state',
              model.capabilitiesConfirmed && !draftChanged && 'is-confirmed',
            )}
          >
            {model.capabilitiesConfirmed && !draftChanged ? '已确认' : '待确认'}
          </span>
          <RadixDialog.Close asChild>
            <button
              type="button"
              className="model-capability-dialog__close"
              aria-label="关闭模型详情"
              disabled={busy}
            >
              <X size={16} />
            </button>
          </RadixDialog.Close>
        </header>

        <div className="model-capability-dialog__body">
          <dl className="model-capability-dialog__facts">
            <div>
              <dt>API 格式</dt>
              <dd>{protocolLabel}</dd>
            </div>
            <div className="model-capability-dialog__facts-context">
              <dt>上下文窗口</dt>
              <dd className="model-capability-dialog__context">
                {editingContext ? (
                  <div className="model-capability-dialog__context-editor">
                    <input
                      className="st-field-input model-capability-dialog__context-input"
                      type="text"
                      inputMode="text"
                      value={contextDraft}
                      disabled={busy}
                      autoFocus
                      placeholder="如 200k / 1m"
                      aria-label={`${title} 上下文窗口（tokens）`}
                      title="上下文窗口，单位 tokens（支持 200k、272k、300k、1m）"
                      onChange={(event) => setContextDraft(event.target.value)}
                      onBlur={() => commitContextWindow()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitContextWindow();
                        } else if (event.key === 'Escape') {
                          const current = model.contextWindow;
                          setEditingContext(false);
                          setContextDraft(
                            current && current > 0
                              ? (formatContext(current) ?? String(current))
                              : '',
                          );
                        }
                      }}
                    />
                    <div className="model-capability-dialog__context-presets">
                      {CONTEXT_WINDOW_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={busy}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyContextPreset(preset)}
                        >
                          {formatContext(preset)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="model-capability-dialog__context-value"
                    disabled={busy}
                    title="点击设置上下文窗口（支持 200k / 272k / 300k / 1m）"
                    onClick={() => {
                      setContextDraft(formatContext(model.contextWindow) ?? '');
                      setEditingContext(true);
                    }}
                  >
                    <Gauge size={12} aria-hidden="true" />
                    {formatContext(model.contextWindow) ?? '未设置'}
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>优先级</dt>
              <dd>{modelRankLabel(model.priority)}</dd>
            </div>
          </dl>

          <section className="model-capability-dialog__section">
            <div className="model-capability-dialog__section-head">
              <h3>模型能力</h3>
              <span>
                {draft.length} / {MODEL_CAPABILITY_OPTIONS.length}
              </span>
            </div>
            <div
              className="model-capability-dialog__chips"
              aria-busy={phase === 'probing'}
            >
              {MODEL_CAPABILITY_OPTIONS.map((option) => {
                const active = draft.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx(
                      'model-capability-dialog__capability',
                      active && 'is-active',
                    )}
                    aria-pressed={active}
                    aria-label={`${option.label}：${active ? '支持' : '未标记'}`}
                    title={option.description}
                    disabled={busy}
                    onClick={() => toggleCapability(option.value)}
                  >
                    <ModelCapabilityIcon capability={option.value} />
                    <span>{option.label}</span>
                    {active ? <Check size={12} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            {notice ? (
              <p
                className={clsx(
                  'model-capability-dialog__notice',
                  phase === 'error' && 'is-error',
                  phase === 'success' && 'is-success',
                )}
                role={phase === 'error' ? 'alert' : 'status'}
              >
                {phase === 'probing' || phase === 'saving' ? (
                  <Loader2 size={13} className="model-settings-spin" aria-hidden="true" />
                ) : phase === 'success' ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <X size={13} aria-hidden="true" />
                )}
                <span>{notice}</span>
              </p>
            ) : (
              <p className="model-capability-dialog__notice">
                <Settings2 size={13} aria-hidden="true" />
                <span>
                  {model.capabilitiesConfirmed
                    ? '当前能力已经确认，可以重新检测或直接调整。'
                    : '当前能力尚未确认，建议检测后核对并保存。'}
                </span>
              </p>
            )}
          </section>
        </div>

        <footer className="model-capability-dialog__footer">
          <button
            type="button"
            className="model-capability-dialog__probe"
            disabled={busy}
            onClick={() => void runProbe()}
          >
            {phase === 'probing' ? (
              <Loader2 size={14} className="model-settings-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {phase === 'probing' ? '检测中' : '检测能力'}
          </button>
          <div>
            <RadixDialog.Close asChild>
              <button type="button" className="is-cancel" disabled={busy}>
                关闭
              </button>
            </RadixDialog.Close>
            <button
              type="button"
              className="is-primary"
              disabled={busy || !canSave}
              onClick={() => void saveCapabilities()}
            >
              {phase === 'saving' ? (
                <Loader2 size={14} className="model-settings-spin" />
              ) : (
                <Check size={14} />
              )}
              {phase === 'saving' ? '保存中' : canSave ? '保存能力' : '已保存'}
            </button>
          </div>
        </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function ModelRowPreview({ model }: { model: ProviderModelSummary | null }) {
  if (!model) return null;
  const title = modelPrimaryLabel(model);
  const ctx = formatContext(model.contextWindow);
  return (
    <div className="model-priority-row model-priority-row--overlay">
      <span className="model-priority-row__grip">
        <GripVertical size={14} />
      </span>
      <span className="model-priority-row__rank">·</span>
      <div className="model-priority-row__copy">
        <p title={title}>{title}</p>
      </div>
      <div className="model-priority-row__context">
        <span
          className={clsx(
            'model-priority-row__context-value',
            'inline-flex items-center gap-1',
            !ctx && 'is-empty',
          )}
        >
          <Gauge size={12} aria-hidden="true" className="shrink-0" />
          {ctx || '上下文'}
        </span>
      </div>
    </div>
  );
}

// ─── Global prefs ────────────────────────────────────────────────────────────

function enabledModelOptions(
  allModels: Array<{
    modelId: string;
    displayName: string;
    providerName: string;
    enabled: boolean;
  }>,
) {
  const enabled = allModels.filter((model) => model.enabled);
  return enabled.length > 0 ? enabled : allModels;
}

function VisionFallbackPanel({
  allModels,
  value,
  busy,
  onChange,
}: {
  allModels: Array<{
    modelId: string;
    providerModelId: string;
    displayName: string;
    providerName: string;
    enabled: boolean;
    capabilities: readonly string[];
    capabilitiesConfirmed: boolean;
  }>;
  value: VisionFallbackSetting;
  busy: boolean;
  onChange(value: VisionFallbackSetting): void;
}) {
  const options = allModels.filter(
    (model) => model.enabled && modelCanServeAsVisionFallback(model),
  );
  return (
    <div className="model-strategy-panel">
      <div className="model-strategy-panel__head">
        <span className="model-strategy-panel__icon">
          <Image size={16} />
        </span>
        <div>
          <h2>图片识别 Fallback</h2>
          <p>当前模型不支持识图时，自动切换到指定视觉模型。</p>
        </div>
        <Toggle
          checked={value.enabled}
          disabled={busy || options.length === 0}
          label="图片识别 Fallback"
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      <div className="model-strategy-panel__fields">
        <Field label="视觉模型">
          <ModelListSelect
            label="视觉模型"
            value={value.modelId ?? ''}
            placeholder="选择视觉模型…"
            disabled={!value.enabled || options.length === 0}
            options={options.map((model) => ({
              value: model.modelId,
              label: `${model.displayName} · ${model.providerName}`,
            }))}
            onChange={(modelId) => onChange({ ...value, modelId: modelId || null })}
          />
        </Field>
        <p className="model-strategy-panel__hint">
          {options.length > 0
            ? '仅显示已启用且支持图片输入的模型；更改会立即保存。'
            : '当前没有已启用且支持图片输入的模型，文本模型会自动使用 Windows OCR。'}
        </p>
      </div>
    </div>
  );
}

function ModelCloudSyncPanel({
  enabled,
  busy,
  onChange,
}: {
  enabled: boolean;
  busy: boolean;
  onChange(enabled: boolean): void;
}) {
  return (
    <div className="model-cloud-sync-panel">
      <section className="model-cloud-sync-card" aria-labelledby="model-cloud-sync-title">
        <h2 id="model-cloud-sync-title">云端同步</h2>
        <div className="model-cloud-sync-card__row">
          <div>
            <strong>模型配置云同步</strong>
            <p>
              将模型、供应商及 API Key
              等模型配置同步到云端（包含密钥，默认关闭）。开关对账号下所有设备生效。
            </p>
          </div>
          <Toggle
            checked={enabled}
            disabled={busy}
            label="模型配置云同步"
            onChange={onChange}
          />
        </div>
      </section>
    </div>
  );
}

function modelCanServeAsVisionFallback(model: {
  providerModelId: string;
  capabilities: readonly string[];
  capabilitiesConfirmed: boolean;
}): boolean {
  if (model.capabilitiesConfirmed) return model.capabilities.includes('vision');
  if (model.capabilities.includes('vision')) return true;
  const id = model.providerModelId.trim();
  return /gpt-4o|gpt-4\.1|gpt-5|\bo[34]\b|\bo[45]-|grok|gemini|claude|-vl\b|\/vl\d|vision|pixtral|llava|internvl/i.test(
    id,
  );
}

function PlanActPanel({
  allModels,
  value,
  busy,
  onChange,
}: {
  allModels: Array<{
    modelId: string;
    displayName: string;
    providerName: string;
    enabled: boolean;
  }>;
  value: PlanActSetting;
  busy: boolean;
  onChange(value: PlanActSetting): void;
}) {
  const options = enabledModelOptions(allModels);
  return (
    <div className="model-strategy-panel">
      <div className="model-strategy-panel__head">
        <span className="model-strategy-panel__icon">
          <Sparkles size={16} />
        </span>
        <div>
          <h2>规划 & 执行模型</h2>
          <p>将任务规划与实际执行分配给不同模型。</p>
        </div>
        <Toggle
          checked={value.enabled}
          disabled={busy}
          label="规划与执行模型"
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      <div className="model-strategy-panel__fields">
        <Field label="规划模型">
          <ModelListSelect
            label="规划模型"
            value={value.planModelId ?? ''}
            placeholder="选择规划模型…"
            disabled={!value.enabled}
            options={options.map((model) => ({
              value: model.modelId,
              label: `${model.displayName} · ${model.providerName}`,
            }))}
            onChange={(planModelId) => onChange({ ...value, planModelId: planModelId || null })}
          />
        </Field>
        <Field label="执行模型">
          <ModelListSelect
            label="执行模型"
            value={value.actModelId ?? ''}
            placeholder="选择执行模型…"
            disabled={!value.enabled}
            options={options.map((model) => ({
              value: model.modelId,
              label: `${model.displayName} · ${model.providerName}`,
            }))}
            onChange={(actModelId) => onChange({ ...value, actModelId: actModelId || null })}
          />
        </Field>
        <Field label="规划思考强度">
          <ModelListSelect
            label="规划思考强度"
            value={value.planReasoningEffort ?? ''}
            placeholder="跟随对话设置"
            disabled={!value.enabled}
            emptyOption={{ value: '', label: '跟随对话设置' }}
            options={REASONING_OPTIONS.map((option) => ({
              value: option.value,
              label: option.title,
            }))}
            onChange={(planReasoningEffort) =>
              onChange({ ...value, planReasoningEffort: planReasoningEffort || null })
            }
          />
        </Field>
        <Field label="执行思考强度">
          <ModelListSelect
            label="执行思考强度"
            value={value.actReasoningEffort ?? ''}
            placeholder="跟随对话设置"
            disabled={!value.enabled}
            emptyOption={{ value: '', label: '跟随对话设置' }}
            options={REASONING_OPTIONS.map((option) => ({
              value: option.value,
              label: option.title,
            }))}
            onChange={(actReasoningEffort) =>
              onChange({ ...value, actReasoningEffort: actReasoningEffort || null })
            }
          />
        </Field>
        <p className="model-strategy-panel__hint">
          规划模式强制使用规划模型；批准方案后的执行轮强制执行模型（含思考强度）；普通对话消息不干预，手动选择的模型照常生效。
        </p>
      </div>
    </div>
  );
}

// ─── Usage stats ─────────────────────────────────────────────────────────────

function UsageRangeControls({
  sinceDays,
  refreshing,
  onChange,
  onRefresh,
}: {
  sinceDays: number | undefined;
  refreshing: boolean;
  onChange: (value: number | undefined) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="usage-toolbar-actions">
      <div className="usage-range" role="group" aria-label="统计时间范围">
        {(
          [
            [1, '24h'],
            [7, '近 7 天'],
            [30, '近 30 天'],
            [undefined, '全部'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            className={sinceDays === value ? 'is-active' : undefined}
            onClick={() => onChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="usage-refresh"
        title="刷新"
        aria-label="刷新"
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
      </button>
    </div>
  );
}

export function UsageSettings({
  sinceDays,
  reloadToken,
  onRefreshingChange,
}: {
  sinceDays: number | undefined;
  reloadToken: number;
  onRefreshingChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageTab, setUsageTab] = useState<
    'requests' | 'providers' | 'models' | 'tools' | 'pricing'
  >('requests');
  const [modelQuery, setModelQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | null>(null);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);
  const hasDataRef = useRef(false);
  const onRefreshingChangeRef = useRef(onRefreshingChange);
  onRefreshingChangeRef.current = onRefreshingChange;

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.getUsageSummary) {
      setError('Runtime 未连接，无法加载用量');
      setLoading(false);
      onRefreshingChangeRef.current?.(false);
      return;
    }
    const silent = hasDataRef.current;
    if (!silent) setLoading(true);
    setError(null);
    onRefreshingChangeRef.current?.(silent);
    try {
      const res = await api.getUsageSummary(sinceDays ? { sinceDays } : {});
      setData(res);
      hasDataRef.current = true;
    } catch (e) {
      if (!hasDataRef.current) {
        setError(e instanceof Error ? e.message : '加载用量失败');
      }
    } finally {
      setLoading(false);
      onRefreshingChangeRef.current?.(false);
    }
  }, [sinceDays]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const savePricing = useCallback(
    async (nextPricing: ModelPricingEntry[]) => {
      const api = bridge();
      if (!api?.setSetting) throw new Error('Runtime 未连接，无法保存定价');
      setSavingPricing(true);
      try {
        await api.setSetting({ key: MODEL_PRICING_SETTING_KEY, value: nextPricing });
        setPricingDraft(null);
        setEditingPricingId(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存定价失败');
      } finally {
        setSavingPricing(false);
      }
    },
    [load],
  );

  if (loading && !data) {
    return (
      <div className="usage-settings-state">
        <Loader2 size={16} className="animate-spin" />
        <span>正在加载使用统计…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="usage-settings-state is-error">
        <p>{error}</p>
        <button type="button" className="usage-retry" onClick={() => void load()}>
          重新加载
        </button>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const requests = data?.requests ?? [];
  const tools = data?.tools ?? [];
  const pricing = data?.pricing ?? [];
  const normalizedQuery = modelQuery.trim().toLocaleLowerCase('zh-CN');
  const visibleRequests = requests.filter((request) => {
    const matchesModel = !normalizedQuery
      ? true
      : `${request.displayName ?? ''} ${request.modelId} ${request.providerName ?? ''}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery);
    const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
    return matchesModel && matchesStatus;
  });
  const providerRows = aggregateUsageByProvider(rows, data?.toolModels ?? []);
  const totalUsageTokens = splitProviderUsageTokens({
    tokensIn: data?.totalTokensIn ?? 0,
    tokensOut: data?.totalTokensOut ?? 0,
    cachedTokensHit: data?.totalCachedTokensHit,
    cachedTokensCreated: data?.totalCachedTokensCreated,
  });
  const hasCacheUsage =
    typeof data?.totalCachedTokensHit === 'number' ||
    typeof data?.totalCachedTokensCreated === 'number';
  const cacheReadReported = requests.reduce(
    (summary, request) => {
      if (typeof request.cachedTokensHit !== 'number') return summary;
      const tokens = splitProviderUsageTokens(request);
      summary.requests += 1;
      summary.inputTokens += tokens.totalInputTokens;
      summary.readTokens += tokens.cacheReadTokens;
      return summary;
    },
    { requests: 0, inputTokens: 0, readTokens: 0 },
  );
  const totalCostLabel = formatCurrencyTotalsKpi(data?.totalCostByCurrency ?? {});
  const cacheHitRequests = requests.filter(
    (request) => typeof request.cachedTokensHit === 'number' && request.cachedTokensHit > 0,
  ).length;
  const cacheReportedRequests = requests.filter(
    (request) => typeof request.cachedTokensHit === 'number',
  ).length;
  const tokenHitRate =
    cacheReadReported.requests > 0 && cacheReadReported.inputTokens > 0
      ? formatRate(cacheReadReported.readTokens, cacheReadReported.inputTokens)
      : '-';
  const requestHitRate =
    cacheReportedRequests > 0 ? formatRate(cacheHitRequests, cacheReportedRequests) : '-';
  const totalToolCalls = tools.reduce((sum, row) => sum + row.calls, 0);
  const totalToolSuccesses = tools.reduce((sum, row) => sum + row.successes, 0);
  const totalToolFailures = tools.reduce((sum, row) => sum + row.failures, 0);
  const totalToolSuccessRate = totalToolCalls > 0 ? (totalToolSuccesses / totalToolCalls) * 100 : 0;

  const openNewPricing = () => {
    setEditingPricingId(null);
    setPricingDraft({ ...EMPTY_PRICING_DRAFT });
  };
  const openEditPricing = (entry: ModelPricingEntry) => {
    setEditingPricingId(entry.modelId);
    setPricingDraft({ ...entry });
  };
  const commitPricingDraft = () => {
    if (!pricingDraft) return;
    const normalized: ModelPricingEntry = {
      ...pricingDraft,
      modelId: pricingDraft.modelId.trim(),
      displayName: pricingDraft.displayName.trim(),
    };
    if (!normalized.modelId || !normalized.displayName) {
      setError('模型 ID 和显示名不能为空');
      return;
    }
    const duplicate = pricing.some(
      (entry) => entry.modelId === normalized.modelId && entry.modelId !== editingPricingId,
    );
    if (duplicate) {
      setError('该模型 ID 已存在');
      return;
    }
    const next = editingPricingId
      ? pricing.map((entry) => (entry.modelId === editingPricingId ? normalized : entry))
      : [...pricing, normalized];
    void savePricing(next);
  };

  return (
    <div className="usage-settings">
      <div className="usage-metrics">
        <UsageMetric label="总请求" value={formatCount(data?.totalRequests ?? 0)} />
        <UsageMetric
          label="总费用"
          value={totalCostLabel}
          hint="授权登录使用订阅额度，不计入总费用；其他费用以供应商最终结算为准"
        />
        <UsageMetric
          label="总 Token"
          value={formatTokenCount(totalUsageTokens.totalTokens)}
          hint={`输入 ${formatTokenCount(totalUsageTokens.totalInputTokens)} / 输出 ${formatTokenCount(totalUsageTokens.outputTokens)}`}
        />
        <UsageMetric
          label="缓存命中率"
          value={tokenHitRate === '-' ? '-' : `按 Token ${tokenHitRate}`}
          hint={
            hasCacheUsage
              ? `按请求 ${requestHitRate} · 命中 ${formatTokenCount(totalUsageTokens.cacheReadTokens)} / 创建 ${formatTokenCount(totalUsageTokens.cacheWriteTokens)}`
              : '当前供应商未返回缓存用量'
          }
        />
      </div>

      <SlidingTabs className="usage-tabs" aria-label="统计视图">
        {[
          ['requests', '请求日志'],
          ['providers', '供应商统计'],
          ['models', '模型统计'],
          ['tools', '工具统计'],
          ['pricing', '定价配置'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={usageTab === id}
            className={usageTab === id ? 'is-active' : undefined}
            onClick={() => setUsageTab(id as typeof usageTab)}
          >
            {label}
          </button>
        ))}
      </SlidingTabs>

      {usageTab === 'requests' ? (
        <section className="usage-panel">
          <div className="usage-filters">
            <input
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder="按模型筛选..."
              aria-label="按模型筛选"
            />
            <div className="usage-status-filter" role="group" aria-label="请求状态">
              {(
                [
                  ['all', '全部'],
                  ['success', '成功'],
                  ['failed', '失败'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  className={statusFilter === value ? 'is-active' : undefined}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="usage-record-count">共 {visibleRequests.length} 条记录</span>
          </div>
          <UsageRequestTable rows={visibleRequests} />
        </section>
      ) : null}

      {usageTab === 'providers' ? <UsageProviderTable rows={providerRows} /> : null}
      {usageTab === 'models' ? (
        <UsageModelTable
          rows={rows.map((row) => ({
            key: `${row.providerId ?? ''}:${row.modelId}`,
            label: row.displayName ?? row.modelId,
            secondary: row.providerName ?? row.providerId,
            requests: row.requests,
            succeededRequests: row.succeededRequests,
            failedRequests: row.failedRequests,
            tokensIn: row.tokensIn,
            tokensOut: row.tokensOut,
            totalCost: row.totalCost,
            currency: row.currency,
            averageLatencyMs: row.averageLatencyMs,
            lastUsedAt: row.lastUsedAt,
          }))}
        />
      ) : null}
      {usageTab === 'tools' ? (
        <UsageToolPanel
          rows={tools}
          modelRows={data?.toolModels ?? []}
          failures={data?.toolFailures ?? []}
          totals={{
            calls: totalToolCalls,
            successes: totalToolSuccesses,
            failures: totalToolFailures,
            successRate: totalToolSuccessRate,
          }}
        />
      ) : null}
      {usageTab === 'pricing' ? (
        <PricingTable
          entries={pricing}
          draft={pricingDraft}
          editingId={editingPricingId}
          saving={savingPricing}
          onAdd={openNewPricing}
          onEdit={openEditPricing}
          onCancel={() => {
            setPricingDraft(null);
            setEditingPricingId(null);
          }}
          onDraftChange={setPricingDraft}
          onSave={commitPricingDraft}
          onDelete={(entry) =>
            void savePricing(pricing.filter((row) => row.modelId !== entry.modelId))
          }
        />
      ) : null}
    </div>
  );
}

function UsageMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className={clsx('usage-metric', tone && `is-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

type AggregateUsageRow = {
  key: string;
  label: string;
  secondary?: string;
  requests: number;
  succeededRequests: number;
  failedRequests: number;
  tokensIn: number;
  tokensOut: number;
  totalCost?: number;
  currency?: 'USD' | 'CNY';
  averageLatencyMs?: number;
  toolSuccessRate?: number;
  lastUsedAt?: string;
};

function aggregateUsageByProvider(
  rows: UsageSummaryResponse['rows'],
  toolModels: UsageSummaryResponse['toolModels'],
): AggregateUsageRow[] {
  const aggregated = new Map<string, AggregateUsageRow & { latencyWeightedTotal: number }>();
  for (const row of rows) {
    const key = row.providerId ?? row.providerName ?? 'unknown';
    const current = aggregated.get(key) ?? {
      key,
      label: row.providerName ?? row.providerId ?? '未知供应商',
      requests: 0,
      succeededRequests: 0,
      failedRequests: 0,
      tokensIn: 0,
      tokensOut: 0,
      latencyWeightedTotal: 0,
      lastUsedAt: row.lastUsedAt,
    };
    current.requests += row.requests;
    current.succeededRequests += row.succeededRequests;
    current.failedRequests += row.failedRequests;
    current.tokensIn += row.tokensIn;
    current.tokensOut += row.tokensOut;
    if (typeof row.averageLatencyMs === 'number') {
      current.latencyWeightedTotal += row.averageLatencyMs * row.requests;
      current.averageLatencyMs = current.latencyWeightedTotal / Math.max(1, current.requests);
    }
    if (typeof row.totalCost === 'number' && row.currency) {
      if (!current.currency || current.currency === row.currency) {
        current.currency = row.currency;
        current.totalCost = (current.totalCost ?? 0) + row.totalCost;
      } else {
        current.currency = undefined;
        current.totalCost = undefined;
      }
    }
    if (!current.lastUsedAt || (row.lastUsedAt && row.lastUsedAt > current.lastUsedAt)) {
      current.lastUsedAt = row.lastUsedAt;
    }
    aggregated.set(key, current);
  }
  return Array.from(aggregated.values())
    .map(({ latencyWeightedTotal: _latencyTotal, ...row }) => {
      const providerTools = toolModels.filter((tool) => tool.providerId === row.key);
      const toolCalls = providerTools.reduce((sum, tool) => sum + tool.calls, 0);
      const toolSuccesses = providerTools.reduce((sum, tool) => sum + tool.successes, 0);
      return {
        ...row,
        toolSuccessRate: toolCalls > 0 ? (toolSuccesses / toolCalls) * 100 : undefined,
      };
    })
    .sort((left, right) => right.tokensIn + right.tokensOut - (left.tokensIn + left.tokensOut));
}

function UsageTokenTip({
  inputTokens,
  outputTokens,
  totalTokens,
  cacheReadTokens,
  cacheWriteTokens,
}: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="usage-token-tip"
        aria-label="Token 明细"
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {open
        ? createPortal(
            <div
              className="usage-token-tip__panel"
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
            >
              <strong>Token 明细</strong>
              <dl>
                <div>
                  <dt>输入 Token</dt>
                  <dd>{formatTokenCount(inputTokens)}</dd>
                </div>
                <div>
                  <dt>输出 Token</dt>
                  <dd>{formatTokenCount(outputTokens)}</dd>
                </div>
                {typeof cacheReadTokens === 'number' ? (
                  <div>
                    <dt>缓存读取</dt>
                    <dd>{formatTokenCount(cacheReadTokens)}</dd>
                  </div>
                ) : null}
                {typeof cacheWriteTokens === 'number' ? (
                  <div>
                    <dt>缓存创建</dt>
                    <dd>{formatTokenCount(cacheWriteTokens)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>总 Token</dt>
                  <dd className="is-total">{formatTokenCount(totalTokens)}</dd>
                </div>
              </dl>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function UsageRequestTable({ rows }: { rows: UsageSummaryResponse['requests'] }) {
  if (rows.length === 0) {
    return <div className="usage-table-empty">暂无符合条件的请求记录</div>;
  }
  return (
    <div className="usage-table-wrap">
      <table className="usage-table usage-request-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>供应商</th>
            <th>模型</th>
            <th>Token</th>
            <th>费用</th>
            <th>延迟</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tokens = splitProviderUsageTokens(row);
            const cacheReadReported = typeof row.cachedTokensHit === 'number';
            const cacheWriteReported = typeof row.cachedTokensCreated === 'number';
            const displayName = row.displayName ?? row.modelId;
            return (
              <tr key={row.requestId} className="usage-request-row">
                <td className="usage-request-time">
                  <span>{formatTimestamp(row.occurredAt)}</span>
                </td>
                <td title={row.providerId}>{row.providerName ?? row.providerId ?? '-'}</td>
                <td className="usage-request-model" title={row.modelId}>
                  {displayName}
                </td>
                <td className="usage-token-cell">
                  <span className="usage-token-cell__value">
                    <span>{formatTokenCount(row.totalTokens)}</span>
                    <UsageTokenTip
                      inputTokens={tokens.totalInputTokens}
                      outputTokens={tokens.outputTokens}
                      totalTokens={row.totalTokens}
                      cacheReadTokens={cacheReadReported ? tokens.cacheReadTokens : undefined}
                      cacheWriteTokens={cacheWriteReported ? tokens.cacheWriteTokens : undefined}
                    />
                  </span>
                </td>
                <td className="usage-request-cost">
                  {formatCurrency(row.estimatedCost, row.currency)}
                </td>
                <td>{typeof row.latencyMs === 'number' ? formatLatency(row.latencyMs) : '-'}</td>
                <td>
                  <span className={`usage-status is-${row.status}`}>
                    {row.status === 'success'
                      ? '成功'
                      : row.status === 'failed'
                        ? '失败'
                        : '未结束'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsageProviderTable({ rows }: { rows: AggregateUsageRow[] }) {
  if (rows.length === 0) return <div className="usage-table-empty">暂无供应商统计数据</div>;
  return (
    <div className="usage-table-wrap usage-aggregate-table">
      <table className="usage-table">
        <thead>
          <tr>
            <th>供应商</th>
            <th>请求数</th>
            <th>总 Token</th>
            <th>总费用</th>
            <th>请求成功率</th>
            <th>工具成功率</th>
            <th>平均延迟</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{formatCount(row.requests)}</td>
              <td>{formatTokenCount(row.tokensIn + row.tokensOut)}</td>
              <td>{formatCurrency(row.totalCost, row.currency)}</td>
              <td className="usage-positive">{formatRate(row.succeededRequests, row.requests)}</td>
              <td className="usage-positive">
                {typeof row.toolSuccessRate === 'number'
                  ? `${row.toolSuccessRate.toFixed(1)}%`
                  : '-'}
              </td>
              <td>
                {typeof row.averageLatencyMs === 'number'
                  ? formatLatency(row.averageLatencyMs)
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageModelTable({ rows }: { rows: AggregateUsageRow[] }) {
  if (rows.length === 0) return <div className="usage-table-empty">暂无模型统计数据</div>;
  return (
    <div className="usage-table-wrap usage-aggregate-table">
      <table className="usage-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>请求数</th>
            <th>总 Token</th>
            <th>总费用</th>
            <th>单次均费</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                {row.label}
                {row.secondary ? <small>{row.secondary}</small> : null}
              </td>
              <td>{formatCount(row.requests)}</td>
              <td>{formatTokenCount(row.tokensIn + row.tokensOut)}</td>
              <td>{formatCurrency(row.totalCost, row.currency)}</td>
              <td>
                {formatCurrency(
                  typeof row.totalCost === 'number' && row.requests > 0
                    ? row.totalCost / row.requests
                    : undefined,
                  row.currency,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageToolPanel({
  rows,
  modelRows,
  failures,
  totals,
}: {
  rows: UsageSummaryResponse['tools'];
  modelRows: UsageSummaryResponse['toolModels'];
  failures: UsageSummaryResponse['toolFailures'];
  totals: { calls: number; successes: number; failures: number; successRate: number };
}) {
  return (
    <section className="usage-tool-panel">
      <div className="usage-tool-metrics">
        <UsageMetric label="总调用" value={formatCount(totals.calls)} />
        <UsageMetric label="成功" value={formatCount(totals.successes)} tone="positive" />
        <UsageMetric label="失败" value={formatCount(totals.failures)} tone="negative" />
        <UsageMetric label="成功率" value={`${totals.successRate.toFixed(1)}%`} tone="positive" />
      </div>

      <div className="usage-tool-section">
        <h4>模型级工具统计</h4>
        {modelRows.length === 0 ? (
          <div className="usage-table-empty is-compact">暂无模型工具统计</div>
        ) : (
          <div className="usage-table-wrap is-compact">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>调用数</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>成功率</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row) => (
                  <tr key={row.modelId}>
                    <td title={row.modelId}>{row.displayName ?? row.modelId}</td>
                    <td>{formatCount(row.calls)}</td>
                    <td>{formatCount(row.successes)}</td>
                    <td>{formatCount(row.failures)}</td>
                    <td className="usage-positive">{row.successRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="usage-tool-section">
        <h4>工具调用明细</h4>
        {rows.length === 0 ? (
          <div className="usage-table-empty is-compact">暂无工具调用数据</div>
        ) : (
          <div className="usage-table-wrap is-compact">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>工具</th>
                  <th>调用数</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>成功率</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.toolName}>
                    <td>{row.toolName}</td>
                    <td>{formatCount(row.calls)}</td>
                    <td>{formatCount(row.successes)}</td>
                    <td>{formatCount(row.failures)}</td>
                    <td className="usage-positive">{row.successRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="usage-tool-section usage-tool-failures">
        <div className="usage-section-heading">
          <h4>最近失败记录</h4>
          <span>共 {failures.length} 条失败记录</span>
        </div>
        {failures.length === 0 ? (
          <div className="usage-table-empty is-compact">暂无失败记录</div>
        ) : (
          <div className="usage-table-wrap is-compact">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>工具</th>
                  <th>对话</th>
                  <th>模型</th>
                  <th>错误摘要</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((row, index) => (
                  <tr key={`${row.occurredAt}:${row.toolName}:${index}`}>
                    <td>{formatTimestamp(row.occurredAt)}</td>
                    <td>{row.toolName}</td>
                    <td>{row.conversationTitle ?? '-'}</td>
                    <td>{row.displayName ?? row.modelId ?? '-'}</td>
                    <td className="usage-error" title={row.errorSummary}>
                      {row.errorSummary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function PricingTable({
  entries,
  draft,
  editingId,
  saving,
  onAdd,
  onEdit,
  onCancel,
  onDraftChange,
  onSave,
  onDelete,
}: {
  entries: ModelPricingEntry[];
  draft: PricingDraft | null;
  editingId: string | null;
  saving: boolean;
  onAdd: () => void;
  onEdit: (entry: ModelPricingEntry) => void;
  onCancel: () => void;
  onDraftChange: (draft: PricingDraft) => void;
  onSave: () => void;
  onDelete: (entry: ModelPricingEntry) => void;
}) {
  const setNumber = (
    key: keyof Pick<
      PricingDraft,
      'inputPerMillion' | 'outputPerMillion' | 'cacheReadPerMillion' | 'cacheWritePerMillion'
    >,
    value: string,
  ) => {
    if (!draft) return;
    onDraftChange({ ...draft, [key]: Math.max(0, Number(value) || 0) });
  };
  return (
    <section className="usage-pricing-panel">
      <div className="usage-pricing-toolbar">
        <span>共 {entries.length} 个模型定价</span>
        <button type="button" onClick={onAdd}>
          <Plus size={13} /> 添加
        </button>
      </div>
      {draft ? (
        <div className="usage-pricing-form">
          <input
            value={draft.modelId}
            disabled={saving}
            placeholder="模型 ID"
            onChange={(event) => onDraftChange({ ...draft, modelId: event.target.value })}
          />
          <input
            value={draft.displayName}
            disabled={saving}
            placeholder="显示名"
            onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })}
          />
          <select
            value={draft.currency}
            disabled={saving}
            onChange={(event) =>
              onDraftChange({ ...draft, currency: event.target.value as 'USD' | 'CNY' })
            }
          >
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.inputPerMillion}
            disabled={saving}
            aria-label="输入每百万 Token 单价"
            onChange={(event) => setNumber('inputPerMillion', event.target.value)}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.outputPerMillion}
            disabled={saving}
            aria-label="输出每百万 Token 单价"
            onChange={(event) => setNumber('outputPerMillion', event.target.value)}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.cacheReadPerMillion}
            disabled={saving}
            aria-label="缓存读每百万 Token 单价"
            onChange={(event) => setNumber('cacheReadPerMillion', event.target.value)}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.cacheWritePerMillion}
            disabled={saving}
            aria-label="缓存建每百万 Token 单价"
            onChange={(event) => setNumber('cacheWritePerMillion', event.target.value)}
          />
          <div className="usage-pricing-form-actions">
            <button type="button" onClick={onSave} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存' : '添加'}
            </button>
            <button type="button" className="is-secondary" onClick={onCancel} disabled={saving}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      <div className="usage-table-wrap usage-pricing-table">
        <table className="usage-table">
          <thead>
            <tr>
              <th>模型 ID</th>
              <th>显示名</th>
              <th>币种</th>
              <th>输入/M</th>
              <th>输出/M</th>
              <th>缓存读/M</th>
              <th>缓存建/M</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.modelId}>
                <td className="usage-model-id" title={entry.modelId}>
                  {entry.modelId}
                </td>
                <td>{entry.displayName}</td>
                <td>{entry.currency}</td>
                <td>{formatCurrency(entry.inputPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.outputPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.cacheReadPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.cacheWritePerMillion, entry.currency)}</td>
                <td>
                  <div className="usage-row-actions">
                    <button type="button" title="编辑" onClick={() => onEdit(entry)}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" title="删除" onClick={() => onDelete(entry)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatLatency(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function EmptyDetail({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border-b border-border px-6 py-16 text-center">
      <Server size={28} className="text-text-faint" />
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
        onClick={onAdd}
      >
        <Plus size={14} /> 添加模型
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="model-field-label">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('model-toggle', checked && 'is-checked')}
    >
      <span className="model-toggle__thumb" />
    </button>
  );
}

function formatCurrency(value: number | undefined, currency: 'USD' | 'CNY' | undefined): string {
  if (typeof value !== 'number' || !currency) return '-';
  const symbol = currency === 'CNY' ? '¥' : '$';
  const digits = value >= 1 ? 2 : value > 0 ? 4 : 2;
  return `${symbol}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: value === 0 ? 2 : 0,
    maximumFractionDigits: digits,
  })}`;
}

function formatCurrencyTotalsKpi(totals: Partial<Record<'USD' | 'CNY', number>>): string {
  const values = (['CNY', 'USD'] as const).flatMap((currency) => {
    const value = totals[currency];
    if (typeof value !== 'number') return [];
    const symbol = currency === 'CNY' ? '¥' : '$';
    return [
      `${symbol}${value.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    ];
  });
  return values.length > 0 ? values.join(' / ') : '-';
}

function formatRate(successes: number, total: number): string {
  return total > 0 ? `${((successes / total) * 100).toFixed(1)}%` : '-';
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
