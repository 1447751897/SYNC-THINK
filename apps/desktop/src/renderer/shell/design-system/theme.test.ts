/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import { COMPONENT_CATALOG, TOKEN_CATALOG } from './catalog.generated.js';
import {
  exportThemeCss,
  newDraft,
  parseDraft,
  readDraft,
  STORAGE_KEY,
  themeValues,
  validTokenValue,
} from './theme.js';

describe('design system theme contract', () => {
  beforeEach(() => localStorage.clear());
  it('uses all desktop source tokens, not a separate six-color palette', () => {
    const values = themeValues(newDraft());
    expect(Object.keys(values)).toHaveLength(TOKEN_CATALOG.length);
    expect(values['--color-accent']).toBe(
      TOKEN_CATALOG.find((t) => t.name === '--color-accent')!.light,
    );
    expect(new Set(TOKEN_CATALOG.map((t) => t.name)).size).toBe(TOKEN_CATALOG.length);
    expect(TOKEN_CATALOG.some((t) => t.name.startsWith('--web-'))).toBe(false);
  });
  it('keeps mode overrides independent, taking precedence over presets', () => {
    const d = newDraft();
    d.overrides.light['--color-accent'] = '#123456';
    d.preset = 'azure';
    expect(themeValues(d)['--color-accent']).toBe('#123456');
    expect(themeValues(d, 'dark')['--color-accent']).not.toBe('#123456');
    expect(themeValues(d, 'dark')['--color-page']).not.toBe(
      themeValues(d, 'light')['--color-page'],
    );
  });
  it('round-trips a saved draft and exports both scoped modes', () => {
    const d = newDraft();
    d.mode = 'dark';
    d.overrides.dark['--color-accent'] = '#aabbcc';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    expect(readDraft()).toEqual(d);
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
    expect(exportThemeCss(d)).toContain('.design-system-theme.dark');
    expect(exportThemeCss(d)).toContain('.design-system-theme:not(.dark)');
    expect(exportThemeCss(d)).toContain('--color-accent: #aabbcc;');
  });
  it('fails closed on corrupt, oversized values and unknown variables', () => {
    localStorage.setItem(STORAGE_KEY, 'oops');
    expect(readDraft()).toEqual(newDraft());
    expect(() => parseDraft('{}')).toThrow();
    expect(validTokenValue('--fake', 'red')).toBe(false);
    expect(validTokenValue('--color-accent', 'red; } body { color: blue')).toBe(false);
    expect(validTokenValue('--color-accent', 'url(https://example.test)')).toBe(false);
    expect(validTokenValue('--color-accent', 'a'.repeat(1501))).toBe(false);
    const d = newDraft();
    d.overrides.light['--fake'] = 'red';
    expect(() => parseDraft(JSON.stringify(d))).toThrow();
  });
  it('separates historical components and real interactive fixtures', () => {
    expect(COMPONENT_CATALOG.filter((c) => c.live).length).toBeGreaterThanOrEqual(9);
    expect(COMPONENT_CATALOG.filter((c) => c.legacy).every((c) => !c.live)).toBe(true);
    expect(COMPONENT_CATALOG.find((c) => c.name === 'ShellApp')?.source).toContain('apps/desktop/');
    expect(COMPONENT_CATALOG.every((c) => c.exports.length > 0)).toBe(true);
  });
});
