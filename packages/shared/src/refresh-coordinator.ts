interface RefreshWaiter<Result> {
  generation: number;
  resolve(result: Result): void;
  reject(error: unknown): void;
}

export interface RefreshCoordinatorOptions {
  /** Start immediately instead of coalescing requests made in the same task. */
  deferStart?: boolean;
  /** Reject requests received during a failed load instead of running a trailing load. */
  rejectPendingOnFailure?: boolean;
}

/**
 * Coalesces refresh requests while ensuring requests made during an active
 * load are not satisfied by that older load.
 */
export class RefreshCoordinator<Result> {
  private requestedGeneration = 0;
  private completedGeneration = 0;
  private running = false;
  private readonly waiters: RefreshWaiter<Result>[] = [];

  constructor(
    private readonly load: () => Promise<Result>,
    private readonly options: RefreshCoordinatorOptions = {},
  ) {}

  request(): Promise<Result> {
    const generation = ++this.requestedGeneration;
    const result = new Promise<Result>((resolve, reject) => {
      this.waiters.push({ generation, resolve, reject });
    });
    if (!this.running) {
      this.running = true;
      if (this.options.deferStart === false) void this.drain();
      else void Promise.resolve().then(() => this.drain());
    }
    return result;
  }

  private async drain(): Promise<void> {
    try {
      while (this.completedGeneration < this.requestedGeneration) {
        const generation = this.requestedGeneration;
        let completedThrough = generation;
        try {
          const result = await this.load();
          this.settleThrough(generation, (waiter) => waiter.resolve(result));
        } catch (error) {
          completedThrough = this.options.rejectPendingOnFailure
            ? this.requestedGeneration
            : generation;
          this.settleThrough(completedThrough, (waiter) => waiter.reject(error));
        }
        this.completedGeneration = completedThrough;
      }
    } finally {
      this.running = false;
    }
  }

  private settleThrough(generation: number, settle: (waiter: RefreshWaiter<Result>) => void): void {
    let writeIndex = 0;
    for (const waiter of this.waiters) {
      if (waiter.generation <= generation) settle(waiter);
      else this.waiters[writeIndex++] = waiter;
    }
    this.waiters.length = writeIndex;
  }
}
