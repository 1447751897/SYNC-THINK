import type {
  TaskId,
  PlanId,
  ModelId,
  RunId,
  StepId,
  ArtifactId,
  ArtifactVersionId,
  AcceptanceGateId,
  AgentVersionId,
} from './ids.js';
import type { PlanStepDraft } from './plan.js';
import type { Run, Step } from './run.js';
import type { ArtifactVersion, ArtifactVersionStatus, JsonValue } from './artifact.js';
import type { FailureClass } from './enums.js';
import type {
  ReviewStepExecutionContext,
  ReviewLimitAction,
  ReviewOutcome,
  ReviewEvidence,
} from './review.js';

export interface CreatePlanDraftInput {
  taskId: TaskId;
  title: string;
  steps: readonly PlanStepDraft[];
  now?: string;
}

export interface RevisePlanInput {
  planId: PlanId;
  expectedRevision: number;
  title?: string;
  steps: readonly PlanStepDraft[];
  now?: string;
}

export interface ApprovePlanInput {
  planId: PlanId;
  revision: number;
  now?: string;
}

export interface StoredStep extends Step {
  planOrder: number;
  title: string;
  instructions: string;
  modelOverrideId?: ModelId;
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  executionAttempt: number;
}

export interface StepDependencyRecord {
  runId: RunId;
  stepId: StepId;
  dependsOnStepId: StepId;
}

export interface RunGraph {
  run: Run;
  steps: StoredStep[];
  dependencies: StepDependencyRecord[];
}

export interface ClaimReadyStepsInput {
  runId: RunId;
  stepIds: readonly StepId[];
  ownerId: string;
  leaseExpiresAt: string;
  now?: string;
}

export interface ClaimReadyStepsResult {
  graph: RunGraph;
  claimedSteps: StoredStep[];
  artifactVersionsByStep: ReadonlyMap<StepId, ArtifactVersion[]>;
}

export type PrepareReviewStepForExecutionResult =
  | { status: 'ready'; graph: RunGraph; context?: ReviewStepExecutionContext }
  | {
      status: 'image-selection-required';
      graph: RunGraph;
      artifactIds: ArtifactId[];
      candidateVersionIds: ArtifactVersionId[];
    };

export interface RefreshStepLeaseInput {
  runId: RunId;
  stepId: StepId;
  ownerId: string;
  executionAttempt: number;
  leaseExpiresAt: string;
  now?: string;
}

interface StepArtifactVersionOutputBase {
  content?: string;
  contentRef?: string;
  contentHash?: string;
  mimeType: string;
  status: ArtifactVersionStatus;
  parentVersionIds?: readonly ArtifactVersionId[];
  metadata?: Record<string, JsonValue>;
  /** Groups multiple outputs into immutable versions of one newly-created Artifact. */
  artifactGroupKey?: string;
}

export type StepArtifactVersionOutput = StepArtifactVersionOutputBase &
  ({ artifactId: ArtifactId; artifactName?: never } | { artifactName: string; artifactId?: never });

export interface CompleteStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  outputVersions?: readonly StepArtifactVersionOutput[];
  now?: string;
}

export interface CompleteStepResult {
  graph: RunGraph;
  outputVersions: ArtifactVersion[];
  replayed: boolean;
}

export interface CompleteMergeStepInput {
  runId: RunId;
  stepId: StepId;
  now?: string;
}

export interface CreateAcceptanceGateInput {
  id: AcceptanceGateId;
  runId: RunId;
  targetStepId: StepId;
  reviewerAgentVersionId: AgentVersionId;
  initialReviewerStepId?: StepId;
  backupAgentVersionId?: AgentVersionId;
  maxIterations: number;
  onLimitReached: ReviewLimitAction;
  criteria: ReadonlyArray<{ id: string; description: string }>;
  now?: string;
}

export interface CompleteReviewStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  reviewerAgentVersionId: AgentVersionId;
  outcome: ReviewOutcome;
  now?: string;
}

export interface CompleteReviewStepResult {
  graph: RunGraph;
  evidence: ReviewEvidence;
  replayed: boolean;
}

export interface FailStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  failureClass: FailureClass;
  failureCode: string;
  summary: string;
  partialOutputVersions?: readonly StepArtifactVersionOutput[];
  now?: string;
}

export interface FailStepResult {
  graph: RunGraph;
  partialOutputVersions: ArtifactVersion[];
  replayed: boolean;
}

export interface AwaitStepApprovalInput {
  runId: RunId;
  stepId: StepId;
  approvalId: string;
  actionDigest: string;
  ownerId?: string;
  executionAttempt?: number;
  now?: string;
}

export interface ResolveStepApprovalInput {
  runId: RunId;
  stepId: StepId;
  approvalId: string;
  actionDigest: string;
  decision: 'approved' | 'rejected';
  decidedBy: 'human' | 'delegate';
  delegateAgentVersionId?: AgentVersionId;
  now?: string;
}
