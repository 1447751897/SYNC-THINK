import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const toolbar = css.match(/\.shell-markdown-document__toolbar\s*\{([^}]+)\}/)?.[1];

describe('Markdown document formatting toolbar', () => {
  it('centers the formatting controls horizontally', () => {
    expect(toolbar).toBeDefined();
    expect(toolbar).toMatch(/display:\s*flex;/);
    expect(toolbar).toMatch(/justify-content:\s*center;/);
    expect(toolbar).toMatch(/align-items:\s*center;/);
  });

  it('uses compact icons and spacing while keeping usable button targets', () => {
    const button = css.match(/\.shell-markdown-document__toolbar > button\s*\{([^}]+)\}/)?.[1];
    const icon = css.match(/\.shell-markdown-document__toolbar > button > svg\s*\{([^}]+)\}/)?.[1];
    const divider = css.match(/\.shell-markdown-document__divider\s*\{([^}]+)\}/)?.[1];
    expect(toolbar).toMatch(/padding:\s*4px 10px;/);
    expect(button).toMatch(/padding:\s*5px;/);
    expect(icon).toMatch(/width:\s*16px;/);
    expect(icon).toMatch(/height:\s*16px;/);
    expect(divider).toMatch(/height:\s*16px;/);
    expect(divider).toMatch(/margin:\s*0 3px;/);
  });

  it('keeps a centered, full-width toolbar with wrapping in narrow panes', () => {
    expect(toolbar).toMatch(/width:\s*100%;/);
    expect(toolbar).toMatch(/margin:\s*0 auto;/);
    expect(toolbar).toMatch(/flex-wrap:\s*wrap;/);
  });
});
