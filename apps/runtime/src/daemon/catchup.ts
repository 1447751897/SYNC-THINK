/**
 * 限量补跑（spec T10 + Q13）：守护进程错过任务（关机/自身崩溃）后开机补跑。
 *
 * - ≤24h 窗口内错过且未补跑过 → catchup（每任务最多 1 次，latest_only）
 * - 错过 >24h → defer（直接顺延到下一次，不补跑）
 * - 未错过 / 已停用 / 单次已完成 → 无动作
 *
 * 本模块是纯计算（planCatchupSweep），消费方（daemon main）负责执行
 * 补跑副作用（fireTask）与持久化 nextRunAt。
 */

import type { ScheduledTask } from '@sync-think/shared';
import {
  decideCatchup,
  type SchedulerDecision,
} from '../scheduler-core.js';

export type CatchupActionType = 'catchup' | 'defer';

export interface CatchupAction {
  taskId: string;
  action: CatchupActionType;
  /** defer 时更新任务的下次触发（其余情况由 fireTask 流程推进）。 */
  nextRunAt?: string;
  decision: SchedulerDecision;
}

export interface CatchupSweepPlan {
  actions: CatchupAction[];
  /** 本次补跑的任务数。 */
  catchupCount: number;
}

export interface PlanCatchupSweepInput {
  tasks: ScheduledTask[];
  /** 当前时间（注入）。 */
  now: Date;
  /** 补跑窗口（毫秒，默认 24h）。 */
  catchupWindowMs?: number;
  /** 各任务已补跑次数（latest_only 去重）。 */
  catchupCounts?: Map<string, number>;
}

/**
 * 补跑扫描：遍历全部启用任务 → decideCatchup → 动作列表。
 * 纯函数（时间注入、计数注入），消费方执行副作用。
 */
export function planCatchupSweep(input: PlanCatchupSweepInput): CatchupSweepPlan {
  const actions: CatchupAction[] = [];
  let catchupCount = 0;

  for (const task of input.tasks) {
    if (!task.enabled) continue;
    if (!task.nextRunAt) continue; // 单次已完成

    const decision = decideCatchup({
      task,
      now: input.now,
      catchupWindowMs: input.catchupWindowMs,
      catchupCount: input.catchupCounts?.get(task.id) ?? 0,
    });

    if (decision.action.type === 'catchup') {
      actions.push({ taskId: task.id, action: 'catchup', decision });
      catchupCount += 1;
    } else if (decision.action.type === 'defer') {
      actions.push({
        taskId: task.id,
        action: 'defer',
        nextRunAt: decision.nextRunAt,
        decision,
      });
    }
    // advance（未错过）→ 无动作。
  }

  return { actions, catchupCount };
}
