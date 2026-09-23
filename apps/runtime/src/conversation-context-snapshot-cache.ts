import type { ContextSnapshot } from './context-snapshot.js';

export class ConversationContextSnapshotCache {
  private readonly snapshotsByThread = new Map<string, Map<string, ContextSnapshot>>();

  get(
    threadId: string,
    modelId: string | undefined,
    kernelId?: string,
  ): ContextSnapshot | undefined {
    if (!modelId) return undefined;
    return this.snapshotsByThread.get(threadId)?.get(snapshotKey(modelId, kernelId));
  }

  set(threadId: string, snapshot: ContextSnapshot): void {
    let snapshotsByTarget = this.snapshotsByThread.get(threadId);
    if (!snapshotsByTarget) {
      snapshotsByTarget = new Map<string, ContextSnapshot>();
      this.snapshotsByThread.set(threadId, snapshotsByTarget);
    }
    snapshotsByTarget.set(snapshotKey(snapshot.status.modelId, snapshot.status.kernelId), snapshot);
  }

  deleteThread(threadId: string): void {
    this.snapshotsByThread.delete(threadId);
  }

  clear(): void {
    this.snapshotsByThread.clear();
  }

  hasThread(threadId: string): boolean {
    return this.snapshotsByThread.has(threadId);
  }

  countForThread(threadId: string): number {
    return this.snapshotsByThread.get(threadId)?.size ?? 0;
  }
}

function snapshotKey(modelId: string, kernelId?: string): string {
  return `${modelId}\u0000${kernelId?.trim() || 'native'}`;
}
