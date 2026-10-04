import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const codeCss = readFileSync(new URL('./code-block.css', import.meta.url), 'utf8');
const boardCss = readFileSync(new URL('./board-chat.css', import.meta.url), 'utf8');
const aliases = ['--color-workbench', '--color-workbench-content', '--color-tab-strip', '--color-chat'];

function rules(source: string, selector: string): string[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector)
    .map(([, , declarations]) => declarations);
}

describe('matching left and right side-panel surfaces', () => {
  it('maps the right frame, tabs, content and file canvas to the sidebar theme surface', () => {
    const right = rules(css, '.shell-workbench--right').join('\n');
    for (const alias of aliases) expect(right).toContain(`${alias}: var(--color-sidebar);`);
  });

  it('does not overwrite the center chat or bottom workbench surface', () => {
    for (const selector of ['.shell-workbench', '.shell-workbench--bottom', '.shell-workspace-primary-content']) {
      for (const alias of aliases) expect(rules(css, selector).join('\n')).not.toContain(`${alias}: var(--color-sidebar);`);
    }
  });

  it('keeps the higher-specificity agent chrome on the same scoped workbench token', () => {
    const selector = ":root[data-shell-design='agent'] .shell-normal-workspace .shell-workbench--right";
    expect(rules(boardCss, selector).join('\n')).toContain('background: var(--color-workbench);');
    expect(rules(boardCss, selector).join('\n')).not.toContain('background: var(--color-surface);');
  });

  it('prevents wallpaper-specific rules from restoring the mismatched surface ramp', () => {
    for (const rule of rules(css, ":root[data-image-theme='active'] .shell-workbench--right")) {
      for (const alias of aliases) {
        const declaration = rule.match(new RegExp(`${alias}:\\s*([^;]+);`));
        if (declaration) expect(declaration[1]).toBe('var(--color-sidebar)');
      }
    }
  });

  it('keeps the file toolbar, editor and syntax preview on their scoped canvas tokens', () => {
    expect(rules(css, '.shell-file-workbench').join('\n')).toContain('--shell-file-editor-background: var(--color-chat);');
    expect(rules(css, '.shell-file-pane-header').join('\n')).toContain('background: var(--color-chat);');
    expect(rules(codeCss, '.shell-agent-code.shell-beui-code.is-document').join('\n')).toContain('var(--color-chat)');
  });
});
