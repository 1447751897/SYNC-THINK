import { describe, expect, it } from 'vitest';
import { diffWordSegments, wordHighlightMap } from './word-diff.js';

function changed(segments: readonly { text: string; changed: boolean }[]): string[] {
  return segments.filter((segment) => segment.changed).map((segment) => segment.text);
}

describe('word-level diff', () => {
  it('marks only the tokens that differ', () => {
    const pair = diffWordSegments('const value = 1;', 'const value = 2;');
    expect(pair).toBeDefined();
    expect(changed(pair!.before)).toEqual(['1']);
    expect(changed(pair!.after)).toEqual(['2']);
  });

  it('keeps whitespace and punctuation out of the highlight when unchanged', () => {
    const pair = diffWordSegments('foo(bar)', 'foo(baz)')!;
    expect(changed(pair.before)).toEqual(['bar']);
    expect(changed(pair.after)).toEqual(['baz']);
    expect(pair.before.map((segment) => segment.text).join('')).toBe('foo(bar)');
    expect(pair.after.map((segment) => segment.text).join('')).toBe('foo(baz)');
  });

  it('pairs each delete run with the following insert run', () => {
    const rows = [
      { kind: 'ctx', text: 'unchanged' },
      { kind: 'del', text: 'alpha = 1;' },
      { kind: 'add', text: 'alpha = 2;' },
      { kind: 'del', text: 'beta = 1;' },
      { kind: 'add', text: 'beta = 2;' },
    ];
    const highlights = wordHighlightMap(rows);
    expect([...highlights.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(changed(highlights.get(1)!)).toEqual(['1']);
    expect(changed(highlights.get(4)!)).toEqual(['2']);
  });

  it('leaves an unmatched delete run without a counterpart', () => {
    const highlights = wordHighlightMap([
      { kind: 'del', text: 'only removed' },
      { kind: 'ctx', text: 'unchanged' },
    ]);
    expect(highlights.size).toBe(0);
  });

  it('degrades instead of exploding on very long lines', () => {
    const long = Array.from({ length: 500 }, (_, index) => `token${index}`).join(' ');
    expect(diffWordSegments(long, long.replace('token0', 'changed'))).toBeUndefined();
  });
});
