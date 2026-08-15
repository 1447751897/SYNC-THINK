import { describe, it, expect } from 'vitest';
import { resolveGatewayModelName, type GatewayCatalogEntry } from './model-resolver.js';

function entry(overrides: Partial<GatewayCatalogEntry> = {}): GatewayCatalogEntry {
  return {
    providerId: 'prov-a',
    providerName: 'Relay A',
    sortOrder: 0,
    baseUrl: 'https://a.example.com/v1',
    protocol: 'openai-chat',
    providerModelId: 'gpt-5.6-sol',
    modelId: 'model-a',
    enabled: true,
    ...overrides,
  };
}

describe('resolveGatewayModelName', () => {
  it('resolves a unique model name to its provider', () => {
    const match = resolveGatewayModelName('gpt-5.6-sol', [entry()]);
    expect(match?.route).toEqual({
      baseUrl: 'https://a.example.com/v1',
      protocol: 'openai-chat',
      providerModelId: 'gpt-5.6-sol',
      providerId: 'prov-a',
    });
    expect(match?.shadowedBy).toEqual([]);
  });

  it('matches the internal catalog model id too', () => {
    expect(resolveGatewayModelName('model-a', [entry()])?.route.providerId).toBe('prov-a');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveGatewayModelName('  GPT-5.6-SOL ', [entry()])?.route.providerId).toBe('prov-a');
  });

  it('resolves a name collision by the lowest sortOrder (no configured default)', () => {
    const entries = [
      entry({ providerId: 'prov-b', providerName: 'Relay B', sortOrder: 1, baseUrl: 'https://b/v1' }),
      entry({ providerId: 'prov-a', sortOrder: 0 }),
    ];
    const match = resolveGatewayModelName('gpt-5.6-sol', entries);
    expect(match?.route.providerId).toBe('prov-a');
    // The loser is reported so the settings UI can warn instead of silently guessing.
    expect(match?.shadowedBy).toEqual([{ providerId: 'prov-b', providerName: 'Relay B' }]);
  });

  it('falls back to the lowest sortOrder deterministically', () => {
    const entries = [
      entry({ providerId: 'prov-b', providerName: 'Relay B', sortOrder: 5 }),
      entry({ providerId: 'prov-a', providerName: 'Relay A', sortOrder: 2 }),
    ];
    const match = resolveGatewayModelName('gpt-5.6-sol', entries);
    expect(match?.route.providerId).toBe('prov-a');
    expect(match?.shadowedBy).toEqual([{ providerId: 'prov-b', providerName: 'Relay B' }]);
  });

  it('breaks a sortOrder tie deterministically by provider id', () => {
    const entries = [
      entry({ providerId: 'prov-z', sortOrder: 0 }),
      entry({ providerId: 'prov-a', sortOrder: 0 }),
    ];
    expect(resolveGatewayModelName('gpt-5.6-sol', entries)?.route.providerId).toBe('prov-a');
    // Same input, same answer — routing must never be order-dependent.
    expect(resolveGatewayModelName('gpt-5.6-sol', [...entries].reverse())?.route.providerId).toBe(
      'prov-a',
    );
  });

  it('keeps the deterministic winner on a single candidate', () => {
    const entries = [entry({ providerId: 'prov-a', sortOrder: 3 })];
    expect(resolveGatewayModelName('gpt-5.6-sol', entries)?.route.providerId).toBe('prov-a');
  });

  it('skips disabled providers, unsupported protocols and empty base URLs', () => {
    expect(resolveGatewayModelName('gpt-5.6-sol', [entry({ enabled: false })])).toBeUndefined();
    expect(
      resolveGatewayModelName('gpt-5.6-sol', [entry({ protocol: 'openai-images' })]),
    ).toBeUndefined();
    expect(resolveGatewayModelName('gpt-5.6-sol', [entry({ baseUrl: '  ' })])).toBeUndefined();
  });

  it('keeps the openai-responses dialect distinct from chat', () => {
    expect(
      resolveGatewayModelName('gpt-5.6-sol', [entry({ protocol: 'openai-responses' })])?.route
        .protocol,
    ).toBe('openai-responses');
  });

  it('returns undefined for unknown or empty names', () => {
    expect(resolveGatewayModelName('nope', [entry()])).toBeUndefined();
    expect(resolveGatewayModelName('   ', [entry()])).toBeUndefined();
  });
});
