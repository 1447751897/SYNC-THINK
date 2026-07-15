import type { Event } from '@sync-think/shared';

export function mergeEventHistory(
  current: readonly Event[],
  incoming: readonly Event[],
): Event[] {
  const eventsBySequence = new Map<number, Event>();
  for (const event of [...current, ...incoming]) {
    const existing = eventsBySequence.get(event.sequence);
    if (!existing || String(event.id).localeCompare(String(existing.id)) < 0) {
      eventsBySequence.set(event.sequence, event);
    }
  }
  return [...eventsBySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
