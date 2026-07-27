import type { Event } from '@sync-think/shared';

export function mergeEventHistory(current: readonly Event[], incoming: readonly Event[]): Event[] {
  const eventsById = new Map<string, Event>();
  for (const event of [...current, ...incoming]) {
    eventsById.set(String(event.id), event);
  }
  return [...eventsById.values()].sort((left, right) => {
    const sequenceOrder = left.sequence - right.sequence;
    return sequenceOrder === 0 ? String(left.id).localeCompare(String(right.id)) : sequenceOrder;
  });
}
