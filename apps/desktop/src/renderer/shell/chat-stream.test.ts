import { describe, expect, it } from 'vitest';
import type { Event, RunId, TaskId } from '@sync-think/shared';
import {
  applyConversationStreamOperations,
  collectConversationStreamBatch,
  projectConversationRunActivity,
  selectLatestRunConnectionStatus,
  selectLatestRunPauseNotice,
} from './chat-stream.js';
import type { RunActivityAuthority } from '../run-activity-authority.js';

function event(input: {
  sequence: number;
  type: string;
  runId?: string;
  threadId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}): Event {
  return {
    id: `event-${input.sequence}` as Event['id'],
    workspaceId: 'workspace-1' as Event['workspaceId'],
    taskId: input.taskId as TaskId | undefined,
    runId: input.runId as RunId | undefined,
    category: 'message',
    type: input.type,
    occurredAt: new Date(input.sequence * 1_000).toISOString(),
    payload: {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...input.payload,
    },
    sequence: input.sequence,
  };
}

describe('conversation stream event consumption', () => {
  const authority = (
    throughSequence: number,
    activeRunIds: readonly string[] = [],
  ): RunActivityAuthority => ({
    throughSequence,
    activeRunIds: new Set(activeRunIds),
  });

  it('observes terminal events even when a later non-terminal event is last', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 0,
      threadId: 'thread-a',
      taskId: 'task-a',
      events: [
        event({
          sequence: 1,
          type: 'message.delta',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { textDelta: '完成' },
        }),
        event({ sequence: 2, type: 'run.completed', runId: 'run-a', threadId: 'thread-a' }),
        event({ sequence: 3, type: 'provider.usage', runId: 'run-a', taskId: 'task-a' }),
      ],
    });

    expect(batch.maxSeenSequence).toBe(3);
    expect(batch.sawTerminalEvent).toBe(true);
    expect(applyConversationStreamOperations(null, batch.operations)).toEqual({
      runId: 'run-a',
      text: '完成',
      timestamp: new Date(1_000).toISOString(),
      terminal: true,
    });
  });

  it('keeps a newer run draft separate from an older completed run in the same batch', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 0,
      threadId: 'thread-a',
      taskId: 'task-a',
      events: [
        event({
          sequence: 1,
          type: 'message.delta',
          runId: 'run-old',
          threadId: 'thread-a',
          payload: { textDelta: '旧回答' },
        }),
        event({ sequence: 2, type: 'run.completed', runId: 'run-old', threadId: 'thread-a' }),
        event({
          sequence: 3,
          type: 'message.commentary_delta',
          runId: 'run-new',
          threadId: 'thread-a',
          payload: { textDelta: '正在检查新任务。' },
        }),
        event({
          sequence: 4,
          type: 'message.delta',
          runId: 'run-new',
          threadId: 'thread-a',
          payload: { textDelta: '新回答' },
        }),
      ],
    });

    const draft = applyConversationStreamOperations(null, batch.operations);
    expect(draft).toMatchObject({
      runId: 'run-new',
      text: '新回答',
      commentaryText: '正在检查新任务。',
      timestamp: new Date(4_000).toISOString(),
    });
    expect(draft?.commentarySegments).toEqual([
      {
        id: 'commentary-3-0',
        text: '正在检查新任务。',
        startedAt: new Date(3_000).toISOString(),
        completedAt: new Date(4_000).toISOString(),
        afterSequence: 3,
      },
    ]);
  });

  it('projects run.paused as no longer streaming', () => {
    expect(
      projectConversationRunActivity({
        events: [
          event({ sequence: 1, type: 'run.started', runId: 'run-a', threadId: 'thread-a' }),
          event({ sequence: 2, type: 'run.paused', runId: 'run-a', threadId: 'thread-a' }),
        ],
        threadId: 'thread-a',
        taskId: 'task-a',
      }),
    ).toEqual({ streaming: false, activeRunId: undefined });
  });

  it('ignores an orphan run from replay when Runtime reports no matching in-flight id', () => {
    expect(
      projectConversationRunActivity({
        events: [
          event({
            sequence: 8,
            type: 'run.started',
            runId: 'run-orphan',
            threadId: 'thread-a',
          }),
        ],
        threadId: 'thread-a',
        taskId: 'task-a',
        authority: authority(10),
      }),
    ).toEqual({ streaming: false, activeRunId: undefined });
  });

  it('keeps an in-flight replayed run and permits a new run beyond the health boundary', () => {
    expect(
      projectConversationRunActivity({
        events: [
          event({
            sequence: 8,
            type: 'run.started',
            runId: 'run-active',
            threadId: 'thread-a',
          }),
        ],
        threadId: 'thread-a',
        authority: authority(10, ['run-active']),
      }),
    ).toEqual({ streaming: true, activeRunId: 'run-active' });

    expect(
      projectConversationRunActivity({
        events: [
          event({
            sequence: 8,
            type: 'run.started',
            runId: 'run-orphan',
            threadId: 'thread-a',
          }),
          event({
            sequence: 11,
            type: 'run.started',
            runId: 'run-new',
            threadId: 'thread-a',
          }),
        ],
        threadId: 'thread-a',
        authority: authority(10),
      }),
    ).toEqual({ streaming: true, activeRunId: 'run-new' });
  });

  it('treats run.paused as terminal while retaining the active draft', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 0,
      threadId: 'thread-a',
      taskId: 'task-a',
      events: [
        event({
          sequence: 1,
          type: 'message.commentary_delta',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { textDelta: '正在分析失败原因。' },
        }),
        event({
          sequence: 2,
          type: 'run.paused',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { reason: 'fallback_exhausted', failureClass: 'transient' },
        }),
      ],
    });

    expect(batch.sawTerminalEvent).toBe(true);
    const draft = applyConversationStreamOperations(null, batch.operations);
    expect(draft).toMatchObject({
      runId: 'run-a',
      text: '',
      commentaryText: '正在分析失败原因。',
      timestamp: new Date(1_000).toISOString(),
      terminal: true,
    });
    expect(draft?.commentarySegments?.[0]).toMatchObject({
      text: '正在分析失败原因。',
      completedAt: new Date(2_000).toISOString(),
    });
  });

  it('splits commentary around a durable tool boundary', () => {
    const draft = applyConversationStreamOperations(null, [
      {
        type: 'commentary.delta',
        runId: 'run-a',
        delta: '先分析',
        occurredAt: new Date(1_000).toISOString(),
        sequence: 1,
        afterSequence: 0,
      },
      {
        type: 'process.boundary',
        runId: 'run-a',
        occurredAt: new Date(2_000).toISOString(),
        sequence: 2,
      },
      {
        type: 'commentary.delta',
        runId: 'run-a',
        delta: '再继续',
        occurredAt: new Date(3_000).toISOString(),
        sequence: 3,
        afterSequence: 2,
      },
    ]);

    expect(draft?.commentarySegments).toEqual([
      {
        id: 'commentary-0-0',
        text: '先分析',
        startedAt: new Date(1_000).toISOString(),
        completedAt: new Date(2_000).toISOString(),
        afterSequence: 0,
      },
      {
        id: 'commentary-2-1',
        text: '再继续',
        startedAt: new Date(3_000).toISOString(),
        afterSequence: 2,
      },
    ]);
  });

  it('drops an empty draft when its run reaches a terminal state', () => {
    expect(
      applyConversationStreamOperations(
        {
          runId: 'run-a',
          text: '   ',
          commentaryText: '\n',
          timestamp: new Date(1_000).toISOString(),
        },
        [{ type: 'run.terminal', runId: 'run-a', sequence: 2 }],
      ),
    ).toBeNull();
  });

  it('builds an actionable pause notice only for the latest lifecycle state', () => {
    const paused = event({
      sequence: 2,
      type: 'run.paused',
      runId: 'run-a',
      threadId: 'thread-a',
      payload: {
        reason: 'fallback_exhausted',
        failureClass: 'transient',
        providerModelId: 'grok-4.5',
        errorMessage: 'Provider Responses call failed (503)',
      },
    });
    const notice = selectLatestRunPauseNotice({
      events: [
        event({ sequence: 1, type: 'run.started', runId: 'run-a', threadId: 'thread-a' }),
        paused,
      ],
      threadId: 'thread-a',
      taskId: 'task-a',
    });

    expect(notice).toMatchObject({ runId: 'run-a', tone: 'error' });
    expect(notice?.text).toContain('备用模型已全部尝试');
    expect(notice?.text).toContain('503');

    expect(
      selectLatestRunPauseNotice({
        events: [
          paused,
          event({ sequence: 3, type: 'run.started', runId: 'run-b', threadId: 'thread-a' }),
        ],
        threadId: 'thread-a',
      }),
    ).toBeUndefined();
  });

  it('shows retry and fallback status only until the active run makes progress', () => {
    const retrying = event({
      sequence: 2,
      type: 'run.retrying',
      runId: 'run-a',
      threadId: 'thread-a',
      payload: {
        attempt: 4,
        maxAttempts: 5,
        providerModelId: 'luna',
      },
    });
    expect(
      selectLatestRunConnectionStatus({
        events: [
          event({ sequence: 1, type: 'run.started', runId: 'run-a', threadId: 'thread-a' }),
          retrying,
        ],
        threadId: 'thread-a',
        activeRunId: 'run-a',
      }),
    ).toMatchObject({
      runId: 'run-a',
      text: '\u6b63\u5728\u91cd\u65b0\u8fde\u63a5 4/5',
    });

    const fallback = event({
      sequence: 3,
      type: 'run.fallback.selected',
      runId: 'run-a',
      threadId: 'thread-a',
      payload: {
        fromProviderModelId: 'luna',
        toProviderModelId: 'backup',
      },
    });
    expect(
      selectLatestRunConnectionStatus({
        events: [retrying, fallback],
        threadId: 'thread-a',
        activeRunId: 'run-a',
      }),
    ).toMatchObject({
      runId: 'run-a',
      text: '\u6b63\u5728\u5207\u6362\u5907\u7528\u6a21\u578b\uff1aluna \u2192 backup',
    });

    expect(
      selectLatestRunConnectionStatus({
        events: [
          fallback,
          event({
            sequence: 4,
            type: 'message.commentary_delta',
            runId: 'run-a',
            threadId: 'thread-a',
            payload: { textDelta: '继续执行。' },
          }),
        ],
        threadId: 'thread-a',
        activeRunId: 'run-a',
      }),
    ).toBeUndefined();

    expect(
      selectLatestRunConnectionStatus({
        events: [
          fallback,
          event({ sequence: 4, type: 'run.completed', runId: 'run-a', threadId: 'thread-a' }),
        ],
        threadId: 'thread-a',
        activeRunId: 'run-a',
      }),
    ).toBeUndefined();

    expect(
      selectLatestRunConnectionStatus({
        events: [
          fallback,
          event({ sequence: 4, type: 'run.started', runId: 'run-b', threadId: 'thread-a' }),
        ],
        threadId: 'thread-a',
      }),
    ).toBeUndefined();

    expect(
      selectLatestRunConnectionStatus({
        events: [fallback],
        threadId: 'thread-a',
        activeRunId: 'run-a',
        streamingMessage: {
          runId: 'run-a',
          timestamp: new Date(4_000).toISOString(),
        },
      }),
    ).toBeUndefined();

    expect(
      selectLatestRunConnectionStatus({
        events: [fallback],
        threadId: 'thread-a',
        activeRunId: 'run-b',
      }),
    ).toBeUndefined();
  });

  it('advances the global cursor while ignoring another conversation events', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 5,
      threadId: 'thread-a',
      taskId: 'task-a',
      events: [
        event({
          sequence: 6,
          type: 'message.delta',
          runId: 'run-b',
          threadId: 'thread-b',
          payload: { textDelta: 'other' },
        }),
        event({
          sequence: 7,
          type: 'message.delta',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { delta: 'mine' },
        }),
      ],
    });

    expect(batch.maxSeenSequence).toBe(7);
    expect(batch.operations).toHaveLength(1);
    expect(applyConversationStreamOperations(null, batch.operations)?.text).toBe('mine');
  });

  it('keeps provider reasoning diagnostics out of the user-visible draft', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 0,
      threadId: 'thread-a',
      events: [
        event({
          sequence: 1,
          type: 'message.reasoning_delta',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { textDelta: 'internal diagnostic summary' },
        }),
      ],
    });

    expect(batch.operations).toEqual([]);
    expect(applyConversationStreamOperations(null, batch.operations)).toBeNull();
  });
});
