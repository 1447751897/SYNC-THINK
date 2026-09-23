import type {
  DeleteProviderPayload,
  ListProvidersPayload,
  ReorderProvidersPayload,
} from '@sync-think/protocol';
import {
  hasOnlyKeys,
  isBoundedProviderId,
  isRecord,
  PROVIDER_PROTOCOLS,
} from './provider-payload-validation.js';

export interface RendererCreateProviderPayload {
  name: string;
  baseUrl: string;
  protocol: 'openai-responses' | 'openai-chat' | 'openai-images' | 'anthropic-messages';
  supportsDiscovery?: boolean;
  discoverOnCreate?: boolean;
  credentialGroupName?: string;
  credentialLabel?: string;
  importedFrom?: string;
  models?: Array<{
    providerModelId: string;
    displayName?: string;
    contextWindow?: number;
  }>;
  apiKeyList?: boolean;
  unverified?: boolean;
}

export interface RendererUpdateProviderPayload {
  providerId: string;
  name?: string;
  baseUrl?: string;
  protocol?: RendererCreateProviderPayload['protocol'];
  supportsDiscovery?: boolean;
  credentialLabel?: string;
  rotateCredentialFromClipboard?: boolean;
  enabled?: boolean;
  unverified?: boolean;
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
    !PROVIDER_PROTOCOLS.has(value.protocol) ||
    !hasOnlyKeys(value, [
      'name',
      'baseUrl',
      'protocol',
      'supportsDiscovery',
      'discoverOnCreate',
      'credentialGroupName',
      'credentialLabel',
      'importedFrom',
      'models',
      'apiKeyList',
      'unverified',
    ])
  ) {
    throw new Error('Invalid create-provider payload');
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean') {
    throw new Error('Invalid create-provider payload');
  }
  if (value.discoverOnCreate !== undefined && typeof value.discoverOnCreate !== 'boolean') {
    throw new Error('Invalid create-provider payload');
  }
  for (const field of ['credentialGroupName', 'credentialLabel', 'importedFrom'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error('Invalid create-provider payload');
    }
  }
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || value.models.length > 256) {
      throw new Error('Invalid create-provider payload');
    }
    for (const model of value.models) {
      if (
        !isRecord(model) ||
        typeof model.providerModelId !== 'string' ||
        model.providerModelId.trim().length === 0 ||
        model.providerModelId.length > 256
      ) {
        throw new Error('Invalid create-provider payload');
      }
      if (model.displayName !== undefined && typeof model.displayName !== 'string') {
        throw new Error('Invalid create-provider payload');
      }
      if (
        model.contextWindow !== undefined &&
        (typeof model.contextWindow !== 'number' ||
          !Number.isFinite(model.contextWindow) ||
          model.contextWindow <= 0)
      ) {
        throw new Error('Invalid create-provider payload');
      }
    }
  }
  if (value.apiKeyList !== undefined && typeof value.apiKeyList !== 'boolean') {
    throw new Error('Invalid create-provider payload');
  }
  if (value.unverified !== undefined && typeof value.unverified !== 'boolean') {
    throw new Error('Invalid create-provider payload');
  }
  return {
    name: value.name.trim(),
    baseUrl: value.baseUrl.trim(),
    protocol: value.protocol as RendererCreateProviderPayload['protocol'],
    supportsDiscovery: value.supportsDiscovery as boolean | undefined,
    discoverOnCreate: value.discoverOnCreate as boolean | undefined,
    credentialGroupName: value.credentialGroupName as string | undefined,
    credentialLabel: value.credentialLabel as string | undefined,
    importedFrom: value.importedFrom as string | undefined,
    models: value.models as RendererCreateProviderPayload['models'],
    apiKeyList: value.apiKeyList as boolean | undefined,
    unverified: value.unverified as boolean | undefined,
  };
}

export function parseListProvidersPayload(value: unknown): ListProvidersPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-providers payload');
  return {};
}

export function parseReorderProvidersPayload(value: unknown): ReorderProvidersPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['orderedProviderIds']) ||
    !Array.isArray(value.orderedProviderIds) ||
    value.orderedProviderIds.length === 0 ||
    value.orderedProviderIds.length > 256 ||
    !value.orderedProviderIds.every(isBoundedProviderId) ||
    new Set(value.orderedProviderIds).size !== value.orderedProviderIds.length
  ) {
    throw new Error('Invalid reorder-providers payload');
  }
  return { orderedProviderIds: value.orderedProviderIds.map((id) => id.trim()) };
}

export function parseDeleteProviderPayload(value: unknown): DeleteProviderPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId']) ||
    !isBoundedProviderId(value.providerId)
  ) {
    throw new Error('Invalid delete-provider payload');
  }
  return {
    providerId: value.providerId.trim() as DeleteProviderPayload['providerId'],
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
    value.rotateCredentialFromClipboard !== undefined ||
    value.enabled !== undefined ||
    value.unverified !== undefined;
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
      'unverified',
    ])
  ) {
    throw new Error('Invalid update-provider payload');
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Invalid update-provider payload');
  }
  if (value.unverified !== undefined && typeof value.unverified !== 'boolean') {
    throw new Error('Invalid update-provider payload');
  }
  if (
    value.name !== undefined &&
    (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256)
  ) {
    throw new Error('Invalid update-provider payload');
  }
  if (
    value.baseUrl !== undefined &&
    (typeof value.baseUrl !== 'string' ||
      value.baseUrl.trim().length === 0 ||
      value.baseUrl.length > 2048)
  ) {
    throw new Error('Invalid update-provider payload');
  }
  if (
    value.protocol !== undefined &&
    (typeof value.protocol !== 'string' || !PROVIDER_PROTOCOLS.has(value.protocol))
  ) {
    throw new Error('Invalid update-provider payload');
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
    unverified: value.unverified as boolean | undefined,
  };
}
