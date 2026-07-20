import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bot,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  KeyRound,
  Layers3,
  Pencil,
  Plus,
  Puzzle,
  Radar,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { ProviderSurface } from '@sync-think/shared';
import {
  PROVIDER_SURFACE_LABELS,
  PROVIDER_SURFACE_ORDER,
  inferProviderSurface,
} from '@sync-think/shared';

export type ProviderCapabilityTag =
  'text' | 'vision' | 'tool-calling' | 'image-generation' | 'embeddings';

export const CAPABILITY_OPTIONS: Array<{ value: ProviderCapabilityTag; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'vision', label: '视觉' },
  { value: 'tool-calling', label: '工具' },
  { value: 'image-generation', label: '生图' },
  { value: 'embeddings', label: '向量' },
];

export type ProviderProtocol =
  'openai-responses' | 'openai-chat' | 'openai-images' | 'anthropic-messages';

export type ProviderPanelSurface = 'claude' | 'codex' | 'gemini' | 'kiro' | 'generic';

export interface ProviderPanelCredential {
  credentialRefId: string;
  credentialGroupId?: string;
  groupName: string;
  label: string;
  kind: string;
  hasSecret: boolean;
}

export interface ProviderPanelModel {
  modelId: string;
  providerModelId: string;
  displayName: string;
  protocol: string;
  capabilities: readonly ProviderCapabilityTag[];
  capabilitiesConfirmed: boolean;
}

export interface ProviderPanelItem {
  providerId: string;
  name: string;
  baseUrl: string;
  /** Default discovery / catalog protocol (§7.2). */
  protocol: ProviderProtocol;
  supportsDiscovery: boolean;
  /** CC Switch-style surface for hierarchical model picking. */
  surface?: ProviderPanelSurface;
  credentials: readonly ProviderPanelCredential[];
  models: readonly ProviderPanelModel[];
  createdAt: string;
}

export interface ProviderCreateInput {
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  supportsDiscovery: boolean;
  credentialLabel: string;
}

export interface ProviderUpdateInput {
  providerId: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  supportsDiscovery: boolean;
  credentialLabel: string;
  rotateCredentialFromClipboard: boolean;
}

export interface CcSwitchPreviewItem {
  sourceId: string;
  appType: string;
  name: string;
  baseUrl?: string;
  protocol?: ProviderProtocol;
  hasSecret: boolean;
  models: string[];
  credentialGroupName: string;
  importedFrom: string;
  warnings: string[];
  importable: boolean;
}

export interface ProvidersPanelProps {
  providers: readonly ProviderPanelItem[];
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  statusNote?: string | null;
  onCreate?: (input: ProviderCreateInput) => void | Promise<void>;
  onUpdate?: (input: ProviderUpdateInput) => void | Promise<void>;
  onDiscover?: (providerId: string) => void | Promise<void>;
  onAddModel?: (
    providerId: string,
    providerModelId: string,
    displayName?: string,
  ) => void | Promise<void>;
  /** Heuristic capability probe suggestions — never auto-facts. */
  onProbeCapabilities?: (providerId: string, modelId?: string) => void | Promise<void>;
  /** User confirms or edits capability tags. */
  onConfirmCapabilities?: (
    modelId: string,
    capabilities: ProviderCapabilityTag[],
    confirmed?: boolean,
  ) => void | Promise<void>;
  onPreviewCcSwitchImport?: () => void | Promise<
    CcSwitchPreviewItem[] | { items: CcSwitchPreviewItem[] }
  >;
  onImportCcSwitch?: (sourceIds: string[]) => void | Promise<void>;
  emptyTitle?: string;
  emptyHint?: string;
}

const PROTOCOL_OPTIONS: Array<{ value: ProviderProtocol; label: string }> = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-images', label: 'OpenAI Images' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

function maskHint(hasSecret: boolean): string {
  return hasSecret ? '•••••••••••' : '未配置密钥';
}

const SURFACE_ICON: Record<ProviderSurface, typeof Server> = {
  codex: Terminal,
  claude: Bot,
  kiro: CircleDot,
  gemini: Sparkles,
  generic: Puzzle,
};

function resolveProviderSurface(provider: ProviderPanelItem): ProviderSurface {
  return inferProviderSurface({
    surface: provider.surface,
    protocol: provider.protocol,
    name: provider.name,
  });
}

interface ProviderSurfaceBucket {
  surface: ProviderSurface;
  label: string;
  providers: ProviderPanelItem[];
  modelCount: number;
}

