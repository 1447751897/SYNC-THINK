/**
 * Read model for the background activity centre.
 *
 * Conversation runs never enter the orchestration `run` table — they live in an
 * in-memory map plus the append-only event log. The orchestration `run` table in
 * turn has no kernel, model, start/finish or failure columns. Neither source can
 * answer "list every run" on its own, so `run_index` is a dedicated projection
 * written from the durable run lifecycle events.
 *
 * This is a projection, not a source of truth. Rebuilding it from the event log
 * must always be safe.
 */

export type RunIndexSource = 'chat' | 'scheduled' | 'external' | 'orchestration';

export type RunIndexState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export const RUN_INDEX_TERMINAL_STATES: readonly RunIndexState[] = [
  'completed',
  'failed',
  'cancelled',
];

export interface RunIndexEntry {
  runId: string;
  workspaceId: string;
  /** Durable conversation this run belongs to, when it came from a thread. */
  conversationId?: string;
  taskId?: string;
  source: RunIndexSource;
  state: RunIndexState;
  /** Kernel that executed the run, for example `codex` or `claude`. */
  kernelId?: string;
  modelId?: string;
  providerModelId?: string;
  /**
   * Bounded, human-facing label. Never carries a run/event id or the full
   * prompt. Prefer the conversation title, then a short first-message snippet.
   */
  title?: string;
  startedAt: string;
  finishedAt?: string;
  /** Present only on `failed`. Mirrors the run.failed event classification. */
  failureClass?: string;
  /** Scrubbed and truncated. Raw provider errors must not reach this field. */
  errorMessage?: string;
  /** User message that triggered this run, used as the retry anchor. */
  triggerMessageId?: string;
  /** Set when a daemon external event produced this run. */
  externalEventId?: string;
  updatedAt: string;
}

export interface RunIndexListFilter {
  workspaceId?: string;
  conversationId?: string;
  states?: RunIndexState[];
  sources?: RunIndexSource[];
  /** Opaque pagination cursor from a previous page. */
  cursor?: string;
  limit?: number;
}

export interface RunIndexListPage {
  entries: RunIndexEntry[];
  /** Absent when the last page has been reached. */
  nextCursor?: string;
}

/** Bounds every activity list query so one page can never exhaust a frame. */
export const RUN_INDEX_MAX_LIMIT = 50;
export const RUN_INDEX_DEFAULT_LIMIT = 25;

/** Bounds the projected title so prompt bodies cannot leak into the read model. */
export const RUN_INDEX_MAX_TITLE_LENGTH = 120;

/** Bounds the projected failure text. Longer messages are truncated. */
export const RUN_INDEX_MAX_ERROR_LENGTH = 240;
