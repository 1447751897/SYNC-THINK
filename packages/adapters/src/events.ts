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
    .filter(
      (event) =>
        event.type === 'text-delta' ||
        (event.type === 'assistant-message-delta' && event.phase === 'final_answer'),
    )
    .map((event) =>
      event.type === 'text-delta' || event.type === 'assistant-message-delta' ? event.text : '',
    )
    .join('');
}
