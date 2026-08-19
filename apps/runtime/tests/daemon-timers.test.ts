import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@sync-think/shared';
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
    ['random', { kind: 'random', windowStart: '00:00', windowEnd: '23:59', minTimes: 1, maxTimes: 1 }],
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
