import { describe, expect, it, vi } from 'vitest';
import {
  ConversationCompactBoundaryCache,
  type CompactBoundaryEvent,
} from './conversation-compact-boundary-cache.js';

function event(
  sequence: number,
  summaryText: unknown,
  overrides: Partial<CompactBoundaryEvent> = {},
): CompactBoundaryEvent {
  return {
    type: 'context.compacted',
    payload: { threadId: 'thread-a', summaryText },
    occurredAt: `2026-09-20T00:00:0${sequence}.000Z`,
    sequence,
    ...overrides,
  };
}

describe('conversation compact boundary cache', () => {
  it('restores the latest valid compact boundary by event sequence', () => {
    const cache = new ConversationCompactBoundaryCache({
      loadEvents: () => [
        event(3, ' newest '),
        event(1, 'oldest'),
        event(4, 'ignored', { type: 'other' }),
        event(5, '   '),
        event(2, 'middle'),
      ],
    });

    expect(cache.get('thread-a')).toEqual({
      summaryText: 'newest',
      compactedAt: '2026-09-20T00:00:03.000Z',
    });
  });

  it('ignores compact events owned by another thread', () => {
    const cache = new ConversationCompactBoundaryCache({
      loadEvents: () => [
        event(1, 'other', { payload: { threadId: 'thread-b', summaryText: 'other' } }),
      ],
    });

    expect(cache.get('thread-a')).toBeUndefined();
  });

  it('caches restored boundaries', () => {
    const loadEvents = vi.fn(() => [event(1, 'summary')]);
    const cache = new ConversationCompactBoundaryCache({ loadEvents });

    expect(cache.get('thread-a')?.summaryText).toBe('summary');
    expect(cache.get('thread-a')?.summaryText).toBe('summary');
    expect(loadEvents).toHaveBeenCalledOnce();
  });

  it('records boundaries without loading events and isolates references', () => {
    const loadEvents = vi.fn(() => []);
    const cache = new ConversationCompactBoundaryCache({ loadEvents });
    const boundary = { summaryText: 'summary', compactedAt: '2026-09-20T00:00:00.000Z' };

    cache.record('thread-a', boundary);
    boundary.summaryText = 'changed';
    const restored = cache.get('thread-a')!;
    restored.summaryText = 'also changed';

    expect(cache.get('thread-a')?.summaryText).toBe('summary');
    expect(loadEvents).not.toHaveBeenCalled();
  });
});
