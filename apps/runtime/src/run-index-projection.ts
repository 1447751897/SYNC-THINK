import type { Event } from '@sync-think/shared';
import type { RunIndexSource, RunIndexState } from '@sync-think/shared';
import type { RunIndexUpsert } from '@sync-think/storage';

/**
 * Projects durable run lifecycle events into `run_index` upserts.
 *
 * Kept as a pure function so the mapping can be tested without a Runtime, and
 * so replaying the event log rebuilds the same read model the live path writes.
 */

const RUN_STATE_BY_EVENT_TYPE: Record<string, RunIndexState> = {
  'run.started': 'running',
  'run.recovered': 'running',
  'run.retrying': 'running',
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
  'run.paused': 'paused',
};

export const RUN_INDEX_EVENT_TYPES = Object.keys(RUN_STATE_BY_EVENT_TYPE);

const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Derives where the run came from. `external` wins over `scheduled` because an
 * external event that targets a scheduled task is still externally triggered,
 * and that provenance is what the activity list needs to show.
 */
function resolveSource(payload: Record<string, unknown>): RunIndexSource {
  if (readString(payload, 'externalEventId')) return 'external';
  if (readString(payload, 'scheduledTaskId')) return 'scheduled';
  if (readString(payload, 'threadId')) return 'chat';
  return 'orchestration';
}

export interface RunIndexProjectionInput {
  event: Event;
  /** Fallback workspace when the event row carries none. */
  fallbackWorkspaceId: string;
  /** Scrubs provider errors before they reach the read model. */
  scrub: (message: string) => string;
}

export function projectRunIndexUpsert(
  input: RunIndexProjectionInput,
): RunIndexUpsert | undefined {
  const { event, fallbackWorkspaceId, scrub } = input;
  const state = RUN_STATE_BY_EVENT_TYPE[event.type];
  if (!state) return undefined;
  if (!event.runId) return undefined;

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const isTerminal = TERMINAL_EVENT_TYPES.has(event.type);
  const rawError = readString(payload, 'errorMessage');

  return {
    runId: event.runId,
    workspaceId: event.workspaceId || fallbackWorkspaceId,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(readString(payload, 'conversationId') ?? readString(payload, 'threadId')
      ? {
          conversationId:
            readString(payload, 'conversationId') ?? readString(payload, 'threadId')!,
        }
      : {}),
    source: resolveSource(payload),
    state,
    ...(readString(payload, 'kernelId') ? { kernelId: readString(payload, 'kernelId')! } : {}),
    ...(readString(payload, 'modelId') ? { modelId: readString(payload, 'modelId')! } : {}),
    ...(readString(payload, 'providerModelId')
      ? { providerModelId: readString(payload, 'providerModelId')! }
      : {}),
    ...(readString(payload, 'title') ? { title: readString(payload, 'title')! } : {}),
    // `run.started` defines the start; later events must not move it, so only
    // the starting events contribute a timestamp and the store keeps the min.
    ...(state === 'running' ? { startedAt: event.occurredAt } : {}),
    ...(isTerminal ? { finishedAt: event.occurredAt } : {}),
    ...(event.type === 'run.failed'
      ? {
          failureClass: readString(payload, 'failureClass') ?? 'unknown',
          // Provider errors reach this payload unscrubbed at the kernel
          // terminal boundary, so scrubbing happens here rather than trusting
          // the emitter.
          ...(rawError ? { errorMessage: scrub(rawError) } : {}),
        }
      : {}),
    ...(readString(payload, 'triggerMessageId')
      ? { triggerMessageId: readString(payload, 'triggerMessageId')! }
      : {}),
    ...(readString(payload, 'externalEventId')
      ? { externalEventId: readString(payload, 'externalEventId')! }
      : {}),
    now: event.occurredAt,
  };
}
