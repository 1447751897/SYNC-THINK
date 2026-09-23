import { describe, expect, it } from 'vitest';
import {
  formatCompactCount,
  formatCompactDuration,
  formatCompactRunMetrics,
  formatMessageAbsoluteTime,
  formatMessageClock,
  formatRunModelLabel,
} from './run-display-format.js';

describe('run display formatting', () => {
  it('formats compact token counts', () => {
    expect(formatCompactCount(842)).toBe('842');
    expect(formatCompactCount(647_900)).toBe('647.9k');
    expect(formatCompactCount(1_200_000)).toBe('1.2M');
    expect(formatCompactCount(Number.NaN)).toBe('0');
  });

  it('formats compact durations', () => {
    expect(formatCompactDuration(840)).toBe('840ms');
    expect(formatCompactDuration(51_000)).toBe('51s');
    expect(formatCompactDuration(72_000)).toBe('1m 12s');
    expect(formatCompactDuration(7_500_000)).toBe('2h 5m');
    expect(formatCompactDuration(-1)).toBeUndefined();
  });

  it('combines duration and token metrics without inventing missing values', () => {
    expect(
      formatCompactRunMetrics({ durationMs: 51_000, tokensIn: 600_000, tokensOut: 47_900 }),
    ).toBe('51s · 647.9k');
    expect(formatCompactRunMetrics({ durationMs: 2_000 })).toBe('2s');
    expect(formatCompactRunMetrics({ tokensOut: 1_200 })).toBe('1.2k');
    expect(formatCompactRunMetrics({})).toBeUndefined();
  });

  it('prefers catalog model labels and removes provider namespace noise', () => {
    expect(
      formatRunModelLabel({
        catalogName: 'GLM 5.2',
        providerModelId: 'z-ai/glm-5.2',
        modelId: 'model-1',
      }),
    ).toBe('GLM 5.2');
    expect(formatRunModelLabel({ providerModelId: 'z-ai/glm-5.2' })).toBe('glm-5.2');
    expect(formatRunModelLabel({ modelId: 'model-1' })).toBe('model-1');
  });

  it('rejects invalid timestamps and formats valid ones', () => {
    expect(formatMessageClock('not-a-date')).toBeUndefined();
    expect(formatMessageAbsoluteTime('not-a-date')).toBeUndefined();
    expect(formatMessageClock('2026-09-20T08:00:00.000Z')).toBeTruthy();
    expect(formatMessageAbsoluteTime('2026-09-20T08:00:00.000Z')).toBeTruthy();
  });
});
