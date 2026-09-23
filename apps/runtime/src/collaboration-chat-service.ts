import { createHash, randomUUID } from 'node:crypto';
import { validateDag } from '@sync-think/core';
import {
  DEFAULT_COLLABORATION_CHAT_POLICY,
  type CollaborationAttempt,
  type CollaborationCommand,
  type CollaborationError,
  type CollaborationMember,
  type CollaborationMessage,
  type CollaborationMessageContextRef,
  type CollaborationPolicy,
  type CollaborationRepository,
  type CollaborationResourceClaim,
  type CollaborationSnapshot,
  type CollaborationTask,
  type CollaborationTaskDraft,
} from '@sync-think/shared';

type Command<Action extends CollaborationCommand['action']> = Extract<
  CollaborationCommand,
  { action: Action }
>;

export interface CollaborationExecutionResult {
  output: string;
  runId?: string;
  threadId?: string;
  error?: CollaborationError;
}

export interface CollaborationProgress {
  runId?: string;
  threadId?: string;
  output?: string;
  status?: 'running' | 'waiting_input';
  tools?: CollaborationAttempt['tools'];
  checklist?: CollaborationAttempt['checklist'];
}

export interface CollaborationExecutionInput {
  snapshot: CollaborationSnapshot;
  task: CollaborationTask;
  attempt: CollaborationAttempt;
  signal: AbortSignal;
  onProgress(progress: CollaborationProgress): void;
}

export interface CollaborationChatPorts {
  ownerId: string;
  execute(input: CollaborationExecutionInput): Promise<CollaborationExecutionResult>;
  /** Compute trusted, canonical claims; client-supplied claims are suggestions only. */
  resourceClaims(snapshot: CollaborationSnapshot, task: CollaborationTask): CollaborationResourceClaim[];
  /** Freeze the host-authorized agent configuration at admission, including on retry. */
  agentSnapshot?(snapshot: CollaborationSnapshot, task: CollaborationTask): Record<string, unknown>;
  onChanged(snapshot: CollaborationSnapshot): void;
  probeStatus?(input: {
    snapshot: CollaborationSnapshot;
    task: CollaborationTask;
    attempt: CollaborationAttempt;
  }): Promise<{
    status: 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'interrupted';
    output?: string;
    error?: CollaborationError;
  }>;
  onError?(error: unknown): void;
  now?(): string;
  id?(): string;
}

interface ActiveExecution {
  conversationId: string;
  workspaceId: string;
  task: CollaborationTask;
  attempt: CollaborationAttempt;
  controller: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  statusTimer?: ReturnType<typeof setTimeout>;
  probing: boolean;
  done: Promise<void>;
  stopReason?: 'cancel' | 'timeout' | 'shutdown';
}

export interface CollaborationLinkedContext {
  ref: CollaborationMessageContextRef;
  message: CollaborationMessage;
}

const ACTIVE = new Set<CollaborationAttempt['status']>(['running', 'waiting_input', 'stopping']);
const TERMINAL = new Set<CollaborationAttempt['status']>([
  'succeeded', 'failed', 'cancelled', 'interrupted',
]);

