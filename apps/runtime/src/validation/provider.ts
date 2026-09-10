// provider command payload parsers (extracted from command-validation.ts).
import type { CreateProviderPayload, UpdateProviderPayload, ListProvidersPayload, DiscoverModelsPayload, ProbeModelsPayload, AddModelsPayload, ReorderProvidersPayload, AddProviderCredentialPayload, RemoveProviderCredentialPayload, RevealProviderCredentialPayload, UpdateProviderCredentialPayload, SetModelPrioritiesPayload, UpdateModelPayload, RemoveModelPayload, GetSettingsPayload, SetSettingPayload, UsageSummaryPayload } from '@sync-think/protocol';
import { PROTOCOLS, SURFACES, isRecord } from './shared.js';

export function parseCreateProviderPayload(value: unknown): CreateProviderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256 ||
    typeof value.baseUrl !== 'string' ||
    value.baseUrl.trim().length === 0 ||
    value.baseUrl.length > 2048 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.trim().length === 0 ||
    value.apiKey.length > 8192
  ) {
    return undefined;
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean') {
    return undefined;
  }
  if (value.discoverOnCreate !== undefined && typeof value.discoverOnCreate !== 'boolean') {
    return undefined;
  }
  // NewMax-style「仍然保存」: keep the provider even though the test did not pass.
  if (value.unverified !== undefined && typeof value.unverified !== 'boolean') {
    return undefined;
  }
  for (const field of ['credentialGroupName', 'credentialLabel', 'importedFrom'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'string' || (value[field] as string).length > 256)
        return undefined;
    }
  }
  if (value.surface !== undefined) {
    if (typeof value.surface !== 'string' || !SURFACES.has(value.surface)) return undefined;
  }
  // NewMax-style multi-key list: extra credentials may ride along.
  if (value.extraApiKeys !== undefined) {
    if (
      !Array.isArray(value.extraApiKeys) ||
      value.extraApiKeys.length > 32 ||
      !value.extraApiKeys.every(
        (key) => typeof key === 'string' && key.trim().length > 0 && key.length <= 8192,
      )
    ) {
      return undefined;
    }
  }
  // NewMax-style atomic create: models may be seeded in the same hop.
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || value.models.length > 256) return undefined;
    for (const model of value.models) {
      if (
        !isRecord(model) ||
        typeof model.providerModelId !== 'string' ||
        model.providerModelId.trim().length === 0 ||
        model.providerModelId.length > 256
      ) {
        return undefined;
      }
      if (model.displayName !== undefined && typeof model.displayName !== 'string') return undefined;
      if (model.capabilities !== undefined) {
        if (
          !Array.isArray(model.capabilities) ||
          !model.capabilities.every((c) => typeof c === 'string')
        ) {
          return undefined;
        }
      }
      if (model.contextWindow !== undefined) {
        if (
          typeof model.contextWindow !== 'number' ||
          !Number.isFinite(model.contextWindow) ||
          model.contextWindow <= 0 ||
          model.contextWindow > 100_000_000
        ) {
          return undefined;
        }
      }
    }
  }
  return value as unknown as CreateProviderPayload;
}

export function parseUpdateProviderPayload(value: unknown): UpdateProviderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  const hasField =
    value.name !== undefined ||
    value.baseUrl !== undefined ||
    value.protocol !== undefined ||
    value.apiKey !== undefined ||
    value.supportsDiscovery !== undefined ||
    value.credentialLabel !== undefined ||
    value.surface !== undefined ||
    value.enabled !== undefined ||
    value.unverified !== undefined;
  if (!hasField) return undefined;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return undefined;
  if (value.unverified !== undefined && typeof value.unverified !== 'boolean') return undefined;
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256)
      return undefined;
  }
  if (value.baseUrl !== undefined) {
    if (
      typeof value.baseUrl !== 'string' ||
      value.baseUrl.trim().length === 0 ||
      value.baseUrl.length > 2048
    ) {
      return undefined;
    }
  }
  if (value.protocol !== undefined) {
    if (typeof value.protocol !== 'string' || !PROTOCOLS.has(value.protocol)) return undefined;
  }
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey !== 'string' || value.apiKey.length > 8192) return undefined;
    // empty string means "do not rotate"
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean')
    return undefined;
  if (value.credentialLabel !== undefined) {
    if (typeof value.credentialLabel !== 'string' || value.credentialLabel.length > 256)
      return undefined;
  }
  if (value.surface !== undefined) {
    if (typeof value.surface !== 'string' || !SURFACES.has(value.surface)) return undefined;
  }
  return value as unknown as UpdateProviderPayload;
}

