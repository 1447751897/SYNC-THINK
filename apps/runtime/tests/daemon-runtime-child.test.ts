import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  appendRuntimeChildLog,
  buildSupervisedRuntimeSpawnOptions,
  isSupervisedRuntimeReadyMessage,
  stopSupervisedRuntimeChild,
  SUPERVISED_RUNTIME_READY_MESSAGE,
  SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE,
} from '../src/daemon/runtime-child.js';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  pid = 4242;
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

describe('supervised Runtime child lifecycle', () => {
  it('keeps Runtime detached while retaining a private IPC shutdown channel', () => {
    expect(buildSupervisedRuntimeSpawnOptions({ FIXTURE: '1' })).toMatchObject({
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { FIXTURE: '1' },
    });
  });

  it('recognizes the independent Runtime-ready signal', () => {
    expect(isSupervisedRuntimeReadyMessage(SUPERVISED_RUNTIME_READY_MESSAGE)).toBe(true);
    expect(isSupervisedRuntimeReadyMessage({ type: 'other-message' })).toBe(false);
    expect(isSupervisedRuntimeReadyMessage(null)).toBe(false);
  });

  it('appends bounded diagnostic output to a per-install Runtime log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-log-'));
    const path = join(dir, 'runtime-dev-0001.log');
    try {
      appendRuntimeChildLog(path, 'stderr', 'startup failed');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('[stderr] startup failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requests graceful Runtime shutdown and waits without killing the process', async () => {
    const child = new FakeChild();
    child.onSend = () => queueMicrotask(() => child.finish());

    const result = await stopSupervisedRuntimeChild(asChild(child), { timeoutMs: 100 });

    expect(child.sent).toEqual([SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE]);
    expect(child.kills).toEqual([]);
    expect(result).toEqual({ gracefulRequested: true, forced: false, exited: true });
  });

  it('forces the process tree only after the graceful budget expires', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const forceKillTree = vi.fn(() => queueMicrotask(() => child.finish(1, 'SIGKILL')));

      const pending = stopSupervisedRuntimeChild(asChild(child), {
        timeoutMs: 25,
        forceWaitMs: 25,
        forceKillTree,
      });
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(child.sent).toEqual([SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE]);
      expect(forceKillTree).toHaveBeenCalledWith(4242);
      expect(result).toEqual({ gracefulRequested: true, forced: true, exited: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
