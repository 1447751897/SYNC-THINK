import { describe, expect, it, vi } from 'vitest';
import {
  addProviderCredentialPayloadFromClipboard,
  createProviderPayloadFromClipboard,
  probeModelsPayloadFromClipboard,
  updateProviderCredentialPayloadFromClipboard,
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

  it('uses a clipboard credential for one ephemeral model probe', () => {
    const readClipboard = vi.fn(() => 'probe-secret');
    expect(
      probeModelsPayloadFromClipboard(
        { baseUrl: 'https://api.example/v1', protocol: 'openai-chat' },
        readClipboard,
      ),
    ).toEqual({
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
      apiKey: 'probe-secret',
    });
    expect(readClipboard).toHaveBeenCalledOnce();
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

  it('keeps credential secrets in main for add and update', () => {
    const addClipboard = vi.fn(() => 'credential-from-clipboard');
    expect(
      addProviderCredentialPayloadFromClipboard(
        { providerId: 'provider-1', label: 'primary' },
        addClipboard,
      ),
    ).toEqual({
      providerId: 'provider-1',
      label: 'primary',
      apiKey: 'credential-from-clipboard',
    });
    expect(addClipboard).toHaveBeenCalledOnce();

    const keepClipboard = vi.fn(() => 'should-not-be-read');
    expect(
      updateProviderCredentialPayloadFromClipboard(
        { providerId: 'provider-1', credentialRefId: 'credential-1', label: 'renamed' },
        keepClipboard,
      ),
    ).not.toHaveProperty('apiKey');
    expect(keepClipboard).not.toHaveBeenCalled();

    const rotateClipboard = vi.fn(() => 'rotated-secret');
    expect(
      updateProviderCredentialPayloadFromClipboard(
        {
          providerId: 'provider-1',
          credentialRefId: 'credential-1',
          rotateCredentialFromClipboard: true,
        },
        rotateClipboard,
      ),
    ).toHaveProperty('apiKey', 'rotated-secret');
    expect(rotateClipboard).toHaveBeenCalledOnce();
  });
});
