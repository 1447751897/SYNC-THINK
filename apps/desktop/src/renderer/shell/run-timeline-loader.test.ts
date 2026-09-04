import { describe, expect, it, vi } from 'vitest';
import type { ConversationListRunTimelineResponse } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import {
  loadRunTimelinePage,
  mergeRunTimelineSegments,
  RUN_TIMELINE_PAGE_LIMIT,
} from './run-timeline-loader.js';

describe('run timeline lazy loading', () => {
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
