import type { Event } from '@sync-think/shared';

/**
 * Bounded event history (audit #1): long sessions must not grow the renderer's
 * event array without limit — every merge rebuilds and re-sorts the whole
 * history (O(n log n)), and downstream projections (conversation activity,
 * stream batch fallback) walk it in full.
 *
 * Window policy: keep at most EVENT_HISTORY_LIMIT events; when over the cap,
 * evict the oldest *streaming delta* events first. Deltas are incremental
 * fragments already superseded by the terminal `run.completed` payload, so
 * dropping them loses nothing permanent. Structural anchors — message.appended,
 * run lifecycle, tool/approval/review/step/context events — are never evicted,
 * so projections keep their basis (run start/finish pairing, approval state).
 */
export const EVENT_HISTORY_LIMIT = 5000;

/** Streaming fragments only: safe to evict first; terminal events carry final text. */
const EVICTABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message.delta',
  'message.commentary_delta',
  'message.reasoning_delta',
]);

function isEvictable(event: Event): boolean {
  return EVICTABLE_EVENT_TYPES.has(event.type);
}

function bySequenceAndId(left: Event, right: Event): number {
  const sequenceOrder = left.sequence - right.sequence;
  return sequenceOrder === 0 ? String(left.id).localeCompare(String(right.id)) : sequenceOrder;
}

export function mergeEventHistory(current: readonly Event[], incoming: readonly Event[]): Event[] {
  const eventsById = new Map<string, Event>();
  for (const event of [...current, ...incoming]) {
    eventsById.set(String(event.id), event);
  }
  const merged = [...eventsById.values()].sort(bySequenceAndId);
  if (merged.length <= EVENT_HISTORY_LIMIT) return merged;

  // Over the cap: evict the oldest evictable deltas first; anchors stay.
  const overflow = merged.length - EVENT_HISTORY_LIMIT;
  const evictable = merged.filter(isEvictable);
  const anchors = merged.filter((event) => !isEvictable(event));
  const evicted = Math.min(overflow, evictable.length);
  return [...anchors, ...evictable.slice(evicted)].sort(bySequenceAndId);
}
