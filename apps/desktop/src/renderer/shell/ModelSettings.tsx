// NewMax-style model source settings: dual-pane provider manager + global model prefs.
// Left: ordered provider list with enable toggles.
// Right: selected provider detail (endpoint / keys / models / priority) + global vision/plan-act.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  GripVertical,
  Image,
  KeyRound,
  Loader2,
  Mic2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  ModelPricingEntry,
  ProviderModelSummary,
  ProviderSummary,
  UsageSummaryResponse,
} from '@sync-think/protocol';

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
}

type PricingDraft = ModelPricingEntry;

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

interface EditDraft {
  name: string;
  baseUrl: string;
  protocol: ProtocolFamily;
  supportsDiscovery: boolean;
  apiKey: string;
}

const PROTOCOL_OPTIONS: Array<{ value: ProtocolFamily; label: string; hint: string }> = [
  { value: 'openai-chat', label: 'OpenAI Chat', hint: 'Chat Completions（最通用）' },
  { value: 'openai-responses', label: 'OpenAI Responses', hint: 'Responses API' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', hint: 'Claude 官方协议' },
  { value: 'openai-images', label: 'OpenAI Images', hint: '生图端点' },
];

const EMPTY_CREATE: CreateDraft = {
  name: '',
  baseUrl: 'https://',
  protocol: 'openai-chat',
  apiKey: '',
  supportsDiscovery: true,
};

function bridge() {
  return window.syncThink?.runtime;
}

function protocolLabel(protocol: string): string {
  return PROTOCOL_OPTIONS.find((p) => p.value === protocol)?.label ?? protocol;
}

function formatContext(tokens?: number): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}m`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function maskKeyLabel(label: string, hasSecret: boolean): string {
  return hasSecret ? `${label} · ••••••••` : `${label} · 未写入`;
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
    return { enabled: false, planModelId: null, actModelId: null };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    planModelId: typeof o.planModelId === 'string' && o.planModelId ? o.planModelId : null,
    actModelId: typeof o.actModelId === 'string' && o.actModelId ? o.actModelId : null,
  };
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function ModelSettings({
  onCatalogChanged,
}: {
  onCatalogChanged?: () => void;
} = {}) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [visionFallback, setVisionFallback] = useState<VisionFallbackSetting>({
    enabled: false,
    modelId: null,
  });
  const [planAct, setPlanAct] = useState<PlanActSetting>({
    enabled: false,
    planModelId: null,
    actModelId: null,
  });

  const selected = useMemo(
    () => providers.find((p) => p.providerId === selectedId) ?? null,
    [providers, selectedId],
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
        api.getSettings?.({ keys: ['vision-fallback', 'plan-act'] }) ??
          Promise.resolve({ settings: {} as Record<string, unknown> }),
      ]);
      const next = [...listed.providers].sort((a, b) => a.sortOrder - b.sortOrder);
      setProviders(next);
      setVisionFallback(parseVisionFallback(settings.settings?.['vision-fallback']));
      setPlanAct(parsePlanAct(settings.settings?.['plan-act']));
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
    async (label: string, fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setStatus(label);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        setStatus(null);
      } finally {
        setBusy(false);
        onCatalogChanged?.();
      }
    },
    [onCatalogChanged],
  );

  const handleCreate = () =>
    void withBusy('正在创建供应商…', async () => {
      const api = bridge();
      if (!api?.createProvider) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = createDraft.apiKey.trim();
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') throw new Error('请填写 Base URL');
      if (!apiKey) throw new Error('请填写 API Key，并先复制到剪贴板');
      await navigator.clipboard.writeText(apiKey);
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol: createDraft.protocol,
        supportsDiscovery: createDraft.supportsDiscovery,
      });
      setStatus(`已创建 ${result.provider.name} · 发现 ${result.discoveredModelCount} 个模型`);
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      setSelectedId(result.provider.providerId);
      await load();
    });

  const handleMoveProvider = (providerId: string, direction: -1 | 1) =>
    void withBusy('正在调整默认模型顺序…', async () => {
      const api = bridge();
      if (!api?.reorderProviders) throw new Error('Runtime 未连接');
      const ordered = providers.filter((provider) => provider.enabled);
      const index = ordered.findIndex((provider) => provider.providerId === providerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      const nextEnabled = [...ordered];
      const [moved] = nextEnabled.splice(index, 1);
      nextEnabled.splice(target, 0, moved);
      const disabled = providers.filter((provider) => !provider.enabled);
      await api.reorderProviders({
        orderedProviderIds: [...nextEnabled, ...disabled].map(
          (provider) => provider.providerId as never,
        ),
      });
      setStatus('启用模型顺序已更新');
      await load();
    });

  const handleToggleEnabled = (provider: ProviderSummary, enabled: boolean) =>
    void withBusy(enabled ? '正在启用…' : '正在停用…', async () => {
      const api = bridge();
      if (!api?.updateProvider) throw new Error('Runtime 未连接');
      await api.updateProvider({ providerId: provider.providerId, enabled });
      setStatus(`${provider.name} 已${enabled ? '启用' : '停用'}`);
      await load();
    });

  const handleSaveEdit = (providerId: string, draft: EditDraft) =>
    void withBusy('正在保存…', async () => {
      const api = bridge();
      if (!api?.updateProvider) throw new Error('Runtime 未连接');
      const payload: {
        providerId: string;
        name: string;
        baseUrl: string;
        protocol: ProtocolFamily;
        supportsDiscovery: boolean;
        rotateCredentialFromClipboard?: boolean;
      } = {
        providerId,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        protocol: draft.protocol,
        supportsDiscovery: draft.supportsDiscovery,
      };
      if (draft.apiKey.trim()) {
        await navigator.clipboard.writeText(draft.apiKey.trim());
        payload.rotateCredentialFromClipboard = true;
      }
      const result = await api.updateProvider(payload);
      setStatus(
        result.secretRotated
          ? `已更新 ${result.provider.name} · 密钥已轮换`
          : `已更新 ${result.provider.name}`,
      );
      await load();
    });

  const handleAddCredential = (providerId: string, apiKey: string, label?: string) =>
    void withBusy('正在添加密钥…', async () => {
      const api = bridge();
      if (!api?.addProviderCredential) throw new Error('Runtime 未连接');
      await navigator.clipboard.writeText(apiKey);
      await api.addProviderCredential({
        providerId,
        label: label?.trim() || undefined,
      });
      setStatus('密钥已写入安全存储');
      await load();
    });

  const handleRemoveCredential = (providerId: string, credentialRefId: string) =>
    void withBusy('正在删除密钥…', async () => {
      const api = bridge();
      if (!api?.removeProviderCredential) throw new Error('Runtime 未连接');
      await api.removeProviderCredential({
        providerId: providerId as never,
        credentialRefId: credentialRefId as never,
      });
      setStatus('密钥已删除');
      await load();
    });

  const handleDiscover = (providerId: string) =>
    void withBusy('正在发现模型…', async () => {
      const api = bridge();
      if (!api?.discoverModels) throw new Error('Runtime 未连接');
      const result = await api.discoverModels({ providerId: providerId as never });
      setStatus(
        `发现 ${result.models.length} 个模型` +
          (result.addedIds?.length ? ` · 新增 ${result.addedIds.length}` : ''),
      );
      await load();
    });

  const handleAddModel = (
    providerId: string,
    protocol: ProtocolFamily,
    providerModelId: string,
    displayName?: string,
    contextWindow?: number,
  ) =>
    void withBusy('正在添加模型…', async () => {
      const api = bridge();
      if (!api?.addModels) throw new Error('Runtime 未连接');
      await api.addModels({
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
      setStatus(`已添加模型 ${providerModelId}`);
      await load();
    });

  const handleRemoveModel = (providerId: string, modelId: string) =>
    void withBusy('正在移除模型…', async () => {
      const api = bridge();
      if (!api?.removeProviderModel) throw new Error('Runtime 未连接');
      await api.removeProviderModel({
        providerId: providerId as never,
        modelId: modelId as never,
      });
      setStatus('模型已移除');
      await load();
    });

  const handleMoveModel = (provider: ProviderSummary, modelId: string, direction: -1 | 1) =>
    void withBusy('正在调整模型优先级…', async () => {
      const api = bridge();
      if (!api?.setModelPriorities) throw new Error('Runtime 未连接');
      const ordered = [...provider.models].sort((a, b) => a.priority - b.priority);
      const idx = ordered.findIndex((m) => m.modelId === modelId);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= ordered.length) return;
      const next = [...ordered];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      await api.setModelPriorities({
        providerId: provider.providerId as never,
        entries: next.map((m) => ({
          modelId: m.modelId as never,
          credentialRefId: (m.credentialRefId ?? undefined) as never,
        })),
      });
      setStatus('模型优先级已更新');
      await load();
    });

  const handlePinCredential = (
    provider: ProviderSummary,
    modelId: string,
    credentialRefId: string | null,
  ) =>
    void withBusy('正在绑定密钥…', async () => {
      const api = bridge();
      if (!api?.setModelPriorities) throw new Error('Runtime 未连接');
      const ordered = [...provider.models].sort((a, b) => a.priority - b.priority);
      await api.setModelPriorities({
        providerId: provider.providerId as never,
        entries: ordered.map((m) => ({
          modelId: m.modelId as never,
          credentialRefId: (m.modelId === modelId
            ? credentialRefId
            : (m.credentialRefId ?? undefined)) as never,
        })),
      });
      setStatus(credentialRefId ? '模型已绑定密钥' : '已清除模型密钥绑定');
      await load();
    });

  const handleSaveVision = (next: VisionFallbackSetting) =>
    void withBusy('正在保存 Vision Fallback…', async () => {
      const api = bridge();
      if (!api?.setSetting) throw new Error('Runtime 未连接');
      await api.setSetting({ key: 'vision-fallback', value: next });
      setVisionFallback(next);
      setStatus('Vision Fallback 已保存');
    });

  const handleSavePlanAct = (next: PlanActSetting) =>
    void withBusy('正在保存 Plan & Act…', async () => {
      const api = bridge();
      if (!api?.setSetting) throw new Error('Runtime 未连接');
      await api.setSetting({ key: 'plan-act', value: next });
      setPlanAct(next);
      setStatus('Plan & Act 已保存');
    });

  const [modelTab, setModelTab] = useState<'text' | 'image' | 'video' | 'voice' | 'usage'>('text');

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
    <div className="flex h-full min-h-0 flex-col">
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
            onClick={() => setModelTab(id as typeof modelTab)}
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
        <div className="model-settings-unavailable">
          <p>
            {modelTab === 'image' ? '图像生成' : modelTab === 'video' ? '视频生成' : '语音生成'}
            模型配置尚未接入。
          </p>
          <span>入口按 NewMax 的模型设置结构保留。</span>
        </div>
      ) : (
        <>
          {(error || status) && (
            <div className="shrink-0 border-b border-border px-5 py-2">
              {error ? (
                <p className="text-[12.5px] text-error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="text-[12.5px] text-accent-text" role="status">
                  {status}
                </p>
              )}
            </div>
          )}

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
                  disabled={busy}
                  onClick={() => {
                    setShowCreate(true);
                    setSelectedId(null);
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
                  <ul>
                    {enabledProviders.map((p, index) => {
                      const active = p.providerId === selectedId && !showCreate;
                      const primaryModel = [...p.models].sort((a, b) => a.priority - b.priority)[0];
                      return (
                        <li
                          key={p.providerId}
                          className={clsx('model-enabled-row', active && 'is-active')}
                        >
                          <GripVertical size={13} className="model-enabled-row__grip" />
                          <button
                            type="button"
                            className="model-enabled-row__main"
                            onClick={() => {
                              setShowCreate(false);
                              setSelectedId(p.providerId);
                            }}
                          >
                            <span className="model-enabled-row__avatar">
                              {p.name[0]?.toUpperCase() ?? '?'}
                            </span>
                            <span className="model-enabled-row__copy">
                              <span>
                                {p.name}
                                {index === 0 ? <em>默认</em> : null}
                              </span>
                              <small>{primaryModel?.displayName ?? '未添加模型'}</small>
                            </span>
                          </button>
                          <div className="model-enabled-row__order">
                            <button
                              type="button"
                              title="上移"
                              disabled={busy || index === 0}
                              onClick={() => handleMoveProvider(p.providerId, -1)}
                            >
                              <ArrowUp size={10} />
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={busy || index === enabledProviders.length - 1}
                              onClick={() => handleMoveProvider(p.providerId, 1)}
                            >
                              <ArrowDown size={10} />
                            </button>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked
                            title="停用"
                            disabled={busy}
                            className="model-enabled-row__toggle is-checked"
                            onClick={() => handleToggleEnabled(p, false)}
                          >
                            <span />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  className="model-enabled-list__add"
                  disabled={busy}
                  onClick={() => {
                    setShowCreate(true);
                    setSelectedId(null);
                  }}
                >
                  <Plus size={13} /> 添加模型
                </button>
                {disabledProviders.length > 0 ? (
                  <details className="model-disabled-list">
                    <summary>已停用模型 {disabledProviders.length}</summary>
                    <ul>
                      {disabledProviders.map((provider) => {
                        const primaryModel = [...provider.models].sort(
                          (a, b) => a.priority - b.priority,
                        )[0];
                        return (
                          <li key={provider.providerId} className="model-enabled-row is-disabled">
                            <span className="model-enabled-row__avatar">
                              {provider.name[0]?.toUpperCase() ?? '?'}
                            </span>
                            <button
                              type="button"
                              className="model-enabled-row__main"
                              onClick={() => {
                                setShowCreate(false);
                                setSelectedId(provider.providerId);
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
                              onClick={() => handleToggleEnabled(provider, true)}
                            >
                              启用
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
              </div>

              <div className="model-enabled-list__secondary">
                <button type="button" onClick={() => setModelTab('usage')}>
                  使用统计
                </button>
                <button type="button" disabled>
                  图片识别 Fallback
                </button>
                <button type="button" disabled>
                  规划 & 执行模型
                </button>
              </div>
            </aside>

            {/* Right: detail / create / global */}
            <div className="model-settings-detail">
              {showCreate ? (
                <CreateProviderForm
                  draft={createDraft}
                  busy={busy}
                  onChange={setCreateDraft}
                  onSubmit={handleCreate}
                  onCancel={() => {
                    setShowCreate(false);
                    setCreateDraft(EMPTY_CREATE);
                    if (providers[0]) setSelectedId(providers[0].providerId);
                  }}
                />
              ) : selected ? (
                <ProviderDetail
                  provider={selected}
                  busy={busy}
                  onSaveEdit={handleSaveEdit}
                  onAddCredential={handleAddCredential}
                  onRemoveCredential={handleRemoveCredential}
                  onDiscover={handleDiscover}
                  onAddModel={handleAddModel}
                  onRemoveModel={handleRemoveModel}
                  onMoveModel={handleMoveModel}
                  onPinCredential={handlePinCredential}
                />
              ) : (
                <EmptyDetail onAdd={() => setShowCreate(true)} />
              )}

              <GlobalModelPrefs
                allModels={allModels}
                visionFallback={visionFallback}
                planAct={planAct}
                busy={busy}
                onSaveVision={handleSaveVision}
                onSavePlanAct={handleSavePlanAct}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CreateProviderForm({
  draft,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: CreateDraft;
  busy: boolean;
  onChange: (d: CreateDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-b border-border px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-accent-text" />
          <h2 className="text-[15px] font-semibold text-text">添加模型源</h2>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-text-faint hover:bg-hover"
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>
      <div className="grid max-w-[520px] gap-3">
        <Field label="名称">
          <input
            className="st-field-input"
            value={draft.name}
            placeholder="例如 New API / OpenAI / Claude"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Base URL">
          <input
            className="st-field-input font-mono text-[12.5px]"
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
          />
        </Field>
        <Field label="API 格式">
          <select
            className="st-field-input"
            value={draft.protocol}
            disabled={busy}
            onChange={(e) => onChange({ ...draft, protocol: e.target.value as ProtocolFamily })}
          >
            {PROTOCOL_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
        </Field>
        <Field label="API Key">
          <input
            className="st-field-input font-mono text-[12.5px]"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            placeholder="sk-…"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
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
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : '创建并保存'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-text-secondary hover:bg-hover"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider detail ─────────────────────────────────────────────────────────

function ProviderDetail({
  provider,
  busy,
  onSaveEdit,
  onAddCredential,
  onRemoveCredential,
  onDiscover,
  onAddModel,
  onRemoveModel,
  onMoveModel,
  onPinCredential,
}: {
  provider: ProviderSummary;
  busy: boolean;
  onSaveEdit: (providerId: string, draft: EditDraft) => void;
  onAddCredential: (providerId: string, apiKey: string, label?: string) => void;
  onRemoveCredential: (providerId: string, credentialRefId: string) => void;
  onDiscover: (providerId: string) => void;
  onAddModel: (
    providerId: string,
    protocol: ProtocolFamily,
    providerModelId: string,
    displayName?: string,
    contextWindow?: number,
  ) => void;
  onRemoveModel: (providerId: string, modelId: string) => void;
  onMoveModel: (provider: ProviderSummary, modelId: string, direction: -1 | 1) => void;
  onPinCredential: (
    provider: ProviderSummary,
    modelId: string,
    credentialRefId: string | null,
  ) => void;
}) {
  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState<EditDraft>(() => toEditDraft(provider));
  const [newKey, setNewKey] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    setEditing(true);
    setDraft(toEditDraft(provider));
    setNewKey('');
    setNewKeyLabel('');
    setManualId('');
    setManualName('');
  }, [provider.providerId, provider.updatedAt]);

  const models = useMemo(
    () => [...provider.models].sort((a, b) => a.priority - b.priority),
    [provider.models],
  );

  return (
    <div className="border-b border-border px-6 py-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-text">{provider.name}</h2>
            {!provider.enabled && (
              <span className="rounded bg-hover px-1.5 py-0.5 text-[10.5px] text-text-faint">
                已停用
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-faint">
            {provider.baseUrl}
          </p>
          <p className="mt-0.5 text-[11.5px] text-text-secondary">
            {protocolLabel(provider.protocol)}
            {provider.supportsDiscovery ? ' · 支持发现' : ' · 手动模型'}
            {provider.importedFrom ? ` · 来自 ${provider.importedFrom}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {provider.supportsDiscovery && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
              disabled={busy}
              onClick={() => onDiscover(provider.providerId)}
            >
              <RefreshCw size={13} /> 发现模型
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              setEditing((v) => !v);
              setDraft(toEditDraft(provider));
            }}
          >
            {editing ? '取消编辑' : '编辑'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-5 grid max-w-[520px] gap-3 rounded-xl border border-border bg-elevated p-4">
          <Field label="供应商名称">
            <input
              className="st-field-input"
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="API Base URL">
            <input
              className="st-field-input font-mono text-[12.5px]"
              value={draft.baseUrl}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </Field>
          <Field label="API 格式">
            <select
              className="st-field-input"
              value={draft.protocol}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, protocol: e.target.value as ProtocolFamily })}
            >
              {PROTOCOL_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="轮换 API Key（留空则不改）">
            <input
              className="st-field-input font-mono text-[12.5px]"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              placeholder="粘贴新密钥以轮换"
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
            <input
              type="checkbox"
              checked={draft.supportsDiscovery}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, supportsDiscovery: e.target.checked })}
            />
            支持模型发现
          </label>
          <button
            type="button"
            className="w-fit rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              onSaveEdit(provider.providerId, draft);
              setEditing(false);
            }}
          >
            保存更改
          </button>
        </div>
      )}

      {/* Credentials */}
      <SectionTitle icon={KeyRound} title="密钥" hint="明文仅在提交时传给 Runtime，列表永不回显">
        <div className="space-y-2">
          {provider.credentials.length === 0 ? (
            <p className="text-[12px] text-text-faint">尚未配置密钥</p>
          ) : (
            <ul className="space-y-1.5">
              {provider.credentials.map((c) => (
                <li
                  key={c.credentialRefId}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <KeyRound size={13} className="shrink-0 text-text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-text">
                      {maskKeyLabel(c.label || 'default', c.hasSecret)}
                    </p>
                    <p className="text-[11px] text-text-faint">
                      {c.groupName} · {c.kind}
                    </p>
                  </div>
                  {provider.credentials.length > 1 && (
                    <button
                      type="button"
                      className="rounded p-1 text-text-faint hover:bg-hover hover:text-error disabled:opacity-50"
                      title="删除密钥"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`确认删除密钥「${c.label}」？`)) {
                          onRemoveCredential(provider.providerId, c.credentialRefId);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="min-w-[140px] flex-1">
              <label className="mb-1 block text-[11px] text-text-faint">新密钥标签</label>
              <input
                className="st-field-input"
                value={newKeyLabel}
                placeholder="primary / relay-a"
                disabled={busy}
                onChange={(e) => setNewKeyLabel(e.target.value)}
              />
            </div>
            <div className="min-w-[200px] flex-[2]">
              <label className="mb-1 block text-[11px] text-text-faint">API Key</label>
              <input
                className="st-field-input font-mono text-[12.5px]"
                type="password"
                autoComplete="off"
                value={newKey}
                placeholder="sk-…"
                disabled={busy}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
              disabled={busy || !newKey.trim()}
              onClick={() => {
                onAddCredential(provider.providerId, newKey.trim(), newKeyLabel);
                setNewKey('');
                setNewKeyLabel('');
              }}
            >
              添加密钥
            </button>
          </div>
        </div>
      </SectionTitle>

      {/* Models */}
      <SectionTitle
        icon={Bot}
        title={`模型优先级（${models.length || '至少添加一个'}）`}
        hint="主模型失败后按顺序尝试备用模型；拖拽排序能力后续接入，当前可用箭头调整"
        className="mt-5"
      >
        <div className="space-y-1.5">
          {models.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-text-faint">
              暂无模型 · 点击「发现模型」或下方手动添加
            </p>
          ) : (
            models.map((m, index) => (
              <ModelRow
                key={m.modelId}
                model={m}
                index={index}
                total={models.length}
                credentials={provider.credentials}
                busy={busy}
                onMove={(dir) => onMoveModel(provider, m.modelId, dir)}
                onRemove={() => {
                  if (confirm(`确认移除模型「${m.displayName}」？`)) {
                    onRemoveModel(provider.providerId, m.modelId);
                  }
                }}
                onPin={(credId) => onPinCredential(provider, m.modelId, credId)}
              />
            ))
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border px-3 py-3">
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-[11px] text-text-faint">模型 ID</label>
            <input
              className="st-field-input font-mono text-[12.5px]"
              value={manualId}
              placeholder="gpt-4o / claude-sonnet-4"
              disabled={busy}
              onChange={(e) => setManualId(e.target.value)}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-[11px] text-text-faint">显示名（可选）</label>
            <input
              className="st-field-input"
              value={manualName}
              placeholder="与 ID 相同可留空"
              disabled={busy}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
            disabled={busy || !manualId.trim()}
            onClick={() => {
              onAddModel(
                provider.providerId,
                provider.protocol as ProtocolFamily,
                manualId.trim(),
                manualName.trim() || undefined,
              );
              setManualId('');
              setManualName('');
            }}
          >
            <Plus size={13} /> 手动添加
          </button>
        </div>
      </SectionTitle>
    </div>
  );
}

function toEditDraft(provider: ProviderSummary): EditDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol as ProtocolFamily,
    supportsDiscovery: provider.supportsDiscovery,
    apiKey: '',
  };
}

function ModelRow({
  model,
  index,
  total,
  credentials,
  busy,
  onMove,
  onRemove,
  onPin,
}: {
  model: ProviderModelSummary;
  index: number;
  total: number;
  credentials: ProviderSummary['credentials'];
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPin: (credentialRefId: string | null) => void;
}) {
  const ctx = formatContext(model.contextWindow);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-hover text-[10px] font-medium text-text-faint">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-text">
          {model.displayName}
          {index === 0 && (
            <span className="ml-1.5 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-normal text-accent-text">
              主模型
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[11px] text-text-faint">
          {model.providerModelId}
          {ctx ? ` · ${ctx}` : ''}
          {model.capabilities.length > 0 ? ` · ${model.capabilities.join(', ')}` : ''}
        </p>
      </div>
      {credentials.length > 1 && (
        <select
          className="max-w-[120px] rounded border border-border bg-elevated px-1.5 py-1 text-[11px] text-text-secondary"
          value={model.credentialRefId ?? ''}
          disabled={busy}
          title="绑定密钥"
          onChange={(e) => onPin(e.target.value || null)}
        >
          <option value="">默认密钥</option>
          {credentials.map((c) => (
            <option key={c.credentialRefId} value={c.credentialRefId}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="rounded p-1 text-text-faint hover:bg-hover hover:text-text disabled:opacity-30"
          title="提高优先级"
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-text-faint hover:bg-hover hover:text-text disabled:opacity-30"
          title="降低优先级"
          disabled={busy || index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-text-faint hover:bg-hover hover:text-error disabled:opacity-50"
          title="移除模型"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Global prefs ────────────────────────────────────────────────────────────

function GlobalModelPrefs({
  allModels,
  visionFallback,
  planAct,
  busy,
  onSaveVision,
  onSavePlanAct,
}: {
  allModels: Array<{
    modelId: string;
    displayName: string;
    providerName: string;
    enabled: boolean;
  }>;
  visionFallback: VisionFallbackSetting;
  planAct: PlanActSetting;
  busy: boolean;
  onSaveVision: (v: VisionFallbackSetting) => void;
  onSavePlanAct: (v: PlanActSetting) => void;
}) {
  const [vision, setVision] = useState(visionFallback);
  const [plan, setPlan] = useState(planAct);

  useEffect(() => setVision(visionFallback), [visionFallback]);
  useEffect(() => setPlan(planAct), [planAct]);

  const enabledModels = allModels.filter((m) => m.enabled);
  const modelOptions = enabledModels.length > 0 ? enabledModels : allModels;

  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex items-center gap-2">
        <Settings2 size={15} className="text-text-secondary" />
        <h3 className="text-[13px] font-semibold text-text">全局模型策略</h3>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text">Vision Fallback</p>
              <p className="text-[11.5px] text-text-faint">
                当前模型不支持识图时，自动改用此视觉模型
              </p>
            </div>
            <Toggle
              checked={vision.enabled}
              disabled={busy}
              onChange={(enabled) => setVision((v) => ({ ...v, enabled }))}
            />
          </div>
          <select
            className="st-field-input"
            value={vision.modelId ?? ''}
            disabled={busy || !vision.enabled}
            onChange={(e) => setVision((v) => ({ ...v, modelId: e.target.value || null }))}
          >
            <option value="">选择视觉模型…</option>
            {modelOptions.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName} · {m.providerName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => onSaveVision(vision)}
          >
            保存
          </button>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text">Plan & Act</p>
              <p className="text-[11.5px] text-text-faint">规划与执行拆分到不同模型（可选）</p>
            </div>
            <Toggle
              checked={plan.enabled}
              disabled={busy}
              onChange={(enabled) => setPlan((v) => ({ ...v, enabled }))}
            />
          </div>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-[11px] text-text-faint">Plan 模型</label>
              <select
                className="st-field-input"
                value={plan.planModelId ?? ''}
                disabled={busy || !plan.enabled}
                onChange={(e) => setPlan((v) => ({ ...v, planModelId: e.target.value || null }))}
              >
                <option value="">选择…</option>
                {modelOptions.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.displayName} · {m.providerName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-text-faint">Act 模型</label>
              <select
                className="st-field-input"
                value={plan.actModelId ?? ''}
                disabled={busy || !plan.enabled}
                onChange={(e) => setPlan((v) => ({ ...v, actModelId: e.target.value || null }))}
              >
                <option value="">选择…</option>
                {modelOptions.map((m) => (
                  <option key={`act-${m.modelId}`} value={m.modelId}>
                    {m.displayName} · {m.providerName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => onSavePlanAct(plan)}
          >
            保存
          </button>
        </div>
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
  const [showDetails, setShowDetails] = useState(false);
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
  const totalTokens = (data?.totalTokensIn ?? 0) + (data?.totalTokensOut ?? 0);
  const hasCacheUsage =
    typeof data?.totalCachedTokensHit === 'number' ||
    typeof data?.totalCachedTokensCreated === 'number';
  const totalCostLabel = formatCurrencyTotals(data?.totalCostByCurrency ?? {});
  const totalToolCalls = tools.reduce((sum, row) => sum + row.calls, 0);
  const totalToolSuccesses = tools.reduce((sum, row) => sum + row.successes, 0);
  const totalToolFailures = tools.reduce((sum, row) => sum + row.failures, 0);
  const totalToolSuccessRate =
    totalToolCalls > 0 ? (totalToolSuccesses / totalToolCalls) * 100 : 0;

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
          value={formatTokenCount(totalTokens)}
          hint={`输入 ${formatTokenCount(data?.totalTokensIn ?? 0)}  /  输出 ${formatTokenCount(data?.totalTokensOut ?? 0)}`}
        />
        <UsageMetric
          label="缓存 Token"
          value={
            hasCacheUsage
              ? formatTokenCount(
                  (data?.totalCachedTokensHit ?? 0) +
                    (data?.totalCachedTokensCreated ?? 0),
                )
              : '—'
          }
          hint={
            hasCacheUsage
              ? `命中 ${formatTokenCount(data?.totalCachedTokensHit ?? 0)}  /  创建 ${formatTokenCount(data?.totalCachedTokensCreated ?? 0)}`
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
            <label className="usage-detail-switch">
              <input
                type="checkbox"
                checked={showDetails}
                onChange={(event) => setShowDetails(event.target.checked)}
              />
              <span>详情记录</span>
            </label>
            <span className="usage-record-count">共 {visibleRequests.length} 条记录</span>
          </div>
          <UsageRequestTable rows={visibleRequests} showDetails={showDetails} />
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
          onDelete={(entry) => void savePricing(pricing.filter((row) => row.modelId !== entry.modelId))}
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

function UsageRequestTable({
  rows,
  showDetails,
}: {
  rows: UsageSummaryResponse['requests'];
  showDetails: boolean;
}) {
  if (rows.length === 0) {
    return <div className="usage-table-empty">暂无符合条件的请求记录</div>;
  }
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
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
          {rows.map((row) => (
            <tr key={row.requestId}>
              <td>{formatTimestamp(row.occurredAt)}</td>
              <td>{row.providerName ?? row.providerId ?? '—'}</td>
              <td title={row.modelId}>
                {row.displayName ?? row.modelId}
                {showDetails ? (
                  <small>
                    输入 {formatTokenCount(row.tokensIn)} · 输出{' '}
                    {formatTokenCount(row.tokensOut)}
                    {row.errorMessage ? ` · ${row.errorMessage}` : ''}
                  </small>
                ) : null}
              </td>
              <td>{formatTokenCount(row.tokensIn + row.tokensOut)}</td>
              <td>{formatCurrency(row.estimatedCost, row.currency)}</td>
              <td>{typeof row.latencyMs === 'number' ? formatLatency(row.latencyMs) : '—'}</td>
              <td>
                <span className={`usage-status is-${row.status}`}>
                  {row.status === 'success' ? '200' : row.status === 'failed' ? '失败' : '—'}
                </span>
              </td>
            </tr>
          ))}
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
                {typeof row.toolSuccessRate === 'number' ? `${row.toolSuccessRate.toFixed(1)}%` : '—'}
              </td>
              <td>{typeof row.averageLatencyMs === 'number' ? formatLatency(row.averageLatencyMs) : '—'}</td>
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
              <thead><tr><th>模型</th><th>调用数</th><th>成功</th><th>失败</th><th>成功率</th></tr></thead>
              <tbody>
                {modelRows.map((row) => (
                  <tr key={row.modelId}>
                    <td>{row.displayName ?? row.modelId}<small>{row.modelId}</small></td>
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
              <thead><tr><th>工具</th><th>调用数</th><th>成功</th><th>失败</th><th>成功率</th></tr></thead>
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
              <thead><tr><th>时间</th><th>工具</th><th>对话</th><th>模型</th><th>错误摘要</th></tr></thead>
              <tbody>
                {failures.map((row, index) => (
                  <tr key={`${row.occurredAt}:${row.toolName}:${index}`}>
                    <td>{formatTimestamp(row.occurredAt)}</td>
                    <td>{row.toolName}</td>
                    <td>{row.conversationTitle ?? '—'}</td>
                    <td>{row.displayName ?? row.modelId ?? '—'}</td>
                    <td className="usage-error" title={row.errorSummary}>{row.errorSummary}</td>
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
  const setNumber = (key: keyof Pick<PricingDraft, 'inputPerMillion' | 'outputPerMillion' | 'cacheReadPerMillion' | 'cacheWritePerMillion'>, value: string) => {
    if (!draft) return;
    onDraftChange({ ...draft, [key]: Math.max(0, Number(value) || 0) });
  };
  return (
    <section className="usage-pricing-panel">
      <div className="usage-pricing-toolbar">
        <span>共 {entries.length} 个模型定价</span>
        <button type="button" onClick={onAdd}><Plus size={13} /> 添加</button>
      </div>
      {draft ? (
        <div className="usage-pricing-form">
          <input value={draft.modelId} disabled={saving} placeholder="模型 ID" onChange={(event) => onDraftChange({ ...draft, modelId: event.target.value })} />
          <input value={draft.displayName} disabled={saving} placeholder="显示名" onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })} />
          <select value={draft.currency} disabled={saving} onChange={(event) => onDraftChange({ ...draft, currency: event.target.value as 'USD' | 'CNY' })}>
            <option value="USD">USD</option><option value="CNY">CNY</option>
          </select>
          <input type="number" min="0" step="0.01" value={draft.inputPerMillion} disabled={saving} aria-label="输入每百万 Token 单价" onChange={(event) => setNumber('inputPerMillion', event.target.value)} />
          <input type="number" min="0" step="0.01" value={draft.outputPerMillion} disabled={saving} aria-label="输出每百万 Token 单价" onChange={(event) => setNumber('outputPerMillion', event.target.value)} />
          <input type="number" min="0" step="0.01" value={draft.cacheReadPerMillion} disabled={saving} aria-label="缓存读每百万 Token 单价" onChange={(event) => setNumber('cacheReadPerMillion', event.target.value)} />
          <input type="number" min="0" step="0.01" value={draft.cacheWritePerMillion} disabled={saving} aria-label="缓存建每百万 Token 单价" onChange={(event) => setNumber('cacheWritePerMillion', event.target.value)} />
          <div className="usage-pricing-form-actions">
            <button type="button" onClick={onSave} disabled={saving}>{saving ? '保存中…' : editingId ? '保存' : '添加'}</button>
            <button type="button" className="is-secondary" onClick={onCancel} disabled={saving}>取消</button>
          </div>
        </div>
      ) : null}
      <div className="usage-table-wrap usage-pricing-table">
        <table className="usage-table">
          <thead><tr><th>模型 ID</th><th>显示名</th><th>币种</th><th>输入/M</th><th>输出/M</th><th>缓存读/M</th><th>缓存建/M</th><th>操作</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.modelId}>
                <td className="usage-model-id" title={entry.modelId}>{entry.modelId}</td>
                <td>{entry.displayName}</td>
                <td>{entry.currency}</td>
                <td>{formatCurrency(entry.inputPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.outputPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.cacheReadPerMillion, entry.currency)}</td>
                <td>{formatCurrency(entry.cacheWritePerMillion, entry.currency)}</td>
                <td><div className="usage-row-actions"><button type="button" title="编辑" onClick={() => onEdit(entry)}><Pencil size={12} /></button><button type="button" title="删除" onClick={() => onDelete(entry)}><Trash2 size={12} /></button></div></td>
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
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
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

function SectionTitle({
  icon: Icon,
  title,
  hint,
  className,
  children,
}: {
  icon: typeof Bot;
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={13} className="text-text-faint" />
        <p className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{title}</p>
      </div>
      {hint && <p className="mb-2 text-[11.5px] text-text-faint">{hint}</p>}
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
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  );
}

function formatCurrency(
  value: number | undefined,
  currency: 'USD' | 'CNY' | undefined,
): string {
  if (typeof value !== 'number' || !currency) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  const digits = value >= 1 ? 2 : value > 0 ? 4 : 2;
  return `${symbol}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: value === 0 ? 2 : 0,
    maximumFractionDigits: digits,
  })}`;
}

function formatCurrencyTotals(
  totals: Partial<Record<'USD' | 'CNY', number>>,
): string {
  const values = (['CNY', 'USD'] as const).flatMap((currency) =>
    typeof totals[currency] === 'number'
      ? [formatCurrency(totals[currency], currency)]
      : [],
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

