export interface OwnedSubscription<Owner> {
  socket: Owner;
}

/** Owns stream subscriptions and their connection-scoped cleanup lifecycle. */
export class OwnedSubscriptionRegistry<Owner, Subscription extends OwnedSubscription<Owner>> {
  private readonly subscriptions = new Map<string, Subscription>();

  register(streamId: string, subscription: Subscription): void {
    this.subscriptions.set(streamId, subscription);
  }

  find(streamId: string): Subscription | undefined {
    return this.subscriptions.get(streamId);
  }

  remove(streamId: string): boolean {
    return this.subscriptions.delete(streamId);
  }

  removeOwnedBy(owner: Owner): number {
    let removed = 0;
    for (const [streamId, subscription] of this.subscriptions) {
      if (subscription.socket !== owner) continue;
      this.subscriptions.delete(streamId);
      removed += 1;
    }
    return removed;
  }

  visit(visitor: (streamId: string, subscription: Subscription) => void): void {
    for (const [streamId, subscription] of this.subscriptions) {
      visitor(streamId, subscription);
    }
  }

  count(): number {
    return this.subscriptions.size;
  }

  clear(): void {
    this.subscriptions.clear();
  }
}
