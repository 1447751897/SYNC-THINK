import type { ConversationListMessagesResponse, RunProcessView } from '@sync-think/protocol';
import type { ConversationStreamDraft } from './chat-stream.js';
import type { ConversationDisplayQueueItem } from './chat-transient-stream.js';

export interface CachedConversationDisplay {
  threadId?: string;
  draft: ConversationStreamDraft | null;
  runProcesses: ReadonlyMap<string, RunProcessView>;
  lastTransientSequence: number;
  lastDurableSequence: number;
  pendingDisplayQueue: readonly ConversationDisplayQueueItem[];
  taskPlan?: NonNullable<ConversationListMessagesResponse['taskPlan']>;
}

/** Renderer-local display snapshots; no DOM, IPC handles or persistent browser storage. */
export class ConversationDisplayCache {
  private readonly snapshots = new Map<string, CachedConversationDisplay>();

  constructor(
    private readonly capacity = 8,
    private readonly processLimit = 50,
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(processLimit) ||
      processLimit < 1
    )
      throw new Error('Invalid conversation display cache limits');
  }

  read(scopeKey: string): CachedConversationDisplay | undefined {
    const snapshot = this.snapshots.get(scopeKey);
    if (!snapshot) return undefined;
    this.snapshots.delete(scopeKey);
    this.snapshots.set(scopeKey, snapshot);
    return snapshot;
  }

  write(scopeKey: string, snapshot: CachedConversationDisplay): void {
    const processes = new Map(snapshot.runProcesses);
    const activeRunId = snapshot.draft?.runId;
    // Prefer the live turn over older historical processes when trimming.
    if (activeRunId && processes.has(activeRunId)) {
      const active = processes.get(activeRunId)!;
      processes.delete(activeRunId);
      processes.set(activeRunId, active);
    }
    while (processes.size > this.processLimit) processes.delete(processes.keys().next().value!);
    this.snapshots.delete(scopeKey);
    this.snapshots.set(scopeKey, {
      ...snapshot,
      runProcesses: processes,
      pendingDisplayQueue: [...snapshot.pendingDisplayQueue],
    });
    while (this.snapshots.size > this.capacity)
      this.snapshots.delete(this.snapshots.keys().next().value!);
  }

  clear(): void {
    this.snapshots.clear();
  }
}

export const recentConversationDisplayCache = new ConversationDisplayCache();
