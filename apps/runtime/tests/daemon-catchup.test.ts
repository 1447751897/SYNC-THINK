import { describe, expect, it } from 'vitest';
import type { ScheduledTask, TaskRule } from '@sync-think/shared';
import {
  planCatchupSweep,
  type CatchupSweepPlan,
} from '../src/daemon/catchup.js';
import { CATCHUP_MAX_PER_TASK, DEFAULT_CATCHUP_WINDOW_MS } from '../src/scheduler-core.js';

function task(rule: TaskRule, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 't',
    instruction: 'do',
    target: { kind: 'model', modelId: 'm-1' },
    rule,
    timeZone: 'UTC',
    enabled: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('planCatchupSweep', () => {
  const every30 = task(
    { kind: 'every', intervalMinutes: 30 },
    { nextRunAt: '2025-01-01T08:00:00.000Z' },
  );

  it('plans a catchup for a task missed within 24h (not yet caught up)', () => {
    const plan: CatchupSweepPlan = planCatchupSweep({
      tasks: [every30],
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ taskId: 'task-1', action: 'catchup' });
    expect(plan.catchupCount).toBe(1);
  });

  it('plans a defer (no catch-up) when missed more than 24h', () => {
    const plan = planCatchupSweep({
      tasks: [every30],
      now: new Date('2025-01-03T10:00:00.000Z'),
      catchupWindowMs: DEFAULT_CATCHUP_WINDOW_MS,
    });
    expect(plan.actions[0]).toMatchObject({
      taskId: 'task-1',
      action: 'defer',
      nextRunAt: '2025-01-03T10:30:00.000Z',
    });
    expect(plan.catchupCount).toBe(0);
  });

  it('does not catch up a task already caught up once (latest_only)', () => {
    const plan = planCatchupSweep({
      tasks: [every30],
      now: new Date('2025-01-01T10:00:00.000Z'),
      catchupCounts: new Map([['task-1', CATCHUP_MAX_PER_TASK]]),
    });
    expect(plan.actions[0]).toMatchObject({ taskId: 'task-1', action: 'defer' });
    expect(plan.catchupCount).toBe(0);
  });

  it('skips tasks whose nextRunAt is in the future (nothing missed)', () => {
    const future = task(
      { kind: 'every', intervalMinutes: 30 },
      { nextRunAt: '2025-01-01T12:00:00.000Z' },
    );
    const plan = planCatchupSweep({
      tasks: [future],
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(plan.actions).toHaveLength(0);
    expect(plan.catchupCount).toBe(0);
  });

  it('skips disabled tasks', () => {
    const disabled = task(
      { kind: 'every', intervalMinutes: 30 },
      { id: 'task-2', enabled: false, nextRunAt: '2025-01-01T08:00:00.000Z' },
    );
    const plan = planCatchupSweep({
      tasks: [disabled],
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(plan.actions).toHaveLength(0);
  });

  it('skips tasks without nextRunAt (completed one-shot)', () => {
    const done = task({ kind: 'at', runAt: '2025-01-01T10:00:00.000Z' });
    const plan = planCatchupSweep({
      tasks: [done],
      now: new Date('2025-01-02T10:00:00.000Z'),
    });
    expect(plan.actions).toHaveLength(0);
  });

  it('handles a mix of catchup and defer across tasks', () => {
    const a = task({ kind: 'every', intervalMinutes: 30 }, { id: 'a', nextRunAt: '2025-01-01T08:00:00.000Z' });
    const b = task({ kind: 'every', intervalMinutes: 30 }, { id: 'b', nextRunAt: '2025-01-01T07:00:00.000Z' });
    const far = task({ kind: 'every', intervalMinutes: 30 }, { id: 'c', nextRunAt: '2024-12-30T10:00:00.000Z' });
    const plan = planCatchupSweep({
      tasks: [a, b, far],
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    const byId = Object.fromEntries(plan.actions.map((act) => [act.taskId, act.action]));
    expect(byId.a).toBe('catchup');
    expect(byId.b).toBe('catchup');
    expect(byId.c).toBe('defer'); // 超 24h
    expect(plan.catchupCount).toBe(2);
  });
});
