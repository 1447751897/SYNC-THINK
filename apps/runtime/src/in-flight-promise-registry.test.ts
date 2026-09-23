import { describe, expect, it } from 'vitest';
import { InFlightPromiseRegistry } from './in-flight-promise-registry.js';

describe('in-flight promise registry', () => {
  it('tracks a pending promise and returns the same promise', () => {
    const registry = new InFlightPromiseRegistry();
    const pending = new Promise<void>(() => undefined);

    expect(registry.track(pending)).toBe(pending);
    expect(registry.count()).toBe(1);
  });

  it('releases a fulfilled promise', async () => {
    const registry = new InFlightPromiseRegistry();
    const tracked = registry.track(Promise.resolve('done'));

    await tracked;
    await Promise.resolve();

    expect(registry.count()).toBe(0);
  });

  it('releases a rejected promise', async () => {
    const registry = new InFlightPromiseRegistry();
    const tracked = registry.track(Promise.reject(new Error('failed')));

    await expect(tracked).rejects.toThrow('failed');
    await Promise.resolve();

    expect(registry.count()).toBe(0);
  });

  it('waits for the current snapshot and absorbs individual failures', async () => {
    const registry = new InFlightPromiseRegistry();
    let finish!: () => void;
    registry.track(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    registry.track(Promise.reject(new Error('expected')));

    const waiting = registry.waitForAll();
    finish();

    await expect(waiting).resolves.toBeUndefined();
    expect(registry.count()).toBe(0);
  });
});
