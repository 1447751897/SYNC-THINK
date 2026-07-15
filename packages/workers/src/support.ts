import type { WorkerEvent } from './types.js';

// Test/diagnostic helper. Reused across worker tests.
export async function collect(events: AsyncIterable<WorkerEvent>): Promise<WorkerEvent[]> {
  const out: WorkerEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
