import { describe, expect, it } from 'vitest';
import type { ModelId } from '@sync-think/shared';
import { resolvePromptEnhancementModelId } from './prompt-enhancement-model-selection.js';

const model = (id: string, providerModelId: string) => ({
  id: id as ModelId,
  providerModelId,
});

describe('prompt enhancement model selection', () => {
  const providers = [
    { provider: { enabled: false }, models: [model('disabled', 'upstream-disabled')] },
    {
      provider: { enabled: true },
      models: [model('primary', 'upstream-primary'), model('secondary', 'upstream-secondary')],
    },
  ];

  it('matches enabled catalog and upstream model ids', () => {
    expect(
      resolvePromptEnhancementModelId({
        requested: 'secondary' as ModelId,
        providers,
        catalogConfigured: true,
        fallbackAvailable: false,
      }),
    ).toBe('secondary');
    expect(
      resolvePromptEnhancementModelId({
        requested: 'upstream-primary' as ModelId,
        providers,
        catalogConfigured: true,
        fallbackAvailable: false,
      }),
    ).toBe('primary');
  });

  it('falls back to the first enabled catalog model for stale or omitted requests', () => {
    for (const requested of [undefined, 'missing' as ModelId]) {
      expect(
        resolvePromptEnhancementModelId({
          requested,
          providers,
          catalogConfigured: true,
          fallbackAvailable: true,
        }),
      ).toBe('primary');
    }
  });

  it('preserves demo-provider fallback behavior without a catalog', () => {
    expect(
      resolvePromptEnhancementModelId({
        requested: 'direct-model' as ModelId,
        providers: [],
        catalogConfigured: false,
        fallbackAvailable: true,
      }),
    ).toBe('direct-model');
    expect(
      resolvePromptEnhancementModelId({
        providers: [],
        catalogConfigured: false,
        fallbackAvailable: true,
      }),
    ).toBe('fake-mini');
    expect(
      resolvePromptEnhancementModelId({
        providers: [],
        catalogConfigured: true,
        fallbackAvailable: false,
      }),
    ).toBeUndefined();
  });
});
