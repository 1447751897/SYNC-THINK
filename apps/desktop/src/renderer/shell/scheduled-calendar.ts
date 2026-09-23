import type { ScheduledTask, ScheduledTaskHistoryEntry } from '@sync-think/shared';
import {
  computeNextRunAt,
  dateString,
  dayWindowUtc,
  initialNextRunAt,
} from '@sync-think/shared/task-schedule';

export type CalendarView = 'day' | 'week' | 'month' | 'list';
export interface CalendarOccurrence {
  id: string;
  task: ScheduledTask;
  start: number;
  end?: number;
  kind: 'planned' | 'window' | 'history' | 'paused' | 'overdue';
  status?: ScheduledTaskHistoryEntry['status'];
}

export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function addCalendarDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function calendarDays(date: Date, view: CalendarView): Date[] {
  const start = calendarDate(calendarDateKey(date));
  if (view === 'day' || view === 'list') return [start];
  if (view === 'month') start.setDate(1);
  start.setDate(start.getDate() - start.getDay());
  const length =
    view === 'week'
      ? 7
      : Math.ceil(
          (new Date(date.getFullYear(), date.getMonth(), 1).getDay() +
            new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) /
            7,
        ) * 7;
  return Array.from({ length }, (_, index) => addCalendarDays(start, index));
}

export function localDateTimeInput(date: Date): string {
  return `${calendarDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Expand only future plans; past successes/failures always come from recorded runs. */
export function calendarOccurrences(
  tasks: readonly ScheduledTask[],
  start: number,
  end: number,
  now: number,
  history: readonly ScheduledTaskHistoryEntry[] = [],
) {
  const events: CalendarOccurrence[] = [];
  const errors: string[] = [];
  let truncated = false;
  for (const task of tasks) {
    const recorded = history.filter((entry) => entry.taskId === task.id);
    if (task.lastResult && !recorded.some((entry) => entry.firedAt === task.lastResult?.firedAt)) {
      recorded.push({ ...task.lastResult, id: `last-${task.id}`, taskId: task.id });
    }
    for (const entry of recorded) {
      const at = Date.parse(entry.firedAt);
      if (at >= start && at < end)
        events.push({ id: entry.id, task, start: at, kind: 'history', status: entry.status });
    }
    const push = (at: number, kind: CalendarOccurrence['kind'], until?: number) => {
      if ((until ?? at) >= start && at < end)
        events.push({ id: `${task.id}-${kind}-${at}`, task, start: at, end: until, kind });
    };
    const next = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN;
    if (task.rule.kind === 'at') {
      const at = Date.parse(task.rule.runAt);
      if (recorded.length === 0 || Number.isFinite(next))
        push(at, !task.enabled ? 'paused' : at < now ? 'overdue' : 'planned');
      continue;
    }
    if (!task.enabled) {
      if (Number.isFinite(next)) push(next, 'paused');
      continue;
    }
    try {
      if (Number.isFinite(next) && next < now) push(next, 'overdue');
      if (task.rule.kind === 'random') {
        // A band expresses the allowed window, not a promise of continuous execution.
        let day = dateString(task.timeZone, new Date(Math.max(start, now) - 86_400_000));
        for (let i = 0; i < 45; i++) {
          const window = dayWindowUtc(task.rule, task.timeZone, day);
          if (window.start >= end) break;
          if (window.end > window.start && window.end > now)
            push(window.start, 'window', window.end);
          day = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        }
        if (next >= now) push(next, 'planned');
        continue;
      }
      const lower = Math.max(start, now);
      let cursor = Number.isFinite(next)
        ? next
        : Date.parse(initialNextRunAt(task, new Date(lower - 1)) ?? '');
      if (cursor < lower) {
        if (task.rule.kind === 'every' && !task.rule.windowStart) {
          const interval = Math.max(5, task.rule.intervalMinutes) * 60_000;
          cursor += Math.ceil((lower - cursor) / interval) * interval;
        } else
          cursor = Date.parse(
            computeNextRunAt(task, new Date(lower - 1).toISOString(), new Date(lower - 1)) ?? '',
          );
      }
      let count = 0;
      while (Number.isFinite(cursor) && cursor < end && count < 1200 && events.length < 6000) {
        if (cursor >= lower) push(cursor, 'planned');
        const after = Date.parse(
          computeNextRunAt(task, new Date(cursor).toISOString(), new Date(cursor)) ?? '',
        );
        if (after <= cursor) break;
        cursor = after;
        count++;
      }
      if (cursor < end && (count >= 1200 || events.length >= 6000)) truncated = true;
    } catch {
      errors.push(task.name);
      if (next >= now) push(next, 'planned');
    }
  }
  return { events: events.sort((a, b) => a.start - b.start), truncated, errors };
}

export interface PositionedOccurrence {
  event: CalendarOccurrence;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Lay out simultaneous starts in separate lanes, including the minimum readable card height. */
export function positionCalendarEvents(
  events: CalendarOccurrence[],
  day: Date,
): PositionedOccurrence[] {
  const dayStart = day.getTime(),
    dayEnd = addCalendarDays(day, 1).getTime();
  const minute = (at: number) => {
    const date = new Date(at);
    return date.getHours() * 60 + date.getMinutes();
  };
  const items = events
    .filter((event) => event.start < dayEnd && (event.end ?? event.start) >= dayStart)
    .map((event) => {
      const top = event.start < dayStart ? 0 : minute(event.start);
      const end = event.end ? (event.end >= dayEnd ? 1440 : minute(event.end)) : top + 44;
      return {
        event,
        top,
        height: Math.min(1440 - top, Math.max(34, end - top)),
        lane: 0,
        lanes: 1,
      };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);
  let group: PositionedOccurrence[] = [],
    ends: number[] = [],
    until = -1;
  const finish = () => {
    for (const item of group) item.lanes = ends.length;
    group = [];
    ends = [];
  };
  for (const item of items) {
    if (item.top >= until) finish();
    let lane = ends.findIndex((end) => end <= item.top);
    if (lane < 0) lane = ends.length;
    item.lane = lane;
    ends[lane] = item.top + item.height;
    group.push(item);
    until = Math.max(...ends);
  }
  finish();
  return items;
}
