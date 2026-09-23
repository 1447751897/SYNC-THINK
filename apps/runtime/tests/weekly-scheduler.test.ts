import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, TaskRuleWeekly } from '@sync-think/shared';
import {
  computeNextRunAt,
  initialNextRunAt,
  parseWeeklyRule,
  weeklyDays,
} from '../src/task-scheduler.js';
import { createRuleAwareTimerRegistrar } from '../src/daemon/timers.js';

const rule: TaskRuleWeekly = {
  kind: 'weekly',
  selection: { mode: 'range', start: 1, end: 5 },
  time: '09:00',
  startDate: '2026-09-22',
};
const task = (
  overrides: Partial<TaskRuleWeekly> = {},
  timeZone = 'Asia/Shanghai',
): ScheduledTask => ({
  id: 'weekly',
  name: 'Weekly',
  instruction: 'Review',
  target: { kind: 'model', modelId: 'model' },
  rule: { ...rule, ...overrides },
  timeZone,
  enabled: true,
  createdAt: '2026-09-22T00:00:00Z',
  updatedAt: '2026-09-22T00:00:00Z',
});

describe('weekly schedules', () => {
  afterEach(() => vi.useRealTimers());
  it('honors a future effective date and includes its first selected day', () => {
    expect(
      initialNextRunAt(task({ startDate: '2027-01-04' }), new Date('2026-09-22T00:00:00Z')),
    ).toBe('2027-01-04T01:00:00.000Z');
  });
  it('skips elapsed starts and weekends', () => {
    expect(initialNextRunAt(task(), new Date('2026-09-25T01:00:00Z'))).toBe(
      '2026-09-28T01:00:00.000Z',
    );
  });
  it('wraps Friday through Monday and handles a one-day range', () => {
    expect(weeklyDays({ mode: 'range', start: 5, end: 1 })).toEqual([5, 6, 7, 1]);
    const t = task({ selection: { mode: 'range', start: 5, end: 1 } });
    expect(computeNextRunAt(t, '2026-09-25T01:00:00Z')).toBe('2026-09-26T01:00:00.000Z');
    expect(computeNextRunAt(t, '2026-09-28T01:00:00Z')).toBe('2026-10-02T01:00:00.000Z');
    expect(
      computeNextRunAt(
        task({ selection: { mode: 'range', start: 1, end: 1 } }),
        '2026-09-28T01:00:00Z',
      ),
    ).toBe('2026-10-05T01:00:00.000Z');
  });
  it('supports discontiguous weekdays and preserves local time across DST', () => {
    const t = task(
      { selection: { mode: 'days', days: [1, 3] }, startDate: '2026-01-01' },
      'America/New_York',
    );
    expect(computeNextRunAt(t, '2026-03-04T14:00:00Z')).toBe('2026-03-09T13:00:00.000Z');
  });
  it('handles timezones with a partial-hour offset and midnight starts', () => {
    expect(
      initialNextRunAt(task({ time: '00:00' }, 'Asia/Kolkata'), new Date('2026-09-21T00:00:00Z')),
    ).toBe('2026-09-21T18:30:00.000Z');
  });
  it.each([
    { selection: { mode: 'days', days: [] } },
    { selection: { mode: 'days', days: [0, 8] } },
    { selection: { mode: 'range', start: 1.5, end: 7 } },
    { time: '24:00' },
    { time: '09:60' },
    { startDate: '2026-02-30' },
    { startDate: 'bad' },
    { selection: null },
  ])('rejects malformed weekly rules: %j', (patch) => {
    expect(parseWeeklyRule({ ...rule, ...patch })).toBeUndefined();
  });
  it('fires on the selected weekdays and re-registers correctly after restart', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T00:59:59Z'));
    const t = task();
    const fire = vi.fn();
    const registrar = createRuleAwareTimerRegistrar();
    const handle = registrar.registerTimer(t.id, fire, t);
    vi.advanceTimersByTime(1000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 86400_000);
    expect(fire).toHaveBeenCalledTimes(1);
    handle.cancel();
    const restarted = registrar.registerTimer(t.id, fire, {
      ...t,
      nextRunAt: '2026-09-28T01:00:00.000Z',
    });
    vi.advanceTimersByTime(86400_000);
    expect(fire).toHaveBeenCalledTimes(2);
    restarted.cancel();
  });
});
