import { describe, expect, it } from 'vitest';
import {
  parseAddModelsPayload,
  parseRemoveModelPayload,
  parseSetModelPrioritiesPayload,
  parseUpdateModelPayload,
} from './provider-model-payloads.js';

describe('Provider Model payload validation', () => {
  it('preserves the existing add-model payload behavior', () => {
    expect(
      parseAddModelsPayload({
        providerId: 'provider-1',
        protocol: 'openai-chat',
        models: [{ providerModelId: 'manual-model', displayName: 'Manual Model' }],
      }),
    ).toEqual({
      providerId: 'provider-1',
      protocol: 'openai-chat',
      models: [{ providerModelId: 'manual-model', displayName: 'Manual Model' }],
    });
    expect(() =>
      parseAddModelsPayload({ providerId: 'provider-1', protocol: 'invalid', models: [{}] }),
    ).toThrow(/Invalid add-models/);
  });

  it('normalizes model priorities and rejects duplicate model identities', () => {
    expect(
      parseSetModelPrioritiesPayload({
        providerId: ' provider-1 ',
        entries: [
          { modelId: ' model-2 ', credentialRefId: ' credential-1 ' },
          { modelId: 'model-1', credentialRefId: null },
        ],
      }),
    ).toEqual({
      providerId: 'provider-1',
      entries: [
        { modelId: 'model-2', credentialRefId: 'credential-1' },
        { modelId: 'model-1', credentialRefId: null },
      ],
    });
    expect(() =>
      parseSetModelPrioritiesPayload({
        providerId: 'provider-1',
        entries: [{ modelId: 'model-1' }, { modelId: ' model-1 ' }],
      }),
    ).toThrow(/Invalid set-model-priorities/);
  });

  it('normalizes updates and removals while preserving nullable context windows', () => {
    expect(
      parseUpdateModelPayload({
        providerId: ' provider-1 ',
        modelId: ' model-1 ',
        displayName: ' Renamed ',
        contextWindow: 32768.4,
      }),
    ).toEqual({
      providerId: 'provider-1',
      modelId: 'model-1',
      displayName: 'Renamed',
      contextWindow: 32768,
    });
    expect(
      parseUpdateModelPayload({
        providerId: 'provider-1',
        modelId: 'model-1',
        contextWindow: null,
      }),
    ).toEqual({
      providerId: 'provider-1',
      modelId: 'model-1',
      displayName: undefined,
      contextWindow: null,
    });
    expect(parseRemoveModelPayload({ providerId: ' provider-1 ', modelId: ' model-1 ' })).toEqual({
      providerId: 'provider-1',
      modelId: 'model-1',
    });
  });

  it('rejects empty updates and unknown fields', () => {
    expect(() => parseUpdateModelPayload({ providerId: 'provider-1', modelId: 'model-1' })).toThrow(
      /Invalid update-model/,
    );
    expect(() =>
      parseRemoveModelPayload({ providerId: 'provider-1', modelId: 'model-1', force: true }),
    ).toThrow(/Invalid remove-model/);
  });
});
