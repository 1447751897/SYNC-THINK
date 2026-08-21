import { describe, expect, it, vi } from 'vitest';
import {
  executeDesktopShutdownPlan,
  planDesktopShutdown,
  type DesktopShutdownReason,
} from './desktop-runtime-lifecycle.js';

describe('planDesktopShutdown', () => {
  const reasons: DesktopShutdownReason[] = ['desktop-exit', 'update-install', 'background-stop'];

  it('keeps the execution owner alive when only the Desktop UI exits', () => {
    expect(planDesktopShutdown('desktop-exit')).toEqual({
      disconnectClient: true,
      stopRuntime: false,
      stopDaemon: false,
    });
  });

  it('stops the execution owner for explicit lifecycle boundaries', () => {
    for (const reason of reasons.slice(1)) {
      expect(planDesktopShutdown(reason)).toEqual({
        disconnectClient: true,
        stopRuntime: true,
        stopDaemon: true,
      });
    }
  });
});

describe('executeDesktopShutdownPlan', () => {
  it('does nothing to the execution owner for a normal Desktop exit', async () => {
    const stopDaemon = vi.fn(async () => undefined);
    const stopRuntime = vi.fn(async () => undefined);

    await executeDesktopShutdownPlan(planDesktopShutdown('desktop-exit'), {
      stopDaemon,
      stopRuntime,
    });

    expect(stopDaemon).not.toHaveBeenCalled();
    expect(stopRuntime).not.toHaveBeenCalled();
  });

  it('waits for the daemon before applying the Runtime orphan fallback', async () => {
    const order: string[] = [];
    let releaseDaemon!: () => void;
    const daemonStopped = new Promise<void>((resolve) => {
      releaseDaemon = resolve;
    });
    const stopDaemon = vi.fn(async () => {
      order.push('daemon:start');
      await daemonStopped;
      order.push('daemon:done');
    });
    const stopRuntime = vi.fn(async () => {
      order.push('runtime');
    });

    const pending = executeDesktopShutdownPlan(planDesktopShutdown('background-stop'), {
      stopDaemon,
      stopRuntime,
    });
    await Promise.resolve();
    expect(order).toEqual(['daemon:start']);

    releaseDaemon();
    await pending;
    expect(order).toEqual(['daemon:start', 'daemon:done', 'runtime']);
  });

  it('still performs the Runtime orphan fallback when daemon cleanup rejects', async () => {
    const stopRuntime = vi.fn(async () => undefined);
    await expect(
      executeDesktopShutdownPlan(planDesktopShutdown('update-install'), {
        stopDaemon: async () => {
          throw new Error('daemon failed');
        },
        stopRuntime,
      }),
    ).rejects.toThrow('daemon failed');
    expect(stopRuntime).toHaveBeenCalledTimes(1);
  });
});
