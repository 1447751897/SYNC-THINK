/**
 * 守护进程执行路径：优先确保长期 Runtime 存活；只有旧普通任务可降级 worker。
 *
 * 本模块只做「决策与指令构造」（纯函数，可测）；真实管道投递与进程
 * spawn 由消费方（daemon main）执行。
 */

import { parseScheduledTaskAutomation } from '@sync-think/shared';
import type { DispatchResult as RuntimeDispatchResult } from './dispatch-client.js';
import type {
  ScheduledTask,
  ScheduledTaskAutomation,
  ScheduledTaskTarget,
} from '@sync-think/shared';

/** 投递给桌面 runtime 的任务指令（帧协议语义见 spec 投递协议章节）。 */
export interface TaskDispatchCommand {
  taskId: string;
  instruction: string;
  target: ScheduledTaskTarget;
  skillVersionIds: string[];
  workspaceId?: string;
  /** Expected capabilities, not evidence that outputs or delivery have occurred. */
  automation?: ScheduledTaskAutomation;
}

/** 执行路径判定结果。 */
export type DispatchResult = { kind: 'dispatched' } | { kind: 'spawn-worker' };

/** 由任务构造投递指令（纯函数）。 */
export function composeTaskCommand(task: ScheduledTask): TaskDispatchCommand {
  const automation =
    task.automation === undefined ? undefined : parseScheduledTaskAutomation(task.automation);
  if (task.automation !== undefined && !automation)
    throw new Error('scheduledTask.automation_invalid');
  return {
    taskId: task.id,
    instruction: task.instruction,
    target: task.target,
    skillVersionIds: task.skillVersionIds ?? [],
    workspaceId: task.workspaceId,
    ...(automation ? { automation } : {}),
  };
}

/**
 * 旧普通任务的兼容判定；管道属于独立的 Runtime，不代表桌面窗口状态。
 * Managed tasks must use chooseScheduledTaskDispatchPath instead.
 */
export function chooseDispatchPath(runtimeAlive: boolean): DispatchResult {
  return runtimeAlive ? { kind: 'dispatched' } : { kind: 'spawn-worker' };
}

/** Group binding is supplied from persisted conversation metadata, never instruction text. */
export function shouldUseManagedTaskRuntime(task: ScheduledTask, groupBound = false): boolean {
  return task.target.kind === 'team' || task.automation !== undefined || groupBound;
}

export type ScheduledTaskDispatchDecision = DispatchResult | { kind: 'failed'; reason: string };

export function chooseScheduledTaskDispatchPath(
  task: ScheduledTask,
  runtimeReady: boolean,
  groupBound = false,
): ScheduledTaskDispatchDecision {
  if (runtimeReady) return { kind: 'dispatched' };
  return shouldUseManagedTaskRuntime(task, groupBound)
    ? { kind: 'failed', reason: 'managed-runtime-unavailable' }
    : { kind: 'spawn-worker' };
}

/** Ports owned by daemon main; this executor neither constructs a Host nor recovers a DB. */
export interface ScheduledTaskDispatchPorts {
  groupBound?: boolean;
  ensureRuntime(): Promise<boolean>;
  dispatch(command: TaskDispatchCommand): Promise<RuntimeDispatchResult>;
  spawnWorker(task: ScheduledTask): Promise<void>;
  /** Register tracker AND completion/slot callback before awaiting the dispatch ack. */
  registerDispatch(onComplete: () => void): void;
  clearDispatch(): void;
  recordFailure(reason: string): void;
  releaseSlot(): void;
}

/**
 * Every task prefers the single supervised Runtime. Team/automation/group-bound tasks
 * never create a transient worker. Ack timeout is an unknown execution outcome even
 * for legacy tasks: starting another owner could duplicate a browser action or send.
 */
export async function executeScheduledTaskDispatch(
  task: ScheduledTask,
  ports: ScheduledTaskDispatchPorts,
): Promise<ScheduledTaskDispatchDecision> {
  let released = false;
  let retainSlot = false;
  let registered = false;
  let phase: 'ensure' | 'dispatch' | 'worker' = 'ensure';
  let recordedFailure = false;
  const release = (): void => {
    if (released) return;
    released = true;
    ports.releaseSlot();
  };
  const clear = (): void => {
    if (!registered) return;
    registered = false;
    ports.clearDispatch();
  };
  const fail = (reason: string): ScheduledTaskDispatchDecision => {
    if (!recordedFailure) {
      recordedFailure = true;
      ports.recordFailure(reason);
    }
    return { kind: 'failed', reason };
  };
  try {
    const path = chooseScheduledTaskDispatchPath(
      task,
      await ports.ensureRuntime(),
      ports.groupBound,
    );
    if (path.kind === 'failed') return fail(path.reason);
    if (path.kind === 'dispatched') {
      phase = 'dispatch';
      const command = composeTaskCommand(task);
      registered = true;
      ports.registerDispatch(release);
      const result = await ports.dispatch(command);
      // A fast completion can arrive before ack resolves. It already released the
      // slot; do not register a stale release or spawn a duplicate fallback run.
      if (released) return { kind: 'dispatched' };
      if (result.outcome === 'accepted') {
        retainSlot = true;
        return { kind: 'dispatched' };
      }
      clear();
      if (result.outcome === 'timeout') return fail('runtime-dispatch-outcome-unknown');
      if (result.outcome === 'rejected') {
        return fail('runtime-dispatch-rejected' + (result.reason ? ': ' + result.reason : ''));
      }
      // The transport result does not distinguish connect failure from a socket
      // dropping after a frame was written. Never start a second executor after
      // dispatch was attempted, including for legacy tasks.
      return fail(
        (shouldUseManagedTaskRuntime(task, ports.groupBound)
          ? 'managed-runtime-dispatch-unreachable'
          : 'runtime-dispatch-unreachable') + (result.reason ? ': ' + result.reason : ''),
      );
    }
    phase = 'worker';
    await ports.spawnWorker(task);
    return { kind: 'spawn-worker' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('scheduled-task-' + phase + '-failed: ' + message.slice(0, 500));
  } finally {
    try {
      if (!retainSlot) clear();
    } finally {
      if (!retainSlot) release();
    }
  }
}
