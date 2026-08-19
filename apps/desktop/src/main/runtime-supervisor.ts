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
  pipePathPortable,
  PROTOCOL_VERSION,
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
    SYNC_THINK_DB_PATH: resolve(baseEnvironment.SYNC_THINK_DB_PATH ?? join(dataRoot, 'sync-think.db')),
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

  const childProcess = spawn(nodeBin, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    detached: false,
    shell: false,
  });

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
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ready: boolean; spawned: boolean; error?: string }> {
  const installId = identity.installId;
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
  const ready = await probePipe(installId);
  return {
    ready,
    spawned: Boolean(child),
    error: ready ? undefined : 'runtime.spawn_timeout',
  };
}

export async function stopManagedRuntime(timeoutMs = 12_000): Promise<void> {
  const proc = child;
  const installId = childInstallId;
  child = null;
  childInstallId = null;
  if (!proc) {
    if (installId) clearPidFile(installId);
    return;
  }

  const result = await stopRuntimeChild(proc, { timeoutMs });
  if (result.forced) {
    console.warn('[desktop] runtime graceful shutdown timed out; terminated runtime process');
  }
  if (!result.exited) {
    console.warn('[desktop] runtime process did not report exit after termination');
  }
  if (installId) clearPidFile(installId);
}

// ── 守护进程兜底拉起（T3/Q6）───────────────────────────────────────────────

/** 守护进程管道名（与 runtime daemon 约定：installId + '-daemon'）。 */
export function daemonPipePath(installId: string): string {
  return pipePathPortable(`${installId}-daemon`);
}

