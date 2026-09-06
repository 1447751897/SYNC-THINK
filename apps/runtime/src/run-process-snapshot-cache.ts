import type { RunProcessView } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import type { EventCursor } from '@sync-think/storage';
import { describeRunProcessSnapshot } from './run-process-page.js';

export class RunProcessSnapshotCache {
  private readonly entries = new Map<
    RunId,
    { cursor: EventCursor; process: RunProcessView; bytes: number }
  >();
  private bytes = 0;
  constructor(
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly maxEntries = 8,
  ) {}

  get(
    runId: RunId,
    cursor: EventCursor,
  ): { cursor: EventCursor; process: RunProcessView } | undefined {
    const entry = this.entries.get(runId);
    if (!entry) return undefined;
    if (entry.cursor.sequence !== cursor.sequence || entry.cursor.eventId !== cursor.eventId) {
      this.entries.delete(runId);
      this.bytes -= entry.bytes;
      return undefined;
    }
    this.entries.delete(runId);
    this.entries.set(runId, entry);
    return entry;
  }

  set(runId: RunId, snapshot: { cursor: EventCursor; process: RunProcessView }): void {
    const previous = this.entries.get(runId);
    if (previous) {
      this.entries.delete(runId);
      this.bytes -= previous.bytes;
    }
    const { bytes } = describeRunProcessSnapshot(snapshot.process);
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(runId, { ...snapshot, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
