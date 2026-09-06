import { describe, expect, it } from 'vitest';
import {
  mergeHistoryRanges,
  historyRangeGaps,
  mergeHistoryPageMessages,
} from './conversation-history-pages.js';

function page(sequences: number[], hasMore = true) {
  return { sequences, hasMore };
}

describe('sparse conversation history coverage', () => {
  it('treats refreshed page coverage as authoritative without dropping older fetched pages', () => {
    const previous = [
      { id: 'old', sequence: 10 },
      { id: 'stale', sequence: 99 },
      { id: 'tail', sequence: 100 },
    ];
    expect(
      mergeHistoryPageMessages(previous, [{ id: 'replacement', sequence: 99 }], {
        sequences: [99],
        hasMore: true,
        latest: true,
      }),
    ).toEqual([
      { id: 'old', sequence: 10 },
      { id: 'replacement', sequence: 99 },
    ]);
    expect(
      mergeHistoryPageMessages(previous, [{ id: 'only', sequence: 0 }], {
        sequences: [0],
        hasMore: false,
        latest: true,
      }),
    ).toEqual([{ id: 'only', sequence: 0 }]);
    expect(
      mergeHistoryPageMessages(previous, [], { sequences: [], hasMore: false, latest: true }),
    ).toEqual([]);
    expect(
      mergeHistoryPageMessages(previous, [{ id: 'beginning', sequence: 0 }], {
        sequences: [0],
        hasMore: false,
        latest: false,
      }),
    ).toEqual([...previous, { id: 'beginning', sequence: 0 }]);
  });
  it('records an explicit gap instead of pretending distant loaded pages are adjacent', () => {
    let ranges = mergeHistoryRanges([], page([98, 99, 100]));
    ranges = mergeHistoryRanges(ranges, page([10, 11, 12]));
    expect(ranges).toEqual([
      { start: 10, end: 12 },
      { start: 98, end: 100 },
    ]);
    expect(historyRangeGaps(ranges)).toEqual([{ afterSequence: 12, beforeSequence: 98 }]);
  });
  it('closes only the range proved by a cursor read, including absent sequence numbers', () => {
    let ranges = mergeHistoryRanges([], page([90, 100]));
    ranges = mergeHistoryRanges(ranges, page([10, 20]));
    ranges = mergeHistoryRanges(ranges, page([15, 30, 50]), 90);
    expect(ranges).toEqual([{ start: 10, end: 100 }]);
    expect(historyRangeGaps(ranges)).toEqual([]);
  });
  it('preserves old coverage during a latest refresh and recognizes the true beginning', () => {
    let ranges = mergeHistoryRanges([], page([90, 100]));
    ranges = mergeHistoryRanges(ranges, page([3, 4], false));
    ranges = mergeHistoryRanges(ranges, page([98, 100, 101]));
    expect(ranges).toEqual([
      { start: 0, end: 4 },
      { start: 90, end: 101 },
    ]);
    expect(historyRangeGaps(ranges)).toHaveLength(1);
    expect(mergeHistoryRanges(ranges, page([], false), 90)).toEqual([{ start: 0, end: 101 }]);
  });
});
