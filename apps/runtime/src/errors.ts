import type { ErrorCode, StepId } from '@sync-think/shared';

export function canonicalApprovalDetails(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > 16) throw new Error('approval.action_details_too_deep');
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalApprovalDetails(entry, seen, depth + 1));
  }
  if (typeof value !== 'object') throw new Error('approval.action_details_invalid');
  if (seen.has(value)) throw new Error('approval.action_details_cycle');
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    result[key] = canonicalApprovalDetails(
      (value as Record<string, unknown>)[key],
      seen,
      depth + 1,
    );
  }
  seen.delete(value);
  return result;
}

export class PolicyScopeBoundaryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyScopeBoundaryError';
  }
}

export class PlanModeBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanModeBoundaryError';
  }
}

export class PlanReviewerDependencyError extends Error {
  constructor(stepId: StepId, dependencyCount: number) {
    super(`review.reviewer_dependency_invalid: ${stepId} has ${dependencyCount} dependencies`);
    this.name = 'PlanReviewerDependencyError';
  }
}

export class PlanReviewerLineageError extends Error {
  constructor(stepId: StepId, targetStepId: StepId) {
    super(`review.reviewer_lineage_invalid: ${stepId} targets planned reviewer ${targetStepId}`);
    this.name = 'PlanReviewerLineageError';
  }
}
