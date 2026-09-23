import { describe, expect, it } from 'vitest';
import {
  bindReviewOutcomeToArtifacts,
  normalizeReviewOutcome,
  reviewEvidenceMatches,
} from './review-outcome.js';
import { OrchestrationDomainError } from './orchestration-errors.js';
import type { ArtifactVersionId } from './types/ids.js';
import type { ReviewOutcome } from './types/review.js';

const gateCriteria = [
  { id: 'one', description: 'First', planOrder: 0 },
  { id: 'two', description: 'Second', planOrder: 1 },
];
const v1 = 'v1' as ArtifactVersionId;
const v2 = 'v2' as ArtifactVersionId;
function valid(): ReviewOutcome {
  return {
    verdict: 'accept',
    explanation: ' accepted ',
    criteria: [
      { criterionId: 'two', verdict: 'pass', explanation: ' checked two ' },
      { criterionId: 'one', verdict: 'pass', explanation: ' checked one ' },
    ],
    reviewedArtifactVersionIds: [v2, v1],
  };
}

describe('review outcome policy', () => {
  it('canonicalizes criteria and assigned artifacts without mutating the caller', () => {
    const input = valid();
    const outcome = bindReviewOutcomeToArtifacts(normalizeReviewOutcome(gateCriteria, input), [
      v1,
      v2,
    ]);
    expect(outcome).toEqual({
      verdict: 'accept',
      explanation: 'accepted',
      criteria: [
        { criterionId: 'one', verdict: 'pass', explanation: 'checked one' },
        { criterionId: 'two', verdict: 'pass', explanation: 'checked two' },
      ],
      reviewedArtifactVersionIds: [v1, v2],
    });
    expect(input).toEqual(valid());
    expect(reviewEvidenceMatches(outcome, structuredClone(outcome))).toBe(true);
    expect(reviewEvidenceMatches(outcome, { ...outcome, explanation: 'changed' })).toBe(false);
  });

  it.each([
    [{ verdict: 'invalid' }, 'review.verdict_invalid'],
    [{ explanation: ' ' }, 'review.explanation_invalid'],
    [{ explanation: 'x'.repeat(4001) }, 'review.explanation_invalid'],
    [{ criteria: [] }, 'review.criteria_mismatch'],
    [{ verdict: 'reject' }, 'review.verdict_criteria_mismatch'],
    [{ reviewedArtifactVersionIds: [v1, v1] }, 'review.artifact_scope_mismatch'],
  ])('rejects malformed outcome %j', (change, code) => {
    const run = () =>
      normalizeReviewOutcome(gateCriteria, { ...valid(), ...change } as ReviewOutcome);
    expect(run).toThrow(OrchestrationDomainError);
    expect(run).toThrow(code);
  });

  it.each([[], [v1], [v1, 'foreign' as ArtifactVersionId]].map((ids) => [ids]))(
    'rejects assignment mismatch %j',
    (assigned) => {
      expect(() =>
        bindReviewOutcomeToArtifacts(normalizeReviewOutcome(gateCriteria, valid()), assigned),
      ).toThrow('review.artifact_scope_mismatch');
    },
  );
});
