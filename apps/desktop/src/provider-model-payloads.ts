import type {
  AddModelsPayload,
  RemoveModelPayload,
  SetModelPrioritiesPayload,
  UpdateModelPayload,
} from '@sync-think/protocol';
import {
  hasOnlyKeys,
  isBoundedProviderId,
  isRecord,
  PROVIDER_PROTOCOLS,
} from './provider-payload-validation.js';

export function parseAddModelsPayload(value: unknown): AddModelsPayload {
  if (!isRecord(value)) throw new Error('Invalid add-models payload');
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    typeof value.protocol !== 'string' ||
    !PROVIDER_PROTOCOLS.has(value.protocol) ||
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

export function parseSetModelPrioritiesPayload(value: unknown): SetModelPrioritiesPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'entries']) ||
    !isBoundedProviderId(value.providerId) ||
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
      !isBoundedProviderId(entry.modelId) ||
      (entry.credentialRefId !== undefined &&
        entry.credentialRefId !== null &&
        !isBoundedProviderId(entry.credentialRefId))
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
    !isBoundedProviderId(value.providerId) ||
    !isBoundedProviderId(value.modelId)
  ) {
    throw new Error('Invalid remove-model payload');
  }
  return {
    providerId: value.providerId.trim() as RemoveModelPayload['providerId'],
    modelId: value.modelId.trim() as RemoveModelPayload['modelId'],
  };
}

export function parseUpdateModelPayload(value: unknown): UpdateModelPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'modelId', 'displayName', 'contextWindow']) ||
    !isBoundedProviderId(value.providerId) ||
    !isBoundedProviderId(value.modelId)
  ) {
    throw new Error('Invalid update-model payload');
  }
  if (value.displayName !== undefined) {
    if (typeof value.displayName !== 'string' || value.displayName.length > 256) {
      throw new Error('Invalid update-model payload');
    }
  }
  if (value.contextWindow !== undefined && value.contextWindow !== null) {
    if (
      typeof value.contextWindow !== 'number' ||
      !Number.isFinite(value.contextWindow) ||
      value.contextWindow <= 0
    ) {
      throw new Error('Invalid update-model payload');
    }
  }
  if (value.displayName === undefined && value.contextWindow === undefined) {
    throw new Error('Invalid update-model payload');
  }
  return {
    providerId: value.providerId.trim() as UpdateModelPayload['providerId'],
    modelId: value.modelId.trim() as UpdateModelPayload['modelId'],
    displayName: typeof value.displayName === 'string' ? value.displayName.trim() : undefined,
    contextWindow:
      value.contextWindow === null
        ? null
        : typeof value.contextWindow === 'number'
          ? Math.round(value.contextWindow)
          : undefined,
  };
}
