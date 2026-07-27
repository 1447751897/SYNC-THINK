import type { Event } from '@sync-think/shared';

export interface ConversationStreamDraft {
  runId?: string;
  text: string;
  reasoningText?: string;
  timestamp: string;
}

export type ConversationStreamOperation =
  | {
      type: 'text.delta' | 'reasoning.delta';
      runId?: string;
      delta: string;
      occurredAt: string;
      sequence: number;
    }
  | {
      type: 'run.terminal';
      runId?: string;
      sequence: number;
    };

export interface ConversationStreamBatch {
  maxSeenSequence: number;
  sawTerminalEvent: boolean;
  operations: ConversationStreamOperation[];
}

function belongsToConversation(
  event: Event,
  threadId: string,
  taskId?: string,
): boolean {
  const eventThread =
    typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
  if (eventThread) return eventThread === threadId;
  return !(taskId && event.taskId && event.taskId !== taskId);
}

/**
 * Collect newly observed stream operations while advancing a global durable-event cursor.
 * The cursor intentionally advances past unrelated conversations because event sequence is global.
 */
export function collectConversationStreamBatch(input: {
  events: readonly Event[];
  afterSequence: number;
  threadId: string;
  taskId?: string;
}): ConversationStreamBatch {
  let maxSeenSequence = input.afterSequence;
  let sawTerminalEvent = false;
  const operations: ConversationStreamOperation[] = [];
  const ordered = input.events
    .filter((event) => event.sequence > input.afterSequence)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));

  for (const event of ordered) {
    maxSeenSequence = Math.max(maxSeenSequence, event.sequence);
    if (!belongsToConversation(event, input.threadId, input.taskId)) continue;

    if (event.type === 'message.delta') {
      const delta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.delta === 'string'
            ? event.payload.delta
            : '';
      if (delta) {
        operations.push({
          type: 'text.delta',
          runId: event.runId,
          delta,
          occurredAt: event.occurredAt,
          sequence: event.sequence,
        });
      }
      continue;
    }

    if (event.type === 'message.reasoning_delta') {
      const delta =
        typeof event.payload.reasoningDelta === 'string'
          ? event.payload.reasoningDelta
          : typeof event.payload.textDelta === 'string'
            ? event.payload.textDelta
            : typeof event.payload.delta === 'string'
              ? event.payload.delta
              : '';
      if (delta) {
        operations.push({
          type: 'reasoning.delta',
          runId: event.runId,
          delta,
          occurredAt: event.occurredAt,
          sequence: event.sequence,
        });
      }
      continue;
    }

    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled'
    ) {
      sawTerminalEvent = true;
      operations.push({
        type: 'run.terminal',
        runId: event.runId,
        sequence: event.sequence,
      });
    }
  }

  return { maxSeenSequence, sawTerminalEvent, operations };
}

/** Apply operations in event order so a completed historical run cannot leak into a newer draft. */
export function applyConversationStreamOperations(
  current: ConversationStreamDraft | null,
  operations: readonly ConversationStreamOperation[],
): ConversationStreamDraft | null {
  let draft = current;

  for (const operation of operations) {
    if (operation.type === 'run.terminal') {
      if (
        draft &&
        (!operation.runId || !draft.runId || operation.runId === draft.runId)
      ) {
        draft = null;
      }
      continue;
    }

    // A delta for another run starts a fresh draft instead of appending to stale text.
    if (draft && operation.runId && draft.runId && operation.runId !== draft.runId) {
      draft = null;
    }
    const base: ConversationStreamDraft = draft ?? {
      runId: operation.runId,
      text: '',
      timestamp: operation.occurredAt,
    };
    draft = {
      ...base,
      runId: base.runId ?? operation.runId,
      text: operation.type === 'text.delta' ? base.text + operation.delta : base.text,
      reasoningText:
        operation.type === 'reasoning.delta'
          ? (base.reasoningText ?? '') + operation.delta
          : base.reasoningText,
      timestamp: operation.occurredAt,
    };
  }

  return draft;
}
