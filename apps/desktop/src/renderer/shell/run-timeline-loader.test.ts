import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListRunTimelineResponse } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import {
  loadRunTimelinePage,
  mergeRunTimelineSegments,
  RUN_TIMELINE_PAGE_LIMIT,
} from './run-timeline-loader.js';

afterEach(() => vi.useRealTimers());

describe('run timeline lazy loading', () => {
  it('automatically retries a transient failure on the same page', async () => {
    vi.useFakeTimers();
    const page = { segments: [], totalSegments: 0 };
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error('Runtime connection closed'))
      .mockRejectedValueOnce(new Error('SQLITE_BUSY')).mockResolvedValue(page);
    const loaded = loadRunTimelinePage(fetchPage, 'run-1' as RunId, 'page-2');
    await vi.advanceTimersByTimeAsync(1500);
    await expect(loaded).resolves.toEqual(page);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    for (const [payload] of fetchPage.mock.calls) {
      expect(payload).toEqual({ runId: 'run-1', cursor: 'page-2', limit: 64 });
    }
  });

  it('stops retrying after three failed reads and preserves the error', async () => {
    vi.useFakeTimers();
    const error = new Error('Runtime request timed out');
    const fetchPage = vi.fn().mockRejectedValue(error);
    const result = loadRunTimelinePage(fetchPage, 'run-1' as RunId).catch(e => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(error);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('cancels pending retries when the conversation leaves', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchPage = vi.fn().mockRejectedValue(new Error('Runtime connection closed'));
    const result = loadRunTimelinePage(fetchPage, 'run-1' as RunId, undefined, controller.signal)
      .catch(e => e);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).name).toBe('AbortError');
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not repeatedly request malformed or unavailable records', async () => {
    const fetchPage = vi.fn().mockResolvedValue(undefined);
    await expect(loadRunTimelinePage(fetchPage, 'run-1' as RunId))
      .rejects.toThrow('conversation.run_timeline_invalid_response');
    expect(fetchPage).toHaveBeenCalledTimes(1);
    fetchPage.mockReset().mockRejectedValue(new Error('run not found'));
    await expect(loadRunTimelinePage(fetchPage, 'run-1' as RunId)).rejects.toThrow('run not found');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('requests only the selected page', async () => {
    const response: ConversationListRunTimelineResponse = {
      segments: [],
      totalSegments: 128,
      nextCursor: 'page-3',
    };
    const fetchPage = vi.fn().mockResolvedValue(response);

    await expect(loadRunTimelinePage(fetchPage, 'run-1' as RunId, 'page-2')).resolves.toBe(
      response,
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({
      runId: 'run-1',
      cursor: 'page-2',
      limit: RUN_TIMELINE_PAGE_LIMIT,
    });
  });

  it('merges overlapping pages and restores provider order', () => {
    const timeline = mergeRunTimelineSegments(
      [
        {
          id: 'thinking-2',
          sequence: 2,
          kind: 'thinking',
          text: '旧内容',
          status: 'streaming',
        },
        {
          id: 'thinking-1',
          sequence: 1,
          kind: 'thinking',
          text: '分析问题',
          status: 'completed',
        },
      ],
      [
        {
          id: 'thinking-2',
          sequence: 2,
          kind: 'thinking',
          text: '检查实现',
          status: 'completed',
        },
        {
          id: 'tool-3',
          sequence: 3,
          kind: 'tool',
          toolCallId: 'call-3',
          name: 'read_file',
          status: 'completed',
        },
      ],
    );

    expect(timeline.map((segment) => segment.id)).toEqual(['thinking-1', 'thinking-2', 'tool-3']);
    expect(timeline[1]).toMatchObject({ text: '检查实现', status: 'completed' });
  });
});
