import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { RUNTIME_SHUTDOWN_MESSAGE, stopRuntimeChild } from './runtime-child-shutdown.js';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly sent: unknown[] = [];
  readonly kills: Array<NodeJS.Signals | number | undefined> = [];
  onSend?: () => void;
  onKill?: (signal?: NodeJS.Signals | number) => void;

  send(message: unknown): boolean {
    this.sent.push(message);
    this.onSend?.();
    return true;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    this.onKill?.(signal);
    return true;
  }

  finish(code = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

function asChild(fake: FakeChild): ChildProcess {
  return fake as unknown as ChildProcess;
}

describe('stopRuntimeChild', () => {
  it('requests graceful IPC shutdown and waits for exit without killing the process', async () => {
    const child = new FakeChild();
    child.onSend = () => queueMicrotask(() => child.finish());

    const result = await stopRuntimeChild(asChild(child), { timeoutMs: 100 });

    expect(child.sent).toEqual([RUNTIME_SHUTDOWN_MESSAGE]);
    expect(child.kills).toEqual([]);
    expect(result).toEqual({ gracefulRequested: true, forced: false, exited: true });
  });

  it('falls back to process-only force termination after the graceful timeout', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    child.onKill = (signal) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.finish(1, 'SIGKILL'));
    };

    const pending = stopRuntimeChild(asChild(child), { timeoutMs: 25, forceWaitMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    vi.useRealTimers();

    expect(child.sent).toEqual([RUNTIME_SHUTDOWN_MESSAGE]);
    expect(child.kills).toEqual(['SIGKILL']);
    expect(result).toEqual({ gracefulRequested: true, forced: true, exited: true });
  });

  it('uses direct process termination when no IPC channel is available', async () => {
    const child = new FakeChild();
    child.connected = false;
    child.onKill = () => queueMicrotask(() => child.finish(0, 'SIGTERM'));

    const result = await stopRuntimeChild(asChild(child), { timeoutMs: 100 });

    expect(child.sent).toEqual([]);
    expect(child.kills).toEqual([undefined]);
    expect(result).toEqual({ gracefulRequested: false, forced: false, exited: true });
  });
});
