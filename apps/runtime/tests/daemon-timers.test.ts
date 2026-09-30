import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@sync-think/shared';
import { TimerRegistry, type TimerFireContext } from '../src/daemon/core.js';
import { planCatchupSweep } from '../src/daemon/catchup.js';
import { decideDue } from '../src/scheduler-core.js';
import { createRuleAwareTimerRegistrar } from '../src/daemon/timers.js';

function task(rule: ScheduledTask['rule'], nextRunAt: string): ScheduledTask {
  return {
    id: `timer-${rule.kind}`,
    name: 'timer test',
    instruction: 'run',
    target: { kind: 'model', modelId: 'fake-mini' },
    rule,
    timeZone: 'UTC',
    enabled: true,
    nextRunAt,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('createRuleAwareTimerRegistrar', () => {
  afterEach(() => vi.useRealTimers());

  it('carries timer context through the actual registry so millisecond drift cannot defer later hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T11:59:59Z'));
    let clock = new Date('2026-09-30T11:59:59Z');
    const hourly = task(
      { kind: 'every', intervalMinutes: 60, windowStart: '12:00', windowEnd: '18:00' },
      '2026-09-30T12:00:00Z',
    );
    const counts = new Map<string, number>();
    const fired: string[] = [];
    const registry = new TimerRegistry(createRuleAwareTimerRegistrar({ now: () => clock }));
    registry.sync([hourly]);
    registry.onFire(hourly.id, (context) => {
      expect(context?.trigger).toBe('timer');
      const recovery = planCatchupSweep({
        tasks: [hourly],
        now: clock,
        catchupCounts: counts,
        trigger: context?.trigger,
      });
      if (recovery.actions[0]?.action === 'defer') return;
      if (recovery.catchupCount) counts.set(hourly.id, (counts.get(hourly.id) ?? 0) + 1);
      const decision = decideDue({
        task: hourly,
        state: { running: false, activeRuns: 0 },
        now: clock,
        maxConcurrent: 2,
      });
      hourly.nextRunAt = decision.nextRunAt;
      if (decision.action.type === 'fire') fired.push(context!.scheduledAt);
    });
    for (const time of ['12:00:00.070', '13:00:00.207', '14:00:00.192', '15:00:00.186']) {
      clock = new Date('2026-09-30T' + time + 'Z');
      vi.runOnlyPendingTimers();
    }
    expect(fired).toEqual(
      ['12:00', '13:00', '14:00', '15:00'].map((time) => '2026-09-30T' + time + ':00.000Z'),
    );
    expect(counts.size).toBe(0);
    expect(hourly.nextRunAt).toBe('2026-09-30T16:00:00.000Z');
    registry.sync([]);
  });

  it('marks an already-overdue registration as recovery instead of normal live firing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T14:00:00Z'));
    const contexts: Array<TimerFireContext | undefined> = [];
    const handle = createRuleAwareTimerRegistrar().registerTimer(
      'timer-every',
      (context) => contexts.push(context),
      task({ kind: 'every', intervalMinutes: 60 }, '2026-09-30T12:00:00Z'),
    );
    vi.advanceTimersByTime(0);
    expect(contexts[0]).toEqual({ trigger: 'recovery', scheduledAt: '2026-09-30T12:00:00.000Z' });
    handle.cancel();
  });

  it('keeps the recovery policy for suspension across a full missed interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T11:59:59Z'));
    let clock = new Date('2026-09-30T11:59:59Z');
    const fire = vi.fn();
    const handle = createRuleAwareTimerRegistrar({ now: () => clock }).registerTimer(
      'timer-every',
      fire,
      task({ kind: 'every', intervalMinutes: 60 }, '2026-09-30T12:00:00Z'),
    );
    clock = new Date('2026-09-30T14:30:00Z');
    vi.advanceTimersByTime(1000);
    expect(fire).toHaveBeenCalledWith({
      trigger: 'recovery',
      scheduledAt: '2026-09-30T12:00:00.000Z',
    });
    handle.cancel();
  });

  it('fires at rules once and does not repeat a completed one-shot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const fire = vi.fn();
    const handle = createRuleAwareTimerRegistrar().registerTimer(
      'timer-at',
      fire,
      task({ kind: 'at', runAt: '2025-01-01T00:00:01.000Z' }, '2025-01-01T00:00:01.000Z'),
    );

    vi.advanceTimersByTime(1_000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(fire).toHaveBeenCalledTimes(1);
    handle.cancel();
  });

  it.each([
    [
      'random',
      { kind: 'random', windowStart: '00:00', windowEnd: '23:59', minTimes: 1, maxTimes: 1 },
    ],
    ['cron', { kind: 'cron', expression: '*/5 * * * * *' }],
  ] as const)('fires %s from its persisted nextRunAt', (_kind, rule) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const fire = vi.fn();
    createRuleAwareTimerRegistrar().registerTimer(
      `timer-${_kind}`,
      fire,
      task(rule, '2025-01-01T00:00:01.000Z'),
    );
    vi.advanceTimersByTime(1_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('reschedules every rules using their interval instead of a one-second loop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const fire = vi.fn();
    createRuleAwareTimerRegistrar().registerTimer(
      'timer-every',
      fire,
      task({ kind: 'every', intervalMinutes: 5 }, '2025-01-01T00:00:01.000Z'),
    );

    vi.advanceTimersByTime(1_000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(299_000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(fire).toHaveBeenCalledTimes(2);
  });
});
