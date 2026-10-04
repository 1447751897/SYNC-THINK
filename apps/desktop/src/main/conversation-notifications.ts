import type { Event } from '@sync-think/shared';
import { attentionRequest, ConversationAttentionIndex } from '../conversation-attention.js';
import {
  DEFAULT_CONVERSATION_NOTIFICATION_PREFERENCES,
  type ConversationNotice,
  type ConversationNotificationPreferences,
} from '../conversation-notification-contract.js';

interface NotificationConversation {
  id: string;
  taskId?: string;
  title?: string;
  archivedAt?: string;
}
export interface ConversationNotificationHost {
  listConversations(): Promise<readonly NotificationConversation[]>;
  publish(notice: ConversationNotice): void;
  isFocused(): boolean;
  show(notice: ConversationNotice, silent: boolean): void;
  now?(): number;
}
/** Runs on IPC event delivery, not requestAnimationFrame (which stops when hidden). */
export class ConversationNotifications {
  private index = new ConversationAttentionIndex();
  private seen = new Set<string>();
  private startedAt: number;
  private preferences = { ...DEFAULT_CONVERSATION_NOTIFICATION_PREFERENCES };
  constructor(private host: ConversationNotificationHost) {
    this.startedAt = (host.now ?? Date.now)();
  }
  setPreferences(preferences: ConversationNotificationPreferences): void {
    this.preferences = { ...preferences };
  }
  ingest(events: readonly Event[]): void {
    this.index.ingest(events);
    const candidates = events.filter(
      (event) =>
        attentionRequest(event) || event.type === 'run.completed' || event.type === 'run.failed',
    );
    for (const event of candidates) {
      const request = attentionRequest(event);
      const runId = String(event.runId ?? event.payload.runId ?? '');
      const id = request
        ? `${request.key}:${event.type === 'conversation.plan_submitted' ? String(event.payload.revision ?? event.sequence) : ''}`
        : `${event.type}:${runId || event.id}`;
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      // Runtime subscriptions replay old events, including after reconnect. Restore
      // their status, but never turn them into fresh desktop notifications.
      const occurredAt = Date.parse(event.occurredAt);
      if (!Number.isFinite(occurredAt) || occurredAt < this.startedAt) continue;
      void this.deliver(event, id).catch(() => {
        /* Notifications must not interrupt execution. */
      });
    }
  }
  private async deliver(event: Event, id: string): Promise<void> {
    const conversations = await this.host.listConversations();
    const conversation = conversations.find((c) => !c.archivedAt && this.index.matches(event, c));
    if (!conversation) return;
    const request = attentionRequest(event);
    const runId = String(event.runId ?? event.payload.runId ?? '');
    if (request) {
      if (!this.index.has(request.key, request.sequence)) return;
    } else {
      if (runId && this.index.terminal(runId)?.sequence !== event.sequence) return;
      if (event.type === 'run.completed' && this.index.forConversation(conversation).length) return;
      if (event.type === 'run.completed' && !this.preferences.completed) return;
    }
    const notice: ConversationNotice = {
      id,
      conversationId: String(conversation.id),
      title: conversation.title?.trim() || '模型对话',
      kind: request?.kind ?? (event.type === 'run.failed' ? 'failed' : 'completed'),
      ...(request ? { requestKey: request.key } : {}),
    };
    const focused = this.host.isFocused();
    notice.foreground = focused;
    this.host.publish(notice);
    if (!focused) this.host.show(notice, !this.preferences.sound);
  }
}
