// Ensure the local Runtime pipe process is running before Desktop connects.
// Dev used to require a separate `pnpm dev:runtime`; release users would hang
// on "加载中…" if the pipe is missing. This supervisor starts runtime once.
//
// Also force-restarts an orphan runtime when Desktop starts, so rebuilds do not
// keep serving a stale process that already holds the named pipe.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
// mkdirSync already imported above
import { connect } from 'node:net';
import { pipePathPortable } from '@sync-think/protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
/** Only force-restart once per Desktop process lifetime. */
let didForceRestartThisSession = false;

function electronResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function resolveRuntimeEntry(): string | null {
  // From apps/desktop/dist/main → monorepo apps/runtime/dist/main.js.
  // Packaged builds place Runtime under resources/runtime.
  const resourcesPath = electronResourcesPath();
  const candidates = [
    process.env.SYNC_THINK_RUNTIME_ENTRY,
    resourcesPath ? join(resourcesPath, 'runtime', 'main.js') : undefined,
    join(__dirname, '..', '..', '..', 'runtime', 'dist', 'main.js'),
    join(__dirname, '..', '..', '..', '..', 'apps', 'runtime', 'dist', 'main.js'),
    join(process.cwd(), 'apps', 'runtime', 'dist', 'main.js'),
    join(process.cwd(), '..', 'runtime', 'dist', 'main.js'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function runtimeStateDir(): string {
  const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), '.sync-think');
  return join(dataRoot, 'SYNC-THINK');
}

function runtimePidPath(installId: string): string {
  return join(runtimeStateDir(), `runtime-${installId}.pid`);
}

function readPidFile(installId: string): number | null {
  try {
    const raw = readFileSync(runtimePidPath(installId), 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(installId: string, pid: number): void {
  try {
    mkdirSync(runtimeStateDir(), { recursive: true });
    writeFileSync(runtimePidPath(installId), String(pid), 'utf8');
  } catch (error) {
    console.warn('[desktop] failed to write runtime pid file', error);
  }
}

function clearPidFile(installId: string): void {
  try {
    unlinkSync(runtimePidPath(installId));
  } catch {
    /* ignore */
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number): void {
  if (!isProcessAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch (error) {
    console.warn('[desktop] failed to kill runtime pid', pid, error);
  }
}

function probePipe(installId: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(pipePathPortable(installId));
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

async function waitForPipe(installId: string, totalMs = 12_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (await probePipe(installId, 500)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return probePipe(installId, 500);
}

async function waitForPipeDown(installId: string, totalMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (!(await probePipe(installId, 300))) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function nodeMajor(binary: string): number | null {
  try {
    const result = spawnSync(binary, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3_000,
    });
    if (result.status !== 0) return null;
    const major = Number.parseInt(result.stdout.trim().split('.')[0] ?? '', 10);
    return Number.isInteger(major) ? major : null;
  } catch {
    return null;
  }
}

function resolveNodeBinary(): string | null {
  // Runtime native dependencies are built for the workspace's required Node 20.
  // `node.exe` on PATH is frequently a different major (Node 24 on the current
  // development machine), which exits before opening the pipe with an ABI error.
  const resourcesPath = electronResourcesPath();
  const candidates = [
    process.env.SYNC_THINK_NODE_BIN,
    resourcesPath
      ? join(resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
      : undefined,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'pnpm', 'nodejs', '20.20.2', 'node.exe')
      : undefined,
    process.platform === 'win32' ? 'node.exe' : 'node',
  ].filter((value): value is string => Boolean(value));

  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    candidates.push(join(entry, process.platform === 'win32' ? 'node.exe' : 'node'));
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (nodeMajor(candidate) === 20) return candidate;
  }

  return null;
}

function defaultDataRoot(): string {
  // Prefer monorepo .data (usually on D:) so a full C: drive does not kill Runtime.
  // __dirname = apps/desktop/dist/main → repo root is ../../../..
  const monorepoData = join(__dirname, '..', '..', '..', '..', '.data', 'SYNC-THINK');
  if (
    existsSync(dirname(monorepoData)) ||
    existsSync(join(__dirname, '..', '..', '..', '..', 'apps'))
  ) {
    return monorepoData;
  }
  const cwdData = join(process.cwd(), '.data', 'SYNC-THINK');
  if (existsSync(dirname(cwdData))) return cwdData;
  const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), '.sync-think');
  return join(dataRoot, 'SYNC-THINK');
}

function spawnRuntime(entry: string, installId: string, nodeBin: string): ChildProcess {
  const dataRoot = defaultDataRoot();
  try {
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(join(dataRoot, 'chat-image-staging'), { recursive: true });
    mkdirSync(join(dataRoot, 'message-images'), { recursive: true });
  } catch {
    /* ignore */
  }
  const env = {
    ...process.env,
    SYNC_THINK_INSTALL_ID: installId,
    // Match desktop dev default: no HMAC unless a secret is configured.
    SYNC_THINK_DEV_NO_TOKEN:
      process.env.SYNC_THINK_DEV_NO_TOKEN ?? (process.env.SYNC_THINK_PIPE_SECRET ? '0' : '1'),
    // Keep DB + image staging on a drive with free space (dev machines often fill C:).
    SYNC_THINK_DB_PATH: process.env.SYNC_THINK_DB_PATH ?? join(dataRoot, 'sync-think.db'),
    SYNC_THINK_CHAT_IMAGE_STAGING:
      process.env.SYNC_THINK_CHAT_IMAGE_STAGING ?? join(dataRoot, 'chat-image-staging'),
    SYNC_THINK_CHAT_MESSAGE_IMAGES:
      process.env.SYNC_THINK_CHAT_MESSAGE_IMAGES ?? join(dataRoot, 'message-images'),
  };
  // Never pass ELECTRON_RUN_AS_NODE when spawning system Node — it can confuse
  // some environments if inherited from the parent Electron process.
  delete (env as { ELECTRON_RUN_AS_NODE?: string }).ELECTRON_RUN_AS_NODE;

  const childProcess = spawn(nodeBin, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
    shell: false,
  });

  if (typeof childProcess.pid === 'number') {
    writePidFile(installId, childProcess.pid);
  }

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) console.log('[runtime-child]', text);
  });
  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) console.warn('[runtime-child]', text);
  });
  childProcess.on('exit', (code, signal) => {
    console.warn('[desktop] runtime process exited', { code, signal });
    if (child === childProcess) child = null;
    clearPidFile(installId);
  });
  childProcess.on('error', (error) => {
    console.error('[desktop] runtime process failed to start', error);
    if (child === childProcess) child = null;
    clearPidFile(installId);
  });

  return childProcess;
}

