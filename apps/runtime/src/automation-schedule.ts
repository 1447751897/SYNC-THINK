const MAX_SEARCH_MINUTES = 366 * 24 * 60;

interface CronField {
  values: ReadonlySet<number>;
  wildcard: boolean;
}

export interface ParsedCronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseNumber(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error('automation.cron_invalid_number');
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('automation.cron_value_out_of_range');
  }
  return parsed;
}

function parseField(source: string, min: number, max: number, normalize?: (value: number) => number): CronField {
  const values = new Set<number>();
  const wildcard = source === '*' || source.startsWith('*/');
  for (const part of source.split(',')) {
    if (!part) throw new Error('automation.cron_empty_field_part');
    const [rangeSource, stepSource, ...rest] = part.split('/');
    if (rest.length > 0 || !rangeSource) throw new Error('automation.cron_invalid_step');
    const step = stepSource === undefined ? 1 : parseNumber(stepSource, 1, max - min + 1);
    let start: number;
    let end: number;
    if (rangeSource === '*') {
      start = min;
      end = max;
    } else if (rangeSource.includes('-')) {
      const [startSource, endSource, ...rangeRest] = rangeSource.split('-');
      if (rangeRest.length > 0 || !startSource || !endSource) {
        throw new Error('automation.cron_invalid_range');
      }
      start = parseNumber(startSource, min, max);
      end = parseNumber(endSource, min, max);
      if (start > end) throw new Error('automation.cron_descending_range');
    } else {
      if (stepSource !== undefined) throw new Error('automation.cron_step_requires_range');
      start = parseNumber(rangeSource, min, max);
      end = start;
    }
    for (let value = start; value <= end; value += step) {
      values.add(normalize ? normalize(value) : value);
    }
  }
  if (values.size === 0) throw new Error('automation.cron_empty_field');
  return { values, wildcard };
}

export function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('automation.cron_requires_five_fields');
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
    dayOfMonth: parseField(fields[2]!, 1, 31),
    month: parseField(fields[3]!, 1, 12),
    dayOfWeek: parseField(fields[4]!, 0, 7, (value) => (value === 7 ? 0 : value)),
  };
}

function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
      weekday: 'short',
    });
    value.format(new Date(0));
    return value;
  } catch {
    throw new Error('automation.timezone_invalid');
  }
}

const WEEKDAY = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

function localParts(value: Intl.DateTimeFormat, date: Date) {
  const parts = Object.fromEntries(
    value
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const dayOfWeek = WEEKDAY.get(parts.weekday ?? '');
  if (dayOfWeek === undefined) throw new Error('automation.timezone_weekday_invalid');
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek,
  };
}

function matches(expression: ParsedCronExpression, parts: ReturnType<typeof localParts>): boolean {
  if (!expression.minute.values.has(parts.minute)) return false;
  if (!expression.hour.values.has(parts.hour)) return false;
  if (!expression.month.values.has(parts.month)) return false;
  const dayOfMonthMatches = expression.dayOfMonth.values.has(parts.dayOfMonth);
  const dayOfWeekMatches = expression.dayOfWeek.values.has(parts.dayOfWeek);
  const dayMatches =
    expression.dayOfMonth.wildcard && expression.dayOfWeek.wildcard
      ? true
      : expression.dayOfMonth.wildcard
        ? dayOfWeekMatches
        : expression.dayOfWeek.wildcard
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;
  return dayMatches;
}

export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: Date = new Date(),
): string {
  const parsed = parseCronExpression(expression);
  const zonedFormatter = formatter(timezone);
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < MAX_SEARCH_MINUTES; offset++) {
    const candidate = new Date(start + offset * 60_000);
    if (matches(parsed, localParts(zonedFormatter, candidate))) return candidate.toISOString();
  }
  throw new Error('automation.cron_no_occurrence_within_one_year');
}
