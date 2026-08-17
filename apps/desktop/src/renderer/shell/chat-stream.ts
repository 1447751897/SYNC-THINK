import type { Event } from '@sync-think/shared';
import type { AssistantTurnSegment, CommentaryTimelineSegment } from '@sync-think/protocol';
import {
  isHistoricalOrphanRunStart,
  type RunActivityAuthority,
} from '../run-activity-authority.js';

export interface ConversationStreamDraft {
  runId?: string;
  text: string;
  commentaryText?: string;
  commentarySegments?: CommentaryTimelineSegment[];
  /** Provider reasoning summary streamed live and persisted on the message. */
  reasoningText?: string;
  /** Exact provider/kernel event order for the current assistant turn. */
  assistantTimeline?: AssistantTurnSegment[];
  timestamp: string;
  /** Terminal drafts stay mounted until the same Run is visible durably. */
  terminal?: boolean;
  /** Why the run ended (failed/cancelled) so the live bubble shows the error. */
  terminalState?: 'completed' | 'failed' | 'cancelled';
  terminalError?: string;
}

/** A terminal draft is renderable only when the provider emitted user-visible content. */
export function hasConversationStreamDraftContent(
  draft: ConversationStreamDraft | null | undefined,
): boolean {
  return Boolean(
    draft &&
    (draft.text.trim() ||
      draft.commentaryText?.trim() ||
      draft.commentarySegments?.some((segment) => segment.text.trim()) ||
      draft.reasoningText?.trim() ||
      draft.assistantTimeline?.some(
        (segment) =>
          segment.kind === 'tool' ||
          segment.kind === 'status' ||
          ((segment.kind === 'thinking' || segment.kind === 'text') && segment.text.trim()),
      )),
  );
}

export type ConversationStreamOperation = (
  | {
      type: 'text.delta';
      runId?: string;
      delta: string;
      occurredAt: string;
      sequence: number;
    }
  | {
      type: 'commentary.delta';
      runId?: string;
      delta: string;
      occurredAt: string;
      sequence: number;
      afterSequence?: number;
    }
  | {
      type: 'reasoning.delta';
      runId?: string;
      delta: string;
      occurredAt: string;
      sequence: number;
      afterSequence?: number;
    }
  | {
      type: 'process.boundary';
      runId?: string;
      occurredAt: string;
      sequence: number;
    }
  | {
      type: 'run.terminal';
      runId?: string;
      sequence: number;
      occurredAt?: string;
      terminalState?: 'completed' | 'failed' | 'cancelled';
      terminalError?: string;
    }
) & { assistantTimeline?: AssistantTurnSegment[] };

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

