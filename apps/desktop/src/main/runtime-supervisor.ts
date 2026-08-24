// Ensure the local Runtime pipe process is running before Desktop connects.
// Dev used to require a separate `pnpm dev:runtime`; release users would hang
// on "加载中…" if the pipe is missing. This supervisor starts runtime once.
//
// Also force-restarts an orphan runtime when Desktop starts, so rebuilds do not
// keep serving a stale process that already holds the named pipe.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import {
  computeClientProof,
  computeHmac,
  decodeFrames,
  DEFAULT_FEATURES,
  encodeFrame,
  managedProcessMarker,
  matchesManagedProcessCommandLine,
  pipePathPortable,
  PROTOCOL_VERSION,
  runtimePidFilePath,
  type Hello,
  type HelloProofPayload,
} from '@sync-think/protocol';
import { randomBytes } from 'node:crypto';
import { stopRuntimeChild } from './runtime-child-shutdown.js';
import type { DesktopRuntimeIdentity } from './packaged-install-identity.js';
import { createPowerShellDpapiBridge } from '@sync-think/secure-store';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Console writes from the main process can hit a closed stdout/stderr pipe
 * (the console that launched Desktop is gone, e.g. a background shell or a
 * job pipe that was torn down). Without protection the EPIPE surfaces as an
 * uncaught exception in the main process; logging is best-effort, so swallow.
 */
function safeConsoleWrite(write: () => void): void {
  try {
    write();
  } catch {
    /* console/pipe may be gone — logging is best-effort */
  }
}

let child: ChildProcess | null = null;
let childInstallId: string | null = null;
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
  return dirname(resolveManagedRuntimeDatabasePath());
}