/** 探测守护进程管道是否存活（800ms 超时）。 */
function probeDaemonPipe(installId: string, timeoutMs = 800): Promise<boolean> {
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
let daemonIdentity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'> | null = null;
let daemonStopRequested = false;
let daemonRestartTimer: NodeJS.Timeout | null = null;
let daemonRestartAttempts = 0;
let daemonEnsureLock: Promise<DaemonEnsureResult> | null = null;
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
    mkdirSync(defaultDataRoot(), { recursive: true });
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

/**
 * 桌面启动时兜底拉起守护进程（T3）：探测 daemon 管道——不在运行 →
 * spawn daemon 进程（登录自启之外的第二重保证）。已注册自启时也兜底
 * （自启可能在下次登录才生效）。
 */
async function ensureDaemonProcessInternal(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
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
  if (
    stalePid &&
    stalePid !== process.pid &&
    (!daemonChild || daemonChild.pid !== stalePid)
  ) {
    if (isProcessAlive(stalePid)) {
      const existingReady = await waitForDaemonPipe(installId, 3_000);
      if (existingReady) {
        daemonRestartAttempts = 0;
        return { ready: true, spawned: false };
      }
    }
    killProcessTree(stalePid);
    clearDaemonPid(installId);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await killOrphanDaemonProcesses(installId);

  // 防抖：短时间内已拉起过（管道可能还没监听）→ 不再重复 spawn。
  if (Date.now() - daemonSpawnedAt < DAEMON_SPAWN_DEBOUNCE_MS) {
    const ready = await waitForDaemonPipe(installId, 3_000);
    return { ready, spawned: true, ...(ready ? {} : { error: 'daemon readiness timeout' }) };
  }

  if (daemonStarting) {
    await daemonStarting;
    const ready = await waitForDaemonPipe(installId, 3_000);
    return { ready, spawned: Boolean(daemonChild), ...(ready ? {} : { error: 'daemon readiness timeout' }) };
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
    const childProcess = spawn(nodeBin, [entry], {
      env,
      // daemon/index.js writes daemon.log itself; stdio remains detached from
      // Electron so process lifetime is independent of the desktop window.
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
      shell: false,
    });
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
  return { ready, spawned: Boolean(daemonChild), ...(ready ? {} : { error: 'daemon readiness timeout' }) };
}

/** Serialize cold-start/reconnect calls so two IPC requests cannot spawn two daemons. */
export async function ensureDaemonProcess(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<DaemonEnsureResult> {
  if (daemonEnsureLock) return daemonEnsureLock;
  const operation = ensureDaemonProcessInternal(identity);
  daemonEnsureLock = operation.finally(() => {
    daemonEnsureLock = null;
  });
  return daemonEnsureLock;
}

/** 清理所有孤儿 daemon 进程（命令行含 daemon/index.js 的 node 进程）。 */
async function killOrphanDaemonProcesses(installId: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const pattern = `SYNC_THINK_INSTALL_ID[= ]+${installId}`;
  const kill = spawn('powershell', [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${pattern}' -and $_.CommandLine -match 'daemon[\\\\/]+index\\.js' -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ], { stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve) => {
    kill.on('exit', () => resolve());
    kill.on('error', () => resolve());
    setTimeout(resolve, 3_000);
  });
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
    void ensureDaemonProcess(identity).catch((error) =>
      console.warn('[desktop] daemon restart failed', error),
    );
  }, Math.min(5_000, daemonRestartAttempts * 1_000));
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
  const identity = requestedIdentity ?? daemonIdentity ??
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
    const result = await stopRuntimeChild(proc, { timeoutMs });
    if (result.forced) {
      console.warn('[desktop] daemon graceful shutdown timed out; terminated daemon process');
    }
  }
  if (identity) {
    const pid = readDaemonPid(identity.installId);
    if (pid && pid !== process.pid) killProcessTree(pid);
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

    const isChallenge = (value: unknown): value is { challenge: true; runtimeNonce: string; runtimeToken: string } => {
      if (!value || typeof value !== 'object') return false;
      const p = value as Record<string, unknown>;
      return p.challenge === true && typeof p.runtimeNonce === 'string' && typeof p.runtimeToken === 'string';
    };
    const isAccepted = (value: unknown): value is { ok: true } =>
      Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true);

    const handleHelloFrame = (frame: import('@sync-think/protocol').Frame): void => {
      if (helloPhase === 'hello' && frame.type === '__hello') {
        const payload = frame.payload as { challenge?: boolean; ok?: boolean; runtimeNonce?: string; runtimeToken?: string };
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
        socket.write(encodeFrame({ id: 'hello-proof', kind: 'request', type: '__hello.proof', payload: proof }));
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
        socket.write(encodeFrame({ id: 'hello', kind: 'request', type: '__hello', payload: hello }));
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
        socket.write(encodeFrame({ id: `daemon-mgmt-${Date.now()}`, kind: 'request', type, payload }));
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
 * 设置登录自启（schtasks 注册/移除）。
 * 注册需要 node + daemon 入口路径；移除只删任务。
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
): string {
  return `schtasks /Create /TN "SYNC-THINK Daemon" /TR "\\"${nodeBin}\\" \\"${daemonEntry}\\" --bootstrap \\"${bootstrapPath}\\"" /SC ONLOGON /RL LIMITED /F`;
}

export async function setDaemonAutostart(
  enabled: boolean,
  identity?: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ok: boolean }> {
  try {
    if (!enabled) {
      const result = spawnSync(
        'schtasks /Delete /TN "SYNC-THINK Daemon" /F',
        { shell: true, windowsHide: true, encoding: 'utf8' },
      );
      try {
        unlinkSync(join(daemonStateDir(), 'daemon-bootstrap.json'));
      } catch {
        /* ignore */
      }
      return { ok: result.status === 0 };
    }
    const entry = resolveDaemonEntry();
    const nodeBin = resolveNodeBinary();
    if (!entry || !nodeBin || !identity) return { ok: false };
    const bootstrapPath = await writeDaemonBootstrap(identity);
    const result = spawnSync(
      buildDaemonAutostartCommand(nodeBin, entry, bootstrapPath),
      { shell: true, windowsHide: true, encoding: 'utf8' },
    );
    return { ok: result.status === 0 };
  } catch {
    return { ok: false };
  }
}
