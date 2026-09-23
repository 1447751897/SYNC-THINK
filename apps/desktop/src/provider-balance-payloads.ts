import type { ProviderBalancePayload } from '@sync-think/protocol';
import { isRecord } from './provider-payload-validation.js';

export function parseProviderBalancePayload(value: unknown): ProviderBalancePayload {
  if (!isRecord(value)) throw new Error('Invalid provider-balance payload');
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.trim().length === 0 ||
    value.providerId.length > 256
  ) {
    throw new Error('Invalid provider-balance payload');
  }
  if (
    value.credentialRefId !== undefined &&
    (typeof value.credentialRefId !== 'string' || value.credentialRefId.length > 256)
  ) {
    throw new Error('Invalid provider-balance payload');
  }
  return {
    providerId: value.providerId.trim() as ProviderBalancePayload['providerId'],
    ...(typeof value.credentialRefId === 'string'
      ? { credentialRefId: value.credentialRefId as ProviderBalancePayload['credentialRefId'] }
      : {}),
  };
}
