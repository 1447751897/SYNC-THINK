import { describe, expect, it } from 'vitest';
import type { ProviderPanelItem } from '@sync-think/ui-kit';
import {
  buildComposeModelOptions,
  resolveAgentDefaultModelLabel,
  sanitizeSelectedModelId,
} from '../src/renderer/compose-models.js';

const providers: ProviderPanelItem[] = [
  {
    providerId: 'p-b',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    supportsDiscovery: true,
    credentials: [],
    models: [
      {
        modelId: 'm-ds',
        providerModelId: 'deepseek-chat',
        displayName: 'deepseek-chat',
        protocol: 'openai-chat',
        capabilitiesConfirmed: true,
      },
    ],
    createdAt: '2026-07-12T00:00:00.000Z',
  },
  {
    providerId: 'p-a',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    supportsDiscovery: true,
    credentials: [],
    models: [
      {
        modelId: 'm-mini',
        providerModelId: 'gpt-4o-mini',
        displayName: 'gpt-4o-mini',
        protocol: 'openai-chat',
        capabilitiesConfirmed: true,
      },
      {
        modelId: 'm-4o',
        providerModelId: 'gpt-4o',
        displayName: 'GPT-4o',
        protocol: 'openai-chat',
        capabilitiesConfirmed: false,
      },
    ],
    createdAt: '2026-07-12T00:00:00.000Z',
  },
];

describe('compose-models', () => {
  it('flattens ≥2 providers / ≥3 models into selector options', () => {
    const options = buildComposeModelOptions(providers);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.modelId).sort()).toEqual(['m-4o', 'm-ds', 'm-mini'].sort());
    // Sorted by provider name then model id string
    expect(options[0]!.providerName).toBe('DeepSeek');
    expect(options[1]!.providerName).toBe('OpenAI');
    expect(options[1]!.label).toContain('GPT-4o');
    expect(options[2]!.label).toContain('gpt-4o-mini');
  });

  it('sanitizes selection when model leaves catalog', () => {
    const options = buildComposeModelOptions(providers);
    expect(sanitizeSelectedModelId('m-mini', options)).toBe('m-mini');
    expect(sanitizeSelectedModelId('gone', options)).toBeNull();
    expect(sanitizeSelectedModelId(null, options)).toBeNull();
  });

  it('shows the provider model name for Agent default without leaking its UUID', () => {
    const options = buildComposeModelOptions(providers);
    expect(resolveAgentDefaultModelLabel('m-mini', options)).toBe(
      'Agent 默认 · gpt-4o-mini',
    );
    expect(resolveAgentDefaultModelLabel('unknown-model-uuid', options)).toBe('Agent 默认');
    expect(resolveAgentDefaultModelLabel(null, options)).toBe('Agent 默认');
  });
});