function runtimePidPath(installId: string): string {
  return runtimePidFilePath(resolveManagedRuntimeDatabasePath(), installId);
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

export function probeRuntimePipe(installId: string, timeoutMs = 800): Promise<boolean> {
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
    if (await probeRuntimePipe(installId, 500)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return probeRuntimePipe(installId, 500);
}

export async function waitForRuntimeProcess(installId: string, totalMs = 12_000): Promise<boolean> {
  return waitForPipe(installId, totalMs);
}

async function waitForPipeDown(installId: string, totalMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (!(await probeRuntimePipe(installId, 300))) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function readProcessCommandLine(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === 'win32') {
    try {
      const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { [Console]::Out.Write($p.CommandLine) }`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3_000,
      });
      return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 3_000,
    });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isExpectedManagedProcess(
  pid: number,
  role: 'runtime' | 'daemon',
  installId: string,
): boolean {
  return matchesManagedProcessCommandLine(readProcessCommandLine(pid), role, installId);
}

/** Pure identity predicate used by non-Windows orphan enumeration and tests. */
export function managedRuntimeCommandLineMatches(
  commandLine: string | undefined,
  installId: string,
): boolean {
  return matchesManagedProcessCommandLine(commandLine, 'runtime', installId);
}

function killManagedProcessTree(
  pid: number,
  role: 'runtime' | 'daemon',
  installId: string,
): boolean {
  if (!isProcessAlive(pid)) return true;
  if (!isExpectedManagedProcess(pid, role, installId)) {
    console.warn('[desktop] refused to kill stale/reused managed pid', { pid, role, installId });
    return false;
  }
  killProcessTree(pid);
  return true;
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

export function resolveManagedRuntimeDatabasePath(): string {
  return resolve(process.env.SYNC_THINK_DB_PATH ?? join(defaultDataRoot(), 'sync-think.db'));
}

export function buildManagedRuntimeEnvironment(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
  baseEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
  dataRoot: string = defaultDataRoot(),
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    SYNC_THINK_INSTALL_ID: identity.installId,
    SYNC_THINK_DEV_NO_TOKEN: identity.allowNoToken ? '1' : '0',
    // Keep DB + image staging on a drive with free space (dev machines often fill C:).
    SYNC_THINK_DB_PATH: resolve(
      baseEnvironment.SYNC_THINK_DB_PATH ?? join(dataRoot, 'sync-think.db'),
    ),
    SYNC_THINK_CHAT_IMAGE_STAGING:
      baseEnvironment.SYNC_THINK_CHAT_IMAGE_STAGING ?? join(dataRoot, 'chat-image-staging'),
    SYNC_THINK_CHAT_MESSAGE_IMAGES:
      baseEnvironment.SYNC_THINK_CHAT_MESSAGE_IMAGES ?? join(dataRoot, 'message-images'),
  };
  if (identity.pipeSecret) environment.SYNC_THINK_PIPE_SECRET = identity.pipeSecret;
  else delete environment.SYNC_THINK_PIPE_SECRET;
  // Never pass ELECTRON_RUN_AS_NODE when spawning system Node — it can confuse
  // some environments if inherited from the parent Electron process.
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function spawnRuntime(
  entry: string,
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
  nodeBin: string,
): ChildProcess {
  const dataRoot = defaultDataRoot();
  try {
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(join(dataRoot, 'chat-image-staging'), { recursive: true });
    mkdirSync(join(dataRoot, 'message-images'), { recursive: true });
  } catch {
    /* ignore */
  }
  const env = buildManagedRuntimeEnvironment(identity, process.env, dataRoot);

  const childProcess = spawn(
    nodeBin,
    [entry, managedProcessMarker('runtime', identity.installId)],
    buildRuntimeSpawnOptions(env),
  );

  if (typeof childProcess.unref === 'function') childProcess.unref();

  if (typeof childProcess.pid === 'number') {
    childInstallId = identity.installId;
    writePidFile(identity.installId, childProcess.pid);
  }

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) safeConsoleWrite(() => console.log('[runtime-child]', text));
  });
  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) safeConsoleWrite(() => console.warn('[runtime-child]', text));
  });
  childProcess.on('exit', (code, signal) => {
    safeConsoleWrite(() => console.warn('[desktop] runtime process exited', { code, signal }));
    if (child === childProcess) {
      child = null;
      childInstallId = null;
    }
    clearPidFile(identity.installId);
  });
  childProcess.on('error', (error) => {
    safeConsoleWrite(() => console.error('[desktop] runtime process failed to start', error));
    if (child === childProcess) {
      child = null;
      childInstallId = null;
    }
    clearPidFile(identity.installId);
  });

  return childProcess;
}

export function buildRuntimeSpawnOptions(env: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv;
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'];
  windowsHide: true;
  detached: true;
  shell: false;
} {
  return {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    detached: true,
    shell: false,
  };
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
  // Best-effort force-restart cleanup is identity-scoped. Broad path-based sweeps
  // can terminate another workspace/install that happens to run the same entry.
  if (process.platform === 'win32') {
    const marker = managedProcessMarker('runtime', installId);
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$marker='${marker}'`,
      'Get-CimInstance Win32_Process |',
      '  Where-Object {',
      "    $_.CommandLine -and $_.Name -match 'node' -and",
      `    ((($_.CommandLine -split '\\s+') -replace '^["'']|["'']$','') -contains $marker)`,
      '  } |',
      '  ForEach-Object {',
      "    Write-Output ('kill-runtime-pid=' + $_.ProcessId + ' name=' + $_.Name);",
      '    try {',
      '      Stop-Process -Id $_.ProcessId -Force',
      '    } catch {',
      "      Write-Output ('kill-failed-pid=' + $_.ProcessId);",
      '    }',
      '  }',
    ].join(' ');
    try {
      const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', ps]);
      const text = result.stdout.trim();
      if (text) console.log('[desktop]', text);
      // AccessDenied on elevated orphans is silently swallowed by the sweep;
      // surface it so a later EADDRINUSE on spawn is traceable.
      if (result.stdout.includes('kill-failed-pid=')) {
        console.warn(
          '[desktop] orphan runtime sweep: some processes could not be killed (access denied?)',
        );
      }
    } catch (error) {
      console.warn('[desktop] orphan runtime sweep failed', error);
    }
    return;
  }

  // Non-Windows fallback enumerates candidates and applies the same exact-token
  // identity fence before terminating them. `pkill -f` is intentionally avoided:
  // it performs substring matching and can hit an unrelated command that merely
  // embeds the marker text.
  try {
    const result = await runCommand('ps', ['-eo', 'pid=,command=']);
    for (const line of result.stdout.split(/\r?\n/u)) {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (!match) continue;
      const pid = Number(match[1]);
      const commandLine = match[2];
      if (
        pid !== process.pid &&
        Number.isInteger(pid) &&
        managedRuntimeCommandLineMatches(commandLine, installId)
      ) {
        killManagedProcessTree(pid, 'runtime', installId);
      }
    }
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
    killManagedProcessTree(pid, 'runtime', installId);
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
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ready: boolean; spawned: boolean; error?: string }> {
  const installId = identity.installId;
  const forceRestart =
    process.env.SYNC_THINK_RUNTIME_FORCE_RESTART === '1' && !didForceRestartThisSession;

  if (!forceRestart && (await probeRuntimePipe(installId))) {
    return { ready: true, spawned: false };
  }

  if (starting) {
    await starting;
    return { ready: await probeRuntimePipe(installId), spawned: Boolean(child) };
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
    } else if (await probeRuntimePipe(installId)) {
      return;
    }

    if (!child || child.killed || child.exitCode !== null) {
      console.log('[desktop] starting managed runtime', { entry, nodeBin });
      child = spawnRuntime(entry, identity, nodeBin);
    }
    const ok = await waitForPipe(installId);
    if (!ok) {
      console.error('[desktop] runtime pipe did not become ready in time');
    }
  })().finally(() => {
    starting = null;
  });

  await starting;
  const ready = await probeRuntimePipe(installId);
  return {
    ready,
    spawned: Boolean(child),
    error: ready ? undefined : 'runtime.spawn_timeout',
  };
}

export async function stopManagedRuntime(
  timeoutMs = 12_000,
  requestedIdentity?: Pick<DesktopRuntimeIdentity, 'installId'>,
): Promise<void> {
  const proc = child;
  const installId = childInstallId ?? requestedIdentity?.installId;
  child = null;
  childInstallId = null;
  if (proc) {
    const result = await stopRuntimeChild(proc, { timeoutMs });
    if (result.forced) {
      console.warn('[desktop] runtime graceful shutdown timed out; terminated runtime process');
    }
    if (!result.exited) {
      console.warn('[desktop] runtime process did not report exit after termination');
    }
  } else if (installId) {
    // A newly opened Desktop may be only a client of the detached Runtime.
    // Update/explicit service stop still owns the persisted process lifecycle.
    const pid = readPidFile(installId);
    if (pid && pid !== process.pid) killManagedProcessTree(pid, 'runtime', installId);
  }
  if (installId) {
    // The PID file is only a fast path. It may be missing after a crash or stale
    // writer race, so finish explicit shutdown with an exact-marker orphan sweep.
    await killOrphanRuntimeProcesses(installId);
    clearPidFile(installId);
    await waitForPipeDown(installId, Math.min(timeoutMs, 8_000));
  }
}

// ── 守护进程兜底拉起（T3/Q6）───────────────────────────────────────────────

/** 守护进程管道名（与 runtime daemon 约定：installId + '-daemon'）。 */
export function daemonPipePath(installId: string): string {
  return pipePathPortable(`${installId}-daemon`);
}

/** 探测守护进程管道是否存活（800ms 超时）。 */
export function probeDaemonPipe(installId: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(daemonPipePath(installId));
    let settled = false;
    const done = (ok: boolean): void => {
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

/** 守护进程入口探测（多路径候选，与 resolveRuntimeEntry 同思路）。 */
function resolveDaemonEntry(): string | null {
  const resourcesPath = electronResourcesPath();
  const candidates = [
    process.env.SYNC_THINK_DAEMON_ENTRY,
    resourcesPath ? join(resourcesPath, 'runtime', 'daemon', 'index.js') : undefined,
    join(__dirname, '..', '..', '..', 'runtime', 'dist', 'daemon', 'index.js'),
    join(process.cwd(), 'apps', 'runtime', 'dist', 'daemon', 'index.js'),
    join(process.cwd(), '..', 'runtime', 'dist', 'daemon', 'index.js'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

let daemonChild: ChildProcess | null = null;
let daemonStarting: Promise<void> | null = null;
let daemonInstallId: string | null = null;
let daemonIdentity: Pick<
  DesktopRuntimeIdentity,
  'installId' | 'pipeSecret' | 'allowNoToken'
> | null = null;
let daemonStopRequested = false;
let daemonRestartTimer: NodeJS.Timeout | null = null;
let daemonRestartAttempts = 0;
let daemonEnsureLock: Promise<DaemonEnsureResult> | null = null;
let daemonAutostartDefaultPromise: Promise<{
  ok: boolean;
  changed: boolean;
  enabled: boolean;
}> | null = null;
/** 上次 spawn daemon 的时间（防抖：spawn 到管道监听有秒级延迟，期间重复调用不再拉起）。 */
let daemonSpawnedAt = 0;
const DAEMON_SPAWN_DEBOUNCE_MS = 10_000;
const DAEMON_RESTART_MAX_ATTEMPTS = 3;

interface DaemonEnsureResult {
  ready: boolean;
  spawned: boolean;
  error?: string;
}

function daemonStateDir(): string {
  return dirname(resolveManagedRuntimeDatabasePath());
}

type DaemonAutostartPreference = boolean | undefined;
type DaemonAutostartStartupAction = 'enable' | 'disable' | 'none';
const DAEMON_AUTOSTART_NAME = 'SYNC-THINK Daemon';
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function daemonAutostartPreferencePath(): string {
  return join(daemonStateDir(), 'daemon-autostart-preference.json');
}

function readDaemonAutostartPreference(): DaemonAutostartPreference {
  try {
    const value = JSON.parse(readFileSync(daemonAutostartPreferencePath(), 'utf8')) as {
      enabled?: unknown;
    };
    return typeof value.enabled === 'boolean' ? value.enabled : undefined;
  } catch {
    return undefined;
  }
}

function writeDaemonAutostartPreference(enabled: boolean): void {
  const path = daemonAutostartPreferencePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, enabled })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function isDaemonAutostartRegistered(): boolean {
  try {
    const scheduled = spawnSync('schtasks.exe', ['/Query', '/TN', DAEMON_AUTOSTART_NAME], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (scheduled.status === 0) return true;
    const registry = spawnSync('reg.exe', ['QUERY', WINDOWS_RUN_KEY, '/v', DAEMON_AUTOSTART_NAME], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    return registry.status === 0;
  } catch {
    return false;
  }
}

export function resolveDaemonAutostartStartupAction(
  preference: DaemonAutostartPreference,
  registered: boolean,
): DaemonAutostartStartupAction {
  if (preference === false) return registered ? 'disable' : 'none';
  return registered ? 'none' : 'enable';
}

function daemonPidPath(installId: string): string {
  return join(daemonStateDir(), `daemon-${installId}.pid`);
}

function readDaemonPid(installId: string): number | null {
  try {
    const pid = Number(readFileSync(daemonPidPath(installId), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeDaemonPid(installId: string, pid: number): void {
  try {
    mkdirSync(daemonStateDir(), { recursive: true });
    writeFileSync(daemonPidPath(installId), String(pid), 'utf8');
  } catch (error) {
    console.warn('[desktop] failed to write daemon pid file', error);
  }
}

function clearDaemonPid(installId: string): void {
  try {
    unlinkSync(daemonPidPath(installId));
  } catch {
    /* ignore */
  }
}

async function waitForDaemonPipe(installId: string, totalMs = 12_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (await probeDaemonPipe(installId, 500)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return probeDaemonPipe(installId, 500);
}

async function waitForDaemonPipeDown(installId: string, totalMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (!(await probeDaemonPipe(installId, 300))) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForProcessExit(proc: ChildProcess, totalMs: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
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
    const timer = setTimeout(() => done(false), totalMs);
    proc.once('exit', onExit);
  });
}

async function waitForPidExit(pid: number, totalMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !isProcessAlive(pid);
}

/**
 * 桌面启动时兜底拉起守护进程（T3）：探测 daemon 管道——不在运行 →
 * spawn daemon 进程（登录自启之外的第二重保证）。已注册自启时也兜底
 * （自启可能在下次登录才生效）。
 */
async function ensureDaemonProcessInternal(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
  options: { bypassSpawnDebounce?: boolean } = {},
): Promise<DaemonEnsureResult> {
  const installId = identity.installId;
  daemonInstallId = installId;
  daemonIdentity = identity;
  daemonStopRequested = false;

  if (await probeDaemonPipe(installId)) {
    daemonRestartAttempts = 0;
    return { ready: true, spawned: false };
  }

  // 先按当前安装的 PID 清理残留，避免 detached/autostart daemon 占用旧代码。
  const stalePid = readDaemonPid(installId);
  if (stalePid && stalePid !== process.pid && (!daemonChild || daemonChild.pid !== stalePid)) {
    if (isProcessAlive(stalePid)) {
      const existingReady = await waitForDaemonPipe(installId, 3_000);
      if (existingReady) {
        daemonRestartAttempts = 0;
        return { ready: true, spawned: false };
      }
    }
    killManagedProcessTree(stalePid, 'daemon', installId);
    clearDaemonPid(installId);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Sweep only when a persisted managed identity exists. Running a global scan
  // on every cold start could kill the outer supervisor we just spawned (its PID
  // is distinct from the child daemon PID that later owns the pid file).
  if (stalePid) await killOrphanDaemonProcesses(installId);

  // Cold-start calls are debounced while the just-spawned process opens its
  // pipe. A known child exit is different: the old process is gone, so the
  // supervised restart must be allowed to spawn immediately after backoff.
  if (!options.bypassSpawnDebounce && Date.now() - daemonSpawnedAt < DAEMON_SPAWN_DEBOUNCE_MS) {
    const ready = await waitForDaemonPipe(installId, 3_000);
    return { ready, spawned: true, ...(ready ? {} : { error: 'daemon readiness timeout' }) };
  }

  if (daemonStarting) {
    await daemonStarting;
    const ready = await waitForDaemonPipe(installId, 3_000);
    return {
      ready,
      spawned: Boolean(daemonChild),
      ...(ready ? {} : { error: 'daemon readiness timeout' }),
    };
  }

  daemonStarting = (async () => {
    const entry = resolveDaemonEntry();
    if (!entry) {
      console.error('[desktop] daemon entry not found; build apps/runtime first');
      return;
    }
    const nodeBin = resolveNodeBinary();
    if (!nodeBin) {
      console.error('[desktop] Node runtime not found for daemon; set SYNC_THINK_NODE_BIN');
      return;
    }
    const env = buildManagedRuntimeEnvironment(identity, process.env, defaultDataRoot());
    console.log('[desktop] starting managed daemon', { entry, nodeBin });
    const childProcess = spawn(
      nodeBin,
      [entry, managedProcessMarker('daemon', identity.installId)],
      {
        env,
        // daemon/index.js writes daemon.log itself; stdio remains detached from
        // Electron so process lifetime is independent of the desktop window.
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
        shell: false,
      },
    );
    daemonChild = childProcess;
    daemonInstallId = installId;
    daemonIdentity = identity;
    daemonSpawnedAt = Date.now();
    writeDaemonPid(installId, childProcess.pid ?? 0);
    // detached 子进程需要 unref，否则父进程会等待它退出。
    childProcess.unref();
    childProcess.on('exit', () => {
      if (daemonChild === childProcess) daemonChild = null;
      clearDaemonPid(installId);
      if (!daemonStopRequested && daemonIdentity?.installId === installId) {
        scheduleDaemonRestart();
      }
    });
    childProcess.on('error', (error) => {
      console.error('[desktop] daemon spawn failed', error);
    });
  })();

  try {
    await daemonStarting;
  } finally {
    daemonStarting = null;
  }
  if (!daemonChild && !(await probeDaemonPipe(installId))) {
    return { ready: false, spawned: false, error: 'daemon entry not found or process exited' };
  }
  const ready = await waitForDaemonPipe(installId);
  if (ready) daemonRestartAttempts = 0;
  return {
    ready,
    spawned: Boolean(daemonChild),
    ...(ready ? {} : { error: 'daemon readiness timeout' }),
  };
}

/** Serialize cold-start/reconnect calls so two IPC requests cannot spawn two daemons. */
async function ensureDaemonProcessWithOptions(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
  options: { bypassSpawnDebounce?: boolean } = {},
): Promise<DaemonEnsureResult> {
  if (daemonEnsureLock) return daemonEnsureLock;
  const operation = ensureDaemonProcessInternal(identity, options);
  daemonEnsureLock = operation.finally(() => {
    daemonEnsureLock = null;
  });
  return daemonEnsureLock;
}

export function ensureDaemonProcess(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<DaemonEnsureResult> {
  return ensureDaemonProcessWithOptions(identity);
}

/** 清理携带当前安装身份 marker 的孤儿 daemon 进程。 */
async function killOrphanDaemonProcesses(installId: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const marker = managedProcessMarker('daemon', installId);
  const kill = spawn(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$marker = '${marker}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and (((($_.CommandLine -split '\\s+') -replace '^["'']|["'']$','') -contains $marker)) -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  await new Promise<void>((resolve) => {
    kill.on('exit', () => resolve());
    kill.on('error', () => resolve());
    setTimeout(resolve, 3_000);
  });
}

export function daemonRestartDelayMs(attempt: number): number {
  return Math.min(5_000, Math.max(1, attempt) * 1_000);
}

function scheduleDaemonRestart(): void {
  if (daemonRestartTimer || daemonStopRequested || !daemonIdentity) return;
  if (daemonRestartAttempts >= DAEMON_RESTART_MAX_ATTEMPTS) {
    console.error('[desktop] daemon restart limit reached');
    return;
  }
  daemonRestartAttempts += 1;
  daemonRestartTimer = setTimeout(() => {
    daemonRestartTimer = null;
    const identity = daemonIdentity;
    if (!identity || daemonStopRequested) return;
    void ensureDaemonProcessWithOptions(identity, { bypassSpawnDebounce: true })
      .then((result) => {
        if (!result.ready) scheduleDaemonRestart();
      })
      .catch((error) => {
        console.warn('[desktop] daemon restart failed', error);
        scheduleDaemonRestart();
      });
  }, daemonRestartDelayMs(daemonRestartAttempts));
}

/** 停止守护进程（应用退出 / 升级前）。 */
export async function stopManagedDaemon(
  timeoutMs = 5_000,
  requestedIdentity?: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<void> {
  daemonStopRequested = true;
  if (daemonRestartTimer) {
    clearTimeout(daemonRestartTimer);
    daemonRestartTimer = null;
  }
  const identity =
    requestedIdentity ??
    daemonIdentity ??
    (daemonInstallId
      ? {
          installId: daemonInstallId,
          pipeSecret: process.env.SYNC_THINK_PIPE_SECRET,
          allowNoToken: process.env.SYNC_THINK_DEV_NO_TOKEN === '1',
        }
      : null);
  const proc = daemonChild;
  daemonChild = null;
  if (identity) {
    await requestDaemonFrame(
      'daemon.stop',
      {},
      identity.installId,
      identity.pipeSecret,
      Math.min(timeoutMs, 2_000),
    ).catch(() => undefined);
  }
  if (proc && proc.exitCode === null) {
    const exited = await waitForProcessExit(proc, timeoutMs);
    if (!exited && proc.exitCode === null) {
      const result = await stopRuntimeChild(proc, { timeoutMs });
      if (result.forced) {
        console.warn('[desktop] daemon graceful shutdown timed out; terminated daemon process');
      }
    }
  }
  if (identity) {
    const pid = readDaemonPid(identity.installId);
    if (pid && pid !== process.pid && isProcessAlive(pid)) {
      const exited = await waitForPidExit(pid, timeoutMs);
      if (!exited) killManagedProcessTree(pid, 'daemon', identity.installId);
    }
    clearDaemonPid(identity.installId);
    await waitForDaemonPipeDown(identity.installId, timeoutMs);
  }
}

// ── 守护进程管理辅助（T11）───────────────────────────────────────────────

/**
 * 向守护进程发送一帧请求并等待响应（轻量客户端）。
 * 连接 daemon 管道 → 发帧 → 等匹配响应（2s 超时）。
 * 守护进程不在/超时 → 返回 { error }。
 */
export async function requestDaemonFrame(
  type: string,
  payload: unknown,
  installId: string,
  helloSecret?: string,
  timeoutMs = 2_000,
): Promise<{ ok: boolean; payload?: unknown; error?: string }> {
  const path = daemonPipePath(installId);
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: { ok: boolean; payload?: unknown; error?: string }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const socket = connect(path);
    let buffer: Buffer = Buffer.alloc(0);
    let authenticated = false;
    let helloPhase: 'hello' | 'proof' | 'done' = 'hello';
    let helloNonce = '';
    let helloResolve: ((ok: boolean) => void) | null = null;
    const timer = setTimeout(() => {
      socket.destroy();
      done({ ok: false, error: 'daemon timeout' });
    }, timeoutMs);

    const isChallenge = (
      value: unknown,
    ): value is { challenge: true; runtimeNonce: string; runtimeToken: string } => {
      if (!value || typeof value !== 'object') return false;
      const p = value as Record<string, unknown>;
      return (
        p.challenge === true &&
        typeof p.runtimeNonce === 'string' &&
        typeof p.runtimeToken === 'string'
      );
    };
    const isAccepted = (value: unknown): value is { ok: true } =>
      Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true);

    const handleHelloFrame = (frame: import('@sync-think/protocol').Frame): void => {
      if (helloPhase === 'hello' && frame.type === '__hello') {
        const payload = frame.payload as {
          challenge?: boolean;
          ok?: boolean;
          runtimeNonce?: string;
          runtimeToken?: string;
        };
        if (isAccepted(payload)) {
          helloPhase = 'done';
          authenticated = true;
          helloResolve?.(true);
          return;
        }
        if (!isChallenge(payload)) {
          helloPhase = 'done';
          helloResolve?.(false);
          return;
        }
        helloPhase = 'proof';
        if (!helloSecret) {
          helloPhase = 'done';
          helloResolve?.(false);
          return;
        }
        const proof: HelloProofPayload = {
          installId,
          clientNonce: helloNonce,
          runtimeNonce: payload.runtimeNonce,
          token: computeClientProof(helloSecret, helloNonce, payload.runtimeNonce, installId),
        };
        socket.write(
          encodeFrame({
            id: 'hello-proof',
            kind: 'request',
            type: '__hello.proof',
            payload: proof,
          }),
        );
        return;
      }
      if (helloPhase === 'proof' && frame.type === '__hello.proof') {
        if (isAccepted(frame.payload)) {
          helloPhase = 'done';
          authenticated = true;
          helloResolve?.(true);
          return;
        }
        helloPhase = 'done';
        helloResolve?.(false);
      }
    };

    socket.on('data', (chunk: Buffer) => {
      const prev = buffer;
      try {
        const decoded = decodeFrames(prev.length === 0 ? chunk : Buffer.concat([prev, chunk]));
        buffer = decoded.remaining;
        for (const frame of decoded.frames) {
          if (!authenticated) {
            handleHelloFrame(frame);
            continue;
          }
          if (frame.type === type) {
            clearTimeout(timer);
            socket.end();
            done({ ok: true, payload: frame.payload });
            return;
          }
        }
      } catch {
        socket.destroy();
        done({ ok: false, error: 'daemon frame parse error' });
      }
    });
    socket.on('connect', () => {
      // 1. 握手（__hello → 认证）→ 2. 发目标帧。
      const helloOk = new Promise<boolean>((resolveHello) => {
        helloResolve = resolveHello;
        helloNonce = randomBytes(16).toString('hex');
        const hello: Hello = {
          protocolVersion: PROTOCOL_VERSION,
          appVersion: 'sync-think-desktop',
          installId,
          nonce: helloNonce,
          features: [...DEFAULT_FEATURES],
        };
        if (helloSecret) hello.token = computeHmac(helloSecret, helloNonce, installId);
        socket.write(
          encodeFrame({ id: 'hello', kind: 'request', type: '__hello', payload: hello }),
        );
        setTimeout(() => {
          if (helloPhase !== 'done') {
            helloPhase = 'done';
            resolveHello(false);
          }
        }, 2_000);
      });
      void helloOk.then((ok) => {
        if (!ok) {
          socket.end();
          done({ ok: false, error: 'daemon handshake failed' });
          return;
        }
        socket.write(
          encodeFrame({ id: `daemon-mgmt-${Date.now()}`, kind: 'request', type, payload }),
        );
      });
    });
    socket.on('error', () => {
      clearTimeout(timer);
      done({ ok: false, error: 'daemon not reachable' });
    });
  });
}

/** 读取 daemon 日志文件（状态目录下 daemon.log，尾部 200 行）。 */
export function readDaemonLogs(limit = 200): string[] {
  try {
    const logPath = join(daemonStateDir(), 'daemon.log');
    if (!existsSync(logPath)) return [];
    const content = readFileSync(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * 设置登录自启。优先使用 schtasks，权限策略拒绝时回退到 HKCU Run；
 * 注册需要 node + daemon 入口路径，关闭时同时清理两种注册。
 */
async function writeDaemonBootstrap(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<string> {
  const dataRoot = daemonStateDir();
  mkdirSync(dataRoot, { recursive: true });
  const path = join(dataRoot, 'daemon-bootstrap.json');
  let pipeSecretCiphertext: string | undefined;
  if (identity.pipeSecret) {
    const bridge = createPowerShellDpapiBridge();
    pipeSecretCiphertext = await bridge.protect(Buffer.from(identity.pipeSecret, 'utf8'));
  }
  const payload = {
    version: 1 as const,
    installId: identity.installId,
    dbPath: resolveManagedRuntimeDatabasePath(),
    allowNoToken: identity.allowNoToken,
    ...(pipeSecretCiphertext ? { pipeSecretCiphertext } : {}),
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

/** Build the scheduled-task command; secrets stay in the protected bootstrap file. */
export function buildDaemonAutostartCommand(
  nodeBin: string,
  daemonEntry: string,
  bootstrapPath: string,
  installId?: string,
): string {
  const marker = installId ? ` ${managedProcessMarker('daemon', installId)}` : '';
  return `schtasks /Create /TN "SYNC-THINK Daemon" /TR "\\"${nodeBin}\\" \\"${daemonEntry}\\" --bootstrap \\"${bootstrapPath}\\"${marker}" /SC ONLOGON /RL LIMITED /F`;
}

/** Launch command stored in the current-user Run key when Task Scheduler denies creation. */
export function buildDaemonRegistryAutostartCommand(
  nodeBin: string,
  daemonEntry: string,
  bootstrapPath: string,
  installId?: string,
): string {
  const marker = installId ? ` ${managedProcessMarker('daemon', installId)}` : '';
  return `"${nodeBin}" "${daemonEntry}" --bootstrap "${bootstrapPath}"${marker}`;
}

export async function setDaemonAutostart(
  enabled: boolean,
  identity?: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ok: boolean }> {
  try {
    if (!enabled) {
      spawnSync('schtasks.exe', ['/Delete', '/TN', DAEMON_AUTOSTART_NAME, '/F'], {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      });
      spawnSync('reg.exe', ['DELETE', WINDOWS_RUN_KEY, '/v', DAEMON_AUTOSTART_NAME, '/f'], {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      });
      const disabled = !isDaemonAutostartRegistered();
      if (disabled) {
        try {
          unlinkSync(join(daemonStateDir(), 'daemon-bootstrap.json'));
        } catch {
          /* ignore */
        }
        writeDaemonAutostartPreference(false);
      }
      return { ok: disabled };
    }
    const entry = resolveDaemonEntry();
    const nodeBin = resolveNodeBinary();
    if (!entry || !nodeBin || !identity) return { ok: false };
    const bootstrapPath = await writeDaemonBootstrap(identity);
    const launchCommand = buildDaemonRegistryAutostartCommand(
      nodeBin,
      entry,
      bootstrapPath,
      identity.installId,
    );
    const scheduled = spawnSync(
      'schtasks.exe',
      [
        '/Create',
        '/TN',
        DAEMON_AUTOSTART_NAME,
        '/TR',
        launchCommand,
        '/SC',
        'ONLOGON',
        '/RL',
        'LIMITED',
        '/F',
      ],
      {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      },
    );
    let ok = scheduled.status === 0;
    if (ok) {
      // Avoid two login launches after a previously required registry fallback.
      spawnSync('reg.exe', ['DELETE', WINDOWS_RUN_KEY, '/v', DAEMON_AUTOSTART_NAME, '/f'], {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      });
    } else {
      const registry = spawnSync(
        'reg.exe',
        [
          'ADD',
          WINDOWS_RUN_KEY,
          '/v',
          DAEMON_AUTOSTART_NAME,
          '/t',
          'REG_SZ',
          '/d',
          launchCommand,
          '/f',
        ],
        {
          shell: false,
          windowsHide: true,
          encoding: 'utf8',
        },
      );
      ok = registry.status === 0;
    }
    if (ok) writeDaemonAutostartPreference(true);
    return { ok };
  } catch {
    return { ok: false };
  }
}

/** Enable login startup once by default, while preserving an explicit opt-out. */
async function initializeDaemonAutostartDefault(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ok: boolean; changed: boolean; enabled: boolean }> {
  const preference = readDaemonAutostartPreference();
  const registered = isDaemonAutostartRegistered();
  const action = resolveDaemonAutostartStartupAction(preference, registered);

  if (action === 'none') {
    if (preference === undefined && registered) writeDaemonAutostartPreference(true);
    return { ok: true, changed: false, enabled: registered };
  }

  const result = await setDaemonAutostart(action === 'enable', identity);
  return {
    ok: result.ok,
    changed: result.ok,
    enabled: result.ok ? action === 'enable' : registered,
  };
}

export function ensureDaemonAutostartDefault(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ok: boolean; changed: boolean; enabled: boolean }> {
  daemonAutostartDefaultPromise ??= initializeDaemonAutostartDefault(identity);
  return daemonAutostartDefaultPromise;
}
