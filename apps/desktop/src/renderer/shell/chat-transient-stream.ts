import type {
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
  if (frame.kind === 'reasoning') return undefined;
  if (frame.kind === 'process') {
    return {
      type: 'process.boundary',
      runId: frame.runId,
      occurredAt: frame.occurredAt,
      sequence: frame.streamSequence,
    };
  }
  if (frame.kind === 'terminal') {
    return {
      type: 'run.terminal',
      runId: frame.runId,
      sequence: frame.streamSequence,
      occurredAt: frame.occurredAt,
    };
  }
  return {
    type: frame.kind === 'text' ? 'text.delta' : 'commentary.delta',
    runId: frame.runId,
    delta: frame.textDelta ?? '',
    occurredAt: frame.occurredAt,
    sequence: frame.streamSequence,
    ...(frame.kind === 'commentary' && frame.afterSequence !== undefined
      ? { afterSequence: frame.afterSequence }
      : {}),
  };
}

function isTextOperation(
  operation: ConversationStreamOperation | undefined,
): operation is Extract<
  ConversationStreamOperation,
  { type: 'text.delta' | 'commentary.delta' }
> {
  return operation?.type === 'text.delta' || operation?.type === 'commentary.delta';
}

function boundedTextEnd(text: string, offset: number, characterBudget: number): number {
  let end = Math.min(text.length, offset + characterBudget);
  const finalCodeUnit = text.charCodeAt(end - 1);
  const nextCodeUnit = text.charCodeAt(end);
  if (
    end < text.length &&
    finalCodeUnit >= 0xd800 &&
    finalCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    end -= 1;
  }
  return Math.max(offset, end);
}

function cloneQueueItemWithOffset(
  item: Exclude<ConversationDisplayQueueItem, { source: 'snapshot' }>,
  offset: number,
): ConversationDisplayQueueItem {
  return item.source === 'transient'
    ? { source: 'transient', frame: item.frame, offset }
    : { source: 'durable', operation: item.operation, offset };
}

/**
 * Consume one paint-sized display batch. Large provider frames are sliced
 * without advancing their source cursor until the complete frame is visible.
 * Process, terminal, and snapshot boundaries end the paint so later content
 * cannot overtake them.
 */
export function takeConversationDisplayQueueBatch(
  queued: readonly ConversationDisplayQueueItem[],
  options: TransientFrameBatchOptions,
): ConversationDisplayQueueBatch {
  if (queued.length === 0) return { operations: [], completed: [], remaining: [] };

  const maxFrames = Math.max(1, Math.trunc(options.maxFrames));
  const maxTextCharacters = Math.max(1, Math.trunc(options.maxTextCharacters));
  const operations: ConversationStreamOperation[] = [];
  const completed: ConversationDisplayQueueItem[] = [];
  let consumedItems = 0;
  let consumedTextCharacters = 0;
  let remaining: ConversationDisplayQueueItem[] = [];

  for (let index = 0; index < queued.length; index += 1) {
    const item = queued[index]!;
    if (consumedItems >= maxFrames) {
      remaining = queued.slice(index);
      break;
    }

    if (item.source === 'snapshot') {
      completed.push(item);
      consumedItems += 1;
      remaining = queued.slice(index + 1);
      break;
    }

    const operation =
      item.source === 'transient' ? operationFromTransientFrame(item.frame) : item.operation;
    if (!isTextOperation(operation)) {
      if (operation) operations.push(operation);
      completed.push(item);
      consumedItems += 1;
      remaining = queued.slice(index + 1);
      break;
    }

    const availableBudget = maxTextCharacters - consumedTextCharacters;
    if (availableBudget <= 0) {
      remaining = queued.slice(index);
      break;
    }
    const end = boundedTextEnd(operation.delta, item.offset, availableBudget);
    const delta = operation.delta.slice(item.offset, end);
    if (delta) {
      operations.push({ ...operation, delta });
      consumedTextCharacters += delta.length;
    }
    consumedItems += 1;

    if (end >= operation.delta.length) {
      completed.push(item);
      if (consumedTextCharacters >= maxTextCharacters) {
        remaining = queued.slice(index + 1);
        break;
      }
      if (index === queued.length - 1) remaining = [];
      continue;
    }

    remaining = [
      cloneQueueItemWithOffset(item, end),
      ...queued.slice(index + 1),
    ];
    break;
  }

  return { operations, completed, remaining };
}

