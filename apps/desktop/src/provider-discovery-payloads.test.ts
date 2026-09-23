import { describe, expect, it } from 'vitest';
import {
  parseConfirmCapabilitiesPayload,
  parseDiscoverModelsPayload,
  parseProbeCapabilitiesPayload,
  parseProbeModelsPayload,
} from './provider-discovery-payloads.js';

describe('Provider Discovery payload validation', () => {
  it('normalizes an ephemeral model probe without accepting extra fields', () => {
    expect(
      parseProbeModelsPayload({
        baseUrl: ' https://api.example/v1 ',
        protocol: 'openai-chat',
      }),
    ).toEqual({ baseUrl: 'https://api.example/v1', protocol: 'openai-chat' });
    expect(() =>
      parseProbeModelsPayload({
        baseUrl: 'https://api.example/v1',
        protocol: 'openai-chat',
        apiKey: 'renderer-secret',
      }),
    ).toThrow(/Invalid probe-models/);
  });

  it('preserves discover options', () => {
    expect(
      parseDiscoverModelsPayload({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
        persist: false,
      }),
    ).toEqual({
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
      persist: false,
    });
  });

  it('preserves single-model and vision-only capability probes', () => {
    expect(
      parseProbeCapabilitiesPayload({
        providerId: 'provider-1',
        modelId: 'model-1',
        visionOnly: true,
      }),
    ).toEqual({ providerId: 'provider-1', modelId: 'model-1', visionOnly: true });
  });

  it('accepts the complete capability vocabulary and manual vision override', () => {
    expect(
      parseConfirmCapabilitiesPayload({
        modelId: 'model-1',
        capabilities: [
          'text',
          'vision',
          'document',
          'video',
          'thinking',
          'tool-calling',
          'web-search',
          'image-generation',
          'embeddings',
        ],
        confirmed: true,
        visionCapabilityOverride: null,
      }),
    ).toMatchObject({
      modelId: 'model-1',
      confirmed: true,
      visionCapabilityOverride: null,
    });
  });

  it('rejects invalid discovery and capability payloads', () => {
    expect(() => parseDiscoverModelsPayload({ providerId: '' })).toThrow(/Invalid discover-models/);
    expect(() => parseProbeCapabilitiesPayload({ providerId: 'provider-1', modelId: '' })).toThrow(
      /Invalid probe-capabilities/,
    );
    expect(() =>
      parseConfirmCapabilitiesPayload({
        modelId: 'model-1',
        capabilities: ['not-a-capability'],
      }),
    ).toThrow(/Invalid confirm-capabilities/);
  });
});
