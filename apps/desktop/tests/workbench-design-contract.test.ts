import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_WIDTH_DEFAULT, readSidebarWidth, writeSidebarWidth } from '../src/renderer/ui-preferences.js';
const css = readFileSync(new URL('../src/renderer/shell/workbench-design.css', import.meta.url), 'utf8');
const source = JSON.parse(readFileSync(new URL('../../../docs/product/16-shell-design-tokens.json', import.meta.url), 'utf8'));
const palette = source.groups.find((group: { id: string }) => group.id === 'workbench-agent');
describe('agent-family workbench visual contract', () => {
  it('covers the full workbench rather than only the empty chat', () => {
    for (const selector of ['.shell-sidebar-actions', '.shell-topbar', '.shell-conversation-tabs', '.shell-user-bubble', '.shell-response__content', '.shell-newmax-composer', '.shell-workbench__content', '.shell-context-menu', '.settings-page']) expect(css).toContain(selector);
  });
  it('scopes every visual rule so shared website/demo CSS remains unchanged', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? [];
    for (const rule of selectors) {
      if (rule.trim().startsWith('@')) continue;
      expect(rule).toContain(":root[data-shell-design='agent']");
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toContain('!important');
  });
  it('declares paired light/dark roles without replacing the legacy palette', () => {
    expect(palette.tokens.page).toEqual(['#ffffff', '#171717']);
    expect(palette.tokens.panel).toEqual(['#f7f7f7', '#202020']);
    for (const value of Object.values(palette.tokens)) expect(value).toHaveLength(2);
    expect(source.groups.find((group: { id: string }) => group.id === 'surfaces').tokens.page).toEqual(['#f2eee6', '#1e1f1f']);
  });
  it('keeps ordinary text and primary button labels above 4.5:1 in both modes', () => {
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    for (const mode of [0, 1]) {
      for (const foreground of ['text', 'secondary', 'muted', 'link']) expect(ratio(palette.tokens[foreground][mode], palette.tokens.panel[mode])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(palette.tokens['on-primary'][mode], palette.tokens.primary[mode])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('uses a 260px default but respects saved user widths', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(260);
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(readSidebarWidth(storage)).toBe(260);
    writeSidebarWidth(288, storage);
    expect(readSidebarWidth(storage)).toBe(288);
  });
  it('keeps narrow previews, reduced motion and wallpaper readability explicit', () => {
    expect(css).toContain('@container wb-side (max-width: 560px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain("[data-image-theme='active']");
    expect(css).toContain('--shell-chat-composer-surface');
  });
});
