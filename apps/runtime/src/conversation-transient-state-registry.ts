interface ConversationTransientState<Snapshot> {
  sequence: number;
  snapshot?: Snapshot;
}

export type TransientRunKey<ThreadKey extends string> = `${ThreadKey}:${string}`;

/** Owns per-thread transient stream sequencing and the optional active snapshot. */
export class ConversationTransientStateRegistry<ThreadKey extends string, Snapshot> {
  private readonly stateByThread = new Map<ThreadKey, ConversationTransientState<Snapshot>>();
  private readonly stateByRun = new Map<TransientRunKey<ThreadKey>, ConversationTransientState<Snapshot>>();

  private key(threadId: ThreadKey, runId?: string): ThreadKey | TransientRunKey<ThreadKey> {
    return runId ? `${threadId}:${runId}` as TransientRunKey<ThreadKey> : threadId;
  }

  latestSequence(threadId: ThreadKey, runId?: string): number {
    const key = this.key(threadId, runId);
    return (runId ? this.stateByRun.get(key as TransientRunKey<ThreadKey>) : this.stateByThread.get(key as ThreadKey))?.sequence ?? 0;
  }

  advanceSequence(threadId: ThreadKey, runId?: string): number {
    const key = this.key(threadId, runId);
    const map = runId ? this.stateByRun : this.stateByThread;
    const current = map.get(key as never);
    const sequence = (current?.sequence ?? 0) + 1;
    map.set(key as never, {
      sequence,
      ...(current?.snapshot === undefined ? {} : { snapshot: current.snapshot }),
    });
    return sequence;
  }

  getSnapshot(threadId: ThreadKey, runId?: string): Snapshot | undefined {
    const key = this.key(threadId, runId);
    return (runId ? this.stateByRun.get(key as TransientRunKey<ThreadKey>) : this.stateByThread.get(key as ThreadKey))?.snapshot;
  }

  setSnapshot(threadId: ThreadKey, snapshot: Snapshot, runId?: string): void {
    const key = this.key(threadId, runId);
    const map = runId ? this.stateByRun : this.stateByThread;
    const current = map.get(key as never);
    map.set(key as never, {
      sequence: current?.sequence ?? 0,
      snapshot,
    });
  }

  deleteSnapshot(threadId: ThreadKey, runId?: string): boolean {
    const key = this.key(threadId, runId);
    const map = runId ? this.stateByRun : this.stateByThread;
    const current = map.get(key as never);
    if (!current?.snapshot) return false;
    map.set(key as never, { sequence: current.sequence });
    return true;
  }

  /** Remove only a run-owned snapshot when the active stream is still the same run. */
  deleteSnapshotIf(threadId: ThreadKey, predicate: (snapshot: Snapshot) => boolean, runId?: string): boolean {
    const key = this.key(threadId, runId);
    const map = runId ? this.stateByRun : this.stateByThread;
    const current = map.get(key as never);
    if (!current?.snapshot || !predicate(current.snapshot)) return false;
    map.set(key as never, { sequence: current.sequence });
    return true;
  }
}
