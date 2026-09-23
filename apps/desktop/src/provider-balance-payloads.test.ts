import { describe, expect, it } from 'vitest';
import { parseProviderBalancePayload } from './provider-balance-payloads.js';

describe('Provider Balance payload validation', () => {
  it('normalizes the provider id and preserves an explicit credential', () => {
    expect(
      parseProviderBalancePayload({
        providerId: ' provider-1 ',
        credentialRefId: 'credential-1',
      }),
    ).toEqual({ providerId: 'provider-1', credentialRefId: 'credential-1' });
  });

  it('keeps the credential optional', () => {
    expect(parseProviderBalancePayload({ providerId: 'provider-1' })).toEqual({
      providerId: 'provider-1',
    });
  });

  it('rejects missing or oversized identities', () => {
    expect(() => parseProviderBalancePayload({})).toThrow(/Invalid provider-balance/);
    expect(() =>
      parseProviderBalancePayload({ providerId: 'provider-1', credentialRefId: 'x'.repeat(257) }),
    ).toThrow(/Invalid provider-balance/);
  });
});
