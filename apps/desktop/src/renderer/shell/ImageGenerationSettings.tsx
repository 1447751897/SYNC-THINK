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
  Cloud,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plug,
  Plus,
  Settings2,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { ProviderSummary } from '@sync-think/protocol';
import { retryTransientRuntime } from '../runtime-connection.js';
import {
  IMAGE_API_PROVIDERS,
  IMAGE_CATALOG_CATEGORIES,
  IMAGE_GENERATION_COPY,
  IMAGE_GENERATION_PROTOCOL,
  IMAGE_GENERATION_SETTING_KEY,
  IMAGE_PROVIDER_CATALOG,
  composeImageProviderOrder,
  imageModelRowLabel,
  inferImageApiProvider,
  isLikelyImageGenerationModelId,
  isConfiguredImageProvider,
  isImageApiProviderId,
  parseImageModelIds,
  readStoredImageApiProvider,
  withStoredImageApiProvider,
  type ImageApiProviderId,
  type ImageCatalogCategory,
  type ImageCatalogItem,
} from './image-generation-providers.js';

function bridge() {
  return window.syncThink?.runtime;
}

function imageModelIdsFromDiscovery(discovered: {
  models: Array<{ providerModelId: string; capabilities: readonly string[] }>;
}): string[] {
  const imageCandidates = discovered.models.filter((model) =>
    model.capabilities.includes('image-generation'),
  );
  const hintedIds = imageCandidates
    .filter((model) => isLikelyImageGenerationModelId(model.providerModelId))
    .map((model) => model.providerModelId);
  if (hintedIds.length > 0) return hintedIds;
  if (imageCandidates.length === 1) return [imageCandidates[0]!.providerModelId];
  return [];
}

const EMPTY_DRAFT = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  models: 'gpt-image-2',
  apiProvider: 'openai' as ImageApiProviderId,
};

type CreateDraft = typeof EMPTY_DRAFT;

