import { describe, expect, it } from 'vitest';
import { splitProviderUsageTokens } from './usage.js';

describe('splitProviderUsageTokens', () => {
  it('separates ordinary input from cache reads and writes without double counting', () => {
    expect(
      splitProviderUsageTokens({
        tokensIn: 14_000,
        tokensOut: 488,
        cachedTokensHit: 12_800,
        cachedTokensCreated: 0,
      }),
    ).toEqual({
      inputTokens: 1_200,
      cacheReadTokens: 12_800,
      cacheWriteTokens: 0,
      outputTokens: 488,
      totalInputTokens: 14_000,
      totalTokens: 14_488,
    });
  });

  it('clamps malformed cache details to the reported total input', () => {
    expect(
      splitProviderUsageTokens({
        tokensIn: 100,
        tokensOut: 20,
        cachedTokensHit: 80,
        cachedTokensCreated: 40,
      }),
    ).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 80,
      cacheWriteTokens: 20,
      totalInputTokens: 100,
      totalTokens: 120,
    });
  });
});
