import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunId } from '@sync-think/shared';
import { DelegationExecutionController } from './delegation-execution.js';

const A = 'child-a' as RunId;
const B = 'child-b' as RunId;
const idle = 1_800_000;
const absolute = 7_200;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const gates = new Map<RunId, ReturnType<typeof deferred>>();
  const calls: string[] = [];
  const ports = {
    execute: vi.fn((id: RunId) => {
      const gate = deferred();
      gates.set(id, gate);
      calls.push('execute:' + id);
      return gate.promise;
    }),
    abort: vi.fn((id: RunId) => {
      calls.push('abort:' + id);
    }),
    markTimedOut: vi.fn((id: RunId) => {
      calls.push('timeout:' + id);
    }),
    failBackground: vi.fn(),
    releaseBackground: vi.fn(),
    probeStatus: vi.fn(),
    reportError: vi.fn(),
  };
  return { controller: new DelegationExecutionController(ports), ports, gates, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('delegation execution lifetime', () => {
  it('starts background work immediately and marks timeout before abort exactly once', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    expect(f.ports.execute).toHaveBeenCalledWith(A);
    await vi.advanceTimersByTimeAsync(idle);
    expect(f.calls).toEqual(['execute:' + A, 'timeout:' + A, 'abort:' + A]);
    f.controller.progress(A);
    await vi.advanceTimersByTimeAsync(absolute * 1000);
    expect(f.ports.abort).toHaveBeenCalledTimes(1);
    f.gates.get(A)!.resolve();
    await f.controller.stop();
    expect(f.ports.releaseBackground.mock.calls).toEqual([[A]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renews idle time on progress but never moves the absolute deadline', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    for (let hour = 0; hour < 7; hour++) {
      await vi.advanceTimersByTimeAsync(1_000_000);
      f.controller.progress(A);
      expect(f.ports.abort).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(200_000);
    expect(f.ports.markTimedOut.mock.calls).toEqual([[A]]);
    f.gates.get(A)!.resolve();
    await f.controller.stop();
  });

  it('probes status after the configured notification gap and resets on progress', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute, 30);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.ports.probeStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.ports.probeStatus).toHaveBeenCalledTimes(1);
    f.controller.progress(A);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.ports.probeStatus).toHaveBeenCalledTimes(2);
    f.gates.get(A)!.resolve();
    await f.controller.stop();
  });

  it('cancels only the selected child and clears its watchdogs immediately', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    f.controller.startBackground(B, absolute);
    expect(f.controller.cancel(A)).toBe(true);
    expect(f.controller.cancel(A)).toBe(true);
    expect(f.ports.abort.mock.calls).toEqual([[A]]);
    expect(f.ports.markTimedOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(idle);
    expect(f.ports.markTimedOut.mock.calls).toEqual([[B]]);
    f.gates.get(A)!.resolve();
    f.gates.get(B)!.resolve();
    await f.controller.stop();
    expect(f.controller.cancel(A)).toBe(false);
  });

  it('stops timers at the terminal event while still waiting for executor cleanup', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    f.controller.finish(A);
    f.controller.progress(A);
    await vi.advanceTimersByTimeAsync(absolute * 1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.ports.abort).not.toHaveBeenCalled();
    expect(f.ports.releaseBackground).not.toHaveBeenCalled();
    f.gates.get(A)!.resolve();
    await f.controller.stop();
    expect(f.ports.releaseBackground.mock.calls).toEqual([[A]]);
  });

  it('reports execution failure and releases the background snapshot', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    const error = new Error('provider failed');
    f.gates.get(A)!.reject(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.ports.failBackground.mock.calls).toEqual([[A, error, absolute]]);
    expect(f.ports.releaseBackground.mock.calls).toEqual([[A]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains synchronous executor and failure-handler errors without leaking timers', async () => {
    const f = fixture();
    const failure = new Error('executor failed');
    const reporting = new Error('report failed');
    f.ports.execute.mockImplementation(() => {
      throw failure;
    });
    f.ports.failBackground.mockImplementation(() => {
      throw reporting;
    });
    f.controller.startBackground(A, absolute);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.ports.failBackground.mock.calls).toEqual([[A, failure, absolute]]);
    expect(f.ports.releaseBackground.mock.calls).toEqual([[A]]);
    expect(f.ports.reportError.mock.calls).toEqual([[reporting]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects duplicate execution of the same child', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    expect(() => f.controller.startBackground(A, absolute)).toThrow(
      'delegation.execution_already_started',
    );
    expect(f.ports.execute).toHaveBeenCalledTimes(1);
    f.gates.get(A)!.resolve();
    await f.controller.stop();
  });

  it('foreground cancellation aborts after executor registration, even for an already aborted signal', async () => {
    const f = fixture();
    const parent = new AbortController();
    parent.abort();
    const done = f.controller.runForeground(A, 300, parent.signal);
    expect(f.calls).toEqual(['execute:' + A, 'abort:' + A]);
    f.gates.get(A)!.resolve();
    await done;
    expect(f.ports.markTimedOut).not.toHaveBeenCalled();
    expect(f.ports.releaseBackground).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the parent abort listener when foreground work completes', async () => {
    const f = fixture();
    const parent = new AbortController();
    const done = f.controller.runForeground(A, 300, parent.signal);
    f.gates.get(A)!.resolve();
    await done;
    parent.abort();
    expect(f.ports.abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('foreground work uses its own fixed limit and propagates execution errors', async () => {
    const f = fixture();
    const done = f.controller.runForeground(A, 300);
    const failure = expect(done).rejects.toThrow('interrupted');
    f.controller.progress(A);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.ports.markTimedOut.mock.calls).toEqual([[A]]);
    f.gates.get(A)!.reject(new Error('interrupted'));
    await failure;
    expect(f.ports.failBackground).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shutdown rejects new starts and waits for every executor to settle', async () => {
    const f = fixture();
    f.controller.startBackground(A, absolute);
    const foreground = f.controller.runForeground(B, 300);
    let stopped = false;
    const shutdown = f.controller.stop().then(() => {
      stopped = true;
    });
    expect(f.ports.abort).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => f.controller.startBackground('new' as RunId, absolute)).toThrow(
      'delegation.execution_stopped',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    f.gates.get(A)!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    f.gates.get(B)!.resolve();
    await Promise.all([shutdown, foreground]);
    expect(stopped).toBe(true);
    await f.controller.stop();
    expect(f.ports.abort).toHaveBeenCalledTimes(2);
  });
});
