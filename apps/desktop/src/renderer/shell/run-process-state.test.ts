import { describe, expect, it } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import { updateRunProcessMap } from './run-process-state.js';

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
});
