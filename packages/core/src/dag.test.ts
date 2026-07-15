import { describe, expect, it } from 'vitest';
import { getReadyStepIds, validateDag, type DagStep } from './dag.js';

const step = (id: string, planOrder: number, dependsOn: string[] = []): DagStep => ({
  id,
  planOrder,
  dependsOn,
});

describe('validateDag', () => {
  it('accepts a valid dependency graph', () => {
    expect(validateDag([step('root', 0), step('leaf', 1, ['root'])])).toEqual({ ok: true });
  });

  it('rejects duplicate step IDs', () => {
    expect(validateDag([step('same', 0), step('same', 1)])).toMatchObject({
      ok: false,
      reason: 'duplicate-id',
      stepId: 'same',
    });
  });

  it('rejects missing dependencies', () => {
    expect(validateDag([step('child', 0, ['missing'])])).toMatchObject({
      ok: false,
      reason: 'missing-dependency',
      stepId: 'child',
      dependencyId: 'missing',
    });
  });

  it('rejects self edges', () => {
    expect(validateDag([step('self', 0, ['self'])])).toMatchObject({
      ok: false,
      reason: 'self-edge',
      stepId: 'self',
    });
  });

  it('rejects cycles', () => {
    expect(validateDag([step('first', 0, ['second']), step('second', 1, ['first'])])).toMatchObject(
      { ok: false, reason: 'cycle' },
    );
  });
});

describe('getReadyStepIds', () => {
  it('uses persisted plan order instead of step ID ordering', () => {
    const graph = [
      step('z-first', 0),
      step('m-completed', 1),
      step('a-second', 2, ['m-completed']),
    ];

    expect(
      getReadyStepIds(graph, {
        'z-first': 'pending',
        'm-completed': 'completed',
        'a-second': 'ready',
      }),
    ).toEqual(['z-first', 'a-second']);
  });

  it('only returns pending or ready steps whose dependencies are all completed', () => {
    const graph = [
      step('completed-root', 0),
      step('running-root', 1),
      step('blocked-child', 2, ['running-root']),
      step('ready-child', 3, ['completed-root']),
      step('failed-child', 4, ['completed-root']),
    ];

    expect(
      getReadyStepIds(graph, {
        'completed-root': 'completed',
        'running-root': 'running',
        'blocked-child': 'pending',
        'ready-child': 'ready',
        'failed-child': 'failed',
      }),
    ).toEqual(['ready-child']);
  });
});
