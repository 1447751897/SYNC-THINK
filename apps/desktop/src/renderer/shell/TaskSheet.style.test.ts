import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('task controls in portals', () => {
  it('shares color aliases with both the task page and portaled sheet', () => {
    const aliases = css.slice(css.indexOf('.task-panel,\n.task-sheet,'), css.indexOf('--task-mask: rgba(24'));
    expect(aliases).toContain('--task-border-strong: var(--color-border-strong)');
    expect(aliases).toContain('--task-accent: var(--color-accent)');
    expect(aliases).toContain('--task-text-2: var(--color-text-secondary)');
  });

  it('exposes keyboard focus on the visible all-day switch', () => {
    expect(css).toContain('.task-editor__switch-input:focus-visible + .task-editor__switch');
  });
});
