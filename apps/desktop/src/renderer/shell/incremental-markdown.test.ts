import { describe, expect, it, vi } from 'vitest';
import {
  IncrementalMarkdownParser,
  parseMarkdownTopLevelBlocks,
} from './incremental-markdown.js';

describe('IncrementalMarkdownParser', () => {
  it('freezes all but two top-level blocks and reparses only the unstable tail', () => {
    const parse = vi.fn(parseMarkdownTopLevelBlocks);
    const parser = new IncrementalMarkdownParser(parse);
    const initial = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n\n');

    const first = parser.update(initial);
    const retainedFrozenBlock = first.blocks[0];
    const previousTail = first.blocks.at(-1)?.text ?? '';
    const second = parser.update(`${initial}\n\nzeta`);

    expect(first.blocks.filter((block) => block.frozen)).toHaveLength(3);
    expect(first.blocks.at(-1)).toMatchObject({ frozen: false });
    expect(parse).toHaveBeenNthCalledWith(1, initial);
    expect(parse).toHaveBeenNthCalledWith(2, `${previousTail}\n\nzeta`);
    expect(second.blocks[0]).toBe(retainedFrozenBlock);
    expect(second.blocks.filter((block) => block.frozen)).toHaveLength(4);
    expect(second.blocks.map((block) => block.text).join('')).toBe(`${initial}\n\nzeta`);
  });

  it('returns the cached snapshot when no stream text changed', () => {
    const parse = vi.fn(parseMarkdownTopLevelBlocks);
    const parser = new IncrementalMarkdownParser(parse);
    const first = parser.update('alpha\n\nbeta');
    const second = parser.update('alpha\n\nbeta');

    expect(second).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('resets frozen state when content is replaced instead of appended', () => {
    const parser = new IncrementalMarkdownParser();
    parser.update('one\n\ntwo\n\nthree\n\nfour');
    const replacement = parser.update('# replacement');

    expect(replacement.blocks).toEqual([
      expect.objectContaining({ text: '# replacement', frozen: false }),
    ]);
  });
});
