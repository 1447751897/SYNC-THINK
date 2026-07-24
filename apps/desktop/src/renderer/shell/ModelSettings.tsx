// NewMax-style model source settings: dual-pane provider manager + global model prefs.
// Left: ordered provider list with enable toggles.
// Right: selected provider detail (endpoint / keys / models / priority) + global vision/plan-act.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  ProviderModelSummary,
  ProviderSummary,
  UsageSummaryResponse,
} from '@sync-think/protocol';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProtocolFamily =
  | 'openai-chat'
  | 'openai-responses'
  | 'openai-images'
  | 'anthropic-messages';

interface VisionFallbackSetting {
  enabled: boolean;
  modelId: string | null;
}

interface PlanActSetting {
  enabled: boolean;
  planModelId: string | null;
  actModelId: string | null;
}

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
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k 上下文`;
  return `${tokens} 上下文`;
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
  if (!raw || typeof raw !== 'object') return { enabled: false, planModelId: null, actModelId: null };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    planModelId: typeof o.planModelId === 'string' && o.planModelId ? o.planModelId : null,
    actModelId: typeof o.actModelId === 'string' && o.actModelId ? o.actModelId : null,
  };
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function ModelSettings() {
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

  const withBusy = useCallback(async (label: string, fn: () => Promise<void>) => {
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
    }
  }, []);

  const handleCreate = () =>
    void withBusy('正在创建供应商…', async () => {
      const api = bridge();
      if (!api?.createProvider) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = createDraft.apiKey.trim();
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') throw new Error('请填写 Base URL');
      if (!apiKey) throw new Error('请填写 API Key');
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol: createDraft.protocol,
        supportsDiscovery: createDraft.supportsDiscovery,
        apiKey,
      });
      setStatus(
        `已创建 ${result.provider.name} · 发现 ${result.discoveredModelCount} 个模型`,
      );
      setCreateDraft(EMPTY_CREATE);
      setShowCreate(false);
      setSelectedId(result.provider.providerId);
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

  const handleMove = (providerId: string, direction: -1 | 1) =>
    void withBusy('正在调整顺序…', async () => {
      const api = bridge();
      if (!api?.reorderProviders) throw new Error('Runtime 未连接');
      const ids = providers.map((p) => String(p.providerId));
      const idx = ids.indexOf(providerId);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      await api.reorderProviders({ orderedProviderIds: next });
      setStatus('供应商顺序已更新');
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
        apiKey?: string;
      } = {
        providerId,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        protocol: draft.protocol,
        supportsDiscovery: draft.supportsDiscovery,
      };
      if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();
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
      await api.addProviderCredential({
        providerId: providerId as never,
        apiKey,
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
          credentialRefId: (
            m.modelId === modelId ? credentialRefId : (m.credentialRefId ?? undefined)
          ) as never,
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-faint">
        <Loader2 size={16} className="animate-spin" /> 加载模型源…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
        {/* Left: provider list */}
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div>
              <p className="text-[12px] font-medium text-text">模型源</p>
              <p className="text-[11px] text-text-faint">
                {providers.length} 个供应商 · {allModels.length} 个模型
              </p>
            </div>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-accent-text hover:bg-accent-soft disabled:opacity-50"
              title="添加供应商"
              disabled={busy}
              onClick={() => {
                setShowCreate(true);
                setSelectedId(null);
              }}
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {providers.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-text-faint">
                尚未配置供应商
                <br />
                点击右上角 + 添加
              </p>
            ) : (
              <ul className="space-y-1">
                {providers.map((p, index) => {
                  const active = p.providerId === selectedId && !showCreate;
                  return (
                    <li key={p.providerId}>
                      <div
                        className={clsx(
                          'group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors',
                          active ? 'bg-accent-soft' : 'hover:bg-hover',
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setShowCreate(false);
                            setSelectedId(p.providerId);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={clsx(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold',
                                p.enabled
                                  ? 'bg-accent-soft text-accent-text'
                                  : 'bg-hover text-text-faint',
                              )}
                            >
                              {p.name[0]?.toUpperCase() ?? '?'}
                            </span>
                            <div className="min-w-0">
                              <p
                                className={clsx(
                                  'truncate text-[12.5px] font-medium',
                                  active ? 'text-accent-text' : 'text-text',
                                  !p.enabled && 'opacity-60',
                                )}
                              >
                                {p.name}
                              </p>
                              <p className="truncate text-[11px] text-text-faint">
                                {p.models.length} 模型 · {protocolLabel(p.protocol)}
                                {!p.enabled ? ' · 已停用' : ''}
                              </p>
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="rounded p-0.5 text-text-faint hover:bg-active hover:text-text disabled:opacity-30"
                            title="上移"
                            disabled={busy || index === 0}
                            onClick={() => handleMove(p.providerId, -1)}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 text-text-faint hover:bg-active hover:text-text disabled:opacity-30"
                            title="下移"
                            disabled={busy || index === providers.length - 1}
                            onClick={() => handleMove(p.providerId, 1)}
                          >
                            <ArrowDown size={11} />
                          </button>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={p.enabled}
                          title={p.enabled ? '停用' : '启用'}
                          disabled={busy}
                          onClick={() => handleToggleEnabled(p, !p.enabled)}
                          className={clsx(
                            'relative ml-0.5 h-4 w-7 shrink-0 rounded-full transition-colors',
                            p.enabled ? 'bg-accent' : 'bg-border-strong',
                          )}
                        >
                          <span
                            className={clsx(
                              'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
                              p.enabled ? 'left-3.5' : 'left-0.5',
                            )}
                          />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right: detail / create / global */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
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
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

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
            onChange={(e) =>
              onChange({ ...draft, protocol: e.target.value as ProtocolFamily })
            }
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => toEditDraft(provider));
  const [newKey, setNewKey] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    setEditing(false);
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
          <Field label="名称">
            <input
              className="st-field-input"
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Base URL">
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
              onChange={(e) =>
                setDraft({ ...draft, protocol: e.target.value as ProtocolFamily })
              }
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
        title={`模型（${models.length}）`}
        hint="列表顺序即优先级；第 1 个为该供应商主模型"
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
          {model.capabilities.length > 0
            ? ` · ${model.capabilities.join(', ')}`
            : ''}
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
            onChange={(e) =>
              setVision((v) => ({ ...v, modelId: e.target.value || null }))
            }
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
              <p className="text-[11.5px] text-text-faint">
                规划与执行拆分到不同模型（可选）
              </p>
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
                onChange={(e) =>
                  setPlan((v) => ({ ...v, planModelId: e.target.value || null }))
                }
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
                onChange={(e) =>
                  setPlan((v) => ({ ...v, actModelId: e.target.value || null }))
                }
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
  const [sinceDays, setSinceDays] = useState<number | undefined>(30);

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
      const res = await api.getUsageSummary(
        sinceDays ? { sinceDays } : {},
      );
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-8 py-10 text-[13px] text-text-faint">
        <Loader2 size={15} className="animate-spin" /> 加载使用统计…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <p className="text-[13px] text-error">{error}</p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[12px] hover:bg-hover"
          onClick={() => void load()}
        >
          重试
        </button>
      </div>
    );
  }

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-[780px] px-8 py-8">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-text">使用统计</h1>
          <p className="mt-1 text-[12.5px] text-text-secondary">
            按模型汇总请求次数与 token 用量
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="st-field-input w-auto min-w-[120px]"
            value={sinceDays ?? 'all'}
            onChange={(e) => {
              const v = e.target.value;
              setSinceDays(v === 'all' ? undefined : Number(v));
            }}
          >
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
            <option value="all">全部时间</option>
          </select>
          <button
            type="button"
            className="rounded-lg border border-border p-2 text-text-secondary hover:bg-hover"
            title="刷新"
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <MetricCard label="请求次数" value={String(data?.totalRequests ?? 0)} />
        <MetricCard
          label="输入 Tokens"
          value={formatTokenCount(data?.totalTokensIn ?? 0)}
        />
        <MetricCard
          label="输出 Tokens"
          value={formatTokenCount(data?.totalTokensOut ?? 0)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-[13px] text-text-faint">
          暂无用量数据
          <br />
          <span className="text-[12px]">发起对话后会在此汇总</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-text-faint">
              <tr>
                <th className="px-3 py-2.5 font-medium">模型</th>
                <th className="px-3 py-2.5 font-medium">供应商</th>
                <th className="px-3 py-2.5 font-medium text-right">请求</th>
                <th className="px-3 py-2.5 font-medium text-right">输入</th>
                <th className="px-3 py-2.5 font-medium text-right">输出</th>
                <th className="px-3 py-2.5 font-medium text-right">最近使用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.modelId} className="border-t border-border hover:bg-hover/50">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-text">
                      {row.displayName ?? row.modelId}
                    </p>
                    <p className="font-mono text-[11px] text-text-faint">{row.modelId}</p>
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary">
                    {row.providerName ?? row.providerId ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text">
                    {row.requests}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {formatTokenCount(row.tokensIn)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {formatTokenCount(row.tokensOut)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[11.5px] text-text-faint">
                    {row.lastUsedAt ? formatRelative(row.lastUsedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
        <p className="text-[12px] font-medium uppercase tracking-wide text-text-faint">
          {title}
        </p>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] text-text-faint">{label}</p>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-text">{value}</p>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return iso.slice(0, 10);
}

