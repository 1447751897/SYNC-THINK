import type { AdapterEvent } from './types.js';

// Helper: collect a stream of adapter events into an array (used by tests/demos).
export async function collect(events: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const out: AdapterEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

// Reassemble the text deltas from a collected event stream.
export function textFromEvents(events: AdapterEvent[]): string {
  return events
    .filter((e) => e.type === 'text-delta')
    .map((e) => (e as { type: 'text-delta'; text: string }).text)
    .join('');
}
