import {
  OrchestrationDomainError,
  type OrchestrationDomainErrorCode,
} from './orchestration-errors.js';
import { isReviewOutcomeConsistent } from './review-policy.js';
import type { AcceptanceCriterion, ReviewOutcome } from './types/review.js';
import type { ArtifactVersionId } from './types/ids.js';

function reviewOutcomeText(
  value: unknown,
  code: OrchestrationDomainErrorCode,
  maxLength = 4_000,
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new OrchestrationDomainError(code);
  return text;
}

/** Validate before loading the assigned artifact snapshot, preserving error precedence. */
export function normalizeReviewOutcome(
  gateCriteria: readonly AcceptanceCriterion[],
  value: ReviewOutcome,
): ReviewOutcome {
  if (!value || (value.verdict !== 'accept' && value.verdict !== 'reject')) {
    throw new OrchestrationDomainError('review.verdict_invalid');
  }
  const explanation = reviewOutcomeText(value.explanation, 'review.explanation_invalid');
  if (!Array.isArray(value.criteria) || value.criteria.length !== gateCriteria.length) {
    throw new OrchestrationDomainError('review.criteria_mismatch');
  }
  const outcomesById = new Map<string, ReviewOutcome['criteria'][number]>();
  for (const criterion of value.criteria) {
    const criterionId = reviewOutcomeText(
      criterion?.criterionId,
      'review.criterion_id_invalid',
      256,
    );
    if (outcomesById.has(criterionId)) {
      throw new OrchestrationDomainError('review.criteria_mismatch');
    }
    if (criterion.verdict !== 'pass' && criterion.verdict !== 'fail') {
      throw new OrchestrationDomainError('review.criterion_verdict_invalid');
    }
    outcomesById.set(criterionId, {
      criterionId,
      verdict: criterion.verdict,
      explanation: reviewOutcomeText(criterion.explanation, 'review.criterion_explanation_invalid'),
    });
  }
  const criteria = gateCriteria.map((criterion) => {
    const outcome = outcomesById.get(criterion.id);
    if (!outcome) throw new OrchestrationDomainError('review.criteria_mismatch');
    return outcome;
  });
  if (!isReviewOutcomeConsistent({ verdict: value.verdict, criteria })) {
    throw new OrchestrationDomainError('review.verdict_criteria_mismatch');
  }

  if (!Array.isArray(value.reviewedArtifactVersionIds)) {
    throw new OrchestrationDomainError('review.artifact_scope_mismatch');
  }
  const requestedIds = value.reviewedArtifactVersionIds.map(
    (id) => reviewOutcomeText(id, 'review.artifact_scope_mismatch', 256) as ArtifactVersionId,
  );
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new OrchestrationDomainError('review.artifact_scope_mismatch');
  }
  return {
    verdict: value.verdict,
    explanation,
    criteria,
    reviewedArtifactVersionIds: requestedIds,
  };
}

/** Bind a validated outcome to the exact, ordered artifact assignment. */
export function bindReviewOutcomeToArtifacts(
  outcome: ReviewOutcome,
  assignedIds: readonly ArtifactVersionId[],
): ReviewOutcome {
  const requestedIds = outcome.reviewedArtifactVersionIds;
  if (
    assignedIds.length === 0 ||
    assignedIds.length !== requestedIds.length ||
    assignedIds.some((id) => !requestedIds.includes(id))
  ) {
    throw new OrchestrationDomainError('review.artifact_scope_mismatch');
  }
  return { ...outcome, reviewedArtifactVersionIds: [...assignedIds] };
}

export function reviewEvidenceMatches(evidence: ReviewOutcome, outcome: ReviewOutcome): boolean {
  return (
    evidence.verdict === outcome.verdict &&
    evidence.explanation === outcome.explanation &&
    JSON.stringify(evidence.criteria) === JSON.stringify(outcome.criteria) &&
    JSON.stringify(evidence.reviewedArtifactVersionIds) ===
      JSON.stringify(outcome.reviewedArtifactVersionIds)
  );
}
