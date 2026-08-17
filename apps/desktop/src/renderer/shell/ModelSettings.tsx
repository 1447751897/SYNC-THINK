// NewMax-style model source settings: dual-pane provider manager + global model prefs.
// Left: ordered provider list with enable toggles.
// Right: selected provider detail (endpoint / keys / models / priority) + global vision/plan-act.
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Database,
  Gauge,
  GripVertical,
  Image,
  Loader2,
  Mic2,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Eye,
  EyeOff,
  Download,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type {
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
import { REASONING_OPTIONS } from './compose-toolbar.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProtocolFamily = 'openai-chat' | 'openai-responses' | 'openai-images' | 'anthropic-messages';

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

interface ImportDialogState {
  providerId: string;
  protocol: ProtocolFamily;
  discovered: Array<{ providerModelId: string; displayName: string; alreadyAdded: boolean }>;
  selectedIds: string[];
  query: string;
  applying: boolean;
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

interface CreateDraft {
  name: string;
  baseUrl: string;
  protocol: ProtocolFamily;
  apiKey: string;
  supportsDiscovery: boolean;
}

const EMPTY_CREATE: CreateDraft = {
  name: '',
  baseUrl: 'https://',
  protocol: 'openai-chat',
  apiKey: '',
  supportsDiscovery: true,
};

type ProviderCatalogCategory =
  | 'recommended'
  | 'domestic'
  | 'aggregator'
  | 'overseas'
  | 'local';

type CreateProviderStep = 'catalog' | 'form' | 'cc-switch';

interface ProviderCatalogItem {
  id: string;
  name: string;
  description: string;
  action: 'form' | 'cc-switch';
  endpointMode?: 'builtin' | 'custom';
  badge?: string;
  draft?: Partial<CreateDraft>;
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
  draft: EMPTY_CREATE,
};

const CC_SWITCH_ITEM: ProviderCatalogItem = {
  id: 'cc-switch',
  name: '从 CC Switch 导入',
  description: '读取本机 CC Switch 中已配置的供应商',
  action: 'cc-switch',
};

const PROVIDER_CATALOG: Record<ProviderCatalogCategory, ProviderCatalogItem[]> = {
  recommended: [
    {
      id: 'newmax-gateway',
      name: 'NewMax Gateway',
      description: '统一网关入口，连接现有 NewMax 兼容服务',
      action: 'form',
      badge: '推荐',
      draft: {
        name: 'NewMax Gateway',
        baseUrl: 'https://',
        protocol: 'openai-chat',
        supportsDiscovery: true,
      },
    },
    CUSTOM_PROVIDER_ITEM,
    CC_SWITCH_ITEM,
  ],
  domestic: [
    {
      id: 'minimax-cn',
      name: 'MiniMax',
      description: 'MiniMax 国内 API，支持文本与编程模型',
      action: 'form',
      draft: {
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'kimi-coding',
      name: 'Kimi Coding Plan',
      description: 'Kimi 智能编程增强版',
      action: 'form',
      draft: { name: 'Kimi Coding Plan', baseUrl: 'https://', protocol: 'openai-chat' },
    },
    {
      id: 'moonshot',
      name: 'Moonshot',
      description: '月之暗面开放平台，按量付费',
      action: 'form',
      draft: {
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'zhipu',
      name: '智谱',
      description: '智谱 GLM 开放平台',
      action: 'form',
      draft: {
        name: '智谱',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai-chat',
      },
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      description: 'DeepSeek 官方 API，按量付费',
      action: 'form',
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
      draft: {
        name: '百炼 Coding Plan',
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
}

export const ModelSettings = forwardRef<
  ModelSettingsHandle,
  {
    onCatalogChanged?: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function ModelSettings({ onCatalogChanged, onDirtyChange }, ref) {
  const dialog = useDialog();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<UiOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<SettingsToast | null>(null);
  const toastSequence = useRef(0);
  const toastTimer = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [disabledOpen, setDisabledOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<CreateProviderStep>('catalog');
  const [catalogCategory, setCatalogCategory] =
    useState<ProviderCatalogCategory>('recommended');
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [createTemplate, setCreateTemplate] = useState<ProviderCatalogItem | null>(null);
  const [ccSwitchPreview, setCcSwitchPreview] =
    useState<PreviewCcSwitchImportResponse | null>(null);
  const [selectedCcSwitchIds, setSelectedCcSwitchIds] = useState<string[]>([]);
  const [ccSwitchLoading, setCcSwitchLoading] = useState(false);
  const [ccSwitchImporting, setCcSwitchImporting] = useState(false);
  const [modelTab, setModelTab] = useState<'text' | 'image' | 'video' | 'voice' | 'usage'>('text');
  const [detailView, setDetailView] = useState<
    'provider' | 'vision' | 'plan-act' | 'goal-evaluator'
  >('provider');
  const [visionFallback, setVisionFallback] = useState<VisionFallbackSetting>({
    enabled: false,
    modelId: null,
  });
  const [goalEvaluatorModelId, setGoalEvaluatorModelId] = useState<string | null>(null);
  const [planAct, setPlanAct] = useState<PlanActSetting>({
    enabled: false,
    planModelId: null,
    actModelId: null,
    planReasoningEffort: null,
    actReasoningEffort: null,
  });

  const [providerOrders, setProviderOrders] = useState<Record<string, ProviderModelSummary[]>>({});
  const selectedProvider = providers.find((provider) => provider.providerId === selectedId) ?? null;
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
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ id: ++toastSequence.current, kind, message });
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const allModels = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
          providerName: p.name,
          providerId: p.providerId,
          enabled: p.enabled,
        })),
      ),
    [providers],
  );

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.listProviders) {
      setError('Runtime 未连接，无法加载模型源');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [listed, settings] = await Promise.all([
        api.listProviders({}),
        api.getSettings?.({ keys: ['vision-fallback', 'plan-act', 'goal.evaluator-model'] }) ??
          Promise.resolve({ settings: {} as Record<string, unknown> }),
      ]);
      const next = [...listed.providers].sort((a, b) => a.sortOrder - b.sortOrder);
      setProviders(next);
      setVisionFallback(parseVisionFallback(settings.settings?.['vision-fallback']));
      setPlanAct(parsePlanAct(settings.settings?.['plan-act']));
      const storedEvaluator = settings.settings?.['goal.evaluator-model'];
      setGoalEvaluatorModelId(
        typeof storedEvaluator === 'string' && storedEvaluator.trim()
          ? storedEvaluator.trim()
          : null,
      );
      setSelectedId((prev) => {
        if (prev && next.some((p) => p.providerId === prev)) return prev;
        return next[0]?.providerId ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载模型源失败');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(null);
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
        const message = e instanceof Error ? e.message : '操作失败';
        setError(message);
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

  const handleCreate = () =>
    void withBusy({ kind: 'create-provider', label: '正在创建供应商…' }, async () => {
      const api = bridge();
      if (!api?.createProvider) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = createDraft.apiKey.trim();
      const usesCustomEndpoint = createTemplate?.endpointMode === 'custom';
      if (!name) throw new Error('请填写供应商名称');
      if (usesCustomEndpoint && (!baseUrl || baseUrl === 'https://')) {
        throw new Error('请填写 Base URL');
      }
      if (!usesCustomEndpoint && (!baseUrl || baseUrl === 'https://')) {
        throw new Error('该服务商模板尚未配置连接地址');
      }
      if (!apiKey) throw new Error('请填写 API Key，并先复制到剪贴板');
      await navigator.clipboard.writeText(apiKey);
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol: createDraft.protocol,
        supportsDiscovery: createDraft.supportsDiscovery,
      });
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      setCreateStep('catalog');
      setCreateTemplate(null);
      setSelectedId(result.provider.providerId);
      setLastSelectedId(result.provider.providerId);
      await load();
      showToast(
        'success',
        `已创建 ${result.provider.name} · 发现 ${result.discoveredModelCount} 个模型`,
      );
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
    setCreateDraft({ ...EMPTY_CREATE, ...(item.draft ?? {}) });
    setCreateTemplate(item);
    setCreateStep('form');
  }, []);

  const openCcSwitchImport = useCallback(async () => {
    const api = bridge();
    setCreateStep('cc-switch');
    setCreateTemplate(null);
    setCcSwitchLoading(true);
    setCcSwitchPreview(null);
    setSelectedCcSwitchIds([]);
    setError(null);
    try {
      if (!api?.previewCcSwitchImport) throw new Error('Runtime 未连接，无法读取 CC Switch');
      const preview = await api.previewCcSwitchImport({});
      setCcSwitchPreview(preview);
      setSelectedCcSwitchIds(
        preview.items.filter((item) => item.importable).map((item) => item.sourceId),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : '读取 CC Switch 配置失败';
      setError(message);
      showToast('error', message);
    } finally {
      setCcSwitchLoading(false);
    }
  }, [showToast]);

  const handleCcSwitchImport = useCallback(async () => {
    if (selectedCcSwitchIds.length === 0 || ccSwitchImporting) return;
    const api = bridge();
    setCcSwitchImporting(true);
    setError(null);
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
      const message = e instanceof Error ? e.message : '导入 CC Switch 失败';
      setError(message);
      showToast('error', message);
    } finally {
      setCcSwitchImporting(false);
    }
  }, [
    ccSwitchImporting,
    load,
    onCatalogChanged,
    resetCreateState,
    selectedCcSwitchIds,
    showToast,
  ]);

  const persistProviderOrder = useCallback(
    async (orderedEnabled: ProviderSummary[], previousProviders = providers) => {
      const api = bridge();
      if (!api?.reorderProviders) throw new Error('Runtime 未连接');
      const disabled = previousProviders.filter((provider) => !provider.enabled);
      await api.reorderProviders({
        orderedProviderIds: [...orderedEnabled, ...disabled].map(
          (provider) => provider.providerId as never,
        ),
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
    const enabled = previous.filter((provider) => provider.enabled);
    const oldIndex = enabled.findIndex((provider) => provider.providerId === activeId);
    const newIndex = enabled.findIndex((provider) => provider.providerId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextEnabled = arrayMove(enabled, oldIndex, newIndex);
    const nextProviders = [...nextEnabled, ...previous.filter((provider) => !provider.enabled)];
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
      '模型顺序已更新',
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
    if (enabled) setDisabledOpen(true);
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
        return ok;
      } catch (error) {
        const latencyMs = Math.max(0, Date.now() - startedAt);
        const failed: ConnectionTestState = {
          status: 'error',
          latencyMs,
          message: error instanceof Error ? error.message : '连接失败',
        };
        setConnectionTest(providerId, failed);
        return failed;
      }
    },
    [providers, setConnectionTest],
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
        showToast('error', error instanceof Error ? error.message : '拉取模型失败');
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
      const provider = providers.find((item) => item.providerId === dialog.providerId);
      if (!provider) return;

      setImportDialog((current) => (current ? { ...current, applying: true } : current));
      setOperation({
        kind: 'import-models',
        targetId: dialog.providerId,
        label: '正在更新模型列表…',
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
            providerId: dialog.providerId as never,
            modelId: model.modelId as never,
          });
        }
        if (toAdd.length > 0) {
          await api.addModels({
            providerId: dialog.providerId as never,
            protocol: dialog.protocol,
            models: toAdd.map((item) => ({
              providerModelId: item.providerModelId,
              displayName: item.displayName || item.providerModelId,
            })),
          });
        }

        // Re-read and re-order: keep previously selected order, append new ones.
        const listed = await api.listProviders({});
        const nextProviders = [...listed.providers].sort((a, b) => a.sortOrder - b.sortOrder);
        const refreshed = nextProviders.find((item) => item.providerId === dialog.providerId);
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
              providerId: dialog.providerId as never,
              entries: orderedModels.map((model) => ({
                modelId: model.modelId as never,
                credentialRefId: (model.credentialRefId ?? undefined) as never,
              })),
            });
            // Apply priorities onto the freshly listed tree.
            setProviders(
              nextProviders.map((item) =>
                item.providerId === dialog.providerId ? { ...item, models: result.models } : item,
              ),
            );
            setProviderOrders((current) => ({
              ...current,
              [dialog.providerId]: result.models,
            }));
          } else {
            setProviders(
              nextProviders.map((item) =>
                item.providerId === dialog.providerId ? { ...item, models: [] } : item,
              ),
            );
            setProviderOrders((current) => ({ ...current, [dialog.providerId]: [] }));
          }
        } else {
          setProviders(nextProviders);
        }
        setImportDialog(null);
        onCatalogChanged?.();
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : '更新模型列表失败');
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
      `模型 ${providerModelId} 已添加`,
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
      '上下文窗口已更新',
    );

  const handleMoveModel = (provider: ProviderSummary, modelId: string, direction: -1 | 1) => {
    const ordered = [...provider.models].sort((a, b) => a.priority - b.priority);
    const idx = ordered.findIndex((m) => m.modelId === modelId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= ordered.length) return;
    const next = arrayMove(ordered, idx, target);
    handleReorderModels(provider, next);
  };

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
      '图片识别 Fallback 已更新',
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
      '规划与执行模型已更新',
    );
  };

  const handleSaveGoalEvaluator = (modelId: string | null) => {
    const previous = goalEvaluatorModelId;
    setGoalEvaluatorModelId(modelId);
    void withBusy(
      { kind: 'save-preference', label: '正在保存目标模式评估模型…' },
      async () => {
        const api = bridge();
        if (!api?.setSetting) throw new Error('Runtime 未连接');
        try {
          await api.setSetting({ key: 'goal.evaluator-model', value: modelId });
        } catch (error) {
          setGoalEvaluatorModelId(previous);
          throw error;
        }
      },
      modelId ? '目标模式评估模型已更新' : '已停用目标模式评估器',
    );
  };

  const createDraftDirty =
    showCreate &&
    createStep === 'form' &&
    (Boolean(createDraft.name.trim()) ||
      createDraft.baseUrl !== EMPTY_CREATE.baseUrl ||
      createDraft.protocol !== EMPTY_CREATE.protocol ||
      Boolean(createDraft.apiKey.trim()) ||
      createDraft.supportsDiscovery !== EMPTY_CREATE.supportsDiscovery);
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
    setError(null);
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
          setError(result.message || '连接测试失败');
          showToast('error', result.message || '连接测试失败');
          return false;
        }
      }
      onCatalogChanged?.();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接测试失败';
      setError(message);
      showToast('error', message);
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
    }),
    [completeSettings],
  );

  const confirmDiscardChanges = useCallback(async (): Promise<boolean> => {
    if (!hasTransientDraft) return true;
    return dialog.confirm({
      title: '放弃未提交的修改',
      message: '当前有未提交的模型配置草稿，确认放弃并继续吗？',
      confirmText: '放弃',
      danger: false,
    });
  }, [hasTransientDraft, dialog]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-faint">
        <Loader2 size={16} className="animate-spin" /> 加载模型源…
      </div>
    );
  }

  const enabledProviders = providers.filter((provider) => provider.enabled);
  const disabledProviders = providers.filter((provider) => !provider.enabled);

  return (
    <div className="model-settings-root flex h-full min-h-0 flex-col">
      <div className="model-settings-tabs" role="tablist" aria-label="模型类型">
        {[
          { id: 'text', label: '文本生成', icon: Bot },
          { id: 'image', label: '图像生成', icon: Image },
          { id: 'video', label: '视频生成', icon: Video },
          { id: 'voice', label: '语音生成', icon: Mic2 },
          { id: 'usage', label: '使用统计', icon: BarChart3 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={modelTab === id}
            className={modelTab === id ? 'is-active' : undefined}
            onClick={() => {
              void confirmDiscardChanges().then((ok) => {
                if (ok) setModelTab(id as typeof modelTab);
              });
            }}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
        <span className="model-settings-guide">配置遇到问题？查看配置指南</span>
      </div>

      {modelTab === 'usage' ? (
        <UsageSettings />
      ) : modelTab !== 'text' ? (
        <div key={modelTab} className="model-settings-tab-panel model-settings-unavailable">
          <p>
            {modelTab === 'image' ? '图像生成' : modelTab === 'video' ? '视频生成' : '语音生成'}
            模型配置尚未接入。
          </p>
          <span>入口按 NewMax 的模型设置结构保留。</span>
        </div>
      ) : (
        <>
          {error ? (
            <div className="shrink-0 border-b border-border px-5 py-2">
              <p className="text-[12.5px] text-error" role="alert">
                {error}
              </p>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
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
                    void confirmDiscardChanges().then((ok) => {
                      if (!ok) return;
                      openCreateCatalog();
                    });
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>

              <div className="model-enabled-list__body">
                {providers.length === 0 ? (
                  <div className="model-settings-empty-list">
                    <Server size={22} />
                    <p>尚未配置模型</p>
                    <span>点击右上角 + 添加</span>
                  </div>
                ) : (
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
                              void confirmDiscardChanges().then((ok) => {
                                if (!ok) return;
                                setShowCreate(false);
                                setDetailView('provider');
                                setSelectedId(provider.providerId);
                                setLastSelectedId(provider.providerId);
                              });
                            }}
                            onDisable={() => handleToggleEnabled(provider, false)}
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
                    void confirmDiscardChanges().then((ok) => {
                      if (!ok) return;
                      openCreateCatalog();
                    });
                  }}
                >
                  <Plus size={13} /> 添加模型
                </button>
                {disabledProviders.length > 0 ? (
                  <div className={clsx('model-disabled-list', disabledOpen && 'is-open')}>
                    <button
                      type="button"
                      className="model-disabled-list__summary"
                      onClick={() => setDisabledOpen((value) => !value)}
                      aria-expanded={disabledOpen}
                    >
                      <ChevronDown size={12} aria-hidden="true" />
                      <span>已停用模型 {disabledProviders.length}</span>
                    </button>
                    <div className="model-disabled-list__body" aria-hidden={!disabledOpen}>
                      <ul>
                        {disabledProviders.map((provider) => {
                          const primaryModel = [...provider.models].sort(
                            (a, b) => a.priority - b.priority,
                          )[0];
                          return (
                            <li
                              key={provider.providerId}
                              className={clsx(
                                'model-enabled-row is-disabled',
                                detailView === 'provider' &&
                                  provider.providerId === selectedId &&
                                  !showCreate &&
                                  'is-active',
                              )}
                            >
                              <ProviderRowAvatar provider={provider} />
                              <button
                                type="button"
                                className="model-enabled-row__main"
                                onClick={() => {
                                  setShowCreate(false);
                                  setSelectedId(provider.providerId);
                                  setLastSelectedId(provider.providerId);
                                }}
                              >
                                <span className="model-enabled-row__copy">
                                  <span>{provider.name}</span>
                                  <small>{primaryModel?.displayName ?? '未添加模型'}</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="model-disabled-list__enable"
                                disabled={providerListBusy}
                                onClick={() => handleToggleEnabled(provider, true)}
                              >
                                启用
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="model-enabled-list__secondary">
                <button
                  type="button"
                  className={detailView === 'vision' ? 'is-active' : undefined}
                  aria-pressed={detailView === 'vision'}
                  onClick={() => {
                    void confirmDiscardChanges().then((ok) => {
                      if (!ok) return;
                      setShowCreate(false);
                      setDetailView('vision');
                    });
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
                    void confirmDiscardChanges().then((ok) => {
                      if (!ok) return;
                      setShowCreate(false);
                      setDetailView('plan-act');
                    });
                  }}
                >
                  <Sparkles size={13} />
                  <span>规划 & 执行模型</span>
                </button>
                <button
                  type="button"
                  className={detailView === 'goal-evaluator' ? 'is-active' : undefined}
                  aria-pressed={detailView === 'goal-evaluator'}
                  data-testid="model-strategy-goal-evaluator"
                  onClick={() => {
                    void confirmDiscardChanges().then((ok) => {
                      if (!ok) return;
                      setShowCreate(false);
                      setDetailView('goal-evaluator');
                    });
                  }}
                >
                  <Target size={13} />
                  <span>目标模式评估模型</span>
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
                      onCancel={cancelCreateFlow}
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
                        setError(null);
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
                      onChange={setCreateDraft}
                      onSubmit={handleCreate}
                      onBackToCatalog={() => {
                        setCreateStep('catalog');
                        setCreateDraft(EMPTY_CREATE);
                        setCreateTemplate(null);
                        setError(null);
                      }}
                      onCancel={cancelCreateFlow}
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
                ) : detailView === 'goal-evaluator' ? (
                  <GoalEvaluatorPanel
                    allModels={allModels}
                    value={goalEvaluatorModelId}
                    busy={operation?.kind === 'save-preference'}
                    onChange={handleSaveGoalEvaluator}
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
                    onReorderModels={handleReorderModels}
                    onMoveModel={handleMoveModel}
                    onTransientDraftChange={setDetailDraftDirty}
                    onPinCredential={handlePinCredential}
                  />
                ) : (
                  <EmptyDetail onAdd={openCreateCatalog} />
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {importDialog ? (
        <ImportModelsDialog
          dialog={importDialog}
          onClose={() => setImportDialog(null)}
          onChange={setImportDialog}
          onApply={() => void handleApplyImport(importDialog)}
        />
      ) : null}
      {toast ? (
        <div
          key={toast.id}
          className={clsx('model-settings-toast', `is-${toast.kind}`)}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="model-settings-toast__icon">
            {toast.kind === 'success' ? <Check size={14} /> : <X size={14} />}
          </span>
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
});

function ProviderCatalog({
  category,
  onCategoryChange,
  onSelect,
  onCancel,
}: {
  category: ProviderCatalogCategory;
  onCategoryChange: (category: ProviderCatalogCategory) => void;
  onSelect: (item: ProviderCatalogItem) => void;
  onCancel: () => void;
}) {
  const items = PROVIDER_CATALOG[category];
  return (
    <section className="model-provider-catalog" aria-labelledby="model-provider-catalog-title">
      <header className="model-provider-catalog__header">
        <div>
          <h2 id="model-provider-catalog-title">添加模型</h2>
          <p>先选择服务商类型，再填写对应的连接配置。</p>
        </div>
        <button type="button" aria-label="取消添加模型" onClick={onCancel}>
          <X size={16} />
        </button>
      </header>

      <div className="model-provider-catalog__tabs" role="tablist" aria-label="模型服务商分类">
        {PROVIDER_CATALOG_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            className={clsx(
              'model-provider-catalog__tab',
              category === item.id && 'model-provider-catalog__tab--active',
            )}
            onClick={() => onCategoryChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

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
              className="model-provider-card"
              disabled={!templateReady}
              title={
                templateReady
                  ? undefined
                  : '该服务商暂未内置固定连接地址，请使用“自定义供应商”添加'
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
                </strong>
                <small>
                  {templateReady
                    ? item.description
                    : `${item.description} · 固定连接地址待接入`}
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
  'newmax-gateway': 'N',
  'minimax-cn': 'M',
  'kimi-coding': 'K',
  moonshot: '◐',
  zhipu: 'Z',
  deepseek: 'D',
  'bailian-coding': 'Q',
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
      <Settings2 size={15} />
    ) : providerId === 'cc-switch' ? (
      <Download size={15} />
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
          <BrandLogoMark logo={brandLogo} size={18} />
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
        <button type="button" aria-label="返回服务商目录" onClick={onBack} disabled={importing}>
          <ArrowLeft size={16} />
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

function CreateProviderForm({
  draft,
  template,
  busy,
  onChange,
  onSubmit,
  onBackToCatalog,
  onCancel,
}: {
  draft: CreateDraft;
  template?: ProviderCatalogItem;
  busy: boolean;
  onChange: (d: CreateDraft) => void;
  onSubmit: () => void;
  onBackToCatalog: () => void;
  onCancel: () => void;
}) {
  const isCustomEndpoint = template?.endpointMode === 'custom';
  const templateLabel = template?.name;
  return (
    <section className="model-provider-form" aria-labelledby="model-provider-form-title">
      <header className="model-provider-form__header">
        <button
          type="button"
          aria-label="返回服务商目录"
          onClick={onBackToCatalog}
          disabled={busy}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="model-provider-form__identity">
          {template ? (
            <ProviderBrandIcon
              providerId={template.id}
              providerName={template.name}
              testIdPrefix="provider-form-icon"
            />
          ) : null}
          <div>
            <h2 id="model-provider-form-title">添加模型源</h2>
            <p>{templateLabel ? `正在配置 ${templateLabel}` : '填写供应商连接信息'}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="取消添加模型源"
          onClick={onCancel}
          disabled={busy}
        >
          <X size={16} />
        </button>
      </header>
      <div className="model-provider-form__body">
        <Field label="名称">
          <input
            className="st-field-input"
            value={draft.name}
            placeholder="例如 New API / OpenAI / Claude"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        {isCustomEndpoint ? (
          <Field label="Base URL">
            <input
              className="st-field-input font-mono text-[12.5px]"
              data-testid="provider-base-url"
              value={draft.baseUrl}
              placeholder="https://api.openai.com/v1"
              disabled={busy}
              onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
            />
          </Field>
        ) : (
          <div className="model-provider-form__builtin-endpoint">
            <Server size={15} aria-hidden="true" />
            <span>连接地址已由 {templateLabel ?? '服务商'} 模板内置</span>
          </div>
        )}
        <Field label="API 格式">
          <ProtocolSelector
            protocol={draft.protocol}
            disabled={busy}
            onChange={(protocol) => onChange({ ...draft, protocol })}
          />
        </Field>
        <Field label="API Key">
          <SecretInput
            value={draft.apiKey}
            placeholder="sk-…"
            disabled={busy}
            onChange={(apiKey) => onChange({ ...draft, apiKey })}
          />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
          <input
            type="checkbox"
            checked={draft.supportsDiscovery}
            disabled={busy}
            onChange={(e) => onChange({ ...draft, supportsDiscovery: e.target.checked })}
          />
          创建后自动发现模型（/models）
        </label>
        <div className="model-provider-form__actions">
          <button
            type="button"
            className="is-primary"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : '创建并保存'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </section>
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
  return <span className="model-enabled-row__avatar">{provider.name[0]?.toUpperCase() ?? '?'}</span>;
}

function SortableProviderRow({
  provider,
  index,
  active,
  busy,
  onSelect,
  onDisable,
}: {
  provider: ProviderSummary;
  index: number;
  active: boolean;
  busy: boolean;
  onSelect(): void;
  onDisable(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.model-enabled-row__menu-wrap')
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);
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
          </span>
          <small>{primaryModel?.displayName ?? '未添加模型'}</small>
        </span>
      </button>
      <div className="model-enabled-row__menu-wrap">
        <button
          type="button"
          className="model-enabled-row__menu-trigger"
          title="更多操作"
          aria-label={`${provider.name} 更多操作`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen ? (
          <div
            className="model-enabled-row__menu"
            role="menu"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSelect();
              }}
            >
              编辑配置
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setMenuOpen(false);
                onDisable();
              }}
            >
              停用模型源
            </button>
          </div>
        ) : null}
      </div>
    </li>
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
  const family = protocol === 'anthropic-messages' ? 'anthropic' : 'openai';
  return (
    <div className="model-protocol-control">
      <div className="model-protocol-segment" role="radiogroup" aria-label="API 格式">
        <button
          type="button"
          role="radio"
          aria-checked={family === 'openai'}
          className={family === 'openai' ? 'is-active' : undefined}
          disabled={disabled}
          onClick={() => onChange(protocol === 'openai-responses' ? protocol : 'openai-chat')}
        >
          OpenAI 格式
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={family === 'anthropic'}
          className={family === 'anthropic' ? 'is-active' : undefined}
          disabled={disabled}
          onClick={() => onChange('anthropic-messages')}
        >
          Anthropic 格式
        </button>
      </div>
      <div className={clsx('model-responses-row', family !== 'openai' && 'is-hidden')}>
        <div>
          <strong>使用 Responses API</strong>
          <span>强制走 /v1/responses。仅在供应商支持 Responses 端点时开启。</span>
        </div>
        <Toggle
          checked={protocol === 'openai-responses'}
          disabled={disabled || family !== 'openai'}
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
  onReorderModels,
  onMoveModel,
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
  onReorderModels: (provider: ProviderSummary, models: ProviderModelSummary[]) => void;
  onMoveModel: (provider: ProviderSummary, modelId: string, direction: -1 | 1) => void;
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
  const [savingField, setSavingField] = useState<'name' | 'baseUrl' | 'protocol' | null>(null);
  const [newKey, setNewKey] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const modelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const busy = operation?.targetId === provider.providerId;
  const discovering = operation?.kind === 'discover-models' && busy;
  const testing = connectionTest.status === 'testing';
  const keyDraftDirty = addingKey && Boolean(newKey.trim());
  const manualModelDraftDirty =
    addingModel && Boolean(manualId.trim() || manualName.trim() || manualContext.trim());

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
    setNewKey('');
    setAddingKey(false);
    setAddingModel(false);
    setManualId('');
    setManualName('');
    setManualContext('');
  }, [provider.providerId]);

  const models = useMemo(
    () => [...provider.models].sort((a, b) => a.priority - b.priority),
    [provider.models],
  );

  const saveTextField = async (field: 'name' | 'baseUrl', rawValue?: string) => {
    // Prefer the live input value: blur can fire before React re-renders the draft state.
    const value = (rawValue ?? (field === 'name' ? nameDraft : baseUrlDraft)).trim();
    const original = field === 'name' ? provider.name : provider.baseUrl;
    const setError = field === 'name' ? setNameError : setBaseUrlError;
    if (field === 'name') setNameDraft(value);
    else setBaseUrlDraft(value);
    if (!value || (field === 'baseUrl' && value === 'https://')) {
      setError(field === 'name' ? '供应商名称不能为空' : 'API Base URL 不能为空');
      return;
    }
    setError(null);
    if (value === original) return;
    setSavingField(field);
    const saved = await onUpdateProvider(provider.providerId, { [field]: value });
    setSavingField(null);
    if (!saved) {
      if (field === 'name') setNameDraft(original);
      else setBaseUrlDraft(original);
    }
  };

  const saveProtocol = async (protocol: ProtocolFamily) => {
    if (protocol === protocolDraft) return;
    const previous = protocolDraft;
    setProtocolDraft(protocol);
    setSavingField('protocol');
    const saved = await onUpdateProvider(provider.providerId, { protocol });
    setSavingField(null);
    if (!saved) setProtocolDraft(previous);
  };

  return (
    <div className="model-provider-detail border-b border-border px-6 py-5">
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
        <Field label="API Base URL">
          <div className="model-autosave-field">
            <input
              className="st-field-input font-mono text-[12.5px]"
              value={baseUrlDraft}
              aria-invalid={Boolean(baseUrlError)}
              aria-label="API Base URL"
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              onBlur={(event) => void saveTextField('baseUrl', event.currentTarget.value)}
            />
            {savingField === 'baseUrl' ? (
              <Loader2 size={13} className="model-settings-spin" />
            ) : null}
          </div>
          {baseUrlError ? <span className="model-field-error">{baseUrlError}</span> : null}
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

      <section className="model-newmax-section">
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
            <span className="model-newmax-section__label">
              模型优先级（{models.length || '至少添加一个'}）
            </span>
            <small>主模型失败后按顺序尝试备用模型 · 悬停行尾的垃圾桶图标可删除模型</small>
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
                    total={models.length}
                    credentials={provider.credentials}
                    busy={busy}
                    onMove={(direction) => onMoveModel(provider, model.modelId, direction)}
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
          <div className="model-add-model-form">
            <div className="model-add-model-form__head">
              <span>手动添加模型</span>
              <button
                type="button"
                className="model-add-model-form__close"
                onClick={() => {
                  setAddingModel(false);
                  setManualId('');
                  setManualName('');
                  setManualContext('');
                }}
              >
                收起
              </button>
            </div>
            <div className="model-manual-add">
              <input
                className="st-field-input font-mono text-[12.5px]"
                value={manualId}
                placeholder="模型 ID"
                disabled={busy}
                aria-label="模型 ID"
                autoFocus
                onChange={(event) => setManualId(event.target.value)}
              />
              <input
                className="st-field-input"
                value={manualName}
                placeholder="显示名（可选）"
                disabled={busy}
                aria-label="显示名（可选）"
                onChange={(event) => setManualName(event.target.value)}
              />
              <input
                className="st-field-input"
                type="text"
                inputMode="text"
                value={manualContext}
                placeholder="上下文窗口 tokens（如 200k / 1m）"
                disabled={busy}
                aria-label="上下文窗口（tokens，可选）"
                title="上下文窗口，单位 tokens（支持 372000、372k、1m）"
                onChange={(event) => setManualContext(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || !manualId.trim()}
                onClick={async () => {
                  const ctxValue = parseContextTokens(manualContext);
                  const saved = await onAddModel(
                    provider.providerId,
                    protocolDraft,
                    manualId.trim(),
                    manualName.trim() || undefined,
                    ctxValue ?? undefined,
                  );
                  if (!saved) return;
                  setManualId('');
                  setManualName('');
                  setManualContext('');
                }}
              >
                <Plus size={13} /> 添加
              </button>
            </div>
          </div>
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
    </div>
  );
}

function ImportModelsDialog({
  dialog,
  onClose,
  onChange,
  onApply,
}: {
  dialog: ImportDialogState;
  onClose: () => void;
  onChange: (next: ImportDialogState) => void;
  onApply: () => void;
}) {
  const query = dialog.query.trim().toLocaleLowerCase('zh-CN');
  const filtered = dialog.discovered.filter((item) => {
    if (!query) return true;
    return (
      item.providerModelId.toLocaleLowerCase('zh-CN').includes(query) ||
      item.displayName.toLocaleLowerCase('zh-CN').includes(query)
    );
  });
  const selectedCount = dialog.selectedIds.length;
  const totalCount = dialog.discovered.length;

  const toggleId = (id: string) => {
    const selected = new Set(dialog.selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ ...dialog, selectedIds: [...selected] });
  };

  return (
    <div className="model-import-overlay" role="presentation">
      <div
        className="model-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-import-title"
      >
        <div className="model-import-dialog__head">
          <h3 id="model-import-title">导入模型</h3>
          <button type="button" aria-label="关闭" disabled={dialog.applying} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="model-import-dialog__desc">
          从服务商拉到 {totalCount} 个模型；已添加的默认勾选；取消勾选会从当前优先级列表移除。
        </p>
        <label className="model-import-dialog__search">
          <Search size={14} aria-hidden="true" />
          <input
            value={dialog.query}
            placeholder="搜索模型 ID 或显示名"
            aria-label="搜索模型"
            disabled={dialog.applying}
            onChange={(event) => onChange({ ...dialog, query: event.target.value })}
          />
        </label>
        <div className="model-import-dialog__meta">
          <span>已选 {selectedCount} 个</span>
          <button
            type="button"
            disabled={dialog.applying || selectedCount === 0}
            onClick={() => onChange({ ...dialog, selectedIds: [] })}
          >
            清空
          </button>
        </div>
        <div className="model-import-dialog__list">
          {filtered.length === 0 ? (
            <p className="model-import-dialog__empty">没有匹配的模型</p>
          ) : (
            filtered.map((item) => {
              const checked = dialog.selectedIds.includes(item.providerModelId);
              return (
                <label
                  key={item.providerModelId}
                  className={clsx('model-import-dialog__row', checked && 'is-checked')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={dialog.applying}
                    onChange={() => toggleId(item.providerModelId)}
                  />
                  <span className="model-import-dialog__name">{item.displayName}</span>
                  {item.alreadyAdded ? (
                    <em className="model-import-dialog__badge">已添加</em>
                  ) : null}
                </label>
              );
            })
          )}
        </div>
        <div className="model-import-dialog__footer">
          <button type="button" disabled={dialog.applying} onClick={onClose}>
            取消
          </button>
          <button type="button" className="is-primary" disabled={dialog.applying} onClick={onApply}>
            {dialog.applying ? (
              <>
                <Loader2 size={14} className="model-settings-spin" /> 更新中…
              </>
            ) : (
              `更新列表 (${selectedCount})`
            )}
          </button>
        </div>
      </div>
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
  const [revealing, setRevealing] = useState(false);
  const [value, setValue] = useState(stagedValue);
  const [baseline, setBaseline] = useState('');
  const revealTimer = useRef<number | null>(null);
  const revealGeneration = useRef(0);

  const clearReveal = useCallback(() => {
    revealGeneration.current += 1;
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setVisible(false);
    setRevealing(false);
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
    setRevealing(false);
    setValue(stagedValue || '');
    setBaseline('');
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
  visibleRef.current = visible;
  valueRef.current = value;
  baselineRef.current = baseline;
  onStageRef.current = onStage;

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
      setRevealing(false);
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
    setRevealing(true);
    const generation = revealGeneration.current + 1;
    revealGeneration.current = generation;
    const result = await onReveal(providerId, credential.credentialRefId);
    if (revealGeneration.current !== generation) return;
    setRevealing(false);
    if (!result?.apiKey) return;
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
        if (value.trim() && value.trim() !== result.apiKey.trim()) onStage(value);
        clearReveal();
      }
    }, delay);
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
        disabled={busy || revealing}
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
        disabled={busy || revealing || (!credential.hasSecret && !stagedValue && !visible)}
        onClick={() => void handleToggleReveal()}
      >
        {revealing ? (
          <Loader2 size={14} className="model-settings-spin" />
        ) : visible ? (
          <EyeOff size={14} />
        ) : (
          <Eye size={14} />
        )}
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
  total,
  credentials,
  busy,
  onMove,
  onRemove,
  onPin,
  onSaveContext,
}: {
  model: ProviderModelSummary;
  index: number;
  total: number;
  credentials: ProviderSummary['credentials'];
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
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
      <span className={clsx('model-priority-row__rank', index === 0 && 'is-primary')}>
        {rankLabel}
      </span>
      <div className="model-priority-row__copy">
        <p title={title}>{title}</p>
      </div>
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
          title="提高优先级"
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          title="降低优先级"
          disabled={busy || index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={12} />
        </button>
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
    displayName: string;
    providerName: string;
    enabled: boolean;
  }>;
  value: VisionFallbackSetting;
  busy: boolean;
  onChange(value: VisionFallbackSetting): void;
}) {
  const options = enabledModelOptions(allModels);
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
          disabled={busy}
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      <div className="model-strategy-panel__fields">
        <Field label="视觉模型">
          <select
            className="st-field-input"
            value={value.modelId ?? ''}
            disabled={busy || !value.enabled}
            onChange={(event) => onChange({ ...value, modelId: event.target.value || null })}
          >
            <option value="">选择视觉模型…</option>
            {options.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName} · {model.providerName}
              </option>
            ))}
          </select>
        </Field>
        <p className="model-strategy-panel__hint">更改会立即保存。</p>
      </div>
    </div>
  );
}

function GoalEvaluatorPanel({
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
  value: string | null;
  busy: boolean;
  onChange(value: string | null): void;
}) {
  const options = enabledModelOptions(allModels);
  return (
    <div className="model-strategy-panel">
      <div className="model-strategy-panel__head">
        <span className="model-strategy-panel__icon">
          <Target size={16} />
        </span>
        <div>
          <h2>目标模式评估模型</h2>
          <p>每轮任务结束后，用独立的小模型判断完成条件是否满足（NewMax /goal 语义）。</p>
        </div>
      </div>
      <div className="model-strategy-panel__fields">
        <Field label="评估模型（留空 = 停用目标模式）">
          <select
            className="st-field-input"
            value={value ?? ''}
            disabled={busy}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">（未配置）</option>
            {options.map((option) => (
              <option key={option.modelId} value={option.modelId}>
                {option.providerName} · {option.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="model-strategy-panel__note">
        评估器使用独立模型判断完成条件（不调用工具，只读对话内容）；不配置则目标模式不会自动启动。
      </p>
    </div>
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
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      <div className="model-strategy-panel__fields">
        <Field label="规划模型">
          <select
            className="st-field-input"
            value={value.planModelId ?? ''}
            disabled={busy || !value.enabled}
            onChange={(event) => onChange({ ...value, planModelId: event.target.value || null })}
          >
            <option value="">选择规划模型…</option>
            {options.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName} · {model.providerName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="执行模型">
          <select
            className="st-field-input"
            value={value.actModelId ?? ''}
            disabled={busy || !value.enabled}
            onChange={(event) => onChange({ ...value, actModelId: event.target.value || null })}
          >
            <option value="">选择执行模型…</option>
            {options.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName} · {model.providerName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="规划思考强度">
          <select
            className="st-field-input"
            value={value.planReasoningEffort ?? ''}
            disabled={busy || !value.enabled}
            onChange={(event) =>
              onChange({ ...value, planReasoningEffort: event.target.value || null })
            }
          >
            <option value="">跟随对话设置</option>
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="执行思考强度">
          <select
            className="st-field-input"
            value={value.actReasoningEffort ?? ''}
            disabled={busy || !value.enabled}
            onChange={(event) =>
              onChange({ ...value, actReasoningEffort: event.target.value || null })
            }
          >
            <option value="">跟随对话设置</option>
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
              </option>
            ))}
          </select>
        </Field>
        <p className="model-strategy-panel__hint">
          规划模式强制使用规划模型；批准方案后的执行轮强制执行模型（含思考强度）；普通对话消息不干预，手动选择的模型照常生效。
        </p>
      </div>
    </div>
  );
}

// ─── Usage stats ─────────────────────────────────────────────────────────────

export function UsageSettings() {
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState<number | undefined>(7);
  const [usageTab, setUsageTab] = useState<
    'requests' | 'providers' | 'models' | 'tools' | 'pricing'
  >('requests');
  const [modelQuery, setModelQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | null>(null);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.getUsageSummary) {
      setError('Runtime 未连接，无法加载用量');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getUsageSummary(sinceDays ? { sinceDays } : {});
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载用量失败');
    } finally {
      setLoading(false);
    }
  }, [sinceDays]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-6 py-8 text-[12px] text-text-faint">
        <Loader2 size={14} className="animate-spin" /> 加载使用统计…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <p className="text-[12px] text-error">{error}</p>
        <button type="button" className="usage-retry" onClick={() => void load()}>
          重试
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
  const totalCostLabel = formatCurrencyTotals(data?.totalCostByCurrency ?? {});
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
      <div className="usage-toolbar">
        <span>使用统计</span>
        <div className="usage-toolbar-actions">
          <div className="usage-range" role="group" aria-label="统计时间范围">
            {[
              [1, '24h'],
              [7, '近 7 天'],
              [30, '近 30 天'],
              [undefined, '全部'],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                className={sinceDays === value ? 'is-active' : undefined}
                onClick={() => setSinceDays(value as number | undefined)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="usage-refresh" title="刷新" onClick={() => void load()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="usage-metrics">
        <UsageMetric label="总请求" value={formatCount(data?.totalRequests ?? 0)} />
        <UsageMetric label="总费用" value={totalCostLabel} hint="以模型供应商最终结算为准" />
        <UsageMetric
          label="总 Token"
          value={formatTokenCount(totalUsageTokens.totalTokens)}
          hint={`普通输入 ${formatTokenCount(totalUsageTokens.inputTokens)} / 缓存读取 ${formatTokenCount(totalUsageTokens.cacheReadTokens)} / 缓存创建 ${formatTokenCount(totalUsageTokens.cacheWriteTokens)} / 输出 ${formatTokenCount(totalUsageTokens.outputTokens)}`}
        />
        <UsageMetric
          label="缓存命中率"
          value={
            cacheReadReported.requests > 0 && cacheReadReported.inputTokens > 0
              ? formatRate(cacheReadReported.readTokens, cacheReadReported.inputTokens)
              : '—'
          }
          hint={
            hasCacheUsage
              ? `读取 ${formatTokenCount(totalUsageTokens.cacheReadTokens)} / 创建 ${formatTokenCount(totalUsageTokens.cacheWriteTokens)} · ${cacheReadReported.requests}/${requests.length} 请求上报读取`
              : '当前供应商未返回缓存用量'
          }
        />
      </div>

      <div className="usage-tabs" role="tablist" aria-label="统计视图">
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
      </div>

      {usageTab === 'requests' ? (
        <section className="usage-panel">
          <div className="usage-filters">
            <input
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder="按模型筛选…"
              aria-label="按模型筛选"
            />
            <select
              value={statusFilter}
              aria-label="请求状态"
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">全部状态</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
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
  hint?: string;
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

function UsageRequestTable({ rows }: { rows: UsageSummaryResponse['requests'] }) {
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  if (rows.length === 0) {
    return <div className="usage-table-empty">暂无符合条件的请求记录</div>;
  }
  return (
    <div className="usage-table-wrap">
      <table className="usage-table usage-request-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>模型与供应商</th>
            <th>Token 明细</th>
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
            const isExpanded = expandedRequestId === row.requestId;
            const displayName = row.displayName ?? row.modelId;
            const detailsId = `usage-request-details-${row.requestId}`;
            return (
              <Fragment key={row.requestId}>
                <tr className="usage-request-row">
                  <td>{formatTimestamp(row.occurredAt)}</td>
                  <td className="usage-request-model" title={row.modelId}>
                    <strong>{displayName}</strong>
                    <span>{row.providerName ?? row.providerId ?? '-'}</span>
                  </td>
                  <td className="usage-token-breakdown">
                    <div className="usage-token-totals">
                      <strong>输入 {formatTokenCount(tokens.totalInputTokens)}</strong>
                      <span>输出 {formatTokenCount(tokens.outputTokens)}</span>
                    </div>
                    <div className="usage-token-parts">
                      <span>普通输入 {formatTokenCount(tokens.inputTokens)}</span>
                      <span>
                        缓存读取{' '}
                        {cacheReadReported ? formatTokenCount(tokens.cacheReadTokens) : '未上报'}
                      </span>
                      <span>
                        缓存创建{' '}
                        {cacheWriteReported ? formatTokenCount(tokens.cacheWriteTokens) : '未上报'}
                      </span>
                      <span className="usage-cache-rate">
                        缓存命中{' '}
                        {cacheReadReported
                          ? formatRate(tokens.cacheReadTokens, tokens.totalInputTokens)
                          : '未上报'}
                      </span>
                    </div>
                  </td>
                  <td className="usage-request-cost">
                    <strong>{formatCurrency(row.estimatedCost, row.currency)}</strong>
                    <button
                      type="button"
                      className={clsx('usage-request-toggle', isExpanded && 'is-expanded')}
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      aria-label={`${isExpanded ? '收起' : '查看'} ${displayName} 请求详情`}
                      title={isExpanded ? '收起请求详情' : '展开请求详情'}
                      onClick={() => setExpandedRequestId(isExpanded ? null : row.requestId)}
                    >
                      <ChevronDown size={13} />
                    </button>
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
                {isExpanded ? (
                  <tr className="usage-request-details" id={detailsId}>
                    <td colSpan={6}>
                      <div
                        className="usage-request-detail-sections"
                        data-testid={`usage-request-details-${row.requestId}`}
                      >
                        <section className="usage-request-detail-section">
                          <strong className="usage-request-detail-title">请求信息</strong>
                          <dl className="usage-request-detail-list">
                            <div>
                              <dt>请求 ID</dt>
                              <dd className="usage-request-detail-id" title={row.requestId}>
                                {row.requestId}
                              </dd>
                            </div>
                            {row.taskId ? (
                              <div>
                                <dt>任务 ID</dt>
                                <dd className="usage-request-detail-id" title={row.taskId}>
                                  {row.taskId}
                                </dd>
                              </div>
                            ) : null}
                            {row.runId ? (
                              <div>
                                <dt>运行 ID</dt>
                                <dd className="usage-request-detail-id" title={row.runId}>
                                  {row.runId}
                                </dd>
                              </div>
                            ) : null}
                            {row.stepId ? (
                              <div>
                                <dt>步骤 ID</dt>
                                <dd className="usage-request-detail-id" title={row.stepId}>
                                  {row.stepId}
                                </dd>
                              </div>
                            ) : null}
                            <div>
                              <dt>Provider</dt>
                              <dd>
                                {row.providerName ?? row.providerId ?? '-'}
                                {row.providerName && row.providerId ? ` · ${row.providerId}` : ''}
                              </dd>
                            </div>
                            <div>
                              <dt>Provider 模型</dt>
                              <dd className="usage-request-detail-id">
                                {row.providerModelId ?? row.modelId}
                              </dd>
                            </div>
                            <div>
                              <dt>请求用途</dt>
                              <dd>{formatUsagePurpose(row.purpose)}</dd>
                            </div>
                          </dl>
                        </section>

                        <section className="usage-request-detail-section">
                          <strong className="usage-request-detail-title">Token 明细</strong>
                          <dl className="usage-request-detail-list is-token-list">
                            <div>
                              <dt>普通输入</dt>
                              <dd>{formatTokenCount(tokens.inputTokens)}</dd>
                            </div>
                            <div>
                              <dt>缓存读取</dt>
                              <dd>
                                {cacheReadReported
                                  ? formatTokenCount(tokens.cacheReadTokens)
                                  : '未上报'}
                              </dd>
                            </div>
                            <div>
                              <dt>缓存创建</dt>
                              <dd>
                                {cacheWriteReported
                                  ? formatTokenCount(tokens.cacheWriteTokens)
                                  : '未上报'}
                              </dd>
                            </div>
                            <div>
                              <dt>推理 Token</dt>
                              <dd>
                                {typeof row.reasoningTokens === 'number'
                                  ? formatTokenCount(row.reasoningTokens)
                                  : '未上报'}
                              </dd>
                            </div>
                            <div>
                              <dt>输出</dt>
                              <dd>{formatTokenCount(tokens.outputTokens)}</dd>
                            </div>
                            <div>
                              <dt>总 Token</dt>
                              <dd>{formatTokenCount(row.totalTokens)}</dd>
                            </div>
                          </dl>
                        </section>

                        <section className="usage-request-detail-section">
                          <strong className="usage-request-detail-title">费用明细</strong>
                          {row.estimatedCostBreakdown ? (
                            <dl className="usage-request-detail-list is-cost-list">
                              <div>
                                <dt>普通输入费</dt>
                                <dd>
                                  {formatCurrencyDetail(
                                    row.estimatedCostBreakdown.input,
                                    row.currency,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>缓存读取费</dt>
                                <dd>
                                  {formatCurrencyDetail(
                                    row.estimatedCostBreakdown.cacheRead,
                                    row.currency,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>缓存创建费</dt>
                                <dd>
                                  {formatCurrencyDetail(
                                    row.estimatedCostBreakdown.cacheWrite,
                                    row.currency,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>输出费</dt>
                                <dd>
                                  {formatCurrencyDetail(
                                    row.estimatedCostBreakdown.output,
                                    row.currency,
                                  )}
                                </dd>
                              </div>
                            </dl>
                          ) : (
                            <span className="usage-request-detail-empty">供应商未返回费用拆分</span>
                          )}
                        </section>

                        {row.errorMessage ? (
                          <div className="usage-request-detail-error usage-error">
                            <strong>失败原因</strong>
                            <span>{row.errorMessage}</span>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
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
                  : '—'}
              </td>
              <td>
                {typeof row.averageLatencyMs === 'number'
                  ? formatLatency(row.averageLatencyMs)
                  : '—'}
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
                    <td>{row.conversationTitle ?? '—'}</td>
                    <td>{row.displayName ?? row.modelId ?? '—'}</td>
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
      <p className="text-[13px] text-text-secondary">选择左侧供应商，或添加新的模型源</p>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
        onClick={onAdd}
      >
        <Plus size={14} /> 添加模型源
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11.5px] font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  );
}

function formatCurrency(value: number | undefined, currency: 'USD' | 'CNY' | undefined): string {
  if (typeof value !== 'number' || !currency) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  const digits = value >= 1 ? 2 : value > 0 ? 4 : 2;
  return `${symbol}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: value === 0 ? 2 : 0,
    maximumFractionDigits: digits,
  })}`;
}

function formatCurrencyDetail(
  value: number | undefined,
  currency: 'USD' | 'CNY' | undefined,
): string {
  if (typeof value !== 'number' || !currency) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol}${value.toFixed(6)}`;
}

function formatCurrencyTotals(totals: Partial<Record<'USD' | 'CNY', number>>): string {
  const values = (['CNY', 'USD'] as const).flatMap((currency) =>
    typeof totals[currency] === 'number' ? [formatCurrency(totals[currency], currency)] : [],
  );
  return values.length > 0 ? values.join(' / ') : '—';
}

function formatRate(successes: number, total: number): string {
  return total > 0 ? `${((successes / total) * 100).toFixed(1)}%` : '—';
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsagePurpose(purpose: UsageSummaryResponse['requests'][number]['purpose']): string {
  switch (purpose) {
    case 'compaction':
      return '上下文压缩';
    case 'delegation':
      return '任务委派';
    case 'review':
      return '结果审核';
    case 'revision':
      return '任务返修';
    case 'summary':
      return '最终总结';
    case 'normal':
      return '普通对话';
    default:
      return '未上报';
  }
}
