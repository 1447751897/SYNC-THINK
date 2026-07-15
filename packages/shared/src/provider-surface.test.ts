import { describe, it, expect } from 'vitest';
import {
  defaultSurfaceForProtocol,
  inferProviderSurface,
  PROVIDER_SURFACE_LABELS,
  PROVIDER_SURFACE_ORDER,
  surfaceFromCcSwitchAppType,
} from './provider-surface.js';

describe('provider-surface', () => {
  it('orders surfaces like CC Switch apps', () => {
    expect([...PROVIDER_SURFACE_ORDER]).toEqual(['codex', 'claude', 'kiro', 'gemini', 'generic']);
    expect(PROVIDER_SURFACE_LABELS.claude).toBe('Claude Code');
    expect(PROVIDER_SURFACE_LABELS.codex).toBe('Codex');
    expect(PROVIDER_SURFACE_LABELS.kiro).toBe('Kiro');
  });

  it('maps cc-switch app_type', () => {
    expect(surfaceFromCcSwitchAppType('codex')).toBe('codex');
    expect(surfaceFromCcSwitchAppType('claude')).toBe('claude');
    expect(surfaceFromCcSwitchAppType('claude-code')).toBe('claude');
    expect(surfaceFromCcSwitchAppType('kiro')).toBe('kiro');
    expect(surfaceFromCcSwitchAppType('gemini')).toBe('gemini');
    expect(surfaceFromCcSwitchAppType('unknown')).toBe('generic');
  });

  it('does not trust stored generic — re-infers from protocol/name', () => {
    expect(
      inferProviderSurface({
        surface: 'generic',
        protocol: 'openai-responses',
        name: 'KMKAPI-GROK',
      }),
    ).toBe('codex');
    expect(
      inferProviderSurface({
        surface: 'generic',
        protocol: 'anthropic-messages',
        name: 'Unity2.Ai',
      }),
    ).toBe('claude');
    expect(
      inferProviderSurface({
        surface: 'generic',
        protocol: 'openai-chat',
        name: 'codex',
      }),
    ).toBe('codex');
    expect(
      inferProviderSurface({
        surface: 'generic',
        protocol: 'openai-chat',
        name: 'Kiro Gateway',
      }),
    ).toBe('kiro');
  });

  it('trusts explicit non-generic surface', () => {
    expect(
      inferProviderSurface({
        surface: 'claude',
        protocol: 'openai-responses',
        name: 'anything',
      }),
    ).toBe('claude');
  });

  it('defaults protocol surfaces', () => {
    expect(defaultSurfaceForProtocol('openai-responses')).toBe('codex');
    expect(defaultSurfaceForProtocol('anthropic-messages')).toBe('claude');
    expect(defaultSurfaceForProtocol('openai-chat')).toBe('generic');
  });
});
