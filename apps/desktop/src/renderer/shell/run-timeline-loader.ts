import type {
  AssistantTurnSegment,
  ConversationListRunTimelinePayload,
  ConversationListRunTimelineResponse,
} from '@sync-think/protocol';
import { normalizeAssistantTurnPhases } from '@sync-think/protocol/assistant-turn';
import { classifyRunProcessLoadFailure } from './run-process-history-loader.js';

export const RUN_TIMELINE_PAGE_LIMIT = 64;

export type RunTimelinePageFetcher = (
  payload: ConversationListRunTimelinePayload,
) => Promise<ConversationListRunTimelineResponse>;

function waitForTimelineRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Read a bounded page, recovering transient read failures without discarding earlier pages. */
export async function loadRunTimelinePage(
  fetchPage: RunTimelinePageFetcher,
  runId: ConversationListRunTimelinePayload['runId'],
  cursor?: string,
  signal?: AbortSignal,
): Promise<ConversationListRunTimelineResponse> {
  const payload = { runId, ...(cursor ? { cursor } : {}), limit: RUN_TIMELINE_PAGE_LIMIT };
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const page = await fetchPage(payload);
      signal?.throwIfAborted();
      if (
        !page ||
        !Array.isArray(page.segments) ||
        !Number.isInteger(page.totalSegments) ||
        page.totalSegments < 0 ||
        (page.nextCursor !== undefined &&
          (typeof page.nextCursor !== 'string' || !page.nextCursor))
      ) {
        throw new Error('conversation.run_timeline_invalid_response');
      }
      return page;
    } catch (error) {
      signal?.throwIfAborted();
      const kind = classifyRunProcessLoadFailure(error);
      if (attempt >= 3 || (kind !== 'connection' && kind !== 'busy')) throw error;
      await waitForTimelineRetry(500 * 2 ** (attempt - 1), signal);
    }
  }
}

export function timelineLoadFailureMessage(error: unknown): string {
  const kind = classifyRunProcessLoadFailure(error);
  if (kind === 'connection') return '执行记录读取连接中断，自动重试后仍未恢复';
  if (kind === 'busy') return '执行记录暂时繁忙，自动重试后仍未恢复';
  if (kind === 'invalid') return '执行记录返回异常';
  if (kind === 'unavailable') return '执行记录暂不可用';
  return '完整执行记录读取失败';
}

/** Merge overlapping pages while retaining the provider's durable sequence. */
export function mergeRunTimelineSegments(
  current: readonly AssistantTurnSegment[],
  incoming: readonly AssistantTurnSegment[],
): AssistantTurnSegment[] {
  const segmentsById = new Map<string, AssistantTurnSegment>();
  for (const segment of current) segmentsById.set(segment.id, segment);
  for (const segment of incoming) segmentsById.set(segment.id, segment);

  return normalizeAssistantTurnPhases(
    [...segmentsById.values()].sort(
      (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
    ),
  );
}
