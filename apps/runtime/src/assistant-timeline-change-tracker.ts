export interface AssistantTimelineFingerprintCandidate<T> {
  id: string;
  fingerprint: string;
  value: T;
}

export class AssistantTimelineChangeTracker {
  private readonly committedByRun = new Map<string, Map<string, string>>();

  selectChanged<T>(
    runId: string,
    candidates: readonly AssistantTimelineFingerprintCandidate<T>[],
    force = false,
  ): AssistantTimelineFingerprintCandidate<T>[] {
    if (force) return [...candidates];
    const committed = this.committedByRun.get(runId);
    return candidates.filter((candidate) => committed?.get(candidate.id) !== candidate.fingerprint);
  }

  commit<T>(runId: string, candidates: readonly AssistantTimelineFingerprintCandidate<T>[]): void {
    if (candidates.length === 0) return;
    let committed = this.committedByRun.get(runId);
    if (!committed) {
      committed = new Map<string, string>();
      this.committedByRun.set(runId, committed);
    }
    for (const candidate of candidates) committed.set(candidate.id, candidate.fingerprint);
  }

  deleteRun(runId: string): void {
    this.committedByRun.delete(runId);
  }
}
