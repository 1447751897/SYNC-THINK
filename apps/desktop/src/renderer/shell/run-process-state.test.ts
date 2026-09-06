import { describe, expect, it } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import {
  collectRunProcessIds,
  projectRunTerminalEvents,
  reconcileStreamingMessageProcessTerminal,
  reconcileRunProcessTerminal,
  updateRunProcessMap,
} from './run-process-state.js';

function processView(runId: string, stepCount: number): RunProcessView {
  return {
    runId: runId as RunProcessView['runId'],
    steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `${runId}-step-${index}`,
      toolName: 'read_file',
      kind: 'read',
      status: index === stepCount - 1 ? 'running' : 'done',
      verb: 'Read',
      zh: '读取',
      label: `Read · src/file-${index}.ts`,
      path: `src/file-${index}.ts`,
    })),
    fileChanges: [],
    running: true,
    doneCount: Math.max(0, stepCount - 1),
    errorCount: 0,
  };
}

describe('run process state', () => {
  it('settles a paged process without replacing full totals with the current page count', () => {
    const current = processView('paged', 2);
    current.doneCount = 98;
    current.latestStep = { ...current.steps[1], id: 'last' };
    current.pages = {
      version: 'a'.repeat(64),
      steps: { offset: 0, total: 100, nextOffset: 2 },
      fileChanges: { offset: 0, total: 0 },
      taskPlan: { offset: 0, total: 0 },
    };
    const terminal = {
      runId: current.runId,
      type: 'run.failed',
      occurredAt: '2026-09-05T16:00:00Z',
    } as Event;
    const settled = reconcileRunProcessTerminal(current, terminal);
    expect(settled.doneCount).toBe(98);
    expect(settled.errorCount).toBe(2);
    expect(settled.latestStep?.status).toBe('error');
    expect(settled.running).toBe(false);
  });

  it('loads a transient-only run so its durable process terminal can settle the UI', () => {
    expect(
      collectRunProcessIds({
        durableRunIds: ['run-history'],
        transientRunId: 'run-transient',
        projectedActiveRunId: 'run-projected',
      }),
    ).toEqual(new Set(['run-history', 'run-transient', 'run-projected']));
  });

  it('lets a completed process snapshot settle a stale streaming message', () => {
    const message = {
      id: 'streaming-run-active',
      runId: 'run-active',
      streaming: true,
    };
    const completed = {
      ...processView('run-active', 0),
      running: false,
      startedAt: '2026-08-25T05:53:47.990Z',
      completedAt: '2026-08-25T05:55:19.960Z',
      durationMs: 91_970,
    };

    expect(reconcileStreamingMessageProcessTerminal(message, completed)).toEqual({
      ...message,
      streaming: false,
    });
  });

  it('replaces only the addressed run when a 30-step snapshot streams', () => {
    const historical = processView('run-history', 2);
    const activeBefore = processView('run-active', 29);
    const previous = new Map<string, RunProcessView>([
      [historical.runId, historical],
      [activeBefore.runId, activeBefore],
    ]);
    const activeAfter = processView('run-active', 30);

    const next = updateRunProcessMap(previous, activeAfter);

    expect(next).not.toBe(previous);
    expect(next.get('run-history')).toBe(historical);
    expect(next.get('run-active')).toBe(activeAfter);
    expect(next.get('run-active')?.steps).toHaveLength(30);
  });

  it('returns the same map for the same snapshot object', () => {
    const view = processView('run-active', 30);
    const previous = new Map([[view.runId, view]]);
    expect(updateRunProcessMap(previous, view)).toBe(previous);
  });

  it('keeps the current map when a bridge returns no process snapshot', () => {
    const view = processView('run-active', 3);
    const previous = new Map([[view.runId, view]]);

    expect(updateRunProcessMap(previous, null)).toBe(previous);
    expect(updateRunProcessMap(previous, undefined)).toBe(previous);
  });

  it.each([
    ['run.paused', 'done'],
    ['run.failed', 'error'],
    ['run.cancelled', 'error'],
  ] as const)(
    'lets a durable %s terminal event override a stale running process',
    (type, expectedStepStatus) => {
      const stale = {
        ...processView('run-active', 2),
        startedAt: '2026-08-08T10:00:00.000Z',
      };
      const terminal = {
        id: `event-${type}`,
        workspaceId: 'workspace-a',
        taskId: 'task-a',
        runId: 'run-active',
        category: 'run',
        type,
        sequence: 4,
        occurredAt: '2026-08-08T10:00:08.000Z',
        payload: { threadId: 'thread-a' },
      } as unknown as Event;

      const terminals = projectRunTerminalEvents([terminal]);
      const settled = reconcileRunProcessTerminal(stale, terminals.get('run-active'));

      expect(settled.running).toBe(false);
      expect(settled.completedAt).toBe(terminal.occurredAt);
      expect(settled.durationMs).toBe(8_000);
      expect(settled.steps.at(-1)?.status).toBe(expectedStepStatus);
      expect(settled.doneCount + settled.errorCount).toBe(settled.steps.length);
    },
  );
});
