export interface TurnQueueLease {
  waitForTurn: Promise<void>;
  release(): void;
}

/** Serializes turns sharing one key while allowing unrelated keys to proceed. */
export class KeyedTurnQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(key: string): TurnQueueLease {
    const previousTail = this.tails.get(key) ?? Promise.resolve();
    const waitForTurn = previousTail.catch(() => undefined);
    let resolveTurn!: () => void;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const nextTail = waitForTurn.then(() => turnCompleted);
    this.tails.set(key, nextTail);
    let released = false;
    return {
      waitForTurn,
      release: () => {
        if (released) return;
        released = true;
        resolveTurn();
        void nextTail.finally(() => {
          if (this.tails.get(key) === nextTail) this.tails.delete(key);
        });
      },
    };
  }

  async waitForAll(): Promise<void> {
    if (this.tails.size === 0) return;
    await Promise.allSettled([...this.tails.values()]);
  }

  count(): number {
    return this.tails.size;
  }
}
