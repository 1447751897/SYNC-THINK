import { describe, expect, it } from 'vitest';
import {
  composeImageProviderOrder,
  composeTextProviderOrder,
  isLikelyImageGenerationModelId,
  parseImageModelIds,
} from './image-generation-providers.js';

describe('image generation provider helpers', () => {
  it('keeps text providers ahead of image providers when either list is reordered', () => {
    const all = [
      { providerId: 'text-a', protocol: 'openai-chat' },
      { providerId: 'text-b', protocol: 'anthropic-messages' },
      { providerId: 'image-a', protocol: 'openai-images' },
      { providerId: 'image-b', protocol: 'openai-images' },
    ];
    expect(
      composeTextProviderOrder({
        all,
        nextEnabledTextIds: ['text-b', 'text-a'],
      }),
    ).toEqual(['text-b', 'text-a', 'image-a', 'image-b']);
    expect(
      composeImageProviderOrder({
        all,
        nextEnabledImageIds: ['image-b', 'image-a'],
      }),
    ).toEqual(['text-a', 'text-b', 'image-b', 'image-a']);
  });

  it('parses comma and newline model ids', () => {
    expect(parseImageModelIds('gpt-image-2, glm-image\ncogview-4')).toEqual([
      'gpt-image-2',
      'glm-image',
      'cogview-4',
    ]);
  });

  it('keeps chat models out of the image picker', () => {
    expect(isLikelyImageGenerationModelId('gpt-image-2')).toBe(true);
    expect(isLikelyImageGenerationModelId('flux-1.1-pro')).toBe(true);
    expect(isLikelyImageGenerationModelId('gpt-4o')).toBe(false);
  });
});
