import type {
  AcceptanceGateId,
  AgentVersionId,
  ArtifactVersionId,
  RunId,
  StepId,
} from './ids.js';
import type { ArtifactVersion } from './artifact.js';

export type ReviewVerdict = 'accept' | 'reject';
export type ReviewCriterionVerdict = 'pass' | 'fail';
export type ReviewLimitAction = 'pause' | 'abort' | 'reassign';
export type AcceptanceGateState = 'active' | 'accepted' | 'limit-reached';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  planOrder: number;
}

export interface AcceptanceGate {
  id: AcceptanceGateId;
  runId: RunId;
  targetStepId: StepId;
  reviewerAgentVersionId: AgentVersionId;
  backupAgentVersionId?: AgentVersionId;
  maxIterations: number;
  onLimitReached: ReviewLimitAction;
  state: AcceptanceGateState;
  reassigned: boolean;
  criteria: AcceptanceCriterion[];
  createdAt: string;
  resolvedAt?: string;
}

export interface ReviewCriterionOutcome {
  criterionId: string;
  verdict: ReviewCriterionVerdict;
  explanation: string;
}

export interface ReviewOutcome {
  verdict: ReviewVerdict;
  explanation: string;
  criteria: ReviewCriterionOutcome[];
  reviewedArtifactVersionIds: ArtifactVersionId[];
}

export interface ReviewEvidence extends ReviewOutcome {
  id: string;
  gateId: AcceptanceGateId;
  runId: RunId;
  targetStepId: StepId;
  reviewerStepId: StepId;
  reviewerAgentVersionId: AgentVersionId;
  iteration: number;
  createdAt: string;
}

export interface ReviewerStepExecutionContext {
  kind: 'reviewer';
  gateId: AcceptanceGateId;
  targetStepId: StepId;
  iteration: number;
  criteria: readonly AcceptanceCriterion[];
  reviewedArtifactVersions: readonly ArtifactVersion[];
}

export interface ReworkStepExecutionContext {
  kind: 'rework';
  gateId: AcceptanceGateId;
  targetStepId: StepId;
  iteration: number;
  evidence: Readonly<ReviewEvidence>;
}

export type ReviewStepExecutionContext =
  | ReviewerStepExecutionContext
  | ReworkStepExecutionContext;
