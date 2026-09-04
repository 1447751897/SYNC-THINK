import type {
  AssistantTurnSegment,
  ConversationListRunTimelinePayload,
  ConversationListRunTimelineResponse,
} from '@sync-think/protocol';
import { normalizeAssistantTurnPhases } from '@sync-think/protocol/assistant-turn';

export const RUN_TIMELINE_PAGE_LIMIT = 64;

export type RunTimelinePageFetcher = (
  payload: ConversationListRunTimelinePayload,
) => Promise<ConversationListRunTimelineResponse>;

/** Read one bounded page; the process panel decides when the next page is needed. */
export function loadRunTimelinePage(
  fetchPage: RunTimelinePageFetcher,
  runId: ConversationListRunTimelinePayload['runId'],
  cursor?: string,
): Promise<ConversationListRunTimelineResponse> {
  return fetchPage({
    runId,
    ...(cursor ? { cursor } : {}),
    limit: RUN_TIMELINE_PAGE_LIMIT,
  });
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
