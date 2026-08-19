// Ensure the local Runtime pipe process is running before Desktop connects.
// Dev used to require a separate `pnpm dev:runtime`; release users would hang
// on "加载中…" if the pipe is missing. This supervisor starts runtime once.
//
// Also force-restarts an orphan runtime when Desktop starts, so rebuilds do not
// keep serving a stale process that already holds the named pipe.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { decodeFrames, encodeFrame, pipePathPortable } from '@sync-think/protocol';
import { stopRuntimeChild } from './runtime-child-shutdown.js';
import type { DesktopRuntimeIdentity } from './packaged-install-identity.js';

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

/**
 * 桌面启动时兜底拉起守护进程（T3）：探测 daemon 管道——不在运行 →
 * spawn daemon 进程（登录自启之外的第二重保证）。已注册自启时也兜底
 * （自启可能在下次登录才生效）。
 */
export async function ensureDaemonProcess(
  identity: Pick<DesktopRuntimeIdentity, 'installId' | 'pipeSecret' | 'allowNoToken'>,
): Promise<{ ready: boolean; spawned: boolean; error?: string }> {
  const installId = identity.installId;

  if (await probeDaemonPipe(installId)) {
    return { ready: true, spawned: false };
  }

  if (daemonStarting) {
    await daemonStarting;
    return { ready: await probeDaemonPipe(installId), spawned: Boolean(daemonChild) };
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
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
      shell: false,
    });
    daemonChild = childProcess;
    childProcess.on('exit', () => {
      if (daemonChild === childProcess) daemonChild = null;
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
  return { ready: await probeDaemonPipe(installId), spawned: Boolean(daemonChild) };
}

/** 停止守护进程（应用退出 / 升级前）。 */
export async function stopManagedDaemon(timeoutMs = 5_000): Promise<void> {
  const proc = daemonChild;
  daemonChild = null;
  if (!proc) return;
  if (proc.exitCode !== null) return;
  const result = await stopRuntimeChild(proc, { timeoutMs });
  if (result.forced) {
    console.warn('[desktop] daemon graceful shutdown timed out; terminated daemon process');
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
    const timer = setTimeout(() => {
      socket.destroy();
      done({ ok: false, error: 'daemon timeout' });
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      const prev = buffer;
      try {
        const decoded = decodeFrames(prev.length === 0 ? chunk : Buffer.concat([prev, chunk]));
        buffer = decoded.remaining;
        for (const frame of decoded.frames) {
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
      socket.write(encodeFrame({ id: `daemon-mgmt-${Date.now()}`, kind: 'request', type, payload }));
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
    const logPath = join(defaultDataRoot(), 'SYNC-THINK', 'daemon.log');
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
export async function setDaemonAutostart(enabled: boolean): Promise<{ ok: boolean }> {
  try {
    if (!enabled) {
      const result = spawnSync(
        'schtasks /Delete /TN "SYNC-THINK Daemon" /F',
        { shell: true, windowsHide: true, encoding: 'utf8' },
      );
      return { ok: result.status === 0 };
    }
    const entry = resolveDaemonEntry();
    const nodeBin = resolveNodeBinary();
    if (!entry || !nodeBin) return { ok: false };
    const result = spawnSync(
      `schtasks /Create /TN "SYNC-THINK Daemon" /TR "\\"${nodeBin}\\" \\"${entry}\\"" /SC ONLOGON /RL LIMITED /F`,
      { shell: true, windowsHide: true, encoding: 'utf8' },
    );
    return { ok: result.status === 0 };
  } catch {
    return { ok: false };
  }
}
