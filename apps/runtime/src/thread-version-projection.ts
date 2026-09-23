/** Owns the durable per-thread task-version projection used for OCC and checkpoints. */
export class ThreadVersionProjection<ThreadKey extends string> {
  private readonly versions = new Map<ThreadKey, number>();

  current(threadId: ThreadKey): number | undefined {
    return this.versions.get(threadId);
  }

  record(threadId: ThreadKey, version: number): void {
    this.versions.set(threadId, version);
  }

  recordLatest(threadId: ThreadKey, version: number): void {
    this.versions.set(threadId, Math.max(this.versions.get(threadId) ?? 0, version));
  }

  replace(entries: Iterable<readonly [ThreadKey, number]>): void {
    const replacement = new Map<ThreadKey, number>();
    for (const [threadId, version] of entries) replacement.set(threadId, version);
    this.versions.clear();
    for (const [threadId, version] of replacement) this.versions.set(threadId, version);
  }

  entries(): Array<[ThreadKey, number]> {
    return Array.from(this.versions.entries());
  }

  snapshot(): Map<ThreadKey, number> {
    return new Map(this.versions);
  }

  snapshotWith(threadId: ThreadKey, version: number): Map<ThreadKey, number> {
    return new Map(this.versions).set(threadId, version);
  }

  view(): ReadonlyMap<ThreadKey, number> {
    return this.versions;
  }
}
