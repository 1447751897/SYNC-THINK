import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./board-chat.css', import.meta.url), 'utf8');

describe('sidebar-owned chat header', () => {
  it('does not reserve title space for the removed compact pane actions', () => {
    const title = css.match(/\.shell-chat-breadcrumb__conversation\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(title).toContain('padding-right: 0;');
  });

  it('removes obsolete floating toolbar and wallpaper-stripe overrides', () => {
    expect(css).not.toContain("[data-compact-header='true']");
  });
});
