import { describe, expect, it } from 'vitest';
import { nextCronOccurrence, parseCronExpression } from './automation-schedule.js';

describe('automation cron schedule', () => {
  it('parses bounded lists, ranges, and steps', () => {
    const parsed = parseCronExpression('*/15 9-18 * * 1-5');
    expect([...parsed.minute.values]).toEqual([0, 15, 30, 45]);
    expect(parsed.hour.values.has(9)).toBe(true);
    expect(parsed.hour.values.has(19)).toBe(false);
    expect(parsed.dayOfWeek.values.has(5)).toBe(true);
    expect(() => parseCronExpression('* * * * * *')).toThrow(
      'automation.cron_requires_five_fields',
    );
    expect(() => parseCronExpression('70 * * * *')).toThrow(
      'automation.cron_value_out_of_range',
    );
  });

  it('calculates the next instant in the selected timezone', () => {
    expect(
      nextCronOccurrence('0 9 * * *', 'Asia/Shanghai', new Date('2026-07-18T00:30:00.000Z')),
    ).toBe('2026-07-18T01:00:00.000Z');
    expect(
      nextCronOccurrence('0 9 * * *', 'UTC', new Date('2026-07-18T08:30:00.000Z')),
    ).toBe('2026-07-18T09:00:00.000Z');
    expect(() => nextCronOccurrence('* * * * *', 'Mars/Base')).toThrow(
      'automation.timezone_invalid',
    );
  });
});