function copy<T>(value: T): T {
  return structuredClone(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function currentAttempt(snapshot: CollaborationSnapshot, task: CollaborationTask): CollaborationAttempt {
  const attempt = snapshot.attempts.find((item) => item.id === task.currentAttemptId);
  if (!attempt) throw new Error('collaboration.attempt_missing');
  return attempt;
}

/** Claims use host-defined keys. A workspace-wide '*' conflicts with every key. */
export function collaborationClaimsConflict(
  left: readonly CollaborationResourceClaim[],
  right: readonly CollaborationResourceClaim[],
): boolean {
  return left.some((a) => right.some((b) =>
    (a.key === b.key || a.key === '*' || b.key === '*') &&
    (a.mode === 'write' || b.mode === 'write'),
  ));
}

/** Owns durable collaboration admission and scheduling; the host owns authority and execution. */
export class CollaborationChatService {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly scheduledWorkspaces = new Set<string>();
  private stopped = false;
  private pumping = false;

  constructor(
    private readonly repository: CollaborationRepository,
    private readonly ports: CollaborationChatPorts,
  ) {
    if (!ports.ownerId.trim()) throw new Error('collaboration.owner_required');
  }

  send(
    command: Command<'send'>,
    senderMemberId?: string,
    linkedContext?: CollaborationLinkedContext,
  ): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const sender = this.sender(draft, senderMemberId);
      const request = { ...command, senderMemberId: sender.id, contextRef: linkedContext?.ref };
      if (this.duplicate(draft, 'send', command.clientRequestId, request)) return false;
      const text = command.text.trim();
      if (!text) throw new Error('collaboration.empty_message');
      const reply = command.replyToMessageId
        ? this.message(draft, command.replyToMessageId)
        : undefined;
      const causation = reply ?? linkedContext?.message;
      if (sender.kind !== 'user' && !causation) throw new Error('collaboration.automatic_causation_required');
      const recipients = this.recipients(draft, sender, command.recipientMemberIds);
      const message = this.appendMessage(draft, {
        senderMemberId: sender.id,
        recipientMemberIds: recipients.map((member) => member.id),
        mentions: (command.recipientMemberIds?.length ? recipients : []).map((member) => ({
          memberId: member.id, label: member.name,
        })),
        kind: 'chat',
        blocks: [{ type: 'text', text }],
        replyToMessageId: reply?.id,
        ...(linkedContext ? { contextRefs: [linkedContext.ref] } : {}),
        expectsResponse: command.expectsResponse ?? true,
        correlationId: causation?.correlationId ?? this.id(),
        causationId: causation?.id,
        hopCount: causation ? causation.hopCount + 1 : 0,
      });
      const automatic = sender.kind !== 'user';
      if (automatic) this.enforceLoopBudget(draft, message);
      let rootTaskId: string | undefined;
      for (const recipient of recipients) {
        if (!message.expectsResponse || recipient.kind === 'user') {
          this.addDelivery(draft, message, recipient.id, 'processed');
          continue;
        }
        const task = this.addTask(draft, message, {
          assigneeMemberId: recipient.id,
          title: text.slice(0, 100),
          instructions: text,
        }, 'reply', rootTaskId);
        rootTaskId ??= task.id;
      }
      this.receipt(draft, 'send', command.clientRequestId, request, message.id);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  dispatch(command: Command<'dispatch'>, senderMemberId?: string): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const sender = this.sender(draft, senderMemberId);
      const request = { ...command, senderMemberId: sender.id };
      if (this.duplicate(draft, 'dispatch', command.clientRequestId, request)) return false;
      if (!command.tasks.length) throw new Error('collaboration.tasks_required');
      const parent = command.parentTaskId ? this.task(draft, command.parentTaskId) : undefined;
      const origin = command.originMessageId
        ? this.message(draft, command.originMessageId)
        : parent ? this.message(draft, parent.originMessageId) : undefined;
      if (sender.kind !== 'user' && !origin) throw new Error('collaboration.automatic_causation_required');
      if (parent && sender.kind !== 'user' && sender.id !== parent.assigneeMemberId &&
        sender.id !== draft.conversation.coordinatorMemberId) {
        throw new Error('collaboration.parent_task_forbidden');
      }
      const ids = command.tasks.map(() => this.id());
      const keys = new Map<string, string>();
      command.tasks.forEach((task, index) => {
        if (!task.key) return;
        if (keys.has(task.key) || draft.tasks.some((existing) => existing.id === task.key)) {
          throw new Error('collaboration.duplicate_task_key');
        }
        keys.set(task.key, ids[index]!);
      });
      const rootTaskId = parent?.rootTaskId ?? ids[0]!;
      const correlationId = origin?.correlationId ?? this.id();
      for (let index = 0; index < command.tasks.length; index += 1) {
        const input = command.tasks[index]!;
        const [recipient] = this.recipients(draft, sender, [input.assigneeMemberId]);
        if (!recipient || recipient.kind === 'user') throw new Error('collaboration.agent_required');
        const message = this.appendMessage(draft, {
          senderMemberId: sender.id,
          recipientMemberIds: [recipient.id],
          mentions: [{ memberId: recipient.id, label: recipient.name }],
          kind: 'task_assignment',
          blocks: [{ type: 'text', text: input.instructions }],
          replyToMessageId: origin?.id,
          expectsResponse: true,
          correlationId,
          causationId: origin?.id,
          hopCount: origin ? origin.hopCount + 1 : 0,
        });
        if (sender.kind !== 'user') this.enforceLoopBudget(draft, message);
        this.addTask(draft, message, {
          ...input,
          dependsOnTaskIds: (input.dependsOnTaskIds ?? []).map((id) => keys.get(id) ?? id),
        }, 'task', rootTaskId, parent?.id, ids[index], origin?.id);
      }
      const graph = validateDag(draft.tasks.map((task, index) => ({
        id: task.id, dependsOn: task.dependsOnTaskIds, planOrder: index,
      })));
      if (!graph.ok) throw new Error(`collaboration.invalid_dependencies:${graph.reason}`);
      this.receipt(draft, 'dispatch', command.clientRequestId, request, rootTaskId);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  cancel(command: Command<'cancel'>): CollaborationSnapshot {
    const abort: string[] = [];
    const snapshot = this.mutate(command.conversationId, (draft) => {
      this.task(draft, command.taskId);
      const selected = new Set([command.taskId]);
      if (command.includeChildren) {
        let size: number;
        do {
          size = selected.size;
          for (const task of draft.tasks) {
            if (task.parentTaskId && selected.has(task.parentTaskId)) selected.add(task.id);
          }
        } while (size !== selected.size);
      }
      let changed = false;
      for (const task of draft.tasks.filter((item) => selected.has(item.id))) {
        const attempt = currentAttempt(draft, task);
        if (TERMINAL.has(attempt.status) || attempt.status === 'stopping') continue;
        changed = true;
        attempt.updatedAt = this.now();
        if (ACTIVE.has(attempt.status)) {
          attempt.status = 'stopping';
          abort.push(attempt.id);
        } else {
          attempt.status = 'cancelled';
          attempt.finishedAt = this.now();
          this.completeDeliveries(draft, attempt);
          this.deliverResult(draft, task, attempt);
        }
      }
      if (changed) this.queueSummaries(draft);
      return changed;
    });
    for (const id of abort) this.abort(id, 'cancel');
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  retry(command: Command<'retry'>): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      if (this.duplicate(draft, 'retry', command.clientRequestId, command)) return false;
      const task = this.task(draft, command.taskId);
      const previous = currentAttempt(draft, task);
      if (!['failed', 'cancelled', 'interrupted'].includes(previous.status)) {
        throw new Error('collaboration.retry_requires_failed_attempt');
      }
      const member = this.member(draft, task.assigneeMemberId);
      if (!member.active) throw new Error('collaboration.member_inactive');
      const attempt = this.newAttempt(draft, task, previous.number + 1);
      task.currentAttemptId = attempt.id;
      draft.attempts.push(attempt);
      const origin = this.message(draft, task.originMessageId);
      const delivery = draft.deliveries.find((item) =>
        item.messageId === origin.id && item.recipientMemberId === task.assigneeMemberId,
      );
      if (delivery) {
        delivery.status = 'queued';
        delivery.attemptId = attempt.id;
        delete delivery.error;
      } else {
        this.addDelivery(draft, origin, task.assigneeMemberId, 'queued', attempt.id);
      }
      this.receipt(draft, 'retry', command.clientRequestId, command, attempt.id);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  retryMessage(command: Command<'retry-message'>): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      if (this.duplicate(draft, 'retry-message', command.clientRequestId, command)) return false;
      const message = this.message(draft, command.messageId);
      const deliveries = draft.deliveries.filter((delivery) =>
        delivery.messageId === message.id && ['failed', 'cancelled'].includes(delivery.status),
      );
      if (deliveries.length === 0) throw new Error('collaboration.retry_requires_failed_delivery');
      for (const delivery of deliveries) {
        const previous = draft.attempts.find((attempt) => attempt.id === delivery.attemptId);
        const task = previous
          ? draft.tasks.find((candidate) => candidate.id === previous.taskId)
          : undefined;
        if (!previous || !task || task.currentAttemptId !== previous.id || !TERMINAL.has(previous.status)) {
          throw new Error('collaboration.delivery_attempt_missing');
        }
        if (previous.error?.retryable === false) {
          throw new Error('collaboration.delivery_not_retryable');
        }
        const member = this.member(draft, task.assigneeMemberId);
        if (!member.active) throw new Error('collaboration.member_inactive');
        const attempt = this.newAttempt(draft, task, previous.number + 1);
        task.currentAttemptId = attempt.id;
        draft.attempts.push(attempt);
        delivery.status = 'queued';
        delivery.attemptId = attempt.id;
        delete delivery.error;
      }
      this.receipt(
        draft,
        'retry-message',
        command.clientRequestId,
        command,
        deliveries.map((delivery) => delivery.id).join(','),
      );
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  updatePolicy(command: Command<'policy'>): CollaborationSnapshot {
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const policy = { ...draft.conversation.policy, ...command.policy };
      this.validatePolicy(policy);
      if (JSON.stringify(policy) === JSON.stringify(draft.conversation.policy)) return false;
      draft.conversation.policy = policy;
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  /** Revoke work that has not started when a parent group disables peer DMs. */
  revokeQueuedPeerDirectWork(conversationId: string): CollaborationSnapshot {
    return this.mutate(conversationId, (draft) => {
      if (!draft.conversation.parentConversationId) {
        throw new Error('collaboration.peer_direct_required');
      }
      let changed = false;
      for (const attempt of draft.attempts) {
        if (attempt.status !== 'queued') continue;
        changed = true;
        attempt.status = 'cancelled';
        attempt.finishedAt = this.now();
        attempt.updatedAt = this.now();
        attempt.error = this.error(
          'peer_direct_disabled',
          'permission',
          '群内智能体单聊已关闭，尚未开始的投递已撤销。',
          false,
        );
      }
      for (const delivery of draft.deliveries) {
        if (delivery.status !== 'queued') continue;
        changed = true;
        delivery.status = 'cancelled';
        delivery.error = '群内智能体单聊已关闭';
      }
      return changed;
    });
  }

  /** Claim before invoking executors; returns after starting ready tasks, not after completion. */
  async pump(workspaceId?: string): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      for (const snapshot of this.repository.list(workspaceId)) {
        for (const task of snapshot.tasks) {
          if (this.stopped) return;
          const claimed = this.claim(snapshot.conversation.id, task.id);
          if (claimed) this.start(claimed.snapshot, claimed.task, claimed.attempt);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  acceptProgress(
    conversationId: string,
    taskId: string,
    attemptId: string,
    progress: CollaborationProgress,
  ): CollaborationSnapshot {
    const snapshot = this.mutate(conversationId, (draft) => {
      const task = this.task(draft, taskId);
      const attempt = currentAttempt(draft, task);
      if (attempt.id !== attemptId || !ACTIVE.has(attempt.status) || attempt.status === 'stopping') return false;
      if (attempt.ownerId !== this.ports.ownerId) return false;
      if (progress.runId) attempt.runId = progress.runId;
      if (progress.threadId) attempt.threadId = progress.threadId;
      if (progress.output !== undefined) attempt.output = progress.output;
      if (progress.tools) attempt.tools = copy(progress.tools);
      if (progress.checklist) attempt.checklist = copy(progress.checklist);
      if (progress.status) attempt.status = progress.status;
      attempt.heartbeatAt = this.now();
      attempt.updatedAt = this.now();
      attempt.observation = 'normal';
      if (attempt.error?.category === 'delivery') delete attempt.error;
      return true;
    });
    const execution = this.active.get(attemptId);
    if (execution && currentAttempt(snapshot, this.task(snapshot, taskId)).status !== 'stopping') {
      this.scheduleStatusObservation(execution);
    }
    return snapshot;
  }

  /** Startup recovery never replays an execution that may already have written external state. */
  recover(): CollaborationSnapshot[] {
    const recovered: CollaborationSnapshot[] = [];
    for (const snapshot of this.repository.list()) {
      const next = this.mutate(snapshot.conversation.id, (draft) => {
        let changed = false;
        for (const task of draft.tasks) {
          const attempt = currentAttempt(draft, task);
          if (!ACTIVE.has(attempt.status) || this.active.has(attempt.id)) continue;
          attempt.status = 'interrupted';
          attempt.updatedAt = this.now();
          attempt.finishedAt = this.now();
          attempt.error = this.error('owner_lost', 'recovery', '执行进程已退出；请检查已有结果后重试。', true);
          this.completeDeliveries(draft, attempt);
          this.deliverResult(draft, task, attempt);
          changed = true;
        }
        if (changed) this.queueSummaries(draft);
        return changed;
      });
      if (next.revision !== snapshot.revision) recovered.push(next);
    }
    return recovered;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const executions = [...this.active.values()];
    for (const execution of executions) {
      this.requestStop(execution, 'shutdown');
    }
    await Promise.allSettled(executions.map((execution) => execution.done));
  }

  private claim(conversationId: string, taskId: string): {
    snapshot: CollaborationSnapshot; task: CollaborationTask; attempt: CollaborationAttempt;
  } | undefined {
    let attemptId: string | undefined;
    const snapshot = this.mutate(conversationId, (draft) => {
      const task = this.task(draft, taskId);
      const attempt = currentAttempt(draft, task);
      if (attempt.status !== 'queued') return false;
      const member = this.member(draft, task.assigneeMemberId);
      const dependencies = task.dependsOnTaskIds.map((id) => currentAttempt(draft, this.task(draft, id)));
      let waitReason: CollaborationAttempt['waitReason'];
      if (!member.active) waitReason = 'member_removed';
      else if (dependencies.some((dependency) => TERMINAL.has(dependency.status) && dependency.status !== 'succeeded')) {
        waitReason = 'dependency_failed';
      } else if (dependencies.some((dependency) => dependency.status !== 'succeeded')) waitReason = 'dependency';
      const running = this.runningInWorkspace(draft.conversation.workspaceId);
      const limit = Math.min(3, draft.conversation.policy.maxConcurrent);
      if (!waitReason && running.length >= limit) waitReason = 'capacity';
      if (!waitReason && task.kind !== 'task' && running.some((entry) =>
        entry.conversationId === conversationId && entry.task.assigneeMemberId === task.assigneeMemberId &&
        entry.task.kind !== 'task',
      )) waitReason = 'resource_busy';
      const claims = this.validClaims(this.ports.resourceClaims(copy(draft), copy(task)));
      if (!waitReason && running.some((entry) => collaborationClaimsConflict(claims, entry.attempt.resourceClaims))) {
        waitReason = 'resource_busy';
      }
      if (waitReason) {
        if (attempt.waitReason === waitReason) return false;
        attempt.waitReason = waitReason;
        attempt.updatedAt = this.now();
        return true;
      }
      delete attempt.waitReason;
      attempt.status = 'running';
      attempt.ownerId = this.ports.ownerId;
      attempt.startedAt = this.now();
      attempt.heartbeatAt = this.now();
      attempt.updatedAt = this.now();
      attempt.contextSequence = draft.messages.at(-1)?.sequence ?? 0;
      attempt.resourceClaims = claims;
      attempt.observation = 'normal';
      task.resourceClaims = claims;
      for (const delivery of draft.deliveries) {
        if (delivery.attemptId === attempt.id && delivery.status === 'queued') delivery.status = 'processing';
      }
      attemptId = attempt.id;
      return true;
    });
    if (!attemptId) return;
    return { snapshot, task: this.task(snapshot, taskId), attempt: snapshot.attempts.find((item) => item.id === attemptId)! };
  }

  private start(snapshot: CollaborationSnapshot, task: CollaborationTask, attempt: CollaborationAttempt): void {
    const controller = new AbortController();
    const execution: ActiveExecution = {
      conversationId: snapshot.conversation.id, workspaceId: snapshot.conversation.workspaceId,
      task: copy(task), attempt: copy(attempt), controller, probing: false, done: Promise.resolve(),
    };
    this.active.set(attempt.id, execution);
    execution.deadline = setTimeout(() => this.requestStop(execution, 'timeout'), task.timeoutSeconds * 1000);
    execution.deadline.unref?.();
    this.scheduleStatusObservation(execution);
    execution.done = Promise.resolve()
      .then(() => this.ports.execute({
        snapshot: copy(snapshot), task: copy(task), attempt: copy(attempt), signal: controller.signal,
        onProgress: (progress) => this.acceptProgress(snapshot.conversation.id, task.id, attempt.id, progress),
      }))
      .then((result) => this.finishExecution(execution, result), (error: unknown) => this.finishExecution(execution, {
        output: '', error: this.error('execution_failed', 'execution', error instanceof Error ? error.message : String(error), true),
      }))
      .catch((error: unknown) => this.reportError(error))
      .finally(() => {
        clearTimeout(execution.deadline);
        clearTimeout(execution.statusTimer);
        this.active.delete(attempt.id);
        this.schedulePump(execution.workspaceId);
      });
  }

  private finishExecution(execution: ActiveExecution, result: CollaborationExecutionResult): void {
    this.mutate(execution.conversationId, (draft) => {
      const task = this.task(draft, execution.task.id);
      const attempt = currentAttempt(draft, task);
      if (attempt.id !== execution.attempt.id || TERMINAL.has(attempt.status)) return false;
      if (attempt.ownerId !== this.ports.ownerId) return false;
      if (result.output) attempt.output = result.output;
      if (result.runId) attempt.runId = result.runId;
      if (result.threadId) attempt.threadId = result.threadId;
      if (execution.stopReason === 'timeout') {
        attempt.status = 'failed';
        attempt.error = this.error('task_timeout', 'timeout', '任务已超过执行时限。', true);
      } else if (execution.stopReason === 'shutdown') {
        attempt.status = 'interrupted';
        attempt.error = this.error('runtime_stopped', 'recovery', '执行进程已停止。', true);
      } else if (execution.stopReason === 'cancel' || attempt.status === 'stopping') {
        attempt.status = 'cancelled';
        delete attempt.error;
      } else if (result.error) {
        attempt.status = 'failed';
        attempt.error = result.error;
      } else {
        attempt.status = 'succeeded';
        delete attempt.error;
      }
      attempt.updatedAt = this.now();
      attempt.finishedAt = this.now();
      this.completeDeliveries(draft, attempt);
      this.deliverResult(draft, task, attempt);
      this.queueSummaries(draft);
      return true;
    });
  }

  private requestStop(execution: ActiveExecution, reason: 'timeout' | 'shutdown'): void {
    if (execution.stopReason) return;
    this.mutate(execution.conversationId, (draft) => {
      const task = this.task(draft, execution.task.id);
      const attempt = currentAttempt(draft, task);
      if (attempt.id !== execution.attempt.id || TERMINAL.has(attempt.status)) return false;
      attempt.status = 'stopping';
      attempt.updatedAt = this.now();
      if (reason === 'timeout') attempt.error = this.error('task_timeout', 'timeout', '正在停止超时任务。', true);
      return true;
    });
    this.abort(execution.attempt.id, reason);
  }

  private abort(attemptId: string, reason: ActiveExecution['stopReason']): void {
    const execution = this.active.get(attemptId);
    if (!execution || execution.stopReason) return;
    execution.stopReason = reason;
    clearTimeout(execution.deadline);
    clearTimeout(execution.statusTimer);
    execution.controller.abort();
  }

  private scheduleStatusObservation(execution: ActiveExecution): void {
    clearTimeout(execution.statusTimer);
    if (execution.stopReason || this.stopped) return;
    const snapshot = this.repository.read(execution.conversationId);
    if (!snapshot) return;
    const delay = snapshot.conversation.policy.statusTimeoutSeconds * 1000;
    execution.statusTimer = setTimeout(() => { void this.observeStatus(execution); }, delay);
    execution.statusTimer.unref?.();
  }

  private async observeStatus(execution: ActiveExecution): Promise<void> {
    if (execution.stopReason || execution.probing || !this.active.has(execution.attempt.id)) return;
    execution.probing = true;
    try {
      const snapshot = this.repository.read(execution.conversationId);
      if (!snapshot) return;
      const task = this.task(snapshot, execution.task.id);
      const attempt = currentAttempt(snapshot, task);
      if (attempt.id !== execution.attempt.id || !ACTIVE.has(attempt.status)) return;
      const observedHeartbeat = attempt.heartbeatAt;
      let observation: CollaborationAttempt['observation'] = 'status_unconfirmed';
      let deliveryError: CollaborationError | undefined;
      let output: string | undefined;
      if (this.ports.probeStatus) {
        try {
          const result = await this.ports.probeStatus({ snapshot, task, attempt });
          observation = result.status === 'running' || result.status === 'waiting_input'
            ? 'normal' : 'notification_delayed';
          output = result.output;
          deliveryError = result.error;
        } catch (error) {
          deliveryError = this.error('status_delivery_failed', 'delivery', error instanceof Error ? error.message : String(error), true);
        }
      }
      this.mutate(execution.conversationId, (draft) => {
        const latest = currentAttempt(draft, this.task(draft, task.id));
        if (latest.id !== attempt.id || !ACTIVE.has(latest.status) || latest.status === 'stopping' ||
          latest.heartbeatAt !== observedHeartbeat) return false;
        latest.observation = observation;
        latest.updatedAt = this.now();
        if (output !== undefined) latest.output = output;
        if (deliveryError) latest.error = deliveryError;
        return true;
      });
    } catch (error) {
      this.reportError(error);
    } finally {
      execution.probing = false;
      if (this.active.has(execution.attempt.id)) this.scheduleStatusObservation(execution);
    }
  }

  private queueSummaries(draft: CollaborationSnapshot): void {
    const roots = new Set(draft.tasks.filter((task) => task.kind === 'task').map((task) => task.rootTaskId));
    for (const root of roots) {
      const tasks = draft.tasks.filter((task) => task.rootTaskId === root && task.kind === 'task');
      const attempts = tasks.map((task) => currentAttempt(draft, task));
      if (!attempts.length || attempts.some((attempt) => !TERMINAL.has(attempt.status))) continue;
      const signature = fingerprint(attempts.map((attempt) => `${attempt.id}:${attempt.status}`).sort());
      const receipt = `summary:${root}:${signature}`;
      if (draft.receipts[receipt]) continue;
      const rootTask = this.task(draft, root);
      const origin = this.message(draft, rootTask.originMessageId);
      const coordinator = this.member(draft, draft.conversation.coordinatorMemberId);
      const message: Omit<CollaborationMessage, 'id' | 'conversationId' | 'sequence' | 'createdAt'> = {
        senderMemberId: coordinator.id, recipientMemberIds: [coordinator.id], mentions: [],
        kind: 'system', blocks: [{ type: 'text', text: '请汇总这组任务的结果、失败项和需要用户处理的事项。' }],
        replyToMessageId: rootTask.returnTo.replyToMessageId, expectsResponse: true,
        correlationId: origin.correlationId, causationId: origin.id, hopCount: origin.hopCount + 1,
      };
      if (!this.withinLoopBudget(draft, message, 1)) {
        draft.receipts[receipt] = 'loop_limit';
        continue;
      }
      const request = this.appendMessage(draft, message);
      const summary = this.addTask(draft, request, {
        assigneeMemberId: coordinator.id,
        title: '汇总任务结果',
        instructions: [
          '汇总以下任务的真实结果，区分成功、失败、中断和取消；仅总结，不重新执行任务。',
          ...tasks.map((task, index) => JSON.stringify({
            taskId: task.id, title: task.title, assignee: task.assigneeMemberId,
            status: attempts[index]!.status, output: attempts[index]!.output, error: attempts[index]!.error,
          })),
        ].join('\n'),
      }, 'summary', root, undefined, undefined, rootTask.returnTo.replyToMessageId);
      draft.receipts[receipt] = summary.id;
    }
  }

  private deliverResult(draft: CollaborationSnapshot, task: CollaborationTask, attempt: CollaborationAttempt): void {
    const receipt = `result:${attempt.id}`;
    if (draft.receipts[receipt]) return;
    const origin = this.message(draft, task.originMessageId);
    const user = draft.members.find((member) => member.kind === 'user');
    const recipient = task.kind === 'task' ? draft.conversation.coordinatorMemberId : user?.id;
    const message = this.appendMessage(draft, {
      senderMemberId: task.assigneeMemberId,
      recipientMemberIds: recipient ? [recipient] : [], mentions: [],
      kind: task.kind === 'reply' ? 'chat' : 'task_result',
      blocks: [{ type: 'text', text: attempt.output || attempt.error?.message ||
        (attempt.status === 'cancelled' ? '任务已停止。' : '任务已结束，未返回文本。') }],
      replyToMessageId: task.returnTo.replyToMessageId,
      taskId: task.id, attemptId: attempt.id, expectsResponse: false,
      correlationId: origin.correlationId, causationId: origin.id, hopCount: origin.hopCount + 1,
    });
    if (recipient) this.addDelivery(draft, message, recipient, 'processed', attempt.id);
    draft.receipts[receipt] = message.id;
  }

  private addTask(
    draft: CollaborationSnapshot,
    message: CollaborationMessage,
    input: CollaborationTaskDraft,
    kind: CollaborationTask['kind'],
    rootTaskId?: string,
    parentTaskId?: string,
    id = this.id(),
    returnMessageId = message.id,
  ): CollaborationTask {
    if (!input.title.trim() || !input.instructions.trim()) throw new Error('collaboration.task_content_required');
    const timeoutSeconds = input.timeoutSeconds ?? draft.conversation.policy.taskTimeoutSeconds;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) {
      throw new Error('collaboration.invalid_task_timeout');
    }
    const task: CollaborationTask = {
      id, rootTaskId: rootTaskId ?? id, parentTaskId, originMessageId: message.id,
      assigneeMemberId: input.assigneeMemberId, title: input.title.trim(), instructions: input.instructions,
      expectedOutput: input.expectedOutput ?? '', dependsOnTaskIds: [...new Set(input.dependsOnTaskIds ?? [])],
      contextRefs: [...(input.contextRefs ?? [])], resourceClaims: [],
      ...(input.planRef ? { planRef: copy(input.planRef) } : {}),
      returnTo: { conversationId: draft.conversation.id, replyToMessageId: returnMessageId },
      timeoutSeconds, currentAttemptId: '', kind, createdAt: this.now(),
    };
    const attempt = this.newAttempt(draft, task, 1);
    task.currentAttemptId = attempt.id;
    message.taskId = task.id;
    message.attemptId = attempt.id;
    draft.tasks.push(task);
    draft.attempts.push(attempt);
    this.addDelivery(draft, message, input.assigneeMemberId, 'queued', attempt.id);
    return task;
  }

  private newAttempt(draft: CollaborationSnapshot, task: CollaborationTask, number: number): CollaborationAttempt {
    return {
      id: this.id(), taskId: task.id, number, status: 'queued', updatedAt: this.now(),
      contextSequence: draft.messages.at(-1)?.sequence ?? 0, output: '', resourceClaims: [], tools: [], checklist: [],
      agentSnapshot: copy(this.ports.agentSnapshot?.(copy(draft), copy(task)) ?? {
        member: this.member(draft, task.assigneeMemberId), modelId: draft.conversation.modelId,
      }),
    };
  }

  private appendMessage(
    draft: CollaborationSnapshot,
    input: Omit<CollaborationMessage, 'id' | 'conversationId' | 'sequence' | 'createdAt'>,
  ): CollaborationMessage {
    const message: CollaborationMessage = {
      ...input, id: this.id(), conversationId: draft.conversation.id,
      sequence: (draft.messages.at(-1)?.sequence ?? 0) + 1, createdAt: this.now(),
    };
    draft.messages.push(message);
    return message;
  }

  private addDelivery(
    draft: CollaborationSnapshot, message: CollaborationMessage, recipientMemberId: string,
    status: CollaborationSnapshot['deliveries'][number]['status'], attemptId?: string,
  ): void {
    draft.deliveries.push({ id: this.id(), messageId: message.id, recipientMemberId, status, attemptId });
  }

  private completeDeliveries(draft: CollaborationSnapshot, attempt: CollaborationAttempt): void {
    for (const delivery of draft.deliveries) {
      if (delivery.attemptId !== attempt.id || !['queued', 'processing'].includes(delivery.status)) continue;
      delivery.status = attempt.status === 'succeeded' ? 'processed' : attempt.status === 'cancelled' ? 'cancelled' : 'failed';
      if (attempt.error) delivery.error = attempt.error.message;
    }
  }

  private recipients(draft: CollaborationSnapshot, sender: CollaborationMember, requested?: string[]): CollaborationMember[] {
    return [...new Set(requested?.length ? requested : [draft.conversation.coordinatorMemberId])].map((id) => {
      const member = this.member(draft, id);
      if (!member.active) throw new Error('collaboration.member_inactive');
      if (sender.kind !== 'user' && sender.id !== draft.conversation.coordinatorMemberId &&
        member.kind !== 'user' && member.id !== draft.conversation.coordinatorMemberId &&
        member.id !== sender.id && !draft.conversation.policy.allowPeerDirect) {
        throw new Error('collaboration.peer_direct_disabled');
      }
      return member;
    });
  }

  private withinLoopBudget(
    draft: CollaborationSnapshot,
    message: Pick<CollaborationMessage, 'correlationId' | 'hopCount'>,
    additional = 0,
  ): boolean {
    const automaticCount = draft.messages.filter((item) => item.correlationId === message.correlationId &&
      draft.members.find((member) => member.id === item.senderMemberId)?.kind !== 'user',
    ).length;
    return message.hopCount <= Math.min(6, draft.conversation.policy.maxMessageHops) &&
      automaticCount + additional <= Math.min(12, draft.conversation.policy.maxAutoMessages);
  }

  private enforceLoopBudget(draft: CollaborationSnapshot, message: CollaborationMessage): void {
    if (!this.withinLoopBudget(draft, message)) throw new Error('collaboration.loop_limit');
  }

  private runningInWorkspace(workspaceId: string): {
    conversationId: string; task: CollaborationTask; attempt: CollaborationAttempt;
  }[] {
    const running = new Map<string, { conversationId: string; task: CollaborationTask; attempt: CollaborationAttempt }>();
    for (const snapshot of this.repository.list(workspaceId)) {
      for (const task of snapshot.tasks) {
        const attempt = currentAttempt(snapshot, task);
        if (ACTIVE.has(attempt.status)) running.set(attempt.id, { conversationId: snapshot.conversation.id, task, attempt });
      }
    }
    // Retain locks until the executor has actually returned, even after a durable completion.
    for (const execution of this.active.values()) {
      if (execution.workspaceId === workspaceId) running.set(execution.attempt.id, execution);
    }
    return [...running.values()];
  }

  private validClaims(claims: CollaborationResourceClaim[]): CollaborationResourceClaim[] {
    const merged = new Map<string, CollaborationResourceClaim['mode']>();
    for (const claim of claims) {
      const key = claim.key.trim();
      if (!key || !['read', 'write'].includes(claim.mode)) throw new Error('collaboration.invalid_resource_claim');
      merged.set(key, merged.get(key) === 'write' ? 'write' : claim.mode);
    }
    return [...merged].map(([key, mode]) => ({ key, mode }));
  }

  private validatePolicy(policy: CollaborationPolicy): void {
    if (typeof policy.allowPeerDirect !== 'boolean') throw new Error('collaboration.invalid_policy');
    const bounds: [number, number, number][] = [
      [policy.maxConcurrent, 1, 3], [policy.maxMessageHops, 1, 6], [policy.maxAutoMessages, 1, 12],
      [policy.taskTimeoutSeconds, 1, 86400], [policy.statusTimeoutSeconds, 1, 3600],
    ];
    if (bounds.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)) {
      throw new Error('collaboration.invalid_policy');
    }
  }

  private duplicate(draft: CollaborationSnapshot, action: string, requestId: string, request: unknown): boolean {
    if (!requestId.trim()) throw new Error('collaboration.request_id_required');
    const stored = draft.receipts[`${action}:${requestId}`];
    if (!stored) return false;
    const receipt = JSON.parse(stored) as { fingerprint: string };
    if (receipt.fingerprint !== fingerprint(request)) throw new Error('collaboration.idempotency_conflict');
    return true;
  }

  private receipt(draft: CollaborationSnapshot, action: string, requestId: string, request: unknown, reference: string): void {
    draft.receipts[`${action}:${requestId}`] = JSON.stringify({ fingerprint: fingerprint(request), reference });
  }

  private mutate(conversationId: string, update: (draft: CollaborationSnapshot) => boolean): CollaborationSnapshot {
    let changed = false;
    const snapshot = this.repository.transaction(() => {
      const existing = this.repository.read(conversationId);
      if (!existing) throw new Error('collaboration.conversation_missing');
      const draft = copy(existing);
      draft.conversation.policy = { ...DEFAULT_COLLABORATION_CHAT_POLICY, ...draft.conversation.policy };
      this.validatePolicy(draft.conversation.policy);
      changed = update(draft);
      if (!changed) return existing;
      draft.revision = existing.revision + 1;
      this.repository.save(draft);
      return draft;
    });
    if (changed) {
      try { this.ports.onChanged(copy(snapshot)); } catch (error) { this.reportError(error); }
    }
    return copy(snapshot);
  }

  private schedulePump(workspaceId: string): void {
    if (this.stopped || this.scheduledWorkspaces.has(workspaceId)) return;
    this.scheduledWorkspaces.add(workspaceId);
    queueMicrotask(() => {
      this.scheduledWorkspaces.delete(workspaceId);
      void this.pump(workspaceId).catch((error) => this.reportError(error));
    });
  }

  private member(snapshot: CollaborationSnapshot, id: string): CollaborationMember {
    const member = snapshot.members.find((item) => item.id === id);
    if (!member) throw new Error('collaboration.member_missing');
    return member;
  }

  private sender(snapshot: CollaborationSnapshot, id?: string): CollaborationMember {
    const sender = id ? this.member(snapshot, id) : snapshot.members.find((member) => member.kind === 'user' && member.active);
    if (!sender?.active) throw new Error('collaboration.sender_inactive');
    return sender;
  }

  private task(snapshot: CollaborationSnapshot, id: string): CollaborationTask {
    const task = snapshot.tasks.find((item) => item.id === id);
    if (!task) throw new Error('collaboration.task_missing');
    return task;
  }

  private message(snapshot: CollaborationSnapshot, id: string): CollaborationMessage {
    const message = snapshot.messages.find((item) => item.id === id);
    if (!message) throw new Error('collaboration.message_missing');
    return message;
  }

  private error(code: string, category: CollaborationError['category'], message: string, retryable: boolean): CollaborationError {
    return { code, category, message, retryable, traceId: this.id() };
  }

  private assertAccepting(): void {
    if (this.stopped) throw new Error('collaboration.service_stopped');
  }

  private now(): string { return this.ports.now?.() ?? new Date().toISOString(); }
  private id(): string { return this.ports.id?.() ?? randomUUID(); }
  private reportError(error: unknown): void { this.ports.onError?.(error); }
}
