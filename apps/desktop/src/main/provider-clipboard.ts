import type {
  CreateProviderPayload,
  ProbeModelsPayload,
  UpdateProviderPayload,
} from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
  RendererProbeModelsPayload,
  RendererUpdateProviderPayload,
} from '../provider-payloads.js';

const MAX_CLIPBOARD_CREDENTIAL_LENGTH = 8192;

function readCredential(readClipboard: () => string): string {
  const credential = readClipboard();
  if (
    typeof credential !== 'string' ||
    credential.trim().length === 0 ||
    credential.length > MAX_CLIPBOARD_CREDENTIAL_LENGTH
  ) {
    throw new Error('Provider credential unavailable');
  }
  return credential;
}

export function createProviderPayloadFromClipboard(
  metadata: RendererCreateProviderPayload,
  readClipboard: () => string,
): CreateProviderPayload {
  const { apiKeyList, ...rest } = metadata;
  const raw = readCredential(readClipboard);
  if (apiKeyList !== true) {
    return { ...rest, apiKey: raw } as CreateProviderPayload;
  }
  // NewMax-style multi-key list: the clipboard holds { keys: [...] } so the
  // secrets still never travel through the renderer payload.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Provider credential unavailable');
  }
  const rawKeys = (parsed as { keys?: unknown })?.keys;
  const keys = Array.isArray(rawKeys)
    ? rawKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
    : [];
  if (keys.length === 0) throw new Error('Provider credential unavailable');
  return {
    ...rest,
    apiKey: keys[0],
    extraApiKeys: keys.slice(1),
  } as CreateProviderPayload;
}

/**
 * NewMax-style probe: same clipboard hand-off as create/update, but nothing is
 * persisted — the key is used for a single discovery hop and discarded.
 */
export function probeModelsPayloadFromClipboard(
  metadata: RendererProbeModelsPayload,
  readClipboard: () => string,
): ProbeModelsPayload {
  return {
    ...metadata,
    apiKey: readCredential(readClipboard),
  } as ProbeModelsPayload;
}

export function updateProviderPayloadFromClipboard(
  metadata: RendererUpdateProviderPayload,
  readClipboard: () => string,
): UpdateProviderPayload {
  const { rotateCredentialFromClipboard, ...update } = metadata;
  const internalUpdate = {
    ...update,
    providerId: update.providerId as UpdateProviderPayload['providerId'],
  };
  return rotateCredentialFromClipboard === true
    ? { ...internalUpdate, apiKey: readCredential(readClipboard) }
    : internalUpdate;
}
