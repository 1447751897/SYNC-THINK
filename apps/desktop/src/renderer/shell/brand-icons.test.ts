import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveKernelDisplayName,
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
    expect(resolveKernelBrandLogo('claude-code')?.label).toBe('ClaudeCode');
    expect(resolveKernelBrandLogo('claude-code')?.src).toContain('claudecode-color.svg');
    expect(resolveKernelBrandLogo('codex')?.label).toBe('GPT');
    expect(resolveKernelBrandLogo('codex')?.src).toContain('chatgpt.svg');
    expect(resolveKernelBrandLogo('codex')?.mono).toBe(true);
    expect(resolveKernelBrandLogo('native')?.label).toBe('Sync-Think');
    expect(resolveKernelBrandLogo('native')?.mono).toBe(true);
    expect(resolveKernelDisplayName('claude-code')).toBe('ClaudeCode');
    expect(resolveKernelDisplayName('codex')).toBe('GPT');
    expect(resolveKernelDisplayName('custom', 'Custom Kernel')).toBe('Custom Kernel');
  });

  it('keeps the ClaudeCode and GPT kernel artwork transparent', () => {
    const claude = readFileSync(
      new URL('./assets/brands/claudecode-color.svg', import.meta.url),
      'utf8',
    );
    const chatgpt = readFileSync(new URL('./assets/brands/chatgpt.svg', import.meta.url), 'utf8');

    expect(claude).not.toMatch(/<rect\b/i);
    expect(claude).toContain('fill="#D97757"');
    expect(claude).not.toContain('fill="#fff"');
    expect(chatgpt).not.toContain('#74aa9c');
    expect(chatgpt).toContain('currentColor');
  });
});
