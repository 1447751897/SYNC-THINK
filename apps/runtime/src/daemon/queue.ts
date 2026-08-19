/**
 * 并发队列（spec T9 + Q5a）：多任务同时到期的并发控制。
 *
 * - 并发上限（maxConcurrent，默认 2，1–8）内并行执行；超限任务进入
 *   数据库队列表（daemon_task_queue，非内存队列——进程重启不丢）
 * - 同一任务重入（上次没跑完又到点）→ 不排队，跳过本次（spec Q5b）
 * - 完成回调自动出队（队首任务获得空出的槽位）
 *
 * 本模块是执行管理器（信号量 + running 跟踪 + 入队回调），DB 持久化
 * 由消费方（daemon main 的 store）提供 enqueue/dequeue 实现。
 */

export interface TaskQueueStore {
  /** 任务入队（返回是否成功入队）。 */
  enqueue(taskId: string): boolean;
  /** 取队首任务（无则 undefined）。 */
  dequeue(): string | undefined;
}

export interface ConcurrencyManagerOptions {
  maxConcurrent: number;
  /** 任务超限入队（由消费方持久化到 DB）。 */
  enqueue: (taskId: string) => boolean;
  /** 排队队列存储（可选，默认内存；DB 实现供进程重启不丢）。 */
  store?: TaskQueueStore;
}

/**
 * 并发执行管理器：信号量 + running 跟踪 + 排队。
 * - acquire(taskId)：上限内且未在跑 → 占用槽位返回 true；超限 → 入队返回 false
 * - release(taskId)：释放槽位（runn 完成）
 * - isRunning(taskId)：同任务重入检测
 */
export class TaskConcurrencyManager {
  private readonly running = new Set<string>();
  private maxConcurrent: number;
  private readonly enqueueFn: (taskId: string) => boolean;
  private readonly store: TaskQueueStore;

  constructor(options: ConcurrencyManagerOptions) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
    this.enqueueFn = options.enqueue;
    this.store = options.store ?? {
      enqueue: this.enqueueFn,
      dequeue: () => undefined,
    };
  }

  /** 尝试获取执行槽位：有槽且未在跑 → 占用；超限 → 入队。 */
  acquire(taskId: string): boolean {
    if (this.running.has(taskId)) return false;
    if (this.running.size < this.maxConcurrent) {
      this.running.add(taskId);
      return true;
    }
    this.store.enqueue(taskId);
    return false;
  }

  /** 释放槽位（run 完成）。返回空出的槽位是否被队首任务占用。 */
  release(taskId: string): void {
    this.running.delete(taskId);
  }

  /** 同任务是否正在执行（重入检测）。 */
  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  /** 当前执行中的任务数。 */
  activeCount(): number {
    return this.running.size;
  }

  /** 运行中修改并发上限（设置生效无需重启）。 */
  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(value));
  }
}
