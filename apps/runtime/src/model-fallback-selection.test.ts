import { describe, expect, it, vi } from 'vitest';
import type { AgentModelBinding } from '@sync-think/core';
import type { ModelId } from '@sync-think/shared';
import {
  selectModelFallback,
  type FallbackCatalogModel,
  type FallbackSelectionPorts,
} from './model-fallback-selection.js';

const id = (value: string) => value as ModelId;
const binding: AgentModelBinding = {
  agentVersionId: 'agent' as AgentModelBinding['agentVersionId'],
  defaultModelId: id('a'),
  fallbackModelIds: [id('c')],
  pauseOnFailure: true,
};
const model = (
  name: string,
  providerId = 'provider',
  priority = 0,
  compatible = true,
): FallbackCatalogModel => ({
  id: id(name),
  providerId,
  priority,
  compatible,
});
function fixture(models = [model('a'), model('b', 'provider', 1), model('c', 'other')]) {
  const ports: FallbackSelectionPorts = {
    catalog: {
      getModel: vi.fn((key) => models.find((entry) => entry.id === key)),
      listModels: vi.fn((provider) => models.filter((entry) => entry.providerId === provider)),
    },
    getAgentBinding: vi.fn(() => binding),
    allowsUncataloguedModel: vi.fn(() => true),
  };
  return ports;
}
const input = { modelId: id('a'), failureClass: 'transient' as const };

describe('model fallback selection', () => {
  it('prefers forward provider priority before reading the agent and does not mutate run state', () => {
    const ports = fixture([
      model('b', 'provider', 3),
      model('a', 'provider', 1),
      model('before', 'provider', 0),
    ]);
    const providerFailureCounts = Object.freeze({ provider: 0 });
    const attemptedModelIds = Object.freeze(['old']);
    expect(
      selectModelFallback({ ...input, providerFailureCounts, attemptedModelIds }, ports),
    ).toEqual({
      status: 'selected',
      modelId: 'b',
      source: 'providerFallback',
      fallbackIndex: 2,
      providerFailureCounts: { provider: 1 },
    });
    expect(ports.getAgentBinding).not.toHaveBeenCalled();
    expect(providerFailureCounts.provider).toBe(0);
    expect(attemptedModelIds).toEqual(['old']);
  });
  it('skips attempted and incompatible candidates and then uses the agent chain', () => {
    const ports = fixture([
      model('a'),
      model('image-generator', 'provider', 1, false),
      model('b', 'provider', 2),
      model('c', 'other'),
    ]);
    expect(selectModelFallback({ ...input, attemptedModelIds: ['b'] }, ports)).toMatchObject({
      status: 'selected',
      modelId: 'c',
      source: 'agentFallback',
    });
  });
  it('opens the same-provider circuit after the second endpoint failure', () => {
    const ports = fixture();
    expect(
      selectModelFallback(
        { ...input, providerFailureCounts: { provider: 1 }, fallbackModelIds: ['b', 'c'] },
        ports,
      ),
    ).toMatchObject({ status: 'selected', modelId: 'c', providerFailureCounts: { provider: 2 } });
    expect(ports.catalog?.listModels).not.toHaveBeenCalled();
  });
  it('skips a shared failed local gateway on its first failure', () => {
    expect(
      selectModelFallback(
        {
          ...input,
          errorMessage: 'socket hang up at http://127.0.0.1:8080',
          fallbackModelIds: ['b', 'c'],
        },
        fixture(),
      ),
    ).toMatchObject({ status: 'selected', modelId: 'c', source: 'agentFallback' });
  });
  it('starts the captured fallback chain from the manually selected model', () => {
    expect(
      selectModelFallback({ ...input, modelId: id('manual'), fallbackModelIds: ['c'] }, fixture()),
    ).toMatchObject({ status: 'selected', modelId: 'c', source: 'agentFallback' });
  });
  it('retains legacy agent binding when the run snapshot is empty', () => {
    expect(
      selectModelFallback({ ...input, attemptedModelIds: ['b'], fallbackModelIds: [] }, fixture()),
    ).toMatchObject({ status: 'selected', modelId: 'c' });
  });
  it('pauses with the original reason when all candidates were attempted', () => {
    expect(
      selectModelFallback({ ...input, attemptedModelIds: ['b', 'c'] }, fixture()),
    ).toMatchObject({ status: 'paused', reason: 'fallback_exhausted', failedModelId: 'a' });
  });
  it('preserves no-fallback-configured versus exhausted decisions', () => {
    const ports = fixture([model('a')]);
    ports.getAgentBinding = () => ({ ...binding, fallbackModelIds: [] });
    expect(selectModelFallback(input, ports)).toMatchObject({
      status: 'paused',
      reason: 'no_fallback_configured',
    });
    ports.getAgentBinding = () => ({ ...binding, fallbackModelIds: [], pauseOnFailure: false });
    expect(selectModelFallback(input, ports)).toMatchObject({
      status: 'paused',
      reason: 'no_fallback_configured',
    });
  });
  it('does not consult any routing port for non-retryable failures', () => {
    const ports = fixture();
    expect(selectModelFallback({ ...input, failureClass: 'acceptance' }, ports)).toEqual({
      status: 'failed',
    });
    expect(ports.catalog?.getModel).not.toHaveBeenCalled();
    expect(ports.getAgentBinding).not.toHaveBeenCalled();
  });
  it('uses the supplied vision eligibility for catalog-free fixtures', () => {
    const ports: FallbackSelectionPorts = {
      getAgentBinding: () => binding,
      allowsUncataloguedModel: (key) => key === 'vision',
    };
    expect(
      selectModelFallback({ ...input, fallbackModelIds: ['text', 'vision'] }, ports),
    ).toMatchObject({ status: 'selected', modelId: 'vision', providerFailureCounts: {} });
    expect(selectModelFallback({ ...input, fallbackModelIds: ['text'] }, ports)).toMatchObject({
      status: 'paused',
    });
  });
});
