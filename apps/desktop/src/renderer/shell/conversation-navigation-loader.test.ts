import { describe, expect, it, vi } from 'vitest';
import type { MessageNavigationEntry } from '@sync-think/shared';
import type { ConversationListNavigationResponse } from '@sync-think/protocol';
import { ConversationNavigationLoader } from './conversation-navigation-loader.js';

const entry = (sequence: number): MessageNavigationEntry => ({
  id: `message-${sequence}` as MessageNavigationEntry['id'],
  sequence,
  role: 'assistant',
  text: `answer ${sequence}`,
  createdAt: '2026-09-05T00:00:00Z',
});

describe('complete lightweight navigation directory', () => {
  it('batches intermediate directory renders without dropping any metadata pages', async () => {
    vi.useFakeTimers();
    const change = vi.fn();
    const load = vi.fn(async (cursor?: number) => {
      const sequence = cursor === undefined ? 99 : cursor - 1;
      return {
        entries: [entry(sequence)],
        hasMore: sequence > 0,
        ...(sequence > 0 ? { nextCursor: sequence } : {}),
      };
    });
    const loader = new ConversationNavigationLoader({ load, onChange: change });
    try {
      const pending = loader.refresh();
      await vi.runAllTimersAsync();
      await pending;
      expect(load).toHaveBeenCalledTimes(100);
      expect(change.mock.calls.length).toBeLessThan(5);
      expect(change.mock.lastCall?.[0]).toMatchObject({ complete: true, loading: false });
      expect(change.mock.lastCall?.[0].entries).toHaveLength(100);
    } finally {
      loader.dispose();
      vi.useRealTimers();
    }
  });
  it('walks all metadata pages, then refreshes only the changed head without refetching complete history', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ entries: [entry(90), entry(100)], hasMore: true, nextCursor: 90 })
      .mockResolvedValueOnce({ entries: [entry(1), entry(2)], hasMore: false })
      .mockResolvedValueOnce({ entries: [entry(100), entry(101)], hasMore: true, nextCursor: 100 });
    const change = vi.fn();
    const loader = new ConversationNavigationLoader({ load, onChange: change });
    await loader.refresh();
    expect(change.mock.lastCall?.[0]).toMatchObject({
      loading: false,
      complete: true,
      error: false,
    });
    expect(
      change.mock.lastCall?.[0].entries.map((item: MessageNavigationEntry) => item.sequence),
    ).toEqual([1, 2, 90, 100]);
    await loader.refresh();
    expect(load).toHaveBeenCalledTimes(3);
    expect(change.mock.lastCall?.[0].entries.at(-1).sequence).toBe(101);
    loader.dispose();
  });

  it('retains progress after a failure and fills an actual missing interval on retry', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ entries: [entry(90), entry(100)], hasMore: true, nextCursor: 90 })
      .mockRejectedValueOnce(new Error('private backend detail'))
      .mockResolvedValueOnce({ entries: [entry(100), entry(101)], hasMore: true, nextCursor: 100 })
      .mockResolvedValueOnce({ entries: [entry(1), entry(2)], hasMore: false });
    const change = vi.fn();
    const loader = new ConversationNavigationLoader({ load, onChange: change });
    await loader.refresh();
    expect(change.mock.lastCall?.[0]).toMatchObject({ error: true, complete: false });
    await loader.refresh();
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 90, undefined, 90]);
    expect(change.mock.lastCall?.[0]).toMatchObject({ error: false, complete: true });
    loader.dispose();
  });

  it('does not apply old responses after disposal or loop on a repeated cursor', async () => {
    let resolve!: (value: ConversationListNavigationResponse) => void;
    const change = vi.fn();
    const loader = new ConversationNavigationLoader({
      load: vi.fn(
        () =>
          new Promise<ConversationListNavigationResponse>((finish) => {
            resolve = finish;
          }),
      ),
      onChange: change,
    });
    const pending = loader.refresh();
    loader.dispose();
    const calls = change.mock.calls.length;
    resolve({ entries: [entry(1)], hasMore: false });
    await pending;
    expect(change).toHaveBeenCalledTimes(calls);
    const invalid = new ConversationNavigationLoader({
      load: async () => ({ entries: [entry(5)], hasMore: true, nextCursor: 6 }),
      onChange: change,
    });
    await invalid.refresh();
    expect(change.mock.lastCall?.[0]).toMatchObject({ error: true });
    invalid.dispose();
  });
});