export function parseListProvidersPayload(value: unknown): ListProvidersPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  return value as ListProvidersPayload;
}

export function parseDiscoverModelsPayload(value: unknown): DiscoverModelsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  if (value.credentialRefId !== undefined && typeof value.credentialRefId !== 'string')
    return undefined;
  if (value.persist !== undefined && typeof value.persist !== 'boolean') return undefined;
  return {
    providerId: value.providerId as DiscoverModelsPayload['providerId'],
    credentialRefId: value.credentialRefId as DiscoverModelsPayload['credentialRefId'],
    persist: value.persist as boolean | undefined,
  };
}

/**
 * NewMax-style probe: discover models from a base URL + ephemeral credential
 * without a persisted provider. Nothing is written to the catalog.
 */
export function parseProbeModelsPayload(value: unknown): ProbeModelsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.baseUrl !== 'string' ||
    value.baseUrl.trim().length === 0 ||
    value.baseUrl.length > 2048 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.trim().length === 0 ||
    value.apiKey.length > 8192
  ) {
    return undefined;
  }
  return {
    baseUrl: value.baseUrl.trim(),
    protocol: value.protocol as ProbeModelsPayload['protocol'],
    apiKey: value.apiKey,
  };
}

export function parseAddModelsPayload(value: unknown): AddModelsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    value.models.length > 256
  ) {
    return undefined;
  }
  for (const model of value.models) {
    if (
      !isRecord(model) ||
      typeof model.providerModelId !== 'string' ||
      model.providerModelId.trim().length === 0
    ) {
      return undefined;
    }
    if (model.displayName !== undefined && typeof model.displayName !== 'string') return undefined;
    if (model.contextWindow !== undefined) {
      if (
        typeof model.contextWindow !== 'number' ||
        !Number.isFinite(model.contextWindow) ||
        model.contextWindow <= 0 ||
        model.contextWindow > 100_000_000
      ) {
        return undefined;
      }
    }
    if (model.capabilities !== undefined) {
      if (
        !Array.isArray(model.capabilities) ||
        !model.capabilities.every((c) => typeof c === 'string')
      ) {
        return undefined;
      }
    }
  }
  return value as unknown as AddModelsPayload;
}

export function parseReorderProvidersPayload(value: unknown): ReorderProvidersPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !Array.isArray(value.orderedProviderIds) ||
    value.orderedProviderIds.length === 0 ||
    value.orderedProviderIds.length > 256 ||
    !value.orderedProviderIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 256,
    )
  ) {
    return undefined;
  }
  return value as unknown as ReorderProvidersPayload;
}

export function parseAddProviderCredentialPayload(
  value: unknown,
): AddProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.trim().length === 0 ||
    value.apiKey.length > 8192
  ) {
    return undefined;
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || value.label.length > 256) return undefined;
  }
  return value as unknown as AddProviderCredentialPayload;
}

export function parseRemoveProviderCredentialPayload(
  value: unknown,
): RemoveProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.credentialRefId !== 'string' ||
    value.credentialRefId.length === 0 ||
    value.credentialRefId.length > 256
  ) {
    return undefined;
  }
  return value as unknown as RemoveProviderCredentialPayload;
}

export function parseRevealProviderCredentialPayload(
  value: unknown,
): RevealProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.credentialRefId !== 'string' ||
    value.credentialRefId.length === 0 ||
    value.credentialRefId.length > 256
  ) {
    return undefined;
  }
  return {
    providerId: value.providerId as RevealProviderCredentialPayload['providerId'],
    credentialRefId: value.credentialRefId as RevealProviderCredentialPayload['credentialRefId'],
  };
}

