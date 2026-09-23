import { describe, expect, it } from 'vitest';
import type { DemoProvider } from './demo-run.js';
import { resolveProviderDiscoveryAdapter } from './provider-discovery-routing.js';

describe('provider discovery routing', () => {
  it('prefers the protocol-specific adapter', () => {
    const fallback = {} as DemoProvider;
    const protocolAdapter = {} as DemoProvider;

    expect(
      resolveProviderDiscoveryAdapter('openai-chat', { 'openai-chat': protocolAdapter }, fallback),
    ).toBe(protocolAdapter);
  });

  it('falls back when no protocol-specific adapter is registered', () => {
    const fallback = {} as DemoProvider;

    expect(resolveProviderDiscoveryAdapter('openai-chat', {}, fallback)).toBe(fallback);
    expect(resolveProviderDiscoveryAdapter('openai-chat', {}, undefined)).toBeUndefined();
  });
});
