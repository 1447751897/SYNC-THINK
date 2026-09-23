/** Process-local ownership of runs that are currently executing. */
export class ActiveRunRegistry {
  private readonly runIds = new Set<string>();

  start(runId: string): boolean {
    if (this.runIds.has(runId)) return false;
    this.runIds.add(runId);
    return true;
  }

  finish(runId: string): boolean {
    return this.runIds.delete(runId);
  }

  has(runId: string): boolean {
    return this.runIds.has(runId);
  }

  count(): number {
    return this.runIds.size;
  }

  ids(): string[] {
    return [...this.runIds];
  }

  clear(): void {
    this.runIds.clear();
  }
}
