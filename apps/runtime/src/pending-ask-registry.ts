import type { AskQuestion } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';

export interface PendingAskResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface PendingAskEntry {
  askId: string;
  runId: RunId;
  threadId: string;
  questions: AskQuestion[];
  createdAt: string;
  resolve(result: PendingAskResult): void;
  onAbort(): void;
}

export class PendingAskRegistry {
  private readonly entries = new Map<string, PendingAskEntry>();

  register(entry: PendingAskEntry): void {
    if (this.entries.has(entry.askId)) {
      throw new Error(`Pending ask already registered: ${entry.askId}`);
    }
    this.entries.set(entry.askId, entry);
  }

  take(askId: string): PendingAskEntry | undefined {
    const entry = this.entries.get(askId);
    if (entry) this.entries.delete(askId);
    return entry;
  }

  delete(askId: string): boolean {
    return this.entries.delete(askId);
  }

  latestForThread(threadId: string): PendingAskEntry | undefined {
    let latest: PendingAskEntry | undefined;
    for (const entry of this.entries.values()) {
      if (entry.threadId !== threadId) continue;
      if (!latest || entry.createdAt > latest.createdAt) latest = entry;
    }
    return latest;
  }

  abortRun(runId: RunId): void {
    for (const [askId, entry] of [...this.entries]) {
      if (entry.runId !== runId) continue;
      entry.onAbort();
      this.entries.delete(askId);
    }
  }
}
