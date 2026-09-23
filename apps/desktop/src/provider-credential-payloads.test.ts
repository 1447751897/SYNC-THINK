import { describe, expect, it } from 'vitest';
import {
  parseAddProviderCredentialMetadata,
  parseClearProviderCredentialsPayload,
  parseRemoveProviderCredentialPayload,
  parseRevealProviderCredentialPayload,
  parseUpdateProviderCredentialMetadata,
} from './provider-credential-payloads.js';

describe('provider credential payloads', () => {
  it('normalizes add metadata without accepting a renderer secret', () => {
    expect(
      parseAddProviderCredentialMetadata({ providerId: ' provider-1 ', label: ' primary ' }),
    ).toEqual({ providerId: 'provider-1', label: 'primary' });
    expect(() =>
      parseAddProviderCredentialMetadata({ providerId: 'provider-1', apiKey: 'secret' }),
    ).toThrow(/Invalid add-provider-credential/);
  });

  it('normalizes remove and reveal identities', () => {
    const value = { providerId: ' provider-1 ', credentialRefId: ' credential-1 ' };
    expect(parseRemoveProviderCredentialPayload(value)).toEqual({
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
    });
    expect(parseRevealProviderCredentialPayload(value)).toEqual({
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
    });
  });

  it('normalizes the clear identity', () => {
    expect(parseClearProviderCredentialsPayload({ providerId: ' provider-1 ' })).toEqual({
      providerId: 'provider-1',
    });
  });

  it('accepts label-only and clipboard-rotation updates', () => {
    expect(
      parseUpdateProviderCredentialMetadata({
        providerId: ' provider-1 ',
        credentialRefId: ' credential-1 ',
        label: ' rotated ',
      }),
    ).toEqual({
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
      label: 'rotated',
      rotateCredentialFromClipboard: undefined,
    });
    expect(
      parseUpdateProviderCredentialMetadata({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
        rotateCredentialFromClipboard: true,
      }),
    ).toMatchObject({ rotateCredentialFromClipboard: true });
  });

  it('rejects empty updates, renderer secrets and invalid identities', () => {
    expect(() =>
      parseUpdateProviderCredentialMetadata({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
      }),
    ).toThrow(/Invalid update-provider-credential/);
    expect(() =>
      parseUpdateProviderCredentialMetadata({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
        apiKey: 'secret',
      }),
    ).toThrow(/Invalid update-provider-credential/);
    expect(() => parseClearProviderCredentialsPayload({ providerId: ' ' })).toThrow(
      /Invalid clear-provider-credentials/,
    );
  });
});
