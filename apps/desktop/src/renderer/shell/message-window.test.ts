import { describe, expect, it } from 'vitest';
import {
  buildMessageOffsets,
  calculateMessageWindow,
  inferNativeScrollIntent,
  preservePrependScrollTop,
  resolveBottomPinState,
  shouldRestorePrependAnchor,
  MESSAGE_WINDOW_ESTIMATED_HEIGHT,
} from './message-window.js';

describe('message windowing', () => {
  it('keeps a thousand-message conversation to a bounded render range', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `message-${index}`);
    const range = calculateMessageWindow({
      ids,
      measuredHeights: new Map(),
      scrollTop: 100_000,
      viewportHeight: 800,
      overscanPx: 800,
    });
    expect(range.endIndex - range.startIndex).toBeLessThan(20);
    expect(range.topSpacer + range.bottomSpacer).toBeGreaterThan(0);
    expect(range.totalHeight).toBe(1_000 * MESSAGE_WINDOW_ESTIMATED_HEIGHT);
  });

  it('uses measured dynamic heights and preserves total spacer geometry', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const heights = new Map([
      ['a', 100],
      ['b', 400],
      ['c', 50],
      ['d', 250],
    ]);
    expect(buildMessageOffsets(ids, heights)).toEqual([0, 100, 500, 550, 800]);
    const range = calculateMessageWindow({
      ids,
      measuredHeights: heights,
      scrollTop: 450,
      viewportHeight: 50,
      overscanPx: 0,
    });
    expect(range).toEqual({
      startIndex: 1,
      endIndex: 2,
      topSpacer: 100,
      bottomSpacer: 300,
      totalHeight: 800,
    });
  });

  it('preserves the exact viewport anchor when older messages are prepended', () => {
    expect(
      preservePrependScrollTop({
        previousScrollTop: 37,
        previousScrollHeight: 1_000,
        nextScrollHeight: 1_720,
      }),
    ).toBe(757);
    expect(
      preservePrependScrollTop({
        previousScrollTop: 0,
        previousScrollHeight: 1_000,
        nextScrollHeight: 800,
      }),
    ).toBe(0);
  });

  it('does not reactivate bottom pinning from layout-only scroll events', () => {
    expect(
      resolveBottomPinState({
        currentlyPinned: false,
        distanceFromBottom: 0,
        userIntent: null,
      }),
    ).toBe(false);
    expect(
      resolveBottomPinState({
        currentlyPinned: false,
        distanceFromBottom: 20,
        userIntent: 'toward-bottom',
      }),
    ).toBe(true);
    expect(
      resolveBottomPinState({
        currentlyPinned: true,
        distanceFromBottom: 120,
        userIntent: null,
      }),
    ).toBe(false);
  });

  it('releases bottom pinning on the first explicit upward gesture', () => {
    expect(
      resolveBottomPinState({
        currentlyPinned: true,
        distanceFromBottom: 10,
        userIntent: 'away-from-bottom',
      }),
    ).toBe(false);
  });

  it('infers native scrollbar direction without requiring wheel events', () => {
    expect(
      inferNativeScrollIntent({ previousScrollTop: 600, nextScrollTop: 420 }),
    ).toBe('away-from-bottom');
    expect(
      inferNativeScrollIntent({ previousScrollTop: 420, nextScrollTop: 600 }),
    ).toBe('toward-bottom');
    expect(
      inferNativeScrollIntent({ previousScrollTop: 420, nextScrollTop: 420.2 }),
    ).toBeNull();
  });

  it('cancels stale prepend restoration after the user keeps scrolling', () => {
    expect(
      shouldRestorePrependAnchor({
        capturedUserScrollRevision: 4,
        currentUserScrollRevision: 4,
        hasAnchor: true,
      }),
    ).toBe(true);
    expect(
      shouldRestorePrependAnchor({
        capturedUserScrollRevision: 4,
        currentUserScrollRevision: 5,
        hasAnchor: true,
      }),
    ).toBe(false);
    expect(
      shouldRestorePrependAnchor({
        capturedUserScrollRevision: 4,
        currentUserScrollRevision: 4,
        hasAnchor: false,
      }),
    ).toBe(false);
  });

  it('always mounts at least one item and handles empty conversations', () => {
    expect(
      calculateMessageWindow({
        ids: [],
        measuredHeights: new Map(),
        scrollTop: 0,
        viewportHeight: 0,
      }),
    ).toEqual({ startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0, totalHeight: 0 });
    const one = calculateMessageWindow({
      ids: ['only'],
      measuredHeights: new Map(),
      scrollTop: 10_000,
      viewportHeight: 0,
      overscanPx: 0,
    });
    expect(one.endIndex - one.startIndex).toBe(1);
  });
});
