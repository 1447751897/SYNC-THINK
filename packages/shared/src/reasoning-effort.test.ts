import { describe, expect, it } from 'vitest';
import { isReasoningEffort, REASONING_EFFORT_LEVELS } from './reasoning-effort.js';

describe('product reasoning effort', () => {
  it('includes the complete eight-level ladder exactly once', () => {
    expect(REASONING_EFFORT_LEVELS).toEqual([
      'auto', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    expect(new Set(REASONING_EFFORT_LEVELS).size).toBe(8);
  });

  it.each(REASONING_EFFORT_LEVELS)('recognizes %s', level => {
    expect(isReasoningEffort(level)).toBe(true);
  });

  it.each([undefined, null, '', 0, {}, 'unknown', ' high '])('rejects invalid effort %j', level => {
    expect(isReasoningEffort(level)).toBe(false);
  });
});
