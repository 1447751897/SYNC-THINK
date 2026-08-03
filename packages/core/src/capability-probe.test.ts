import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TAGS,
  isTextFallbackCompatibleModel,
  mergeCapabilitySuggestions,
  normalizeCapabilities,
  suggestCapabilities,
  type CapabilitySuggestionInput,
} from './capability-probe.js';
import type { CapabilityTag, ModelId } from '@sync-think/shared';

describe('suggestCapabilities (product §7.2)', () => {
  it('always suggests text for chat protocols', () => {
    const result = suggestCapabilities({
      providerModelId: 'unknown-custom-model',
      protocol: 'openai-chat',
    });
    expect(result.capabilities).toContain('text');
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBe('low');
  });

  it('suggests vision for multimodal model ids', () => {
    const cases = ['gpt-4o', 'gpt-4-vision-preview', 'claude-3-5-sonnet', 'gemini-1.5-pro'];
    for (const id of cases) {
      const result = suggestCapabilities({ providerModelId: id, protocol: 'openai-chat' });
      expect(result.capabilities).toEqual(
        expect.arrayContaining(['text', 'vision'] as CapabilityTag[]),
      );
    }
  });

  it('suggests tool-calling for modern agentic models', () => {
    const result = suggestCapabilities({
      providerModelId: 'gpt-4o-mini',
      protocol: 'openai-chat',
    });
    expect(result.capabilities).toEqual(
      expect.arrayContaining(['text', 'tool-calling'] as CapabilityTag[]),
    );
  });

  it('suggests image-generation for image models and marks chat text optional', () => {
    const result = suggestCapabilities({
      providerModelId: 'dall-e-3',
      protocol: 'openai-images',
    });
    expect(result.capabilities).toContain('image-generation');
    expect(result.capabilities).not.toContain('tool-calling');
  });

  it('suggests embeddings for embedding models', () => {
    const result = suggestCapabilities({
      providerModelId: 'text-embedding-3-large',
      protocol: 'openai-chat',
    });
    expect(result.capabilities).toContain('embeddings');
    expect(result.capabilities).not.toContain('tool-calling');
  });

  it.each(['grok-imagine-image', 'grok-imagine-video-1.5-preview'])(
    'classifies generated media model %s as non-text',
    (providerModelId) => {
      const result = suggestCapabilities({ providerModelId, protocol: 'openai-responses' });
      expect(result.capabilities).toContain('image-generation');
      expect(result.capabilities).not.toContain('text');
    },
  );

  it('does not treat probe results as confirmed facts', () => {
    const result = suggestCapabilities({
      providerModelId: 'claude-3-opus',
      protocol: 'anthropic-messages',
    });
    expect(result.capabilitiesConfirmed).toBe(false);
    expect(result.results).toMatchObject({
      text: true,
      vision: true,
    });
  });
});

describe('normalizeCapabilities / mergeCapabilitySuggestions', () => {
  it('dedupes and keeps only known capability tags', () => {
    const normalized = normalizeCapabilities([
      'text',
      'text',
      'vision',
      'not-a-tag' as CapabilityTag,
      'tool-calling',
    ]);
    expect(normalized).toEqual(['text', 'vision', 'tool-calling']);
  });

  it('merges existing with suggestions without inventing unknown tags', () => {
    const merged = mergeCapabilitySuggestions(['text'], ['vision', 'tool-calling', 'text']);
    expect(merged).toEqual(['text', 'vision', 'tool-calling']);
  });

  it('exposes the full capability tag catalog', () => {
    expect(CAPABILITY_TAGS).toEqual([
      'text',
      'vision',
      'tool-calling',
      'image-generation',
      'embeddings',
    ]);
  });

  it('accepts typed model id on suggestion input', () => {
    const input: CapabilitySuggestionInput = {
      modelId: 'm1' as ModelId,
      providerModelId: 'gpt-4o',
      protocol: 'openai-chat',
    };
    const result = suggestCapabilities(input);
    expect(result.modelId).toBe('m1');
  });
});

describe('isTextFallbackCompatibleModel', () => {
  it('keeps compatible chat models in the fallback walk', () => {
    expect(
      isTextFallbackCompatibleModel({
        providerModelId: 'grok-4.5',
        protocol: 'openai-responses',
        capabilities: ['text', 'tool-calling'],
      }),
    ).toBe(true);
  });

  it.each([
    'grok-imagine-image',
    'grok-imagine-video-1.5-preview',
    'text-embedding-3-large',
    'voice-tts-1',
  ])('rejects non-text model %s even when stale catalog tags include text', (providerModelId) => {
    expect(
      isTextFallbackCompatibleModel({
        providerModelId,
        protocol: 'openai-responses',
        capabilities: ['text'],
      }),
    ).toBe(false);
  });

  it('rejects explicit non-text capabilities', () => {
    expect(
      isTextFallbackCompatibleModel({
        providerModelId: 'custom-generator',
        protocol: 'openai-chat',
        capabilities: ['image-generation'],
      }),
    ).toBe(false);
  });
});
