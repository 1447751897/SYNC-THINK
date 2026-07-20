import type { Event } from '@sync-think/shared';

export function mergeEventHistory(current: readonly Event[], incoming: readonly Event[]): Event[] {
  const eventsBySequence = new Map<number, Event>();
  for (const event of [...current, ...incoming]) {
    const existing = eventsBySequence.get(event.sequence);
    if (!existing || String(event.id).localeCompare(String(existing.id)) < 0) {
      eventsBySequence.set(event.sequence, event);
    }
  }
  return [...eventsBySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function appendEventHistory(
  existing: readonly Event[],
  incoming: readonly Event[],
): Event[] {
  if (incoming.length === 0) return [...existing];
  const completedRunIds = new Set(
    incoming.flatMap((event) =>
      event.type === 'run.completed' &&
      event.runId &&
      typeof event.payload.assistantText === 'string'
        ? [String(event.runId)]
        : [],
    ),
  );
  const keepEvent = (event: Event) =>
    !(event.type === 'message.delta' && event.runId && completedRunIds.has(String(event.runId)));
  const compactExisting = completedRunIds.size > 0 ? existing.filter(keepEvent) : existing;
  const compactIncoming = completedRunIds.size > 0 ? incoming.filter(keepEvent) : incoming;

  let previousSequence = compactExisting[compactExisting.length - 1]?.sequence ?? 0;
  for (const event of compactIncoming) {
    if (event.sequence <= previousSequence) {
      return mergeEventHistory(compactExisting, compactIncoming);
    }
    previousSequence = event.sequence;
  }
  return [...compactExisting, ...compactIncoming];
}
