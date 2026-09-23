import { describe, expect, it, vi } from 'vitest';
import { PlatformMcpRunRegistry } from './platform-mcp-run-registry.js';

interface Result {
  ok: boolean;
  value: string;
}

describe('platform MCP run registry', () => {
  it('keeps catalogs and brokers isolated by run', () => {
    const registry = new PlatformMcpRunRegistry<string, { id: string }, Result>();
    registry.setCatalog('run-a', ['tool-a']);
    const createA = vi.fn(() => ({ id: 'broker-a' }));
    const createB = vi.fn(() => ({ id: 'broker-b' }));

    expect(registry.getCatalog('run-a')).toEqual(['tool-a']);
    expect(registry.getCatalog('run-b')).toBeUndefined();
    expect(registry.getOrCreateBroker('run-a', createA)).toEqual({ id: 'broker-a' });
    expect(registry.getOrCreateBroker('run-a', createA)).toEqual({ id: 'broker-a' });
    expect(registry.getOrCreateBroker('run-b', createB)).toEqual({ id: 'broker-b' });
    expect(createA).toHaveBeenCalledTimes(1);
    expect(createB).toHaveBeenCalledTimes(1);
  });

  it('replays one in-flight and successful result for the same key', async () => {
    const registry = new PlatformMcpRunRegistry<string, object, Result>();
    let resolve!: (result: Result) => void;
    const execute = vi.fn(
      () =>
        new Promise<Result>((done) => {
          resolve = done;
        }),
    );

    const first = registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok);
    const replayed = registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok);
    resolve({ ok: true, value: 'done' });

    await expect(first).resolves.toEqual({ ok: true, value: 'done' });
    await expect(replayed).resolves.toEqual({ ok: true, value: 'done' });
    await expect(
      registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok),
    ).resolves.toEqual({ ok: true, value: 'done' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('releases non-retained results so the call can retry', async () => {
    const registry = new PlatformMcpRunRegistry<string, object, Result>();
    const execute = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ ok: false, value: 'failed' })
      .mockResolvedValueOnce({ ok: true, value: 'retried' });

    await expect(
      registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok),
    ).resolves.toEqual({ ok: false, value: 'failed' });
    await expect(
      registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok),
    ).resolves.toEqual({ ok: true, value: 'retried' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('clears the catalog, replay result, and broker together', async () => {
    const registry = new PlatformMcpRunRegistry<string, { id: string }, Result>();
    const execute = vi.fn(async () => ({ ok: true, value: 'done' }));
    const create = vi.fn(() => ({ id: 'broker' }));
    registry.setCatalog('run-a', ['tool-a']);
    registry.getOrCreateBroker('run-a', create);
    await registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok);

    registry.deleteRun('run-a');

    expect(registry.getCatalog('run-a')).toBeUndefined();
    registry.getOrCreateBroker('run-a', create);
    await registry.executeOnce('run-a', 'call-a', execute, (result) => result.ok);
    expect(create).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
