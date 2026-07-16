import type {
  FailureClass,
  ReviewOutcome,
  ReviewStepExecutionContext,
  RunId,
} from '@sync-think/shared';
import type { StepArtifactVersionOutput, StoredStep } from '@sync-think/storage';
import type { ArtifactVersion } from '@sync-think/shared';

export interface StepExecutionContext {
  runId: RunId;
  step: Readonly<StoredStep>;
  idempotencyKey: string;
  artifactVersions: readonly ArtifactVersion[];
  reviewContext?: Readonly<ReviewStepExecutionContext>;
  signal: AbortSignal;
  /** Runtime-owned policy gate for dynamic actions discovered during execution. */
  gateAction?: (request: StepActionRequest) => Promise<StepActionGateResult>;
}

export interface StepActionGateResult {
  allowed: boolean;
  actionDigest: string;
}

export interface StepExecutionResult {
  outputVersions?: readonly StepArtifactVersionOutput[];
  reviewOutcome?: Readonly<ReviewOutcome>;
}

export type StepActionKind =
  'tool' | 'export' | 'skill-permission' | 'mcp-permission' | 'human-only' | 'other';

export interface StepActionRequest {
  kind?: StepActionKind;
  action: string;
  summary?: string;
  /** Structured action inputs covered by the server-generated approval digest. */
  details?: Record<string, unknown>;
}

export interface StepActionInspectionContext {
  runId: RunId;
  step: Readonly<StoredStep>;
}

export interface StepExecutor {
  /** Implementations must deduplicate external effects by context.idempotencyKey. */
  execute(context: StepExecutionContext): Promise<StepExecutionResult>;
  /** Declares a protected action before execute can perform an external side effect. */
  getActionRequest?(
    context: StepActionInspectionContext,
  ): StepActionRequest | undefined | Promise<StepActionRequest | undefined>;
}

/**
 * An executor may raise this only before the requested external effect occurs.
 * Scheduler persists running -> awaitingApproval and retries with the same Step/key.
 */
export class StepAwaitingApprovalError extends Error {
  override readonly name = 'StepAwaitingApprovalError';

  constructor(readonly request: StepActionRequest) {
    super('step.awaiting_approval');
  }
}

export class StepExecutionError extends Error {
  override readonly name = 'StepExecutionError';
  readonly code: string;

  constructor(
    message: string,
    readonly failureClass: FailureClass,
    readonly partialOutputVersions: readonly StepArtifactVersionOutput[] = [],
  ) {
    super(message);
    this.code = `step.executor.${failureClass}`;
  }
}
