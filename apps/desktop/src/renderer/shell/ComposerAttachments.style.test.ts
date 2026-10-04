import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./composer-attachments.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./ComposerAttachments.tsx', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(selector + ' {');
  return start < 0 ? '' : css.slice(start).match(/^[^{]+\{([^}]+)\}/)?.[1] ?? '';
};

describe('attachment dismiss visibility', () => {
  it('keeps the small badge opaque and legible on white or dark screenshots', () => {
    const badge = rule('.shell-attachment-tile__remove::before');
    expect(rule('.shell-attachment-tile__remove')).toContain('color: var(--color-text);');
    expect(badge).toContain('background: var(--color-overlay);');
    expect(badge).toContain('border: 1px solid var(--color-border-strong);');
    expect(badge).toContain('box-shadow:');
    expect(badge).not.toContain('transparent');
    expect(badge).not.toContain('backdrop-filter');
    expect(css).not.toContain('[data-image] .shell-attachment-tile__remove');
  });

  it('uses an 18px corner badge and 10px cross without shrinking the 24px hit target', () => {
    const button = rule('.shell-attachment-tile__remove');
    expect(button).toContain('width: 24px;');
    expect(button).toContain('height: 24px;');
    expect(button).toContain('top: -6px;');
    expect(button).toContain('right: -6px;');
    expect(button).toContain('box-sizing: border-box;');
    expect(button).toContain('z-index: 2;');
    expect(rule('.shell-attachment-tile__remove::before')).toContain('inset: 3px;');
    expect(source).toContain('<X size={10} strokeWidth={2} aria-hidden="true" />');
  });

  it('reveals the dismiss action only on attachment hover or keyboard focus', () => {
    const button = rule('.shell-attachment-tile__remove');
    expect(button).toContain('opacity: 0;');
    expect(button).toContain('pointer-events: none;');
    expect(button).not.toContain('visibility: hidden');
    expect(button).not.toContain('display: none');
    expect(css).toContain('.shell-attachment-tile:hover .shell-attachment-tile__remove,');
    const reveal = rule('.shell-attachment-tile:has(:focus-visible) .shell-attachment-tile__remove');
    expect(css).not.toContain('.shell-attachment-tile:focus-within .shell-attachment-tile__remove');
    expect(reveal).toContain('opacity: 1;');
    expect(reveal).toContain('pointer-events: auto;');
    expect(rule('.shell-attachment-tile__remove:focus-visible')).toContain(
      'outline: 2px solid var(--color-focus-ring);',
    );
  });

  it('keeps removal reachable on touch devices without hover', () => {
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)\s*\{\s*\.shell-attachment-tile__remove\s*\{[^}]*opacity: 1;[^}]*pointer-events: auto;/);
  });

  it('uses the same hover/focus behavior for pending cancellation', () => {
    expect(css).not.toMatch(/\[data-pending\][^{]*\.shell-attachment-tile__remove\s*\{/);
    expect(css).not.toMatch(/\.shell-attachment-tile__remove[^}]*filter:\s*blur/);
  });

  it('keeps progress visible and separate from the top-right cancel target', () => {
    const progress = rule('.shell-attachment-tile__progress');
    expect(progress).toContain('bottom: 3px;');
    expect(progress).toContain('left: 3px;');
    expect(progress).toContain('background: var(--color-overlay);');
    expect(css).not.toMatch(/:hover[^}]*\.shell-attachment-tile__progress/);
  });
});
