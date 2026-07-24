import type {
  PreviewCcSwitchImportPayload,
  ImportCcSwitchPayload,
  DiscoverModelsPayload,
  AddModelsPayload,
  ListProvidersPayload,
  ProbeCapabilitiesPayload,
  ConfirmCapabilitiesPayload,
  ReorderProvidersPayload,
  RemoveProviderCredentialPayload,
  SetModelPrioritiesPayload,
  RemoveModelPayload,
  GetSettingsPayload,
  SetSettingPayload,
  UsageSummaryPayload,
} from '@sync-think/protocol';

export interface RendererCreateProviderPayload {
  name: string;
  baseUrl: string;
  protocol: 'openai-responses' | 'openai-chat' | 'openai-images' | 'anthropic-messages';
  supportsDiscovery?: boolean;
  credentialGroupName?: string;
  credentialLabel?: string;
  importedFrom?: string;
}

export interface RendererUpdateProviderPayload {
  providerId: string;
  name?: string;
  baseUrl?: string;
  protocol?: RendererCreateProviderPayload['protocol'];
  supportsDiscovery?: boolean;
  credentialLabel?: string;
  rotateCredentialFromClipboard?: boolean;
  /** 0026: toggle the entry on/off. */
  enabled?: boolean;
}

export interface RendererAddProviderCredentialPayload {
  providerId: string;
  label?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const PROTOCOLS = new Set([
  'openai-responses',
  'openai-chat',
  'openai-images',
  'anthropic-messages',
]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseCreateProviderPayload(value: unknown): RendererCreateProviderPayload {
  if (!isRecord(value)) throw new Error('Invalid create-provider payload');
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256 ||
    typeof value.baseUrl !== 'string' ||
    value.baseUrl.trim().length === 0 ||
    value.baseUrl.length > 2048 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    !hasOnlyKeys(value, [
      'name',
      'baseUrl',
      'protocol',
      'supportsDiscovery',
      'credentialGroupName',
      'credentialLabel',
      'importedFrom',
    ])
  ) {
    throw new Error('Invalid create-provider payload');
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean') {
    throw new Error('Invalid create-provider payload');
  }
  for (const field of ['credentialGroupName', 'credentialLabel', 'importedFrom'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error('Invalid create-provider payload');
    }
  }
  return {
    name: value.name.trim(),
    baseUrl: value.baseUrl.trim(),
    protocol: value.protocol as RendererCreateProviderPayload['protocol'],
    supportsDiscovery: value.supportsDiscovery as boolean | undefined,
    credentialGroupName: value.credentialGroupName as string | undefined,
    credentialLabel: value.credentialLabel as string | undefined,
    importedFrom: value.importedFrom as string | undefined,
  };
}

export function parseListProvidersPayload(value: unknown): ListProvidersPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-providers payload');
  return {};
}

export function parseDiscoverModelsPayload(value: unknown): DiscoverModelsPayload {
  if (!isRecord(value)) throw new Error('Invalid discover-models payload');
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    throw new Error('Invalid discover-models payload');
  }
  if (value.credentialRefId !== undefined && typeof value.credentialRefId !== 'string') {
    throw new Error('Invalid discover-models payload');
  }
  return {
    providerId: value.providerId as DiscoverModelsPayload['providerId'],
    credentialRefId: value.credentialRefId as DiscoverModelsPayload['credentialRefId'],
  };
}

export function parseAddModelsPayload(value: unknown): AddModelsPayload {
  if (!isRecord(value)) throw new Error('Invalid add-models payload');
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    !Array.isArray(value.models) ||
    value.models.length === 0
  ) {
    throw new Error('Invalid add-models payload');
  }
  return {
    providerId: value.providerId as AddModelsPayload['providerId'],
    protocol: value.protocol as AddModelsPayload['protocol'],
    models: value.models as AddModelsPayload['models'],
  };
}


const CAPABILITY_TAGS = new Set([
  'text',
  'vision',
  'tool-calling',
  'image-generation',
  'embeddings',
]);

export function parseProbeCapabilitiesPayload(value: unknown): ProbeCapabilitiesPayload {
  if (!isRecord(value)) throw new Error('Invalid probe-capabilities payload');
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    throw new Error('Invalid probe-capabilities payload');
  }
  if (value.modelId !== undefined && (typeof value.modelId !== 'string' || value.modelId.length === 0)) {
    throw new Error('Invalid probe-capabilities payload');
  }
  return {
    providerId: value.providerId as ProbeCapabilitiesPayload['providerId'],
    modelId: value.modelId as ProbeCapabilitiesPayload['modelId'],
  };
}

