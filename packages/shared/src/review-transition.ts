import type { AcceptanceGate } from './types/review.js';
import type { RunState, StepState } from './types/enums.js';

export type ReviewLimitDecision =
  | { action: 'reassign' }
  | { action: 'abort' }
  | { action: 'pause'; failClosed: false }
  | {
      action: 'pause';
      failClosed: true;
      event: 'review.reassign-exhausted' | 'review.reassign-unavailable';
    };

/** Called after nextReviewAction determines that the iteration limit was reached. */
export function resolveReviewLimit(
  gate: Pick<AcceptanceGate, 'onLimitReached' | 'reassigned' | 'backupAgentVersionId'>,
): ReviewLimitDecision {
  if (gate.onLimitReached === 'abort') return { action: 'abort' };
  if (gate.onLimitReached === 'pause') return { action: 'pause', failClosed: false };
  if (!gate.reassigned && gate.backupAgentVersionId) return { action: 'reassign' };
  return {
    action: 'pause',
    failClosed: true,
    event: gate.backupAgentVersionId ? 'review.reassign-exhausted' : 'review.reassign-unavailable',
  };
}

/** Storage supplies dependency eligibility; this policy chooses the resulting state. */
export function resolveAcceptedReviewRunState(input: {
  stepStates: readonly StepState[];
  hasRunnable: boolean;
}): RunState {
  if (input.stepStates.every((state) => state === 'completed' || state === 'skipped')) {
    return 'completed';
  }
  if (input.stepStates.includes('awaitingApproval')) return 'awaitingToolApproval';
  return input.hasRunnable ? 'running' : 'failed';
}
