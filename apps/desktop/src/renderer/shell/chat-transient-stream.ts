import type {
  AssistantTurnSegment,
  CommentaryTimelineSegment,
  ConversationTransientFrame,
  RunProcessView,
} from '@sync-think/protocol';
import type { ConversationStreamDraft, ConversationStreamOperation } from './chat-stream.js';
import {
  applyConversationStreamOperations,
  hasConversationStreamDraftContent,
} from './chat-stream.js';

export interface TransientDraftState {
  draft: ConversationStreamDraft | null;
  lastStreamSequence: number;
  terminal: boolean;
}

export interface TransientFrameBatchOptions {
  maxFrames: number;
  maxTextCharacters: number;
}

export interface TransientFrameBatch {
  frames: ConversationTransientFrame[];
  remaining: ConversationTransientFrame[];
}

export type ConversationDisplayQueueItem =
  | {
      source: 'transient';
      frame: ConversationTransientFrame;
      /** UTF-16 offset already displayed from textDelta. */
      offset: number;
    }
  | {
      source: 'durable';
      operation: ConversationStreamOperation;
      /** UTF-16 offset already displayed from delta. */
      offset: number;
    }
  | {
      source: 'snapshot';
      draft: ConversationStreamDraft | null;
      streamSequence: number;
      process?: RunProcessView;
      refreshDurable?: boolean;
    };

export interface ConversationDisplayQueueBatch {
  operations: ConversationStreamOperation[];
  completed: ConversationDisplayQueueItem[];
  remaining: ConversationDisplayQueueItem[];
}

