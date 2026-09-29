import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('preserves webview flex layout so the guest iframe is not stuck at its 150px default height', () => {
  const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/\.shell-inline-vis__webview\s*\{([^}]+)\}/g)];
  expect(rules.length).toBeGreaterThan(0);
  for (const [, rule] of rules) expect(rule).toMatch(/display:\s*flex/);
});

it('stacks model notices above the chat instead of consuming a second content column', () => {
  const css = readFileSync(new URL('./agent-workspace.css', import.meta.url), 'utf8');
  expect(css.match(/\.agent-chat-workspace__content\s*\{([^}]+)\}/)?.[1]).toMatch(/flex-direction:\s*column/);
});
