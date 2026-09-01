/**
 * Kernel subprocess lifecycle (design doc §8).
 *
 * startKernelProcess:
 * 1. resolves the executable (PATH / common install dirs; `.cmd` shims are
 *    routed through cmd.exe with the same safe quoting process-runner uses)
 * 2. spawns with injected env (credentials etc. — never on the command line)
 * 3. attaches a Windows Job Object with KILL_ON_JOB_CLOSE, so the OS kills the
 *    whole kernel tree when the host runtime exits — no orphans on crash
 * 4. exposes killTree() (taskkill /T /F on win32) for explicit cancellation
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { buildSafeCmdShimCommand, createKillOnCloseJob, type KernelJobObject } from '@sync-think/workers';
import { envWithRuntimeNode, resolveExecutablePath } from './detect.js';

const DEFAULT_STDERR_TAIL_BYTES = 16 * 1024;

export interface KernelProcessOptions {
  /** Bare command (resolved via PATH) or absolute path. */
  command: string;
  args: readonly string[];
  cwd: string;
  /** Extra env merged over process.env. */
  env?: Record<string, string | undefined>;
  /** Cap for the retained stderr tail used in exit diagnostics. */
  stderrTailBytes?: number;
  /** stdin wiring for bidirectional protocols (default 'pipe'). */
  stdin?: 'pipe' | 'ignore';
}

export interface KernelProcessHandle {
  child: ChildProcess;
  /** Windows Job Object (null on non-Windows / when FFI is unavailable). */
  job: KernelJobObject | null;
  /** Terminate the entire kernel process tree. */
  killTree(): Promise<void>;
  /** Retained stderr tail for exit classification. */
  stderrTail(): string;
}

/** Build the spawn tuple, routing `.cmd/.bat` shims through cmd.exe safely. */
function buildSpawnTuple(
  executablePath: string,
  args: readonly string[],
): { command: string; args: string[]; options: Pick<SpawnOptions, 'windowsVerbatimArguments'> } {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath)) {
    const commandLine = buildSafeCmdShimCommand(executablePath, args);
    if (!commandLine) {
      throw new Error(`kernel args contain unsafe shell metacharacters: ${args.join(' ')}`);
    }
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      options: { windowsVerbatimArguments: true },
    };
  }
  return { command: executablePath, args: [...args], options: {} };
}

/** Start a kernel process with env injection + Job Object lifecycle. */
export function startKernelProcess(options: KernelProcessOptions): KernelProcessHandle {
  const executablePath = resolveExecutablePath(options.command) ?? options.command;
  const { command, args, options: spawnTupleOptions } = buildSpawnTuple(executablePath, options.args);
  const env = envWithRuntimeNode({
    ...process.env,
    // Never leak the Electron runtime marker into a kernel subprocess.
    ...(process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: undefined } : {}),
    ...(options.env ?? {}),
  });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    windowsHide: true,
    stdio: [options.stdin ?? 'pipe', 'pipe', 'pipe'],
    ...spawnTupleOptions,
  });

  // Retain a bounded stderr tail for exit diagnostics.
  const maxTail = Math.max(1024, options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES);
  const tail: string[] = [];
  let tailBytes = 0;
  const decoder = new StringDecoder('utf8');
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = decoder.write(chunk);
    if (text) {
      tail.push(text);
      tailBytes += text.length;
      while (tailBytes > maxTail && tail.length > 1) {
        tailBytes -= tail[0].length;
        tail.shift();
      }
    }
  });

  const job = createKillOnCloseJob();
  let assigned = false;
  if (job && child.pid) {
    assigned = job.assign(child.pid);
    if (!assigned) {
      // Keep the job handle so the fallback below is the only kill path.
      job.close();
    }
  }

  return {
    child,
    job: assigned ? job : null,
    stderrTail: () => tail.join('').slice(-maxTail),
    async killTree() {
      await terminateProcessTree(child);
    },
  };
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
      setTimeout(resolve, 5000).unref();
    });
  } else if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}
