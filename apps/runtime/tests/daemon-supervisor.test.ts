import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  DAEMON_CHILD_ENV,
  daemonSupervisorDelayMs,
  runDaemonSupervisor,
} from '../src/daemon/supervisor.js';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

describe('daemon supervisor', () => {
  it('uses bounded restart backoff', () => {
    expect([1, 2, 3, 4, 5, 10].map(daemonSupervisorDelayMs)).toEqual([
      1_000, 2_000, 5_000, 10_000, 30_000, 30_000,
    ]);
  });

  it('restarts a crashed child and stops after a clean daemon.stop exit', async () => {
    const children: FakeChild[] = [];
    const environments: NodeJS.ProcessEnv[] = [];
    const sleep = vi.fn(async () => undefined);
    const running = runDaemonSupervisor({
      entryPath: 'daemon-index.js',
      baseEnv: { FIXTURE: '1' },
      spawnChild: (_entry, env) => {
        environments.push(env);
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ChildProcess;
      },
      sleep,
      now: () => 0,
    });

    expect(children).toHaveLength(1);
    children[0].finish(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sleep).toHaveBeenCalledWith(1_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(children).toHaveLength(2);
    expect(environments[1]?.[DAEMON_CHILD_ENV]).toBe('1');

    children[1].finish(0);
    await running;
    expect(children).toHaveLength(2);
  });
});
