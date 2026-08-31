import { describe, expect, it } from 'vitest';
import { Runtime } from './runtime.js';
import { resolveGatewayModelName, type GatewayCatalogEntry } from './gateway/model-resolver.js';
import type { SqliteProviderStore } from '@sync-think/storage';

describe('Runtime gateway catalog projection', () => {
  it('keeps each model protocol when one provider exposes mixed dialects', () => {
    const providerId = 'provider-mixed-protocols';
    const providerStore = {
      listProviders: () => [
        {
          provider: {
            id: providerId,
            name: 'Mixed relay',
            baseUrl: 'https://relay.example/v1',
            protocol: 'anthropic-messages',
            enabled: true,
            sortOrder: 0,
          },
          credentialGroups: [],
          models: [
            {
              id: 'model-anthropic',
              providerModelId: 'claude-model',
              protocol: 'anthropic-messages',
            },
            {
              id: 'model-openai',
              providerModelId: 'openai-fallback',
              protocol: 'openai-chat',
            },
          ],
        },
      ],
    } as unknown as SqliteProviderStore;

    const runtime = new Runtime({
      installId: `gateway-catalog-${Date.now()}`,
      allowNoToken: true,
      providerStore,
    });

    const catalog = (
      runtime as unknown as { collectGatewayCatalog(): GatewayCatalogEntry[] }
    ).collectGatewayCatalog();

    expect(catalog).toEqual([
      expect.objectContaining({
        providerId,
        providerModelId: 'claude-model',
        protocol: 'anthropic-messages',
      }),
      expect.objectContaining({
        providerId,
        providerModelId: 'openai-fallback',
        protocol: 'openai-chat',
      }),
    ]);
    expect(resolveGatewayModelName('openai-fallback', catalog)?.route).toMatchObject({
      protocol: 'openai-chat',
      providerModelId: 'openai-fallback',
      providerId,
    });
  });
});
