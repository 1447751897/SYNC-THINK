import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./workbench-design.css', import.meta.url), 'utf8');
const selector =
  ":root[data-shell-design='agent'] .shell-normal-workspace .shell-workspace-primary-content";

it('preserves the wallpaper image when applying the workbench canvas color', () => {
  const declarations = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector)
    .map(([, , body]) => body)
    .join('\n');

  // A higher-specificity background shorthand resets background-image to none.
  // Blur copies can hide that regression; overlay mode has no such fallback.
  expect(declarations).toContain('background-color: var(--color-chat);');
  expect(declarations).not.toMatch(/(?:^|;)\s*background\s*:/);
});
