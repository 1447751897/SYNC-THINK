/**
 * 守护进程核心：定时器注册表 + 状态快照（纯逻辑，可注入 fake 定时器）。
 *
 * 定位（spec T2）：守护进程骨架的「决策/同步」部分——注册表 diff 同步
 * （新增注册 / 删除注销 / 改规则重注册 / 启动全量重扫）、心跳状态快照。
 * 真实 croner 定时器由消费方经 TimerRegistrar 注入（Seam：可测）。
 */

import type { ScheduledTask } from '@sync-think/shared';

// ── 定时器注册表 ───────────────────────────────────────────────────────────

export interface TimerHandle {
  cancel(): void;
}

/** 真实定时器注册器（消费方用 croner 实现；测试用 fake）。 */
export interface TimerRegistrar {
  registerTimer(taskId: string, fire: () => void): TimerHandle;
  unregisterTimer(taskId: string): void;
}

/**
 * 定时器注册表：对「任务快照」做 diff，注册 / 注销 / 重注册真实定时器。
 * - 新增任务 → 注册
 * - 移除 / 停用任务 → 注销
 * - 规则变化（enabled/rule/nextRunAt 关键字段）→ 重注册
 * - 全量重扫（启动时）→ 按快照重建
 * 触发回调经 onFire 分发，消费方据此执行决策（decideDue 等）。
 */
export class TimerRegistry {
  private readonly handles = new Map<string, TimerHandle>();
  private readonly fireCallbacks = new Map<string, () => void>();
  /** 上次同步的任务快照（用于检测变化）。 */
  private snapshot = new Map<string, string>();

  constructor(private readonly registrar: TimerRegistrar) {}

  /** 计算一个任务是否「注册形态」发生了变化（与上次快照比较）。 */
  private signatureOf(task: ScheduledTask): string {
    return JSON.stringify({
      enabled: task.enabled,
      rule: task.rule,
      nextRunAt: task.nextRunAt ?? null,
      timeZone: task.timeZone,
    });
  }

  /**
   * 同步注册表到任务快照。返回发生变化的 taskId 列表
   * （新增 / 移除 / 重注册），供消费方做日志或统计。
   */
  sync(tasks: ScheduledTask[]): string[] {
    const nextSnapshot = new Map<string, string>();
    const changed: string[] = [];

    for (const task of tasks) {
      const signature = this.signatureOf(task);
      nextSnapshot.set(task.id, signature);
      const previous = this.snapshot.get(task.id);
      if (previous === signature && this.handles.has(task.id)) continue;

      // 新增或规则变化 → 重注册（先注销旧的再注册新的）。
      this.unregister(task.id);
      const handle = this.registrar.registerTimer(task.id, () => {
        this.fireCallbacks.get(task.id)?.();
      });
      this.handles.set(task.id, handle);
      changed.push(task.id);
    }

    // 移除快照中不再存在的任务。
    for (const [taskId] of this.snapshot) {
      if (!nextSnapshot.has(taskId)) {
        this.unregister(taskId);
        changed.push(taskId);
      }
    }

    this.snapshot = nextSnapshot;
    return changed;
  }

  /** 注册触发回调（任务定时器到点后由消费方调用，一次性）。 */
  onFire(taskId: string, callback: () => void): void {
    this.fireCallbacks.set(taskId, callback);
  }

  private unregister(taskId: string): void {
    const handle = this.handles.get(taskId);
    if (handle) handle.cancel();
    this.handles.delete(taskId);
  }

  /** 当前注册的定时器数。 */
  get size(): number {
    return this.handles.size;
  }
}

// ── 状态快照 ───────────────────────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean;
  /** 最近一次心跳时间（ISO）。 */
  heartbeatAt?: string;
  /** 今日触发次数（成功+失败）。 */
  todayFired: number;
  /** 当前排队任务数。 */
  queued: number;
  /** 当前注册的定时器数。 */
  timerCount: number;
}

export function createDaemonStatus(): DaemonStatus {
  return { running: true, todayFired: 0, queued: 0, timerCount: 0 };
}

export interface DaemonStatusUpdate {
  heartbeatAt?: Date;
  todayFired?: number;
  queued?: number;
  timerCount?: number;
}

/** 更新状态快照（不可变：返回新对象）。 */
export function updateDaemonStatus(
  status: DaemonStatus,
  update: DaemonStatusUpdate,
): DaemonStatus {
  return {
    ...status,
    ...(update.heartbeatAt ? { heartbeatAt: update.heartbeatAt.toISOString() } : {}),
    ...(update.todayFired !== undefined ? { todayFired: update.todayFired } : {}),
    ...(update.queued !== undefined ? { queued: update.queued } : {}),
    ...(update.timerCount !== undefined ? { timerCount: update.timerCount } : {}),
  };
}

// ── 状态文件 ───────────────────────────────────────────────────────────────

export interface StatusFileStore {
  write(status: DaemonStatus): Promise<void>;
  read(): Promise<DaemonStatus | undefined>;
}

export interface StatusStore {
  update(status: DaemonStatus): Promise<void>;
  load(): Promise<DaemonStatus | undefined>;
}

export function createStatusStore(store: StatusFileStore): StatusStore {
  return {
    update: (status) => store.write(status),
    load: () => store.read(),
  };
}

export async function readStatusFile(store: StatusFileStore): Promise<DaemonStatus | undefined> {
  return store.read();
}
