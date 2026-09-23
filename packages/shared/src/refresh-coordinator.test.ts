import { describe, expect, it, vi } from 'vitest';
import { RefreshCoordinator } from './refresh-coordinator.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('RefreshCoordinator', () => {
  it('coalesces requests made in the same task into one load by default', async () => {
    const load = vi.fn(async () => 'fresh');
    const coordinator = new RefreshCoordinator(load);

    const results = await Promise.all([
      coordinator.request(),
      coordinator.request(),
      coordinator.request(),
    ]);

    expect(results).toEqual(['fresh', 'fresh', 'fresh']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('runs one trailing load for requests received during an active load', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const coordinator = new RefreshCoordinator(load);

    const initial = coordinator.request();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    const trailingA = coordinator.request();
    const trailingB = coordinator.request();
    first.resolve('first');
    await expect(initial).resolves.toBe('first');
    expect(load).toHaveBeenCalledTimes(2);

    second.resolve('second');
    await expect(Promise.all([trailingA, trailingB])).resolves.toEqual(['second', 'second']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('continues accepting requests after a failed load', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('recovered');
    const coordinator = new RefreshCoordinator(load);

    await expect(coordinator.request()).rejects.toThrow('offline');
    await expect(coordinator.request()).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('starts eagerly and preserves a trailing refresh after success', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const coordinator = new RefreshCoordinator(load, { deferStart: false });

    const initial = coordinator.request();
    expect(load).toHaveBeenCalledTimes(1);
    const trailing = coordinator.request();

    first.resolve();
    await initial;
    expect(load).toHaveBeenCalledTimes(2);
    second.resolve();
    await trailing;
  });

  it('can reject every pending request after an eager load fails', async () => {
    const first = deferred<void>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const coordinator = new RefreshCoordinator(load, {
      deferStart: false,
      rejectPendingOnFailure: true,
    });

    const initial = coordinator.request();
    const trailing = coordinator.request();
    first.reject(new Error('scan failed'));

    await expect(initial).rejects.toThrow('scan failed');
    await expect(trailing).rejects.toThrow('scan failed');
    expect(load).toHaveBeenCalledTimes(1);
    await expect(coordinator.request()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
