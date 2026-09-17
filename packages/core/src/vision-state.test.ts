import { describe, expect, it } from 'vitest';

import {
  applyProviderCapabilityManualOverrides,
  getKnownModelVisionSupport,
  getKnownVisionSupport,
  getModelCapabilities,
  getReliableImageCapability,
  isGpt6AstraModel,
  resolveVerifiedFallbackVisionState,
  resolveVisionState,
} from './vision-state.js';

describe('getKnownModelVisionSupport', () => {
  it('pins gpt-6-astra as multimodal by name, without a probe', () => {
    expect(getKnownModelVisionSupport('gpt-6-astra')).toBe(true);
    expect(getKnownModelVisionSupport('openai/gpt-6-astra')).toBe(true);
    expect(getKnownModelVisionSupport('gpt-6-astra-preview')).toBe(true);
    expect(isGpt6AstraModel('gpt-6-astra')).toBe(true);
  });

  it('classifies known text-only families as unsupported', () => {
    expect(getKnownModelVisionSupport('deepseek-v4-flash')).toBe(false);
    expect(getKnownModelVisionSupport('deepseek-v4-pro')).toBe(false);
    expect(getKnownModelVisionSupport('gpt-5.3-codex-spark')).toBe(false);
    expect(getKnownModelVisionSupport('gpt-oss-120b-medium')).toBe(false);
    expect(getKnownModelVisionSupport('gemini-3.5-flash-extra-low')).toBe(false);
  });

  it('classifies common multimodal families as supported', () => {
    expect(getKnownModelVisionSupport('claude-sonnet-4-6')).toBe(true);
    expect(getKnownModelVisionSupport('gemini-3-flash-agent')).toBe(true);
    expect(getKnownModelVisionSupport('qwen3-vl-8b')).toBe(true);
    expect(getKnownModelVisionSupport('deepseek-v4-flash-vision-exp')).toBe(true);
  });

  it('returns null (not false) when the name carries no signal', () => {
    expect(getKnownModelVisionSupport('brand-new-model-x')).toBeNull();
    expect(getKnownModelVisionSupport('')).toBeNull();
  });

  it('scopes the per-provider tables to their own provider', () => {
    expect(getKnownVisionSupport('deepseek', 'deepseek-v4-pro')).toBe(false);
    expect(getKnownVisionSupport('openai-oauth', 'gpt-6-astra')).toBe(true);
    // Same model id, no provider context -> falls back to the name table.
    expect(getKnownVisionSupport(undefined, 'vendor-mystery-3')).toBeNull();
  });
});

describe('getReliableImageCapability', () => {
  it('lets a manual override outrank every probe result', () => {
    expect(
      getReliableImageCapability({
        image: false,
        reasons: { image: '未识别测试图中的数字' },
        manualOverrides: { image: true },
      }),
    ).toBe(true);
    expect(
      getReliableImageCapability({
        image: true,
        manualOverrides: { image: false },
      }),
    ).toBe(false);
  });

  it('returns the recorded probe image flag when it is not a definite negative', () => {
    expect(getReliableImageCapability({ image: true })).toBe(true);
    expect(getReliableImageCapability({})).toBeUndefined();
    expect(getReliableImageCapability(undefined)).toBeUndefined();
  });

  it('refuses to trust a negative when the probe never reached the provider', () => {
    // These strings are NewMax's own probe-failure copy — the regex is written
    // against exactly these, not against arbitrary transport error text.
    expect(
      getReliableImageCapability({ image: false, reasons: { image: '网络异常' } }),
    ).toBeUndefined();
    expect(
      getReliableImageCapability({
        image: false,
        reasons: { image: '探测请求被拒绝 (HTTP 403)' },
      }),
    ).toBeUndefined();
    expect(
      getReliableImageCapability({ image: false, reasons: { image: 'API 密钥无效' } }),
    ).toBeUndefined();
    expect(
      getReliableImageCapability({ image: false, reasons: { image: 'rate limit exceeded' } }),
    ).toBeUndefined();
    expect(
      getReliableImageCapability({ image: false, reasons: { image: 'request timed out' } }),
    ).toBeUndefined();
  });

  it('trusts a negative when the model itself refused the image', () => {
    expect(
      getReliableImageCapability({
        image: false,
        reasons: { image: '未识别测试图中的数字' },
      }),
    ).toBe(false);
    // No reason recorded at all still counts as a definite negative.
    expect(getReliableImageCapability({ image: false })).toBe(false);
  });
});