function groupProvidersBySurface(providers: readonly ProviderPanelItem[]): ProviderSurfaceBucket[] {
  const buckets = new Map<ProviderSurface, ProviderPanelItem[]>();
  for (const p of providers) {
    const surface = resolveProviderSurface(p);
    const list = buckets.get(surface) ?? [];
    list.push(p);
    buckets.set(surface, list);
  }
  const result: ProviderSurfaceBucket[] = [];
  for (const surface of PROVIDER_SURFACE_ORDER) {
    const list = buckets.get(surface);
    if (!list || list.length === 0) continue;
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    result.push({
      surface,
      label: PROVIDER_SURFACE_LABELS[surface],
      providers: sorted,
      modelCount: sorted.reduce((n, p) => n + p.models.length, 0),
    });
  }
  return result;
}

/**
 * Instrument-style provider registry. Stored credentials remain masked; edits
 * can explicitly rotate a key without loading plaintext into Renderer state.
 */

export type ProvidersReadinessLevel = 'empty' | 'partial' | 'ready';

export interface ProvidersReadiness {
  level: ProvidersReadinessLevel;
  badge: string;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  protocolCount: number;
  providersOk: boolean;
  modelsOk: boolean;
  secretsOk: boolean;
  multiProtocol: boolean;
  countLabel: string;
  note: string;
}

export interface ProvidersReadinessProviderLike {
  protocol?: string;
  models: readonly unknown[];
  credentials?: readonly { hasSecret?: boolean }[];
}

/**
 * Pure projector for tests + UI — M1 multi-model soft gate observability
 * (≥2 providers, ≥3 models). Does NOT close M1; dogfood remains date-gated.
 */
export function projectProvidersReadiness(input: {
  providers?: readonly ProvidersReadinessProviderLike[] | null;
}): ProvidersReadiness {
  const providers = input.providers ?? [];
  const providerCount = providers.length;
  const modelCount = providers.reduce((sum, p) => sum + (p.models?.length ?? 0), 0);
  const secretCount = providers.reduce(
    (sum, p) => sum + (p.credentials?.filter((c) => c.hasSecret).length ?? 0),
    0,
  );
  const protocolCount = new Set(
    providers.map((p) => p.protocol).filter((x): x is string => Boolean(x)),
  ).size;
  const providersOk = providerCount >= 2;
  const modelsOk = modelCount >= 3;
  const secretsOk = secretCount >= 1;
  const multiProtocol = protocolCount >= 2;
  const level: ProvidersReadinessLevel =
    providersOk && modelsOk ? 'ready' : providerCount === 0 ? 'empty' : 'partial';

  const badge = level === 'ready' ? '已达 soft 门槛' : level === 'empty' ? '尚未配置' : '进行中';

  let note = '';
  if (level === 'ready') {
    note = multiProtocol
      ? '本地/已配置侧 soft 门槛已满（含跨协议）。外网手测 18/18、dogfood 1/1 已完成；M1 已完成。'
      : '本地/已配置侧 soft 门槛已满。外网手测 18/18、dogfood 1/1 已完成；M1 已完成。可再混用 OpenAI / Anthropic 协议。';
  } else if (level === 'empty') {
    note =
      '密钥只写安全存储、列表仅显示遮罩。配置 ≥2 个 Provider 与 ≥3 个模型后，Compose 可跨模型切换。';
  } else if (!providersOk && !modelsOk) {
    note = `进行中：Provider ${providerCount}/2 · 模型 ${modelCount}/3 · 密钥${secretsOk ? '已遮罩写入' : '未配'}。继续添加 Provider 并发现/手填模型。`;
  } else if (!providersOk) {
    note = `模型数已达 ${modelCount}，但 Provider 仅 ${providerCount}/2。再添加一个独立 Provider 端点以跨源切换。`;
  } else {
    note = `Provider 已满 ${providerCount}/2，模型 ${modelCount}/3。发现或手动补齐模型后达 soft 门槛。`;
  }

  return {
    level,
    badge,
    providerCount,
    modelCount,
    secretCount,
    protocolCount,
    providersOk,
    modelsOk,
    secretsOk,
    multiProtocol,
    countLabel: `${providerCount} 个 Provider · ${modelCount} 个模型`,
    note,
  };
}

