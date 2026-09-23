export class InFlightPromiseRegistry {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }

  count(): number {
    return this.pending.size;
  }

  async waitForAll(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}
