import { describe, it, expect } from 'vitest';
import {
  resolveKernelBrandLogo,
  resolveProviderBrandLogo,
  resolveProviderBrandLogoByName,
} from './brand-icons.js';

describe('resolveProviderBrandLogoByName', () => {
  it('matches DeepSeek by display name for user-added providers', () => {
    const logo = resolveProviderBrandLogoByName('DeepSeek');
    expect(logo).toBeDefined();
    expect(logo?.label).toBe('DeepSeek');
  });

  it('keeps relay services without a brand as undefined (KMKAPI)', () => {
    expect(resolveProviderBrandLogoByName('KMKAPI-GPT')).toBeUndefined();
    // Model-family names on a relay must NOT collide with the real brand.
    expect(resolveProviderBrandLogoByName('KMKAPI-GROK')).toBeUndefined();
    expect(resolveProviderBrandLogoByName('KMKAPI-GLM')).toBeUndefined();
    expect(resolveProviderBrandLogoByName('KMKAPI-CLAUDE')).toBeUndefined();
  });

  it('matches common brand families', () => {
    expect(resolveProviderBrandLogoByName('OpenAI')?.label).toBe('OpenAI');
    expect(resolveProviderBrandLogoByName('Anthropic')?.label).toBe('Anthropic');
    expect(resolveProviderBrandLogoByName('智谱')?.label).toBe('智谱');
    expect(resolveProviderBrandLogoByName('硅基流动')?.label).toBe('硅基流动');
    expect(resolveProviderBrandLogoByName('Ollama')?.label).toBe('Ollama');
  });

  it('returns undefined for empty or unknown names', () => {
    expect(resolveProviderBrandLogoByName('')).toBeUndefined();
    expect(resolveProviderBrandLogoByName('My Private Relay')).toBeUndefined();
  });
});

describe('brand logo registries', () => {
  it('resolves preset catalog ids and kernel icons', () => {
    expect(resolveProviderBrandLogo('deepseek')?.label).toBe('DeepSeek');
    expect(resolveKernelBrandLogo('claude-code')?.label).toBe('Claude Code');
    expect(resolveKernelBrandLogo('codex')?.label).toBe('ChatGPT');
    expect(resolveKernelBrandLogo('native')?.label).toBe('Sync-Think');
  });
});