describe('applyProviderCapabilityManualOverrides / getModelCapabilities', () => {
  it('replays manualOverrides on every read so a rescan cannot wipe them', () => {
    const replayed = applyProviderCapabilityManualOverrides({
      image: false,
      manualOverrides: { image: true },
    });
    expect(replayed?.image).toBe(true);
    expect(replayed?.manualOverrides).toEqual({ image: true });
  });

  it('drops reasoning when the manual override disables thinking', () => {
    expect(
      applyProviderCapabilityManualOverrides({ reasoning: true, manualOverrides: { thinking: false } })
        ?.reasoning,
    ).toBeUndefined();
  });

  it('keeps contextWindow out of the capability bits', () => {
    const replayed = applyProviderCapabilityManualOverrides({
      image: false,
      manualOverrides: { contextWindow: 128_000 },
    });
    expect(replayed?.image).toBe(false);
    expect(replayed?.contextWindow).toBeUndefined();
  });

  it('prefers the per-model entry over the provider default', () => {
    expect(
      getModelCapabilities(
        { id: 'p', capabilities: { image: false }, modelCapabilities: { m: { image: true } } },
        'm',
      )?.image,
    ).toBe(true);
    expect(getModelCapabilities({ id: 'p', capabilities: { image: true } }, 'm')?.image).toBe(true);
    expect(getModelCapabilities(undefined, 'm')).toBeUndefined();
  });

  it('refuses to infer capabilities for an unverified grok-oauth model', () => {
    expect(getModelCapabilities({ id: 'grok-oauth', capabilities: { image: true } }, 'x-ai/grok-9')).toBeUndefined();
    expect(getModelCapabilities({ id: 'grok-oauth', capabilities: { image: true } }, 'x-ai/grok-4.5')).toBeTruthy();
  });
});

describe('resolveVisionState', () => {
  it('marks gpt-6-astra supported even when the probe failed with a network error', () => {
    // This is the regression that pushed a multimodal model onto Windows OCR:
    // the probe could not reach the provider, so the negative is not trusted
    // and the known-support table answers instead.
    expect(
      resolveVisionState(
        { id: 'cuitaliao-gpt', capabilities: { image: false, reasons: { image: '网络异常' } } },
        'cuitaliao-gpt',
        'gpt-6-astra',
      ),
    ).toBe('supported');
  });

  it('keeps an unreachable provider at unknown instead of unsupported', () => {
    expect(
      resolveVisionState(
        { id: 'some-relay', capabilities: { image: false, reasons: { image: '网络异常' } } },
        'some-relay',
        'vendor-mystery-1',
      ),
    ).toBe('unknown');
  });

  it('reports unsupported when the model itself refused the image', () => {
    expect(
      resolveVisionState(
        { id: 'vendor', capabilities: { image: false, reasons: { image: '未识别测试图中的数字' } } },
        'vendor',
        'vendor-model-1',
      ),
    ).toBe('unsupported');
  });

  it('reports unsupported for a known text-only model', () => {
    expect(resolveVisionState(undefined, 'deepseek', 'deepseek-v4-flash')).toBe('unsupported');
  });

  it('reports supported from a positive image result', () => {
    expect(resolveVisionState({ id: 'vendor', capabilities: { image: true } }, 'vendor', 'whatever')).toBe(
      'supported',
    );
  });

  it('treats the built-in Claude channel as a trusted native vision provider', () => {
    expect(resolveVisionState(undefined, 'default', 'anything')).toBe('supported');
  });

  it('stays unknown for a model that no table knows and no probe touched', () => {
    expect(resolveVisionState(undefined, 'vendor', 'vendor-mystery-2')).toBe('unknown');
  });
});

describe('resolveVerifiedFallbackVisionState', () => {
  it('trusts the built-in Claude channel without a probe', () => {
    expect(resolveVerifiedFallbackVisionState(undefined, 'default', 'anything')).toBe('supported');
  });

  it('only accepts a positively verified model, never a name-table guess', () => {
    // A known-multimodal name is not enough here: the fallback must have its
    // own confirmed result, because the question is "can this channel see".
    expect(resolveVerifiedFallbackVisionState(undefined, 'p', 'gpt-6-astra')).toBe('unknown');
    expect(
      resolveVerifiedFallbackVisionState(
        { id: 'p', modelCapabilities: { m: { image: true } } },
        'p',
        'm',
      ),
    ).toBe('supported');
    expect(
      resolveVerifiedFallbackVisionState(
        { id: 'p', modelCapabilities: { m: { image: false, reasons: { image: '未识别测试图中的数字' } } } },
        'p',
        'm',
      ),
    ).toBe('unsupported');
  });

  it('reads the per-model entry only, never the provider default', () => {
    // NewMax's verified-fallback answer belongs to one specific model; a
    // provider-level default must not answer on its behalf.
    expect(
      resolveVerifiedFallbackVisionState({ id: 'p', capabilities: { image: true } }, 'p', 'm'),
    ).toBe('unknown');
  });

  it('stays unknown when the probe never reached the provider', () => {
    expect(
      resolveVerifiedFallbackVisionState(
        { id: 'p', modelCapabilities: { m: { image: false, reasons: { image: '网络异常' } } } },
        'p',
        'm',
      ),
    ).toBe('unknown');
  });
});
