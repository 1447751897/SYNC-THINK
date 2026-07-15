import type {
  PreviewCcSwitchImportPayload,
  ImportCcSwitchPayload,
  DiscoverModelsPayload,
  AddModelsPayload,
  ListProvidersPayload,
  ProbeCapabilitiesPayload,
  ConfirmCapabilitiesPayload,
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
    value.rotateCredentialFromClipboard !== undefined;
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
    ])
  ) {
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