type Toast = { id: number; kind: 'success' | 'error'; message: string };
type ImageDetailDraft = { baseUrl: string; apiKey: string };

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
  const [imageSetting, setImageSetting] = useState<unknown>({});
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
      if (api.getSettings) {
        try {
          const settings = await api.getSettings({ keys: [IMAGE_GENERATION_SETTING_KEY] });
          setImageSetting(settings.settings[IMAGE_GENERATION_SETTING_KEY] ?? {});
        } catch {
          /* keep previous image-generation setting if settings read fails */
        }
      }
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
      apiProvider: inferImageApiProvider(item.draft.baseUrl),
    });
    setCreateStep('form');
  };

  const handleCreate = () =>
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
        if (api.setSetting) {
          const nextSetting = withStoredImageApiProvider(
            imageSetting,
            result.provider.providerId,
            createDraft.apiProvider,
          );
          await api.setSetting({ key: IMAGE_GENERATION_SETTING_KEY, value: nextSetting });
          setImageSetting(nextSetting);
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
      const selectableIds = imageModelIdsFromDiscovery(discovered);
      const draftIds = parseImageModelIds(createDraft.models);
      const idsToAdd = draftIds.length > 0 ? draftIds : selectableIds;
      if (idsToAdd.length === 0) {
        await finishProviderCreation();
        throw new Error(IMAGE_GENERATION_COPY.emptyFetchedModels);
      }
      const added = await api.addModels({
        providerId: result.provider.providerId as never,
        protocol: IMAGE_GENERATION_PROTOCOL,
        models: idsToAdd.map((id) => ({
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
      await finishProviderCreation();
    }, `${createDraft.name.trim()} 已创建`);

  const persistProviderDraft = async (provider: ProviderSummary, draft: ImageDetailDraft) => {
    const api = bridge();
    if (!api) throw new Error('Runtime 未连接');
    const baseUrl = draft.baseUrl.trim();
    if (baseUrl && baseUrl !== provider.baseUrl) {
      if (!api.updateProvider) throw new Error('Runtime 未连接');
      await api.updateProvider({ providerId: provider.providerId, baseUrl });
    }
    const apiKey = draft.apiKey.trim();
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    const credential = provider.credentials[0];
    if (credential && api.updateProviderCredential) {
      await api.updateProviderCredential({
        providerId: provider.providerId,
        credentialRefId: credential.credentialRefId,
        rotateCredentialFromClipboard: true,
      });
    } else if (api.addProviderCredential) {
      await api.addProviderCredential({ providerId: provider.providerId });
    } else {
      throw new Error('Runtime 未连接');
    }
  };

  const persistApiProvider = async (providerId: string, apiProvider: ImageApiProviderId) => {
    const api = bridge();
    const next = withStoredImageApiProvider(imageSetting, providerId, apiProvider);
    setImageSetting(next);
    if (!api?.setSetting) return;
    await api.setSetting({ key: IMAGE_GENERATION_SETTING_KEY, value: next });
  };

  const addImageModelIds = async (providerId: string, ids: string[]) => {
    const api = bridge();
    if (!api?.addModels) throw new Error('Runtime 未连接');
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const added = await api.addModels({
      providerId: providerId as never,
      protocol: IMAGE_GENERATION_PROTOCOL,
      models: unique.map((id) => ({
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
  };

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
    <div className="model-settings-tab-panel model-settings-workspace model-settings-workspace--image flex min-h-0 flex-1">
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
          {showCreate && createStep === 'catalog' ? (
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
              onDiscover={handleCreate}
              onBack={() => setCreateStep('catalog')}
            />
          ) : selected ? (
            <ImageProviderDetail
              provider={selected}
              busy={busy}
              apiProvider={readStoredImageApiProvider(
                imageSetting,
                selected.providerId,
                selected.baseUrl,
              )}
              onApiProviderChange={(next) =>
                void withBusy(async () => {
                  await persistApiProvider(selected.providerId, next);
                })
              }
              onSaveBaseUrl={(baseUrl) => {
                void persistProviderDraft(selected, { baseUrl, apiKey: '' })
                  .then(() => load())
                  .catch((caught) => {
                    const message = caught instanceof Error ? caught.message : '操作失败';
                    setError(message);
                    showToast('error', message);
                  });
              }}
              onAddModel={(providerModelId) =>
                void withBusy(async () => {
                  await addImageModelIds(selected.providerId, [providerModelId]);
                  await load();
                }, '生图模型已添加')
              }
              onReorderModels={(orderedModelIds) =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.setModelPriorities) throw new Error('Runtime 未连接');
                  await api.setModelPriorities({
                    providerId: selected.providerId as never,
                    entries: orderedModelIds.map((modelId) => ({ modelId: modelId as never })),
                  });
                  await load();
                }, '模型顺序已更新')
              }
              onDiscover={(draft) =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.discoverModels) throw new Error('Runtime 不支持模型发现');
                  await persistProviderDraft(selected, draft);
                  const discovered = await api.discoverModels({
                    providerId: selected.providerId as never,
                    persist: false,
                  });
                  const models = imageModelIdsFromDiscovery(discovered);
                  if (models.length === 0) throw new Error(IMAGE_GENERATION_COPY.emptyFetchedModels);
                  const existing = new Set(selected.models.map((model) => model.providerModelId));
                  const toAdd = models.filter((id) => !existing.has(id));
                  if (toAdd.length > 0) await addImageModelIds(selected.providerId, toAdd);
                  await load();
                }, '已拉取生图模型')
              }
              onTest={(draft) =>
                void withBusy(async () => {
                  const api = bridge();
                  if (!api?.discoverModels) throw new Error('Runtime 不支持连接测试');
                  await persistProviderDraft(selected, draft);
                  const discovered = await api.discoverModels({
                    providerId: selected.providerId as never,
                    persist: false,
                  });
                  const count = imageModelIdsFromDiscovery(discovered).length;
                  if (count === 0) throw new Error('连接成功，但未发现可用的生图模型');
                  await load();
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
          <label className="model-field-label" htmlFor="image-create-name">
            {isCustom ? IMAGE_GENERATION_COPY.customProviderName : '供应商名称'}
          </label>
          <input
            id="image-create-name"
            className="st-field-input"
            value={draft.name}
            placeholder={IMAGE_GENERATION_COPY.namePlaceholder}
            disabled={busy}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <ImageApiProviderSelect
            id="image-create-api-provider"
            value={draft.apiProvider}
            disabled={busy}
            onChange={(apiProvider) => onChange({ ...draft, apiProvider })}
          />
          <label className="model-field-label" htmlFor="image-create-base-url">
            {IMAGE_GENERATION_COPY.baseUrl}
          </label>
          <input
            id="image-create-base-url"
            className="st-field-input font-mono text-[12.5px]"
            data-testid="image-provider-base-url"
            aria-label={IMAGE_GENERATION_COPY.baseUrl}
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            disabled={busy}
            onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
          />
          <label className="model-field-label" htmlFor="image-create-api-key">
            {IMAGE_GENERATION_COPY.apiKey}
          </label>
          <SecretInput
            id="image-create-api-key"
            value={draft.apiKey}
            placeholder={IMAGE_GENERATION_COPY.apiKeyPlaceholder}
            disabled={busy}
            onChange={(apiKey) => onChange({ ...draft, apiKey })}
          />
          <p className="model-field-helper">{IMAGE_GENERATION_COPY.missingKeyHelperText}</p>
          <label className="model-field-label" htmlFor="image-create-models">
            {IMAGE_GENERATION_COPY.modelId}
          </label>
          <input
            id="image-create-models"
            className="st-field-input font-mono text-[12.5px]"
            aria-label={IMAGE_GENERATION_COPY.modelId}
            value={draft.models}
            placeholder={IMAGE_GENERATION_COPY.modelPlaceholder}
            disabled={busy}
            onChange={(event) => onChange({ ...draft, models: event.target.value })}
          />
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
  apiProvider,
  onApiProviderChange,
  onSaveBaseUrl,
  onAddModel,
  onReorderModels,
  onDiscover,
  onTest,
  onRemoveModel,
}: {
  provider: ProviderSummary;
  busy: boolean;
  apiProvider: ImageApiProviderId;
  onApiProviderChange: (value: ImageApiProviderId) => void;
  onSaveBaseUrl: (baseUrl: string) => void;
  onAddModel: (providerModelId: string) => void;
  onReorderModels: (orderedModelIds: string[]) => void;
  onDiscover: (draft: ImageDetailDraft) => void;
  onTest: (draft: ImageDetailDraft) => void;
  onRemoveModel: (modelId: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [draftModelId, setDraftModelId] = useState('');
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const models = [...provider.models].sort((a, b) => a.priority - b.priority);
  const hasSecret = provider.credentials.some((credential) => credential.hasSecret);
  const missingKey = provider.credentials.length === 0 && !apiKey.trim();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setBaseUrl(provider.baseUrl);
    setApiKey('');
    setAddingModel(false);
    setDraftModelId('');
  }, [provider.providerId, provider.baseUrl]);

  const draft = { baseUrl, apiKey };
  const keyTag = missingKey
    ? IMAGE_GENERATION_COPY.missingKey
    : hasSecret || apiKey.trim()
      ? IMAGE_GENERATION_COPY.dedicatedKey
      : IMAGE_GENERATION_COPY.inheritedKey;
  const keyHelper = missingKey
    ? IMAGE_GENERATION_COPY.noKeyHint
    : hasSecret || apiKey.trim()
      ? IMAGE_GENERATION_COPY.usingDedicatedKey
      : IMAGE_GENERATION_COPY.usingInheritedKey;

  const commitDraftModel = () => {
    const id = draftModelId.trim();
    setAddingModel(false);
    setDraftModelId('');
    if (!id) return;
    if (models.some((model) => model.providerModelId === id)) return;
    onAddModel(id);
  };

  return (
    <section className="model-provider-form image-provider-detail" aria-labelledby="image-provider-detail-title">
      <header className="model-provider-form__header image-provider-detail__header">
        <div className="model-provider-form__identity">
          <ImageRowAvatar provider={provider} />
          <div>
            <h2 id="image-provider-detail-title">{provider.name}</h2>
          </div>
          <span className="image-provider-tag">{keyTag}</span>
        </div>
      </header>
      <div className="model-provider-form__body">
        <p className="model-field-helper">{IMAGE_GENERATION_COPY.providerCardDesc}</p>
        <ImageApiProviderSelect
          id={`image-api-provider-${provider.providerId}`}
          value={apiProvider}
          disabled={busy}
          onChange={onApiProviderChange}
        />
        <label className="model-field-label" htmlFor={`image-base-url-${provider.providerId}`}>
          {IMAGE_GENERATION_COPY.baseUrl}
        </label>
        <input
          id={`image-base-url-${provider.providerId}`}
          className="st-field-input font-mono text-[12.5px]"
          aria-label={IMAGE_GENERATION_COPY.baseUrl}
          value={baseUrl}
          placeholder="https://api.example.com/v1"
          disabled={busy}
          onChange={(event) => setBaseUrl(event.target.value)}
          onBlur={() => {
            if (baseUrl.trim() !== provider.baseUrl) onSaveBaseUrl(baseUrl);
          }}
        />
        <label className="model-field-label" htmlFor={`image-api-key-${provider.providerId}`}>
          {IMAGE_GENERATION_COPY.apiKey}
        </label>
        <SecretInput
          id={`image-api-key-${provider.providerId}`}
          value={apiKey}
          placeholder={
            hasSecret
              ? IMAGE_GENERATION_COPY.apiKeyInheritPlaceholder
              : IMAGE_GENERATION_COPY.apiKeyPlaceholder
          }
          disabled={busy}
          onChange={setApiKey}
        />
        <p className="model-field-helper">{keyHelper}</p>
        <fieldset className="image-model-id-fieldset">
          <legend className="model-field-label">{IMAGE_GENERATION_COPY.modelId}</legend>
          <div className="image-model-id-list">
            {models.length === 0 && !addingModel ? (
              <p className="model-credential-empty">暂无生图模型</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(event: DragStartEvent) => setActiveModelId(String(event.active.id))}
                onDragCancel={() => setActiveModelId(null)}
                onDragEnd={(event: DragEndEvent) => {
                  setActiveModelId(null);
                  const activeId = String(event.active.id);
                  const overId = event.over ? String(event.over.id) : null;
                  if (!overId || activeId === overId || busy) return;
                  const oldIndex = models.findIndex((model) => model.modelId === activeId);
                  const newIndex = models.findIndex((model) => model.modelId === overId);
                  if (oldIndex < 0 || newIndex < 0) return;
                  onReorderModels(arrayMove(models, oldIndex, newIndex).map((model) => model.modelId));
                }}
              >
                <SortableContext
                  items={models.map((model) => model.modelId)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul>
                    {models.map((model, index) => (
                      <ImageModelIdRow
                        key={model.modelId}
                        model={model}
                        index={index}
                        busy={busy}
                        onRemove={() => onRemoveModel(model.modelId)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {activeModelId
                  ? createPortal(
                      <DragOverlay>
                        <div className="image-model-id-row is-dragging">
                          <span>
                            {models.find((model) => model.modelId === activeModelId)?.displayName}
                          </span>
                        </div>
                      </DragOverlay>,
                      document.body,
                    )
                  : null}
              </DndContext>
            )}
            {addingModel ? (
              <input
                className="st-field-input font-mono text-[12.5px]"
                aria-label="新的生图模型 ID"
                autoFocus
                value={draftModelId}
                placeholder={IMAGE_GENERATION_COPY.modelPlaceholder}
                disabled={busy}
                onChange={(event) => setDraftModelId(event.target.value)}
                onBlur={commitDraftModel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setAddingModel(false);
                    setDraftModelId('');
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="image-model-id-list__add"
                disabled={busy}
                onClick={() => setAddingModel(true)}
              >
                <Plus size={13} /> {IMAGE_GENERATION_COPY.addModel}
              </button>
            )}
          </div>
        </fieldset>
        <p className="model-field-helper">{IMAGE_GENERATION_COPY.helperText}</p>
        <button
          type="button"
          className="model-fetch-models-link"
          disabled={busy}
          onClick={() => onDiscover(draft)}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}
          {IMAGE_GENERATION_COPY.fetchModelList}
        </button>
        <div className="model-test-connection">
          <button
            type="button"
            className="model-test-connection__btn"
            disabled={busy}
            onClick={() => onTest(draft)}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
            {IMAGE_GENERATION_COPY.testConnection}
          </button>
        </div>
      </div>
    </section>
  );
}

function ImageModelIdRow({
  model,
  index,
  busy,
  onRemove,
}: {
  model: ProviderSummary['models'][number];
  index: number;
  busy: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.modelId,
    disabled: busy,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('image-model-id-row', index === 0 && 'is-default', isDragging && 'is-dragging')}
    >
      <button
        type="button"
        className="model-enabled-row__grip"
        title="拖拽排序"
        aria-label={`拖拽 ${model.displayName} 调整顺序`}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className={clsx('image-model-id-row__badge', index === 0 && 'is-default')}>
        {imageModelRowLabel(index)}
      </span>
      <span className="image-model-id-row__id">{model.displayName}</span>
      <button
        type="button"
        className="image-model-id-row__remove"
        aria-label={`删除 ${model.displayName}`}
        disabled={busy}
        onClick={onRemove}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function ImageApiProviderSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: ImageApiProviderId;
  disabled?: boolean;
  onChange: (value: ImageApiProviderId) => void;
}) {
  return (
    <>
      <label className="model-field-label" htmlFor={id}>
        {IMAGE_GENERATION_COPY.apiProvider}
      </label>
      <select
        id={id}
        className="st-field-input image-api-provider-select"
        aria-label={IMAGE_GENERATION_COPY.apiProvider}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (isImageApiProviderId(event.target.value)) onChange(event.target.value);
        }}
      >
        {IMAGE_API_PROVIDERS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </>
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
  id,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="model-secret-input">
      <input
        id={id}
        className="st-field-input font-mono text-[12.5px]"
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        aria-label={IMAGE_GENERATION_COPY.apiKey}
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