function isProcessBoundaryEventType(type: string): boolean {
  return (
    type === 'tool.requested' ||
    type === 'tool.completed' ||
    type === 'tool.failed' ||
    type === 'execution.tool.requested' ||
    type === 'execution.tool.completed' ||
    type === 'execution.tool.failed' ||
    type.startsWith('mcp.tool_')
  );
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

export interface RunConnectionStatus {
  id: string;
  runId: string;
  text: string;
  timestamp: string;
  sequence: number;
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
  authority?: RunActivityAuthority;
  durableAssistantRunIds?: ReadonlySet<string>;
}): ConversationRunActivity {
  const startedRuns = new Map<string, number>();
  const endedRuns = new Set(input.durableAssistantRunIds);
  for (const event of input.events) {
    if (!belongsToConversation(event, input.threadId, input.taskId) || !event.runId) continue;
    if (event.type === 'run.started') {
      if (isHistoricalOrphanRunStart(event, input.authority)) continue;
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
 * Return the latest transient connection/model-switch status for the active run.
 * Any subsequent provider output or terminal lifecycle event clears the status.
 */
export function selectLatestRunConnectionStatus(input: {
  events: readonly Event[];
  threadId: string;
  taskId?: string;
  activeRunId?: string;
  streamingMessage?: Pick<ConversationStreamDraft, 'runId' | 'timestamp'> | null;
}): RunConnectionStatus | undefined {
  let status: RunConnectionStatus | undefined;
  const ordered = input.events
    .filter((event) => belongsToConversation(event, input.threadId, input.taskId))
    .slice()
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));

  for (const event of ordered) {
    if (event.type === 'run.started') {
      if (status && event.sequence >= status.sequence) status = undefined;
      continue;
    }

    if (event.type === 'run.retrying' || event.type === 'run.fallback.selected') {
      if (!event.runId || (input.activeRunId && event.runId !== input.activeRunId)) continue;

      if (event.type === 'run.retrying') {
        const attempt =
          typeof event.payload.attempt === 'number' && Number.isFinite(event.payload.attempt)
            ? Math.max(1, Math.trunc(event.payload.attempt))
            : 1;
        const maxAttempts =
          typeof event.payload.maxAttempts === 'number' &&
          Number.isFinite(event.payload.maxAttempts)
            ? Math.max(attempt, Math.trunc(event.payload.maxAttempts))
            : attempt;
        status = {
          id: `run-connection-${String(event.id)}`,
          runId: event.runId,
          text: `正在重新连接 ${attempt}/${maxAttempts}`,
          timestamp: event.occurredAt,
          sequence: event.sequence,
        };
        continue;
      }

      const fromModel =
        typeof event.payload.fromProviderModelId === 'string' &&
        event.payload.fromProviderModelId.trim()
          ? event.payload.fromProviderModelId.trim()
          : typeof event.payload.fromModelId === 'string' && event.payload.fromModelId.trim()
            ? event.payload.fromModelId.trim()
            : '当前模型';
      const toModel =
        typeof event.payload.toProviderModelId === 'string' &&
        event.payload.toProviderModelId.trim()
          ? event.payload.toProviderModelId.trim()
          : typeof event.payload.toModelId === 'string' && event.payload.toModelId.trim()
            ? event.payload.toModelId.trim()
            : '备用模型';
      status = {
        id: `run-connection-${String(event.id)}`,
        runId: event.runId,
        text: `正在切换备用模型：${fromModel} → ${toModel}`,
        timestamp: event.occurredAt,
        sequence: event.sequence,
      };
      continue;
    }

    if (
      status &&
      event.sequence >= status.sequence &&
      event.runId === status.runId &&
      (event.type === 'message.delta' ||
        event.type === 'message.commentary_delta' ||
        event.type === 'message.reasoning_delta' ||
        isRunTerminalEventType(event.type))
    ) {
      status = undefined;
    }
  }

  if (!status || (input.activeRunId && status.runId !== input.activeRunId)) return undefined;

  const streamingTimestamp = input.streamingMessage?.timestamp
    ? Date.parse(input.streamingMessage.timestamp)
    : Number.NaN;
  const statusTimestamp = Date.parse(status.timestamp);
  if (
    input.streamingMessage &&
    (!input.streamingMessage.runId || input.streamingMessage.runId === status.runId) &&
    Number.isFinite(streamingTimestamp) &&
    Number.isFinite(statusTimestamp) &&
    streamingTimestamp > statusTimestamp
  ) {
    return undefined;
  }

  return status;
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

    if (event.type === 'message.commentary_delta') {
      const delta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.delta === 'string'
            ? event.payload.delta
            : '';
      if (delta) {
        operations.push({
          type: 'commentary.delta',
          runId: event.runId,
          delta,
          occurredAt: event.occurredAt,
          sequence: event.sequence,
          afterSequence:
            typeof event.payload.afterSequence === 'number'
              ? event.payload.afterSequence
              : event.sequence,
        });
      }
      continue;
    }

    if (event.type === 'message.reasoning_delta') {
      const delta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.reasoningDelta === 'string'
            ? event.payload.reasoningDelta
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
          afterSequence:
            typeof event.payload.afterSequence === 'number'
              ? event.payload.afterSequence
              : event.sequence,
        });
      }
      continue;
    }

    if (isProcessBoundaryEventType(event.type)) {
      operations.push({
        type: 'process.boundary',
        runId: event.runId,
        occurredAt: event.occurredAt,
        sequence: event.sequence,
      });
      continue;
    }

    if (isRunTerminalEventType(event.type)) {
      sawTerminalEvent = true;
      const terminalState =
        event.type === 'run.completed'
          ? 'completed'
          : event.type === 'run.failed'
            ? 'failed'
            : 'cancelled';
      const terminalError =
        typeof event.payload.errorMessage === 'string' ? event.payload.errorMessage : undefined;
      operations.push({
        type: 'run.terminal',
        runId: event.runId,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        terminalState,
        ...(terminalError ? { terminalError } : {}),
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
        const finalized = closeDraftCommentarySegment(
          draft,
          operation.occurredAt ?? draft.timestamp,
        );
        draft = hasConversationStreamDraftContent(finalized)
          ? {
              ...finalized,
              terminal: true,
              ...(operation.terminalState ? { terminalState: operation.terminalState } : {}),
              ...(operation.terminalError ? { terminalError: operation.terminalError } : {}),
              ...(operation.assistantTimeline
                ? {
                    assistantTimeline: operation.assistantTimeline.map((segment) => ({
                      ...segment,
                    })),
                  }
                : {}),
            }
          : null;
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
      ...(operation.assistantTimeline
        ? { assistantTimeline: operation.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
    };
    const activeBase = { ...base };
    delete activeBase.terminal;
    if (operation.type === 'process.boundary') {
      const closed = closeDraftCommentarySegment(activeBase, operation.occurredAt);
      draft = {
        ...(closed === activeBase ? base : closed),
        runId: activeBase.runId ?? operation.runId,
        timestamp: operation.occurredAt,
        ...(operation.assistantTimeline
          ? { assistantTimeline: operation.assistantTimeline.map((segment) => ({ ...segment })) }
          : {}),
      };
      continue;
    }
    const commentarySegments =
      operation.type === 'commentary.delta'
        ? appendDraftCommentaryDelta(activeBase.commentarySegments, {
            textDelta: operation.delta,
            occurredAt: operation.occurredAt,
            afterSequence: operation.afterSequence,
          })
        : closeCommentarySegments(activeBase.commentarySegments, operation.occurredAt);
    const commentaryText =
      operation.type === 'commentary.delta'
        ? (activeBase.commentaryText ?? '') + operation.delta
        : activeBase.commentaryText;
    const reasoningText =
      operation.type === 'reasoning.delta'
        ? (activeBase.reasoningText ?? '') + operation.delta
        : activeBase.reasoningText;
    draft = {
      ...activeBase,
      runId: activeBase.runId ?? operation.runId,
      text: operation.type === 'text.delta' ? activeBase.text + operation.delta : activeBase.text,
      ...(commentaryText !== undefined ? { commentaryText } : {}),
      ...(commentarySegments && commentarySegments.length > 0 ? { commentarySegments } : {}),
      ...(reasoningText !== undefined && reasoningText.length > 0 ? { reasoningText } : {}),
      ...(operation.assistantTimeline
        ? { assistantTimeline: operation.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
      timestamp: operation.occurredAt,
    };
  }

  return draft;
}

const MAX_COMMENTARY_TIMELINE_SEGMENTS = 128;
const MAX_COMMENTARY_TIMELINE_CHARS = 120_000;

function boundCommentarySegments(
  segments: readonly CommentaryTimelineSegment[] | undefined,
): CommentaryTimelineSegment[] | undefined {
  if (!segments || segments.length === 0) return undefined;
  const bounded = segments
    .slice(-MAX_COMMENTARY_TIMELINE_SEGMENTS)
    .map((segment) => ({ ...segment }));
  let totalChars = bounded.reduce((total, segment) => total + segment.text.length, 0);
  while (bounded.length > 0 && totalChars > MAX_COMMENTARY_TIMELINE_CHARS) {
    const first = bounded[0]!;
    const overflow = totalChars - MAX_COMMENTARY_TIMELINE_CHARS;
    if (first.text.length <= overflow) {
      totalChars -= first.text.length;
      bounded.shift();
    } else {
      first.text = first.text.slice(overflow);
      totalChars -= overflow;
    }
  }
  return bounded.length > 0 ? bounded : undefined;
}

function appendDraftCommentaryDelta(
  current: readonly CommentaryTimelineSegment[] | undefined,
  input: {
    textDelta: string;
    occurredAt: string;
    afterSequence?: number;
  },
): CommentaryTimelineSegment[] | undefined {
  if (!input.textDelta) return boundCommentarySegments(current);
  const segments = (current ?? []).map((segment) => ({ ...segment }));
  const last = segments.at(-1);
  if (last && last.completedAt === undefined && last.afterSequence === input.afterSequence) {
    last.text += input.textDelta;
  } else {
    segments.push({
      id: `commentary-${input.afterSequence ?? 'transient'}-${segments.length}`,
      text: input.textDelta,
      startedAt: input.occurredAt,
      ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
    });
  }
  return boundCommentarySegments(segments);
}

function closeCommentarySegments(
  current: readonly CommentaryTimelineSegment[] | undefined,
  completedAt: string,
): CommentaryTimelineSegment[] | undefined {
  if (!current || current.length === 0) return undefined;
  const last = current.at(-1);
  if (!last || last.completedAt !== undefined) return current as CommentaryTimelineSegment[];
  return [...current.slice(0, -1).map((segment) => ({ ...segment })), { ...last, completedAt }];
}

function closeDraftCommentarySegment(
  draft: Omit<ConversationStreamDraft, 'terminal'>,
  completedAt: string,
): Omit<ConversationStreamDraft, 'terminal'> {
  const commentarySegments = closeCommentarySegments(draft.commentarySegments, completedAt);
  if (commentarySegments === draft.commentarySegments) return draft;
  return {
    ...draft,
    ...(commentarySegments && commentarySegments.length > 0 ? { commentarySegments } : {}),
  };
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
      ? '备用模型已全部尝试，任务已暂停。'
      : reason === 'no_fallback_configured'
        ? '当前模型不可用，且没有配置备用模型。'
        : reason === 'recovery_expired'
          ? '历史请求已过期，未自动重新执行。'
          : `任务已暂停（${reason}）。`;
  const details = [
    providerModelId ? `模型：${providerModelId}` : '',
    failureClass ? `失败类型：${failureClass}` : '',
    errorMessage ? `详情：${errorMessage}` : '',
  ].filter(Boolean);
  const retryHint =
    reason === 'fallback_exhausted' || reason === 'no_fallback_configured'
      ? '请切换 Provider、模型或检查连接后重试。'
      : reason === 'recovery_expired'
        ? '请重新发送请求。'
        : '';

  return {
    id: `run-paused-${String(event.id)}`,
    runId: event.runId,
    text: [headline, details.join('；'), retryHint].filter(Boolean).join(' '),
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
