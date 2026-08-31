import { describe, expect, it, vi } from 'vitest';
import type {
  KernelAdapter,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
} from '@sync-think/shared';
import { BoundedKernelSessionHost } from './bounded-session-host.js';

class HostFixtureAdapter implements KernelAdapter {
  readonly id = 'codex' as const;
  readonly name = 'Codex fixture';
  readonly icon = 'codex';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: true,
    pause: 'turn' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  stopCalls = 0;
  stopError?: Error;
  stopGate?: Promise<void>;
  readonly stopped: Promise<void>;
  private resolveStopped!: () => void;

  constructor(readonly sequence: number) {
    this.stopped = new Promise((resolve) => {
      this.resolveStopped = resolve;
    });
  }

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }
  async *start(_request: KernelRequest) {}
  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopGate) await this.stopGate;
    if (this.stopError) throw this.stopError;
    this.resolveStopped();
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHost(
  options: { maxEntries?: number; idleTimeoutMs?: number; now?: () => number } = {},
) {
  const adapters: HostFixtureAdapter[] = [];
  const host = new BoundedKernelSessionHost<HostFixtureAdapter>({
    maxEntries: options.maxEntries ?? 2,
    idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
    now: options.now,
    createAdapter: () => {
      const adapter = new HostFixtureAdapter(adapters.length + 1);
      adapters.push(adapter);
      return adapter;
    },
  });
  return { adapters, host };
}

describe('BoundedKernelSessionHost', () => {
  it('reuses one resident adapter for consecutive turns in the same conversation', async () => {
    const { adapters, host } = createHost();

    const first = await host.acquire('conversation-a');
    first.release();
    const second = await host.acquire('conversation-a');

    expect(second.adapter).toBe(first.adapter);
    expect(adapters).toHaveLength(1);
    expect(host.snapshot()).toMatchObject({ size: 1, active: 1, idle: 0, waiting: 0 });

    second.release();
    await host.stopAll();
  });

  it('waits at capacity while every resident conversation is active', async () => {
    const { adapters, host } = createHost({ maxEntries: 2 });
    const first = await host.acquire('conversation-a');
    const second = await host.acquire('conversation-b');
    let thirdResolved = false;
    const thirdPromise = host.acquire('conversation-c').then((lease) => {
      thirdResolved = true;
      return lease;
    });

    await flush();
    expect(thirdResolved).toBe(false);
    expect(adapters).toHaveLength(2);
    expect(host.snapshot()).toMatchObject({ size: 2, active: 2, idle: 0, waiting: 1 });

    first.release();
    const third = await thirdPromise;
    expect(third.adapter).not.toBe(first.adapter);
    expect(first.adapter.stopCalls).toBe(1);
    expect(adapters).toHaveLength(3);
    expect(host.snapshot()).toMatchObject({ size: 2, active: 2, idle: 0, waiting: 0 });

    second.release();
    third.release();
    await host.stopAll();
  });

  it('evicts the least recently used idle conversation without touching active turns', async () => {
    let now = 1;
    const { adapters, host } = createHost({ maxEntries: 2, now: () => now });
    const first = await host.acquire('conversation-a');
    first.release();
    now = 2;
    const second = await host.acquire('conversation-b');
    second.release();
    now = 3;
    const secondActive = await host.acquire('conversation-b');
    const third = await host.acquire('conversation-c');

    expect(adapters[0]?.stopCalls).toBe(1);
    expect(adapters[1]?.stopCalls).toBe(0);
    expect(host.snapshot().keys).toEqual(['conversation-b', 'conversation-c']);

    secondActive.release();
    third.release();
    await host.stopAll();
  });

  it('stops an idle adapter after the configured timeout and recreates it on demand', async () => {
    vi.useFakeTimers();
    try {
      const { adapters, host } = createHost({ idleTimeoutMs: 1_000 });
      const first = await host.acquire('conversation-a');
      first.release();

      await vi.advanceTimersByTimeAsync(1_000);
      await first.adapter.stopped;
      expect(host.snapshot()).toMatchObject({ size: 0, active: 0, idle: 0 });

      const resumed = await host.acquire('conversation-a');
      expect(resumed.adapter).not.toBe(first.adapter);
      expect(adapters).toHaveLength(2);
      resumed.release();
      await host.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recycles idle adapters immediately and active adapters after their lease is released', async () => {
    const { adapters, host } = createHost({ maxEntries: 2 });
    const active = await host.acquire('conversation-active');
    const idle = await host.acquire('conversation-idle');
    idle.release();

    const result = await host.recycleAll();

    expect(result).toEqual({ recycled: 1, deferred: 1 });
    expect(idle.adapter.stopCalls).toBe(1);
    expect(active.adapter.stopCalls).toBe(0);

    active.release();
    await active.adapter.stopped;
    const resumed = await host.acquire('conversation-active');
    expect(resumed.adapter).not.toBe(active.adapter);
    expect(adapters).toHaveLength(3);

    resumed.release();
    await host.stopAll();
  });

  it('never evicts an active turn even after the idle timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const { host } = createHost({ idleTimeoutMs: 1_000 });
      const lease = await host.acquire('conversation-a');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.adapter.stopCalls).toBe(0);
      expect(host.snapshot()).toMatchObject({ size: 1, active: 1, idle: 0 });

      lease.release();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lease.adapter.stopCalls).toBe(1);
      await host.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a cancelled capacity waiter without disturbing active leases', async () => {
    const { host } = createHost({ maxEntries: 1 });
    const active = await host.acquire('conversation-a');
    const controller = new AbortController();
    const waiting = host.acquire('conversation-b', controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.snapshot()).toMatchObject({ size: 1, active: 1, waiting: 0 });
    expect(active.adapter.stopCalls).toBe(0);

    active.release();
    await host.stopAll();
  });

  it('keeps failed-stop entries counted and does not exceed the process limit', async () => {
    const { adapters, host } = createHost({ maxEntries: 1 });
    const first = await host.acquire('conversation-a');
    first.release();
    first.adapter.stopError = new Error('process still alive');

    await expect(host.acquire('conversation-b')).rejects.toThrow('process still alive');
    expect(adapters).toHaveLength(1);
    expect(host.snapshot()).toMatchObject({ size: 1, active: 1, waiting: 0 });
  });

  it('shares one shutdown promise across concurrent callers', async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const { adapters, host } = createHost({ maxEntries: 1 });
    await host.acquire('conversation-a');
    adapters[0]!.stopGate = stopGate;

    const firstStop = host.stopAll();
    const secondStop = host.stopAll();
    let secondSettled = false;
    void secondStop.then(() => {
      secondSettled = true;
    });
    await flush();
    expect(secondSettled).toBe(false);
    expect(adapters[0]!.stopCalls).toBe(1);

    releaseStop();
    await Promise.all([firstStop, secondStop]);
    expect(secondSettled).toBe(true);
    expect(adapters[0]!.stopCalls).toBe(1);
  });

  it('stops every resident adapter and rejects queued acquisitions on shutdown', async () => {
    const { adapters, host } = createHost({ maxEntries: 1 });
    await host.acquire('conversation-a');
    const waiting = host.acquire('conversation-b');

    await host.stopAll();

    await expect(waiting).rejects.toThrow('Kernel session host is stopped');
    expect(adapters[0]?.stopCalls).toBe(1);
    expect(host.snapshot()).toMatchObject({ size: 0, active: 0, idle: 0, waiting: 0 });
    await expect(host.acquire('conversation-c')).rejects.toThrow('Kernel session host is stopped');
  });
});