function runCommand(
  command: string,
  args: string[],
  opts: { shell?: boolean } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: opts.shell ?? false,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: String(error) });
    });
    proc.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function killOrphanRuntimeProcesses(installId: string): Promise<void> {
  // Best-effort: kill any leftover runtime holding the named pipe after rebuilds.
  // Must be awaited — fire-and-forget caused EADDRINUSE races on restart.
  if (process.platform === 'win32') {
    // Match managed dist entry AND lingering `pnpm dev:runtime` / tsx watch trees.
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      'Get-CimInstance Win32_Process |',
      '  Where-Object {',
      '    $_.CommandLine -and (',
      "      ($_.Name -match 'node' -and (",
      "        $_.CommandLine -match 'runtime[\\\\/]+dist[\\\\/]+main\\.js' -or",
      "        $_.CommandLine -match 'apps[\\\\/]+runtime[\\\\/]+dist' -or",
      "        ($_.CommandLine -match 'apps[\\\\/]+runtime' -and $_.CommandLine -match 'tsx') -or",
      "        ($_.CommandLine -match 'SYNC-THINK' -and $_.CommandLine -match 'src/main\\.ts' -and $_.CommandLine -match 'tsx') -or",
      "        $_.CommandLine -match 'filter @sync-think/runtime' -or",
      "        $_.CommandLine -match 'dev:runtime'",
      '      )) -or',
      `      ($_.Name -match 'node|cmd|powershell' -and $_.CommandLine -match 'sync-think-${installId}')`,
      '    )',
      '  } |',
      '  ForEach-Object {',
      "    Write-Output ('kill-runtime-pid=' + $_.ProcessId + ' name=' + $_.Name);",
      '    Stop-Process -Id $_.ProcessId -Force',
      '  }',
    ].join(' ');
    try {
      const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', ps]);
      const text = result.stdout.trim();
      if (text) console.log('[desktop]', text);
    } catch (error) {
      console.warn('[desktop] orphan runtime sweep failed', error);
    }
    return;
  }

  try {
    await runCommand('pkill', ['-f', 'runtime/dist/main.js']);
  } catch {
    /* ignore */
  }
}

