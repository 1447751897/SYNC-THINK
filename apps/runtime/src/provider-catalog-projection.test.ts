import { describe, expect, it } from 'vitest';
import type { CredentialGroupId, CredentialRefId, ModelId, ProviderId } from '@sync-think/shared';
import type { ModelRecord, ProviderCatalogEntry } from '@sync-think/storage';
import {
  projectProviderModelSummary,
  projectProviderSummary,
  projectProviderSummaryById,
} from './provider-catalog-projection.js';

const providerId = 'provider-fixture' as ProviderId;
const credentialGroupId = 'credential-group-fixture' as CredentialGroupId;
const credentialRefId = 'credential-fixture' as CredentialRefId;

function model(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: 'model-fixture' as ModelId,
    providerId,
    providerModelId: 'model-upstream',
    displayName: 'Fixture Model',
    protocol: 'anthropic-messages',
    capabilities: ['text'],
    capabilitiesConfirmed: true,
    priority: 0,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider catalog projection', () => {
  it('projects model limits and optional vision fields without leaking storage JSON', () => {
    expect(
      projectProviderModelSummary(
        model({
          limitsJson: JSON.stringify({ contextWindow: 372_000, internal: 'ignored' }),
          visionCapability: true,
          visionProbeReason: 'confirmed',
          visionManualOverride: false,
          credentialRefId,
        }),
      ),
    ).toEqual({
      modelId: 'model-fixture',
      providerModelId: 'model-upstream',
      displayName: 'Fixture Model',
      protocol: 'anthropic-messages',
      capabilities: ['text'],
      capabilitiesConfirmed: true,
      visionCapability: true,
      visionProbeReason: 'confirmed',
      visionManualOverride: false,
      priority: 0,
      credentialRefId: 'credential-fixture',
      contextWindow: 372_000,
    });
  });

  it.each([
    'not-json',
    JSON.stringify({ contextWindow: -1 }),
    JSON.stringify({ contextWindow: '32k' }),
  ])('omits an invalid context window from %s', (limitsJson) => {
    const summary = projectProviderModelSummary(model({ limitsJson }));
    expect(summary.contextWindow).toBeUndefined();
    expect(summary.visionManualOverride).toBeNull();
    expect('visionCapability' in summary).toBe(false);
  });

  it('flattens credential groups, infers surface, and projects nested models', () => {
    const entry: ProviderCatalogEntry = {
      provider: {
        id: providerId,
        name: 'Claude Relay',
        baseUrl: 'https://relay.example.test',
        supportsDiscovery: true,
        protocol: 'anthropic-messages',
        surface: 'generic',
        enabled: true,
        sortOrder: 2,
        unverified: false,
        importedFrom: 'fixture',
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T01:00:00.000Z',
      },
      credentialGroups: [
        {
          id: credentialGroupId,
          providerId,
          name: 'Primary',
          createdAt: '2026-09-20T00:00:00.000Z',
          credentials: [
            {
              id: credentialRefId,
              credentialGroupId,
              label: 'Default key',
              kind: 'api-key',
              hasSecret: true,
              createdAt: '2026-09-20T00:00:00.000Z',
              updatedAt: '2026-09-20T00:00:00.000Z',
            },
          ],
        },
      ],
      models: [model()],
    };

    const summary = projectProviderSummary(entry);
    expect(summary.surface).toBe('claude');
    expect(summary.credentials).toEqual([
      {
        credentialRefId: 'credential-fixture',
        credentialGroupId: 'credential-group-fixture',
        groupName: 'Primary',
        label: 'Default key',
        kind: 'api-key',
        hasSecret: true,
      },
    ]);
    expect(summary.models).toHaveLength(1);
    expect(summary.models[0]?.modelId).toBe('model-fixture');
  });

  it('selects a provider by id without leaking the catalog entry', () => {
    const entry: ProviderCatalogEntry = {
      provider: {
        id: providerId,
        name: 'Claude Relay',
        baseUrl: 'https://relay.example.test',
        supportsDiscovery: true,
        protocol: 'anthropic-messages',
        surface: 'generic',
        enabled: true,
        sortOrder: 2,
        unverified: false,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T01:00:00.000Z',
      },
      credentialGroups: [],
      models: [],
    };

    expect(projectProviderSummaryById([entry], providerId)).toEqual(projectProviderSummary(entry));
    expect(projectProviderSummaryById([entry], 'missing-provider')).toBeUndefined();
  });
});
