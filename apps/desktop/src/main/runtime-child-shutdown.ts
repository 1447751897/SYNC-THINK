import type { ChildProcess } from 'node:child_process';

export const RUNTIME_SHUTDOWN_MESSAGE = { type: 'sync-think.runtime.shutdown' } as const;

export interface RuntimeChildShutdownResult {
  gracefulRequested: boolean;
  forced: boolean;
  exited: boolean;
}

function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function waitForChildExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    proc.once('exit', onExit);
    // Avoid missing an exit between the initial check and listener registration.
    if (hasExited(proc)) done(true);
  });
}

export async function stopRuntimeChild(
  proc: ChildProcess,
  options: { timeoutMs?: number; forceWaitMs?: number } = {},
): Promise<RuntimeChildShutdownResult> {
  if (hasExited(proc)) {
    return { gracefulRequested: false, forced: false, exited: true };
  }

  let gracefulRequested = false;
  if (proc.connected) {
    try {
      proc.send(RUNTIME_SHUTDOWN_MESSAGE);
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

  if (await waitForChildExit(proc, options.timeoutMs ?? 12_000)) {
    return { gracefulRequested, forced: false, exited: true };
  }

  try {
    proc.kill('SIGKILL');
  } catch {
    /* best effort */
  }
  const exited = await waitForChildExit(proc, options.forceWaitMs ?? 2_000);
  return { gracefulRequested, forced: true, exited };
}
