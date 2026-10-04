import { groupConversationPlanningPrompt, groupContributionInstructions, parseGroupConversationPlan, publicConversationHandoffs } from './collaboration-group-planning.js';
import { collaborationMessageVisible, collaborationSnapshotForMember } from '@sync-think/shared';
import { collaborationMessageContextText } from './collaboration-attachment-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { checkpointRoom, isRoomWork, isCurrentRoomWork, isActionableRoomWork, roomContextSelection, taskRoomMemberHint } from './task-room.js';
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
  artifacts?: CollaborationAttempt['artifacts'];
}

export interface CollaborationProgress {
  runId?: string;
  threadId?: string;
  output?: string;
  phase?: CollaborationAttempt['phase'];
  commentary?: string;
  status?: 'running' | 'waiting_input';
  tools?: CollaborationAttempt['tools'];
  checklist?: CollaborationAttempt['checklist'];
  artifacts?: CollaborationAttempt['artifacts'];
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
  stopReason?: 'cancel' | 'timeout' | 'shutdown' | 'pause';
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
    execution?: { taskId: string; attemptId: string },
  ): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const sender = this.sender(draft, senderMemberId);
      const request = { ...command,
        // SQLite canonicalizes structured payload key order. Receipt identity must not depend on it.
        ...(command.images?.length ? { images: command.images.map(image => ({ id: image.id, name: image.name, mimeType: image.mimeType, stagingPath: image.stagingPath, dataUrl: image.dataUrl })) } : {}),
        ...(command.files?.length ? { files: command.files.map(file => ({ path: file.path, name: file.name, kind: file.kind, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sourcePath: file.sourcePath })) } : {}),
        senderMemberId: sender.id, contextRef: linkedContext?.ref, execution };
      if (this.duplicate(draft, 'send', command.clientRequestId, request)) return false;
      const automatic = sender.kind !== 'user';
      if (automatic && command.intent === 'chat') throw new Error('collaboration.user_chat_intent_required');
      const room = draft.conversation.room;
      const source = automatic && room && execution ? this.task(draft, execution.taskId) : undefined;
      if (automatic && room && (!source || source.assigneeMemberId !== sender.id ||
        source.currentAttemptId !== execution?.attemptId || !ACTIVE.has(currentAttempt(draft, source).status) ||
        currentAttempt(draft, source).status === 'stopping')) throw new Error('task_room.execution_no_longer_active');
      const text = command.text.trim();
      if (!text && !command.images?.length && !command.files?.length) throw new Error('collaboration.empty_message');
      const reply = command.replyToMessageId
        ? this.message(draft, command.replyToMessageId)
        : undefined;
      const causation = reply ?? linkedContext?.message;
      if (sender.kind !== 'user' && !causation) throw new Error('collaboration.automatic_causation_required');
      if (reply && !collaborationMessageVisible(reply, sender.id)) throw new Error('collaboration.private_context_forbidden');
      if (command.visibility === 'private' && !(command.recipientMemberIds?.length || command.mentions?.length || reply)) throw new Error('collaboration.private_recipient_required');
      if ((command.visibility ?? reply?.visibility) === 'private' && command.intent === 'work') throw new Error('collaboration.private_work_goal_forbidden');
      if (reply?.visibility === 'private' && command.visibility === 'public') throw new Error('collaboration.private_reply_required');
      const targets = command.recipientMemberIds?.length ? command.recipientMemberIds : command.mentions?.map(m => m.memberId);
      const replyTarget = reply && reply.senderMemberId !== sender.id
        && draft.members.some(m => m.id === reply.senderMemberId && m.active) ? reply.senderMemberId : undefined;
      const pending = sender.kind === 'user' && !reply && command.intent !== 'work'
        ? [...new Set(draft.tasks.filter(t => !t.consultation && t.kind === 'task' &&
          ['queued', 'running', 'waiting_input'].includes(currentAttempt(draft, t).status) &&
          draft.members.some(m => m.id === t.assigneeMemberId && m.active)).map(t => t.assigneeMemberId))] : [];
      const routed = targets?.length ? targets : replyTarget ? [replyTarget] : pending.length === 1 ? pending : undefined;
      let recipients = this.recipients(draft, sender, routed);
      if (command.deliveryMode !== undefined && !['notify', 'handoff', 'consult'].includes(command.deliveryMode)) throw new Error('collaboration.invalid_delivery_mode');
      if (command.deliveryMode !== undefined && command.expectsResponse !== undefined &&
        command.expectsResponse !== (command.deliveryMode !== 'notify')) throw new Error('collaboration.delivery_mode_conflict');
      const expectsResponse = command.deliveryMode !== undefined ? command.deliveryMode !== 'notify' : command.expectsResponse ?? !(automatic && room);
      const deliveryMode = command.deliveryMode ?? (source ? expectsResponse ? 'consult' : 'notify' : undefined);
      if (source && expectsResponse) {
        const ancestors = new Set<string>();
        for (let task: CollaborationTask | undefined = source; task && !ancestors.has(task.assigneeMemberId);
          task = task.parentTaskId ? draft.tasks.find(t => t.id === task!.parentTaskId) : undefined) ancestors.add(task.assigneeMemberId);
        if (recipients.some(m => m.kind === 'user' || ancestors.has(m.id) ||
          [...ancestors].some(id => m.agentId && this.member(draft, id).agentId === m.agentId))) throw new Error('collaboration.consultation_cycle');
      }
      const work = Boolean(room && command.intent === 'work');
      if (work && sender.kind !== 'user') throw new Error('task_room.user_work_intent_required');
      if (work && ['paused', 'pausing', 'completed'].includes(room!.state)) throw new Error('task_room.resume_required');
      if (work) {
        if (!room!.goal) { room!.goal = command.text.trim() || '处理本次用户附件'; room!.goalRevision++; room!.sourceSequence = draft.messages.at(-1)?.sequence ?? 0; }
        room!.state = 'running';
      }
      const trimOffset = command.text.length - command.text.trimStart().length;
      let mentionEnd = 0;
      const mentions = command.mentions?.map(mention => {
        const start = mention.start - trimOffset, end = mention.end - trimOffset;
        if (!recipients.some(member => member.id === mention.memberId && member.kind !== 'user')
          || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start < mentionEnd || end <= start || end > text.length || text.slice(start, end) !== mention.label) {
          throw new Error('collaboration.invalid_mention');
        }
        mentionEnd = end;
        return { memberId: mention.memberId, label: mention.label, start, end };
      });
      const message = this.appendMessage(draft, {
        visibility: command.visibility ?? reply?.visibility ?? 'public',
        senderMemberId: sender.id,
        recipientMemberIds: recipients.map((member) => member.id),
        mentions: mentions ?? (command.recipientMemberIds?.length ? recipients : []).map((member) => ({
          memberId: member.id, label: member.name,
        })),
        kind: 'chat',
        blocks: [...(text ? [{ type: 'text' as const, text }] : []),
          ...(command.images ?? []).map(image => ({ type: 'image' as const, payload: image })),
          ...(command.files ?? []).map(file => ({ type: 'file' as const, payload: file }))],
        replyToMessageId: reply?.id,
        ...(linkedContext ? { contextRefs: [linkedContext.ref] } : {}),
        expectsResponse,
        ...(deliveryMode ? { deliveryMode } : {}),
        correlationId: causation?.correlationId ?? this.id(),
        causationId: causation?.id,
        hopCount: causation ? causation.hopCount + 1 : 0,
      });
      if (automatic) this.enforceLoopBudget(draft, message);
      // A discussion has one public output: a real reply OR a one-way handoff, not a second final acknowledgement.
      if (source?.kind === 'reply' && source.purpose === 'discussion' &&
        (deliveryMode === 'handoff' || !expectsResponse && recipients.some(m => m.id === this.message(draft, source.originMessageId).senderMemberId))) {
        currentAttempt(draft, source).chatDeliveryMessageId = message.id;
      }
      let rootTaskId: string | undefined;
      if (room) {
        const seen = new Set<string>();
        recipients = recipients.filter(m => { const key = m.agentId ?? m.id; if (seen.has(key)) return false; seen.add(key); return true; });
      }
      const planning = draft.conversation.kind === 'group' && draft.conversation.policy.coordinateDiscussion === true && !automatic && !work && message.expectsResponse && message.visibility !== 'private' && (!routed?.length || routed.length > 1) && !['paused', 'pausing', 'completed'].includes(room?.state ?? '');
      if (planning) {
        const planner = this.addTask(draft, message, { assigneeMemberId: draft.conversation.coordinatorMemberId, title: '协调本次群聊', instructions: groupConversationPlanningPrompt(draft, message.id), purpose: 'discussion', timeoutSeconds: Math.min(90, draft.conversation.policy.taskTimeoutSeconds) }, 'reply');
        planner.conversationPlanning = true;
        planner.conversationPlanningIntent = command.intent === 'chat' ? 'chat' : 'discussion';
        // Routing is an internal observation, not a participant delivery.
        draft.deliveries = draft.deliveries.filter(d => d.attemptId !== planner.currentAttemptId);
      }
      for (const recipient of planning ? [] : recipients) {
        if (!message.expectsResponse || recipient.kind === 'user') {
          this.addDelivery(draft, message, recipient.id, 'processed');
          continue;
        }
        const coordinates = work && (recipient.kind === 'team' || recipient.id === draft.conversation.coordinatorMemberId &&
          draft.members.some(m => m.active && m.kind !== 'user' && m.agentId !== recipient.agentId));
        const task = this.addTask(draft, message, {
          assigneeMemberId: recipient.id,
          title: (text || '查看用户附件').slice(0, 100),
          instructions: collaborationMessageContextText(message),
          ...(room ? { purpose: work ? (coordinates ? 'coordination' as const : 'work' as const) : 'discussion' as const } : {}),
          ...(work && !coordinates ? { deliverable: { kind: 'document' as const, title: (text || '附件处理结果').slice(0, 100) } } : {}),
        }, work ? 'task' : 'reply', source?.rootTaskId ?? rootTaskId, source?.id);
        if (room && !automatic && command.intent === 'chat' && message.visibility !== 'private' && recipient.id === draft.conversation.coordinatorMemberId) task.workflowStartAllowed = true;
        if (source && deliveryMode !== 'handoff') task.consultation = { requesterTaskId: source.id, requesterAttemptId: execution!.attemptId, workScoped: isRoomWork(source) };
        rootTaskId ??= task.id;
      }
      this.receipt(draft, 'send', command.clientRequestId, request, message.id);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  handoff(command: Command<'handoff'>, actorMemberId: string, execution: { taskId: string; attemptId: string }): CollaborationSnapshot {
    this.assertAccepting();
    return this.mutate(command.conversationId, draft => {
      const request = { ...command, actorMemberId, execution };
      if (this.duplicate(draft, 'handoff', command.clientRequestId, request)) return false;
      const room = draft.conversation.room;
      const task = this.task(draft, execution.taskId);
      const attempt = currentAttempt(draft, task);
      if (!room || !room.goal || !isActionableRoomWork(draft, task) || task.consultation ||
        !['work', 'coordination'].includes(task.purpose ?? '') || task.assigneeMemberId !== actorMemberId ||
        attempt.id !== execution.attemptId || attempt.status !== 'running') throw new Error('task_room.production_execution_required');
      if (['paused', 'pausing', 'completed'].includes(room.state)) throw new Error('task_room.resume_required');
      if (draft.tasks.some(t => t.consultation?.requesterAttemptId === attempt.id)) throw new Error('task_room.peer_reply_pending');
      const sender = this.member(draft, actorMemberId);
      const [recipient] = this.recipients(draft, sender, [command.handoff.recipientMemberId]);
      if (!recipient || recipient.kind === 'user' || recipient.id === sender.id) throw new Error('task_room.invalid_handoff_recipient');
      if (task.purpose === 'work' && !attempt.artifacts?.some(a => a.taskId === task.id && a.attemptId === attempt.id && a.kind === task.deliverable?.kind)) throw new Error('task_room.deliver_before_handoff');
      const ownRefs = attempt.artifacts?.map(a => a.id) ?? [];
      const refs = command.handoff.artifactIds ?? (ownRefs.length ? ownRefs : task.handoff?.artifactIds ?? []);
      for (const id of refs) if (!draft.attempts.some(a => a.artifacts?.some(x => x.id === id) &&
        (a.id === attempt.id || a.status === 'succeeded'))) throw new Error('task_room.handoff_artifact_not_delivered');
      if (command.handoff.kind === 'review' && !refs.length) throw new Error('task_room.review_artifact_required');
      const nodes = draft.tasks.filter(t => t.rootTaskId === task.rootTaskId &&
        (draft.messages.find(m => m.id === t.originMessageId)?.sequence ?? 0) > (room.autoContinueAfterSequence ?? 0));
      const reserved = nodes.filter(t => t.id !== task.id && ACTIVE.has(currentAttempt(draft, t).status) && currentAttempt(draft, t).workHandoff).length;
      if (nodes.length + reserved >= 64) throw new Error('task_room.automatic_work_limit');
      const handoff = { ...copy(command.handoff), artifactIds: [...new Set(refs)] };
      if (attempt.workHandoff && fingerprint(attempt.workHandoff) !== fingerprint(handoff)) throw new Error('task_room.handoff_already_selected');
      attempt.workHandoff = handoff;
      this.receipt(draft, 'handoff', command.clientRequestId, request, attempt.id);
      return true;
    });
  }

  private commitWorkHandoff(draft: CollaborationSnapshot, source: CollaborationTask, attempt: CollaborationAttempt): void {
    const handoff = attempt.workHandoff;
    if (!handoff || attempt.status !== 'succeeded') return;
    const resultId = draft.receipts['result:' + attempt.id];
    const result = this.message(draft, resultId!);
    const recipient = this.member(draft, handoff.recipientMemberId);
    // The addressed result is the next request; create real work without a duplicate assignment bubble.
    const message = result;
    draft.deliveries = draft.deliveries.filter(d => d.messageId !== result.id);
    const task = this.addTask(draft, message, { assigneeMemberId: recipient.id,
      purpose: handoff.kind === 'work' ? 'work' : 'coordination',
      title: handoff.title ?? (handoff.kind === 'review' ? '审核交付成果' : '根据交付决定下一步'),
      instructions: handoff.text, contextRefs: handoff.artifactIds,
      ...(handoff.kind === 'work' ? { deliverable: handoff.deliverable } : {}),
    }, 'task', source.rootTaskId, source.id, undefined, result.id);
    task.handoff = { kind: handoff.kind, sourceTaskId: source.id, sourceAttemptId: attempt.id, artifactIds: handoff.artifactIds ?? [] };
    task.coordinatorMemberId = handoff.kind === 'work' ? source.assigneeMemberId : recipient.id;
    // addTask normally stamps its origin. A delivery keeps its original producer provenance.
    result.taskId = source.id; result.attemptId = attempt.id;
  }

  dispatch(command: Command<'dispatch'>, senderMemberId?: string): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const sender = this.sender(draft, senderMemberId);
      const request = { ...command, senderMemberId: sender.id };
      if (this.duplicate(draft, 'dispatch', command.clientRequestId, request)) return false;
      if (draft.conversation.room) {
        if (['paused', 'pausing', 'completed'].includes(draft.conversation.room.state)) throw new Error('task_room.resume_required');
        if (!draft.conversation.room.goal && sender.kind === 'user') {
          draft.conversation.room.goal = command.tasks.map(t => t.instructions.trim()).join('\n\n');
          draft.conversation.room.goalRevision++;
          draft.conversation.room.sourceSequence = draft.messages.at(-1)?.sequence ?? 0;
        }
        draft.conversation.room.state = 'running';
      }
      if (!command.tasks.length) throw new Error('collaboration.tasks_required');
      if (command.tasks.length > 64) throw new Error('collaboration.workflow_too_large');
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
      // Production started by a real conversation contribution belongs to that
      // authorized reply, not to its internal routing controller.
      const rootTaskId = parent?.conversationPlanTaskId && parent.workflowStartAllowed && parent.kind === 'reply' ? parent.id : parent?.rootTaskId ?? ids[0]!;
      const correlationId = origin?.correlationId ?? this.id();
      let dispatchOrigin = origin;
      for (let index = 0; index < command.tasks.length; index += 1) {
        const input = command.tasks[index]!;
        const [recipient] = this.recipients(draft, sender, [input.assigneeMemberId]);
        if (!recipient || recipient.kind === 'user') throw new Error('collaboration.agent_required');
        const dependsOnTaskIds = (input.dependsOnTaskIds ?? []).map((id) => keys.get(id) ?? id);
        const pending = dependsOnTaskIds.some(id => {
          const dependency = draft.tasks.find(task => task.id === id);
          return !dependency || currentAttempt(draft, dependency).status !== 'succeeded';
        });
        const assignment = {
          senderMemberId: sender.id,
          recipientMemberIds: [recipient.id],
          mentions: [{ memberId: recipient.id, label: recipient.name }],
          kind: 'task_assignment' as const,
          blocks: [{ type: 'text' as const, text: input.instructions }],
          replyToMessageId: origin?.id,
          expectsResponse: true,
          correlationId,
          causationId: origin?.id,
          hopCount: origin ? origin.hopCount + 1 : 0,
        };
        if (sender.kind !== 'user' && !this.withinLoopBudget(draft, assignment)) throw new Error('collaboration.loop_limit');
        // Keep the downstream plan durable without addressing its assignee yet.
        // An existing cause anchors the task until claim() commits the actual handoff.
        if (pending && !dispatchOrigin) dispatchOrigin = this.appendMessage(draft, {
          senderMemberId: sender.id, recipientMemberIds: [], mentions: [], kind: 'system',
          blocks: [{ type: 'text', text: '已记录后续阶段，待前置交付后逐项派工。' }],
          expectsResponse: false, correlationId, hopCount: 0,
        });
        const message = pending ? dispatchOrigin! : this.appendMessage(draft, assignment);
        dispatchOrigin ??= message;
        const created = this.addTask(draft, message, {
          ...input, dependsOnTaskIds,
        }, 'task', rootTaskId, parent?.id, ids[index], origin?.id, pending ? {
          senderMemberId: sender.id, correlationId, causationMessageId: origin?.id,
          hopCount: assignment.hopCount,
        } : undefined);
        if (input.replacesTaskId) this.linkReplacement(draft, input.replacesTaskId, created.id);
      }
      const graph = validateDag(draft.tasks.map((task, index) => ({
        id: task.id, dependsOn: task.dependsOnTaskIds, planOrder: index,
      })));
      if (!graph.ok) throw new Error(`collaboration.invalid_dependencies:${graph.reason}`);
      checkpointRoom(draft, this.now());
      this.receipt(draft, 'dispatch', command.clientRequestId, request, rootTaskId);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  roomCommand(command: Extract<CollaborationCommand, { action: 'room-pause' | 'room-resume' | 'room-complete' | 'room-brief' }>, goalOrigin: 'user' | 'assistant' = 'user', startingReply?: { taskId: string; attemptId: string }): CollaborationSnapshot {
    this.assertAccepting();
    const abortIds: string[] = [];
    const snapshot = this.mutate(command.conversationId, draft => {
      const room = draft.conversation.room;
      if (!room) throw new Error('task_room.required');
      if (this.duplicate(draft, command.action, command.clientRequestId, command)) return false;
      const automaticChat = (t: CollaborationTask) => Boolean(t.conversationPlanning || t.conversationPlanTaskId || t.conversationRecovery);
      const work = draft.tasks.filter(t => isActionableRoomWork(draft, t) || (command.action === 'room-pause' || command.action === 'room-resume') && automaticChat(t) && !['succeeded', 'cancelled'].includes(currentAttempt(draft, t).status));
      // A verified human-authorized coordinator contribution may initialize an
      // empty work goal from inside its own chat turn. It is not competing work.
      // Other active discussion/work tasks still block a goal change.
      const starter = command.action === 'room-brief' && goalOrigin === 'assistant' && !room.goal && startingReply
        ? draft.tasks.find(t => t.id === startingReply.taskId && t.currentAttemptId === startingReply.attemptId && t.workflowStartAllowed === true && !t.conversationPlanning && !t.consultation && t.kind === 'reply' && t.assigneeMemberId === draft.conversation.coordinatorMemberId && ACTIVE.has(currentAttempt(draft, t).status)) : undefined;
      const active = draft.tasks.filter(t => (isRoomWork(t) || automaticChat(t)) && t.id !== starter?.id).filter(t => ACTIVE.has(currentAttempt(draft, t).status));
      if (command.action === 'room-brief') {
        if (room.goalRevision !== command.expectedGoalRevision) throw new Error('task_room.goal_revision_conflict');
        if (active.length || work.some(t => currentAttempt(draft, t).status === 'queued') && room.state === 'running') throw new Error('task_room.pause_before_goal_change');
        if (!command.goal.trim()) throw new Error('task_room.goal_required');
        // An explicit new goal supersedes the old plan, not its durable history or artifacts.
        for (const task of draft.tasks.filter(isRoomWork)) {
          task.goalRevision ??= room.goalRevision;
          const attempt = currentAttempt(draft, task);
          if (attempt.status === 'queued') {
            attempt.status = 'cancelled'; attempt.finishedAt = attempt.updatedAt = this.now(); delete attempt.waitReason;
            attempt.error = this.error('goal_replaced', 'execution', '工作目标已更新，旧计划保留为历史，不再自动续跑。', false);
            this.completeDeliveries(draft, attempt); this.deliverResult(draft, task, attempt);
          }
        }
        room.checkpoint.note = '工作目标已更新，历史计划与成果保留。';
        room.goal = command.goal.trim(); room.goalOrigin = goalOrigin; room.goalRevision++; room.sourceSequence = draft.messages.at(-1)?.sequence ?? 0;
        if (room.state === 'completed') room.state = 'discussion';
        this.appendMessage(draft, { senderMemberId: this.sender(draft).id, recipientMemberIds: [], mentions: [], kind: 'system', blocks: [{ type: 'text', text: (goalOrigin === 'assistant' ? '已自动整理工作目标 v' : '已确认工作目标 v') + room.goalRevision + '\n' + room.goal }], expectsResponse: false, correlationId: this.id(), hopCount: 0 });
      } else if (command.action === 'room-pause') {
        if (room.state === 'completed') throw new Error('task_room.already_completed');
        room.state = active.length ? 'pausing' : 'paused';
        for (const task of work) {
          const attempt = currentAttempt(draft, task);
          if (ACTIVE.has(attempt.status)) { attempt.pauseRequested = true; attempt.status = 'stopping'; attempt.updatedAt = this.now(); abortIds.push(attempt.id); }
          else if (attempt.status === 'queued') attempt.waitReason = 'room_paused';
        }
      } else if (command.action === 'room-resume') {
        if (active.length || room.state === 'pausing') throw new Error('task_room.still_stopping');
        if (room.state !== 'paused' && room.state !== 'blocked') throw new Error('task_room.not_paused');
        room.state = work.some(isRoomWork) ? 'running' : 'discussion';
        room.autoContinueAfterSequence = draft.messages.at(-1)?.sequence ?? 0;
        for (const task of work) {
          const previous = currentAttempt(draft, task);
          if (previous.status === 'interrupted' || previous.status === 'failed' && previous.error?.retryable) {
            const next = this.newAttempt(draft, task, previous.number + 1);
            next.resumeFromAttemptId = previous.id; next.threadId = previous.threadId;
            task.currentAttemptId = next.id; task.workStatus = 'open'; draft.attempts.push(next);
            const delivery = draft.deliveries.find(d => d.attemptId === previous.id);
            if (delivery) { delivery.attemptId = next.id; delivery.status = 'queued'; delete delivery.error; }
          } else if (previous.status === 'queued') delete previous.waitReason;
        }
        this.queueRoomFollowups(draft);
      } else {
        if (active.length || work.some(t => ['queued', 'failed', 'interrupted', 'cancelled'].includes(currentAttempt(draft, t).status) && !t.consultation)) throw new Error('task_room.unfinished_work');
        if (!room.goal || !work.length) throw new Error('task_room.no_work_to_accept');
        if ((work.every(t => t.purpose === 'coordination') || work.some(t => t.deliverable)) && !work.some(t => currentAttempt(draft, t).status === 'succeeded' && currentAttempt(draft, t).artifacts?.length)) throw new Error('task_room.no_artifacts_to_accept');
        room.state = 'completed';
        for (const task of work) if (currentAttempt(draft, task).status === 'succeeded') task.workStatus = 'done';
      }
      checkpointRoom(draft, this.now());
      this.receipt(draft, command.action, command.clientRequestId, command, room.state);
      return true;
    });
    for (const id of abortIds) this.abort(id, 'pause');
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  private queueRoomFollowups(draft: CollaborationSnapshot): void {
    const room = draft.conversation.room!;
    if (['paused', 'pausing', 'completed'].includes(room.state)) return;
    const work = draft.tasks.filter(t => isActionableRoomWork(draft, t));
    for (const root of new Set(work.filter(t => t.purpose === 'coordination').map(t => t.rootTaskId))) {
      const rootTask = draft.tasks.find(t => t.id === root);
      if (!rootTask) continue;
      const group = work.filter(t => t.rootTaskId === root);
      if (group.some(t => !TERMINAL.has(currentAttempt(draft, t).status) && !this.pendingDependencyBlocked(draft, t))) continue;
      if (group.some(t => t.handoff)) {
        for (const task of group.filter(t => t.purpose === 'work' && !t.consultation)) {
          const attempt = currentAttempt(draft, task);
          if (attempt.status === 'succeeded' && attempt.workHandoff) continue;
          const receipt = 'room-handoff-fallback:' + attempt.id;
          if (draft.receipts[receipt] || !TERMINAL.has(attempt.status)) continue;
          const recipient = draft.members.find(m => m.id === task.coordinatorMemberId && m.active);
          if (!recipient) continue;
          const resultId = draft.receipts['result:' + attempt.id];
          if (!resultId) continue;
          if (draft.tasks.filter(t => t.rootTaskId === root && (draft.messages.find(m => m.id === t.originMessageId)?.sequence ?? 0) > (room.autoContinueAfterSequence ?? 0)).length >= 64) { room.state = 'paused'; checkpointRoom(draft, this.now(), '自动交接已达本轮额度，请检查后继续。'); return; }
          const origin = this.message(draft, resultId);
          draft.deliveries = draft.deliveries.filter(d => d.messageId !== origin.id || d.recipientMemberId !== recipient.id);
          const next = this.addTask(draft, origin, { assigneeMemberId: recipient.id, purpose: 'coordination',
            title: '核对成员交付并决定下一步', instructions: '读取这次交付与工作目标，依据小队描述决定下一步或报告阻塞，不重复已完成成果。' },
            'task', root, task.id, undefined, origin.id);
          next.handoff = { kind: 'report', sourceTaskId: task.id, sourceAttemptId: attempt.id, artifactIds: attempt.artifacts?.map(a => a.id) ?? [] };
          next.coordinatorMemberId = recipient.id;
          origin.taskId = task.id; origin.attemptId = attempt.id;
          draft.receipts[receipt] = next.id;
        }
        continue;
      }
      const children = group.filter(t => t.purpose !== 'coordination' && !t.consultation);
      if (!children.length) continue;
      const signature = fingerprint(children.map(t => t.currentAttemptId + ':' + currentAttempt(draft, t).status).sort());
      const key = 'room-followup:' + root + ':' + signature;
      if (draft.receipts[key]) continue;
      const origin = this.message(draft, rootTask.originMessageId);
      const actor = this.member(draft, rootTask.assigneeMemberId);
      if (!actor.active) { draft.receipts[key] = 'member_removed'; continue; }
      const message = { senderMemberId: actor.id, recipientMemberIds: [actor.id], mentions: [], kind: 'system' as const,
        blocks: [{ type: 'text' as const, text: '成员本轮工作已结束，请检查真实成果、失败或阻塞，再决定下一步。' }],
        replyToMessageId: rootTask.returnTo.replyToMessageId, expectsResponse: true, correlationId: origin.correlationId, causationId: origin.id, hopCount: origin.hopCount + 1 };
      if (!this.withinLoopBudget(draft, message, 1)) { room.state = 'paused'; checkpointRoom(draft, this.now(), '自动推进已达本轮额度，请检查任务后显式继续。'); return; }
      const trigger = this.appendMessage(draft, message);
      const followup = this.addTask(draft, trigger, { assigneeMemberId: actor.id, purpose: 'coordination', title: '负责人检查成员成果', instructions: '先读取本群工作索引与产物。区分交付、失败和尚未派工的计划；planned 仅表示待派工。有前置失败时核对阻塞与恢复，不重复派出下游。必要时安排下一项有界工作，不重复已完成工作。无后续工作时给出验收说明。' }, 'task', root, root, undefined, rootTask.returnTo.replyToMessageId);
      draft.receipts[key] = followup.id;
    }
    if (work.length && !draft.tasks.filter(t => isActionableRoomWork(draft, t)).some(t => !TERMINAL.has(currentAttempt(draft, t).status) && !this.pendingDependencyBlocked(draft, t))) {
      const expectsArtifact = work.every(t => t.purpose === 'coordination') || work.some(t => t.deliverable);
      const hasDelivery = work.some(t => currentAttempt(draft, t).status === 'succeeded' && currentAttempt(draft, t).artifacts?.length);
      const unresolved = work.filter(t => !t.consultation && ['failed', 'interrupted', 'cancelled'].includes(currentAttempt(draft, t).status));
      room.state = unresolved.length || expectsArtifact && !hasDelivery ? 'blocked' : 'review';
      if (unresolved.length) room.checkpoint.note = unresolved.map(t => t.title + '：' + (currentAttempt(draft, t).error?.message ?? '尚未交付')).join('；').slice(0, 2000);
      if (expectsArtifact && !hasDelivery) room.checkpoint.note = (unresolved.length ? room.checkpoint.note + '\n' : '') + '本轮执行已结束，但尚无真实成果可验收。请核对工作回执与执行记录后继续，未交付不等于已完成。';
    }
    checkpointRoom(draft, this.now());
  }

  cancel(command: Command<'cancel'>): CollaborationSnapshot {
    const abort: string[] = [];
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const target = this.task(draft, command.taskId);
      const selected = new Set([command.taskId]);
      if (target.teamParticipantId && target.assigneeMemberId === target.teamParticipantId) {
        // A team handoff owns its frozen internal DAG, even though those nodes are prerequisites.
        const visit = (task: CollaborationTask) => {
          for (const dependencyId of task.dependsOnTaskIds) {
            const dependency = draft.tasks.find(item => item.id === dependencyId);
            if (dependency && dependency.teamParticipantId === target.teamParticipantId && dependency.assigneeMemberId !== target.teamParticipantId && !selected.has(dependency.id)) { selected.add(dependency.id); visit(dependency); }
          }
        };
        visit(target);
      }
      if (command.includeChildren) {
        let size: number;
        do {
          size = selected.size;
          for (const task of draft.tasks) {
            if ((task.parentTaskId && selected.has(task.parentTaskId)) || task.rootTaskId === command.taskId) selected.add(task.id);
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

  replaceTask(command: Command<'replace-task'>): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, draft => {
      if (this.duplicate(draft, 'replace-task', command.clientRequestId, command)) return false;
      this.linkReplacement(draft, command.taskId, command.replacementTaskId);
      this.queueRoomFollowups(draft);
      checkpointRoom(draft, this.now());
      this.receipt(draft, 'replace-task', command.clientRequestId, command, command.replacementTaskId);
      return true;
    });
    this.schedulePump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  private linkReplacement(draft: CollaborationSnapshot, previousId: string, replacementId: string): void {
    const previous = this.task(draft, previousId);
    const replacement = this.task(draft, replacementId);
    if (previous.id === replacement.id || !draft.conversation.room ||
      !isCurrentRoomWork(draft, previous) || !isCurrentRoomWork(draft, replacement)) throw new Error('task_room.invalid_replacement');
    if (previous.replacedByTaskId === replacement.id && replacement.replacesTaskId === previous.id) return;
    if (previous.replacedByTaskId || replacement.replacesTaskId || replacement.replacedByTaskId ||
      !['failed', 'interrupted', 'cancelled'].includes(currentAttempt(draft, previous).status) ||
      previous.purpose === 'coordination' || replacement.purpose === 'coordination' ||
      previous.deliverable?.kind !== replacement.deliverable?.kind) throw new Error('task_room.invalid_replacement');
    if (draft.tasks.some(t => isActionableRoomWork(draft, t) && t.dependsOnTaskIds.includes(previous.id) &&
      !['succeeded', 'cancelled'].includes(currentAttempt(draft, t).status))) throw new Error('task_room.replacement_has_dependents');
    previous.replacedByTaskId = replacement.id;
    replacement.replacesTaskId = previous.id;
  }

  retry(command: Command<'retry'>): CollaborationSnapshot {
    this.assertAccepting();
    const snapshot = this.mutate(command.conversationId, (draft) => {
      if (this.duplicate(draft, 'retry', command.clientRequestId, command)) return false;
      const task = this.task(draft, command.taskId);
      if (draft.conversation.room && isRoomWork(task)) {
        if (!isCurrentRoomWork(draft, task)) throw new Error('task_room.goal_changed');
        if (draft.conversation.room.state === 'completed') throw new Error('task_room.resume_required');
        if (!['paused', 'pausing'].includes(draft.conversation.room.state)) draft.conversation.room.state = 'running';
        task.workStatus = 'open';
      }
      if (task.replacedByTaskId) throw new Error('task_room.task_replaced');
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
      const delivery = task.pendingAssignment ? undefined : draft.deliveries.find((item) =>
        item.messageId === origin.id && item.recipientMemberId === task.assigneeMemberId,
      );
      if (delivery) {
        delivery.status = 'queued';
        delivery.attemptId = attempt.id;
        delete delivery.error;
      } else if (!task.pendingAssignment) {
        this.addDelivery(draft, origin, task.assigneeMemberId, 'queued', attempt.id);
      }
      const restored = new Set([task.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const dependent of draft.tasks) {
          const prior = currentAttempt(draft, dependent);
          if (prior.error?.code !== 'dependency_failed' || !dependent.dependsOnTaskIds.some(id => restored.has(id)) || restored.has(dependent.id)) continue;
          const next = this.newAttempt(draft, dependent, prior.number + 1);
          dependent.currentAttemptId = next.id; draft.attempts.push(next); restored.add(dependent.id); changed = true;
          const delivery = draft.deliveries.find(d => d.attemptId === prior.id);
          if (delivery) { delivery.attemptId = next.id; delivery.status = 'queued'; delete delivery.error; }
        }
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

  groupConfig(command: Command<'group-config'>): CollaborationSnapshot {
    return this.mutate(command.conversationId, draft => {
      if (draft.conversation.kind !== 'group') throw new Error('collaboration.group_required');
      if (typeof command.description !== 'string' || command.description.length > 16000 || !Number.isSafeInteger(command.expectedRevision)) throw new Error('collaboration.invalid_group_description');
      if (this.duplicate(draft, 'group-config', command.clientRequestId, command)) return false;
      if ((draft.conversation.groupConfigurationRevision ?? 0) !== command.expectedRevision) throw new Error('collaboration.group_configuration_conflict');
      draft.conversation.groupDescription = command.description.trim();
      draft.conversation.groupConfigurationRevision = command.expectedRevision + 1;
      this.receipt(draft, 'group-config', command.clientRequestId, command, 'group:' + draft.conversation.groupConfigurationRevision);
      return true;
    });
  }

  updatePolicy(command: Command<'policy'>): CollaborationSnapshot {
    const snapshot = this.mutate(command.conversationId, (draft) => {
      const policy = { ...draft.conversation.policy, allowGroupMessages: draft.conversation.policy.allowGroupMessages ?? draft.conversation.policy.allowPeerDirect, ...command.policy };
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
      const rooms = this.repository.list(workspaceId).map(snapshot => ({ snapshot, tasks: snapshot.tasks.filter(t => currentAttempt(snapshot, t).status === 'queued') }));
      // Round-robin admission prevents a long book from consuming every free slot.
      for (let index = 0; index < Math.max(0, ...rooms.map(r => r.tasks.length)); index++) {
        for (const { snapshot, tasks } of rooms) {
          if (this.stopped) return;
          const task = tasks[index]; if (!task) continue;
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
      if (progress.phase !== undefined) attempt.phase = progress.phase;
      if (progress.commentary !== undefined) attempt.commentary = progress.commentary;
      if (progress.artifacts) attempt.artifacts = copy(progress.artifacts);
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
        if (changed && draft.conversation.room) {
          draft.conversation.room.state = 'paused';
          checkpointRoom(draft, this.now(), '运行时恢复：请核对已产生的文件与成果，再继续工作。');
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
    let settledWithoutExecution = false;
    const snapshot = this.mutate(conversationId, (draft) => {
      const task = this.task(draft, taskId);
      const attempt = currentAttempt(draft, task);
      if (attempt.status !== 'queued') return false;
      if ((task.conversationPlanning || task.conversationPlanTaskId || task.conversationRecovery) && ['paused', 'pausing', 'completed'].includes(draft.conversation.room?.state ?? '')) { attempt.waitReason = 'room_paused'; return true; }
      if (draft.conversation.room && isRoomWork(task) && !isCurrentRoomWork(draft, task)) return false;
      const member = this.member(draft, task.assigneeMemberId);
      const origin = this.message(draft, task.originMessageId);
      const peerMessage = Boolean(task.handoff || task.consultation || origin.deliveryMode === 'handoff' && this.member(draft, origin.senderMemberId).kind !== 'user');
      const dependencies = task.dependsOnTaskIds.map((id) => currentAttempt(draft, this.task(draft, id)));
      let waitReason: CollaborationAttempt['waitReason'];
      if (draft.conversation.room && isRoomWork(task) && ['paused', 'pausing', 'completed'].includes(draft.conversation.room.state)) waitReason = 'room_paused';
      else if (!member.active) waitReason = 'member_removed';
      else if (attempt.awaitingPeerTaskIds?.some(id => !TERMINAL.has(currentAttempt(draft, this.task(draft, id)).status))) waitReason = 'peer_reply';
      else if (peerMessage && !this.groupMessageAllowed(draft, this.member(draft, origin.senderMemberId), member)) waitReason = 'member_removed';
      else if (this.pendingDependencyBlocked(draft, task) || dependencies.some((dependency) => TERMINAL.has(dependency.status) && dependency.status !== 'succeeded')) {
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
      if (waitReason === 'dependency_failed' && !task.pendingAssignment || peerMessage && waitReason === 'member_removed') {
        settledWithoutExecution = true;
        attempt.status = 'failed'; attempt.waitReason = waitReason; attempt.updatedAt = this.now(); attempt.finishedAt = this.now();
        attempt.error = waitReason === 'member_removed'
          ? task.consultation
            ? this.error('consultation_unavailable', 'permission', '咨询成员已移除或群内咨询已关闭；请求者将收到失败原因。', false)
            : this.error('chat_recipient_unavailable', 'permission', '聊天接收者已移除或群内沟通已关闭；本次转达已停止。', false)
          : this.error('dependency_failed', 'execution', '前置任务未交付，当前阶段未启动。重试前置任务后将自动恢复。', true);
        this.completeDeliveries(draft, attempt); this.deliverResult(draft, task, attempt); this.queueSummaries(draft);
        return true;
      }
      if (!waitReason && task.pendingAssignment &&
        !this.withinLoopBudget(draft, task.pendingAssignment)) waitReason = 'loop_limit';
      if (waitReason) {
        if (task.pendingAssignment && draft.conversation.room) task.workStatus = 'waiting';
        if (attempt.waitReason === waitReason) return false;
        attempt.waitReason = waitReason;
        attempt.updatedAt = this.now();
        return true;
      }
      if (task.pendingAssignment) {
        const pending = task.pendingAssignment;
        const assignment = this.appendMessage(draft, {
          senderMemberId: pending.senderMemberId, recipientMemberIds: [member.id],
          mentions: [{ memberId: member.id, label: member.name }], kind: 'task_assignment',
          blocks: [{ type: 'text', text: task.instructions }], expectsResponse: true,
          replyToMessageId: task.returnTo.replyToMessageId,
          correlationId: pending.correlationId, causationId: pending.causationMessageId,
          hopCount: pending.hopCount, taskId: task.id, attemptId: attempt.id,
        });
        task.originMessageId = assignment.id;
        this.addDelivery(draft, assignment, task.assigneeMemberId, 'queued', attempt.id);
        delete task.pendingAssignment;
      }
      delete attempt.waitReason;
      attempt.status = 'running';
      attempt.ownerId = this.ports.ownerId;
      attempt.startedAt = this.now();
      attempt.heartbeatAt = this.now();
      attempt.updatedAt = this.now();
      attempt.contextSequence = task.kind === 'reply' && !attempt.resumeFromAttemptId && !task.conversationPlanTaskId && !task.conversationRecovery ? this.message(draft, task.originMessageId).sequence : draft.messages.at(-1)?.sequence ?? 0;
      attempt.resourceClaims = claims;
      attempt.observation = 'normal';
      task.resourceClaims = claims;
      if (draft.conversation.room) {
        task.workStatus = task.purpose === 'discussion' ? undefined : 'in_progress';
        attempt.contextManifest = roomContextSelection(draft, task, attempt).manifest;
      }
      for (const delivery of draft.deliveries) {
        if (delivery.attemptId === attempt.id && delivery.status === 'queued') delivery.status = 'processing';
      }
      attemptId = attempt.id;
      return true;
    });
    if (settledWithoutExecution) this.schedulePump(snapshot.conversation.workspaceId);
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
        snapshot: collaborationSnapshotForMember(snapshot, task.assigneeMemberId, task.conversationPlanning === true), task: copy(task), attempt: copy(attempt), signal: controller.signal,
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
      // A successful final result is authoritative, even when it clears a reclassified prefix.
      if (result.output || (!result.error && !execution.stopReason && attempt.status !== 'stopping')) attempt.output = result.output;
      if (result.artifacts) attempt.artifacts = copy(result.artifacts);
      if (result.runId) attempt.runId = result.runId;
      if (result.threadId) attempt.threadId = result.threadId;
      if (execution.stopReason === 'timeout') {
        attempt.status = 'failed';
        attempt.error = this.error('task_timeout', 'timeout', '任务已超过执行时限。', true);
      } else if (execution.stopReason === 'pause' || attempt.pauseRequested) {
        attempt.status = 'interrupted';
        attempt.error = this.error('room_paused', 'recovery', '任务群已暂停；已保存输出和产物，继续时先核对现有工作。', true);
      } else if (execution.stopReason === 'shutdown') {
        attempt.status = 'interrupted';
        attempt.error = this.error('runtime_stopped', 'recovery', '执行进程已停止。', true);
      } else if (execution.stopReason === 'cancel' || attempt.status === 'stopping') {
        attempt.status = 'cancelled';
        delete attempt.error;
      } else if (result.error) {
        attempt.status = 'failed';
        attempt.error = result.error;
      } else if (draft.tasks.some(t => t.consultation?.requesterAttemptId === attempt.id)) {
        attempt.status = 'succeeded'; attempt.finishedAt = this.now(); attempt.updatedAt = this.now();
        const next = this.newAttempt(draft, task, attempt.number + 1);
        next.resumeFromAttemptId = attempt.id;
        next.awaitingPeerTaskIds = draft.tasks.filter(t => t.consultation?.requesterAttemptId === attempt.id).map(t => t.id);
        next.waitReason = 'peer_reply';
        task.currentAttemptId = next.id; task.workStatus = 'waiting'; draft.attempts.push(next);
        for (const delivery of draft.deliveries.filter(d => d.attemptId === attempt.id && d.messageId === task.originMessageId)) {
          delivery.attemptId = next.id; delivery.status = 'queued'; delete delivery.error;
        }
        if (draft.conversation.room) checkpointRoom(draft, this.now());
        return true;
      } else if (draft.conversation.room && task.purpose === 'coordination' && !task.handoff && !attempt.workHandoff && !draft.tasks.some(t => t.parentTaskId === task.id && t.id !== task.id) && !draft.tasks.some(t => t.rootTaskId === task.rootTaskId && t.purpose === 'work' && currentAttempt(draft, t).status === 'succeeded')) {
        attempt.status = 'failed';
        attempt.error = this.error('coordination_no_progress', 'execution', '协调轮已结束，但没有实际派工或可验收成果。请查看执行详情，核对工具参数、资料及权限后重试。', true);
      } else if (task.deliverable && !attempt.artifacts?.some(a => a.attemptId === attempt.id && a.taskId === task.id && a.kind === task.deliverable!.kind)) {
        attempt.status = 'failed';
        attempt.error = this.error('deliverable_missing', 'execution', '执行已结束，但约定产物尚未提交；请查看轨迹后重试。', true);
      } else {
        attempt.status = 'succeeded';
        delete attempt.error;
      }
      attempt.updatedAt = this.now();
      attempt.finishedAt = this.now();
      this.completeDeliveries(draft, attempt);
      if (task.conversationPlanning && (attempt.status === 'succeeded' || attempt.status === 'failed' && (!execution.stopReason || execution.stopReason === 'timeout'))) {
        if (attempt.status === 'failed') attempt.output = '';
        this.commitConversationPlan(draft, task, attempt);
      }
      this.deliverResult(draft, task, attempt);
      if (attempt.status === 'succeeded' && !task.conversationPlanning && !task.consultation && task.kind === 'reply' && !attempt.chatDeliveryMessageId && draft.conversation.policy.coordinateDiscussion) this.queuePublicConversationHandoffs(draft, task, attempt);
      if (task.conversationPlanTaskId && attempt.status === 'failed' && (!execution.stopReason || execution.stopReason === 'timeout')) this.queueConversationRecovery(draft, task, attempt);
      this.commitWorkHandoff(draft, task, attempt);
      if (draft.conversation.room && (isRoomWork(task) || task.conversationPlanning || task.conversationPlanTaskId || task.conversationRecovery)) {
        if (isRoomWork(task)) task.workStatus = attempt.status === 'succeeded' ? 'in_review' : 'waiting';
        if (draft.conversation.room.state === 'pausing' && !draft.tasks.some(t => (isRoomWork(t) || t.conversationPlanning || t.conversationPlanTaskId || t.conversationRecovery) && ACTIVE.has(currentAttempt(draft, t).status))) draft.conversation.room.state = 'paused';
        checkpointRoom(draft, this.now());
      }
      this.queueSummaries(draft);
      return true;
    });
  }

  private queuePublicConversationHandoffs(draft: CollaborationSnapshot, source: CollaborationTask, attempt: CollaborationAttempt): void {
    if (['paused', 'pausing', 'completed'].includes(draft.conversation.room?.state ?? '')) return;
    const origin = draft.messages.find(m => m.attemptId === attempt.id && m.kind === 'chat');
    if (!origin || origin.visibility === 'private') return;
    for (const id of publicConversationHandoffs(attempt.output, draft, source.assigneeMemberId)) {
      if (!this.groupMessageAllowed(draft, this.member(draft, source.assigneeMemberId), this.member(draft, id))) continue;
      if (draft.tasks.some(t => t.rootTaskId === source.rootTaskId && t.assigneeMemberId === id && ['queued', 'running', 'waiting_input'].includes(currentAttempt(draft, t).status))) continue;
      if (origin.hopCount >= draft.conversation.policy.maxMessageHops || draft.tasks.filter(t => t.rootTaskId === source.rootTaskId).length >= draft.conversation.policy.maxAutoMessages) break;
      const task = this.addTask(draft, origin, { assigneeMemberId: id, title: '群内交接 · ' + this.member(draft, id).name,
        instructions: '原始群聊请求：' + source.instructions + '\n直接交接消息：' + attempt.output, purpose: 'discussion' }, 'reply', source.rootTaskId, source.id);
      task.conversationPlanTaskId = source.conversationPlanTaskId ?? source.id;
    }
  }

  private commitConversationPlan(draft: CollaborationSnapshot, planner: CollaborationTask, attempt: CollaborationAttempt): void {
    if (['paused', 'pausing', 'completed'].includes(draft.conversation.room?.state ?? '') || draft.receipts['conversation-plan:' + planner.id]) return;
    let plan: import('./collaboration-group-planning.js').GroupConversationPlan;
    try {
      plan = parseGroupConversationPlan(attempt.output, draft);
      if (plan.memberIds.length > draft.conversation.policy.maxAutoMessages || plan.memberIds.some(id => !this.groupMessageAllowed(draft, this.member(draft, draft.conversation.coordinatorMemberId), this.member(draft, id)))) throw new Error('collaboration.conversation_plan_budget');
    }
    catch {
      // An invalid routing answer is not a worker's answer. Fall back once to a
      // real coordinator contribution, rather than exposing JSON or guessing a roster.
      plan = { mode: 'single' as const, memberIds: [draft.conversation.coordinatorMemberId] };
      attempt.commentary = '协调计划格式未通过校验，交由协调员直接回应本次请求。';
    }
    const origin = this.message(draft, planner.originMessageId);
    const existing = draft.tasks.filter(t => t.conversationPlanTaskId === planner.id);
    if (existing.length) return;
    let previous: string | undefined;
    for (const memberId of plan.memberIds) {
      if (!this.groupMessageAllowed(draft, this.member(draft, draft.conversation.coordinatorMemberId), this.member(draft, memberId))) throw new Error('collaboration.group_messages_disabled');
      const task = this.addTask(draft, origin, { assigneeMemberId: memberId, title: '群聊贡献 · ' + this.member(draft, memberId).name,
        instructions: groupContributionInstructions(draft, planner, memberId, plan.assignments?.[memberId]), purpose: 'discussion',
        dependsOnTaskIds: plan.mode === 'sequential' && previous ? [previous] : [] }, 'reply', planner.rootTaskId, planner.id);
      task.conversationPlanTaskId = planner.id;
      if (memberId === draft.conversation.coordinatorMemberId && planner.conversationPlanningIntent === 'chat') task.workflowStartAllowed = true;
      previous = task.id;
    }
    draft.receipts['conversation-plan:' + planner.id] = JSON.stringify({ mode: plan.mode, memberIds: plan.memberIds });
    attempt.output = ''; // Routing JSON is host state, not a public chat bubble.
  }

  private queueConversationRecovery(draft: CollaborationSnapshot, failed: CollaborationTask, attempt: CollaborationAttempt): void {
    const key = 'conversation-recovery:' + failed.conversationPlanTaskId;
    if (draft.receipts[key] || ['paused', 'pausing', 'completed'].includes(draft.conversation.room?.state ?? '')) return;
    draft.receipts[key] = failed.id;
    const origin = this.message(draft, failed.originMessageId);
    const remaining = draft.tasks.filter(t => t.conversationPlanTaskId === failed.conversationPlanTaskId && currentAttempt(draft, t).status === 'queued');
    for (const task of remaining.filter(t => t.dependsOnTaskIds.length > 0)) {
      const pending = currentAttempt(draft, task); pending.status = 'cancelled'; pending.updatedAt = pending.finishedAt = this.now();
      this.completeDeliveries(draft, pending);
    }
    const recovery = this.addTask(draft, origin, { assigneeMemberId: draft.conversation.coordinatorMemberId, purpose: 'discussion', title: '协调成员阻塞',
      instructions: '尚未发言的计划成员：' + remaining.map(t => this.member(draft, t.assigneeMemberId).name).join('、') + '\n本次请求中成员 ' + this.member(draft, failed.assigneeMemberId).name + ' 未完成自己的贡献。原始目标：' + groupContributionInstructions(draft, failed, draft.conversation.coordinatorMemberId) +
        '\n请读取本群当前消息与进度，说明阻塞和仍需完成的部分。不得冒充该成员发言、重复已完成成果、自动重做可能有外部效果的操作。必要时通过群内 handoff 请求合适成员补充，或询问用户；这是一次有界协调。错误分类：' + (attempt.error?.code ?? 'execution_failed') }, 'reply', failed.rootTaskId, failed.id);
    recovery.conversationRecovery = true;
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

  private pendingDependencyBlocked(draft: CollaborationSnapshot, task: CollaborationTask): boolean {
    if (!task.pendingAssignment) return false;
    const seen = new Set<string>();
    const blocked = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const dependency = draft.tasks.find(item => item.id === id);
      if (!dependency) return false;
      const attempt = currentAttempt(draft, dependency);
      return TERMINAL.has(attempt.status) && attempt.status !== 'succeeded' ||
        Boolean(dependency.pendingAssignment && dependency.dependsOnTaskIds.some(blocked));
    };
    return task.dependsOnTaskIds.some(blocked);
  }

  private queueSummaries(draft: CollaborationSnapshot): void {
    if (draft.conversation.room) { this.queueRoomFollowups(draft); return; }
    const roots = new Set(draft.tasks.filter((task) => task.kind === 'task').map((task) => task.rootTaskId));
    for (const root of roots) {
      const tasks = draft.tasks.filter((task) => task.rootTaskId === root && task.kind === 'task');
      const attempts = tasks.map((task) => currentAttempt(draft, task));
      if (!attempts.length || tasks.some((task, index) => !TERMINAL.has(attempts[index]!.status) && !this.pendingDependencyBlocked(draft, task))) continue;
      const signature = fingerprint(attempts.map((attempt) => `${attempt.id}:${attempt.status}`).sort());
      const receipt = `summary:${root}:${signature}`;
      if (draft.receipts[receipt]) continue;
      const rootTask = this.task(draft, root);
      const origin = this.message(draft, rootTask.originMessageId);
      const coordinator = this.member(draft, rootTask.coordinatorMemberId ?? draft.conversation.coordinatorMemberId);
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
          '汇总以下任务的真实结果，区分成功、失败、中断、取消和尚未派工；尚未派工的后续计划等待前置交付，不等于执行失败。仅总结，不重新执行任务。',
          ...tasks.map((task, index) => JSON.stringify({
            taskId: task.id, title: task.title, assignee: task.assigneeMemberId,
            status: attempts[index]!.status, pendingAssignment: Boolean(task.pendingAssignment), waitReason: attempts[index]!.waitReason, output: attempts[index]!.output, error: attempts[index]!.error,
            artifacts: attempts[index]!.artifacts?.map(({ id, title, path, sha256 }) => ({ id, title, path, sha256 })),
          })),
        ].join('\n'),
      }, 'summary', root, undefined, undefined, rootTask.returnTo.replyToMessageId);
      draft.receipts[receipt] = summary.id;
    }
  }

  private deliverResult(draft: CollaborationSnapshot, task: CollaborationTask, attempt: CollaborationAttempt): void {
    const receipt = `result:${attempt.id}`;
    if (draft.receipts[receipt] || task.pendingAssignment) return;
    if (task.conversationPlanning && attempt.status === 'succeeded') { draft.receipts[receipt] = task.id; return; }
    if (task.kind === 'reply' && task.purpose === 'discussion' && attempt.status === 'succeeded' && attempt.chatDeliveryMessageId) {
      draft.receipts[receipt] = attempt.chatDeliveryMessageId;
      return;
    }
    const origin = this.message(draft, task.originMessageId);
    const user = draft.members.find((member) => member.kind === 'user');
    const handoff = attempt.status === 'succeeded' ? attempt.workHandoff : undefined;
    const recipient = handoff?.recipientMemberId ?? (task.handoff && task.purpose === 'coordination'
      ? task.assigneeMemberId === draft.conversation.coordinatorMemberId ? user?.id : origin.senderMemberId
      : task.kind === 'reply' ? origin.senderMemberId : task.kind === 'task' ? ((task.assigneeMemberId !== task.teamParticipantId ? task.teamParticipantId : undefined) ?? task.coordinatorMemberId ?? draft.conversation.coordinatorMemberId) : user?.id);
    const message = this.appendMessage(draft, {
      visibility: origin.visibility ?? 'public',
      senderMemberId: task.assigneeMemberId,
      recipientMemberIds: recipient ? [recipient] : [], mentions: recipient ? [{ memberId: recipient, label: this.member(draft, recipient).name }] : [],
      kind: task.kind === 'reply' ? 'chat' : 'task_result',
      blocks: [{ type: 'text', text: handoff?.text ?? (attempt.output || attempt.error?.message ||
        (attempt.status === 'cancelled' ? '任务已停止。' : '任务已结束，未返回文本。')) }],
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
    pendingAssignment?: CollaborationTask['pendingAssignment'],
  ): CollaborationTask {
    if (!input.title.trim() || !input.instructions.trim()) throw new Error('collaboration.task_content_required');
    const assignee = this.member(draft, input.assigneeMemberId);
    if (input.teamParticipantId && (assignee.kind === 'team' ? assignee.id : assignee.teamParticipantId) !== input.teamParticipantId) throw new Error('collaboration.invalid_team_scope');
    const timeoutSeconds = input.timeoutSeconds ?? draft.conversation.policy.taskTimeoutSeconds;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) {
      throw new Error('collaboration.invalid_task_timeout');
    }
    const task: CollaborationTask = {
      id, rootTaskId: rootTaskId ?? id, parentTaskId, originMessageId: message.id,
      ...(pendingAssignment ? { pendingAssignment: copy(pendingAssignment) } : {}),
      ...(draft.conversation.room ? { goalRevision: draft.conversation.room.goalRevision, purpose: input.purpose ?? (kind === 'reply' ? 'discussion' : 'work'), workStatus: kind === 'reply' ? undefined : 'open' as const } : {}),
      coordinatorMemberId: draft.tasks.find(task => task.id === parentTaskId)?.coordinatorMemberId ?? draft.conversation.coordinatorMemberId,
      topologyRevision: draft.conversation.topologyRevision ?? 0, teamParticipantId: input.teamParticipantId,
      assigneeMemberId: input.assigneeMemberId, title: input.title.trim(), instructions: input.instructions,
      expectedOutput: input.expectedOutput ?? '', dependsOnTaskIds: [...new Set(input.dependsOnTaskIds ?? [])],
      contextRefs: [...(input.contextRefs ?? [])], resourceClaims: [],
      ...(input.planRef ? { planRef: copy(input.planRef) } : {}),
      ...(input.deliverable ? { deliverable: copy(input.deliverable) } : {}),
      returnTo: { conversationId: draft.conversation.id, replyToMessageId: returnMessageId },
      timeoutSeconds, currentAttemptId: '', kind, createdAt: this.now(),
    };
    const attempt = this.newAttempt(draft, task, 1);
    task.currentAttemptId = attempt.id;
    if (pendingAssignment) {
      attempt.waitReason = 'dependency';
      if (draft.conversation.room) task.workStatus = 'waiting';
    } else {
      message.taskId = task.id;
      message.attemptId = attempt.id;
      this.addDelivery(draft, message, input.assigneeMemberId, 'queued', attempt.id);
    }
    draft.tasks.push(task);
    draft.attempts.push(attempt);
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
    // Storage has one delivery per message/recipient. Recovery or a new turn
    // on the same original request advances that delivery to the new attempt;
    // prior attempts remain immutable history, as with an explicit retry.
    const existing = draft.deliveries.find(d => d.messageId === message.id && d.recipientMemberId === recipientMemberId);
    if (existing) {
      existing.status = status; existing.attemptId = attemptId; delete existing.error;
    } else draft.deliveries.push({ id: this.id(), messageId: message.id, recipientMemberId, status, attemptId });
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
      if (!this.groupMessageAllowed(draft, sender, member)) throw new Error('collaboration.group_messages_disabled');
      return member;
    });
  }

  private groupMessageAllowed(draft: CollaborationSnapshot, sender: CollaborationMember, recipient: CollaborationMember): boolean {
    return sender.kind === 'user' || recipient.kind === 'user' || sender.id === recipient.id ||
      sender.id === draft.conversation.coordinatorMemberId || recipient.id === draft.conversation.coordinatorMemberId ||
      recipient.teamParticipantId === sender.id || (draft.conversation.policy.allowGroupMessages ?? draft.conversation.policy.allowPeerDirect);
  }

  private withinLoopBudget(
    draft: CollaborationSnapshot,
    message: Pick<CollaborationMessage, 'correlationId' | 'hopCount'>,
    additional = 0,
  ): boolean {
    // Frozen DAG assignments/results have a separate 64-node admission bound.
    // Counting them as peer chatter would suppress a valid multi-team summary.
    const automaticCount = draft.messages.filter((item) => item.sequence > (draft.conversation.room?.autoContinueAfterSequence ?? 0) && item.correlationId === message.correlationId &&
      item.kind !== 'task_assignment' && item.kind !== 'task_result' &&
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
    if ((policy.networkEnabled !== undefined && typeof policy.networkEnabled !== 'boolean') || (policy.coordinateDiscussion !== undefined && typeof policy.coordinateDiscussion !== 'boolean') || typeof policy.allowPeerDirect !== 'boolean' || (policy.allowGroupMessages !== undefined && typeof policy.allowGroupMessages !== 'boolean')) throw new Error('collaboration.invalid_policy');
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
      draft.conversation.policy = { ...DEFAULT_COLLABORATION_CHAT_POLICY, ...draft.conversation.policy,
        allowGroupMessages: draft.conversation.policy.allowGroupMessages ?? draft.conversation.policy.allowPeerDirect };
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
    setImmediate(() => {
      this.scheduledWorkspaces.delete(workspaceId);
      void this.pump(workspaceId).catch((error) => this.reportError(error));
    });
  }

  private member(snapshot: CollaborationSnapshot, id: string): CollaborationMember {
    const member = snapshot.members.find((item) => item.id === id);
    if (!member) throw new Error('collaboration.member_missing' + (snapshot.conversation.room ? ':' + taskRoomMemberHint(snapshot) : ''));
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