export function ProvidersPanel(props: ProvidersPanelProps) {
  const [openForm, setOpenForm] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai-chat');
  const [credentialLabel, setCredentialLabel] = useState('primary');
  const [supportsDiscovery, setSupportsDiscovery] = useState(true);
  const [manualModelByProvider, setManualModelByProvider] = useState<Record<string, string>>({});
  /** Local draft tags while user toggles before confirm. */
  const [capDraftByModel, setCapDraftByModel] = useState<Record<string, ProviderCapabilityTag[]>>(
    {},
  );
  const [editingCaps, setEditingCaps] = useState<Record<string, boolean>>({});
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editProtocol, setEditProtocol] = useState<ProviderProtocol>('openai-chat');
  const [rotateCredentialFromClipboard, setRotateCredentialFromClipboard] = useState(false);
  const [editCredentialLabel, setEditCredentialLabel] = useState('primary');
  const [editSupportsDiscovery, setEditSupportsDiscovery] = useState(true);
  const [ccPreview, setCcPreview] = useState<CcSwitchPreviewItem[] | null>(null);
  const [ccSelected, setCcSelected] = useState<Record<string, boolean>>({});
  const [ccBusy, setCcBusy] = useState(false);
  const [ccError, setCcError] = useState<string | null>(null);
  /** null = show all surfaces in order */
  const [surfaceFilter, setSurfaceFilter] = useState<ProviderSurface | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    props.providers[0]?.providerId ?? null,
  );

  const readiness = useMemo(
    () => projectProvidersReadiness({ providers: props.providers }),
    [props.providers],
  );

  const surfaceBuckets = useMemo(() => groupProvidersBySurface(props.providers), [props.providers]);

  const visibleBuckets = useMemo(() => {
    if (!surfaceFilter) return surfaceBuckets;
    return surfaceBuckets.filter((b) => b.surface === surfaceFilter);
  }, [surfaceBuckets, surfaceFilter]);

  const visibleProviders = useMemo(
    () => visibleBuckets.flatMap((bucket) => bucket.providers),
    [visibleBuckets],
  );

  useEffect(() => {
    if (selectedProviderId && visibleProviders.some((item) => item.providerId === selectedProviderId)) {
      return;
    }
    setSelectedProviderId(visibleProviders[0]?.providerId ?? null);
  }, [selectedProviderId, visibleProviders]);

  const detailBuckets = useMemo(() => {
    if (!selectedProviderId) return [] as ProviderSurfaceBucket[];
    return visibleBuckets.flatMap((bucket) => {
      const provider = bucket.providers.find((item) => item.providerId === selectedProviderId);
      return provider
        ? [
            {
              ...bucket,
              providers: [provider],
              modelCount: provider.models.length,
            },
          ]
        : [];
    });
  }, [selectedProviderId, visibleBuckets]);

  const resetForm = () => {
    setName('');
    setBaseUrl('https://');
    setProtocol('openai-chat');
    setCredentialLabel('primary');
    setSupportsDiscovery(true);
  };

  const beginEdit = (provider: ProviderPanelItem) => {
    setEditingProviderId(provider.providerId);
    setEditName(provider.name);
    setEditBaseUrl(provider.baseUrl);
    setEditProtocol(provider.protocol);
    setRotateCredentialFromClipboard(false);
    setEditCredentialLabel(provider.credentials[0]?.label ?? 'primary');
    setEditSupportsDiscovery(provider.supportsDiscovery);
    setOpenForm(false);
  };

  const cancelEdit = () => {
    setEditingProviderId(null);
    setRotateCredentialFromClipboard(false);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.onUpdate || !editingProviderId || props.busy) return;
    const payload: ProviderUpdateInput = {
      providerId: editingProviderId,
      name: editName.trim(),
      baseUrl: editBaseUrl.trim(),
      protocol: editProtocol,
      supportsDiscovery: editSupportsDiscovery,
      credentialLabel: editCredentialLabel.trim() || 'primary',
      rotateCredentialFromClipboard,
    };
    try {
      await props.onUpdate(payload);
      cancelEdit();
    } catch {
      // keep form open
    }
  };

  const loadCcSwitchPreview = async () => {
    if (!props.onPreviewCcSwitchImport || props.busy || ccBusy) return;
    setCcBusy(true);
    setCcError(null);
    try {
      const result = await props.onPreviewCcSwitchImport();
      if (!result) {
        setCcPreview([]);
        setCcSelected({});
        return;
      }
      const items = Array.isArray(result) ? result : result.items;
      setCcPreview(items);
      const next: Record<string, boolean> = {};
      for (const item of items) {
        if (item.importable) next[item.sourceId] = true;
      }
      setCcSelected(next);
    } catch (error) {
      setCcError(error instanceof Error ? error.message : '预览 CC Switch 失败');
      setCcPreview(null);
    } finally {
      setCcBusy(false);
    }
  };

  const confirmCcSwitchImport = async () => {
    if (!props.onImportCcSwitch || !ccPreview || props.busy || ccBusy) return;
    const sourceIds = ccPreview
      .filter((item) => item.importable && ccSelected[item.sourceId])
      .map((item) => item.sourceId);
    if (sourceIds.length === 0) {
      setCcError('请至少选择一项可导入配置');
      return;
    }
    setCcBusy(true);
    setCcError(null);
    try {
      await props.onImportCcSwitch(sourceIds);
      setCcPreview(null);
      setCcSelected({});
    } catch (error) {
      setCcError(error instanceof Error ? error.message : '导入 CC Switch 失败');
    } finally {
      setCcBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.onCreate || props.busy) return;
    const payload = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      protocol,
      supportsDiscovery,
      credentialLabel: credentialLabel.trim() || 'primary',
    };
    try {
      await props.onCreate(payload);
      resetForm();
      setOpenForm(false);
    } catch {
      // Keep form open on failure; secret already cleared intentionally.
    }
  };

  return (
    <section
      className="st-providers"
      data-testid="providers-panel"
      data-level={readiness.level}
      aria-label="Providers"
    >
      <header className="st-providers__header">
        <div className="st-providers__title-row">
          <span className="st-providers__mark" aria-hidden="true">
            <Server size={14} strokeWidth={1.8} />
          </span>
          <div>
            <strong>模型源</strong>
            <small>{readiness.countLabel}</small>
          </div>
        </div>
        <button
          type="button"
          className="st-providers__add"
          data-testid="provider-add-toggle"
          onClick={() => setOpenForm((v) => !v)}
          aria-expanded={openForm}
        >
          <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
          {openForm ? '收起' : '添加'}
        </button>
      </header>

      {props.statusNote ? (
        <p className="st-providers__status" role="status" data-testid="provider-status">
          <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
          {props.statusNote}
        </p>
      ) : null}
      {props.error ? (
        <p className="st-providers__error" role="alert" data-testid="provider-error">
          {props.error}
        </p>
      ) : null}

      <details
        className="st-providers__cc-switch"
        data-testid="provider-cc-switch"
        open={ccPreview ? true : undefined}
      >
        <summary className="st-providers__cc-switch-head">
          <Download size={13} strokeWidth={1.8} aria-hidden="true" />
          <strong>从 CC Switch 导入</strong>
          <small>预览 → 确认 · 密钥仅写入安全存储</small>
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <div className="st-providers__cc-switch-actions">
          <button
            type="button"
            className="st-providers__ghost"
            data-testid="provider-cc-switch-preview"
            disabled={props.busy || ccBusy || !props.onPreviewCcSwitchImport}
            onClick={() => void loadCcSwitchPreview()}
          >
            预览本机配置
          </button>
          {ccPreview ? (
            <button
              type="button"
              className="st-providers__ghost"
              data-testid="provider-cc-switch-import"
              disabled={props.busy || ccBusy || !props.onImportCcSwitch}
              onClick={() => void confirmCcSwitchImport()}
            >
              确认导入所选
            </button>
          ) : null}
          {ccPreview ? (
            <button
              type="button"
              className="st-providers__ghost"
              data-testid="provider-cc-switch-cancel"
              disabled={ccBusy}
              onClick={() => {
                setCcPreview(null);
                setCcSelected({});
                setCcError(null);
              }}
            >
              取消
            </button>
          ) : null}
        </div>
        {ccError ? (
          <p className="st-providers__error" role="alert" data-testid="provider-cc-switch-error">
            {ccError}
          </p>
        ) : null}
        {ccPreview ? (
          <ul className="st-providers__cc-list" data-testid="provider-cc-switch-list">
            {ccPreview.map((item) => (
              <li
                key={item.sourceId}
                className="st-providers__cc-item"
                data-testid={`provider-cc-item-${item.sourceId}`}
                data-importable={item.importable ? '1' : '0'}
              >
                <label className="st-providers__check">
                  <input
                    type="checkbox"
                    checked={Boolean(ccSelected[item.sourceId])}
                    disabled={!item.importable || ccBusy || props.busy}
                    data-testid={`provider-cc-select-${item.sourceId}`}
                    onChange={(e) =>
                      setCcSelected((prev) => ({ ...prev, [item.sourceId]: e.target.checked }))
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.appType}
                      {item.protocol ? ` · ${item.protocol}` : ''}
                      {item.baseUrl ? ` · ${item.baseUrl}` : ''}
                      {item.hasSecret ? ' · 有密钥' : ' · 无密钥'}
                      {item.models.length > 0 ? ` · ${item.models.length} 模型` : ''}
                    </small>
                    {item.warnings.length > 0 ? (
                      <em data-testid={`provider-cc-warn-${item.sourceId}`}>
                        {item.warnings.join('；')}
                      </em>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      {openForm ? (
        <form
          className="st-providers__form"
          onSubmit={(e) => void submit(e)}
          data-testid="provider-form"
        >
          <p className="st-providers__clipboard-notice" data-testid="provider-clipboard-notice">
            创建时会从系统剪贴板读取一次凭据，并立即写入系统安全存储；页面不会回显。
          </p>
          <label className="st-providers__field">
            <span>名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 Fake Gateway"
              required
              maxLength={256}
              autoComplete="off"
              data-testid="provider-name"
            />
          </label>
          <label className="st-providers__field">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gateway.example/v1"
              required
              maxLength={2048}
              autoComplete="off"
              spellCheck={false}
              data-testid="provider-base-url"
            />
          </label>
          <label className="st-providers__field">
            <span>协议</span>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as ProviderProtocol)}
              data-testid="provider-protocol"
            >
              {PROTOCOL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="st-providers__field">
            <span>凭证标签</span>
            <input
              value={credentialLabel}
              onChange={(e) => setCredentialLabel(e.target.value)}
              placeholder="primary"
              maxLength={256}
              autoComplete="off"
              data-testid="provider-credential-label"
            />
          </label>
          <label className="st-providers__check">
            <input
              type="checkbox"
              checked={supportsDiscovery}
              onChange={(e) => setSupportsDiscovery(e.target.checked)}
              data-testid="provider-discovery"
            />
            <span>创建后尝试模型发现</span>
          </label>
          <div className="st-providers__form-actions">
            <button type="submit" disabled={props.busy} data-testid="provider-submit">
              {props.busy ? '创建中…' : '从系统剪贴板读取凭据并创建'}
            </button>
          </div>
        </form>
      ) : null}

      {props.providers.length > 0 ? (
        <div
          className="st-providers__surface-rail"
          data-testid="provider-surface-rail"
          role="tablist"
          aria-label="按分组浏览"
        >
          <button
            type="button"
            role="tab"
            className="st-providers__surface-tab"
            data-active={surfaceFilter === null ? '1' : '0'}
            aria-selected={surfaceFilter === null}
            onClick={() => setSurfaceFilter(null)}
            data-testid="provider-surface-tab-all"
          >
            <Layers3 size={13} strokeWidth={1.8} aria-hidden="true" />
            <span>全部</span>
            <em>{props.providers.length}</em>
          </button>
          {surfaceBuckets.map((bucket) => {
            const Icon = SURFACE_ICON[bucket.surface];
            return (
              <button
                key={bucket.surface}
                type="button"
                role="tab"
                className="st-providers__surface-tab"
                data-surface={bucket.surface}
                data-active={surfaceFilter === bucket.surface ? '1' : '0'}
                aria-selected={surfaceFilter === bucket.surface}
                onClick={() => setSurfaceFilter(bucket.surface)}
                data-testid={`provider-surface-tab-${bucket.surface}`}
              >
                <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{bucket.label}</span>
                <em>{bucket.providers.length}</em>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="st-providers__workspace">
        <aside className="st-providers__index" aria-label="供应商列表">
          <header>
            <div>
              <strong>供应商</strong>
              <small>{visibleProviders.length} 个可用配置</small>
            </div>
          </header>
          <div className="st-providers__index-scroll">
            {visibleBuckets.map((bucket) => {
              const Icon = SURFACE_ICON[bucket.surface];
              return (
                <section
                  key={bucket.surface}
                  className="st-providers__index-group"
                  data-surface={bucket.surface}
                  data-testid={`provider-index-group-${bucket.surface}`}
                >
                  <h3>
                    <Icon aria-hidden="true" size={12} strokeWidth={1.8} />
                    <span>{bucket.label}</span>
                    <em>{bucket.providers.length}</em>
                  </h3>
                  {bucket.providers.map((provider) => {
                    const selected = provider.providerId === selectedProviderId;
                    return (
                      <button
                        key={provider.providerId}
                        type="button"
                        className="st-providers__index-item"
                        data-active={selected ? '1' : '0'}
                        data-testid={`provider-select-${provider.providerId}`}
                        onClick={() => {
                          setSelectedProviderId(provider.providerId);
                          setExpanded((previous) => ({
                            ...previous,
                            [provider.providerId]: true,
                          }));
                        }}
                      >
                        <span>
                          <strong>{provider.name}</strong>
                          <small>{provider.protocol}</small>
                          <em>
                            {provider.credentials[0]?.groupName || '未分组'} ·{' '}
                            {provider.models.length} 个模型
                          </em>
                        </span>
                        <ChevronRight aria-hidden="true" size={13} strokeWidth={1.8} />
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </aside>

        <div className="st-providers__list" data-loading={props.loading ? 'true' : 'false'}>
        {props.providers.length === 0 ? (
          <div className="st-providers__empty" data-testid="provider-empty">
            <Cable size={18} strokeWidth={1.6} aria-hidden="true" />
            <strong>{props.emptyTitle ?? '尚未配置模型源'}</strong>
            <p>
              {props.emptyHint ??
                '可从 CC Switch 导入，或手动添加 baseURL + key + protocol。密钥写入安全存储。'}
            </p>
          </div>
        ) : visibleBuckets.length === 0 ? (
          <div className="st-providers__empty" data-testid="provider-surface-empty">
            <Cable size={18} strokeWidth={1.6} aria-hidden="true" />
            <strong>该分组下暂无供应商</strong>
            <p>切换上方分组，或点「全部」查看所有模型源。</p>
          </div>
        ) : (
          detailBuckets.map((bucket) => {
            const Icon = SURFACE_ICON[bucket.surface];
            return (
              <section
                key={bucket.surface}
                className="st-providers__surface-section"
                data-surface={bucket.surface}
                data-testid={`provider-surface-section-${bucket.surface}`}
                aria-label={`${bucket.label} 分组`}
              >
                <header className="st-providers__surface-head">
                  <span className="st-providers__surface-mark" aria-hidden="true">
                    <Icon size={14} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong>{bucket.label}</strong>
                    <small>
                      {bucket.providers.length} 个供应商 · {bucket.modelCount} 个模型
                    </small>
                  </div>
                </header>

                <div className="st-providers__surface-providers">
                  {bucket.providers.map((provider) => {
                    const isOpen = expanded[provider.providerId] ?? true;
                    const surface = resolveProviderSurface(provider);
                    return (
                      <article
                        key={provider.providerId}
                        className="st-providers__card"
                        data-testid={`provider-card-${provider.providerId}`}
                        data-surface={surface}
                      >
                        <button
                          type="button"
                          className="st-providers__card-head"
                          data-testid={`provider-expand-${provider.providerId}`}
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [provider.providerId]: true,
                            }))
                          }
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
                          )}
                          <span className="st-providers__card-title">
                            <strong>{provider.name}</strong>
                            <small title={provider.baseUrl}>{provider.baseUrl}</small>
                          </span>
                          <span className="st-providers__surface-chip" title="所属分组">
                            {PROVIDER_SURFACE_LABELS[surface]}
                          </span>
                          <span
                            className="st-providers__proto"
                            data-testid={`provider-protocol-${provider.providerId}`}
                            title="默认协议（发现/空目录添加）"
                          >
                            {provider.protocol}
                          </span>
                          <span
                            className="st-providers__secret-chip"
                            data-testid={`provider-secret-chip-${provider.providerId}`}
                            title={provider.credentials[0]?.hasSecret ? '已配置密钥' : '未配置密钥'}
                          >
                            <KeyRound size={11} strokeWidth={1.8} aria-hidden="true" />
                            {maskHint(Boolean(provider.credentials[0]?.hasSecret))}
                          </span>
                          <span className="st-providers__badge">
                            {provider.models.length} 个模型
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="st-providers__card-body">
                            <div className="st-providers__meta">
                              <span>
                                <KeyRound size={12} strokeWidth={1.8} aria-hidden="true" />
                                {provider.credentials[0]
                                  ? `${provider.credentials[0].label} · ${maskHint(provider.credentials[0].hasSecret)}`
                                  : '无凭证'}
                                <span
                                  className="st-providers__mask-sr"
                                  data-testid={`provider-credential-mask-${provider.providerId}`}
                                  hidden
                                >
                                  {provider.credentials[0]?.hasSecret ? 'masked' : 'none'}
                                </span>
                              </span>
                              <span
                                data-protocol={provider.protocol}
                                data-testid={`provider-meta-protocol-${provider.providerId}`}
                              >
                                协议 {provider.protocol}
                              </span>
                              <span data-discovery={provider.supportsDiscovery ? '1' : '0'}>
                                发现 {provider.supportsDiscovery ? '开' : '关'}
                              </span>
                              <span data-testid={`provider-meta-surface-${provider.providerId}`}>
                                分组 {PROVIDER_SURFACE_LABELS[surface]}
                              </span>
                            </div>

                            <ul className="st-providers__models">
                              {provider.models.map((model) => {
                                const isEditing = editingCaps[model.modelId] ?? false;
                                const draft =
                                  capDraftByModel[model.modelId] ??
                                  (model.capabilities.length > 0
                                    ? [...model.capabilities]
                                    : (['text'] as ProviderCapabilityTag[]));
                                return (
                                  <li
                                    key={model.modelId}
                                    className="st-providers__model-row"
                                    data-testid={`provider-model-${model.modelId}`}
                                  >
                                    <div className="st-providers__model-main">
                                      <span className="st-providers__model-name">
                                        {model.displayName}
                                      </span>
                                      <code>{model.providerModelId}</code>
                                      {model.capabilitiesConfirmed ? (
                                        <em
                                          className="st-providers__confirmed"
                                          data-testid={`provider-cap-confirmed-${model.modelId}`}
                                        >
                                          <ShieldCheck
                                            size={11}
                                            strokeWidth={1.8}
                                            aria-hidden="true"
                                          />
                                          confirmed
                                        </em>
                                      ) : (
                                        <em
                                          className="st-providers__suggested"
                                          data-testid={`provider-cap-suggested-${model.modelId}`}
                                        >
                                          suggested
                                        </em>
                                      )}
                                    </div>
                                    <div
                                      className="st-providers__cap-row"
                                      data-testid={`provider-caps-${model.modelId}`}
                                    >
                                      {CAPABILITY_OPTIONS.map((opt) => {
                                        const active = draft.includes(opt.value);
                                        return (
                                          <button
                                            key={opt.value}
                                            type="button"
                                            className="st-providers__cap-chip"
                                            data-active={active ? '1' : '0'}
                                            data-testid={`provider-cap-${model.modelId}-${opt.value}`}
                                            disabled={
                                              props.busy ||
                                              (!isEditing && model.capabilitiesConfirmed)
                                            }
                                            onClick={() => {
                                              if (!isEditing) {
                                                setEditingCaps((prev) => ({
                                                  ...prev,
                                                  [model.modelId]: true,
                                                }));
                                              }
                                              setCapDraftByModel((prev) => {
                                                const base =
                                                  prev[model.modelId] ??
                                                  (model.capabilities.length > 0
                                                    ? [...model.capabilities]
                                                    : (['text'] as ProviderCapabilityTag[]));
                                                const next = base.includes(opt.value)
                                                  ? base.filter((t) => t !== opt.value)
                                                  : [...base, opt.value];
                                                return { ...prev, [model.modelId]: next };
                                              });
                                            }}
                                            title={opt.label}
                                          >
                                            {opt.label}
                                          </button>
                                        );
                                      })}
                                      <div className="st-providers__cap-actions">
                                        {!model.capabilitiesConfirmed || isEditing ? (
                                          <button
                                            type="button"
                                            className="st-providers__ghost st-providers__cap-confirm"
                                            data-testid={`provider-cap-confirm-${model.modelId}`}
                                            disabled={props.busy || draft.length === 0}
                                            onClick={() => {
                                              void props.onConfirmCapabilities?.(
                                                model.modelId,
                                                draft,
                                                true,
                                              );
                                              setEditingCaps((prev) => ({
                                                ...prev,
                                                [model.modelId]: false,
                                              }));
                                            }}
                                          >
                                            <Check size={12} strokeWidth={1.8} aria-hidden="true" />
                                            确认
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            className="st-providers__ghost"
                                            data-testid={`provider-cap-edit-${model.modelId}`}
                                            disabled={props.busy}
                                            onClick={() => {
                                              setEditingCaps((prev) => ({
                                                ...prev,
                                                [model.modelId]: true,
                                              }));
                                              setCapDraftByModel((prev) => ({
                                                ...prev,
                                                [model.modelId]:
                                                  model.capabilities.length > 0
                                                    ? [...model.capabilities]
                                                    : (['text'] as ProviderCapabilityTag[]),
                                              }));
                                            }}
                                          >
                                            编辑
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                              {provider.models.length === 0 ? (
                                <li className="st-providers__models-empty">
                                  尚无模型 · 可发现或手动添加
                                </li>
                              ) : null}
                            </ul>

                            {editingProviderId === provider.providerId ? (
                              <form
                                className="st-providers__form st-providers__edit-form"
                                onSubmit={(e) => void submitEdit(e)}
                                data-testid={`provider-edit-form-${provider.providerId}`}
                              >
                                <label className="st-providers__field">
                                  <span>名称</span>
                                  <input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    required
                                    maxLength={256}
                                    autoComplete="off"
                                    data-testid={`provider-edit-name-${provider.providerId}`}
                                  />
                                </label>
                                <label className="st-providers__field">
                                  <span>Base URL</span>
                                  <input
                                    value={editBaseUrl}
                                    onChange={(e) => setEditBaseUrl(e.target.value)}
                                    required
                                    maxLength={2048}
                                    autoComplete="off"
                                    spellCheck={false}
                                    data-testid={`provider-edit-base-url-${provider.providerId}`}
                                  />
                                </label>
                                <label className="st-providers__field">
                                  <span>协议</span>
                                  <select
                                    value={editProtocol}
                                    onChange={(e) =>
                                      setEditProtocol(e.target.value as ProviderProtocol)
                                    }
                                    data-testid={`provider-edit-protocol-${provider.providerId}`}
                                  >
                                    {PROTOCOL_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="st-providers__check">
                                  <input
                                    type="checkbox"
                                    checked={rotateCredentialFromClipboard}
                                    onChange={(e) =>
                                      setRotateCredentialFromClipboard(e.target.checked)
                                    }
                                    data-testid={`provider-edit-rotate-credential-${provider.providerId}`}
                                  />
                                  <span>从系统剪贴板更新凭据</span>
                                </label>
                                <label className="st-providers__field">
                                  <span>凭证标签</span>
                                  <input
                                    value={editCredentialLabel}
                                    onChange={(e) => setEditCredentialLabel(e.target.value)}
                                    maxLength={256}
                                    autoComplete="off"
                                    data-testid={`provider-edit-credential-label-${provider.providerId}`}
                                  />
                                </label>
                                <label className="st-providers__check">
                                  <input
                                    type="checkbox"
                                    checked={editSupportsDiscovery}
                                    onChange={(e) => setEditSupportsDiscovery(e.target.checked)}
                                    data-testid={`provider-edit-discovery-${provider.providerId}`}
                                  />
                                  <span>支持模型发现</span>
                                </label>
                                <div className="st-providers__form-actions">
                                  <button
                                    type="button"
                                    className="st-providers__ghost"
                                    onClick={cancelEdit}
                                    disabled={props.busy}
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={props.busy}
                                    data-testid={`provider-edit-submit-${provider.providerId}`}
                                  >
                                    保存修改
                                  </button>
                                </div>
                              </form>
                            ) : null}

                            <div className="st-providers__card-actions">
                              <button
                                type="button"
                                className="st-providers__ghost"
                                disabled={props.busy || !props.onUpdate}
                                onClick={() => beginEdit(provider)}
                                data-testid={`provider-edit-${provider.providerId}`}
                                title="编辑名称 / Base URL / 协议 / 密钥"
                              >
                                <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                                编辑
                              </button>
                              <button
                                type="button"
                                className="st-providers__ghost"
                                disabled={props.busy || !provider.supportsDiscovery}
                                onClick={() => void props.onDiscover?.(provider.providerId)}
                                data-testid={`provider-discover-${provider.providerId}`}
                                title={`按 ${provider.protocol} 协议向网关拉取模型列表（密钥不入 UI）`}
                              >
                                <Radar size={13} strokeWidth={1.8} aria-hidden="true" />
                                发现模型
                              </button>
                              <button
                                type="button"
                                className="st-providers__ghost"
                                disabled={props.busy || provider.models.length === 0}
                                onClick={() =>
                                  void props.onProbeCapabilities?.(provider.providerId)
                                }
                                data-testid={`provider-probe-${provider.providerId}`}
                                title="本地启发式能力探测（建议，非事实）"
                              >
                                <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
                                探测能力
                              </button>
                              <div className="st-providers__manual">
                                <input
                                  value={manualModelByProvider[provider.providerId] ?? ''}
                                  onChange={(e) =>
                                    setManualModelByProvider((prev) => ({
                                      ...prev,
                                      [provider.providerId]: e.target.value,
                                    }))
                                  }
                                  placeholder="手动 model id"
                                  autoComplete="off"
                                  spellCheck={false}
                                  data-testid={`provider-manual-model-${provider.providerId}`}
                                />
                                <button
                                  type="button"
                                  className="st-providers__ghost"
                                  disabled={
                                    props.busy ||
                                    !(manualModelByProvider[provider.providerId] ?? '').trim()
                                  }
                                  onClick={() => {
                                    const id = (
                                      manualModelByProvider[provider.providerId] ?? ''
                                    ).trim();
                                    if (!id) return;
                                    void props.onAddModel?.(provider.providerId, id);
                                    setManualModelByProvider((prev) => ({
                                      ...prev,
                                      [provider.providerId]: '',
                                    }));
                                  }}
                                  data-testid={`provider-add-model-${provider.providerId}`}
                                >
                                  添加
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
        </div>
      </div>
    </section>
  );
}