function operationFromTransientFrame(
  frame: ConversationTransientFrame,
): ConversationStreamOperation | undefined {
  if (frame.kind === 'reasoning') {
    return {
      type: 'reasoning.delta',
      runId: frame.runId,
      delta: frame.textDelta ?? '',
      occurredAt: frame.occurredAt,
      sequence: frame.streamSequence,
      ...(frame.assistantTimeline
        ? { assistantTimeline: frame.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
    };
  }
  if (frame.kind === 'process') {
    return {
      type: 'process.boundary',
      runId: frame.runId,
      occurredAt: frame.occurredAt,
      sequence: frame.streamSequence,
      ...(frame.assistantTimeline
        ? { assistantTimeline: frame.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
    };
  }
  if (frame.kind === 'terminal') {
    return {
      type: 'run.terminal',
      runId: frame.runId,
      sequence: frame.streamSequence,
      occurredAt: frame.occurredAt,
      ...(frame.terminalState ? { terminalState: frame.terminalState } : {}),
      ...(frame.errorMessage ? { terminalError: frame.errorMessage } : {}),
      ...(frame.assistantTimeline
        ? { assistantTimeline: frame.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
    };
  }
  return {
    type: frame.kind === 'text' ? 'text.delta' : 'commentary.delta',
    runId: frame.runId,
    delta: frame.textDelta ?? '',
    occurredAt: frame.occurredAt,
    sequence: frame.streamSequence,
    ...(frame.assistantTimeline
      ? { assistantTimeline: frame.assistantTimeline.map((segment) => ({ ...segment })) }
      : {}),
    ...(frame.kind === 'commentary' && frame.afterSequence !== undefined
      ? { afterSequence: frame.afterSequence }
      : {}),
  };
}

function operationFromDisplayQueueItem(
  item: Exclude<ConversationDisplayQueueItem, { source: 'snapshot' }>,
): ConversationStreamOperation | undefined {
  return item.source === 'transient' ? operationFromTransientFrame(item.frame) : item.operation;
}

/** One cumulative publication per paint frame, independent of provider chunk size. */
export function getConversationDisplayQueueBatchOptions(
  _queued: readonly ConversationDisplayQueueItem[],
): TransientFrameBatchOptions {
  return {
    maxFrames: Number.MAX_SAFE_INTEGER,
    maxTextCharacters: Number.MAX_SAFE_INTEGER,
  };
}

export function takeConversationDisplayQueueBatch(
  queued: readonly ConversationDisplayQueueItem[],
  _options: TransientFrameBatchOptions,
): ConversationDisplayQueueBatch {
  if (queued.length === 0) return { operations: [], completed: [], remaining: [] };

  const operations: ConversationStreamOperation[] = [];
  const completed: ConversationDisplayQueueItem[] = [];
  for (let index = 0; index < queued.length; index += 1) {
    const item = queued[index]!;
    if (item.source === 'snapshot') {
      completed.push(item);
      return { operations, completed, remaining: queued.slice(index + 1) };
    }
    const operation = operationFromDisplayQueueItem(item);
    if (operation) operations.push(operation);
    completed.push(item);
    if (operation && (operation.type === 'process.boundary' || operation.type === 'run.terminal')) {
      return { operations, completed, remaining: queued.slice(index + 1) };
    }
  }
  return { operations, completed, remaining: [] };
}

/**
 * Convert a reconnect/reset snapshot into paced catch-up operations followed
 * by one metadata reconciliation boundary. The visible draft therefore grows
 * at the same cadence as live frames instead of flashing the whole snapshot.
 */
export function buildConversationSnapshotDisplayQueue(input: {
  current: ConversationStreamDraft | null;
  incoming: ConversationStreamDraft | null;
  streamSequence: number;
  process?: RunProcessView;
  refreshDurable?: boolean;
}): ConversationDisplayQueueItem[] {
  const target = mergeTransientConversationDraft(input.current, input.incoming);
  return [
    {
      source: 'snapshot',
      draft: target,
      streamSequence: input.streamSequence,
      ...(input.process ? { process: input.process } : {}),
      ...(input.refreshDurable ? { refreshDurable: true } : {}),
    },
  ];
}

/**
 * Select one bounded paint batch without mutating the caller-owned queue.
 * Process/terminal boundaries end the batch so later text cannot visually
 * overtake the tool or lifecycle transition that precedes it.
 */
export function takeTransientConversationFrameBatch(
  queued: readonly ConversationTransientFrame[],
  _options: TransientFrameBatchOptions,
): TransientFrameBatch {
  if (queued.length === 0) return { frames: [], remaining: [] };
  const boundaryIndex = queued.findIndex(
    (frame) => frame.kind === 'process' || frame.kind === 'terminal',
  );
  const consumedFrames = boundaryIndex >= 0 ? boundaryIndex + 1 : queued.length;
  return {
    frames: queued.slice(0, consumedFrames),
    remaining: queued.slice(consumedFrames),
  };
}

function selectMonotonicText(current: string | undefined, incoming: string | undefined): string {
  const currentText = current ?? '';
  const incomingText = incoming ?? '';
  if (currentText.startsWith(incomingText)) return currentText;
  if (incomingText.startsWith(currentText)) return incomingText;
  return incomingText.length > currentText.length ? incomingText : currentText;
}

function mergeCommentarySegments(
  current: readonly CommentaryTimelineSegment[] | undefined,
  incoming: readonly CommentaryTimelineSegment[] | undefined,
): CommentaryTimelineSegment[] | undefined {
  if (!current?.length) return incoming?.map((segment) => ({ ...segment }));
  if (!incoming?.length) return current.map((segment) => ({ ...segment }));
  const byId = new Map<string, CommentaryTimelineSegment>();
  for (const segment of [...incoming, ...current]) {
    const previous = byId.get(segment.id);
    if (!previous) {
      byId.set(segment.id, { ...segment });
      continue;
    }
    const text = selectMonotonicText(previous.text, segment.text);
    byId.set(segment.id, {
      ...previous,
      ...segment,
      text,
      startedAt: previous.startedAt <= segment.startedAt ? previous.startedAt : segment.startedAt,
      completedAt: previous.completedAt ?? segment.completedAt,
    });
  }
  return [...byId.values()].sort((left, right) => {
    const leftBoundary = left.afterSequence ?? Number.NEGATIVE_INFINITY;
    const rightBoundary = right.afterSequence ?? Number.NEGATIVE_INFINITY;
    return (
      leftBoundary - rightBoundary ||
      left.startedAt.localeCompare(right.startedAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

/**
 * Reset snapshots can race newer live frames. Merge same-Run content
 * monotonically so a stale or empty snapshot never erases visible commentary.
 */
function selectLatestAssistantTimeline(
  current: readonly AssistantTurnSegment[] | undefined,
  incoming: readonly AssistantTurnSegment[] | undefined,
): AssistantTurnSegment[] | undefined {
  if (!current?.length) return incoming?.map((segment) => ({ ...segment }));
  if (!incoming?.length) return current.map((segment) => ({ ...segment }));
  const currentLast = current.at(-1)?.sequence ?? -1;
  const incomingLast = incoming.at(-1)?.sequence ?? -1;
  if (incomingLast !== currentLast) {
    return (incomingLast > currentLast ? incoming : current).map((segment) => ({ ...segment }));
  }
  const weight = (timeline: readonly AssistantTurnSegment[]) =>
    timeline.reduce(
      (total, segment) =>
        total +
        (segment.kind === 'thinking' || segment.kind === 'text'
          ? segment.text.length
          : segment.kind === 'tool'
            ? (segment.output?.length ?? 0) + (segment.argumentsJson?.length ?? 0)
            : segment.label.length + (segment.detail?.length ?? 0)),
      0,
    );
  return (weight(incoming) >= weight(current) ? incoming : current).map((segment) => ({
    ...segment,
  }));
}

export function mergeTransientConversationDraft(
  current: ConversationStreamDraft | null,
  incoming: ConversationStreamDraft | null,
): ConversationStreamDraft | null {
  if (!current) return incoming;
  if (!incoming) {
    return hasConversationStreamDraftContent(current) ? { ...current, terminal: true } : null;
  }
  if (current.runId && incoming.runId && current.runId !== incoming.runId) return incoming;

  const commentaryText = selectMonotonicText(current.commentaryText, incoming.commentaryText);
  const commentarySegments = mergeCommentarySegments(
    current.commentarySegments,
    incoming.commentarySegments,
  );
  const reasoningText = selectMonotonicText(current.reasoningText, incoming.reasoningText);
  const assistantTimeline = selectLatestAssistantTimeline(
    current.assistantTimeline,
    incoming.assistantTimeline,
  );
  const terminal = Boolean(current.terminal || incoming.terminal);
  return {
    runId: incoming.runId ?? current.runId,
    text: selectMonotonicText(current.text, incoming.text),
    ...(commentaryText ? { commentaryText } : {}),
    ...(commentarySegments?.length ? { commentarySegments } : {}),
    ...(reasoningText ? { reasoningText } : {}),
    ...(assistantTimeline?.length ? { assistantTimeline } : {}),
    timestamp: current.timestamp > incoming.timestamp ? current.timestamp : incoming.timestamp,
    ...(terminal ? { terminal: true } : {}),
  };
}

/**
 * Keep a terminal draft visible across the async message-store refresh. Remove
 * it only after that exact Run has a durable assistant message.
 */
export function reconcileTransientConversationDraft(
  current: ConversationStreamDraft | null,
  durableAssistantRunIds: Iterable<string>,
): ConversationStreamDraft | null {
  if (!current?.terminal) return current;
  if (!hasConversationStreamDraftContent(current)) return null;
  if (!current.runId) return current;
  for (const runId of durableAssistantRunIds) {
    if (runId === current.runId) return null;
  }
  return current;
}

/**
 * Apply one thread-scoped transient frame with cursor dedupe. A frame from a
 * different thread is ignored defensively even though Runtime subscriptions are scoped.
 */
export function applyTransientConversationFrame(input: {
  current: ConversationStreamDraft | null;
  frame: ConversationTransientFrame;
  threadId: string;
  afterStreamSequence: number;
}): TransientDraftState {
  const { frame } = input;
  if (frame.threadId !== input.threadId || frame.streamSequence <= input.afterStreamSequence) {
    return {
      draft: input.current,
      lastStreamSequence: input.afterStreamSequence,
      terminal: false,
    };
  }

  if (frame.kind === 'process') {
    const operation = operationFromTransientFrame(frame)!;
    return {
      draft: applyConversationStreamOperations(input.current, [operation]),
      lastStreamSequence: frame.streamSequence,
      terminal: false,
    };
  }

  const operation = operationFromTransientFrame(frame);

  return {
    draft: operation
      ? applyConversationStreamOperations(input.current, [operation])
      : input.current,
    lastStreamSequence: frame.streamSequence,
    terminal: frame.kind === 'terminal',
  };
}

/**
 * Reduce all transient frames observed during one paint interval. The caller can
 * commit the resulting draft once, while cursor dedupe still happens per frame.
 */
export function applyTransientConversationFrames(input: {
  current: ConversationStreamDraft | null;
  frames: readonly ConversationTransientFrame[];
  threadId: string;
  afterStreamSequence: number;
}): TransientDraftState {
  let draft = input.current;
  let lastStreamSequence = input.afterStreamSequence;
  let terminal = false;

  for (const frame of input.frames) {
    const next = applyTransientConversationFrame({
      current: draft,
      frame,
      threadId: input.threadId,
      afterStreamSequence: lastStreamSequence,
    });
    draft = next.draft;
    lastStreamSequence = next.lastStreamSequence;
    terminal ||= next.terminal;
  }

  return { draft, lastStreamSequence, terminal };
}
