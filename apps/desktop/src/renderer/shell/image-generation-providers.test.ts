import { describe, expect, it } from 'vitest';
import {
  IMAGE_API_PROVIDERS,
  IMAGE_PROVIDER_CATALOG,
  composeImageProviderOrder,
  composeTextProviderOrder,
  imageModelRowLabel,
  inferImageApiProvider,
  imageDraftModelsFromIds,
  imageModelIdsFromProbe,
  isLikelyImageGenerationModelId,
  parseImageModelIds,
  readStoredImageApiProvider,
  withStoredImageApiProvider,
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

  it('filters probe ids to image models, then falls back to the full list', () => {
    expect(imageModelIdsFromProbe(['gpt-image-2', 'gpt-4o', 'flux-1.1-pro'])).toEqual([
      'gpt-image-2',
      'flux-1.1-pro',
    ]);
    expect(imageModelIdsFromProbe(['gpt-4o', 'claude-sonnet'])).toEqual([
      'gpt-4o',
      'claude-sonnet',
    ]);
    expect(imageDraftModelsFromIds(['gpt-image-2', 'gpt-image-2', ' flux '])).toEqual([
      { providerModelId: 'gpt-image-2', displayName: 'gpt-image-2' },
      { providerModelId: 'flux', displayName: 'flux' },
    ]);
  });

  it('uses NewMax default/backup labels and OpenAI-compatible interface names', () => {
    expect(imageModelRowLabel(0)).toBe('默认');
    expect(imageModelRowLabel(1)).toBe('备用 1');
    expect(IMAGE_API_PROVIDERS.map((item) => item.label)).toEqual([
      'OpenAI / 兼容',
      'Google Gemini / Imagen',
      'DashScope 通义万象',
      'OpenRouter Image API',
      'SiliconFlow Image API',
    ]);
    expect(inferImageApiProvider('https://api.openai.com/v1')).toBe('openai');
    expect(inferImageApiProvider('https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(inferImageApiProvider('https://api.siliconflow.cn/v1')).toBe('siliconflow');
  });

  it('does not put NewMax Gateway in the image catalog', () => {
    const names = Object.values(IMAGE_PROVIDER_CATALOG).flatMap((items) =>
      items.map((item) => item.name),
    );
    expect(names).not.toContain('NewMax Gateway');
  });

  it('persists 生图接口 without storing secrets', () => {
    const stored = withStoredImageApiProvider(undefined, 'provider-image', 'openrouter');
    expect(stored).toEqual({
      overrides: { 'provider-image': { apiProvider: 'openrouter' } },
    });
    expect(JSON.stringify(stored)).not.toMatch(/sk-|apiKey|secret/i);
    expect(readStoredImageApiProvider(stored, 'provider-image', 'https://api.openai.com/v1')).toBe(
      'openrouter',
    );
  });
});
