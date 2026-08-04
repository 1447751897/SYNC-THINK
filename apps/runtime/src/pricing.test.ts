import { describe, expect, it } from 'vitest';
import { estimateUsageCostBreakdown } from './pricing.js';

describe('estimateUsageCostBreakdown', () => {
  it('prices ordinary input, cache reads, cache writes, and output independently', () => {
    const result = estimateUsageCostBreakdown(
      {
        tokensIn: 14_000,
        tokensOut: 488,
        cachedTokensHit: 12_800,
        cachedTokensCreated: 0,
      },
      {
        modelId: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        currency: 'USD',
        inputPerMillion: 5,
        outputPerMillion: 12,
        cacheReadPerMillion: 0.5,
        cacheWritePerMillion: 6.25,
      },
    );

    expect(result.input).toBeCloseTo(0.006);
    expect(result.cacheRead).toBeCloseTo(0.0064);
    expect(result.cacheWrite).toBe(0);
    expect(result.output).toBeCloseTo(0.005856);
    expect(result.total).toBeCloseTo(0.018256);
  });
});
