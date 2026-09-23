export interface ScheduledTaskRunMetadata<TTask, TRun> {
  task: TTask;
  firedAt: string;
  run: TRun;
}

export class ScheduledTaskRunRegistry<TTask, TRun> {
  private readonly activeRunIds = new Set<string>();
  private readonly metadataByRun = new Map<string, ScheduledTaskRunMetadata<TTask, TRun>>();

  register(runId: string, metadata: ScheduledTaskRunMetadata<TTask, TRun>): void {
    this.activeRunIds.add(runId);
    this.metadataByRun.set(runId, metadata);
  }

  activeCount(): number {
    return this.activeRunIds.size;
  }

  finishExecution(runId: string): boolean {
    return this.activeRunIds.delete(runId);
  }

  takeMetadata(runId: string): ScheduledTaskRunMetadata<TTask, TRun> | undefined {
    const metadata = this.metadataByRun.get(runId);
    if (metadata) this.metadataByRun.delete(runId);
    return metadata;
  }
}
