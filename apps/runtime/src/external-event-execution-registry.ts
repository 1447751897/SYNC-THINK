export interface ExternalEventExecution {
  eventId: string;
  leaseToken: string;
  runId: string;
}

export interface ExternalEventRegistration {
  shouldAttachCleanup: boolean;
}

export class ExternalEventExecutionRegistry {
  private readonly executionsByEvent = new Map<string, ExternalEventExecution>();
  private readonly eventIdByRun = new Map<string, string>();
  private readonly cleanupRuns = new Set<string>();

  register(execution: ExternalEventExecution): ExternalEventRegistration {
    this.executionsByEvent.set(execution.eventId, { ...execution });
    this.eventIdByRun.set(execution.runId, execution.eventId);
    const shouldAttachCleanup = !this.cleanupRuns.has(execution.runId);
    this.cleanupRuns.add(execution.runId);
    return { shouldAttachCleanup };
  }

  activeCount(): number {
    return this.executionsByEvent.size;
  }

  eventIds(): string[] {
    return [...this.executionsByEvent.keys()];
  }

  getByEvent(eventId: string): ExternalEventExecution | undefined {
    const execution = this.executionsByEvent.get(eventId);
    return execution ? { ...execution } : undefined;
  }

  getByRun(runId: string): ExternalEventExecution | undefined {
    const eventId = this.eventIdByRun.get(runId);
    if (!eventId) return undefined;
    const execution = this.executionsByEvent.get(eventId);
    return execution?.runId === runId ? { ...execution } : undefined;
  }

  completeRun(runId: string): ExternalEventExecution | undefined {
    const execution = this.getByRun(runId);
    if (!execution) return undefined;
    this.cleanupRuns.delete(runId);
    this.eventIdByRun.delete(runId);
    this.executionsByEvent.delete(execution.eventId);
    return execution;
  }
}
