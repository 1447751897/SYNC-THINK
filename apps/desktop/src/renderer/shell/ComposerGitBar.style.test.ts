import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./git-panel.css', import.meta.url), 'utf8');

it('gives repository context an inset, opaque rounded backplate', () => {
  const rule = css.match(/\.shell-composer-git\s*\{([^}]+)\}/)?.[1];
  expect(rule).toBeDefined();
  expect(rule).toMatch(/margin:\s*0 24px;/);
  expect(rule).toMatch(/border-radius:\s*16px 16px 0 0;/);
  expect(rule).toMatch(/background:\s*color-mix\(in srgb, var\(--composer-text\) 8%, var\(--composer-surface\)\);/);
  expect(rule).not.toContain('transparent');
  expect(rule).not.toMatch(/margin-bottom:\s*8px/);
});

it('reduces the inset and keeps controls wrapping in narrow composer panes', () => {
  const rule = css.match(/@container newmax-composer \(max-width: 540px\)\s*\{\s*\.shell-composer-git\s*\{([^}]+)\}/)?.[1];
  expect(rule).toMatch(/margin-inline:\s*16px;/);
  expect(rule).toMatch(/flex-wrap:\s*wrap;/);
});
