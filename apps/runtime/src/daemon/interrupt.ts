/**
 * 中断分类与接管（spec T8 + Q10）。
 *
 * 执行中断按「谁造成」分类（Multica 验证模式）：
 *   - 用户主动关闭应用（桌面退出前发 abort）→ app-closed，不重试
 *   - 应用崩溃/被强杀（无 abort，daemon 检测桌面管道断开）→ runtime-crash，
 *     自动重试一次（从指令开头重跑；第一版无续跑能力，副作用可能重复——
 *     已拍板取舍）
 *   - 桌面假死（投递 30s 无 ack）→ desktop-hung，daemon 自拉 worker 接管
 *
 * 本模块为纯逻辑：分类决策 + 投递任务跟踪，不碰 I/O（消费方 daemon main
 * 负责探测/写历史/spawn）。
 */

// ── 中断分类（纯函数）──────────────────────────────────────────────────────

export type InterruptionStatus = 'none' | 'app-closed' | 'runtime-crash' | 'desktop-hung';

export interface InterruptionClassification {
  status: InterruptionStatus;
  /** 是否需要自动重试（仅 runtime-crash 且未重试过）。 */
  retry: boolean;
}

export interface ClassifyInterruptionInput {
  /** 桌面是否发送过 abort（用户主动关闭）。 */
  aborted: boolean;
  /** 桌面管道当前是否存活。 */
  desktopAlive: boolean;
  /** 该任务是否已经重试过一次。 */
  alreadyRetried: boolean;
}

/**
 * 中断分类（spec Q10 语义）：
 * - aborted → app-closed，不重试（等下次周期）
 * - 未 abort + 桌面死 + 未重试 → runtime-crash，重试一次
 * - 未 abort + 桌面死 + 已重试 → runtime-crash，终态（不再重试）
 * - 桌面活着 → 无中断
 */
export function classifyInterruption(input: ClassifyInterruptionInput): InterruptionClassification {
  if (input.aborted) return { status: 'app-closed', retry: false };
  if (!input.desktopAlive) {
    return {
      status: 'runtime-crash',
      retry: !input.alreadyRetried,
    };
  }
  return { status: 'none', retry: false };
}

// ── 投递任务跟踪 ───────────────────────────────────────────────────────────

export interface DispatchedEntry {
  taskId: string;
  dispatchedAt: string;
  aborted: boolean;
  completed: boolean;
  retried: boolean;
}

/**
 * 投递任务跟踪：daemon 记录「已投递给桌面、尚未确认完成」的任务，
 * 用于崩溃检测与接管判定。
 */
export class DispatchedTracker {
  private readonly entries = new Map<string, DispatchedEntry>();

  add(taskId: string, dispatchedAt: Date): void {
    this.entries.set(taskId, {
      taskId,
      dispatchedAt: dispatchedAt.toISOString(),
      aborted: false,
      completed: false,
      retried: false,
    });
  }

  get(taskId: string): DispatchedEntry | undefined {
    return this.entries.get(taskId);
  }

  markAborted(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry) entry.aborted = true;
  }

  markCompleted(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry) {
      entry.completed = true;
      this.entries.delete(taskId);
    }
  }

  markRetried(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry) entry.retried = true;
  }

  /** 全部未完成（含 aborted，供历史处置）。 */
  list(): DispatchedEntry[] {
    return [...this.entries.values()];
  }

  /** 需要崩溃评估的任务（未完成、未 abort）。 */
  listPending(): string[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.completed && !entry.aborted)
      .map((entry) => entry.taskId);
  }
}

/**
 * 处理 abort 事件：用户主动关闭 → app-closed，不重试，从跟踪移除。
 * 返回分类结果（未知任务返回 null）。
 */
export function applyAbort(
  tracker: DispatchedTracker,
  taskId: string,
): InterruptionClassification | null {
  const entry = tracker.get(taskId);
  if (!entry) return null;
  tracker.markAborted(taskId);
  tracker.markCompleted(taskId); // 移除跟踪（不重试）
  return { status: 'app-closed', retry: false };
}
