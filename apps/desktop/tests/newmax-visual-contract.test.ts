import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SIDEBAR_WIDTH_DEFAULT, readSidebarWidth } from '../src/renderer/ui-preferences.js';
import {
  WORKBENCH_FILE_BROWSER_WIDTH,
  WORKBENCH_RIGHT_COMPACT_WIDTH,
  WORKBENCH_RIGHT_PREVIEW_WIDTH,
} from '../src/renderer/shell/workspace-workbench.js';

interface TokenGroup {
  id: string;
  tokens: Record<string, string | [string, string]>;
}

const source = JSON.parse(
  readFileSync(
    new URL('../../../docs/product/16-shell-design-tokens.json', import.meta.url),
    'utf8',
  ),
) as { groups: TokenGroup[] };

function darkToken(groupId: string, tokenId: string): string {
  const group = source.groups.find((candidate) => candidate.id === groupId);
  const value = group?.tokens[tokenId];
  if (!Array.isArray(value)) throw new Error(`Missing themed token ${groupId}.${tokenId}`);
  return value[1];
}

function lightToken(groupId: string, tokenId: string): string {
  const group = source.groups.find((candidate) => candidate.id === groupId);
  const value = group?.tokens[tokenId];
  if (!Array.isArray(value)) throw new Error(`Missing themed token ${groupId}.${tokenId}`);
  return value[0];
}

describe('NewMax 1.1.14 visual contract', () => {
  it('uses the measured four-step dark surface ramp and interaction colors', () => {
    expect(darkToken('surfaces', 'page')).toBe('#1e1f1f');
    expect(darkToken('surfaces', 'page-gutter')).toBe('#1e1f1f');
    expect(darkToken('surfaces', 'elevated')).toBe('#191a1a');
    expect(darkToken('surfaces', 'surface')).toBe('#252726');
    expect(darkToken('panels', 'recent')).toBe('#2a2d2b');
    expect(darkToken('accent', 'accent')).toBe('#36d385');
    expect(darkToken('states', 'hover')).toBe('rgba(168, 184, 176, 0.08)');
    expect(darkToken('states', 'active')).toBe('rgba(168, 184, 176, 0.16)');
  });

  it('matches NewMax text opacity and 220px sidebar geometry', () => {
    expect(darkToken('text', 'text')).toBe('rgba(255, 255, 255, 0.9)');
    expect(darkToken('text', 'text-secondary')).toBe('rgba(255, 255, 255, 0.5)');
    expect(darkToken('text', 'text-faint')).toBe('rgba(255, 255, 255, 0.38)');
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(220);

    const legacyStorage = {
      getItem: (key: string) => (key === 'sync-think.sidebarWidth' ? '300' : null),
    };
    expect(readSidebarWidth(legacyStorage)).toBe(220);

    const resizedLegacyStorage = {
      getItem: (key: string) => (key === 'sync-think.sidebarWidth' ? '273' : null),
    };
    expect(readSidebarWidth(resizedLegacyStorage)).toBe(220);
  });

  it('keeps the connected tab surface effects exact in both themes', () => {
    expect(lightToken('tabs', 'hover')).toBe('rgba(55, 61, 58, 0.06)');
    expect(lightToken('tabs', 'outline')).toBe('rgba(0, 0, 0, 0.04)');
    expect(lightToken('tabs', 'highlight')).toBe('rgba(255, 255, 255, 0.85)');
    expect(darkToken('tabs', 'hover')).toBe('rgba(168, 184, 176, 0.08)');
    expect(darkToken('tabs', 'outline')).toBe('rgba(255, 255, 255, 0.08)');
    expect(darkToken('tabs', 'highlight')).toBe('transparent');
  });

  it('matches NewMax workbench geometry', () => {
    expect(WORKBENCH_RIGHT_COMPACT_WIDTH).toBe(330);
    expect(WORKBENCH_RIGHT_PREVIEW_WIDTH).toBe(713);
    expect(WORKBENCH_FILE_BROWSER_WIDTH).toBe(288);
  });
});
