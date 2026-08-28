import type { Event } from '@sync-think/shared';
import type { ConversationTransientFrame } from './commands.js';

// Server-pushed event stream (embodied as Frame kind='event'). Subscriptions
// carry a cursor and atomically return durable catch-up events before live
// delivery begins, so reconnecting clients cannot miss the handoff boundary.

export interface EventReplayCursor {
  sequence: number;
  /** Stable tie-breaker for legacy rows that share a sequence. */
  eventId: string;
}

export interface EventReplayPagePayload {
  streamId: string;
  /** Durable events in this bounded page, ordered by sequence. */
  replayedEvents: Event[];
  /** Global sequence fully scanned by this page, including filtered events. */
  nextCursor: number;
  /** Tie-breaker for nextCursor when a legacy sequence spans multiple pages. */
  nextEventId?: string;
  /** Fixed sequence captured when the subscription began. */
  highWatermark: number;
  /** Fixed tie-breaker captured with highWatermark. */
  highWatermarkEventId?: string;
  /** True only when nextCursor has reached highWatermark. */
  replayComplete: boolean;
}

export interface EventStreamStartedPayload extends EventReplayPagePayload {
  /** First event sequence the stream can deliver. */
  startingSequence: number;
}

export interface EventStreamEvent {
  streamId: string;
  event: Event;
}

export interface EventStreamClosedPayload {
  streamId: string;
  reason: 'client-requested' | 'cursor-too-old' | 'protocol-error' | 'runtime-shutdown';
  /** Server points client to the next fetchable cursor for durable replay. */
  nextCursor: number;
  nextEventId?: string;
}

/** Live delivery envelope for a conversation-scoped transient output frame. */
export interface ConversationTransientStreamEvent {
  streamId: string;
  frame: ConversationTransientFrame;
}

export interface RunPauseTerminalMessageInput {
  reason?: string;
  failureClass?: string;
  providerModelId?: string;
  errorMessage?: string;
}

/** User-facing terminal reason shared by live projection and durable messages. */
export function formatRunPauseTerminalMessage(input: RunPauseTerminalMessageInput): string {
  const reason = input.reason?.trim() || 'paused';
  const headline =
    reason === 'fallback_exhausted'
      ? '备用模型已全部尝试，任务已暂停。'
      : reason === 'no_fallback_configured'
        ? '当前模型不可用，且没有配置备用模型。'
        : reason === 'recovery_expired'
          ? '历史请求已过期，未自动重新执行。'
          : `任务已暂停（${reason}）。`;
  const details = [
    input.providerModelId?.trim() ? `模型：${input.providerModelId.trim()}` : '',
    input.failureClass?.trim() ? `失败类型：${input.failureClass.trim()}` : '',
    input.errorMessage?.trim() ? `详情：${input.errorMessage.trim()}` : '',
  ].filter(Boolean);
  const retryHint =
    reason === 'fallback_exhausted' || reason === 'no_fallback_configured'
      ? '请切换 Provider、模型或检查连接后重试。'
      : reason === 'recovery_expired'
        ? '请重新发送请求。'
        : '';
  return [headline, details.join('；'), retryHint].filter(Boolean).join(' ');
}
