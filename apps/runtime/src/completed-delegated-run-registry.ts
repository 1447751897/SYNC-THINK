export interface CompletedDelegatedRunRecord<TRun, TState extends string> {
  run?: TRun;
  state?: TState;
}

/** Retains terminal child state until agent_delegate consumes the result. */
export class CompletedDelegatedRunRegistry<TRun, TState extends string> {
  private readonly records = new Map<string, CompletedDelegatedRunRecord<TRun, TState>>();

  remember(runId: string, run: TRun, state: TState): void {
    this.records.set(runId, { run, state });
  }

  markState(runId: string, state: TState): void {
    this.records.set(runId, { ...this.records.get(runId), state });
  }

  getRun(runId: string): TRun | undefined {
    return this.records.get(runId)?.run;
  }

  take(runId: string): CompletedDelegatedRunRecord<TRun, TState> | undefined {
    const record = this.records.get(runId);
    if (!record) return undefined;
    this.records.delete(runId);
    return { ...record };
  }

  delete(runId: string): boolean {
    return this.records.delete(runId);
  }

  count(): number {
    return this.records.size;
  }
}
