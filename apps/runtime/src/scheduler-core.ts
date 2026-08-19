/**
 * 守护进程调度核心（纯函数，注入时间，可独立测试）。
 *
 * 定位（见 docs/engineering/07-daemon-architecture.md §3 与 spec Testing
 * Decisions Seam 1）：这是「唯一调度者」的决策大脑——任务到点该做什么
 * （触发 / 排队 / 跳过 / 接管）、守护进程错过后的补跑判定、任务与定时器
 * 的同步语义，全部收敛为注入时间的纯函数，不碰任何 I/O。
 *
 * 设计边界：
 * - 本模块不落库、不 spawn、不注册真实定时器；所有时间经参数注入。
 * - 决策输出 = 动作（SchedulerAction）+ 新状态（TaskStatus）+ 推进后的
 *   nextRunAt；消费方（daemon / 桌面 runtime）负责执行副作用。
 * - 复用 task-scheduler.ts 的 nextRunAt / randomPlanForDate 计算，
 *   不重复实现规则语义。
 *
 * 状态机（spec Implementation Decisions，实现必须精确遵守）：
 *   pending → due            croner 到点
 *   due     → running        并发上限内有空位
 *   due     → queued         并发已满，进入数据库队列
 *   queued  → running        有空位，按序出队
 *   running → success        执行完成（终态回填摘要）
 *   running → failed_app     用户主动关闭应用（不重试，等下次周期）
 *   running → failed_crash   应用崩溃/被强杀 → 自动重试一次 → 再失败则终态
 *   running → hung           投递 30s 无 ack → 接管：自拉 worker
 *   running → skipped        同任务重入（reason: 上次执行中）
 *   pending → catchup        守护进程错过 ≤24h（关机/崩溃期间）
 *   catchup → queued         限量补跑（latest_only，每任务最多 1 次）
 */

import type {
  ScheduledTask,
  ScheduledTaskHistoryEntry,
  ScheduledTaskRunStatus,
  TaskRule,
} from '@sync-think/shared';
import {
  computeNextRunAt,
  dateString,
  randomPlanForDate,
} from './task-scheduler.js';

// ── 领域状态（状态机节点）──────────────────────────────────────────────────

export type TaskStatus =
  | 'pending'
  | 'due'
  | 'running'
  | 'queued'
  | 'success'
  | 'failed_app'
  | 'failed_crash'
  | 'hung'
  | 'skipped'
  | 'catchup';

/** 历史记录的 reason 语义（spec 数据库章节）。 */
export const TASK_REASON = {
  APP_CLOSED: 'app-closed',
  RUNTIME_CRASH: 'runtime-crash',
  DESKTOP_HUNG: 'desktop-hung',
  CONCURRENCY_LIMIT: '并发上限',
  PREVIOUS_RUNNING: '上次执行中',
  CATCHUP: 'catchup',
} as const;

export type TaskReason = (typeof TASK_REASON)[keyof typeof TASK_REASON];

// ── 决策输入 / 输出 ─────────────────────────────────────────────────────────

/** 调度决策时所需的「任务运行状态」快照（消费方从自身状态构建）。 */
export interface TaskRuntimeState {
  /** 该任务当前是否正在执行（有 in-flight run / worker）。 */
  running: boolean;
  /** 上次投递时间戳（ISO）。接管判定用；无投递历史为 undefined。 */
  dispatchedAt?: string;
  /** 是否已收到 ack（桌面在线投递路径）。 */
  acked?: boolean;
  /** 当前并发占用（执行中的任务数）。 */
  activeRuns: number;
  /** 该任务已重试次数（runtime-crash 自动重试用，上限 1）。 */
  retryCount?: number;
}

/** 调度决策输出：消费方据此执行副作用并推进状态。 */
export type SchedulerAction =
  | { type: 'fire' } // 立即触发（投递或自拉由消费方决定）
  | { type: 'enqueue' } // 并发满，入数据库队列表
  | { type: 'skip'; reason: TaskReason } // 跳过本次，记 skipped 历史
  | { type: 'takeover'; reason: TaskReason } // 投递 30s 无 ack → 接管
  | { type: 'catchup' } // 限量补跑（≤24h + latest_only）
  | { type: 'defer' } // 错过 >24h，直接顺延
  | { type: 'advance' }; // 正常推进到下一次（无需本次动作）

