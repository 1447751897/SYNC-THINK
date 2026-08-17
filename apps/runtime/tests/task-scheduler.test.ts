import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@sync-think/shared';
import {
  computeNextRunAt,
  initialNextRunAt,
  nextRandomOccurrence,
  randomPlanForDate,
  seededRandom,
} from '../src/task-scheduler.js';

function task(rule: ScheduledTask['rule'], timeZone = 'UTC'): ScheduledTask {
  return {
    id: 'task-1',
    name: 't',
    instruction: 'do',
    target: { kind: 'model', modelId: 'm-1' },
    rule,
    timeZone,
    enabled: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('seededRandom', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    expect(a()).toBe(b());
    expect(a()).not.toBe(c());
    for (let i = 0; i < 10; i += 1) {
      const value = a();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('computeNextRunAt', () => {
  it('returns undefined after a one-shot at task fires', () => {
    const t = task({ kind: 'at', runAt: '2025-01-02T00:00:00.000Z' });
    expect(computeNextRunAt(t, '2025-01-02T00:00:00.000Z')).toBeUndefined();
  });

  it('advances a fixed-interval task by intervalMinutes', () => {
    const t = task({ kind: 'every', intervalMinutes: 30 });
    expect(computeNextRunAt(t, '2025-01-01T10:00:00.000Z')).toBe(
      '2025-01-01T10:30:00.000Z',
    );
  });

  it('computes the next cron occurrence in the task time zone', () => {
    const t = task({ kind: 'cron', expression: '0 9 * * 1' }, 'Asia/Shanghai');
    const next = computeNextRunAt(t, '2025-01-06T01:00:00.000Z'); // 周一 09:00 CST = 01:00Z
    expect(next).toBe('2025-01-13T01:00:00.000Z');
  });

  it('returns undefined for an invalid cron expression', () => {
    const t = task({ kind: 'cron', expression: 'not-a-cron' });
    expect(computeNextRunAt(t, '2025-01-01T00:00:00.000Z')).toBeUndefined();
  });
});

describe('randomPlanForDate', () => {
  const t = task(
    { kind: 'random', windowStart: '09:00', windowEnd: '18:00', minTimes: 2, maxTimes: 3 },
    'Asia/Shanghai',
  );

  it('is deterministic per (task, date) and stays inside the window', () => {
    const plan = randomPlanForDate(t, '2025-01-06');
    const again = randomPlanForDate(t, '2025-01-06');
    expect(plan).toEqual(again);
    expect(plan.length).toBeGreaterThanOrEqual(2);
    expect(plan.length).toBeLessThanOrEqual(3);
    // 09:00 CST = 01:00Z；18:00 CST = 10:00Z（当日）。
    const windowStart = Date.parse('2025-01-06T01:00:00.000Z');
    const windowEnd = Date.parse('2025-01-06T10:00:00.000Z');
    for (const point of plan) {
      expect(point).toBeGreaterThanOrEqual(windowStart);
      expect(point).toBeLessThanOrEqual(windowEnd);
    }
  });

  it('differs across dates', () => {
    expect(randomPlanForDate(t, '2025-01-06')).not.toEqual(randomPlanForDate(t, '2025-01-07'));
  });
});

describe('nextRandomOccurrence', () => {
  const t = task(
    { kind: 'random', windowStart: '09:00', windowEnd: '18:00', minTimes: 1, maxTimes: 2 },
    'UTC',
  );

  it('picks the next point after lastRunAt within the current day plan', () => {
    const now = new Date('2025-01-06T05:00:00.000Z');
    const next = nextRandomOccurrence(t, '2025-01-06T04:00:00.000Z', now);
    const plan = randomPlanForDate(t, '2025-01-06');
    expect(plan).toContain(next);
    expect(next).toBeGreaterThan(now.getTime());
  });

  it('moves to tomorrow when the day plan is exhausted', () => {
    const now = new Date('2025-01-06T23:00:00.000Z');
    const next = nextRandomOccurrence(t, '2025-01-06T20:00:00.000Z', now);
    const tomorrowPlan = randomPlanForDate(t, '2025-01-07');
    expect(tomorrowPlan).toContain(next);
  });
});

describe('initialNextRunAt', () => {
  it('uses runAt directly for one-shot tasks', () => {
    const t = task({ kind: 'at', runAt: '2025-06-01T00:00:00.000Z' });
    expect(initialNextRunAt(t, new Date('2025-01-01T00:00:00.000Z'))).toBe(
      '2025-06-01T00:00:00.000Z',
    );
  });

  it('advances a past firstRunAt to the next interval boundary', () => {
    const t = task({ kind: 'every', intervalMinutes: 60, firstRunAt: '2025-01-01T08:00:00.000Z' });
    expect(initialNextRunAt(t, new Date('2025-01-01T09:10:00.000Z'))).toBe(
      '2025-01-01T10:00:00.000Z',
    );
  });

  it('falls back to five minutes ahead for every without firstRunAt', () => {
    const t = task({ kind: 'every', intervalMinutes: 60 });
    const now = new Date('2025-01-01T09:00:00.000Z');
    expect(initialNextRunAt(t, now)).toBe('2025-01-01T09:05:00.000Z');
  });
});
