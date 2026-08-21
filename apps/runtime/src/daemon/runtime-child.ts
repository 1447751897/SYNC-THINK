import type { ChildProcess, SpawnOptions } from 'node:child_process';

export const SUPERVISED_RUNTIME_SHUTDOWN_MESSAGE = {
  type: 'sync-think.runtime.shutdown',
} as const;

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
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
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
