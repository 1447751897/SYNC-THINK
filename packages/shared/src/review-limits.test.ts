import { describe, expect, it } from 'vitest';
import { nextReviewAction } from './review-policy.js';
import { MAX_REVIEW_ITERATIONS } from './types/agent.js';

describe('review iteration limits', () => {
  it('publishes the transport and persistence upper bound', () => {
    expect(MAX_REVIEW_ITERATIONS).toBe(100);
  });

  it('is the authoritative bounded review decision', () => {
    expect(
      nextReviewAction({
        verdict: 'accept',
        iteration: 0,
        maxIterations: 32,
        onLimitReached: 'reassign',
      }),
    ).toEqual({ action: 'complete' });
    expect(
      nextReviewAction({
        verdict: 'reject',
        iteration: 31,
        maxIterations: 32,
        onLimitReached: 'reassign',
      }),
    ).toEqual({ action: 'rework', nextIteration: 32 });
    expect(
      nextReviewAction({
        verdict: 'reject',
        iteration: 32,
        maxIterations: 32,
        onLimitReached: 'reassign',
      }),
    ).toEqual({ action: 'reassign', reason: 'rework-limit-reached' });
    expect(() =>
      nextReviewAction({
        verdict: 'reject',
        iteration: 0,
        maxIterations: 101,
        onLimitReached: 'pause',
      }),
    ).toThrow('review.iteration_invalid');
  });
});
