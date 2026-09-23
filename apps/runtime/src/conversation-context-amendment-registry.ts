export class ConversationContextAmendmentRegistry {
  private readonly excludedSourceIdsByThread = new Map<string, string[]>();

  replace(threadId: string, sourceIds: readonly string[]): void {
    this.excludedSourceIdsByThread.set(threadId, [...sourceIds]);
  }

  getExcludedSourceIds(threadId: string): string[] {
    return [...(this.excludedSourceIdsByThread.get(threadId) ?? [])];
  }

  clear(threadId: string): void {
    this.excludedSourceIdsByThread.delete(threadId);
  }
}
