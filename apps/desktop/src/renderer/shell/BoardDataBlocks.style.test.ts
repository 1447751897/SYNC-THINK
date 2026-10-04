import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('production inline data layout', () => {
  it('loads independent data-block CSS from the real Tailwind shell stylesheet entry', () => {
    const shell = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
    const blocks = readFileSync(new URL('./BoardDataBlocks.css', import.meta.url), 'utf8');
    expect(shell).toContain("@import './BoardDataBlocks.css';");
    expect(blocks).toContain('.shell-html.shell-html--data');
    expect(blocks).toContain('contain: none');
    expect(blocks).toContain('.shell-data-block .shell-html__content');
    expect(blocks).toContain('padding: 0');
    expect(blocks).not.toContain('--color-text-muted');
  });
});