function monotonicSuffix(current: string | undefined, incoming: string | undefined): string {
  const currentText = current ?? '';
  const incomingText = incoming ?? '';
  return incomingText.startsWith(currentText) ? incomingText.slice(currentText.length) : '';
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
  const sameRun = Boolean(
    input.current &&
      target &&
      (!input.current.runId || !target.runId || input.current.runId === target.runId),
  );
  const current = sameRun ? input.current : null;
  const durableItems: ConversationDisplayQueueItem[] = [];

  if (target) {
    const currentSegments = current?.commentarySegments;
    const targetSegments = target.commentarySegments;
    const hasCurrentAggregateOnly = Boolean(current?.commentaryText) && !currentSegments?.length;
    const canDiffSegments = Boolean(
      targetSegments?.length &&
        !hasCurrentAggregateOnly &&
        (!currentSegments?.length ||
          currentSegments.every((segment) => {
            const incoming = targetSegments.find((candidate) => candidate.id === segment.id);
            return Boolean(incoming?.text.startsWith(segment.text));
          })),
    );

    if (canDiffSegments && targetSegments) {
      const currentById = new Map(
        (currentSegments ?? []).map((segment) => [segment.id, segment.text] as const),
      );
      for (const segment of targetSegments) {
        const delta = monotonicSuffix(currentById.get(segment.id), segment.text);
        if (!delta) continue;
        durableItems.push({
          source: 'durable',
          offset: 0,
          operation: {
            type: 'commentary.delta',
            runId: target.runId,
            delta,
            occurredAt: segment.startedAt,
            sequence: input.streamSequence,
            ...(segment.afterSequence !== undefined
              ? { afterSequence: segment.afterSequence }
              : {}),
          },
        });
      }
    } else {
      const commentaryDelta = monotonicSuffix(current?.commentaryText, target.commentaryText);
      if (commentaryDelta) {
        durableItems.push({
          source: 'durable',
          offset: 0,
          operation: {
            type: 'commentary.delta',
            runId: target.runId,
            delta: commentaryDelta,
            occurredAt: target.timestamp,
            sequence: input.streamSequence,
          },
        });
      }
    }

    const textDelta = monotonicSuffix(current?.text, target.text);
    if (textDelta) {
      durableItems.push({
        source: 'durable',
        offset: 0,
        operation: {
          type: 'text.delta',
          runId: target.runId,
          delta: textDelta,
          occurredAt: target.timestamp,
          sequence: input.streamSequence,
        },
      });
    }
  }

  return [
    ...durableItems,
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
  options: TransientFrameBatchOptions,
): TransientFrameBatch {
  if (queued.length === 0) return { frames: [], remaining: [] };

  const maxFrames = Math.max(1, Math.trunc(options.maxFrames));
  const maxTextCharacters = Math.max(1, Math.trunc(options.maxTextCharacters));
  let consumedTextCharacters = 0;
  let consumedFrames = 0;

  for (const frame of queued) {
    if (consumedFrames >= maxFrames) break;
    const textCharacters =
      frame.kind === 'text' || frame.kind === 'commentary' ? (frame.textDelta?.length ?? 0) : 0;
    if (
      consumedFrames > 0 &&
      textCharacters > 0 &&
      consumedTextCharacters + textCharacters > maxTextCharacters
    ) {
      break;
    }

    consumedFrames += 1;
    consumedTextCharacters += textCharacters;
    if (
      frame.kind === 'process' ||
      frame.kind === 'terminal' ||
      consumedTextCharacters >= maxTextCharacters
    ) {
      break;
    }
  }

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
      startedAt:
        previous.startedAt <= segment.startedAt ? previous.startedAt : segment.startedAt,
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
  const terminal = Boolean(current.terminal || incoming.terminal);
  return {
    runId: incoming.runId ?? current.runId,
    text: selectMonotonicText(current.text, incoming.text),
    ...(commentaryText ? { commentaryText } : {}),
    ...(commentarySegments?.length ? { commentarySegments } : {}),
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

  // Provider reasoning summaries are retained by Runtime for diagnostics only.
  // Advancing the cursor prevents replay loops without exposing them as progress.
  if (frame.kind === 'reasoning') {
    return {
      draft: input.current,
      lastStreamSequence: frame.streamSequence,
      terminal: false,
    };
  }

  const operation = operationFromTransientFrame(frame)!;

  return {
    draft: applyConversationStreamOperations(input.current, [operation]),
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
