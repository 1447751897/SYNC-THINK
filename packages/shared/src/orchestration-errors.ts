import type { StepId } from './types/ids.js';

export type OrchestrationDataErrorCode =
  | 'plan.invalid_input'
  | 'plan.invalid_steps_json'
  | 'plan.invalid_diff_json'
  | 'plan.invalid_revision_state'
  | 'run.invalid_state'
  | 'step.invalid_state'
  | 'step.invalid_image_generation_config'
  | 'step.invalid_idempotency_key';

export class OrchestrationDataError extends Error {
  override readonly name = 'OrchestrationDataError';

  constructor(
    readonly code: OrchestrationDataErrorCode,
    readonly path: string,
    detail?: string,
  ) {
    super(`${code}: ${path}${detail ? ` (${detail})` : ''}`);
  }
}

export type OrchestrationDomainErrorCode =
  | 'review.verdict_invalid'
  | 'review.explanation_invalid'
  | 'review.criteria_mismatch'
  | 'review.criterion_id_invalid'
  | 'review.criterion_verdict_invalid'
  | 'review.criterion_explanation_invalid'
  | 'review.verdict_criteria_mismatch'
  | 'review.artifact_scope_mismatch';

export class OrchestrationDomainError extends Error {
  override readonly name = 'OrchestrationDomainError';
  readonly failureClass = 'acceptance' as const;

  constructor(readonly code: OrchestrationDomainErrorCode) {
    super(code);
  }
}

export function isOrchestrationDomainError(error: unknown): error is OrchestrationDomainError {
  return error instanceof OrchestrationDomainError;
}

export class StepSnapshotLimitError extends Error {
  override readonly name = 'StepSnapshotLimitError';
  readonly code = 'step.snapshot_limit_exceeded';
  readonly failureClass = 'acceptance' as const;

  constructor(
    readonly stepId: StepId,
    readonly limit: 'versions' | 'inline_bytes',
  ) {
    super(`step.snapshot_limit_exceeded: ${stepId}:${limit}`);
  }
}

export function isStepSnapshotLimitError(error: unknown): error is StepSnapshotLimitError {
  return error instanceof StepSnapshotLimitError;
}

export class StepFenceMismatchError extends Error {
  override readonly name = 'StepFenceMismatchError';
  readonly code = 'step.fence_mismatch';

  constructor(readonly stepId: StepId) {
    super(`step.fence_mismatch: ${stepId}`);
  }
}

export function isStepFenceMismatchError(error: unknown): error is StepFenceMismatchError {
  return error instanceof StepFenceMismatchError;
}
