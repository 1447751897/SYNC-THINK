import { describe, expect, it } from 'vitest';
import { resolveWebSearchMode } from './web-search-routing.js';

const base = {
  networkEnabled: true,
  kernelId: 'codex',
  protocol: 'openai-responses' as const,
  baseUrl: 'https://api.openai.com/v1',
  capabilities: ['text', 'web-search'] as const,
  externalProviderConfigured: true,
};

describe('resolveWebSearchMode', () => {
  it('disables every route when the Compose network switch is off', () => {
    expect(resolveWebSearchMode({ ...base, networkEnabled: false })).toBe('disabled');
  });

  it('prefers a supported vendor-native search route', () => {
    expect(resolveWebSearchMode(base)).toBe('native');
    expect(
      resolveWebSearchMode({
        ...base,
        kernelId: 'claude-code',
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
      }),
    ).toBe('native');
    expect(resolveWebSearchMode({ ...base, baseUrl: undefined })).toBe('native');
    expect(
      resolveWebSearchMode({
        ...base,
        kernelId: 'claude-code',
        protocol: 'anthropic-messages',
        baseUrl: undefined,
      }),
    ).toBe('native');
  });

  it('uses external search for unconfirmed models behind a compatible relay', () => {
    expect(resolveWebSearchMode({ ...base, baseUrl: 'https://relay.example/v1' })).toBe('external');
  });

  it('honors an explicitly confirmed hosted-search capability on a relay', () => {
    expect(
      resolveWebSearchMode({
        ...base,
        baseUrl: 'https://relay.example/v1',
        capabilitiesConfirmed: true,
      }),
    ).toBe('native');
  });

  it('falls back to fetch-only when neither native nor external search is available', () => {
    expect(
      resolveWebSearchMode({
        ...base,
        kernelId: 'pi',
        capabilities: ['text'],
        externalProviderConfigured: false,
      }),
    ).toBe('fetch-only');
  });
});
