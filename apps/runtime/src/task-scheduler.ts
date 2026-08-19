/**
 * 定时任务触发规则纯函数（可独立测试）。
 *
 * - computeNextRunAt：at → 无下次（单次完成）；every → 固定间隔；random →
 *   确定性日计划（日期 + 任务 id 做种子，重启重算一致）取下一个时刻；
 *   cron → croner 下一次匹配。
 * - 时区语义：every/random/cron 的「今天/窗口」按任务 timeZone 计算；
 *   nextRunAt 始终存 UTC 绝对时刻。
 */
import { Cron } from 'croner';
import type { ScheduledTask, TaskRule, TaskRuleRandom } from '@sync-think/shared';

export const TASK_MIN_EVERY_MINUTES = 5;

/** mulberry32 确定性伪随机（同种子同序列）。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串种子（任务 id + 日期）→ 32 位整数。 */
function seedOf(taskId: string, date: string): number {
  let hash = 2166136261;
  for (let i = 0; i < taskId.length; i += 1) {
    hash ^= taskId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let i = 0; i < date.length; i += 1) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseHm(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hour: 9, minute: 0 };
  return { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) };
}

function minutesOfDay(hm: { hour: number; minute: number }): number {
  return hm.hour * 60 + hm.minute;
}

/** 任务时区下「date 这一天」的本地零点对应 UTC 毫秒。
 * 原理：取 UTC 中午猜测值，读其本地日期与本地小时；
 * 本地零点(UTC) = guess - localHour * 3600e3（同日时）。 */
function localMidnightUtc(date: string, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  let guess = Date.parse(`${date}T12:00:00Z`);
  for (let i = 0; i < 4; i += 1) {
    const parts = fmt.formatToParts(new Date(guess));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const localDate = `${get('year')}-${get('month')}-${get('day')}`;
    const localHour = Number(get('hour')) % 24;
    if (localDate === date) return guess - localHour * 3_600_000;
    const delta = localDate < date ? 1 : -1;
    guess = Date.parse(`${new Date(guess + delta * 24 * 60 * 60_000).toISOString().slice(0, 10)}T12:00:00Z`);
  }
  return guess - 12 * 60 * 60_000;
}

/** 任务时区下「date」这一天的窗口 [start, end]（UTC 毫秒）。 */
function dayWindowUtc(rule: TaskRuleRandom, timeZone: string, date: string): { start: number; end: number } {
  const startHm = parseHm(rule.windowStart);
  const endHm = parseHm(rule.windowEnd);
  const midnight = localMidnightUtc(date, timeZone);
  const start = midnight + minutesOfDay(startHm) * 60_000;
  const end = midnight + minutesOfDay(endHm) * 60_000;
  return { start, end };
}

/** 当天日期串（任务时区）。 */
export function dateString(timeZone: string, at: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(at);
}

/**
 * 随机任务的确定性日计划：seed = 任务 id + 日期；n = min..max 随机；
 * 窗口等分 n 段，每段内随机取一点，排序返回（UTC 毫秒）。
 */
export function randomPlanForDate(
  task: Pick<ScheduledTask, 'id' | 'rule' | 'timeZone'>,
  date: string,
): number[] {
  if (task.rule.kind !== 'random') return [];
  const rng = seededRandom(seedOf(task.id, date));
  const { start, end } = dayWindowUtc(task.rule, task.timeZone, date);
  if (end - start < 15 * 60_000) return [];
  const span = end - start;
  const n =
    task.rule.minTimes === task.rule.maxTimes
      ? task.rule.minTimes
      : task.rule.minTimes + Math.floor(rng() * (task.rule.maxTimes - task.rule.minTimes + 1));
  const points: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const segStart = start + Math.floor((span * i) / n);
    const segEnd = start + Math.floor((span * (i + 1)) / n);
    points.push(segStart + Math.floor(rng() * Math.max(1, segEnd - segStart)));
  }
  return [...new Set(points)].sort((a, b) => a - b);
}

/** 随机任务的下一次触发（UTC 毫秒）：今天计划中 lastRunAt 之后的第一个；否则明日计划首个。 */
export function nextRandomOccurrence(
  task: Pick<ScheduledTask, 'id' | 'rule' | 'timeZone'>,
  lastRunAt: string | undefined,
  now: Date,
): number {
  const today = dateString(task.timeZone, now);
  const todayPlan = randomPlanForDate(task as ScheduledTask, today);
  const lastEpoch = lastRunAt ? Date.parse(lastRunAt) : 0;
  const nextToday = todayPlan.find((point) => point > lastEpoch && point > now.getTime());
  if (nextToday !== undefined) return nextToday;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  const tomorrowDate = dateString(task.timeZone, tomorrow);
  const tomorrowPlan = randomPlanForDate(task as ScheduledTask, tomorrowDate);
  const first = tomorrowPlan[0];
  if (first !== undefined) return first;
  // 窗口非法等退化：明天同一时刻。
  return tomorrow.getTime();
}

