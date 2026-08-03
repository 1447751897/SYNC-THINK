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

const RUN_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

export function isRunTerminalEventType(type: string): boolean {
  return RUN_TERMINAL_EVENT_TYPES.has(type);
}

export interface RunPauseNotice {
  id: string;
  runId?: string;
  text: string;
  timestamp: string;
  tone: 'warning' | 'error';
}

export interface ConversationRunActivity {
  streaming: boolean;
  activeRunId?: string;
}

export function belongsToConversation(event: Event, threadId: string, taskId?: string): boolean {
  const eventThread =
    typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
  if (eventThread) return eventThread === threadId;
  return !(taskId && event.taskId && event.taskId !== taskId);
}

export function projectConversationRunActivity(input: {
  events: readonly Event[];
  threadId: string;
  taskId?: string;
}): ConversationRunActivity {
  const startedRuns = new Map<string, number>();
  const endedRuns = new Set<string>();
  for (const event of input.events) {
    if (!belongsToConversation(event, input.threadId, input.taskId) || !event.runId) continue;
    if (event.type === 'run.started') {
      startedRuns.set(event.runId, event.sequence);
    } else if (isRunTerminalEventType(event.type)) {
      endedRuns.add(event.runId);
    }
  }

  let activeRunId: string | undefined;
  let activeSequence = Number.NEGATIVE_INFINITY;
  for (const [runId, sequence] of startedRuns) {
    if (!endedRuns.has(runId) && sequence > activeSequence) {
      activeRunId = runId;
      activeSequence = sequence;
    }
  }
  return { streaming: Boolean(activeRunId), activeRunId };
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

    if (isRunTerminalEventType(event.type)) {
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
      if (draft && (!operation.runId || !draft.runId || operation.runId === draft.runId)) {
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

function formatRunPauseNotice(event: Event): RunPauseNotice {
  const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'paused';
  const failureClass =
    typeof event.payload.failureClass === 'string' ? event.payload.failureClass : undefined;
  const errorMessage =
    typeof event.payload.errorMessage === 'string' ? event.payload.errorMessage.trim() : '';
  const providerModelId =
    typeof event.payload.providerModelId === 'string' ? event.payload.providerModelId.trim() : '';

  const headline =
    reason === 'fallback_exhausted'
      ? '???????????????????????'
      : reason === 'no_fallback_configured'
        ? '??????????????????????????'
        : `????????${reason}??`;
  const details = [
    providerModelId ? `???${providerModelId}` : '',
    failureClass ? `?????${failureClass}` : '',
    errorMessage ? `???${errorMessage}` : '',
  ].filter(Boolean);
  const retryHint =
    reason === 'fallback_exhausted' || reason === 'no_fallback_configured' ? '???????????' : '';

  return {
    id: `run-paused-${String(event.id)}`,
    runId: event.runId,
    text: [headline, details.join('?'), retryHint].filter(Boolean).join(' '),
    timestamp: event.occurredAt,
    tone: failureClass || errorMessage ? 'error' : 'warning',
  };
}

/** Return a notice only while the latest run lifecycle event is run.paused. */
export function selectLatestRunPauseNotice(input: {
  events: readonly Event[];
  threadId: string;
  taskId?: string;
}): RunPauseNotice | undefined {
  let latestLifecycle: Event | undefined;
  for (const event of input.events) {
    if (!belongsToConversation(event, input.threadId, input.taskId)) continue;
    if (event.type !== 'run.started' && !isRunTerminalEventType(event.type)) continue;
    if (
      !latestLifecycle ||
      event.sequence > latestLifecycle.sequence ||
      (event.sequence === latestLifecycle.sequence &&
        event.id.localeCompare(latestLifecycle.id) > 0)
    ) {
      latestLifecycle = event;
    }
  }
  return latestLifecycle?.type === 'run.paused' ? formatRunPauseNotice(latestLifecycle) : undefined;
}
