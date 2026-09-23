import { describe, expect, it } from 'vitest';
import {
  parseCreateProviderPayload,
  parseDeleteProviderPayload,
  parseListProvidersPayload,
  parseReorderProvidersPayload,
  parseUpdateProviderPayload,
} from './provider-catalog-payloads.js';

describe('Provider Catalog payload validation', () => {
  it('accepts renderer create metadata without a secret', () => {
    const payload = parseCreateProviderPayload({
      name: ' Gateway ',
      baseUrl: ' https://api.example/v1 ',
      protocol: 'openai-chat',
      supportsDiscovery: true,
      discoverOnCreate: false,
    });
    expect(payload).toMatchObject({
      name: 'Gateway',
      baseUrl: 'https://api.example/v1',
      discoverOnCreate: false,
    });
    expect(payload).not.toHaveProperty('apiKey');
  });

  it('rejects secrets and unknown create fields', () => {
    const payload = {
      name: 'Gateway',
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
    };
    expect(() => parseCreateProviderPayload({ ...payload, apiKey: 'not-accepted' })).toThrow(
      /Invalid create-provider/,
    );
    expect(() => parseCreateProviderPayload({ ...payload, unknown: true })).toThrow(
      /Invalid create-provider/,
    );
  });

  it('preserves update rotation intent without accepting a renderer secret', () => {
    expect(
      parseUpdateProviderPayload({
        providerId: 'provider-1',
        credentialLabel: 'rotated',
        rotateCredentialFromClipboard: true,
      }),
    ).toMatchObject({
      providerId: 'provider-1',
      credentialLabel: 'rotated',
      rotateCredentialFromClipboard: true,
    });
    expect(() =>
      parseUpdateProviderPayload({ providerId: 'provider-1', apiKey: 'not-accepted' }),
    ).toThrow(/Invalid update-provider/);
  });

  it('preserves the existing unfiltered list payload behavior', () => {
    expect(parseListProvidersPayload(undefined)).toEqual({});
    expect(parseListProvidersPayload({ futureFilter: true })).toEqual({});
  });

  it('normalizes reorder and delete identifiers', () => {
    expect(parseReorderProvidersPayload({ orderedProviderIds: [' p2 ', 'p1'] })).toEqual({
      orderedProviderIds: ['p2', 'p1'],
    });
    expect(parseDeleteProviderPayload({ providerId: ' p1 ' })).toEqual({ providerId: 'p1' });
  });

  it('rejects duplicate order entries and invalid delete payloads', () => {
    expect(() => parseReorderProvidersPayload({ orderedProviderIds: ['p1', 'p1'] })).toThrow(
      /Invalid reorder-providers/,
    );
    expect(() => parseDeleteProviderPayload({ providerId: '' })).toThrow(/Invalid delete-provider/);
  });
});