/** 一次调度决策的完整结果。 */
export interface SchedulerDecision {
  action: SchedulerAction;
  status: TaskStatus;
  /** 本次决策后应写入任务的下次触发时间（undefined = 单次完成 / 停用）。 */
  nextRunAt?: string;
  /** 需要写入历史的原因（skip / failed_* 时）。 */
  reason?: TaskReason;
}

// ── 常量 ───────────────────────────────────────────────────────────────────

export const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;
export const DEFAULT_CATCHUP_WINDOW_MS = 24 * 60 * 60_000;
export const CATCHUP_MAX_PER_TASK = 1;

// ── 到点决策（Seam 1 主函数：due → 下一步动作）────────────────────────────

/** 到点任务的决策上下文。 */
export interface DueContext {
  task: ScheduledTask;
  state: TaskRuntimeState;
  /** 当前时间（注入）。 */
  now: Date;
  /** 并发上限（1–8，默认 2）。 */
  maxConcurrent: number;
  /** 投递超时阈值（毫秒，默认 30_000）。 */
  dispatchTimeoutMs?: number;
}

/**
 * 决策顺序（与 spec 状态机一致）：
 * 1. 同任务重入（上次没跑完又到点）→ skip(上次执行中)
 * 2. 投递超时（dispatchedAt 后 30s 无 ack）→ takeover(desktop-hung)
 * 3. 并发分配：上限内 → fire；超限 → enqueue（不跳过）
 * 4. 正常推进 → advance（无动作；下次到点再说）
 */
export function decideDue(ctx: DueContext): SchedulerDecision {
  const { task, state, now } = ctx;
  const dispatchTimeout = ctx.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;

  // 1. 同任务重入：上次没跑完又到点 → 跳过 + 记录（不排队追跑）。
  if (state.running) {
    return {
      action: { type: 'skip', reason: TASK_REASON.PREVIOUS_RUNNING },
      status: 'skipped',
      nextRunAt: computeNextRunAt(task, now.toISOString(), now),
      reason: TASK_REASON.PREVIOUS_RUNNING,
    };
  }

  // 2. 投递超时：dispatch 发出但超时无 ack → 接管（自拉 worker）。
  if (state.dispatchedAt && !state.acked) {
    const sinceDispatch = now.getTime() - Date.parse(state.dispatchedAt);
    if (sinceDispatch >= dispatchTimeout) {
      return {
        action: { type: 'takeover', reason: TASK_REASON.DESKTOP_HUNG },
        status: 'hung',
        reason: TASK_REASON.DESKTOP_HUNG,
      };
    }
  }

  // 3. 并发分配：上限内直接触发；超限排队（不跳过）。
  if (state.activeRuns >= ctx.maxConcurrent) {
    return {
      action: { type: 'enqueue' },
      status: 'queued',
      reason: TASK_REASON.CONCURRENCY_LIMIT,
    };
  }

  // 4. 正常触发：推进 nextRunAt 并执行。
  return {
    action: { type: 'fire' },
    status: 'running',
    nextRunAt: computeNextRunAt(task, now.toISOString(), now),
  };
}

// ── 补跑决策（守护进程错过：pending → catchup / defer）─────────────────────

/** 补跑判定的输入（守护进程启动扫描 / 定时器触发时发现 nextRunAt 已过期）。 */
export interface CatchupContext {
  task: ScheduledTask;
  /** 当前时间（注入）。 */
  now: Date;
  /** 补跑窗口（毫秒，默认 24h）。 */
  catchupWindowMs?: number;
  /** 该任务已补跑次数（latest_only：每任务最多 1 次）。 */
  catchupCount?: number;
}

/**
 * 限量补跑判定：
 * - 错过 ≤24h 且未补跑过 → catchup（每任务最多 1 次，latest_only）
 * - 错过 >24h → defer（直接顺延到下一次，不补跑）
 * - 未错过（nextRunAt 在未来或缺失）→ 无动作（advance）
 */
