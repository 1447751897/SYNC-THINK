import type { Event } from '@sync-think/shared';

// Server-pushed event stream (embodied as Frame kind='event'). Subscriptions
// carry a cursor and atomically return durable catch-up events before live
// delivery begins, so reconnecting clients cannot miss the handoff boundary.

export interface EventReplayPagePayload {
  streamId: string;
  /** Durable events in this bounded page, ordered by sequence. */
  replayedEvents: Event[];
  /** Global sequence fully scanned by this page, including filtered events. */
  nextCursor: number;
  /** Fixed sequence captured when the subscription began. */
  highWatermark: number;
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
}