async function stopExistingRuntime(installId: string): Promise<void> {
  if (child && !child.killed && child.exitCode === null && typeof child.pid === 'number') {
    console.log('[desktop] stopping managed runtime child', child.pid);
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  const pid = readPidFile(installId);
  if (pid && pid !== process.pid) {
    console.log('[desktop] stopping runtime from pid file', pid);
    killProcessTree(pid);
  }
  await killOrphanRuntimeProcesses(installId);
  clearPidFile(installId);
  // Give OS a moment to release the named pipe name.
  await new Promise((r) => setTimeout(r, 600));
  await waitForPipeDown(installId, 8_000);
}

/**
 * If the Runtime named pipe is not accepting connections, spawn the local
 * runtime process and wait until the pipe is ready (or timeout).
 *
 * If a healthy Runtime already owns the pipe, reuse it. Developers can opt in
 * to recycling the process after a rebuild with SYNC_THINK_RUNTIME_FORCE_RESTART=1.
 * Blindly recycling on every Desktop launch races with orphan/dev runtimes and
 * causes EADDRINUSE followed by renderer-visible runtime.unavailable errors.
 */
export async function ensureRuntimeProcess(
  installId: string = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
): Promise<{ ready: boolean; spawned: boolean; error?: string }> {
  const forceRestart =
    process.env.SYNC_THINK_RUNTIME_FORCE_RESTART === '1' && !didForceRestartThisSession;

  if (!forceRestart && (await probePipe(installId))) {
    return { ready: true, spawned: false };
  }

  if (starting) {
    await starting;
    return { ready: await probePipe(installId), spawned: Boolean(child) };
  }

  starting = (async () => {
    const entry = resolveRuntimeEntry();
    if (!entry) {
      console.error(
        '[desktop] runtime entry not found; start `pnpm dev:runtime` or build apps/runtime',
      );
      return;
    }

    const nodeBin = resolveNodeBinary();
    if (!nodeBin) {
      console.error(
        '[desktop] Node 20 runtime was not found; set SYNC_THINK_NODE_BIN or install the workspace-managed Node 20 runtime',
      );
      return;
    }

    if (forceRestart) {
      didForceRestartThisSession = true;
      console.log('[desktop] recycling runtime so Desktop uses the latest build');
      await stopExistingRuntime(installId);
    } else if (await probePipe(installId)) {
      return;
    }

    if (!child || child.killed || child.exitCode !== null) {
      console.log('[desktop] starting managed runtime', { entry, nodeBin });
      child = spawnRuntime(entry, installId, nodeBin);
    }
    const ok = await waitForPipe(installId);
    if (!ok) {
      console.error('[desktop] runtime pipe did not become ready in time');
    }
  })().finally(() => {
    starting = null;
  });

  await starting;
  const ready = await probePipe(installId);
  return {
    ready,
    spawned: Boolean(child),
    error: ready ? undefined : 'runtime.spawn_timeout',
  };
}

export function stopManagedRuntime(): void {
  const proc = child;
  child = null;
  if (!proc || proc.killed) return;
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}