/** every 任务在某一天窗口内的触发点（UTC 毫秒），按间隔从窗口起点对齐。
 *  无窗口时返回空（表示走固定间隔逻辑）。窗口跨度 < 间隔时仅窗口起点一个点。 */
function everyWindowPointsInDay(
  intervalMs: number,
  timeZone: string,
  date: string,
  windowStart?: string,
  windowEnd?: string,
): number[] {
  if (!windowStart || !windowEnd) return [];
  const startHm = parseHm(windowStart);
  const endHm = parseHm(windowEnd);
  const midnight = localMidnightUtc(date, timeZone);
  const start = midnight + minutesOfDay(startHm) * 60_000;
  const end = midnight + minutesOfDay(endHm) * 60_000;
  const points: number[] = [];
  for (let t = start; t <= end; t += intervalMs) points.push(t);
  return points;
}

/** every 窗口模式：after 之后第一个窗口触发点（当天剩余或后续某天）。 */
function nextEveryWindowPoint(
  task: ScheduledTask,
  afterEpoch: number,
  intervalMs: number,
): string | undefined {
  let day = dateString(task.timeZone, new Date(afterEpoch));
  for (let guard = 0; guard < 400; guard += 1) {
    const points = everyWindowPointsInDay(
      intervalMs,
      task.timeZone,
      day,
      task.rule.kind === 'every' ? task.rule.windowStart : undefined,
      task.rule.kind === 'every' ? task.rule.windowEnd : undefined,
    ).filter((point) => point > afterEpoch);
    if (points.length > 0) return new Date(points[0]).toISOString();
    const nextDayMs = localMidnightUtc(day, task.timeZone) + 24 * 60 * 60_000;
    day = dateString(task.timeZone, new Date(nextDayMs));
  }
  return undefined;
}

/**
 * 计算任务触发后的下一次触发（UTC ISO），返回 undefined 表示无下次（单次任务完成）。
 */
export function computeNextRunAt(
  task: ScheduledTask,
  firedAt: string,
  now: Date = new Date(),
): string | undefined {
  const rule: TaskRule = task.rule;
  switch (rule.kind) {
    case 'at':
      return undefined;
    case 'every': {
      const interval = Math.max(TASK_MIN_EVERY_MINUTES, rule.intervalMinutes) * 60_000;
      if (rule.windowStart && rule.windowEnd) {
        return nextEveryWindowPoint(task, Date.parse(firedAt), interval);
      }
      return new Date(Date.parse(firedAt) + interval).toISOString();
    }
    case 'random': {
      const next = nextRandomOccurrence(task, firedAt, now);
      return new Date(next).toISOString();
    }
    case 'cron': {
      try {
        const cron = new Cron(rule.expression, { timezone: task.timeZone });
        const next = cron.nextRun(new Date(firedAt));
        return next ? next.toISOString() : undefined;
      } catch {
        return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** 首次触发时间推算（创建任务时）。 */
export function initialNextRunAt(
  task: ScheduledTask,
  now: Date = new Date(),
): string | undefined {
  const rule = task.rule;
  if (rule.kind === 'at') return rule.runAt;
  if (rule.kind === 'every') {
    const interval = Math.max(TASK_MIN_EVERY_MINUTES, rule.intervalMinutes) * 60_000;
    if (rule.windowStart && rule.windowEnd) {
      // 窗口模式：now 之后第一个窗口点（当天剩余或后续某天）。
      const next = nextEveryWindowPoint(task, now.getTime(), interval);
      return next ?? new Date(now.getTime() + 5 * 60_000).toISOString();
    }
    const first = rule.firstRunAt ? Date.parse(rule.firstRunAt) : now.getTime() + 5 * 60_000;
    if (!Number.isFinite(first)) return new Date(now.getTime() + 5 * 60_000).toISOString();
    // 已过去的 firstRunAt → 按间隔顺延到未来。
    let candidate = first;
    while (candidate <= now.getTime()) candidate += interval;
    return new Date(candidate).toISOString();
  }
  if (rule.kind === 'random') {
    return new Date(nextRandomOccurrence(task, undefined, now)).toISOString();
  }
  if (rule.kind === 'cron') {
    try {
      const cron = new Cron(rule.expression, { timezone: task.timeZone });
      const next = cron.nextRun(now);
      return next ? next.toISOString() : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
