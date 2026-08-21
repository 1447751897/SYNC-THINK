import { spawn, type ChildProcess } from 'node:child_process';
import { DEFAULT_DEV_INSTALL_ID, managedProcessMarker } from '@sync-think/protocol';

export const DAEMON_CHILD_ENV = 'SYNC_THINK_DAEMON_CHILD';

export function daemonSupervisorDelayMs(attempt: number): number {
  if (attempt <= 1) return 1_000;
  if (attempt === 2) return 2_000;
  if (attempt === 3) return 5_000;
  if (attempt === 4) return 10_000;
  return 30_000;
}

export interface DaemonSupervisorOptions {
  entryPath: string;
  baseEnv?: NodeJS.ProcessEnv;
  spawnChild?: (entryPath: string, env: NodeJS.ProcessEnv) => ChildProcess;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

function defaultSpawnChild(entryPath: string, env: NodeJS.ProcessEnv): ChildProcess {
  const installId = env.SYNC_THINK_INSTALL_ID ?? DEFAULT_DEV_INSTALL_ID;
  return spawn(process.execPath, [entryPath, managedProcessMarker('daemon', installId)], {
    env,
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
    shell: false,
  });
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
}

/**
 * Long-lived daemon supervisor. A clean daemon.stop exits 0 and terminates the
 * supervisor; crashes restart with bounded backoff even after Desktop exits.
 */
export async function runDaemonSupervisor(options: DaemonSupervisorOptions): Promise<void> {
  const spawnChild = options.spawnChild ?? defaultSpawnChild;
  const sleep =
    options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const now = options.now ?? Date.now;
  let attempt = 0;
  let activeChild: ChildProcess | null = null;
  let stopping = false;

  const forwardStop = (): void => {
    stopping = true;
    const child = activeChild;
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* taskkill /T remains the outer fallback */
      }
    }
  };
  process.once('SIGINT', forwardStop);
  process.once('SIGTERM', forwardStop);

  try {
    while (!stopping) {
      const startedAt = now();
      const env: NodeJS.ProcessEnv = {
        ...(options.baseEnv ?? process.env),
        [DAEMON_CHILD_ENV]: '1',
      };
      activeChild = spawnChild(options.entryPath, env);
      let result: { code: number | null; signal: NodeJS.Signals | null };
      try {
        result = await waitForExit(activeChild);
      } catch (error) {
        console.warn('[daemon-supervisor] child spawn failed', error);
        result = { code: 1, signal: null };
      } finally {
        activeChild = null;
      }

      if (stopping || result.code === 0) return;
      // A process that remained healthy for a minute starts a fresh crash window.
      attempt = now() - startedAt >= 60_000 ? 1 : attempt + 1;
      const delayMs = daemonSupervisorDelayMs(attempt);
      console.warn('[daemon-supervisor] daemon exited; restarting', {
        code: result.code,
        signal: result.signal,
        delayMs,
      });
      await sleep(delayMs);
    }
  } finally {
    process.removeListener('SIGINT', forwardStop);
    process.removeListener('SIGTERM', forwardStop);
  }
}
