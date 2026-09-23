import { describe, expect, it } from 'vitest';
import { formatCapabilityMetric, formatUsageTokenCount } from './compact-number.js';

describe('compact number presentation policies', () => {
  it('preserves the capability detail policy', () => {
    expect(formatCapabilityMetric(999)).toBe('999');
    expect(formatCapabilityMetric(1_000)).toBe('1.0k');
    expect(formatCapabilityMetric(9_999)).toBe('10.0k');
    expect(formatCapabilityMetric(10_000)).toBe('10k');
    expect(formatCapabilityMetric(2_300_000)).toBe('2300k');
  });

  it('preserves the provider usage token policy', () => {
    expect(formatUsageTokenCount(999)).toBe('999');
    expect(formatUsageTokenCount(1_000)).toBe('1.0k');
    expect(formatUsageTokenCount(999_999)).toBe('1000.0k');
    expect(formatUsageTokenCount(1_000_000)).toBe('1.0M');
    expect(formatUsageTokenCount(2_300_000)).toBe('2.3M');
  });
});