export function parseUpdateProviderCredentialPayload(
  value: unknown,
): UpdateProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.credentialRefId !== 'string' ||
    value.credentialRefId.length === 0 ||
    value.credentialRefId.length > 256
  ) {
    return undefined;
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || value.label.length > 256) return undefined;
  }
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey !== 'string' || value.apiKey.length > 8192) return undefined;
  }
  const hasLabel = value.label !== undefined;
  const hasApiKey = typeof value.apiKey === 'string' && value.apiKey.trim().length > 0;
  if (!hasLabel && !hasApiKey) return undefined;
  return {
    providerId: value.providerId as UpdateProviderCredentialPayload['providerId'],
    credentialRefId: value.credentialRefId as UpdateProviderCredentialPayload['credentialRefId'],
    label: typeof value.label === 'string' ? value.label : undefined,
    apiKey:
      typeof value.apiKey === 'string' && value.apiKey.trim().length > 0
        ? value.apiKey
        : undefined,
  };
}

export function parseSetModelPrioritiesPayload(
  value: unknown,
): SetModelPrioritiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    value.entries.length > 256
  ) {
    return undefined;
  }
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.modelId !== 'string' ||
      entry.modelId.length === 0 ||
      entry.modelId.length > 256
    ) {
      return undefined;
    }
    if (entry.credentialRefId !== undefined && entry.credentialRefId !== null) {
      if (
        typeof entry.credentialRefId !== 'string' ||
        entry.credentialRefId.length === 0 ||
        entry.credentialRefId.length > 256
      ) {
        return undefined;
      }
    }
  }
  return value as unknown as SetModelPrioritiesPayload;
}

export function parseRemoveModelPayload(value: unknown): RemoveModelPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    value.modelId.length > 256
  ) {
    return undefined;
  }
  return value as unknown as RemoveModelPayload;
}

export function parseUpdateModelPayload(value: unknown): UpdateModelPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    value.modelId.length > 256
  ) {
    return undefined;
  }
  if (value.displayName !== undefined) {
    if (typeof value.displayName !== 'string' || value.displayName.length > 256) return undefined;
  }
  if (value.contextWindow !== undefined && value.contextWindow !== null) {
    if (
      typeof value.contextWindow !== 'number' ||
      !Number.isFinite(value.contextWindow) ||
      value.contextWindow <= 0
    ) {
      return undefined;
    }
  }
  if (value.displayName === undefined && value.contextWindow === undefined) return undefined;
  return {
    providerId: value.providerId as UpdateModelPayload['providerId'],
    modelId: value.modelId as UpdateModelPayload['modelId'],
    displayName: typeof value.displayName === 'string' ? value.displayName.trim() : undefined,
    contextWindow:
      value.contextWindow === null
        ? null
        : typeof value.contextWindow === 'number'
          ? Math.round(value.contextWindow)
          : undefined,
  };
}

export function parseGetSettingsPayload(value: unknown): GetSettingsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.keys !== undefined) {
    if (
      !Array.isArray(value.keys) ||
      value.keys.length > 64 ||
      !value.keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 128)
    ) {
      return undefined;
    }
  }
  return value as unknown as GetSettingsPayload;
}

export function parseSetSettingPayload(value: unknown): SetSettingPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.key !== 'string' || value.key.trim().length === 0 || value.key.length > 128) {
    return undefined;
  }
  if (!('value' in value)) return undefined;
  // Guard against oversized payloads (settings are small JSON blobs).
  try {
    const encoded = JSON.stringify(value.value ?? null);
    if (encoded.length > 16_384) return undefined;
  } catch {
    return undefined;
  }
  return value as unknown as SetSettingPayload;
}

export function parseUsageSummaryPayload(value: unknown): UsageSummaryPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).some((key) => key !== 'sinceDays' && key !== 'taskId')) {
    return undefined;
  }
  if (value.sinceDays !== undefined) {
    if (
      typeof value.sinceDays !== 'number' ||
      !Number.isFinite(value.sinceDays) ||
      value.sinceDays <= 0 ||
      value.sinceDays > 3650
    ) {
      return undefined;
    }
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' ||
      value.taskId.length > 256 ||
      value.taskId.trim().length === 0)
  ) {
    return undefined;
  }
  return {
    ...(value.sinceDays !== undefined ? { sinceDays: value.sinceDays } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId.trim() } : {}),
  };
}
