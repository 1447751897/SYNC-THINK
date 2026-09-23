import { describe, expect, it } from 'vitest';
import { resolveAcceptedReviewRunState, resolveReviewLimit } from './review-transition.js';
import { nextReviewAction } from './review-policy.js';
import type { AgentVersionId } from './types/ids.js';
import type { StepState } from './types/enums.js';

describe('review transition decisions', () => {
  const backupAgentVersionId = 'backup' as AgentVersionId;

  it.each([
    ['pause', false, undefined, { action: 'pause', failClosed: false }],
    ['abort', false, backupAgentVersionId, { action: 'abort' }],
    ['reassign', false, backupAgentVersionId, { action: 'reassign' }],
    [
      'reassign',
      true,
      backupAgentVersionId,
      {
        action: 'pause',
        failClosed: true,
        event: 'review.reassign-exhausted',
      },
    ],
    [
      'reassign',
      false,
      undefined,
      {
        action: 'pause',
        failClosed: true,
        event: 'review.reassign-unavailable',
      },
    ],
  ] as const)(
    'resolves %s with reassigned=%s and backup=%s',
    (onLimitReached, reassigned, backup, expected) => {
      expect(
        resolveReviewLimit({
          onLimitReached,
          reassigned,
          backupAgentVersionId: backup,
        }),
      ).toEqual(expected);
    },
  );

  it('accepts at the limit and only applies the limit after all rework iterations', () => {
    const input = { iteration: 1, maxIterations: 1, onLimitReached: 'abort' as const };
    expect(nextReviewAction({ ...input, verdict: 'accept' })).toEqual({ action: 'complete' });
    expect(nextReviewAction({ ...input, iteration: 0, verdict: 'reject' })).toEqual({
      action: 'rework',
      nextIteration: 1,
    });
    expect(nextReviewAction({ ...input, verdict: 'reject' })).toEqual({
      action: 'abort',
      reason: 'rework-limit-reached',
    });
  });

  it.each([
    [['completed', 'skipped'], false, 'completed'],
    [['completed', 'awaitingApproval', 'ready'], true, 'awaitingToolApproval'],
    [['completed', 'pending'], true, 'running'],
    [['completed', 'pending'], false, 'failed'],
    [['completed', 'failed'], false, 'failed'],
  ] as const)('resolves accepted review states %j', (states, hasRunnable, expected) => {
    expect(
      resolveAcceptedReviewRunState({
        stepStates: states as readonly StepState[],
        hasRunnable,
      }),
    ).toBe(expected);
  });
});
