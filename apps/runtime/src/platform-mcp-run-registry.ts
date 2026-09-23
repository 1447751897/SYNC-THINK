export class PlatformMcpRunRegistry<TDefinition, TBroker, TResult> {
  private readonly catalogsByRun = new Map<string, readonly TDefinition[]>();
  private readonly resultsByRun = new Map<string, Map<string, Promise<TResult>>>();
  private readonly brokersByRun = new Map<string, TBroker>();

  setCatalog(runId: string, catalog: readonly TDefinition[]): void {
    this.catalogsByRun.set(runId, catalog);
  }

  getCatalog(runId: string): readonly TDefinition[] | undefined {
    return this.catalogsByRun.get(runId);
  }

  getOrCreateBroker(runId: string, create: () => TBroker): TBroker {
    const existing = this.brokersByRun.get(runId);
    if (existing) return existing;
    const broker = create();
    this.brokersByRun.set(runId, broker);
    return broker;
  }

  async executeOnce(
    runId: string,
    replayKey: string,
    execute: () => Promise<TResult>,
    retain: (result: TResult) => boolean,
  ): Promise<TResult> {
    let results = this.resultsByRun.get(runId);
    if (!results) {
      results = new Map<string, Promise<TResult>>();
      this.resultsByRun.set(runId, results);
    }
    const replayed = results.get(replayKey);
    if (replayed) return replayed;

    const pending = execute();
    results.set(replayKey, pending);
    const result = await pending;
    if (!retain(result)) results.delete(replayKey);
    return result;
  }

  deleteRun(runId: string): void {
    this.catalogsByRun.delete(runId);
    this.resultsByRun.delete(runId);
    this.brokersByRun.delete(runId);
  }
}
