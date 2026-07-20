import { createHash } from 'node:crypto';
import { getReadyStepIds, validateDag } from '@sync-think/core';
import {
  ulid,
  type AgentVersionId,
  type ApprovalMode,
  type ArtifactVersion,
  type FailureClass,
  type HumanOnlyAction,
  type RunId,
  type StepId,
  type TaskId,
  type WorkspaceId,
} from '@sync-think/shared';
import {
  isOrchestrationDomainError,
  isStepFenceMismatchError,
  scrubDiagnosticText,
  type RunGraph,
  type SqliteApprovalStore,
  SqliteOrchestrationStore,
  type SqliteUnitOfWork,
  type StoredStep,
} from '@sync-think/storage';
import {
  StepAwaitingApprovalError,
  StepExecutionError,
  type StepActionRequest,
  type StepExecutionContext,
  type StepExecutor,
} from './step-executor.js';

export interface SchedulerApprovalEvaluation {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  gate: 'auto-approve' | 'require-human' | 'require-delegate' | 'deny';
  humanOnly: boolean;
  humanOnlyAction?: HumanOnlyAction;
  mode: ApprovalMode;
  reason: string;
  labelZh: string;
  delegateAgentVersionId?: AgentVersionId;
}

export interface SchedulerApprovalPolicy {
  evaluate(input: {
    runId: RunId;
    step: Readonly<StoredStep>;
    request: Readonly<StepActionRequest>;
    actionDigest: string;
  }): SchedulerApprovalEvaluation;
  validateDelegateAgentVersion?(agentVersionId: AgentVersionId): boolean;
}

export interface SchedulerOptions {
  store: SqliteOrchestrationStore;
  executor: StepExecutor;
  now?: () => string;
  ownerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  approvalStore?: SqliteApprovalStore;
  unitOfWork?: SqliteUnitOfWork;
  approvalPolicy?: SchedulerApprovalPolicy;
}

const DEFAULT_LEASE_DURATION_MS = 30_000;
const FAILURE_CLASSES = new Set<FailureClass>([
  'transient',
  'auth',
  'protocol',
  'permission',
  'acceptance',
  'rate-limit',
  'timeout',
  'unknown',
]);
const STEP_ACTION_KINDS = new Set([
  'tool',
  'export',
  'skill-permission',
  'mcp-permission',
  'human-only',
  'other',
]);

class StepLeaseHeartbeatError extends StepExecutionError {
  constructor() {
    super('Step lease heartbeat refresh failed', 'transient');
  }
}

function canonicalizeActionDetails(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > 16) throw new Error('approval.action_details_too_deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeActionDetails(entry, seen, depth + 1));
  }
  if (typeof value !== 'object') throw new Error('approval.action_details_invalid');
  if (seen.has(value)) throw new Error('approval.action_details_cycle');
  seen.add(value);
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    result[key] = canonicalizeActionDetails(record[key], seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function normalizeActionRequest(request: StepActionRequest): StepActionRequest {
  const action = String(request.action ?? '').trim();
  if (!action || action.length > 256) throw new Error('approval.action_invalid');
  const kind = STEP_ACTION_KINDS.has(String(request.kind ?? 'other'))
    ? (request.kind ?? 'other')
    : 'other';
  const summary = String(request.summary ?? action).trim();
  if (!summary || summary.length > 1_000) throw new Error('approval.summary_invalid');
  const details =
    request.details === undefined
      ? undefined
      : (canonicalizeActionDetails(request.details) as Record<string, unknown>);
  if (JSON.stringify(details ?? null).length > 8_000) {
    throw new Error('approval.action_details_too_large');
  }
  return { kind, action, summary, ...(details === undefined ? {} : { details }) };
}

function actionDigest(runId: RunId, step: StoredStep, request: StepActionRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        runId,
        stepId: step.id,
        agentVersionId: step.agentVersionId,
        kind: request.kind ?? 'other',
        action: request.action,
        details: request.details ?? null,
      }),
    )
    .digest('hex');
}

