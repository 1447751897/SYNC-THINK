import { describe, expect, it } from 'vitest';
import type { ScheduledTask, TaskRule } from '@sync-think/shared';
import {
  CATCHUP_MAX_PER_TASK,
  DEFAULT_CATCHUP_WINDOW_MS,
  DEFAULT_DISPATCH_TIMEOUT_MS,
  decideCatchup,
  decideDue,
  desiredRegistrations,
  historyFromDecision,
  ruleScheduleShape,
  type TaskRuntimeState,
} from '../src/scheduler-core.js';

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

function state(overrides: Partial<TaskRuntimeState> = {}): TaskRuntimeState {
  return { running: false, activeRuns: 0, ...overrides };
}

// ── decideDue：到点决策 ────────────────────────────────────────────────────

describe('decideDue', () => {
  const every30 = task({ kind: 'every', intervalMinutes: 30 });

  it('fires when under the concurrency limit', () => {
    const decision = decideDue({
      task: every30,
      state: state({ activeRuns: 1 }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
    });
    expect(decision.action).toEqual({ type: 'fire' });
    expect(decision.status).toBe('running');
    expect(decision.nextRunAt).toBe('2025-01-01T10:30:00.000Z');
  });

  it('enqueues (not skips) when at the concurrency limit', () => {
    const decision = decideDue({
      task: every30,
      state: state({ activeRuns: 2 }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
    });
    expect(decision.action).toEqual({ type: 'enqueue' });
    expect(decision.status).toBe('queued');
  });

  it('skips with reason when the same task is already running (re-entry)', () => {
    const decision = decideDue({
      task: every30,
      state: state({ running: true, activeRuns: 2 }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
    });
    expect(decision.action).toEqual({ type: 'skip', reason: '上次执行中' });
    expect(decision.status).toBe('skipped');
    // 即使并发满，重入跳过优先于排队。
    expect(decision.nextRunAt).toBe('2025-01-01T10:30:00.000Z');
  });

  it('takes over with desktop-hung when dispatch has no ack after timeout', () => {
    const decision = decideDue({
      task: every30,
      state: state({
        dispatchedAt: '2025-01-01T09:59:00.000Z',
        acked: false,
      }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
      dispatchTimeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
    });
    expect(decision.action).toEqual({ type: 'takeover', reason: 'desktop-hung' });
    expect(decision.status).toBe('hung');
  });

  it('does not takeover before the dispatch timeout elapses', () => {
    const decision = decideDue({
      task: every30,
      state: state({
        dispatchedAt: '2025-01-01T09:59:40.000Z',
        acked: false,
      }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
      dispatchTimeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
    });
    expect(decision.action.type).toBe('fire');
  });

  it('does not takeover when the dispatch was acked', () => {
    const decision = decideDue({
      task: every30,
      state: state({
        dispatchedAt: '2025-01-01T09:00:00.000Z',
        acked: true,
      }),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
    });
    expect(decision.action.type).toBe('fire');
  });

  it('advances a one-shot at task and clears nextRunAt after firing', () => {
    const atTask = task(
      { kind: 'at', runAt: '2025-01-01T10:00:00.000Z' },
      { nextRunAt: '2025-01-01T10:00:00.000Z' },
    );
    const decision = decideDue({
      task: atTask,
      state: state(),
      now: new Date('2025-01-01T10:00:00.000Z'),
      maxConcurrent: 2,
    });
    expect(decision.action.type).toBe('fire');
    expect(decision.nextRunAt).toBeUndefined();
  });
});

// ── decideCatchup：限量补跑 ────────────────────────────────────────────────

describe('decideCatchup', () => {
  const every30 = task(
    { kind: 'every', intervalMinutes: 30 },
    { nextRunAt: '2025-01-01T08:00:00.000Z' },
  );

  it('catch up when missed within 24h and not yet caught up', () => {
    const decision = decideCatchup({
      task: every30,
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(decision.action).toEqual({ type: 'catchup' });
    expect(decision.status).toBe('catchup');
    expect(decision.reason).toBe('catchup');
  });

  it('defers (no catch-up) when missed more than 24h', () => {
    const decision = decideCatchup({
      task: every30,
      now: new Date('2025-01-03T10:00:00.000Z'),
      catchupWindowMs: DEFAULT_CATCHUP_WINDOW_MS,
    });
    expect(decision.action).toEqual({ type: 'defer' });
    expect(decision.status).toBe('pending');
    expect(decision.nextRunAt).toBe('2025-01-03T10:30:00.000Z');
  });

  it('catch-up is limited to once per task (latest_only)', () => {
    const decision = decideCatchup({
      task: every30,
      now: new Date('2025-01-01T10:00:00.000Z'),
      catchupCount: CATCHUP_MAX_PER_TASK,
    });
    expect(decision.action.type).toBe('defer');
  });

  it('does nothing when nextRunAt is in the future', () => {
    const future = task(
      { kind: 'every', intervalMinutes: 30 },
      { nextRunAt: '2025-01-01T12:00:00.000Z' },
    );
    const decision = decideCatchup({
      task: future,
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(decision.action).toEqual({ type: 'advance' });
    expect(decision.status).toBe('pending');
  });

  it('does nothing when nextRunAt is missing (completed one-shot)', () => {
    const atTask = task({ kind: 'at', runAt: '2025-01-01T10:00:00.000Z' });
    const decision = decideCatchup({ task: atTask, now: new Date('2025-01-02T10:00:00.000Z') });
    expect(decision.action).toEqual({ type: 'advance' });
  });
});

// ── ruleScheduleShape：规则 → 定时器形态 ────────────────────────────────────

describe('ruleScheduleShape', () => {
  it('maps at to a one-shot at the runAt timestamp', () => {
    const atTask = task({ kind: 'at', runAt: '2025-06-01T00:00:00.000Z' });
    expect(ruleScheduleShape(atTask, new Date('2025-01-01T00:00:00.000Z'))).toEqual({
      shape: 'once',
      at: Date.parse('2025-06-01T00:00:00.000Z'),
    });
  });

  it('maps every and cron to recurring', () => {
    expect(
      ruleScheduleShape(task({ kind: 'every', intervalMinutes: 60 }), new Date()),
    ).toEqual({ shape: 'recurring' });
    expect(
      ruleScheduleShape(task({ kind: 'cron', expression: '0 9 * * *' }), new Date()),
    ).toEqual({ shape: 'recurring' });
  });

  it('maps random to a one-shot at the next deterministic point today', () => {
    const randomTask = task(
      { kind: 'random', windowStart: '09:00', windowEnd: '18:00', minTimes: 1, maxTimes: 2 },
      { timeZone: 'Asia/Shanghai' },
    );
    const now = new Date('2025-01-06T00:30:00.000Z'); // 08:30 CST，窗口未开始
    const shape = ruleScheduleShape(randomTask, now);
    expect(shape.shape).toBe('once');
    // 09:00 CST = 01:00Z；点应落在 [01:00Z, 10:00Z) 且 > now。
    expect(shape.shape === 'once' && shape.at).toBeGreaterThan(now.getTime());
    expect(shape.shape === 'once' && shape.at).toBeGreaterThanOrEqual(
      Date.parse('2025-01-06T01:00:00.000Z'),
    );
    expect(shape.shape === 'once' && shape.at).toBeLessThan(
      Date.parse('2025-01-06T10:00:00.000Z'),
    );
  });
});

// ── desiredRegistrations：注册表同步语义 ───────────────────────────────────

describe('desiredRegistrations', () => {
  it('registers enabled tasks only', () => {
    const enabled = task({ kind: 'every', intervalMinutes: 60 });
    const disabled = task(
      { kind: 'every', intervalMinutes: 60 },
      { id: 'task-2', enabled: false },
    );
    const registrations = desiredRegistrations([enabled, disabled]);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].taskId).toBe('task-1');
  });

  it('does not register a completed one-shot task (no nextRunAt)', () => {
    const done = task({ kind: 'at', runAt: '2025-01-01T10:00:00.000Z' });
    const registrations = desiredRegistrations([done]);
    expect(registrations).toHaveLength(0);
  });

  it('includes the rule shape and timezone for registration', () => {
    const everyTask = task({ kind: 'every', intervalMinutes: 60 }, { timeZone: 'Asia/Shanghai' });
    const registrations = desiredRegistrations([everyTask]);
    expect(registrations[0]).toMatchObject({
      taskId: 'task-1',
      shape: { shape: 'recurring' },
      timeZone: 'Asia/Shanghai',
    });
  });
});

// ── historyFromDecision：历史记录辅助 ───────────────────────────────────────

describe('historyFromDecision', () => {
  it('maps skipped to a skipped history entry with reason', () => {
    const entry = historyFromDecision(
      { action: { type: 'skip', reason: '上次执行中' }, status: 'skipped' },
      'task-1',
      '2025-01-01T10:00:00.000Z',
    );
    expect(entry).toMatchObject({
      taskId: 'task-1',
      status: 'skipped',
      firedAt: '2025-01-01T10:00:00.000Z',
      reason: '上次执行中',
    });
  });

  it('maps hung to a failed entry with desktop-hung reason', () => {
    const entry = historyFromDecision(
      { action: { type: 'takeover', reason: 'desktop-hung' }, status: 'hung' },
      'task-1',
      '2025-01-01T10:00:00.000Z',
    );
    expect(entry?.status).toBe('failed');
    expect(entry?.reason).toBe('desktop-hung');
  });

  it('returns undefined for success-path decisions (terminal writes)', () => {
    const decision = { action: { type: 'fire' }, status: 'running' };
    expect(historyFromDecision(decision, 'task-1', '2025-01-01T10:00:00.000Z')).toBeUndefined();
  });
});
