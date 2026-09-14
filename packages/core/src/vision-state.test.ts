import { describe, expect, it } from 'vitest';

import {
  classifyVisionProbeFailure,
  getKnownModelVisionSupport,
  getKnownVisionSupport,
  getReliableImageCapability,
  isGpt6AstraModel,
  isVisionProbeFailureEnvironmental,
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
});

describe('isVisionProbeFailureEnvironmental', () => {
  it('treats transport/auth/quota failures as environmental', () => {
    expect(isVisionProbeFailureEnvironmental('fetch failed')).toBe(true);
    expect(isVisionProbeFailureEnvironmental('Provider Responses network error: fetch failed')).toBe(
      true,
    );
    expect(isVisionProbeFailureEnvironmental('探测请求被拒绝 (HTTP 403)')).toBe(true);
    expect(isVisionProbeFailureEnvironmental('API 密钥无效')).toBe(true);
    expect(isVisionProbeFailureEnvironmental('rate limit exceeded')).toBe(true);
    expect(isVisionProbeFailureEnvironmental('request timeout')).toBe(true);
  });

  it('treats an actual model refusal as capability-level', () => {
    expect(isVisionProbeFailureEnvironmental('未识别测试图中的数字')).toBe(false);
    expect(isVisionProbeFailureEnvironmental('')).toBe(false);
  });
});

describe('classifyVisionProbeFailure', () => {
  it('maps reasons onto the NewMax failure taxonomy', () => {
    expect(classifyVisionProbeFailure('API 密钥无效')).toBe('authentication');
    expect(classifyVisionProbeFailure('rate limit exceeded')).toBe('rateLimit');
    expect(classifyVisionProbeFailure('request timeout')).toBe('timeout');
    expect(classifyVisionProbeFailure('network error: fetch failed')).toBe('network');
    expect(classifyVisionProbeFailure('未识别测试图中的数字')).toBe('responseMismatch');
    expect(classifyVisionProbeFailure('model does not support image input')).toBe('unsupported');
  });
});

describe('getReliableImageCapability', () => {
  it('lets a manual override outrank every probe', () => {
    expect(
      getReliableImageCapability({
        providerModelId: 'anything',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        manualOverride: true,
      }),
    ).toBe(true);
    expect(
      getReliableImageCapability({
        providerModelId: 'anything',
        capabilities: ['text', 'vision'],
        manualOverride: false,
      }),
    ).toBe(false);
  });

  it('refuses to trust a confirmed negative when the probe was an env failure', () => {
    expect(
      getReliableImageCapability({
        providerModelId: 'gpt-6-astra',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        probeReason: 'Provider Responses network error: fetch failed',
      }),
    ).toBeUndefined();
  });

  it('trusts a confirmed negative when the model itself refused', () => {
    expect(
      getReliableImageCapability({
        providerModelId: 'some-text-model',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        probeReason: '未识别测试图中的数字',
      }),
    ).toBe(false);
  });
});

describe('resolveVisionState', () => {
  it('marks gpt-6-astra supported even when the probe failed with a network error', () => {
    // This is the regression that pushed a multimodal model onto Windows OCR:
    // the probe could not reach the provider, so `vision` was never tagged.
    expect(
      resolveVisionState({
        providerId: 'cuitaliao-gpt',
        providerModelId: 'gpt-6-astra',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        probeReason: 'Provider Responses network error: fetch failed',
      }),
    ).toBe('supported');
  });

  it('keeps an unreachable provider at unknown instead of unsupported', () => {
    expect(
      resolveVisionState({
        providerId: 'some-relay',
        providerModelId: 'vendor-mystery-1',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        probeReason: 'fetch failed',
      }),
    ).toBe('unknown');
  });

  it('reports unsupported for a known text-only model', () => {
    expect(
      resolveVisionState({
        providerModelId: 'deepseek-v4-flash',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe('unsupported');
  });

  it('reports supported from a confirmed vision tag', () => {
    expect(
      resolveVisionState({
        providerModelId: 'whatever',
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: true,
      }),
    ).toBe('supported');
  });

  it('does not treat an unconfirmed vision suggestion as a verified result', () => {
    expect(
      resolveVisionState({
        providerModelId: 'vendor-model',
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: false,
      }),
    ).toBe('unknown');
  });

  it('uses the persisted per-dimension probe result', () => {
    expect(
      resolveVisionState({
        providerModelId: 'vendor-model',
        capabilities: ['text'],
        capabilitiesConfirmed: false,
        visionCapability: true,
      }),
    ).toBe('supported');
    expect(
      resolveVisionState({
        providerModelId: 'vendor-model',
        capabilities: ['text'],
        capabilitiesConfirmed: false,
        visionCapability: false,
        probeReason: '未识别测试图中的数字',
      }),
    ).toBe('unsupported');
  });

  it('stays unknown for an unconfirmed model that no table knows', () => {
    expect(
      resolveVisionState({ providerModelId: 'vendor-mystery-2', capabilities: [] }),
    ).toBe('unknown');
  });

  it('scopes the per-provider tables to their own provider', () => {
    expect(getKnownVisionSupport('deepseek', 'deepseek-v4-pro')).toBe(false);
    expect(getKnownVisionSupport('openai-oauth', 'gpt-6-astra')).toBe(true);
    // Same model id, no provider context -> falls back to the name table.
    expect(getKnownVisionSupport(undefined, 'vendor-mystery-3')).toBeNull();
  });
});
