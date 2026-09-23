import type {
  ApprovalRequestId,
  Run,
  RunId,
  StepId,
  ReviewStepExecutionContext,
  RunGraph,
  ClaimReadyStepsInput,
  ClaimReadyStepsResult,
  PrepareReviewStepForExecutionResult,
  RefreshStepLeaseInput,
  CompleteStepInput,
  CompleteStepResult,
  CompleteReviewStepInput,
  CompleteReviewStepResult,
  FailStepInput,
  FailStepResult,
  AwaitStepApprovalInput,
  ResolveStepApprovalInput,
  ApprovalRequestRecord,
  EnqueueApprovalInput,
  DecideApprovalInput,
  GetOrCreateAgentContextThreadInput,
  AgentContextThreadRecord,
} from '@sync-think/shared';

/** Scheduling capabilities only; no database connection or administrative methods. */
export interface SchedulingRepository {
  getRun(runId: RunId): Run | undefined;
  getGraph(runId: RunId): RunGraph | undefined;
  listRecoverableRunIds(): RunId[];
  prepareReviewStepForExecution(
    runId: RunId,
    stepId: StepId,
    now?: string,
  ): PrepareReviewStepForExecutionResult;
  getReviewStepContext(runId: RunId, stepId: StepId): ReviewStepExecutionContext | undefined;
  claimReadySteps(input: ClaimReadyStepsInput): ClaimReadyStepsResult;
  recoverRun(runId: RunId, now?: string): RunGraph;
  refreshStepLease(input: RefreshStepLeaseInput): boolean;
  getNextLeaseExpiry(runId: RunId): string | undefined;
  completeStep(input: CompleteStepInput): CompleteStepResult;
  completeReviewStep(input: CompleteReviewStepInput): CompleteReviewStepResult;
  failStep(input: FailStepInput): FailStepResult;
  awaitStepApproval(input: AwaitStepApprovalInput): RunGraph;
  resolveStepApproval(input: ResolveStepApprovalInput): RunGraph;
  pauseRun(runId: RunId, now?: string): RunGraph;
  resumeRun(runId: RunId, now?: string): RunGraph;
  cancelRun(runId: RunId, now?: string): RunGraph;
}

export interface SchedulingApprovals {
  get(id: ApprovalRequestId): ApprovalRequestRecord | null;
  findLatestForStepAction(
    runId: RunId,
    stepId: StepId,
    actionDigest: string,
  ): ApprovalRequestRecord | null;
  enqueue(input: EnqueueApprovalInput): ApprovalRequestRecord;
  decide(input: DecideApprovalInput): ApprovalRequestRecord;
}

export interface SchedulingTransaction {
  run<T>(operation: () => T): T;
}

export interface SchedulingAgentContexts {
  getOrCreateThread(input: GetOrCreateAgentContextThreadInput): AgentContextThreadRecord;
}
