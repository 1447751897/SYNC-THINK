/**
 * 守护进程执行路径选择（spec Q4）：桌面活着 → 投递；关着 → 自拉 worker。
 *
 * 本模块只做「决策与指令构造」（纯函数，可测）；真实管道投递与进程
 * spawn 由消费方（daemon main）执行。
 */

import type { ScheduledTask, ScheduledTaskTarget } from '@sync-think/shared';

/** 投递给桌面 runtime 的任务指令（帧协议语义见 spec 投递协议章节）。 */
export interface TaskDispatchCommand {
  taskId: string;
  instruction: string;
  target: ScheduledTaskTarget;
  skillVersionIds: string[];
  workspaceId?: string;
}

/** 执行路径判定结果。 */
export type DispatchResult = { kind: 'dispatched' } | { kind: 'spawn-worker' };

/** 由任务构造投递指令（纯函数）。 */
export function composeTaskCommand(task: ScheduledTask): TaskDispatchCommand {
  return {
    taskId: task.id,
    instruction: task.instruction,
    target: task.target,
    skillVersionIds: task.skillVersionIds ?? [],
    workspaceId: task.workspaceId,
  };
}

/**
 * 判定执行路径：桌面管道活着 → 投递；否则 → 自拉 worker。
 * 探测由消费方实现（probePipe），此处仅判定。
 */
export function chooseDispatchPath(desktopAlive: boolean): DispatchResult {
  return desktopAlive ? { kind: 'dispatched' } : { kind: 'spawn-worker' };
}
