import { describe, expect, it } from 'vitest';
import { buildGreeting, greetingForHour } from '../ui-preferences.js';

describe('greetingForHour', () => {
  it('maps each band to its zh-CN greeting', () => {
    expect(greetingForHour(0)).toBe('凌晨好');
    expect(greetingForHour(4)).toBe('凌晨好');
    expect(greetingForHour(5)).toBe('早上好');
    expect(greetingForHour(10)).toBe('早上好');
    expect(greetingForHour(11)).toBe('上午好');
    expect(greetingForHour(12)).toBe('中午好');
    expect(greetingForHour(13)).toBe('下午好');
    expect(greetingForHour(17)).toBe('下午好');
    expect(greetingForHour(18)).toBe('晚上好');
    expect(greetingForHour(23)).toBe('晚上好');
  });

  it('falls back for non-finite input', () => {
    expect(greetingForHour(Number.NaN)).toBe('你好');
  });
});

describe('buildGreeting', () => {
  it('appends the name when set', () => {
    expect(buildGreeting(20, 'Kevin')).toBe('晚上好，Kevin');
  });

  it('omits the separator when the name is blank', () => {
    expect(buildGreeting(20, '')).toBe('晚上好');
    expect(buildGreeting(20, '   ')).toBe('晚上好');
  });
});
