import type { RunId } from '@sync-think/shared';
import { BACKGROUND_DELEGATION_IDLE_SECONDS } from './delegation-timeout-policy.js';

export interface DelegationExecutionPorts {
  execute(runId: RunId): Promise<void>;
  abort(runId: RunId): void;
  markTimedOut(runId: RunId): void;
  failBackground(runId: RunId, error: unknown, absoluteTimeoutSeconds: number): void;
  releaseBackground(runId: RunId): void;
  /** Probe authoritative Agent state when the push notification stream is quiet. */
  probeStatus?(runId: RunId): void | Promise<void>;
  reportError(error: unknown): void;
}

interface Execution {
  id: RunId;
  background: boolean;
  stopping: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  statusTimer?: ReturnType<typeof setTimeout>;
  statusDelayMs?: number;
  absoluteTimer?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  done?: Promise<void>;
}

/** Owns execution lifetime only. The host owns admission, run state and durable transitions. */
export class DelegationExecutionController {
  private readonly executions = new Map<RunId, Execution>();
  private stopped = false;

  constructor(private readonly ports: DelegationExecutionPorts) {}

  startBackground(
    runId: RunId,
    absoluteTimeoutSeconds: number,
    statusNotificationTimeoutSeconds?: number,
  ): void {
    const task = this.register(runId, absoluteTimeoutSeconds, true, statusNotificationTimeoutSeconds);
    // The managed promise includes failure reporting and cleanup, so shutdown drains both.
    task.done = this.execute(task)
      .catch((error) => this.ports.failBackground(runId, error, absoluteTimeoutSeconds))
      .finally(() => {
        this.finish(runId);
        this.executions.delete(runId);
        this.ports.releaseBackground(runId);
      })
      .catch((error) => this.ports.reportError(error));
  }

  async runForeground(runId: RunId, timeoutSeconds: number, signal?: AbortSignal): Promise<void> {
    const task = this.register(runId, timeoutSeconds, false);
    // Invoke first so the host has installed its execution AbortController before cancellation.
    task.done = this.execute(task).finally(() => {
      this.finish(runId);
      this.executions.delete(runId);
    });
    if (signal) {
      const cancel = () => this.cancel(runId);
      signal.addEventListener('abort', cancel, { once: true });
      task.removeAbortListener = () => signal.removeEventListener('abort', cancel);
      if (signal.aborted) cancel();
    }
    await task.done;
  }

  /** Only the idle deadline moves; the absolute deadline remains fixed. */
  progress(runId: RunId): void {
    const task = this.executions.get(runId);
    if (!task || !task.background || task.stopping) return;
    clearTimeout(task.idleTimer);
    task.idleTimer = this.timer(task, BACKGROUND_DELEGATION_IDLE_SECONDS * 1_000);
    clearTimeout(task.statusTimer);
    task.statusTimer = undefined;
    this.scheduleStatusProbe(task);
  }

  /** Clear watchdogs at the durable terminal boundary, even if executor cleanup is pending. */
  finish(runId: RunId): void {
    const task = this.executions.get(runId);
    if (!task) return;
    task.stopping = true;
    clearTimeout(task.idleTimer);
    clearTimeout(task.statusTimer);
    clearTimeout(task.absoluteTimer);
    task.removeAbortListener?.();
    task.removeAbortListener = undefined;
  }

  cancel(runId: RunId): boolean {
    const task = this.executions.get(runId);
    if (!task) return false;
    if (!task.stopping) {
      this.finish(runId);
      this.ports.abort(runId);
    }
    return true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const tasks = [...this.executions.values()];
    for (const task of tasks) this.cancel(task.id);
    await Promise.allSettled(tasks.flatMap((task) => (task.done ? [task.done] : [])));
  }

  private register(
    id: RunId,
    timeoutSeconds: number,
    background: boolean,
    statusNotificationTimeoutSeconds?: number,
  ): Execution {
    if (this.stopped) throw new Error('delegation.execution_stopped');
    if (this.executions.has(id)) throw new Error('delegation.execution_already_started');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error('delegation.invalid_timeout');
    }
    const task: Execution = { id, background, stopping: false };
    this.executions.set(id, task);
    task.absoluteTimer = this.timer(task, timeoutSeconds * 1_000);
    if (background) task.idleTimer = this.timer(task, BACKGROUND_DELEGATION_IDLE_SECONDS * 1_000);
    if (
      background &&
      this.ports.probeStatus &&
      Number.isFinite(statusNotificationTimeoutSeconds) &&
      statusNotificationTimeoutSeconds! > 0
    ) {
      task.statusDelayMs = statusNotificationTimeoutSeconds! * 1_000;
      this.scheduleStatusProbe(task);
    }
    return task;
  }

  private timer(
    task: Execution,
    delay: number,
    kind: 'deadline' | 'status' = 'deadline',
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      if (this.executions.get(task.id) !== task || task.stopping) return;
      if (kind === 'status') {
        task.statusTimer = undefined;
        try {
          const probe = this.ports.probeStatus?.(task.id);
          if (probe && typeof (probe as Promise<void>).then === 'function') {
            void Promise.resolve(probe).catch((error) => this.ports.reportError(error));
          }
        } catch (error) {
          this.ports.reportError(error);
        }
        // Keep probing at the same cadence until a progress or terminal
        // notification arrives. `finish` clears the next scheduled probe.
        this.scheduleStatusProbe(task);
        return;
      }
      this.finish(task.id);
      this.ports.markTimedOut(task.id);
      this.ports.abort(task.id);
    }, delay);
    timer.unref?.();
    return timer;
  }

  private scheduleStatusProbe(task: Execution): void {
    if (!this.ports.probeStatus || task.stopping || task.statusTimer) return;
    // The initial timer carries the configured delay. Subsequent resets keep
    // the same delay stored on the task by the controller.
    const delay = task.statusDelayMs;
    if (!delay) return;
    task.statusTimer = this.timer(task, delay, 'status');
  }

  private async execute(task: Execution): Promise<void> {
    // Synchronous adapter exceptions follow the same cleanup path as rejected promises.
    await this.ports.execute(task.id);
  }
}
