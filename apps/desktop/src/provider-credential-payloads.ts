import type {
  ClearProviderCredentialsPayload,
  RemoveProviderCredentialPayload,
  RevealProviderCredentialPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isBoundedProviderId, isRecord } from './provider-payload-validation.js';

export interface RendererAddProviderCredentialPayload {
  providerId: string;
  label?: string;
}

/** The replacement secret remains in the clipboard and never enters Renderer IPC. */
export interface RendererUpdateProviderCredentialPayload {
  providerId: string;
  credentialRefId: string;
  label?: string;
  rotateCredentialFromClipboard?: boolean;
}

export function parseAddProviderCredentialMetadata(
  value: unknown,
): RendererAddProviderCredentialPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'label']) ||
    !isBoundedProviderId(value.providerId) ||
    (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 256))
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
    !isBoundedProviderId(value.providerId) ||
    !isBoundedProviderId(value.credentialRefId)
  ) {
    throw new Error('Invalid remove-provider-credential payload');
  }
  return {
    providerId: value.providerId.trim() as RemoveProviderCredentialPayload['providerId'],
    credentialRefId:
      value.credentialRefId.trim() as RemoveProviderCredentialPayload['credentialRefId'],
  };
}

export function parseClearProviderCredentialsPayload(
  value: unknown,
): ClearProviderCredentialsPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId']) ||
    !isBoundedProviderId(value.providerId)
  ) {
    throw new Error('Invalid clear-provider-credentials payload');
  }
  return {
    providerId: value.providerId.trim() as ClearProviderCredentialsPayload['providerId'],
  };
}

export function parseRevealProviderCredentialPayload(
  value: unknown,
): RevealProviderCredentialPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['providerId', 'credentialRefId']) ||
    !isBoundedProviderId(value.providerId) ||
    !isBoundedProviderId(value.credentialRefId)
  ) {
    throw new Error('Invalid reveal-provider-credential payload');
  }
  return {
    providerId: value.providerId.trim() as RevealProviderCredentialPayload['providerId'],
    credentialRefId:
      value.credentialRefId.trim() as RevealProviderCredentialPayload['credentialRefId'],
  };
}

export function parseUpdateProviderCredentialMetadata(
  value: unknown,
): RendererUpdateProviderCredentialPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'providerId',
      'credentialRefId',
      'label',
      'rotateCredentialFromClipboard',
    ]) ||
    !isBoundedProviderId(value.providerId) ||
    !isBoundedProviderId(value.credentialRefId) ||
    (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 256)) ||
    (value.rotateCredentialFromClipboard !== undefined &&
      typeof value.rotateCredentialFromClipboard !== 'boolean')
  ) {
    throw new Error('Invalid update-provider-credential payload');
  }
  const rotate = value.rotateCredentialFromClipboard === true;
  const hasLabel = value.label !== undefined;
  if (!rotate && !hasLabel) {
    throw new Error('Invalid update-provider-credential payload');
  }
  return {
    providerId: value.providerId.trim(),
    credentialRefId: value.credentialRefId.trim(),
    label: typeof value.label === 'string' ? value.label.trim() : undefined,
    rotateCredentialFromClipboard: rotate || undefined,
  };
}
