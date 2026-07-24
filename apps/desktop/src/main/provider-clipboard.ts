import type { CreateProviderPayload, UpdateProviderPayload } from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
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
  return {
    ...metadata,
    apiKey: readCredential(readClipboard),
  } as CreateProviderPayload;
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
