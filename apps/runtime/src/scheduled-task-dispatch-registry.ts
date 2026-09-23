export interface CompletedTaskDispatch {
  taskId?: string;
  wasDispatched: boolean;
}

export class ScheduledTaskDispatchRegistry {
  private readonly dispatchedTaskIds = new Set<string>();
  private readonly taskIdByRun = new Map<string, string>();

  start(taskId: string): void {
    this.dispatchedTaskIds.add(taskId);
  }

  cancelStart(taskId: string): void {
    this.dispatchedTaskIds.delete(taskId);
  }

  bindRun(runId: string, taskId: string): void {
    this.taskIdByRun.set(runId, taskId);
  }

  completeRun(runId: string): CompletedTaskDispatch {
    const taskId = this.taskIdByRun.get(runId);
    const wasDispatched = taskId ? this.dispatchedTaskIds.has(taskId) : false;
    if (taskId) {
      this.taskIdByRun.delete(runId);
      this.dispatchedTaskIds.delete(taskId);
    }
    return { taskId, wasDispatched };
  }

  pendingTaskIds(): string[] {
    return [...this.dispatchedTaskIds];
  }
}
