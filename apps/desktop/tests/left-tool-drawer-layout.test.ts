import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/renderer/index.tsx', import.meta.url),
  'utf8',
);
const uiCss = readFileSync(
  new URL('../../../packages/ui-kit/src/styles/components.css', import.meta.url),
  'utf8',
);

describe('left tool drawer layout contract', () => {
  it('assembles one modal tool drawer beside the persistent task tree', () => {
    expect(source).toContain('data-testid="left-tool-drawer"');
    expect(source).toContain('data-testid="left-tool-drawer-backdrop"');
    expect(source).toContain('data-testid="left-runtime-status"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  it('removes the old instrument card header from the product rail', () => {
    expect(source).not.toContain('st-demo-nav-stack__switch-head');
    expect(source).not.toContain('st-demo-nav-stack__switch-short');
  });

  it('keeps the left rail and its fixed drawer above later AppShell grid items', () => {
    const navRule = uiCss.match(/\.st-app-shell__nav\s*\{[^}]+\}/)?.[0] ?? '';
    expect(navRule).toContain('position: relative');
    expect(navRule).toContain('z-index: 2');
  });
});
