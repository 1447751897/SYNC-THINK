import { describe, expect, it } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import {
  projectRunTerminalEvents,
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
