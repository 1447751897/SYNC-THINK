import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@sync-think/shared';
import {
  calendarDays,
  calendarOccurrences,
  localDateTimeInput,
  positionCalendarEvents,
} from './scheduled-calendar.js';

const task: ScheduledTask = {
  id: 'daily',
  name: 'Daily',
  instruction: 'Check',
  target: { kind: 'model', modelId: 'model' },
  rule: { kind: 'cron', expression: '0 9 * * *' },
  timeZone: 'Asia/Shanghai',
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const start = Date.parse('2026-09-22T00:00:00Z');
const end = start + 3 * 86400_000;

describe('calendar schedule projection', () => {
  it('projects cron in the task timezone without treating plans as completed runs', () => {
    const result = calendarOccurrences([task], start, end, start);
    expect(result.events.map((event) => new Date(event.start).toISOString())).toEqual([
      '2026-09-22T01:00:00.000Z',
      '2026-09-23T01:00:00.000Z',
      '2026-09-24T01:00:00.000Z',
    ]);
    expect(result.events.every((event) => event.kind === 'planned' && !event.status)).toBe(true);
  });

  it('deduplicates latest result against history and never fabricates past runs', () => {
    const firedAt = '2026-09-22T01:00:00Z';
    const result = calendarOccurrences(
      [{ ...task, lastResult: { status: 'failed', firedAt } }],
      start,
      end,
      end,
      [{ id: 'run-1', taskId: task.id, status: 'failed', firedAt }],
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: 'history', status: 'failed' });
  });

  it('jumps over years of old intervals and bounds dense projections', () => {
    const recurring = {
      ...task,
      rule: { kind: 'every' as const, intervalMinutes: 5 },
      nextRunAt: '2020-01-01T00:00:00Z',
    };
    const result = calendarOccurrences([recurring], start, start + 42 * 86400_000, start);
    expect(result.events[0]?.start).toBe(start);
    expect(result.events).toHaveLength(1200);
    expect(result.truncated).toBe(true);
  });

  it('shows random windows and only the persisted next time as a planned start', () => {
    const result = calendarOccurrences(
      [
        {
          ...task,
          timeZone: 'UTC',
          rule: {
            kind: 'random',
            windowStart: '09:00',
            windowEnd: '12:00',
            minTimes: 1,
            maxTimes: 3,
            atLeastOnce: true,
          },
          nextRunAt: '2026-09-22T10:00:00Z',
        },
      ],
      start,
      end,
      start,
    );
    expect(result.events.filter((event) => event.kind === 'window')).toHaveLength(3);
    expect(result.events.filter((event) => event.kind === 'planned')).toHaveLength(1);
    expect(result.events.some((event) => event.kind === 'history')).toBe(false);
  });

  it('keeps disabled tasks from producing recurring plans', () => {
    expect(calendarOccurrences([{ ...task, enabled: false }], start, end, start).events).toEqual(
      [],
    );
  });

  it('handles invalid cron without crashing other task projections', () => {
    const result = calendarOccurrences(
      [{ ...task, name: 'Broken', rule: { kind: 'cron', expression: 'invalid' } }, task],
      start,
      end,
      start,
    );
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
  });

  it('builds six-row months and keeps local editor input in local time', () => {
    const days = calendarDays(new Date(2026, 7, 15), 'month');
    expect(days).toHaveLength(42);
    expect(days[0]?.getDay()).toBe(0);
    expect(days.at(-1)?.getDay()).toBe(6);
    expect(localDateTimeInput(new Date(2026, 8, 22, 9, 30))).toBe('2026-09-22T09:30');
  });

  it('separates overlapping events without reserving lanes for later events', () => {
    const day = new Date(2026, 8, 22);
    const events = [9, 9, 11].map((hour, index) => ({
      id: String(index),
      task,
      start: new Date(2026, 8, 22, hour).getTime(),
      kind: 'planned' as const,
    }));
    const layout = positionCalendarEvents(events, day);
    expect(layout.map((item) => [item.top, item.lane, item.lanes])).toEqual([
      [540, 0, 2],
      [540, 1, 2],
      [660, 0, 1],
    ]);
  });
  it('projects weekly rules only from their effective date, using the task timezone', () => {
    const result = calendarOccurrences(
      [
        {
          ...task,
          rule: {
            kind: 'weekly',
            selection: { mode: 'range', start: 1, end: 5 },
            time: '09:00',
            startDate: '2026-09-23',
          },
        },
      ],
      start,
      end,
      start,
    );
    expect(result.events.map((event) => new Date(event.start).toISOString())).toEqual([
      '2026-09-23T01:00:00.000Z',
      '2026-09-24T01:00:00.000Z',
    ]);
  });
});
