import { MAX_REVIEW_ITERATIONS } from './types/agent.js';
import type { ReviewLimitAction, ReviewOutcome, ReviewVerdict } from './types/review.js';

export interface NextReviewActionInput {
  verdict: ReviewVerdict;
  iteration: number;
  maxIterations: number;
  onLimitReached: ReviewLimitAction;
}

export type NextReviewAction =
  | { action: 'complete' }
  | { action: 'rework'; nextIteration: number }
  | { action: ReviewLimitAction; reason: 'rework-limit-reached' };

export function isReviewOutcomeConsistent(
  outcome: Pick<ReviewOutcome, 'verdict' | 'criteria'>,
): boolean {
  const allCriteriaPass = outcome.criteria.every((criterion) => criterion.verdict === 'pass');
  return outcome.verdict === (allCriteriaPass ? 'accept' : 'reject');
}

export function nextReviewAction(input: NextReviewActionInput): NextReviewAction {
  if (
    !Number.isSafeInteger(input.iteration) ||
    !Number.isSafeInteger(input.maxIterations) ||
    input.iteration < 0 ||
    input.maxIterations < 0 ||
    input.maxIterations > MAX_REVIEW_ITERATIONS ||
    input.iteration > input.maxIterations
  ) {
    throw new Error('review.iteration_invalid');
  }
  if (input.verdict === 'accept') return { action: 'complete' };
  if (input.iteration < input.maxIterations) {
    return { action: 'rework', nextIteration: input.iteration + 1 };
  }
  return { action: input.onLimitReached, reason: 'rework-limit-reached' };
}