export function decideCatchup(ctx: CatchupContext): SchedulerDecision {
  const { task, now } = ctx;
  const window = ctx.catchupWindowMs ?? DEFAULT_CATCHUP_WINDOW_MS;

  if (!task.nextRunAt) return { action: { type: 'advance' }, status: 'pending' };

  const missedMs = now.getTime() - Date.parse(task.nextRunAt);
  if (missedMs <= 0) return { action: { type: 'advance' }, status: 'pending' };

  if (missedMs <= window && (ctx.catchupCount ?? 0) < CATCHUP_MAX_PER_TASK) {
    return { action: { type: 'catchup' }, status: 'catchup', reason: TASK_REASON.CATCHUP };
  }

  return {
    action: { type: 'defer' },
    status: 'pending',
    nextRunAt: computeNextRunAt(task, now.toISOString(), now),
  };
}

// ── 规则 → 定时器形态（spec 调度核心：四种规则映射）────────────────────────

/** 规则触发的定时器形态：一次性（at / random 当日点）或循环（every / cron）。 */
export type RuleScheduleShape =
  | { shape: 'once'; at: number } // at / random 当日点 → 一次性定时器
  | { shape: 'recurring' }; // every / cron → croner 循环

/**
 * 把规则映射为定时器形态（只读计算，不注册任何定时器）。
 * - at → 一次性（runAt 时刻）
 * - every / cron → 循环
 * - random → 当天窗口内的确定性随机计划，取 now 之后第一个点作为一次性；
 *   当日计划已耗尽（或非法窗口）→ 退化循环（次日窗口开始时重掷）。
 */
export function ruleScheduleShape(
  task: Pick<ScheduledTask, 'id' | 'rule' | 'timeZone'>,
  now: Date = new Date(),
): RuleScheduleShape {
  const rule = task.rule;
  switch (rule.kind) {
    case 'at':
      return { shape: 'once', at: Date.parse(rule.runAt) };
    case 'every':
    case 'cron':
      return { shape: 'recurring' };
    case 'random': {
      const today = dateString(task.timeZone, now);
      const points = randomPlanForDate(task, today);
      const first = points.find((point) => point > now.getTime());
      return first !== undefined ? { shape: 'once', at: first } : { shape: 'recurring' };
    }
    default:
      return { shape: 'recurring' };
  }
}

// ── 定时器注册表同步（增删改语义，纯计算）──────────────────────────────────

/** 定时器注册表的一个条目（消费方据此注册 / 注销 / 重注册真实 croner 定时器）。 */
export interface TimerRegistration {
  taskId: string;
  rule: TaskRule;
  shape: RuleScheduleShape;
  timeZone: string;
}

/**
 * 计算「注册表应该长什么样」：输入任务全集 → 输出应注册的定时器集合。
 * 纯函数：调用方与现有注册表 diff，得到注册 / 注销 / 重注册集合。
 * 未启用任务与已完成的单次任务（nextRunAt 为空）不产生注册。
 */
export function desiredRegistrations(
  tasks: ScheduledTask[],
  now: Date = new Date(),
): TimerRegistration[] {
  const result: TimerRegistration[] = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    if (task.rule.kind === 'at' && !task.nextRunAt) continue;
    result.push({
      taskId: task.id,
      rule: task.rule,
      shape: ruleScheduleShape(task, now),
      timeZone: task.timeZone,
    });
  }
  return result;
}

// ── 历史记录辅助（中断/跳过/补跑留 reason，spec 数据库章节）────────────────

/**
 * 从一次调度决策生成应写入的历史条目。返回 undefined 表示成功路径
 * （由执行终态写入 success 历史）。
 */
export function historyFromDecision(
  decision: SchedulerDecision,
  taskId: string,
  firedAt: string,
  runId?: string,
): ScheduledTaskHistoryEntry | undefined {
  const { action, status, reason } = decision;
  const statusMap: Partial<Record<TaskStatus, ScheduledTaskRunStatus>> = {
    skipped: 'skipped',
    failed_app: 'failed',
    failed_crash: 'failed',
    hung: 'failed',
  };
  const entryStatus = statusMap[status];
  if (!entryStatus) return undefined;
  // reason 优先取决策顶层（decideDue/decideCatchup 返回），缺失时回退到动作自带。
  const entryReason =
    reason ??
    (action.type === 'skip' || action.type === 'takeover' ? action.reason : undefined);
  return {
    id: `${taskId}:${firedAt}`,
    taskId,
    status: entryStatus,
    firedAt,
    runId,
    reason: entryReason,
  };
}
