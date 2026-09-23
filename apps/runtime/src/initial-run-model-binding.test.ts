import { describe, expect, it, vi } from 'vitest';
import type { AgentModelBinding } from '@sync-think/core';
import type {
  CredentialGroupId,
  CredentialRefId,
  ModelId,
  ProviderId,
} from '@sync-think/shared';
import {
  resolveInitialRunModelBinding,
  type RunBindingCatalog,
  type RunBindingCredential,
  type RunBindingModel,
} from './initial-run-model-binding.js';

const modelId = (value: string) => value as ModelId;
const providerId = (value: string) => value as ProviderId;
const credential = (id: string, group = 'group-a'): RunBindingCredential => ({
  id: id as CredentialRefId,
  credentialGroupId: group as CredentialGroupId,
});
const model = (
  id: string,
  providerModelId = id,
  provider = 'provider-a',
  limitsJson?: string,
): RunBindingModel => ({
  id: modelId(id),
  providerId: providerId(provider),
  providerModelId,
  protocol: 'openai-chat',
  ...(limitsJson ? { limitsJson } : {}),
});
const agent: AgentModelBinding = {
  agentVersionId: 'agent-1' as AgentModelBinding['agentVersionId'],
  defaultModelId: modelId('default-model'),
  fallbackModelIds: [],
  pauseOnFailure: true,
};

function fixture(entries: RunBindingModel[] = [model('default-model')]) {
  const credentials = [credential('run-key'), credential('primary-key')];
  const catalog: RunBindingCatalog = {
    getModel: vi.fn((id) => entries.find((entry) => entry.id === id)),
    listProviderIds: vi.fn(() => [providerId('provider-a'), providerId('provider-b')]),
    findModelByProviderModelId: vi.fn((provider, id) =>
      entries.find((entry) => entry.providerId === provider && entry.providerModelId === id),
    ),
    getProvider: vi.fn((id) => ({ id, baseUrl: `https://${id}.example/v1` })),
    getCredentialRef: vi.fn((id) => credentials.find((item) => item.id === id)),
    getFirstCredentialInGroup: vi.fn(() => undefined),
    getPrimaryCredentialRef: vi.fn(() => credentials[1]),
    getProviderIdForCredentialGroup: vi.fn(() => 'provider-a'),
  };
  return catalog;
}

describe('initial run model binding', () => {
  it('binds a catalog model, explicit credential, provider metadata and context window', () => {
    const catalog = fixture([
      model('default-model'),
      model('selected', 'upstream-selected', 'provider-a', '{"contextWindow":200000.4}'),
    ]);
    expect(
      resolveInitialRunModelBinding(
        { agent, requestedModelId: 'selected', runCredentialRefId: 'run-key' },
        { catalog, secureStoreAvailable: true },
      ),
    ).toMatchObject({
      modelId: 'selected',
      resolutionSource: 'runOverride',
      provider: { id: 'provider-a', baseUrl: 'https://provider-a.example/v1' },
      credential: { id: 'run-key' },
      credentialResolutionSource: 'runOverride',
      useFakeProvider: false,
      modelContextWindow: 200_000,
      contextWindowEstimated: false,
    });
  });

  it('maps a requested provider model id across providers', () => {
    const catalog = fixture([model('catalog-id', 'vendor/model', 'provider-b')]);
    expect(
      resolveInitialRunModelBinding(
        { agent, requestedModelId: 'vendor/model' },
        { catalog, secureStoreAvailable: true },
      ),
    ).toMatchObject({
      modelId: 'catalog-id',
      resolutionSource: 'runOverride',
      provider: { id: 'provider-b' },
    });
    expect(catalog.findModelByProviderModelId).toHaveBeenCalledTimes(2);
  });

  it('lets the plan/act route replace a manual model and maps its provider id', () => {
    const catalog = fixture([
      model('manual'),
      model('plan-catalog', 'vendor/plan', 'provider-b'),
    ]);
    expect(
      resolveInitialRunModelBinding(
        {
          agent,
          requestedModelId: 'manual',
          planActRoute: { applied: true, modelId: 'vendor/plan' },
        },
        { catalog, secureStoreAvailable: true },
      ),
    ).toMatchObject({ modelId: 'plan-catalog', resolutionSource: 'planAct' });
  });

  it('uses the agent default and stable metadata fallbacks without a catalog', () => {
    expect(
      resolveInitialRunModelBinding(
        { agent },
        { catalog: undefined, secureStoreAvailable: false },
      ),
    ).toEqual({
      modelId: 'default-model',
      resolutionSource: 'agentDefault',
      model: undefined,
      provider: undefined,
      credential: undefined,
      credentialResolutionSource: 'none',
      useFakeProvider: true,
      modelContextWindow: 128_000,
      contextWindowEstimated: true,
    });
  });

  it('retains live metadata but selects fake execution when secure storage is absent', () => {
    expect(
      resolveInitialRunModelBinding(
        { agent },
        { catalog: fixture(), secureStoreAvailable: false },
      ),
    ).toMatchObject({
      modelId: 'default-model',
      provider: { id: 'provider-a' },
      useFakeProvider: true,
    });
  });

  it.each(['not json', '{"contextWindow":0}', '{"contextWindow":"large"}'])(
    'falls back for invalid model limits: %s',
    (limitsJson) => {
      expect(
        resolveInitialRunModelBinding(
          { agent },
          { catalog: fixture([model('default-model', 'default-model', 'provider-a', limitsJson)]), secureStoreAvailable: true },
        ),
      ).toMatchObject({ modelContextWindow: 128_000, contextWindowEstimated: true });
    },
  );
});
