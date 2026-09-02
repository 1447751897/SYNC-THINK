import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

/** Sent over the private IPC channel after Runtime.start() has completed. */
export const SUPERVISED_RUNTIME_READY_MESSAGE = {
  type: 'sync-think.runtime.ready',
} as const;

export const SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE = {
  type: 'sync-think.runtime.shutdown',
} as const;

export function isSupervisedRuntimeReadyMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === SUPERVISED_RUNTIME_READY_MESSAGE.type
  );
}

export type RuntimeChildLogLevel = 'stdout' | 'stderr' | 'lifecycle';

/**
 * Keep Runtime diagnostics separate from daemon.log. The install id is part of
 * the filename at the call site, so parallel installations never share logs.
 */
export function appendRuntimeChildLog(
  logPath: string,
  level: RuntimeChildLogLevel,
  value: unknown,
): void {
  const text = String(value).trim();
  if (!text) return;
  const bounded = text.length > 128 * 1024 ? `${text.slice(0, 128 * 1024)} [truncated]` : text;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    for (const line of bounded.split(/\r?\n/)) {
      if (!line) continue;
      appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${line}\n`, 'utf8');
    }
  } catch {
    // Diagnostics must never stop Runtime supervision.
  }
}

export interface SupervisedRuntimeShutdownResult {
  gracefulRequested: boolean;
  forced: boolean;
  exited: boolean;
}

function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    proc.once('exit', onExit);
    if (hasExited(proc)) done(true);
  });
}

/** Runtime is detached from Desktop but keeps one private daemon IPC channel. */
export function buildSupervisedRuntimeSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    env,
    // Keep stdout/stderr readable by the daemon so they can be persisted to a
    // per-install Runtime log. fd 3 remains the private shutdown/readiness IPC.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    detached: true,
    shell: false,
  };
}

/**
 * Ask Runtime to close its stores, browser host and resident Kernel processes.
 * Only after the bounded grace period may the daemon terminate the process tree.
 */
export async function stopSupervisedRuntimeChild(
  proc: ChildProcess,
  options: {
    timeoutMs?: number;
    forceWaitMs?: number;
    forceKillTree?: (pid: number) => void;
  } = {},
): Promise<SupervisedRuntimeShutdownResult> {
  if (hasExited(proc)) {
    return { gracefulRequested: false, forced: false, exited: true };
  }

  let gracefulRequested = false;
  if (proc.connected) {
    try {
      proc.send(SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE);
      gracefulRequested = true;
    } catch {
      gracefulRequested = false;
    }
  }

  if (!gracefulRequested) {
    try {
      proc.kill();
    } catch {
      /* best effort */
    }
  }

  if (await waitForExit(proc, options.timeoutMs ?? 12_000)) {
    return { gracefulRequested, forced: false, exited: true };
  }

  if (typeof proc.pid === 'number' && options.forceKillTree) {
    options.forceKillTree(proc.pid);
  } else {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* best effort */
    }
  }
  const exited = await waitForExit(proc, options.forceWaitMs ?? 2_000);
  return { gracefulRequested, forced: true, exited };
}
