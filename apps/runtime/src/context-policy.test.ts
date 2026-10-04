import { describe, expect, it } from 'vitest';
import { resolveContextBudget } from './context-policy.js';

describe('native context budget', () => {
  it('caps both default and explicit output reserves to model metadata', () => {
    expect(
      resolveContextBudget({ contextWindow: 128000, modelMaxOutputTokens: 2048 })
        .reservedOutputTokens,
    ).toBe(2048);
    expect(
      resolveContextBudget({
        contextWindow: 128000,
        reservedOutputTokens: 8000,
        modelMaxOutputTokens: 4096,
      }).reservedOutputTokens,
    ).toBe(4096);
    expect(() =>
      resolveContextBudget({ contextWindow: 128000, modelMaxOutputTokens: 0 }),
    ).toThrow();
  });
  it('reserves output and safety, subtracts fixed input only once, and starts at 85% of the window', () => {
    expect(
      resolveContextBudget({
        contextWindow: 272000,
        reservedOutputTokens: 16000,
        safetyMarginTokens: 8000,
        fixedInputTokens: 32000,
      }),
    ).toMatchObject({
      availableInputTokens: 248000,
      availableHistoryTokens: 216000,
      compactTriggerTokens: 231200,
      retainedTailTokens: 40960,
    });
  });
});
