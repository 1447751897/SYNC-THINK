import { describe, expect, it } from 'vitest';
import { KeyedTurnQueue } from './keyed-turn-queue.js';

describe('KeyedTurnQueue', () => {
  it('serializes turns with the same key', async () => {
    const queue = new KeyedTurnQueue();
    const first = queue.enqueue('session');
    const second = queue.enqueue('session');
    let secondStarted = false;
    void second.waitForTurn.then(() => {
      secondStarted = true;
    });

    await first.waitForTurn;
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    first.release();
    await second.waitForTurn;
    expect(secondStarted).toBe(true);
    second.release();
    await queue.waitForAll();
    expect(queue.count()).toBe(0);
  });

  it('allows unrelated keys to proceed independently', async () => {
    const queue = new KeyedTurnQueue();
    const first = queue.enqueue('session-a');
    const second = queue.enqueue('session-b');

    await Promise.all([first.waitForTurn, second.waitForTurn]);
    first.release();
    second.release();
    await queue.waitForAll();
  });

  it('makes release idempotent without advancing another turn twice', async () => {
    const queue = new KeyedTurnQueue();
    const first = queue.enqueue('session');
    const second = queue.enqueue('session');
    const third = queue.enqueue('session');

    await first.waitForTurn;
    first.release();
    first.release();
    await second.waitForTurn;
    let thirdStarted = false;
    void third.waitForTurn.then(() => {
      thirdStarted = true;
    });
    await Promise.resolve();
    expect(thirdStarted).toBe(false);

    second.release();
    await third.waitForTurn;
    third.release();
    await queue.waitForAll();
  });

  it('waits for the latest queued turn on shutdown', async () => {
    const queue = new KeyedTurnQueue();
    const first = queue.enqueue('session');
    const second = queue.enqueue('session');
    let drained = false;
    const drain = queue.waitForAll().then(() => {
      drained = true;
    });

    await first.waitForTurn;
    first.release();
    await second.waitForTurn;
    await Promise.resolve();
    expect(drained).toBe(false);

    second.release();
    await drain;
    expect(drained).toBe(true);
    expect(queue.count()).toBe(0);
  });
});
