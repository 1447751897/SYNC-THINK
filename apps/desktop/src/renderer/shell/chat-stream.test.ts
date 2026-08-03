import { describe, expect, it } from 'vitest';
import type { Event, RunId, TaskId } from '@sync-think/shared';
import {
  applyConversationStreamOperations,
  collectConversationStreamBatch,
  projectConversationRunActivity,
  selectLatestRunPauseNotice,
} from './chat-stream.js';

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
    expect(applyConversationStreamOperations(null, batch.operations)).toBeNull();
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
          type: 'message.reasoning_delta',
          runId: 'run-new',
          threadId: 'thread-a',
          payload: { reasoningDelta: '新思考' },
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

    expect(applyConversationStreamOperations(null, batch.operations)).toEqual({
      runId: 'run-new',
      text: '新回答',
      reasoningText: '新思考',
      timestamp: new Date(4_000).toISOString(),
    });
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

  it('treats run.paused as terminal and clears the active draft', () => {
    const batch = collectConversationStreamBatch({
      afterSequence: 0,
      threadId: 'thread-a',
      taskId: 'task-a',
      events: [
        event({
          sequence: 1,
          type: 'message.reasoning_delta',
          runId: 'run-a',
          threadId: 'thread-a',
          payload: { reasoningDelta: 'thinking' },
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
    expect(applyConversationStreamOperations(null, batch.operations)).toBeNull();
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
    expect(notice?.text).toContain('??????????????');
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
});
