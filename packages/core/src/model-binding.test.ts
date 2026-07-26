import { describe, expect, it } from 'vitest';
import {
  resolveModelBinding,
  resolveProviderPriorityFallback,
  shouldAttemptFallback,
  type AgentModelBinding,
} from './model-binding.js';
import type { AgentVersionId, ModelId } from '@sync-think/shared';

const agent = (overrides: Partial<AgentModelBinding> = {}): AgentModelBinding => ({
  agentVersionId: 'agent-ver-1' as AgentVersionId,
  defaultModelId: 'model-default' as ModelId,
  fallbackModelIds: ['model-fb-1' as ModelId, 'model-fb-2' as ModelId],
  pauseOnFailure: true,
  ...overrides,
});

describe('resolveModelBinding precedence ?5.3', () => {
  it('uses run override over workflow, default, and fallback', () => {
    const result = resolveModelBinding({
      agent: agent(),
      runModelId: 'model-run' as ModelId,
      workflowNodeModelId: 'model-wf' as ModelId,
    });
    expect(result).toMatchObject({
      status: 'resolved',
      modelId: 'model-run',
      source: 'runOverride',
    });
  });

  it('uses workflow node when run override absent', () => {
    const result = resolveModelBinding({
      agent: agent(),
      workflowNodeModelId: 'model-wf' as ModelId,
    });
    expect(result).toMatchObject({
      status: 'resolved',
      modelId: 'model-wf',
      source: 'workflowNode',
    });
  });

  it('uses agent default when no overrides', () => {
    const result = resolveModelBinding({ agent: agent() });
    expect(result).toMatchObject({
      status: 'resolved',
      modelId: 'model-default',
      source: 'agentDefault',
    });
  });

  it('returns unresolved when default missing', () => {
    const result = resolveModelBinding({
      agent: agent({ defaultModelId: '' as ModelId, fallbackModelIds: [] }),
    });
    expect(result).toMatchObject({ status: 'unresolved', reason: 'missing_default' });
  });

  it('walks fallback after default fails', () => {
    const result = resolveModelBinding({
      agent: agent(),
      failedModelId: 'model-default' as ModelId,
      failureClass: 'timeout',
    });
    expect(result).toMatchObject({
      status: 'resolved',
      modelId: 'model-fb-1',
      source: 'agentFallback',
      fallbackIndex: 0,
    });
  });

  it('walks to second fallback after first fails', () => {
    const result = resolveModelBinding({
      agent: agent(),
      failedModelId: 'model-fb-1' as ModelId,
      failureClass: 'rate-limit',
    });
    expect(result).toMatchObject({
      status: 'resolved',
      modelId: 'model-fb-2',
      source: 'agentFallback',
      fallbackIndex: 1,
    });
  });

  it('pauses when fallback exhausted', () => {
    const result = resolveModelBinding({
      agent: agent(),
      failedModelId: 'model-fb-2' as ModelId,
      failureClass: 'auth',
    });
    expect(result).toMatchObject({
      status: 'paused',
      reason: 'fallback_exhausted',
      failedModelId: 'model-fb-2',
    });
  });

  it('pauses without silent substitution when no fallback configured', () => {
    const result = resolveModelBinding({
      agent: agent({ fallbackModelIds: [], pauseOnFailure: true }),
      failedModelId: 'model-default' as ModelId,
      failureClass: 'timeout',
    });
    expect(result).toMatchObject({
      status: 'paused',
      reason: 'no_fallback_configured',
    });
  });

  it('never silently swaps model after failure without fallback even if pauseOnFailure false', () => {
    const result = resolveModelBinding({
      agent: agent({ fallbackModelIds: [], pauseOnFailure: false }),
      failedModelId: 'model-default' as ModelId,
      failureClass: 'rate-limit',
    });
    expect(result.status).toBe('paused');
    if (result.status === 'resolved') {
      throw new Error('must not resolve another model without fallback chain');
    }
  });
});

describe('shouldAttemptFallback', () => {
  it('allows timeout/auth/rate-limit', () => {
    expect(shouldAttemptFallback('timeout')).toBe(true);
    expect(shouldAttemptFallback('auth')).toBe(true);
    expect(shouldAttemptFallback('rate-limit')).toBe(true);
  });

  it('blocks acceptance and permission', () => {
    expect(shouldAttemptFallback('acceptance')).toBe(false);
    expect(shouldAttemptFallback('permission')).toBe(false);
  });
});

describe('resolveProviderPriorityFallback', () => {
  const chain = [
    'model-5.6' as ModelId,
    'model-5.5' as ModelId,
    'model-5.4' as ModelId,
  ];

  it('walks forward from primary to spare-1', () => {
    expect(
      resolveProviderPriorityFallback({
        orderedModelIds: chain,
        failedModelId: 'model-5.6' as ModelId,
      }),
    ).toEqual({ modelId: 'model-5.5', fallbackIndex: 1 });
  });

  it('walks from spare-1 to spare-2 without returning to primary', () => {
    expect(
      resolveProviderPriorityFallback({
        orderedModelIds: chain,
        failedModelId: 'model-5.5' as ModelId,
      }),
    ).toEqual({ modelId: 'model-5.4', fallbackIndex: 2 });
  });

  it('returns null when the last spare fails', () => {
    expect(
      resolveProviderPriorityFallback({
        orderedModelIds: chain,
        failedModelId: 'model-5.4' as ModelId,
      }),
    ).toBeNull();
  });

  it('returns null for models not in the chain', () => {
    expect(
      resolveProviderPriorityFallback({
        orderedModelIds: chain,
        failedModelId: 'model-other' as ModelId,
      }),
    ).toBeNull();
  });
});
