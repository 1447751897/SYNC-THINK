import { describe, expect, it } from 'vitest';
import { nextReviewAction } from './rework-policy.js';

describe('nextReviewAction', () => {
  it('completes only an accepted review', () => {
    expect(
      nextReviewAction({
        verdict: 'accept',
        iteration: 0,
        maxIterations: 1,
        onLimitReached: 'pause',
      }),
    ).toEqual({ action: 'complete' });
  });

  it('allows exactly one rework when maxIterations is one', () => {
    expect(
      nextReviewAction({
        verdict: 'reject',
        iteration: 0,
        maxIterations: 1,
        onLimitReached: 'pause',
      }),
    ).toEqual({ action: 'rework', nextIteration: 1 });
  });

  it.each([
    ['pause', { action: 'pause', reason: 'rework-limit-reached' }],
    ['abort', { action: 'abort', reason: 'rework-limit-reached' }],
    ['reassign', { action: 'reassign', reason: 'rework-limit-reached' }],
  ] as const)('applies %s on the second rejection', (onLimitReached, expected) => {
    expect(
      nextReviewAction({
        verdict: 'reject',
        iteration: 1,
        maxIterations: 1,
        onLimitReached,
      }),
    ).toEqual(expected);
  });

  it.each([
    { verdict: 'reject', iteration: -1, maxIterations: 1, onLimitReached: 'pause' },
    { verdict: 'reject', iteration: 0, maxIterations: -1, onLimitReached: 'pause' },
    { verdict: 'reject', iteration: 2, maxIterations: 1, onLimitReached: 'pause' },
    { verdict: 'reject', iteration: 0, maxIterations: 101, onLimitReached: 'pause' },
  ] as const)('rejects invalid persisted iteration bounds', (input) => {
    expect(() => nextReviewAction(input)).toThrow('review.iteration_invalid');
  });
});
