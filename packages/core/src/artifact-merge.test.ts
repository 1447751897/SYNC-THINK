import { describe, expect, it } from 'vitest';
import { compareTextSnapshots, mergeTextSnapshots } from './artifact-merge.js';

describe('artifact text comparison', () => {
  it('returns a deterministic single-hunk diff', () => {
    const input = {
      left: 'alpha\nleft\nomega',
      right: 'alpha\nright\nomega',
    };

    const first = compareTextSnapshots(input);
    const second = compareTextSnapshots(input);

    expect(second).toEqual(first);
    expect(first).toEqual({
      kind: 'text',
      equal: false,
      hunks: [
        {
          leftStartLine: 2,
          rightStartLine: 2,
          removedLines: ['left'],
          addedLines: ['right'],
        },
      ],
    });
  });
});

describe('artifact text merge', () => {
  it.each([
    {
      name: 'accepts identical branches',
      input: { base: 'base', left: 'same', right: 'same' },
      content: 'same',
      source: 'both',
    },
    {
      name: 'selects right when left is unchanged',
      input: { base: 'base', left: 'base', right: 'right' },
      content: 'right',
      source: 'right',
    },
    {
      name: 'selects left when right is unchanged',
      input: { base: 'base', left: 'left', right: 'base' },
      content: 'left',
      source: 'left',
    },
  ])('$name', ({ input, content, source }) => {
    expect(mergeTextSnapshots(input)).toEqual({ status: 'clean', content, source });
  });

  it('returns a conflict instead of using last-write-wins', () => {
    expect(mergeTextSnapshots({ base: 'base', left: 'left', right: 'right' })).toEqual({
      status: 'conflict',
      base: 'base',
      left: 'left',
      right: 'right',
    });
  });

  it('cleanly combines modifications at different base locations', () => {
    expect(
      mergeTextSnapshots({
        base: 'alpha\nbeta\ngamma\ndelta',
        left: 'alpha\nLEFT\ngamma\ndelta',
        right: 'alpha\nbeta\ngamma\nRIGHT',
      }),
    ).toEqual({
      status: 'clean',
      content: 'alpha\nLEFT\ngamma\nRIGHT',
      source: 'both',
    });
  });

  it('cleanly combines a non-overlapping insertion and deletion', () => {
    expect(
      mergeTextSnapshots({
        base: 'alpha\nbeta\ngamma\ndelta',
        left: 'alpha\ninserted\nbeta\ngamma\ndelta',
        right: 'alpha\nbeta\ngamma',
      }),
    ).toEqual({
      status: 'clean',
      content: 'alpha\ninserted\nbeta\ngamma',
      source: 'both',
    });
  });

  it('keeps overlapping modifications as a conflict', () => {
    const input = {
      base: 'alpha\nbeta\ngamma',
      left: 'alpha\nLEFT\ngamma',
      right: 'alpha\nRIGHT\ngamma',
    };

    expect(mergeTextSnapshots(input)).toEqual({ status: 'conflict', ...input });
  });

  it('preserves a trailing newline while combining independent edits', () => {
    expect(
      mergeTextSnapshots({
        base: 'alpha\nbeta\ngamma\n',
        left: 'ALPHA\nbeta\ngamma\n',
        right: 'alpha\nbeta\nGAMMA\n',
      }),
    ).toEqual({
      status: 'clean',
      content: 'ALPHA\nbeta\nGAMMA\n',
      source: 'both',
    });
  });

  it('fails closed when the diff complexity budget is exceeded', () => {
    const base = Array.from({ length: 600 }, (_, index) => `base-${index}`).join('\n');
    const left = Array.from({ length: 600 }, (_, index) => `left-${index}`).join('\n');
    const right = Array.from({ length: 600 }, (_, index) => `right-${index}`).join('\n');

    expect(mergeTextSnapshots({ base, left, right })).toEqual({
      status: 'conflict',
      base,
      left,
      right,
    });
  });
});
