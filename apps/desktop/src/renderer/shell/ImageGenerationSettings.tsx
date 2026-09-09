/**
 * Settings > 模型 > 图像生成.
 *
 * Dual-pane NewMax flow for OpenAI Images-compatible providers. Chat default
 * stays on text providers; the first enabled image provider is what
 * `generate_image` calls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { DsTabBar } from './DsTabBar.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveProviderBrandLogo, resolveProviderBrandLogoByName } from './brand-icons.js';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings2,
  X,
  Zap,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { ProviderSummary } from '@sync-think/protocol';
import { retryTransientRuntime } from '../runtime-connection.js';
import {
  IMAGE_CATALOG_CATEGORIES,
  IMAGE_GENERATION_COPY,
  IMAGE_GENERATION_PROTOCOL,
  IMAGE_PROVIDER_CATALOG,
  composeImageProviderOrder,
  isLikelyImageGenerationModelId,
  isConfiguredImageProvider,
  type ImageCatalogCategory,
  type ImageCatalogItem,
} from './image-generation-providers.js';

function bridge() {
  return window.syncThink?.runtime;
}

const EMPTY_DRAFT = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  models: 'gpt-image-2',
};

type CreateDraft = typeof EMPTY_DRAFT;

type Toast = { id: number; kind: 'success' | 'error'; message: string };
type PendingImageImport = {
  providerId: string;
  protocol: typeof IMAGE_GENERATION_PROTOCOL;
  models: string[];
  selectedIds: string[];
};

export function ImageGenerationSettings({
  onCatalogChanged,
}: {
  onCatalogChanged?: () => void;
}) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<'catalog' | 'form'>('catalog');
  const [catalogCategory, setCatalogCategory] = useState<ImageCatalogCategory>('recommended');
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [createTemplate, setCreateTemplate] = useState<ImageCatalogItem | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [disabledMenuOpen, setDisabledMenuOpen] = useState(false);
  const [pendingImageImport, setPendingImageImport] = useState<PendingImageImport | null>(null);
  const disabledMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const showToast = useCallback((kind: Toast['kind'], message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.listProviders) {
      setError('Runtime 未连接，无法加载生图模型源');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const listed = await retryTransientRuntime(() => api.listProviders({}));
      const next = [...listed.providers]
        .filter(isConfiguredImageProvider)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const all = [...listed.providers];
      setProviders(all);
      setSelectedId((prev) => {
        if (prev && next.some((provider) => provider.providerId === prev)) return prev;
        return next[0]?.providerId ?? null;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载生图模型源失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const listed = useMemo(
    () =>
      providers
        .filter(isConfiguredImageProvider)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [providers],
  );
  const enabledProviders = listed.filter((provider) => provider.enabled);
  const disabledProviders = listed.filter((provider) => !provider.enabled);
  const selected = listed.find((provider) => provider.providerId === selectedId) ?? null;

  const withBusy = useCallback(
    async (fn: () => Promise<void>, successMessage?: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        if (successMessage) showToast('success', successMessage);
        return true;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : '操作失败';
        setError(message);
        showToast('error', message);
        return false;
      } finally {
        setBusy(false);
        onCatalogChanged?.();
      }
    },
    [onCatalogChanged, showToast],
  );

  const openCreateCatalog = () => {
    setShowCreate(true);
    setCreateStep('catalog');
    setCatalogCategory('recommended');
    setCreateDraft(EMPTY_DRAFT);
    setCreateTemplate(null);
    setSelectedId(null);
  };

  const openTemplate = (item: ImageCatalogItem) => {
    setCreateTemplate(item);
    setCreateDraft({
      name: item.draft.name,
      baseUrl: item.draft.baseUrl,
      apiKey: '',
      models: item.draft.models,
    });
    setCreateStep('form');
  };

  const handleCreate = (action: 'discover' | 'test' = 'discover') =>
    void withBusy(async () => {
      const api = bridge();
      if (!api?.createProvider || !api.addModels) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = createDraft.apiKey.trim();
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') throw new Error('请填写 Base URL');
      if (!apiKey) throw new Error('请填写 API 密钥');
      await navigator.clipboard.writeText(apiKey);
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol: IMAGE_GENERATION_PROTOCOL,
        supportsDiscovery: true,
        discoverOnCreate: false,
      });
      const finishProviderCreation = async () => {
        const all = providers.filter((provider) => provider.providerId !== result.provider.providerId);
        if (api.reorderProviders) {
          await api.reorderProviders({
            orderedProviderIds: composeImageProviderOrder({
              all: [...all, { ...result.provider, protocol: IMAGE_GENERATION_PROTOCOL }],
              nextEnabledImageIds: [
                result.provider.providerId,
                ...enabledProviders.map((provider) => provider.providerId),
              ],
            }) as never,
          });
        }
        setShowCreate(false);
        setCreateStep('catalog');
        setCreateDraft(EMPTY_DRAFT);
        setCreateTemplate(null);
        setSelectedId(result.provider.providerId);
        await load();
      };
      if (!api.discoverModels) {
        await finishProviderCreation();
        throw new Error('Runtime 不支持模型发现');
      }
      let discovered;
      try {
        discovered = await api.discoverModels({
          providerId: result.provider.providerId as never,
          persist: false,
        });
      } catch (error) {
        await finishProviderCreation();
        throw error;
      }
      const imageCandidates = discovered.models
        .filter((model) => model.capabilities.includes('image-generation'));
      const hintedIds = imageCandidates
        .filter((model) => isLikelyImageGenerationModelId(model.providerModelId))
        .map((model) => model.providerModelId);
      const selectableIds = hintedIds.length > 0
        ? hintedIds
        : imageCandidates.length === 1
          ? [imageCandidates[0]!.providerModelId]
          : [];
      if (selectableIds.length === 0) {
        await finishProviderCreation();
        throw new Error(IMAGE_GENERATION_COPY.emptyFetchedModels);
      }
      if (action === 'discover') {
        setPendingImageImport({
          providerId: result.provider.providerId,
          protocol: IMAGE_GENERATION_PROTOCOL,
          models: selectableIds,
          selectedIds: [],
        });
      } else {
        showToast('success', `连接成功 · 发现 ${selectableIds.length} 个生图模型`);
      }
      await finishProviderCreation();
    }, `${createDraft.name.trim()} 已创建，请选择生图模型`);

  const applyPendingImageImport = () =>
    void withBusy(async () => {
      const api = bridge();
      const pending = pendingImageImport;
      if (!pending || !api?.addModels) throw new Error('Runtime 未连接');
      if (pending.selectedIds.length === 0) throw new Error('请至少选择一个生图模型');
      const added = await api.addModels({
        providerId: pending.providerId as never,
        protocol: pending.protocol,
        models: pending.selectedIds.map((id) => ({
          providerModelId: id,
          displayName: id,
          capabilities: ['image-generation'],
        })),
      });
      if (api.confirmCapabilities) {
        for (const model of added.models) {
          await api.confirmCapabilities({
            modelId: model.modelId as never,
            capabilities: ['image-generation'],
            confirmed: true,
          });
        }
      }
      setPendingImageImport(null);
      await load();
    }, '生图模型已添加');

  const persistImageOrder = async (nextEnabled: ProviderSummary[]) => {
    const api = bridge();
    if (!api?.reorderProviders) throw new Error('Runtime 未连接');
    await api.reorderProviders({
      orderedProviderIds: composeImageProviderOrder({
        all: providers,
        nextEnabledImageIds: nextEnabled.map((provider) => provider.providerId),
      }) as never,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProviderId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId || busy) return;
    const previous = providers;
    const oldIndex = enabledProviders.findIndex((provider) => provider.providerId === activeId);
    const newIndex = enabledProviders.findIndex((provider) => provider.providerId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextEnabled = arrayMove(enabledProviders, oldIndex, newIndex);
    void withBusy(async () => {
      try {
        await persistImageOrder(nextEnabled);
        await load();
      } catch (caught) {
        setProviders(previous);
        throw caught;
      }
    }, '模型顺序已更新');
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

  const handleToggleEnabled = (provider: ProviderSummary, enabled: boolean) => {
    void withBusy(async () => {
      const api = bridge();
      if (!api?.updateProvider) throw new Error('Runtime 未连接');
      await api.updateProvider({ providerId: provider.providerId, enabled });
      await load();
    }, `${provider.name} 已${enabled ? '启用' : '停用'}`);
  };

  const handleRemoveProvider = (provider: ProviderSummary) => {
    void withBusy(async () => {
      await wipeProviderCredentials(provider);
      await load();
    });
  };

  useEffect(() => {
    if (!disabledMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (disabledMenuTriggerRef.current?.contains(target)) return;
      const root = disabledMenuTriggerRef.current?.closest('.model-disabled-list');
      if (root?.contains(target)) return;
      setDisabledMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [disabledMenuOpen]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-faint">
        <Loader2 size={16} className="animate-spin" /> 加载生图模型源…
      </div>
    );
  }

  return (
    <div className="model-settings-tab-panel model-settings-workspace flex min-h-0 flex-1">
      <aside className="model-enabled-list">
        <div className="model-enabled-list__header">
          <div>
            <p>{IMAGE_GENERATION_COPY.sidebarTitle}</p>
            <span>{IMAGE_GENERATION_COPY.sidebarHint}</span>
          </div>
          <button
            type="button"
            title={IMAGE_GENERATION_COPY.addImageProvider}
            aria-label={IMAGE_GENERATION_COPY.addImageProvider}
            disabled={busy}
            onClick={openCreateCatalog}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="model-enabled-list__body">
          {enabledProviders.length === 0 ? null : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(event: DragStartEvent) => setActiveProviderId(String(event.active.id))}
              onDragCancel={() => setActiveProviderId(null)}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={enabledProviders.map((provider) => provider.providerId)}
                strategy={verticalListSortingStrategy}
              >
                <ul>
                  {enabledProviders.map((provider, index) => (
                    <ImageProviderRow
                      key={provider.providerId}
                      provider={provider}
                      index={index}
                      active={!showCreate && provider.providerId === selectedId}
                      busy={busy}
                      onSelect={() => {
                        setShowCreate(false);
                        setSelectedId(provider.providerId);
                      }}
                      onDisable={() => handleToggleEnabled(provider, false)}
                      onRemove={() => handleRemoveProvider(provider)}
                    />
                  ))}
                </ul>
              </SortableContext>
              {activeProviderId
                ? createPortal(
                    <DragOverlay>
                      {enabledProviders.some((provider) => provider.providerId === activeProviderId) ? (
                        <div className="model-enabled-row is-dragging">
                          <span className="model-enabled-row__copy">
                            <span>
                              {
                                enabledProviders.find(
                                  (provider) => provider.providerId === activeProviderId,
                                )?.name
                              }
                            </span>
                          </span>
                        </div>
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
            disabled={busy}
            onClick={openCreateCatalog}
          >
            <Plus size={13} /> {IMAGE_GENERATION_COPY.addImageProvider}
          </button>
          {disabledProviders.length > 0 ? (
            <div className="model-disabled-list">
              <button
                ref={disabledMenuTriggerRef}
                type="button"
                className={clsx(
                  'model-disabled-list__trigger',
                  disabledMenuOpen && 'is-active',
                )}
                aria-expanded={disabledMenuOpen}
                data-testid="image-settings-disabled-menu-trigger"
                onClick={() => {
                  setDisabledMenuOpen((open) => !open);
                }}
              >
                <span>已停用模型</span>
                <span className="model-disabled-list__count">{disabledProviders.length}</span>
              </button>
              {disabledMenuOpen ? (
                <ul className="model-disabled-list__menu" data-testid="image-settings-disabled-menu-list">
                  {disabledProviders.map((provider) => (
                    <li key={provider.providerId}>
                      <button
                        type="button"
                        onClick={() => {
                          setDisabledMenuOpen(false);
                          setShowCreate(false);
                          setSelectedId(provider.providerId);
                        }}
                      >
                        {provider.name}
                      </button>
                      <button type="button" onClick={() => handleToggleEnabled(provider, true)}>
                        启用
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="model-settings-detail">
        <div
          key={showCreate ? `create-${createStep}` : (selected?.providerId ?? 'empty')}
          className="model-settings-detail__transition"
        >
          {error ? (
            <p className="text-[12.5px] text-error" role="alert">
              {error}
            </p>
          ) : null}
          {pendingImageImport ? (
            <ImageModelImport
              pending={pendingImageImport}
              busy={busy}
              onChange={setPendingImageImport}
              onApply={applyPendingImageImport}
            />
          ) : showCreate && createStep === 'catalog' ? (
            <ImageProviderCatalog
              category={catalogCategory}
              onCategoryChange={setCatalogCategory}
              onSelect={openTemplate}
            />
          ) : showCreate && createStep === 'form' ? (
            <ImageCreateForm
              draft={createDraft}
              template={createTemplate}
              busy={busy}
              onChange={setCreateDraft}
              onDiscover={() => handleCreate('discover')}
              onBack={() => setCreateStep('catalog')}
            />
          ) : selected ? (
            <ImageProviderDetail
              provider={selected}
              busy={busy}
              onDiscover={() =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.discoverModels) throw new Error('Runtime 不支持模型发现');
                  const discovered = await api.discoverModels({
                    providerId: selected.providerId as never,
                    persist: false,
                  });
                  const imageCandidates = discovered.models
                    .filter((model) => model.capabilities.includes('image-generation'));
                  const hintedIds = imageCandidates
                    .filter((model) => isLikelyImageGenerationModelId(model.providerModelId))
                    .map((model) => model.providerModelId);
                  const models = hintedIds.length > 0
                    ? hintedIds
                    : imageCandidates.length === 1
                      ? [imageCandidates[0]!.providerModelId]
                      : [];
                  if (models.length === 0) throw new Error(IMAGE_GENERATION_COPY.emptyFetchedModels);
                  setPendingImageImport({
                    providerId: selected.providerId,
                    protocol: IMAGE_GENERATION_PROTOCOL,
                    models,
                    selectedIds: selected.models
                      .filter((model) => models.includes(model.providerModelId))
                      .map((model) => model.providerModelId),
                  });
                }, '已拉取生图模型')
              }
              onTest={() =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.discoverModels) throw new Error('Runtime 不支持连接测试');
                  const discovered = await api.discoverModels({
                    providerId: selected.providerId as never,
                    persist: false,
                  });
                  const count = discovered.models.filter(
                    (model) =>
                      model.capabilities.includes('image-generation') &&
                      isLikelyImageGenerationModelId(model.providerModelId),
                  ).length;
                  if (count === 0) throw new Error('连接成功，但未发现可用的生图模型');
                }, '连接测试成功')
              }
              onRemoveModel={(modelId) =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.removeProviderModel) throw new Error('Runtime 未连接');
                  await api.removeProviderModel({
                    providerId: selected.providerId as never,
                    modelId: modelId as never,
                  });
                  await load();
                }, '模型已移除')
              }
            />
          ) : (
            <div className="model-settings-unavailable">
              <p>{IMAGE_GENERATION_COPY.description}</p>
              <span>{IMAGE_GENERATION_COPY.empty}</span>
            </div>
          )}
        </div>
      </div>

      {toast ? (
        <div
          className={clsx('model-settings-toast', toast.kind === 'error' && 'is-error')}
          role="status"
        >
          <span className="model-settings-toast__icon">
            {toast.kind === 'success' ? <Check size={14} /> : <X size={14} />}
          </span>
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function ImageProviderCatalog({
  category,
  onCategoryChange,
  onSelect,
}: {
  category: ImageCatalogCategory;
  onCategoryChange: (category: ImageCatalogCategory) => void;
  onSelect: (item: ImageCatalogItem) => void;
}) {
  const items = IMAGE_PROVIDER_CATALOG[category];
  return (
    <section className="model-provider-catalog" aria-label={IMAGE_GENERATION_COPY.addImageProvider}>
      <DsTabBar
        className="model-provider-catalog__tabs"
        aria-label="生图服务商分类"
        stretch
        value={category}
        onChange={onCategoryChange}
        items={IMAGE_CATALOG_CATEGORIES.map((item) => ({
          value: item.id,
          label: item.label,
        }))}
      />
      <div className="model-provider-catalog__grid" role="tabpanel">
        {items.map((item) => (
          <button
            key={`${category}-${item.id}`}
            type="button"
            className={clsx('model-provider-card', item.variant === 'flat' && 'is-flat')}
            onClick={() => onSelect(item)}
          >
            <ImageBrandIcon providerId={item.id} providerName={item.name} />
            <span className="model-provider-card__copy">
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ImageCreateForm({
  draft,
  template,
  busy,
  onChange,
  onDiscover,
  onBack,
}: {
  draft: CreateDraft;
  template: ImageCatalogItem | null;
  busy: boolean;
  onChange: (draft: CreateDraft) => void;
  onDiscover: () => void;
  onBack: () => void;
}) {
  const isCustom = template?.endpointMode === 'custom' || template?.id === 'custom';
  const title = template?.name ?? IMAGE_GENERATION_COPY.customTitle;
  return (
    <div className="model-provider-form-wrap">
      <button
        type="button"
        className="model-provider-form__back"
        aria-label={IMAGE_GENERATION_COPY.returnList}
        onClick={onBack}
        disabled={busy}
      >
        <ArrowLeft size={12} />
        {IMAGE_GENERATION_COPY.returnList}
      </button>
      <section className="model-provider-form" aria-labelledby="image-provider-form-title">
        <header className="model-provider-form__header">
          <div>
            <h2 id="image-provider-form-title">{title}</h2>
          </div>
        </header>
        <div className="model-provider-form__body">
          {isCustom ? (
            <p className="model-field-helper">{IMAGE_GENERATION_COPY.customDialogDescription}</p>
          ) : (
            <p className="model-field-helper">{IMAGE_GENERATION_COPY.customTemplateDescription}</p>
          )}
          <label className="model-field-label">供应商名称</label>
          <input
            className="st-field-input"
            value={draft.name}
            placeholder={IMAGE_GENERATION_COPY.namePlaceholder}
            disabled={busy}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <label className="model-field-label">生图 Base URL</label>
          <input
            className="st-field-input font-mono text-[12.5px]"
            data-testid="image-provider-base-url"
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            disabled={busy}
            onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
          />
          <label className="model-field-label">生图 API Key</label>
          <SecretInput
            value={draft.apiKey}
            placeholder={IMAGE_GENERATION_COPY.apiKeyPlaceholder}
            disabled={busy}
            onChange={(apiKey) => onChange({ ...draft, apiKey })}
          />
          <p className="model-field-helper">{IMAGE_GENERATION_COPY.missingKeyHelperText}</p>
          <div className="model-provider-form__actions">
            <button
              type="button"
              className="is-primary is-full"
              disabled={busy}
              onClick={onDiscover}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {busy ? '正在测试…' : IMAGE_GENERATION_COPY.testAndActivate}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ImageProviderDetail({
  provider,
  busy,
  onDiscover,
  onTest,
  onRemoveModel,
}: {
  provider: ProviderSummary;
  busy: boolean;
  onDiscover: () => void;
  onTest: () => void;
  onRemoveModel: (modelId: string) => void;
}) {
  const models = [...provider.models].sort((a, b) => a.priority - b.priority);
  const missingKey = provider.credentials.length === 0;
  return (
    <section className="model-provider-form" aria-labelledby="image-provider-detail-title">
      <header className="model-provider-form__header">
        <div>
          <h2 id="image-provider-detail-title">{provider.name}</h2>
          <small>
            {missingKey ? IMAGE_GENERATION_COPY.missingKey : provider.baseUrl}
          </small>
        </div>
      </header>
      <div className="model-provider-form__body">
        <p className="model-field-helper">{IMAGE_GENERATION_COPY.helperText}</p>
        <label className="model-field-label">生图模型</label>
        {models.length === 0 ? (
          <p className="model-credential-empty">暂无生图模型</p>
        ) : (
          <ul className="model-priority-list">
            {models.map((model, index) => (
              <li key={model.modelId} className="model-priority-row">
                <span>
                  {model.displayName}
                  {index === 0 ? <em>{IMAGE_GENERATION_COPY.defaultProvider}</em> : null}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveModel(model.modelId)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="model-provider-form__actions">
          <button type="button" className="is-primary" disabled={busy} onClick={onDiscover}>
            <Zap size={14} /> 从服务商拉取模型列表
          </button>
          <button type="button" className="model-provider-form__secondary-action" disabled={busy} onClick={onTest}>
            <Zap size={14} /> 测试连接
          </button>
        </div>
      </div>
    </section>
  );
}

function ImageModelImport({
  pending,
  busy,
  onChange,
  onApply,
}: {
  pending: PendingImageImport;
  busy: boolean;
  onChange: (next: PendingImageImport) => void;
  onApply: () => void;
}) {
  return (
    <section className="model-provider-form" aria-labelledby="image-model-import-title">
      <header className="model-provider-form__header">
        <div><h2 id="image-model-import-title">选择生图模型</h2></div>
      </header>
      <div className="model-provider-form__body">
        <p className="model-field-helper">已从服务商拉取 {pending.models.length} 个模型，请选择要添加的模型。</p>
        <div className="model-import-dialog__list">
          {pending.models.map((id) => {
            const checked = pending.selectedIds.includes(id);
            return (
              <label key={id} className={clsx('model-import-dialog__row', checked && 'is-checked')}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() =>
                    onChange({
                      ...pending,
                      selectedIds: checked
                        ? pending.selectedIds.filter((item) => item !== id)
                        : [...pending.selectedIds, id],
                    })
                  }
                />
                <span className="model-import-dialog__name">{id}</span>
              </label>
            );
          })}
        </div>
        <div className="model-provider-form__actions">
          <button type="button" className="is-primary is-full" disabled={busy} onClick={onApply}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {busy ? '添加中...' : `添加已选模型 (${pending.selectedIds.length})`}
          </button>
        </div>
      </div>
    </section>
  );
}

function ImageProviderRow({
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
  const [deleteConfirm, setDeleteConfirm] = useState(false);
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
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.providerId,
    disabled: busy,
  });
  const primary = [...provider.models].sort((a, b) => a.priority - b.priority)[0];
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
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
        <ImageRowAvatar provider={provider} />
        <span className="model-enabled-row__copy">
          <span>
            {provider.name}
            {index === 0 ? <em>{IMAGE_GENERATION_COPY.defaultProvider}</em> : null}
          </span>
          <small>
            {provider.credentials.length === 0
              ? IMAGE_GENERATION_COPY.missingKey
              : (primary?.displayName ?? '未添加模型')}
          </small>
        </span>
      </button>
      <div className="model-enabled-row__menu-wrap">
        <button
          type="button"
          className="model-enabled-row__menu-trigger"
          title="更多操作"
          aria-label={`${provider.name} 更多操作`}
          disabled={busy}
          onClick={() => {
            setMenuOpen((value) => !value);
            setDeleteConfirm(false);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen ? (
          <div className="model-enabled-row__menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDisable();
              }}
            >
              停用
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                if (deleteConfirm) {
                  setMenuOpen(false);
                  onRemove();
                  return;
                }
                setDeleteConfirm(true);
              }}
            >
              {deleteConfirm ? '确认' : '移除'}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ImageBrandIcon({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  if (providerId === 'custom') {
    return (
      <span className="model-provider-card__icon model-provider-brand-icon" aria-hidden="true">
        <Settings2 size={16} />
      </span>
    );
  }
  const brandLogo =
    resolveProviderBrandLogo(providerId) ?? resolveProviderBrandLogoByName(providerName);
  return (
    <span
      className={clsx(
        'model-provider-card__icon model-provider-brand-icon',
        brandLogo && 'model-provider-brand-icon--logo',
      )}
      aria-hidden="true"
    >
      {brandLogo ? (
        <BrandLogoMark logo={brandLogo} size={16} />
      ) : (
        providerName[0]?.toUpperCase() ?? '?'
      )}
    </span>
  );
}

function ImageRowAvatar({ provider }: { provider: ProviderSummary }) {
  const brandLogo =
    resolveProviderBrandLogo(provider.providerId) ??
    resolveProviderBrandLogoByName(provider.name);
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