export interface DecideSchedulerApprovalInput {
  approvalId: import('@sync-think/shared').ApprovalRequestId;
  decision: 'approved' | 'rejected';
  decidedBy: 'human' | 'delegate';
  delegateAgentVersionId?: AgentVersionId;
  decisionNote?: string;
}

export interface GateSchedulerStepActionInput {
  runId: RunId;
  stepId: StepId;
  agentVersionId: AgentVersionId;
  request: StepActionRequest;
}

export interface GateSchedulerStepActionResult {
  allowed: boolean;
  actionDigest: string;
  approval: import('@sync-think/storage').ApprovalRequestRecord | null;
  graph: RunGraph;
  ownerId: string;
  executionAttempt: number;
  signal: AbortSignal;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function addMilliseconds(instant: string, milliseconds: number): string {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) throw new Error(`scheduler.invalid_clock: ${instant}`);
  return new Date(timestamp + milliseconds).toISOString();
}

export interface SchedulerTickResult {
  graph: RunGraph;
  startedStepIds: StepId[];
  readyStepIds: StepId[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isolatedSnapshot(versions: readonly ArtifactVersion[]): readonly ArtifactVersion[] {
  return deepFreeze(structuredClone(versions));
}

function dagSteps(graph: RunGraph) {
  return graph.steps.map((step) => ({
    id: step.id,
    dependsOn: step.dependsOn,
    planOrder: step.planOrder,
  }));
}

function readyStepIds(graph: RunGraph): StepId[] {
  const steps = dagSteps(graph);
  const validation = validateDag(steps);
  if (!validation.ok) {
    throw new Error(`run.invalid_dag: ${validation.reason}:${validation.stepId}`);
  }
  return getReadyStepIds(
    steps,
    Object.fromEntries(graph.steps.map((step) => [step.id, step.state])),
  ) as StepId[];
}

export class Scheduler {
  private readonly active = new Map<string, AbortController>();
  private readonly activeExecutions = new Set<Promise<void>>();
  private readonly background = new Set<Promise<unknown>>();
  private readonly drains = new Map<RunId, Promise<SchedulerTickResult>>();
  private readonly now: () => string;
  private readonly ownerId: string;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly lifecycleController = new AbortController();
  private stopped = false;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.ownerId = options.ownerId ?? `scheduler-${ulid()}`;
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? Math.max(1, Math.floor(this.leaseDurationMs / 3));
    this.wait = options.wait ?? abortableDelay;
  }

  async tick(runId: RunId): Promise<SchedulerTickResult> {
    const initial = this.options.store.getGraph(runId);
    if (!initial) throw new Error(`Run not found: ${runId}`);
    if (this.stopped) {
      return { graph: initial, startedStepIds: [], readyStepIds: readyStepIds(initial) };
    }
    const ready = readyStepIds(initial);
    const kindByStepId = new Map(initial.steps.map((step) => [step.id, step.kind]));
    const executableReady = ready.filter((stepId) => kindByStepId.get(stepId) !== 'merge');
    const schedulable = await this.filterProtectedSteps(initial, executableReady);
    const claimedAt = this.now();
    const claimed = this.options.store.claimReadySteps({
      runId,
      stepIds: schedulable,
      ownerId: this.ownerId,
      leaseExpiresAt: addMilliseconds(claimedAt, this.leaseDurationMs),
      now: claimedAt,
    });
    const executions = claimed.claimedSteps.map((step) => {
      const execution = this.executeClaimedStep(
        runId,
        step,
        claimed.artifactVersionsByStep.get(step.id) ?? [],
      );
      this.activeExecutions.add(execution);
      void execution.then(
        () => this.activeExecutions.delete(execution),
        () => this.activeExecutions.delete(execution),
      );
      return execution;
    });
    await Promise.all(executions);

    const graph = this.options.store.getGraph(runId);
    if (!graph) throw new Error(`Run not found after tick: ${runId}`);
    return {
      graph,
      startedStepIds: claimed.claimedSteps.map((step) => step.id),
      readyStepIds: readyStepIds(graph),
    };
  }

  runUntilIdle(runId: RunId): Promise<SchedulerTickResult> {
    const existing = this.drains.get(runId);
    if (existing) return existing;
    const drain = this.drainInternal(runId);
    this.drains.set(runId, drain);
    void drain.then(
      () => {
        if (this.drains.get(runId) === drain) this.drains.delete(runId);
      },
      () => {
        if (this.drains.get(runId) === drain) this.drains.delete(runId);
      },
    );
    return drain;
  }

  drain(runId: RunId): Promise<SchedulerTickResult> {
    return this.runUntilIdle(runId);
  }

  private async drainInternal(runId: RunId): Promise<SchedulerTickResult> {
    const startedStepIds: StepId[] = [];
    while (!this.stopped) {
      const graph = this.options.store.getGraph(runId);
      if (!graph) throw new Error(`Run not found: ${runId}`);
      const ready = readyStepIds(graph);
      if (
        graph.run.state === 'completed' ||
        graph.run.state === 'failed' ||
        graph.run.state === 'cancelled' ||
        graph.run.state === 'paused' ||
        graph.run.state === 'awaitingToolApproval' ||
        graph.steps.some((step) => step.state === 'awaitingApproval') ||
        ready.length === 0
      ) {
        return { graph, startedStepIds, readyStepIds: ready };
      }

      const tick = await this.tick(runId);
      startedStepIds.push(...tick.startedStepIds);
      if (tick.startedStepIds.length === 0) {
        return { graph: tick.graph, startedStepIds, readyStepIds: tick.readyStepIds };
      }
    }

    const graph = this.options.store.getGraph(runId);
    if (!graph) throw new Error(`Run not found: ${runId}`);
    return { graph, startedStepIds, readyStepIds: readyStepIds(graph) };
  }

  recover(runId: RunId): Promise<SchedulerTickResult> {
    return this.trackBackground(this.recoverInternal(runId));
  }

  private async recoverInternal(runId: RunId): Promise<SchedulerTickResult> {
    while (!this.stopped) {
      const existing = this.options.store.getGraph(runId);
      if (!existing) throw new Error(`Run not found: ${runId}`);
      if (
        existing.run.state === 'completed' ||
        existing.run.state === 'failed' ||
        existing.run.state === 'cancelled'
      ) {
        return { graph: existing, startedStepIds: [], readyStepIds: readyStepIds(existing) };
      }

      const now = this.now();
      const recovered = this.options.store.recoverRun(runId, now);
      if (recovered.run.state === 'paused') {
        return { graph: recovered, startedStepIds: [], readyStepIds: readyStepIds(recovered) };
      }
      const result = await this.runUntilIdle(runId);
      if (result.startedStepIds.length > 0) return result;

      const leaseExpiresAt = this.options.store.getNextLeaseExpiry(runId);
      if (!leaseExpiresAt) return result;
      const delayMs = Math.max(0, Date.parse(leaseExpiresAt) - Date.parse(now));
      if (!Number.isFinite(delayMs))
        throw new Error(`scheduler.invalid_lease_expiry: ${leaseExpiresAt}`);
      try {
        await this.wait(delayMs, this.lifecycleController.signal);
      } catch {
        if (!this.stopped) throw new Error('scheduler.recovery_wait_failed');
      }
    }

    const existing = this.options.store.getGraph(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    return { graph: existing, startedStepIds: [], readyStepIds: readyStepIds(existing) };
  }

  async recoverAll(): Promise<SchedulerTickResult[]> {
    return Promise.all(
      this.options.store.listRecoverableRunIds().map((runId) => this.recover(runId)),
    );
  }

  async shutdown(): Promise<void> {
    if (this.stopped) {
      await Promise.allSettled([
        ...this.activeExecutions,
        ...this.background,
        ...this.drains.values(),
      ]);
      return;
    }
    this.stopped = true;
    this.lifecycleController.abort(new Error('scheduler.shutdown'));
    for (const controller of this.active.values())
      controller.abort(new Error('scheduler.shutdown'));
    await Promise.allSettled([
      ...this.activeExecutions,
      ...this.background,
      ...this.drains.values(),
    ]);
  }

  pause(runId: RunId): RunGraph {
    return this.options.store.pauseRun(runId, this.now());
  }

  resume(runId: RunId): RunGraph {
    return this.options.store.resumeRun(runId, this.now());
  }

  cancel(runId: RunId): RunGraph {
    const graph = this.persistCancel(runId);
    this.abortActiveRun(runId);
    return graph;
  }

  persistCancel(runId: RunId): RunGraph {
    return this.options.store.cancelRun(runId, this.now());
  }

  abortActiveRun(runId: RunId): void {
    for (const [key, controller] of this.active) {
      if (key.startsWith(`${runId}:`)) controller.abort();
    }
  }

  gateStepAction(input: GateSchedulerStepActionInput): GateSchedulerStepActionResult {
    const graph = this.options.store.getGraph(input.runId);
    const step = graph?.steps.find((candidate) => candidate.id === input.stepId);
    if (!graph || !step) throw new Error('scheduler.step_action_scope_mismatch');
    if (step.agentVersionId !== input.agentVersionId) {
      throw new Error('scheduler.step_action_agent_mismatch');
    }
    const activeKey = `${input.runId}:${input.stepId}`;
    const controller = this.active.get(activeKey);
    if (
      step.state !== 'running' ||
      step.executionOwnerId !== this.ownerId ||
      step.executionAttempt < 1 ||
      !controller ||
      controller.signal.aborted
    ) {
      throw new Error('scheduler.step_action_fence_mismatch');
    }

    const request = normalizeActionRequest(input.request);
    const digest = actionDigest(input.runId, step, request);
    const allowed = this.persistStepApproval(input.runId, step, request, {
      ownerId: this.ownerId,
      executionAttempt: step.executionAttempt,
    });
    const approval =
      this.options.approvalStore?.findLatestForStepAction(input.runId, input.stepId, digest) ??
      null;
    const updated = this.options.store.getGraph(input.runId);
    if (!updated) throw new Error(`Run not found: ${input.runId}`);
    if (!allowed) controller.abort(new Error('step.awaiting_approval'));
    return {
      allowed,
      actionDigest: digest,
      approval,
      graph: updated,
      ownerId: this.ownerId,
      executionAttempt: step.executionAttempt,
      signal: controller.signal,
    };
  }

  decideApproval(input: DecideSchedulerApprovalInput): {
    approval: import('@sync-think/storage').ApprovalRequestRecord;
    graph: RunGraph;
    replayed: boolean;
  } {
    const approvalStore = this.options.approvalStore;
    const unitOfWork = this.options.unitOfWork;
    if (!approvalStore || !unitOfWork) {
      throw new Error('scheduler.approval_store_unavailable');
    }
    return unitOfWork.run(() => {
      const existing = approvalStore.get(input.approvalId);
      if (!existing) throw new Error('approval.not_found');
      const metadata = existing.metadata;
      if (
        metadata.source !== 'scheduler.step-action' ||
        typeof existing.runId !== 'string' ||
        typeof existing.stepId !== 'string' ||
        metadata.runId !== existing.runId ||
        metadata.stepId !== existing.stepId ||
        typeof metadata.actionDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(metadata.actionDigest) ||
        typeof metadata.agentVersionId !== 'string'
      ) {
        throw new Error('approval.step_binding_invalid');
      }
      if (input.decidedBy === 'delegate') {
        if (existing.humanOnly) {
          throw new Error('approval.human_only_requires_human');
        }
        if (existing.gate !== 'require-delegate') {
          throw new Error('approval.delegate_not_permitted');
        }
        if (
          typeof metadata.delegateAgentVersionId !== 'string' ||
          !input.delegateAgentVersionId ||
          input.delegateAgentVersionId !== metadata.delegateAgentVersionId ||
          this.options.approvalPolicy?.validateDelegateAgentVersion?.(
            input.delegateAgentVersionId,
          ) !== true
        ) {
          throw new Error('approval.delegate_agent_version_invalid');
        }
      }
      if (existing.state !== 'pending') {
        if (existing.state === input.decision && existing.decidedBy === input.decidedBy) {
          const graph = this.options.store.getGraph(existing.runId);
          if (!graph) throw new Error(`Run not found: ${existing.runId}`);
          return { approval: existing, graph, replayed: true };
        }
        throw new Error('approval.already_decided');
      }
      if (existing.gate === 'deny' && input.decision === 'approved') {
        throw new Error('approval.policy_denied');
      }

      const approval = approvalStore.decide({
        id: input.approvalId,
        decision: input.decision,
        decidedBy: input.decidedBy,
        decisionNote: input.decisionNote,
        now: this.now(),
      });
      const graph = this.options.store.resolveStepApproval({
        runId: existing.runId,
        stepId: existing.stepId,
        approvalId: existing.id,
        actionDigest: metadata.actionDigest,
        decision: input.decision,
        decidedBy: input.decidedBy,
        delegateAgentVersionId: input.delegateAgentVersionId,
        now: this.now(),
      });
      return { approval, graph, replayed: false };
    });
  }

  private async filterProtectedSteps(
    graph: RunGraph,
    readyIds: readonly StepId[],
  ): Promise<StepId[]> {
    if (!this.options.executor.getActionRequest) return [...readyIds];
    const schedulable: StepId[] = [];
    const byId = new Map(graph.steps.map((step) => [step.id, step]));
    for (const stepId of readyIds) {
      const step = byId.get(stepId);
      if (!step) throw new Error(`Step not found: ${graph.run.id}/${stepId}`);
      const request = await this.options.executor.getActionRequest({
        runId: graph.run.id,
        step: deepFreeze(structuredClone(step)),
      });
      if (!request) {
        schedulable.push(stepId);
        continue;
      }
      if (this.persistStepApproval(graph.run.id, step, request)) {
        schedulable.push(stepId);
      }
    }
    return schedulable;
  }

  private persistStepApproval(
    runId: RunId,
    step: StoredStep,
    rawRequest: StepActionRequest,
    runningFence?: { ownerId: string; executionAttempt: number },
  ): boolean {
    const approvalStore = this.options.approvalStore;
    const unitOfWork = this.options.unitOfWork;
    const approvalPolicy = this.options.approvalPolicy;
    if (!approvalStore || !unitOfWork || !approvalPolicy) {
      throw new Error('scheduler.approval_configuration_required');
    }
    const request = normalizeActionRequest(rawRequest);
    const digest = actionDigest(runId, step, request);
    const policyEvaluation = approvalPolicy.evaluate({
      runId,
      step: deepFreeze(structuredClone(step)),
      request: deepFreeze(structuredClone(request)),
      actionDigest: digest,
    });
    const evaluation = policyEvaluation;
    if (evaluation.gate === 'auto-approve') return true;

    return unitOfWork.run(() => {
      const current = this.options.store.getGraph(runId);
      const currentStep = current?.steps.find((candidate) => candidate.id === step.id);
      if (!current || !currentStep) throw new Error(`Step not found: ${runId}/${step.id}`);
      const candidate = approvalStore.findLatestForStepAction(runId, step.id, digest);
      const existing =
        candidate?.metadata.source === 'scheduler.step-action' &&
        candidate.metadata.runId === runId &&
        candidate.metadata.stepId === step.id &&
        candidate.metadata.agentVersionId === step.agentVersionId
          ? candidate
          : null;
      if (existing?.state === 'approved') return true;
      if (existing?.state === 'rejected') return false;
      if (existing?.state === 'pending') {
        if (currentStep.state !== 'awaitingApproval') {
          this.options.store.awaitStepApproval({
            runId,
            stepId: step.id,
            approvalId: existing.id,
            actionDigest: digest,
            ownerId: runningFence?.ownerId,
            executionAttempt: runningFence?.executionAttempt,
            now: this.now(),
          });
        }
        return false;
      }
      if (
        currentStep.state !== 'pending' &&
        currentStep.state !== 'ready' &&
        currentStep.state !== 'running'
      ) {
        return false;
      }
      const approval = approvalStore.enqueue({
        workspaceId: evaluation.workspaceId,
        taskId: evaluation.taskId,
        runId,
        stepId: step.id,
        kind: request.kind,
        action: request.action,
        summary: request.summary,
        humanOnly: evaluation.humanOnly,
        humanOnlyAction: evaluation.humanOnlyAction,
        mode: evaluation.mode,
        gate: evaluation.gate,
        metadata: {
          source: 'scheduler.step-action',
          runId,
          stepId: step.id,
          agentVersionId: step.agentVersionId,
          actionDigest: digest,
          actionDetails: request.details ?? null,
          policyReason: evaluation.reason,
          ...(evaluation.delegateAgentVersionId
            ? { delegateAgentVersionId: evaluation.delegateAgentVersionId }
            : {}),
        },
        now: this.now(),
      });
      this.options.store.awaitStepApproval({
        runId,
        stepId: step.id,
        approvalId: approval.id,
        actionDigest: digest,
        ownerId: runningFence?.ownerId,
        executionAttempt: runningFence?.executionAttempt,
        now: this.now(),
      });
      return false;
    });
  }

  private async executeClaimedStep(
    runId: RunId,
    step: StoredStep,
    artifactVersions: readonly ArtifactVersion[],
  ): Promise<void> {
    const idempotencyKey = step.idempotencyKey;
    if (!idempotencyKey) throw new Error(`Claimed Step is missing idempotency key: ${step.id}`);
    const activeKey = `${runId}:${step.id}`;
    const controller = new AbortController();
    this.active.set(activeKey, controller);
    const heartbeatController = new AbortController();
    let heartbeat: Promise<void> | undefined;

    try {
      heartbeat = this.maintainLease(runId, step, controller, heartbeatController.signal);
      const heartbeatFailure = heartbeat.then<never>(
        () => new Promise<never>(() => undefined),
        (error: unknown) => {
          throw error;
        },
      );
      const persistedReviewContext = this.options.store.getReviewStepContext(runId, step.id);
      const executionArtifactVersions =
        persistedReviewContext?.kind === 'reviewer'
          ? persistedReviewContext.reviewedArtifactVersions
          : artifactVersions;
      const context: StepExecutionContext = {
        runId,
        step: deepFreeze(structuredClone(step)),
        idempotencyKey,
        artifactVersions: isolatedSnapshot(executionArtifactVersions),
        ...(persistedReviewContext
          ? { reviewContext: deepFreeze(structuredClone(persistedReviewContext)) }
          : {}),
        signal: controller.signal,
        gateAction: async (request) => {
          const result = this.gateStepAction({
            runId,
            stepId: step.id,
            agentVersionId: step.agentVersionId,
            request,
          });
          return { allowed: result.allowed, actionDigest: result.actionDigest };
        },
      };
      const result = await Promise.race([this.options.executor.execute(context), heartbeatFailure]);
      if (controller.signal.reason instanceof StepLeaseHeartbeatError) {
        throw controller.signal.reason;
      }
      if (this.stopped && controller.signal.aborted) return;
      const current = this.options.store.getGraph(runId);
      const currentStep = current?.steps.find((entry) => entry.id === step.id);
      if (
        currentStep?.state !== 'running' ||
        currentStep.executionOwnerId !== this.ownerId ||
        currentStep.executionAttempt !== step.executionAttempt
      )
        return;
      if (context.reviewContext?.kind === 'reviewer') {
        if (!result.reviewOutcome) {
          throw new StepExecutionError(
            'Reviewer Step returned no structured review outcome',
            'acceptance',
          );
        }
        if ((result.outputVersions?.length ?? 0) > 0) {
          throw new StepExecutionError(
            'Reviewer Step cannot persist ordinary output artifacts',
            'protocol',
          );
        }
        const completed = this.options.store.completeReviewStep({
          runId,
          stepId: step.id,
          idempotencyKey,
          ownerId: this.ownerId,
          executionAttempt: step.executionAttempt,
          reviewerAgentVersionId: step.agentVersionId,
          outcome: structuredClone(result.reviewOutcome),
          now: this.now(),
        });
        if (completed.graph.run.state === 'failed') this.abortActiveRun(runId);
      } else {
        if (result.reviewOutcome) {
          throw new StepExecutionError(
            'Only a persisted reviewer Step may return a review outcome',
            'protocol',
          );
        }
        this.options.store.completeStep({
          runId,
          stepId: step.id,
          idempotencyKey,
          ownerId: this.ownerId,
          executionAttempt: step.executionAttempt,
          outputVersions: result.outputVersions,
          now: this.now(),
        });
      }
    } catch (error) {
      if (error instanceof StepLeaseHeartbeatError) controller.abort(error);
      if (error instanceof StepAwaitingApprovalError) {
        const mayExecute = this.persistStepApproval(runId, step, error.request, {
          ownerId: this.ownerId,
          executionAttempt: step.executionAttempt,
        });
        if (!mayExecute) return;
        error = new StepExecutionError(
          'Executor requested approval for an auto-approved action',
          'protocol',
        );
      }
      if (isStepFenceMismatchError(error)) return;
      const current = this.options.store.getGraph(runId);
      const currentStep = current?.steps.find((entry) => entry.id === step.id);
      if (current?.run.state === 'cancelled' || currentStep?.state === 'cancelled') return;
      if (this.stopped && controller.signal.aborted) return;
      const failure = this.classifyFailure(error);
      try {
        this.options.store.failStep({
          runId,
          stepId: step.id,
          idempotencyKey,
          ownerId: this.ownerId,
          executionAttempt: step.executionAttempt,
          failureClass: failure.failureClass,
          failureCode: failure.code,
          summary: failure.message,
          partialOutputVersions: failure.partialOutputVersions,
          now: this.now(),
        });
      } catch (failureError) {
        if (isStepFenceMismatchError(failureError)) return;
        throw failureError;
      }
    } finally {
      heartbeatController.abort();
      try {
        if (heartbeat) {
          try {
            await heartbeat;
          } catch {
            // The execution race handles heartbeat failures through the normal failure path.
          }
        }
      } finally {
        if (this.active.get(activeKey) === controller) this.active.delete(activeKey);
      }
    }
  }

  private async maintainLease(
    runId: RunId,
    step: StoredStep,
    executionController: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.wait(this.heartbeatIntervalMs, signal);
      } catch {
        return;
      }
      if (signal.aborted) return;
      let refreshed: boolean;
      try {
        const now = this.now();
        refreshed = this.options.store.refreshStepLease({
          runId,
          stepId: step.id,
          ownerId: this.ownerId,
          executionAttempt: step.executionAttempt,
          leaseExpiresAt: addMilliseconds(now, this.leaseDurationMs),
          now,
        });
      } catch {
        throw new StepLeaseHeartbeatError();
      }
      if (!refreshed) {
        const failure = new StepLeaseHeartbeatError();
        executionController.abort(failure);
        throw failure;
      }
    }
  }

  private classifyFailure(error: unknown) {
    if (isOrchestrationDomainError(error)) {
      return {
        failureClass: error.failureClass,
        code: error.code,
        message: scrubDiagnosticText(error.message, 240),
        partialOutputVersions: [],
      };
    }
    const requestedClass = error instanceof StepExecutionError ? error.failureClass : 'unknown';
    const failureClass = FAILURE_CLASSES.has(requestedClass)
      ? requestedClass
      : ('unknown' satisfies FailureClass);
    const message = error instanceof Error ? error.message : 'Step executor failed';
    return new StepExecutionError(
      scrubDiagnosticText(message, 240),
      failureClass,
      error instanceof StepExecutionError ? error.partialOutputVersions : [],
    );
  }

  private trackBackground<T>(promise: Promise<T>): Promise<T> {
    this.background.add(promise);
    void promise.then(
      () => this.background.delete(promise),
      () => this.background.delete(promise),
    );
    return promise;
  }
}
