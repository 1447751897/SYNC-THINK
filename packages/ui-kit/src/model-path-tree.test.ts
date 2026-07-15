import { describe, it, expect } from 'vitest';
import {
  buildSurfaceTree,
  findModelPath,
} from './model-path-tree.js';

describe('buildSurfaceTree', () => {
  it('groups models by surface then provider (CC Switch order)', () => {
    const tree = buildSurfaceTree([
      {
        modelId: 'm1',
        label: 'KMK · claude-sonnet',
        providerName: 'KMKAPI-CLAUDE',
        providerModelId: 'claude-sonnet',
        providerId: 'p1',
        surface: 'claude',
      },
      {
        modelId: 'm2',
        label: 'KMK · grok',
        providerName: 'KMKAPI-GROK',
        providerModelId: 'grok',
        providerId: 'p2',
        protocol: 'openai-responses',
      },
      {
        modelId: 'm3',
        label: 'Unity · gpt',
        providerName: 'Unity2.Ai',
        providerModelId: 'gpt-4o',
        providerId: 'p3',
        protocol: 'openai-chat',
      },
      {
        modelId: 'm4',
        label: 'Kiro · model',
        providerName: 'Kiro-Proxy',
        providerModelId: 'kiro-model',
        providerId: 'p4',
        surface: 'kiro',
      },
    ]);
    // Codex before Claude Code before Kiro before 其他
    expect(tree.map((s) => s.surface)).toEqual(['codex', 'claude', 'kiro', 'generic']);
    expect(tree.map((s) => s.label)).toEqual(['Codex', 'Claude Code', 'Kiro', '其他']);

    const claude = tree.find((s) => s.surface === 'claude')!;
    expect(claude.groups).toHaveLength(1);
    expect(claude.groups[0]!.models[0]!.modelId).toBe('m1');

    const codex = tree.find((s) => s.surface === 'codex')!;
    expect(codex.groups.some((g) => g.providerId === 'p2')).toBe(true);

    const kiro = tree.find((s) => s.surface === 'kiro')!;
    expect(kiro.groups[0]!.models[0]!.modelId).toBe('m4');
  });

  it('re-infers generic surface from protocol/name so imports are not stuck in 其他', () => {
    const tree = buildSurfaceTree([
      {
        modelId: 'm-codex',
        label: 'gpt',
        providerName: 'KMKAPI-CODEX',
        providerModelId: 'gpt-5.6-sol',
        providerId: 'pc',
        surface: 'generic',
        protocol: 'openai-responses',
      },
      {
        modelId: 'm-claude',
        label: 'u',
        providerName: 'Unity2.Ai',
        providerModelId: 'claude-opus',
        providerId: 'pu',
        surface: 'generic',
        protocol: 'anthropic-messages',
      },
      {
        modelId: 'm-name-codex',
        label: 'c',
        providerName: 'codex',
        providerModelId: 'm',
        providerId: 'pn',
        surface: 'generic',
        protocol: 'openai-chat',
      },
    ]);
    expect(tree.map((s) => s.surface)).toEqual(['codex', 'claude']);
    expect(tree.find((s) => s.surface === 'codex')!.modelCount).toBe(2);
    expect(tree.find((s) => s.surface === 'claude')!.modelCount).toBe(1);
  });

  it('findModelPath returns nested path', () => {
    const tree = buildSurfaceTree([
      {
        modelId: 'm1',
        label: 'a',
        providerName: 'G',
        providerId: 'pg',
        surface: 'claude',
      },
    ]);
    expect(findModelPath(tree, 'm1')).toEqual({
      surface: 'claude',
      providerId: 'pg',
      modelId: 'm1',
    });
    expect(findModelPath(tree, null)).toBeNull();
  });
});