export function parseConfirmCapabilitiesPayload(value: unknown): ConfirmCapabilitiesPayload {
  if (!isRecord(value)) throw new Error('Invalid confirm-capabilities payload');
  if (
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length === 0 ||
    value.capabilities.length > 16 ||
    !value.capabilities.every(
      (c) => typeof c === 'string' && CAPABILITY_TAGS.has(c),
    )
  ) {
    throw new Error('Invalid confirm-capabilities payload');
  }
  if (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') {
    throw new Error('Invalid confirm-capabilities payload');
  }
  return {
    modelId: value.modelId as ConfirmCapabilitiesPayload['modelId'],
    capabilities: value.capabilities as ConfirmCapabilitiesPayload['capabilities'],
    confirmed: value.confirmed as boolean | undefined,
  };
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

export function parseReorderProvidersPayload(value: unknown): ReorderProvidersPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['orderedProviderIds']) ||
    !Array.isArray(value.orderedProviderIds) ||
    value.orderedProviderIds.length === 0 ||
    value.orderedProviderIds.length > 256 ||
    !value.orderedProviderIds.every(isBoundedId) ||
    new Set(value.orderedProviderIds).size !== value.orderedProviderIds.length
  ) {
    throw new Error('Invalid reorder-providers payload');
  }
  return { orderedProviderIds: value.orderedProviderIds.map((id) => id.trim()) };
}

export function parseAddProviderCredentialMetadata(
  value: unknown,
): RendererAddProviderCredentialPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'label']) ||
    !isBoundedId(value.providerId) ||
    (value.label !== undefined &&
      (typeof value.label !== 'string' || value.label.length > 256))
  ) {
    throw new Error('Invalid add-provider-credential payload');
  }
  return {
    providerId: value.providerId.trim(),
    label: typeof value.label === 'string' ? value.label.trim() : undefined,
  };
}

export function parseRemoveProviderCredentialPayload(
  value: unknown,
): RemoveProviderCredentialPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'credentialRefId']) ||
    !isBoundedId(value.providerId) ||
    !isBoundedId(value.credentialRefId)
  ) {
    throw new Error('Invalid remove-provider-credential payload');
  }
  return {
    providerId: value.providerId.trim() as RemoveProviderCredentialPayload['providerId'],
    credentialRefId:
      value.credentialRefId.trim() as RemoveProviderCredentialPayload['credentialRefId'],
  };
}

export function parseSetModelPrioritiesPayload(value: unknown): SetModelPrioritiesPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'entries']) ||
    !isBoundedId(value.providerId) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    value.entries.length > 256
  ) {
    throw new Error('Invalid set-model-priorities payload');
  }
  const modelIds = new Set<string>();
  const entries: SetModelPrioritiesPayload['entries'] = [];
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ['modelId', 'credentialRefId']) ||
      !isBoundedId(entry.modelId) ||
      (entry.credentialRefId !== undefined &&
        entry.credentialRefId !== null &&
        !isBoundedId(entry.credentialRefId))
    ) {
      throw new Error('Invalid set-model-priorities payload');
    }
    const modelId = entry.modelId.trim();
    if (modelIds.has(modelId)) throw new Error('Invalid set-model-priorities payload');
    modelIds.add(modelId);
    entries.push({
      modelId: modelId as SetModelPrioritiesPayload['entries'][number]['modelId'],
      credentialRefId:
        entry.credentialRefId === null
          ? null
          : typeof entry.credentialRefId === 'string'
            ? (entry.credentialRefId.trim() as NonNullable<
                SetModelPrioritiesPayload['entries'][number]['credentialRefId']
              >)
            : undefined,
    });
  }
  return {
    providerId: value.providerId.trim() as SetModelPrioritiesPayload['providerId'],
    entries,
  };
}

export function parseRemoveModelPayload(value: unknown): RemoveModelPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'modelId']) ||
    !isBoundedId(value.providerId) ||
    !isBoundedId(value.modelId)
  ) {
    throw new Error('Invalid remove-model payload');
  }
  return {
    providerId: value.providerId.trim() as RemoveModelPayload['providerId'],
    modelId: value.modelId.trim() as RemoveModelPayload['modelId'],
  };
}

export function parseGetSettingsPayload(value: unknown): GetSettingsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['keys'])) {
    throw new Error('Invalid get-settings payload');
  }
  if (
    value.keys !== undefined &&
    (!Array.isArray(value.keys) ||
      value.keys.length > 64 ||
      !value.keys.every(
        (key) => typeof key === 'string' && key.trim().length > 0 && key.length <= 128,
      ))
  ) {
    throw new Error('Invalid get-settings payload');
  }
  return {
    keys: Array.isArray(value.keys) ? value.keys.map((key) => String(key).trim()) : undefined,
  };
}

