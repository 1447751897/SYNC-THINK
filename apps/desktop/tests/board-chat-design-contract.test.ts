import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('../src/renderer/shell/board-chat.css', import.meta.url), 'utf8');

describe('Board-style main chat CSS isolation', () => {
  it('keeps all selectors inside the opt-in document and normal workspace', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of withoutComments.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g)) {
      const selector = match[1].trim();
      if (selector.startsWith('@')) continue;
      expect(selector).toContain(":root[data-shell-design='agent'] .shell-normal-workspace");
    }
  });
  it('uses existing semantic colors rather than hardcoded palette values', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i);
    expect(css).not.toContain('!important');
    expect(css).toContain('var(--color-surface)');
    expect(css).toContain('var(--color-accent-text)');
  });
  it('has explicit editor geometry, narrow layout and reduced motion', () => {
    expect(css).toContain("[data-presentation='pill'] .cm-editor { min-height: 36px; }");
    expect(css).toContain('max-width: 760px');
    expect(css).toContain('@container newmax-composer (max-width: 520px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('shell-newmax-composer-frame__status');
  });
});

it('keeps activity indicators visible when removing redundant model avatars', () => {
  expect(css).toContain('st-conv-row__identity { display: contents; }');
  expect(css).toContain('st-conv-row__identity > :not(.st-conv-row__activity) { display: none; }');
  expect(css).toContain('st-conv-row__identity > .st-conv-row__activity { position: absolute;');
});

it('detaches approval and mode banners from the pill input instead of overlapping it', () => {
  expect(css).toContain(".shell-chat-content--composer:has([data-presentation='pill']) { --composer-banner-overlap: 0px; }");
  expect(css).toContain('.shell-composer-peek-surface { margin-bottom: 8px; }');
  expect(css).toContain("[data-presentation='pill'] > .shell-newmax-composer-frame__mode { margin-bottom: 8px; }");
});
