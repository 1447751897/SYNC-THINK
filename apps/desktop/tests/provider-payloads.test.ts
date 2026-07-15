import { describe, expect, it } from 'vitest';
import {
  parseCreateProviderPayload,
  parseUpdateProviderPayload,
  parseListProvidersPayload,
  parseDiscoverModelsPayload,
  parseAddModelsPayload,
  parseProbeCapabilitiesPayload,
  parseConfirmCapabilitiesPayload,
} from '../src/provider-payloads.js';

describe('provider-payloads', () => {
  it('accepts renderer metadata only and rejects secret or unknown fields', () => {
    const payload = parseCreateProviderPayload({
      name: ' Gateway ',
      baseUrl: ' https://api.example/v1 ',
      protocol: 'openai-chat',
      supportsDiscovery: true,
    });
    expect(payload.name).toBe('Gateway');
    expect(payload.baseUrl).toBe('https://api.example/v1');
    expect(payload).not.toHaveProperty('apiKey');
    expect(() => parseCreateProviderPayload({ ...payload, apiKey: 'not-accepted' })).toThrow(
      /Invalid create-provider/,
    );
    expect(() => parseCreateProviderPayload({ ...payload, unknown: true })).toThrow(
      /Invalid create-provider/,
    );
  });

  it('preserves rotation intent without accepting a renderer secret', () => {
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
    expect(() => parseUpdateProviderPayload({ providerId: 'provider-1', apiKey: 'not-accepted' })).toThrow(
      /Invalid update-provider/,
    );
  });

  it('parses list/discover/add payloads', () => {
    expect(parseListProvidersPayload({})).toEqual({});
    expect(parseDiscoverModelsPayload({ providerId: 'p1' }).providerId).toBe('p1');
    expect(
      parseAddModelsPayload({
        providerId: 'p1',
        protocol: 'openai-chat',
        models: [{ providerModelId: 'm1' }],
      }).models,
    ).toHaveLength(1);
  });

  it('parses probe and confirm capability payloads', () => {
    expect(parseProbeCapabilitiesPayload({ providerId: 'p1' }).providerId).toBe('p1');
    expect(
      parseProbeCapabilitiesPayload({ providerId: 'p1', modelId: 'm1' }).modelId,
    ).toBe('m1');
    const confirmed = parseConfirmCapabilitiesPayload({
      modelId: 'm1',
      capabilities: ['text', 'vision'],
      confirmed: true,
    });
    expect(confirmed.modelId).toBe('m1');
    expect(confirmed.capabilities).toEqual(['text', 'vision']);
    expect(confirmed.confirmed).toBe(true);
    expect(() =>
      parseConfirmCapabilitiesPayload({
        modelId: 'm1',
        capabilities: ['not-a-real-tag'],
      }),
    ).toThrow(/Invalid confirm-capabilities/);
  });
});
