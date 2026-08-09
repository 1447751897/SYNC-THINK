/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  CONVERSATION_LAST_SEEN_KEY,
  buildConversationActivity,
  buildWorkspaceActivity,
  isConversationUnread,
  markConversationSeen,
  readConversationLastSeen,
  writeConversationLastSeen,
} from './conversation-activity.js';
import type { RunActivityAuthority } from './run-activity-authority.js';

function runEvent(sequence: number, type: string, threadId: string): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-desktop' as Event['workspaceId'],
    category: 'run',
    type,
    sequence,
    occurredAt: `2026-07-11T08:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    payload: { threadId },
  };
}

describe('buildConversationActivity', () => {
  const authority = (
    throughSequence: number,
    activeRunIds: readonly string[] = [],
  ): RunActivityAuthority => ({
    throughSequence,
    activeRunIds: new Set(activeRunIds),
  });

  it('matches real conversations through message.appended task/thread mapping', () => {
    const activity = buildConversationActivity(
      [
        {
          ...runEvent(1, 'message.appended', 'thread-real'),
          taskId: 'VEGWXXYV1JE4KKAXFAFH968PB5' as Event['taskId'],
          category: 'message',
          payload: { threadId: 'thread-real', role: 'user', text: 'hello' },
        },
        runEvent(2, 'run.started', 'thread-real'),
        runEvent(3, 'run.completed', 'thread-real'),
      ],
      [{ id: 'conv-real', taskId: 'VEGWXXYV1JE4KKAXFAFH968PB5' }],
    );
    expect(activity.get('conv-real')).toEqual({
      running: false,
      lastFinishedAt: Date.parse('2026-07-11T08:00:03.000Z'),
      lastFinishedSequence: 3,
    });
  });

  it('marks not running after started → completed and records the finish sequence', () => {
    const activity = buildConversationActivity(
      [runEvent(1, 'run.started', 'task-a'), runEvent(2, 'run.completed', 'task-a')],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    const entry = activity.get('conv-a');
    expect(entry?.running).toBe(false);
    expect(entry?.lastFinishedSequence).toBe(2);
    expect(entry?.lastFinishedAt).toBe(Date.parse('2026-07-11T08:00:02.000Z'));
  });

  it.each(['run.completed', 'run.failed', 'run.cancelled', 'run.paused'])(
    'treats %s as a terminal event',
    (type) => {
      const activity = buildConversationActivity(
        [runEvent(1, 'run.started', 'task-a'), runEvent(2, type, 'task-a')],
        [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
      );
      expect(activity.get('conv-a')?.running).toBe(false);
      expect(activity.get('conv-a')?.lastFinishedSequence).toBe(2);
    },
  );

  it('judges by max sequence even when events arrive out of order', () => {
    const activity = buildConversationActivity(
      [
        runEvent(3, 'run.started', 'task-a'),
        runEvent(1, 'run.started', 'task-a'),
        runEvent(2, 'run.completed', 'task-a'),
      ],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    const entry = activity.get('conv-a');
    expect(entry?.running).toBe(true);
    expect(entry?.lastFinishedSequence).toBe(2);
  });

  it('keeps the latest finish sequence across multiple runs', () => {
    const activity = buildConversationActivity(
      [
        runEvent(1, 'run.started', 'task-a'),
        runEvent(2, 'run.completed', 'task-a'),
        runEvent(3, 'run.started', 'task-a'),
        runEvent(4, 'run.failed', 'task-a'),
      ],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    const entry = activity.get('conv-a');
    expect(entry?.running).toBe(false);
    expect(entry?.lastFinishedSequence).toBe(4);
  });

  it('isolates conversations by taskId', () => {
    const activity = buildConversationActivity(
      [
        runEvent(1, 'run.started', 'task-a'),
        runEvent(2, 'run.started', 'task-b'),
        runEvent(3, 'run.completed', 'task-b'),
      ],
      [
        { id: 'conv-a', taskId: 'task-from-thread:task-a' },
        { id: 'conv-b', taskId: 'task-from-thread:task-b' },
      ],
    );
    expect(activity.get('conv-a')?.running).toBe(true);
    expect(activity.get('conv-b')?.running).toBe(false);
    expect(activity.get('conv-b')?.lastFinishedSequence).toBe(3);
  });

  it('gives idle defaults to conversations with an empty taskId', () => {
    const activity = buildConversationActivity(
      [runEvent(1, 'run.started', 'task-a')],
      [{ id: 'conv-no-task', taskId: '' }],
    );
    expect(activity.get('conv-no-task')).toEqual({
      running: false,
      lastFinishedAt: null,
      lastFinishedSequence: null,
    });
  });

  it('ignores non-lifecycle events such as message.delta', () => {
    const activity = buildConversationActivity(
      [
        runEvent(1, 'run.started', 'task-a'),
        runEvent(2, 'run.completed', 'task-a'),
        runEvent(3, 'message.delta', 'task-a'),
      ],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    expect(activity.get('conv-a')?.running).toBe(false);
    expect(activity.get('conv-a')?.lastFinishedSequence).toBe(2);
  });

  it('ignores a historical orphan run that Runtime no longer reports as active', () => {
    const activity = buildConversationActivity(
      [
        {
          ...runEvent(1, 'message.appended', 'thread-a'),
          taskId: 'task-a' as Event['taskId'],
          category: 'message',
          payload: { threadId: 'thread-a', role: 'user', text: 'hello' },
        },
        {
          ...runEvent(2, 'run.started', 'thread-a'),
          runId: 'run-orphan' as Event['runId'],
        },
      ],
      [{ id: 'conv-a', taskId: 'task-a' }],
      authority(2),
    );

    expect(activity.get('conv-a')).toEqual({
      running: false,
      lastFinishedAt: null,
      lastFinishedSequence: null,
    });
  });

  it('keeps a historical run active when Runtime confirms the same run id', () => {
    const activity = buildConversationActivity(
      [
        {
          ...runEvent(1, 'message.appended', 'thread-a'),
          taskId: 'task-a' as Event['taskId'],
          category: 'message',
          payload: { threadId: 'thread-a', role: 'user', text: 'hello' },
        },
        {
          ...runEvent(2, 'run.started', 'thread-a'),
          runId: 'run-active' as Event['runId'],
        },
      ],
      [{ id: 'conv-a', taskId: 'task-a' }],
      authority(2, ['run-active']),
    );

    expect(activity.get('conv-a')?.running).toBe(true);
  });

  it('lets a newer run start after the Runtime reconciliation boundary', () => {
    const activity = buildConversationActivity(
      [
        {
          ...runEvent(1, 'message.appended', 'thread-a'),
          taskId: 'task-a' as Event['taskId'],
          category: 'message',
          payload: { threadId: 'thread-a', role: 'user', text: 'hello' },
        },
        {
          ...runEvent(2, 'run.started', 'thread-a'),
          runId: 'run-orphan' as Event['runId'],
        },
        {
          ...runEvent(3, 'run.started', 'thread-a'),
          runId: 'run-new' as Event['runId'],
        },
      ],
      [{ id: 'conv-a', taskId: 'task-a' }],
      authority(2),
    );

    expect(activity.get('conv-a')?.running).toBe(true);
  });
});

describe('unread judgement', () => {
  it('is unread after a finish the user has not seen', () => {
    const activity = buildConversationActivity(
      [runEvent(1, 'run.started', 'task-a'), runEvent(2, 'run.completed', 'task-a')],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    expect(isConversationUnread(activity.get('conv-a'), {}, 'conv-a')).toBe(true);
  });

  it('is read after markConversationSeen at the finish sequence', () => {
    const activity = buildConversationActivity(
      [runEvent(1, 'run.started', 'task-a'), runEvent(2, 'run.completed', 'task-a')],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    const seen = markConversationSeen({}, 'conv-a', 2);
    expect(isConversationUnread(activity.get('conv-a'), seen, 'conv-a')).toBe(false);
  });

  it('is not unread while running', () => {
    const activity = buildConversationActivity(
      [
        runEvent(1, 'run.started', 'task-a'),
        runEvent(2, 'run.completed', 'task-a'),
        runEvent(3, 'run.started', 'task-a'),
      ],
      [{ id: 'conv-a', taskId: 'task-from-thread:task-a' }],
    );
    expect(activity.get('conv-a')?.running).toBe(true);
    expect(isConversationUnread(activity.get('conv-a'), {}, 'conv-a')).toBe(false);
  });

  it('is not unread when there is no finish or no activity entry', () => {
    expect(isConversationUnread(undefined, {}, 'conv-a')).toBe(false);
    expect(
      isConversationUnread(
        { running: false, lastFinishedAt: null, lastFinishedSequence: null },
        {},
        'conv-a',
      ),
    ).toBe(false);
  });

  it('markConversationSeen returns a new object on change, same reference otherwise', () => {
    const base = { 'conv-a': 5 };
    const updated = markConversationSeen(base, 'conv-a', 7);
    expect(updated).not.toBe(base);
    expect(updated['conv-a']).toBe(7);
    expect(base['conv-a']).toBe(5);
    // No change: already seen up to a later sequence.
    expect(markConversationSeen(base, 'conv-a', 5)).toBe(base);
    expect(markConversationSeen(base, 'conv-a', 3)).toBe(base);
    // Invalid input: unchanged reference.
    expect(markConversationSeen(base, '', 9)).toBe(base);
    expect(markConversationSeen(base, 'conv-a', Number.NaN)).toBe(base);
  });
});

describe('buildWorkspaceActivity', () => {
  const conversations = [
    { id: 'conv-a', workspaceId: 'ws-1' },
    { id: 'conv-b', workspaceId: 'ws-1' },
    { id: 'conv-c', workspaceId: 'ws-2' },
    { id: 'conv-orphan' },
  ];

  it('aggregates running and unread across conversations of a workspace', () => {
    const activity = new Map([
      ['conv-a', { running: true, lastFinishedAt: null, lastFinishedSequence: null }],
      ['conv-b', { running: false, lastFinishedAt: 1000, lastFinishedSequence: 4 }],
      ['conv-c', { running: false, lastFinishedAt: 2000, lastFinishedSequence: 9 }],
    ]);
    const result = buildWorkspaceActivity(conversations, activity, { 'conv-c': 9 });
    expect(result.get('ws-1')).toEqual({ running: true, unread: true });
    expect(result.get('ws-2')).toEqual({ running: false, unread: false });
    expect(result.has('undefined')).toBe(false);
  });

  it('reports idle workspaces when nothing runs and everything is seen', () => {
    const activity = new Map([
      ['conv-a', { running: false, lastFinishedAt: 1000, lastFinishedSequence: 2 }],
    ]);
    const result = buildWorkspaceActivity(conversations, activity, { 'conv-a': 2 });
    expect(result.get('ws-1')).toEqual({ running: false, unread: false });
  });
});

describe('conversation last-seen persistence (localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the last-seen map through localStorage', () => {
    writeConversationLastSeen({ 'conv-a': 12, 'conv-b': 3 });
    expect(readConversationLastSeen()).toEqual({ 'conv-a': 12, 'conv-b': 3 });
  });

  it('returns {} when the key is absent', () => {
    expect(readConversationLastSeen()).toEqual({});
  });

  it('returns {} on invalid JSON or non-object payloads', () => {
    window.localStorage.setItem(CONVERSATION_LAST_SEEN_KEY, '{not-json');
    expect(readConversationLastSeen()).toEqual({});
    window.localStorage.setItem(CONVERSATION_LAST_SEEN_KEY, '[1,2]');
    expect(readConversationLastSeen()).toEqual({});
  });

  it('filters malformed entries on read', () => {
    window.localStorage.setItem(
      CONVERSATION_LAST_SEEN_KEY,
      JSON.stringify({ 'conv-a': 7, 'conv-bad': 'x', '': 9, 'conv-nan': null }),
    );
    expect(readConversationLastSeen()).toEqual({ 'conv-a': 7 });
  });

  it('swallows storage errors instead of throwing', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readConversationLastSeen(throwing)).toEqual({});
    expect(() => writeConversationLastSeen({ 'conv-a': 1 }, throwing)).not.toThrow();
  });
});
