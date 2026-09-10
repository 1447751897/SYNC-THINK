/**
 * Settings > 模型 > 图像生成.
 *
 * Dual-pane NewMax flow for OpenAI Images-compatible providers. Chat default
 * stays on text providers; the first enabled image provider is what
 * `generate_image` calls.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { toastApi } from './Toast.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveProviderBrandLogo, resolveProviderBrandLogoByName } from './brand-icons.js';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plug,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { ProviderSummary } from '@sync-think/protocol';
import { retryTransientRuntime } from '../runtime-connection.js';
import { formatRuntimeIpcError } from '../provider-error-copy.js';
import {
  AddModelInlineRow,
  ImportModelsDialog,
  type ImportDialogState,
} from './model-settings-widgets.js';
import {
  IMAGE_API_PROVIDERS,
  IMAGE_CATALOG_CATEGORIES,
  IMAGE_GENERATION_COPY,
  IMAGE_GENERATION_PROTOCOL,
  IMAGE_GENERATION_SETTING_KEY,
  IMAGE_PROVIDER_CATALOG,
  composeImageProviderOrder,
  imageDraftModelsFromIds,
  imageModelIdsFromProbe,
  imageModelRowLabel,
  inferImageApiProvider,
  isLikelyImageGenerationModelId,
  isConfiguredImageProvider,
  parseImageModelIds,
  readStoredImageApiProvider,
  type ImageDraftModel,
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

const EMPTY_DRAFT: CreateDraft = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  models: [],
  apiProvider: 'openai',
};

type CreateDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ImageDraftModel[];
  apiProvider: ImageApiProviderId;
};

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
  const [busyKind, setBusyKind] = useState<'discover' | 'create'>('create');
  const hydratedRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<'catalog' | 'form'>('catalog');
  const [catalogCategory, setCatalogCategory] = useState<ImageCatalogCategory>('recommended');
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [createTemplate, setCreateTemplate] = useState<ImageCatalogItem | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [disabledMenuOpen, setDisabledMenuOpen] = useState(false);
  const [imageSetting, setImageSetting] = useState<unknown>({});
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null);
  const disabledMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const showToast = useCallback((kind: Toast['kind'], message: string) => {
    toastApi.toast({
      id: `image-settings-${kind}-${message}`,
      type: kind,
      title: message,
      duration: kind === 'error' ? 5000 : 2800,
    });
  }, []);

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.listProviders) {
      showToast('error', 'Runtime 未连接，无法加载生图模型源');
      setLoading(false);
      return;
    }
    if (!hydratedRef.current) setLoading(true);
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
      hydratedRef.current = true;
      setSelectedId((prev) => {
        if (prev && next.some((provider) => provider.providerId === prev)) return prev;
        return next[0]?.providerId ?? null;
      });
    } catch (caught) {
      showToast('error', formatRuntimeIpcError(caught, '加载生图模型源失败'));
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
    async (
      fn: () => Promise<void>,
      successMessage?: string,
      kind: 'discover' | 'create' = 'create',
    ) => {
      setBusy(true);
      setBusyKind(kind);
      try {
        await fn();
        if (successMessage) showToast('success', successMessage);
        return true;
      } catch (caught) {
        showToast('error', formatRuntimeIpcError(caught, '操作失败'));
        return false;
      } finally {
        setBusy(false);
        setBusyKind('create');
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
      models: imageDraftModelsFromIds(parseImageModelIds(item.draft.models)),
      apiProvider: inferImageApiProvider(item.draft.baseUrl),
    });
    setCreateStep('form');
  };

  const handleApplyCreateImport = (dialog: ImportDialogState) => {
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
  };

  const handleDiscoverCreateModels = () =>
    void withBusy(
      async () => {
        const api = bridge();
        if (!api?.probeModels) throw new Error('Runtime 未连接');
        const baseUrl = createDraft.baseUrl.trim();
        const apiKey = createDraft.apiKey.trim();
        if (!baseUrl || baseUrl === 'https://') throw new Error('请填写 Base URL');
        if (!apiKey) throw new Error('请填写 API 密钥');
        await navigator.clipboard.writeText(apiKey);
        const probe = await api.probeModels({
          baseUrl,
          protocol: IMAGE_GENERATION_PROTOCOL,
        });
        const discoveredIds = imageModelIdsFromProbe(probe.discoveredIds ?? []);
        if (discoveredIds.length === 0) {
          throw new Error(IMAGE_GENERATION_COPY.emptyFetchedModels);
        }
        setImportDialog({
          target: 'create',
          protocol: IMAGE_GENERATION_PROTOCOL,
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
      },
      undefined,
      'discover',
    );

  const handleCreate = () =>
    void withBusy(async () => {
      const api = bridge();
      if (!api?.createProvider || !api.addModels) throw new Error('Runtime 未连接');
      const name = createDraft.name.trim();
      const baseUrl = createDraft.baseUrl.trim();
      const apiKey = createDraft.apiKey.trim();
      const idsToAdd = createDraft.models.map((model) => model.providerModelId.trim()).filter(Boolean);
      if (!name) throw new Error('请填写供应商名称');
      if (!baseUrl || baseUrl === 'https://') throw new Error('请填写 Base URL');
      if (!apiKey) throw new Error('请填写 API 密钥');
      if (idsToAdd.length === 0) throw new Error('请至少添加一个模型');
      await navigator.clipboard.writeText(apiKey);
      if (api.probeModels) {
        await api.probeModels({
          baseUrl,
          protocol: IMAGE_GENERATION_PROTOCOL,
        });
      }
      const result = await api.createProvider({
        name,
        baseUrl,
        protocol: IMAGE_GENERATION_PROTOCOL,
        supportsDiscovery: true,
        discoverOnCreate: false,
      });
      const added = await api.addModels({
        providerId: result.provider.providerId as never,
        protocol: IMAGE_GENERATION_PROTOCOL,
        models: idsToAdd.map((id) => ({
          providerModelId: id,
          displayName: createDraft.models.find((model) => model.providerModelId === id)
            ?.displayName || id,
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

  const revealImageCredential = useCallback(
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
        return result.apiKey;
      } catch (caught) {
        showToast('error', formatRuntimeIpcError(caught, '读取密钥失败'));
        return null;
      }
    },
    [showToast],
  );

  const revealSelectedCredential = useCallback(
    (credentialRefId: string) => {
      if (!selectedId) return Promise.resolve(null);
      return revealImageCredential(selectedId, credentialRefId);
    },
    [revealImageCredential, selectedId],
  );

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

  const applyImageImport = async (dialog: ImportDialogState) => {
    const api = bridge();
    if (!api?.listProviders || !api.removeProviderModel || !api.setModelPriorities) {
      throw new Error('Runtime 未连接');
    }
    const providerId = dialog.providerId;
    if (!providerId) return;
    const provider = providers.find((item) => item.providerId === providerId);
    if (!provider) return;
    setImportDialog((current) => (current ? { ...current, applying: true } : current));
    const selected = new Set(dialog.selectedIds);
    const currentModels = [...provider.models].sort((a, b) => a.priority - b.priority);
    const toRemove = currentModels.filter((model) => !selected.has(model.providerModelId));
    const alreadySelected = currentModels.filter((model) => selected.has(model.providerModelId));
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
      await addImageModelIds(
        providerId,
        toAdd.map((item) => item.providerModelId),
      );
    }
    const listed = await retryTransientRuntime(() => api.listProviders({}));
    const refreshed = listed.providers.find((item) => item.providerId === providerId);
    if (refreshed) {
      const byId = new Map(refreshed.models.map((model) => [model.providerModelId, model]));
      const ordered = [
        ...alreadySelected.map((model) => model.providerModelId),
        ...toAdd.map((item) => item.providerModelId),
      ]
        .map((id) => byId.get(id))
        .filter((model): model is ProviderSummary['models'][number] => Boolean(model));
      if (ordered.length > 0) {
        await api.setModelPriorities({
          providerId: providerId as never,
          entries: ordered.map((model) => ({ modelId: model.modelId as never })),
        });
      }
    }
    setImportDialog(null);
    await load();
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
    setProviders((current) => {
      const nextIds = nextEnabled.map((provider) => provider.providerId);
      return current.map((provider) => {
        const index = nextIds.indexOf(provider.providerId);
        return index >= 0 ? { ...provider, sortOrder: index } : provider;
      });
    });
    void persistImageOrder(nextEnabled)
      .then(() => {
        onCatalogChanged?.();
      })
      .catch((caught) => {
        setProviders(previous);
        showToast('error', formatRuntimeIpcError(caught, '操作失败'));
      });
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
              discovering={busy && busyKind === 'discover'}
              onChange={setCreateDraft}
              onDiscover={handleDiscoverCreateModels}
              onActivate={handleCreate}
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
              onApiProviderChange={(next) => {
                void persistApiProvider(selected.providerId, next).catch((caught) => {
                  showToast('error', formatRuntimeIpcError(caught, '操作失败'));
                });
              }}
              onRevealCredential={revealSelectedCredential}
              onSaveBaseUrl={(baseUrl) => {
                void persistProviderDraft(selected, { baseUrl, apiKey: '' })
                  .then(() => load())
                  .catch((caught) => {
                    showToast('error', formatRuntimeIpcError(caught, '操作失败'));
                  });
              }}
              onAddModel={(providerModelId) =>
                void withBusy(async () => {
                  await addImageModelIds(selected.providerId, [providerModelId]);
                  await load();
                }, '生图模型已添加')
              }
              onReorderModels={(orderedModelIds) => {
                const previous = providers;
                setProviders((current) =>
                  current.map((item) => {
                    if (item.providerId !== selected.providerId) return item;
                    const byId = new Map(item.models.map((model) => [model.modelId, model]));
                    return {
                      ...item,
                      models: orderedModelIds
                        .map((modelId, index) => {
                          const model = byId.get(modelId);
                          return model ? { ...model, priority: index } : null;
                        })
                        .filter(
                          (model): model is ProviderSummary['models'][number] => Boolean(model),
                        ),
                    };
                  }),
                );
                void (async () => {
                  try {
                    const api = bridge();
                    if (!api?.setModelPriorities) throw new Error('Runtime 未连接');
                    await api.setModelPriorities({
                      providerId: selected.providerId as never,
                      entries: orderedModelIds.map((modelId) => ({ modelId: modelId as never })),
                    });
                    onCatalogChanged?.();
                  } catch (caught) {
                    setProviders(previous);
                    showToast('error', formatRuntimeIpcError(caught, '操作失败'));
                  }
                })();
              }}
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
                  setImportDialog({
                    providerId: selected.providerId,
                    protocol: IMAGE_GENERATION_PROTOCOL,
                    discovered: models.map((id) => ({
                      providerModelId: id,
                      displayName: id,
                      alreadyAdded: existing.has(id),
                    })),
                    selectedIds: models.filter((id) => existing.has(id)),
                    query: '',
                    applying: false,
                  });
                })
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
      {importDialog ? (
        <ImportModelsDialog
          dialog={importDialog}
          onClose={() => setImportDialog(null)}
          onChange={setImportDialog}
          onApply={() => {
            if (importDialog.target === 'create') {
              handleApplyCreateImport(importDialog);
              return;
            }
            void (async () => {
              try {
                await applyImageImport(importDialog);
              } catch (caught) {
                setImportDialog((current) =>
                  current ? { ...current, applying: false } : current,
                );
                showToast('error', formatRuntimeIpcError(caught, '应用到优先级失败'));
              }
            })();
          }}
        />
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
  discovering,
  onChange,
  onDiscover,
  onActivate,
  onBack,
}: {
  draft: CreateDraft;
  template: ImageCatalogItem | null;
  busy: boolean;
  discovering: boolean;
  onChange: (draft: CreateDraft) => void;
  onDiscover: () => void;
  onActivate: () => void;
  onBack: () => void;
}) {
  const title = template?.name ?? IMAGE_GENERATION_COPY.customTitle;
  const avatarLetter = (draft.name.trim() || title).slice(0, 1).toUpperCase();
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
    setAddingModel(false);
  };
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
      <section
        className="model-provider-detail model-provider-form"
        aria-labelledby="image-provider-form-title"
      >
        <div className="model-provider-detail__head">
          <span className="model-provider-detail__avatar">{avatarLetter}</span>
          <h2 id="image-provider-form-title">{title}</h2>
        </div>

        <div className="model-provider-fields">
          <div>
            <label className="model-field-label" htmlFor="image-create-name">
              供应商名称
            </label>
            <input
              id="image-create-name"
              className="st-field-input"
              value={draft.name}
              placeholder={IMAGE_GENERATION_COPY.namePlaceholder}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </div>
          <ImageApiProviderSelect
            id="image-create-api-provider"
            value={draft.apiProvider}
            disabled={busy}
            onChange={(apiProvider) => onChange({ ...draft, apiProvider })}
          />
          <div>
            <label className="model-field-label" htmlFor="image-create-base-url">
              API 地址（自定义服务）
            </label>
            <input
              id="image-create-base-url"
              className="st-field-input font-mono text-[12.5px]"
              data-testid="image-provider-base-url"
              aria-label="API 地址（自定义服务）"
              value={draft.baseUrl}
              placeholder="https://api.example.com/v1"
              disabled={busy}
              onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
            />
          </div>
        </div>

        <section className="model-newmax-section model-newmax-section--credentials">
          <div className="model-newmax-section__label">API 密钥</div>
          <div className="model-credential-list">
            <SecretInput
              id="image-create-api-key"
              value={draft.apiKey}
              placeholder="输入 API 密钥"
              disabled={busy}
              onChange={(apiKey) => onChange({ ...draft, apiKey })}
            />
          </div>
        </section>

        <section className="model-newmax-section">
          <div className="model-newmax-section__heading">
            <div>
              <span className="model-newmax-section__label">生图模型（至少添加一个）</span>
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
                    <ImageDraftModelRow
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
              placeholder={IMAGE_GENERATION_COPY.modelPlaceholder}
              inputAriaLabel="新的生图模型 ID"
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
              className="model-add-model-btn"
              disabled={busy}
              onClick={() => setAddingModel(true)}
            >
              <Plus size={14} /> {IMAGE_GENERATION_COPY.addModel}
            </button>
          )}

          <p className="model-priority-hint">拖拽调整优先级</p>

          <button
            type="button"
            className="model-fetch-models-link"
            disabled={busy}
            onClick={onDiscover}
          >
            {discovering ? (
              <Loader2 size={13} className="model-settings-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {discovering ? '正在拉取模型…' : IMAGE_GENERATION_COPY.fetchModelList}
          </button>

          <div className="model-test-connection">
            <button
              type="button"
              className="model-test-connection__btn"
              disabled={busy || draft.models.length === 0}
              onClick={onActivate}
            >
              {busy && !discovering ? (
                <Loader2 size={15} className="model-settings-spin" />
              ) : (
                <Plug size={15} />
              )}
              {busy && !discovering ? '测试中…' : IMAGE_GENERATION_COPY.testAndActivate}
            </button>
          </div>
        </section>
      </section>
    </div>
  );
}

function ImageDraftModelRow({
  model,
  index,
  busy,
  onRemove,
}: {
  model: ImageDraftModel;
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
          {imageModelRowLabel(index)}
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

function ImageProviderDetail({
  provider,
  busy,
  apiProvider,
  onApiProviderChange,
  onRevealCredential,
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
  onRevealCredential: (credentialRefId: string) => Promise<string | null>;
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
  const storedCredential = provider.credentials.find((item) => item.hasSecret);
  const storedCredentialRefId = storedCredential?.credentialRefId;
  const hasSecret = Boolean(storedCredentialRefId);
  const revealStoredKey = useCallback(() => {
    if (!storedCredentialRefId) return Promise.resolve(null);
    return onRevealCredential(storedCredentialRefId);
  }, [onRevealCredential, storedCredentialRefId]);
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
    if (!id) return;
    if (models.some((model) => model.providerModelId === id)) {
      setDraftModelId('');
      return;
    }
    onAddModel(id);
    setDraftModelId('');
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
        <ImageField
          label={IMAGE_GENERATION_COPY.baseUrl}
          htmlFor={`image-base-url-${provider.providerId}`}
        >
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
        </ImageField>
        <ImageField
          label={IMAGE_GENERATION_COPY.apiKey}
          htmlFor={`image-api-key-${provider.providerId}`}
          helper={keyHelper}
        >
          <SecretInput
            id={`image-api-key-${provider.providerId}`}
            value={apiKey}
            placeholder={
              hasSecret
                ? IMAGE_GENERATION_COPY.apiKeyInheritPlaceholder
                : IMAGE_GENERATION_COPY.apiKeyPlaceholder
            }
            disabled={busy}
            hasStoredSecret={hasSecret}
            onChange={setApiKey}
            onReveal={revealStoredKey}
          />
        </ImageField>
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
              <AddModelInlineRow
                value={draftModelId}
                busy={busy}
                placeholder={IMAGE_GENERATION_COPY.modelPlaceholder}
                inputAriaLabel="新的生图模型 ID"
                onChange={setDraftModelId}
                onConfirm={commitDraftModel}
                onDismiss={() => {
                  setAddingModel(false);
                  setDraftModelId('');
                }}
              />
            ) : (
              <button
                type="button"
                className="model-add-model-btn"
                disabled={busy}
                onClick={() => setAddingModel(true)}
              >
                <Plus size={14} /> {IMAGE_GENERATION_COPY.addModel}
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

function ImageField({
  label,
  htmlFor,
  helper,
  children,
}: {
  label: string;
  htmlFor?: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="image-provider-field">
      {htmlFor ? (
        <label className="model-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="model-field-label">{label}</span>
      )}
      {children}
      {helper ? <p className="model-field-helper">{helper}</p> : null}
    </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = IMAGE_API_PROVIDERS.find((item) => item.id === value) ?? IMAGE_API_PROVIDERS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (rootRef.current && path.includes(rootRef.current)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (next: ImageApiProviderId) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div>
      <label className="model-field-label" htmlFor={id}>
        {IMAGE_GENERATION_COPY.apiProvider}
      </label>
      <div ref={rootRef} className={clsx('image-api-select', open && 'is-open')}>
        <button
          type="button"
          id={id}
          className="image-api-select__trigger"
          aria-label={IMAGE_GENERATION_COPY.apiProvider}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((current) => !current);
          }}
        >
          <span>{selected.label}</span>
          <span className="image-api-select__chevron" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </button>
        {open ? (
          <div
            className="image-api-select__menu"
            role="listbox"
            aria-label={IMAGE_GENERATION_COPY.apiProvider}
          >
            {IMAGE_API_PROVIDERS.map((item) => {
              const active = item.id === value;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={active}
                  className={clsx('image-api-select__option', active && 'is-active')}
                  onPointerDown={(event) => {
                    if (event.button > 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    choose(item.id);
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    choose(item.id);
                  }}
                >
                  <span>{item.label}</span>
                  {active ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
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

const IMAGE_CREDENTIAL_MASK = '••••••••••••••••••••••••';

function SecretInput({
  id,
  value,
  placeholder,
  disabled,
  hasStoredSecret,
  onChange,
  onReveal,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  hasStoredSecret?: boolean;
  onChange(value: string): void;
  onReveal?: () => Promise<string | null>;
}) {
  const [visible, setVisible] = useState(false);
  const [revealed, setRevealed] = useState('');
  const plaintext = value || revealed;
  const masked = Boolean(plaintext || hasStoredSecret);

  useEffect(() => {
    setVisible(false);
    setRevealed('');
  }, [id, hasStoredSecret]);

  useEffect(() => {
    if (!hasStoredSecret || !onReveal) return;
    let cancelled = false;
    void onReveal().then((secret) => {
      if (!cancelled && secret) setRevealed(secret);
    });
    return () => {
      cancelled = true;
    };
  }, [hasStoredSecret, id, onReveal]);

  useEffect(() => {
    if (value || hasStoredSecret) return;
    setVisible(false);
    setRevealed('');
  }, [value, hasStoredSecret]);

  const handleToggle = () => {
    if (visible) {
      setVisible(false);
      return;
    }
    if (!plaintext && hasStoredSecret && onReveal) {
      void onReveal().then((secret) => {
        if (secret) setRevealed(secret);
        setVisible(true);
      });
      return;
    }
    setVisible(true);
  };

  return (
    <div className="model-secret-input">
      <input
        id={id}
        className="st-field-input font-mono text-[12.5px]"
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        aria-label={IMAGE_GENERATION_COPY.apiKey}
        value={visible ? plaintext : masked ? value || IMAGE_CREDENTIAL_MASK : ''}
        placeholder={masked ? undefined : placeholder}
        readOnly={!visible && Boolean(hasStoredSecret) && !value}
        disabled={disabled}
        onChange={(event) => {
          setRevealed('');
          onChange(event.target.value);
        }}
      />
      <button
        type="button"
        title={visible ? '隐藏密钥' : '显示密钥'}
        aria-label={visible ? '隐藏密钥' : '显示密钥'}
        disabled={disabled || (!masked && !visible)}
        onClick={handleToggle}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
