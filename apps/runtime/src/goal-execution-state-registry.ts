/** Owns in-memory Goal cache, run revision bindings, and pending-turn markers. */
export class GoalExecutionStateRegistry<
  ConversationKey extends string,
  RunKey extends string,
  Goal,
> {
  private readonly goals = new Map<ConversationKey, Goal>();
  private readonly runRevisions = new Map<RunKey, string>();
  private readonly pendingTurns = new Set<ConversationKey>();

  cachedGoal(conversationId: ConversationKey): Goal | undefined {
    return this.goals.get(conversationId);
  }

  cacheGoal(conversationId: ConversationKey, goal: Goal): void {
    this.goals.set(conversationId, goal);
  }

  goalCount(): number {
    return this.goals.size;
  }

  bindRunRevision(runId: RunKey, revision: string): void {
    this.runRevisions.set(runId, revision);
  }

  revisionForRun(runId: RunKey): string | undefined {
    return this.runRevisions.get(runId);
  }

  takeRunRevision(runId: RunKey): string | undefined {
    const revision = this.runRevisions.get(runId);
    this.runRevisions.delete(runId);
    return revision;
  }

  hasRunRevision(runId: RunKey): boolean {
    return this.runRevisions.has(runId);
  }

  markPending(conversationId: ConversationKey): void {
    this.pendingTurns.add(conversationId);
  }

  clearPending(conversationId: ConversationKey): void {
    this.pendingTurns.delete(conversationId);
  }

  isPending(conversationId: ConversationKey): boolean {
    return this.pendingTurns.has(conversationId);
  }
}
