import { describe, expect, it, vi } from 'vitest';
import {
  createProviderPayloadFromClipboard,
  updateProviderPayloadFromClipboard,
} from '../src/main/provider-clipboard.js';

describe('provider clipboard payloads', () => {
  const metadata = {
    name: 'Gateway',
    baseUrl: 'https://api.example/v1',
    protocol: 'openai-chat' as const,
    supportsDiscovery: true,
    credentialLabel: 'primary',
  };

  it('reads the create credential exactly once in main', () => {
    const readClipboard = vi.fn(() => 'credential-from-clipboard');
    expect(createProviderPayloadFromClipboard(metadata, readClipboard)).toMatchObject(metadata);
    expect(readClipboard).toHaveBeenCalledTimes(1);
  });

  it('reads only when rotation is requested and fails closed for unusable clipboard values', () => {
    const keepCredential = vi.fn(() => 'should-not-be-read');
    expect(
      updateProviderPayloadFromClipboard(
        { providerId: 'provider-1', name: 'Gateway' },
        keepCredential,
      ),
    ).not.toHaveProperty('apiKey');
    expect(keepCredential).not.toHaveBeenCalled();

    const rotateCredential = vi.fn(() => 'credential-from-clipboard');
    expect(
      updateProviderPayloadFromClipboard(
        { providerId: 'provider-1', rotateCredentialFromClipboard: true },
        rotateCredential,
      ),
    ).toHaveProperty('apiKey', 'credential-from-clipboard');
    expect(rotateCredential).toHaveBeenCalledTimes(1);

    for (const value of ['   ', 'x'.repeat(8193)]) {
      expect(() => createProviderPayloadFromClipboard(metadata, () => value)).toThrow(
        /Provider credential unavailable/,
      );
    }
  });
});
