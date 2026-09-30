import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellPath = (file: string) => new URL('../src/renderer/shell/' + file, import.meta.url);
const typographyPath = shellPath('workbench-typography.css');
const css = existsSync(typographyPath) ? readFileSync(typographyPath, 'utf8') : '';
const shell = readFileSync(shellPath('shell.css'), 'utf8');
const agents = readFileSync(shellPath('agent-workspace.css'), 'utf8');
const sidebar = readFileSync(shellPath('Sidebar.tsx'), 'utf8');
const source = JSON.parse(
  readFileSync(
    new URL('../../../docs/product/16-shell-design-tokens.json', import.meta.url),
    'utf8',
  ),
);
const ruleFor = (selector: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+){([^{}]+)}/g)]
    .filter((match) => match[1].includes(selector))
    .map((match) => match[2])
    .join('\n');

describe('Agent-aligned conversation typography', () => {
  it('shares the existing agent body scale instead of inventing a second font', () => {
    expect(
      source.groups.find((group: { id: string }) => group.id === 'chat-typography')?.tokens,
    ).toEqual({
      'body-size': '14px',
      'body-line-height': '20px',
      'label-size': '13px',
      'label-line-height': '20px',
      'meta-size': '12px',
      'meta-line-height': '18px',
    });
    expect(agents).toContain('font-family: var(--font-sans)');
    expect(agents).toContain('font-size: var(--chat-font-body-size)');
    expect(agents).toContain('line-height: var(--chat-font-body-line-height)');
  });
  it('loads after the workbench overrides and leaves other products scoped out', () => {
    expect(shell.indexOf("@import './workbench-typography.css'")).toBeGreaterThan(
      shell.indexOf("@import './board-chat.css'"),
    );
    expect(css.length).toBeGreaterThan(0);
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+){/g)) {
      expect(match[1].replace(/\s+/g, ' ')).toContain(
        ":root[data-shell-design='agent'] .shell-normal-workspace",
      );
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|!important|text-shadow|text-stroke/i);
  });
  it('styles the actual inner title rather than just its outer conversation row', () => {
    expect(sidebar).toContain('st-conv-row__title');
    expect(ruleFor('.st-conv-row__title')).toContain('font-size: var(--chat-font-body-size)');
    expect(ruleFor('.st-conv-row__title')).toContain('color: var(--color-text)');
  });
  it('aligns user replies, markdown and editable text with the agent body', () => {
    for (const selector of [
      '.shell-user-bubble',
      '.shell-response__content .shell-md',
      '.cm-content',
      '.cm-scroller',
    ]) {
      expect(ruleFor(selector)).toContain('font-size: var(--chat-font-body-size)');
      expect(ruleFor(selector)).toContain('line-height: var(--chat-font-body-line-height)');
    }
  });
  it('keeps task titles and times readable without changing the task palette', () => {
    expect(ruleFor('.task-cal__event strong')).toContain('font-size: var(--chat-font-label-size)');
    expect(ruleFor('.task-cal__event time')).toContain('font-size: var(--chat-font-meta-size)');
    expect(ruleFor('.task-cal__event time')).toContain('opacity: 1');
    expect(ruleFor('.task-cal__event time')).toContain('color: var(--event-title)');
    expect(css).not.toContain('--event-bg:');
  });
  it('keeps timestamps, weekday labels and footer text at the shared metadata scale', () => {
    for (const selector of [
      '.st-conv-row__time',
      '.task-cal__month-weekday',
      '.task-cal__footer',
    ]) {
      expect(ruleFor(selector)).toContain('font-size: var(--chat-font-meta-size)');
      expect(ruleFor(selector)).toContain('line-height: var(--chat-font-meta-line-height)');
    }
  });
});
