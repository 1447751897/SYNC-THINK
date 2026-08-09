import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { WorkerToken } from './types.js';
import { isPathInside } from './types.js';

export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const PROCESS_TREE_TERMINATION_TIMEOUT_MS = 5_000;
const WINDOWS_PROCESS_RELEASE_POLL_MS = 25;
const processTreeTerminationRequests = new WeakMap<
  ChildProcessWithoutNullStreams,
  Promise<void>
>();

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  shell: false;
  spawnError?: string;
}

export interface BoundedProcessListeners {
  onStdout?(text: string): void;
  onStderr?(text: string): void;
}

export interface BoundedProcessOptions {
  stdin?: string;
}

export function startRefusal(token: WorkerToken): 'aborted' | 'fence-rejected' | undefined {
  if (token.signal?.aborted) return 'aborted';
  if (token.beforeStart) {
    try {
      if (!token.beforeStart()) return 'fence-rejected';
    } catch {
      return 'fence-rejected';
    }
  }
  return token.signal?.aborted ? 'aborted' : undefined;
}

export function isCommandAllowed(command: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed?.length) return false;
  const normalized = normalizeCommand(command);
  return allowed.some((candidate) => normalizeCommand(candidate) === normalized);
}

function normalizeCommand(command: string): string {
  const value = String(command ?? '')
    .trim()
    .replace(/^"|"$/g, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function validateProcessArguments(args: readonly string[]): boolean {
  return (
    args.length <= 128 &&
    args.every((arg) => typeof arg === 'string' && arg.length <= 16_384 && !arg.includes('\0'))
  );
}

export async function isRealPathInside(
  candidate: string,
  root: string,
  allowMissing = false,
): Promise<boolean> {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  if (!isPathInside(resolvedCandidate, resolvedRoot)) return false;

  let realRoot: string;
  try {
    realRoot = await realpath(resolvedRoot);
  } catch {
    return false;
  }

  let existing = resolvedCandidate;
  while (true) {
    try {
      return isPathInside(await realpath(existing), realRoot);
    } catch {
      if (!allowMissing) return false;
      const parent = dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
  }
}

export async function runBoundedProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  token: WorkerToken,
  listeners?: BoundedProcessListeners,
  options?: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const maxBytes = Math.max(
    1,
    Math.min(token.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 1024 * 1024),
  );
  let keptBytes = 0;
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let truncated = false;
  let timedOut = false;
  let aborted = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let spawnError: string | undefined;
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  let spawnCommand = command;
  let spawnArgs = [...args];
  let windowsVerbatimArguments = false;
  if (process.platform === 'win32') {
    const resolved = resolveWindowsExecutable(command);
    if (/\.(?:cmd|bat)$/i.test(resolved)) {
      const commandLine = buildSafeCmdShimCommand(resolved, args);
      if (!commandLine) {
        return spawnFailure('Batch command arguments contain unsafe shell metacharacters');
      }
      spawnCommand = process.env.ComSpec || 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', commandLine];
      windowsVerbatimArguments = true;
    } else {
      spawnCommand = resolved;
    }
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(spawnCommand, spawnArgs, {
      cwd,
      detached: process.platform !== 'win32',
      shell: false,
      windowsVerbatimArguments,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return spawnFailure(error instanceof Error ? error.message : 'process spawn failed');
  }
  child.stdin.end(options?.stdin);

  const append = (
    current: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
  ): { value: Buffer<ArrayBufferLike>; kept: Buffer<ArrayBufferLike> } => {
    const remaining = maxBytes - keptBytes;
    if (remaining <= 0) {
      truncated = true;
      return { value: current, kept: Buffer.alloc(0) };
    }
    const kept = chunk.subarray(0, remaining);
    keptBytes += kept.length;
    if (kept.length < chunk.length) truncated = true;
    return { value: Buffer.concat([current, kept]), kept };
  };
  child.stdout.on('data', (chunk: Buffer) => {
    const appended = append(stdout, chunk);
    stdout = appended.value;
    if (appended.kept.length > 0) {
      const text = stdoutDecoder.write(appended.kept);
      if (text) listeners?.onStdout?.(text);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const appended = append(stderr, chunk);
    stderr = appended.value;
    if (appended.kept.length > 0) {
      const text = stderrDecoder.write(appended.kept);
      if (text) listeners?.onStderr?.(text);
    }
  });

  let terminationPromise: Promise<void> | undefined;
  const terminate = () => {
    terminationPromise ??= terminateProcessTree(child);
  };

  const timeoutMs = Math.max(1, Math.min(token.timeoutMs, 10 * 60_000));
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const onAbort = () => {
    aborted = true;
    terminate();
  };
  token.signal?.addEventListener('abort', onAbort, { once: true });
  if (token.signal?.aborted) onAbort();

  await new Promise<void>((resolveDone) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };
    child.once('error', (error) => {
      spawnError = error.message;
      finish();
    });
    child.once('close', (code, signal) => {
      exitCode = typeof code === 'number' ? code : null;
      exitSignal = signal ? String(signal) : null;
      finish();
    });
  });
  clearTimeout(timer);
  token.signal?.removeEventListener('abort', onAbort);
  await terminationPromise;
  const finalStdout = stdoutDecoder.end();
  if (finalStdout) listeners?.onStdout?.(finalStdout);
  const finalStderr = stderrDecoder.end();
  if (finalStderr) listeners?.onStderr?.(finalStderr);

  return {
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    exitCode,
    signal: exitSignal,
    timedOut,
    aborted,
    truncated,
    shell: false,
    ...(spawnError ? { spawnError: `${basename(command)}: ${spawnError}` } : {}),
  };
}

export function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const existing = processTreeTerminationRequests.get(child);
  if (existing) return existing;

  const request = terminateProcessTreeOnce(child);
  processTreeTerminationRequests.set(child, request);
  return request;
}

async function terminateProcessTreeOnce(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const pid = child.pid;
  const closePromise = waitForChildClose(child);
  const killDirectChild = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process is already gone.
    }
  };
  if (process.platform !== 'win32') {
    try {
      if (pid) process.kill(-pid, 'SIGKILL');
      else killDirectChild();
    } catch {
      killDirectChild();
    }
    await closePromise;
    return;
  }
  if (!pid) {
    killDirectChild();
    await closePromise;
    return;
  }
  await new Promise<void>((resolveTermination) => {
    let settled = false;
    let killer: ReturnType<typeof spawn> | undefined;
    const finish = (treeKilled: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!treeKilled) killDirectChild();
      resolveTermination();
    };
    const timer = setTimeout(() => {
      try {
        killer?.kill('SIGKILL');
      } catch {
        // The taskkill helper already exited.
      }
      finish(false);
    }, PROCESS_TREE_TERMINATION_TIMEOUT_MS);
    try {
      killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => finish(false));
      killer.once('close', (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
  await closePromise;
  await waitForProcessRelease(pid);
}

function waitForChildClose(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return Promise.resolve();
  }
  return new Promise<void>((resolveClose) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', finish);
      child.removeListener('error', finish);
      resolveClose();
    };
    const timer = setTimeout(finish, PROCESS_TREE_TERMINATION_TIMEOUT_MS);
    child.once('close', finish);
    child.once('error', finish);
  });
}

async function waitForProcessRelease(pid: number): Promise<void> {
  const deadline = Date.now() + PROCESS_TREE_TERMINATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, WINDOWS_PROCESS_RELEASE_POLL_MS);
    });
  }
}

function spawnFailure(message: string): BoundedProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    timedOut: false,
    aborted: false,
    truncated: false,
    shell: false,
    spawnError: message,
  };
}

function resolveWindowsExecutable(command: string): string {
  if (existsSync(command) || extname(command)) return command;
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory.replace(/^"|"$/g, ''), `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

function buildSafeCmdShimCommand(command: string, args: readonly string[]): string | undefined {
  const values = [command, ...args];
  if (values.some((value) => /["%^!&|<>\r\n]/.test(value))) return undefined;
  const commandLine = [
    `"${command}"`,
    ...args.map((value) => (/\s/.test(value) ? `"${value}"` : value)),
  ].join(' ');
  return `"${commandLine}"`;
}
