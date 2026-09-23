import { describe, expect, it } from 'vitest';
import { OwnedSubscriptionRegistry } from './owned-subscription-registry.js';

interface TestSubscription {
  socket: { id: string };
  cursor: number;
}

describe('OwnedSubscriptionRegistry', () => {
  it('registers, finds and replaces subscriptions by stream id', () => {
    const registry = new OwnedSubscriptionRegistry<object, TestSubscription>();
    const first = { socket: { id: 'socket-1' }, cursor: 1 };
    const replacement = { socket: { id: 'socket-2' }, cursor: 2 };

    registry.register('stream-1', first);
    registry.register('stream-1', replacement);

    expect(registry.find('stream-1')).toBe(replacement);
    expect(registry.count()).toBe(1);
  });

  it('removes only subscriptions owned by the exact connection', () => {
    const registry = new OwnedSubscriptionRegistry<object, TestSubscription>();
    const owner = { id: 'socket-1' };
    const equalButDifferentOwner = { id: 'socket-1' };
    registry.register('stream-1', { socket: owner, cursor: 1 });
    registry.register('stream-2', { socket: owner, cursor: 2 });
    registry.register('stream-3', { socket: equalButDifferentOwner, cursor: 3 });

    expect(registry.removeOwnedBy(owner)).toBe(2);

    expect(registry.find('stream-1')).toBeUndefined();
    expect(registry.find('stream-2')).toBeUndefined();
    expect(registry.find('stream-3')?.socket).toBe(equalButDifferentOwner);
  });

  it('visits live records and permits removal during iteration', () => {
    const registry = new OwnedSubscriptionRegistry<object, TestSubscription>();
    registry.register('stream-1', { socket: { id: 'socket-1' }, cursor: 1 });
    registry.register('stream-2', { socket: { id: 'socket-2' }, cursor: 2 });
    const visited: string[] = [];

    registry.visit((streamId, subscription) => {
      visited.push(streamId);
      subscription.cursor += 10;
      if (streamId === 'stream-1') registry.remove(streamId);
    });

    expect(visited).toEqual(['stream-1', 'stream-2']);
    expect(registry.find('stream-1')).toBeUndefined();
    expect(registry.find('stream-2')?.cursor).toBe(12);
  });

  it('reports removal and clears all subscriptions', () => {
    const registry = new OwnedSubscriptionRegistry<object, TestSubscription>();
    registry.register('stream-1', { socket: { id: 'socket-1' }, cursor: 1 });

    expect(registry.remove('missing')).toBe(false);
    expect(registry.remove('stream-1')).toBe(true);
    registry.register('stream-2', { socket: { id: 'socket-2' }, cursor: 2 });
    registry.clear();

    expect(registry.count()).toBe(0);
  });
});
