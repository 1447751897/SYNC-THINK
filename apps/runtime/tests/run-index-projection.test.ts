import type { Event } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import { projectRunIndexUpsert, RUN_INDEX_EVENT_TYPES } from '../src/run-index-projection.js';

const scrub = (message: string) => message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1' as Event['id'],
    workspaceId: 'workspace-1',
    runId: 'run-1',
    category: 'run',
    type: 'run.started',
    sequence: 1,
    occurredAt: '2026-08-21T00:00:00.000Z',
    payload: { threadId: 'conv-1', kernelId: 'codex', modelId: 'gpt-5' },
    ...overrides,
  } as Event;
}

function project(input: Event) {
  return projectRunIndexUpsert({ event: input, fallbackWorkspaceId: 'fallback-ws', scrub });
}

describe('projectRunIndexUpsert', () => {
  it('projects run.started as a running chat run', () => {
    const result = project(event());
    expect(result).toMatchObject({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      conversationId: 'conv-1',
      source: 'chat',
      state: 'running',
      kernelId: 'codex',
      modelId: 'gpt-5',
      startedAt: '2026-08-21T00:00:00.000Z',
    });
    expect(result?.finishedAt).toBeUndefined();
  });

  it('ignores events outside the run lifecycle vocabulary', () => {
    expect(project(event({ type: 'message.appended', category: 'message' }))).toBeUndefined();
    expect(project(event({ type: 'tool.completed' }))).toBeUndefined();
  });

  it('ignores a lifecycle event with no runId', () => {
    expect(project(event({ runId: undefined }))).toBeUndefined();
  });

  it('covers every advertised event type', () => {
    for (const type of RUN_INDEX_EVENT_TYPES) {
      expect(project(event({ type }))).toBeDefined();
    }
  });

  it('projects terminal states with a finish timestamp', () => {
    const completed = project(
      event({ type: 'run.completed', occurredAt: '2026-08-21T00:01:00.000Z' }),
    );
    expect(completed?.state).toBe('completed');
    expect(completed?.finishedAt).toBe('2026-08-21T00:01:00.000Z');

    const cancelled = project(event({ type: 'run.cancelled' }));
    expect(cancelled?.state).toBe('cancelled');
    expect(cancelled?.finishedAt).toBe('2026-08-21T00:00:00.000Z');
  });

  it('does not set finishedAt for a paused run', () => {
    const paused = project(event({ type: 'run.paused' }));
    expect(paused?.state).toBe('paused');
    expect(paused?.finishedAt).toBeUndefined();
  });

  it('only starting events contribute startedAt', () => {
    // A later event must not be able to move the run's start time.
    expect(project(event({ type: 'run.started' }))?.startedAt).toBe('2026-08-21T00:00:00.000Z');
    expect(project(event({ type: 'run.completed' }))?.startedAt).toBeUndefined();
    expect(project(event({ type: 'run.failed' }))?.startedAt).toBeUndefined();
  });

  it('treats recovery and retry as running again', () => {
    expect(project(event({ type: 'run.recovered' }))?.state).toBe('running');
    expect(project(event({ type: 'run.retrying' }))?.state).toBe('running');
  });

  it('scrubs the failure message and defaults the failure class', () => {
    const failed = project(
      event({
        type: 'run.failed',
        payload: { threadId: 'conv-1', errorMessage: 'auth failed for sk-abcdefgh12345678' },
      }),
    );
    expect(failed?.state).toBe('failed');
    expect(failed?.failureClass).toBe('unknown');
    expect(failed?.errorMessage).toBe('auth failed for [REDACTED]');
    expect(failed?.errorMessage).not.toContain('sk-abcdefgh');
  });

  it('keeps an explicit failure class', () => {
    const failed = project(
      event({
        type: 'run.failed',
        payload: { threadId: 'conv-1', failureClass: 'rate-limit', errorMessage: 'slow down' },
      }),
    );
    expect(failed?.failureClass).toBe('rate-limit');
  });

  it('omits errorMessage when the failure carried none', () => {
    const failed = project(event({ type: 'run.failed', payload: { threadId: 'conv-1' } }));
    expect(failed?.errorMessage).toBeUndefined();
    expect(failed?.failureClass).toBe('unknown');
  });

  it('never attaches failure fields to a successful run', () => {
    const completed = project(
      event({ type: 'run.completed', payload: { threadId: 'conv-1', errorMessage: 'stale' } }),
    );
    expect(completed?.failureClass).toBeUndefined();
    expect(completed?.errorMessage).toBeUndefined();
  });

  it('classifies an external event run as external, over scheduled', () => {
    const result = project(
      event({
        payload: { threadId: 'conv-1', externalEventId: 'evt-9', scheduledTaskId: 'task-1' },
      }),
    );
    expect(result?.source).toBe('external');
    expect(result?.externalEventId).toBe('evt-9');
  });

  it('classifies a scheduled run', () => {
    const result = project(
      event({ payload: { threadId: 'conv-1', scheduledTaskId: 'task-1' } }),
    );
    expect(result?.source).toBe('scheduled');
  });

  it('classifies a run with no thread as orchestration', () => {
    const result = project(event({ payload: {} }));
    expect(result?.source).toBe('orchestration');
    expect(result?.conversationId).toBeUndefined();
  });

  it('falls back to the supplied workspace when the event has none', () => {
    const result = project(event({ workspaceId: '' }));
    expect(result?.workspaceId).toBe('fallback-ws');
  });

  it('ignores blank payload strings rather than storing empty values', () => {
    const result = project(
      event({ payload: { threadId: '   ', kernelId: '', modelId: 'gpt-5' } }),
    );
    expect(result?.conversationId).toBeUndefined();
    expect(result?.kernelId).toBeUndefined();
    expect(result?.modelId).toBe('gpt-5');
    expect(result?.source).toBe('orchestration');
  });

  it('tolerates a missing payload', () => {
    const result = project(event({ payload: undefined as never }));
    expect(result?.state).toBe('running');
    expect(result?.source).toBe('orchestration');
  });

  it('prefers an explicit conversationId over the thread id', () => {
    const result = project(
      event({ payload: { threadId: 'thread-1', conversationId: 'conv-real', title: '分析登录' } }),
    );
    expect(result?.conversationId).toBe('conv-real');
    expect(result?.title).toBe('分析登录');
  });

  it('carries the retry anchor and task id', () => {
    const result = project(
      event({ taskId: 'task-7', payload: { threadId: 'conv-1', triggerMessageId: 'msg-3' } }),
    );
    expect(result?.taskId).toBe('task-7');
    expect(result?.triggerMessageId).toBe('msg-3');
  });
});
