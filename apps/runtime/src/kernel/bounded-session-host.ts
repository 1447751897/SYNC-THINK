import type { KernelAdapter } from '@sync-think/shared';

export interface KernelSessionHostSnapshot {
  size: number;
  active: number;
  idle: number;
  waiting: number;
  keys: string[];
}

export interface KernelSessionLease<T extends KernelAdapter = KernelAdapter> {
  adapter: T;
  release(): void;
}

export interface BoundedKernelSessionHostOptions<T extends KernelAdapter> {
  maxEntries: number;
  idleTimeoutMs: number;
  createAdapter(): T | undefined;
  now?: () => number;
}

interface SessionEntry<T extends KernelAdapter> {
  key: string;
  adapter: T;
  leased: boolean;
  stopping: boolean;
  stopPromise?: Promise<void>;
  lastUsedAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface SessionWaiter<T extends KernelAdapter> {
  key: string;
  signal?: AbortSignal;
  resolve(lease: KernelSessionLease<T>): void;
  reject(error: Error): void;
  abortListener?: () => void;
}

function abortError(): Error {
  const error = new Error('Kernel session acquisition aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Bounds long-lived kernel processes independently from durable conversation
 * sessions. A lease protects an active turn (including approval waits); once
 * released, the adapter is reusable by the same conversation until idle/LRU
 * eviction. Durable thread ids stay in Runtime storage and survive eviction.
 */
export class BoundedKernelSessionHost<T extends KernelAdapter = KernelAdapter> {
  private readonly maxEntries: number;
  private readonly idleTimeoutMs: number;
  private readonly createAdapter: () => T | undefined;
  private readonly now: () => number;
  private readonly entries = new Map<string, SessionEntry<T>>();
  private readonly waiters: SessionWaiter<T>[] = [];
  private draining = false;
  private stopped = false;
  private stopAllPromise?: Promise<void>;

  constructor(options: BoundedKernelSessionHostOptions<T>) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.idleTimeoutMs = Math.max(0, Math.floor(options.idleTimeoutMs));
    this.createAdapter = options.createAdapter;
    this.now = options.now ?? Date.now;
  }

  acquire(key: string, signal?: AbortSignal): Promise<KernelSessionLease<T>> {
    if (this.stopped) return Promise.reject(new Error('Kernel session host is stopped'));
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const waiter: SessionWaiter<T> = { key, signal, resolve, reject };
      if (signal) {
        waiter.abortListener = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.abortListener, { once: true });
      }
      this.waiters.push(waiter);
      void this.drain();
    });
  }

  snapshot(): KernelSessionHostSnapshot {
    let active = 0;
    for (const entry of this.entries.values()) {
      if (entry.leased || entry.stopping) active += 1;
    }
    return {
      size: this.entries.size,
      active,
      idle: [...this.entries.values()].filter((entry) => !entry.leased && !entry.stopping).length,
      waiting: this.waiters.length,
      keys: [...this.entries.keys()],
    };
  }

  stopAll(): Promise<void> {
    if (this.stopAllPromise) return this.stopAllPromise;
    this.stopped = true;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      this.removeAbortListener(waiter);
      waiter.reject(new Error('Kernel session host is stopped'));
    }
    const entries = [...this.entries.values()];
    for (const entry of entries) this.clearIdleTimer(entry);
    this.stopAllPromise = Promise.allSettled(entries.map((entry) => this.stopEntry(entry))).then(
      (results) => {
        const failures: unknown[] = [];
        results.forEach((result, index) => {
          const entry = entries[index]!;
          if (result.status === 'fulfilled') {
            if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
          } else {
            failures.push(result.reason);
          }
        });
        if (failures.length > 0) {
          throw new AggregateError(failures, 'One or more kernel sessions failed to stop');
        }
      },
    );
    return this.stopAllPromise;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped) {
        const waiterIndex = this.waiters.findIndex((waiter) => this.canAcquire(waiter.key));
        if (waiterIndex < 0) return;
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        if (!waiter || waiter.signal?.aborted) {
          if (waiter) {
            this.removeAbortListener(waiter);
            waiter.reject(abortError());
          }
          continue;
        }

        try {
          const lease = await this.fulfill(waiter.key);
          this.removeAbortListener(waiter);
          if (waiter.signal?.aborted) {
            lease.release();
            waiter.reject(abortError());
          } else {
            waiter.resolve(lease);
          }
        } catch (error) {
          this.removeAbortListener(waiter);
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.draining = false;
      if (!this.stopped && this.waiters.some((waiter) => this.canAcquire(waiter.key))) {
        void this.drain();
      }
    }
  }

  private canAcquire(key: string): boolean {
    const existing = this.entries.get(key);
    if (existing) return !existing.leased && !existing.stopping;
    if (this.entries.size < this.maxEntries) return true;
    return this.oldestIdleEntry() !== undefined;
  }

  private async fulfill(key: string): Promise<KernelSessionLease<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) {
        const victim = this.oldestIdleEntry();
        if (!victim) throw new Error('Kernel session capacity is fully leased');
        victim.stopping = true;
        this.clearIdleTimer(victim);
        await this.stopEntry(victim);
        if (this.entries.get(victim.key) === victim) this.entries.delete(victim.key);
        if (this.stopped) throw new Error('Kernel session host is stopped');
      }
      const adapter = this.createAdapter();
      if (!adapter) throw new Error('Kernel adapter not wired');
      entry = {
        key,
        adapter,
        leased: false,
        stopping: false,
        lastUsedAt: this.now(),
      };
      this.entries.set(key, entry);
    }

    this.clearIdleTimer(entry);
    entry.leased = true;
    entry.lastUsedAt = this.now();
    let released = false;
    return {
      adapter: entry.adapter,
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (!current || current.adapter !== entry!.adapter || !current.leased) return;
        current.leased = false;
        current.lastUsedAt = this.now();
        this.scheduleIdleEviction(current);
        void this.drain();
      },
    };
  }

  private oldestIdleEntry(): SessionEntry<T> | undefined {
    let oldest: SessionEntry<T> | undefined;
    for (const entry of this.entries.values()) {
      if (entry.leased || entry.stopping) continue;
      if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) oldest = entry;
    }
    return oldest;
  }

  private scheduleIdleEviction(entry: SessionEntry<T>): void {
    this.clearIdleTimer(entry);
    const expectedLastUsedAt = entry.lastUsedAt;
    entry.idleTimer = setTimeout(() => {
      void this.evictIdle(entry.key, expectedLastUsedAt);
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private async evictIdle(key: string, expectedLastUsedAt: number): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.leased || entry.stopping || entry.lastUsedAt !== expectedLastUsedAt) return;
    entry.stopping = true;
    this.clearIdleTimer(entry);
    try {
      await this.stopEntry(entry);
    } catch {
      // A process that failed to stop keeps occupying capacity so the host can
      // never silently exceed maxEntries. A later stopAll() reuses the same
      // stop promise and still waits for its settlement.
      return;
    }
    if (this.entries.get(key) === entry) this.entries.delete(key);
    void this.drain();
  }

  private stopEntry(entry: SessionEntry<T>): Promise<void> {
    if (!entry.stopPromise) {
      entry.stopping = true;
      entry.stopPromise = Promise.resolve().then(() => entry.adapter.stop());
    }
    return entry.stopPromise;
  }

  private clearIdleTimer(entry: SessionEntry<T>): void {
    if (!entry.idleTimer) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }

  private removeAbortListener(waiter: SessionWaiter<T>): void {
    if (!waiter.signal || !waiter.abortListener) return;
    waiter.signal.removeEventListener('abort', waiter.abortListener);
    waiter.abortListener = undefined;
  }
}
