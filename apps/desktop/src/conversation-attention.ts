import type { Event } from '@sync-think/shared';

export type ConversationAttentionKind = 'answer' | 'approval' | 'desktop';
export interface ConversationAttention {
  key: string;
  kind: ConversationAttentionKind;
  label: string;
  sequence: number;
  event: Event;
  conversationId?: string;
  taskId?: string;
  threadId?: string;
  runId?: string;
  /** Formal plans outlive the planning run; other requests are run-scoped. */
  persistent: boolean;
}
export interface ConversationActivityView {
  running: boolean;
  unread: boolean;
  attention?: ConversationAttentionKind;
  failed?: boolean;
}
export const ATTENTION_LABELS: Record<ConversationAttentionKind, string> = {
  answer: '等你回答',
  approval: '等你审批',
  desktop: '等你处理',
};
const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.paused']);
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function requestKey(event: Event): string | undefined {
  const p = event.payload;
  if (event.type.startsWith('conversation.ask_')) return text(p.askId) && `ask:${p.askId}`;
  if (event.type.startsWith('tool.approval_') || event.type.startsWith('approval.'))
    return text(p.approvalId) && `approval:${p.approvalId}`;
  if (event.type.startsWith('conversation.plan_'))
    return text(p.conversationId) && `plan:${p.conversationId}`;
  if (event.type.startsWith('desktop.command.'))
    return text(p.commandId) && `desktop:${p.commandId}`;
  return undefined;
}
export function attentionRequest(event: Event): ConversationAttention | undefined {
  const questions = event.payload.questions;
  const planReview =
    Array.isArray(questions) &&
    questions.length === 1 &&
    questions[0]?.intent?.kind === 'plan-review';
  const kind: ConversationAttentionKind | undefined =
    event.type === 'conversation.ask_pending'
      ? planReview
        ? 'approval'
        : 'answer'
      : ['tool.approval_requested', 'approval.requested', 'conversation.plan_submitted'].includes(
            event.type,
          )
        ? 'approval'
        : event.type === 'desktop.command.waiting_user'
          ? 'desktop'
          : undefined;
  const key = requestKey(event);
  if (!kind || !key) return undefined;
  return {
    key,
    kind,
    label: ATTENTION_LABELS[kind],
    sequence: event.sequence,
    event,
    conversationId: text(event.payload.conversationId),
    taskId: text(event.taskId) ?? text(event.payload.taskId),
    threadId: text(event.payload.threadId),
    runId: text(event.runId) ?? text(event.payload.runId),
    persistent:
      event.type === 'conversation.plan_submitted' ||
      event.type === 'desktop.command.waiting_user' ||
      (event.type === 'approval.requested' && event.payload.action === 'browser.handoff'),
  };
}
const RESOLVED_TYPES = new Set([
  'conversation.ask_answered',
  'conversation.ask_cancelled',
  'tool.approval_decided',
  'approval.decided',
  'conversation.plan_approved',
  'conversation.plan_revised',
  'conversation.plan_cancelled',
  'desktop.command.continued',
  'desktop.command.cancelled',
]);

/** Shared by the main-process notifier and the renderer; independent of mounted chats. */
export class ConversationAttentionIndex {
  private requests = new Map<string, ConversationAttention>();
  private revisions = new Map<string, number>();
  private terminalRuns = new Map<string, { sequence: number; type: string; event: Event }>();
  private threadsByTask = new Map<string, string>();
  private tasksByRun = new Map<string, string>();
  private threadsByRun = new Map<string, string>();

  ingest(events: readonly Event[]): void {
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
      const taskId = text(event.taskId) ?? text(event.payload.taskId);
      const threadId = text(event.payload.threadId);
      const runId = text(event.runId) ?? text(event.payload.runId);
      if (taskId && threadId) this.threadsByTask.set(taskId, threadId);
      if (runId && taskId) this.tasksByRun.set(runId, taskId);
      if (runId && threadId) this.threadsByRun.set(runId, threadId);
      if (runId && TERMINAL_TYPES.has(event.type)) {
        const previous = this.terminalRuns.get(runId);
        if (!previous || previous.sequence < event.sequence) {
          this.terminalRuns.set(runId, { sequence: event.sequence, type: event.type, event });
          for (const [key, request] of this.requests) {
            if (request.runId === runId && !request.persistent) {
              this.requests.delete(key);
              this.revisions.set(key, Math.max(event.sequence, this.revisions.get(key) ?? -1));
            }
          }
        }
      }
      if (
        event.type === 'browser.handoff.continued' ||
        event.type === 'browser.handoff.cancelled'
      ) {
        for (const [key, request] of this.requests) {
          if (
            request.event.payload.action === 'browser.handoff' &&
            request.runId === runId &&
            request.sequence < event.sequence
          ) {
            this.requests.delete(key);
            this.revisions.set(key, event.sequence);
          }
        }
      }
      const key = requestKey(event);
      if (!key || (!RESOLVED_TYPES.has(event.type) && !attentionRequest(event))) continue;
      if ((this.revisions.get(key) ?? -1) >= event.sequence) continue;
      this.revisions.set(key, event.sequence);
      const request = attentionRequest(event);
      if (
        request &&
        (!request.runId || request.persistent || !this.terminalRuns.has(request.runId))
      ) {
        this.requests.set(key, request);
      } else {
        this.requests.delete(key);
      }
    }
  }
  has(key: string, sequence?: number): boolean {
    const request = this.requests.get(key);
    return !!request && (sequence === undefined || request.sequence === sequence);
  }
  resolvedSince(key: string, sequence: number): boolean {
    return !this.requests.has(key) && (this.revisions.get(key) ?? -1) >= sequence;
  }
  terminal(runId: string): { sequence: number; type: string } | undefined {
    return this.terminalRuns.get(runId);
  }
  lastFinished(conversation: { id: string; taskId?: string }): Event | undefined {
    return [...this.terminalRuns.values()]
      .filter((item) => this.matches(item.event, conversation))
      .sort((a, b) => b.sequence - a.sequence)[0]?.event;
  }
  matches(event: Event, conversation: { id: string; taskId?: string }): boolean {
    const conversationId = text(event.payload.conversationId);
    if (conversationId) return conversationId === String(conversation.id);
    const runId = text(event.runId) ?? text(event.payload.runId);
    const taskId =
      text(event.taskId) ??
      text(event.payload.taskId) ??
      (runId ? this.tasksByRun.get(runId) : undefined);
    if (taskId && taskId === String(conversation.taskId)) return true;
    const threadId =
      text(event.payload.threadId) ?? (runId ? this.threadsByRun.get(runId) : undefined);
    const conversationThread =
      this.threadsByTask.get(String(conversation.taskId)) ??
      (conversation.taskId?.startsWith('task-from-thread:')
        ? conversation.taskId.slice(17)
        : undefined);
    return !!threadId && threadId === conversationThread;
  }
  forConversation(conversation: { id: string; taskId?: string }): ConversationAttention[] {
    return [...this.requests.values()]
      .filter((request) => this.matches(request.event, conversation))
      .sort(
        (a, b) =>
          (a.kind === 'answer' ? 0 : 1) - (b.kind === 'answer' ? 0 : 1) || b.sequence - a.sequence,
      );
  }
}

export function buildConversationAttention(
  events: readonly Event[],
  conversations: readonly { id: string; taskId?: string }[],
): Map<string, ConversationAttention[]> {
  const index = new ConversationAttentionIndex();
  index.ingest(events);
  return new Map(
    conversations.map((conversation) => [
      String(conversation.id),
      index.forConversation(conversation),
    ]),
  );
}