export function parseSetSettingPayload(value: unknown): SetSettingPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['key', 'value']) ||
    typeof value.key !== 'string' ||
    value.key.trim().length === 0 ||
    value.key.length > 128 ||
    !Object.prototype.hasOwnProperty.call(value, 'value')
  ) {
    throw new Error('Invalid set-setting payload');
  }
  try {
    const encoded = JSON.stringify(value.value ?? null);
    if (encoded.length > 16_384) throw new Error('too large');
  } catch {
    throw new Error('Invalid set-setting payload');
  }
  return { key: value.key.trim(), value: value.value };
}

export function parseUsageSummaryPayload(value: unknown): UsageSummaryPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['sinceDays'])) {
    throw new Error('Invalid usage-summary payload');
  }
  if (
    value.sinceDays !== undefined &&
    (typeof value.sinceDays !== 'number' ||
      !Number.isFinite(value.sinceDays) ||
      value.sinceDays <= 0 ||
      value.sinceDays > 3650)
  ) {
    throw new Error('Invalid usage-summary payload');
  }
  return { sinceDays: value.sinceDays as number | undefined };
}

export function parseUpdateProviderPayload(value: unknown): RendererUpdateProviderPayload {
  if (!isRecord(value)) throw new Error('Invalid update-provider payload');
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    throw new Error('Invalid update-provider payload');
  }
  const hasField =
    value.name !== undefined ||
    value.baseUrl !== undefined ||
    value.protocol !== undefined ||
    value.supportsDiscovery !== undefined ||
    value.credentialLabel !== undefined ||
    value.rotateCredentialFromClipboard !== undefined ||
    value.enabled !== undefined;
  if (!hasField) throw new Error('Invalid update-provider payload');
  if (
    !hasOnlyKeys(value, [
      'providerId',
      'name',
      'baseUrl',
      'protocol',
      'supportsDiscovery',
      'credentialLabel',
      'rotateCredentialFromClipboard',
      'enabled',
    ])
  ) {
    throw new Error('Invalid update-provider payload');
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Invalid update-provider payload');
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256) {
      throw new Error('Invalid update-provider payload');
    }
  }
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== 'string' || value.baseUrl.trim().length === 0 || value.baseUrl.length > 2048) {
      throw new Error('Invalid update-provider payload');
    }
  }
  if (value.protocol !== undefined) {
    if (typeof value.protocol !== 'string' || !PROTOCOLS.has(value.protocol)) {
      throw new Error('Invalid update-provider payload');
    }
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean') {
    throw new Error('Invalid update-provider payload');
  }
  if (value.credentialLabel !== undefined && typeof value.credentialLabel !== 'string') {
    throw new Error('Invalid update-provider payload');
  }
  if (
    value.rotateCredentialFromClipboard !== undefined &&
    typeof value.rotateCredentialFromClipboard !== 'boolean'
  ) {
    throw new Error('Invalid update-provider payload');
  }
  return {
    providerId: value.providerId,
    name: value.name as string | undefined,
    baseUrl: value.baseUrl as string | undefined,
    protocol: value.protocol as RendererUpdateProviderPayload['protocol'],
    supportsDiscovery: value.supportsDiscovery as boolean | undefined,
    credentialLabel: value.credentialLabel as string | undefined,
    rotateCredentialFromClipboard: value.rotateCredentialFromClipboard as boolean | undefined,
    enabled: value.enabled as boolean | undefined,
  };
}

export function parsePreviewCcSwitchImportPayload(value: unknown): PreviewCcSwitchImportPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid preview-cc-switch payload');
  if (value.dbPath !== undefined && typeof value.dbPath !== 'string') {
    throw new Error('Invalid preview-cc-switch payload');
  }
  return {
    dbPath: value.dbPath as string | undefined,
  };
}

export function parseImportCcSwitchPayload(value: unknown): ImportCcSwitchPayload {
  if (!isRecord(value)) throw new Error('Invalid import-cc-switch payload');
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length === 0) {
    throw new Error('Invalid import-cc-switch payload');
  }
  if (!value.sourceIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error('Invalid import-cc-switch payload');
  }
  if (value.dbPath !== undefined && typeof value.dbPath !== 'string') {
    throw new Error('Invalid import-cc-switch payload');
  }
  return {
    sourceIds: value.sourceIds as string[],
    dbPath: value.dbPath as string | undefined,
  };
}
