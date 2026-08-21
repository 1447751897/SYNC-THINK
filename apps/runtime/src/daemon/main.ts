/**
 * 守护进程入口（Windows，登录时由计划任务拉起）。
 *
 * 常驻内容（spec T2）：轻量 DB 连接（只建 scheduledTaskStore /
 * appSettingStore，不启动完整 Runtime）→ croner 定时器注册表（启动全量
 * 重扫 + 增删改 diff）→ 心跳（1 次/秒）→ 命名管道服务端（HMAC 握手，
 * 供 CLI 查询与未来投递协议）。
 *
 * 执行路径选择（spec Q4）与真实触发由后续票（T6/T7）接入；本骨架把
 * 到点任务回调接到一个可替换的 handler（默认记录日志并更新状态）。
 */

import {
  appendFileSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { openDatabaseAsync, runMigrations } from '@sync-think/storage';
import { SqliteScheduledTaskStore } from '@sync-think/storage';
import { SqliteAppSettingStore } from '@sync-think/storage';
import {
  DEFAULT_DEV_INSTALL_ID,
  encodeFrame,
  managedProcessMarker,
  matchesManagedProcessCommandLine,
  runtimePidFilePath,
} from '@sync-think/protocol';
import { ulid } from '@sync-think/shared';
import { daemonPipePath, probeDesktopPipe } from './yield.js';
import { isAutostartRegistered as autostartRegistered } from './autostart.js';
import { buildDaemonStatusPayload } from './manage.js';
import { createPipeServer, type PipeServerHandlers } from '../pipe/server.js';
import { resolveRuntimeDatabasePath } from '../persistence.js';
import {
  TimerRegistry,
  createDaemonStatus,
  updateDaemonStatus,
  rollDaemonStatusDay,
  type DaemonStatus,
} from './core.js';
import { decideDue, type SchedulerDecision } from '../scheduler-core.js';
import { chooseDispatchPath, composeTaskCommand } from './dispatch.js';
import { buildWorkerCommand, runWorkerProcess } from './worker.js';
import { dispatchTaskToDesktop } from './dispatch-client.js';
import { classifyInterruption, DispatchedTracker, applyAbort } from './interrupt.js';
import { parseTaskFrame } from './protocol.js';
import { planCatchupSweep } from './catchup.js';
import { TaskConcurrencyManager } from './queue.js';
import { createRuleAwareTimerRegistrar } from './timers.js';
import { buildSupervisedRuntimeSpawnOptions, stopSupervisedRuntimeChild } from './runtime-child.js';
import { requestRuntimeShutdown } from './runtime-control-client.js';

const HEARTBEAT_INTERVAL_MS = 1_000;
const RUNTIME_HEALTH_INTERVAL_MS = 5_000;
const RUNTIME_START_TIMEOUT_MS = 15_000;
const STATUS_FILE = 'daemon-status.json';
let configuredLogPath: string | undefined;
const baseConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function configureFileLogging(dbPath: string): void {
  if (process.env.SYNC_THINK_DAEMON_FILE_LOG !== '1') return;
  const logPath = join(stateDir(dbPath), 'daemon.log');
  if (configuredLogPath === logPath) return;
  try {
    mkdirSync(stateDir(dbPath), { recursive: true });
  } catch {
    return;
  }
  configuredLogPath = logPath;
  const append = (level: string, args: unknown[]): void => {
    try {
      appendFileSync(
        logPath,
        `${new Date().toISOString()} [${level}] ${format(...args)}\n`,
        'utf8',
      );
    } catch {
      /* logging must never affect scheduling */
    }
  };
  console.log = (...args: unknown[]) => {
    baseConsole.log(...args);
    append('info', args);
  };
  console.warn = (...args: unknown[]) => {
    baseConsole.warn(...args);
    append('warn', args);
  };
  console.error = (...args: unknown[]) => {
    baseConsole.error(...args);
    append('error', args);
  };
}

/** runtime 入口探测（与 desktop runtime-supervisor 一致的多路径候选）。 */
export function resolveRuntimeEntry(): string | null {
  const resourcesPath =
    process.env.SYNC_THINK_RESOURCES_PATH ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.SYNC_THINK_RUNTIME_ENTRY,
    resourcesPath ? join(resourcesPath, 'runtime', 'main.js') : undefined,
    resourcesPath ? join(resourcesPath, 'runtime', 'dist', 'main.js') : undefined,
    join(moduleDir, '..', 'main.js'),
    join(moduleDir, '..', 'dist', 'main.js'),
    join(process.cwd(), 'apps', 'runtime', 'dist', 'main.js'),
    join(process.cwd(), '..', 'runtime', 'dist', 'main.js'),
    join(process.cwd(), 'runtime', 'main.js'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/** node 可执行文件（注入用，默认 process.execPath）。 */
export function resolveNodeBin(): string {
  return process.env.SYNC_THINK_NODE_BIN ?? process.execPath;
}

/** 到点任务处理器（T6/T7 会替换为真实的投递/自拉执行）。 */
export type TaskFireHandler = (taskId: string, decision: SchedulerDecision) => void;

export interface DaemonOptions {
  dbPath?: string;
  installId?: string;
  helloSecret?: string;
  allowNoToken?: boolean;
  /** 到点处理器（默认：日志 + 状态计数）。 */
  onFire?: TaskFireHandler;
  /** 注入的定时器注册器（默认 croner；测试可注入 fake）。 */
  registrar?: TimerRegistry['registrar'] & {
    registerTimer(taskId: string, fire: () => void): unknown;
  };
  statusStore?: import('./core.js').StatusFileStore;
  now?: () => Date;
}

function stateDir(dbPath: string): string {
  if (dbPath !== ':memory:') return dirname(dbPath);
  const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), '.sync-think');
  return join(dataRoot, 'SYNC-THINK');
}

function statusFilePath(dbPath: string): string {
  return join(stateDir(dbPath), STATUS_FILE);
}

function readStatus(dbPath: string): DaemonStatus | undefined {
  try {
    const raw = readFileSync(statusFilePath(dbPath), 'utf8');
    return JSON.parse(raw) as DaemonStatus;
  } catch {
    return undefined;
  }
}

function writeStatus(dbPath: string, status: DaemonStatus): void {
  try {
    mkdirSync(stateDir(dbPath), { recursive: true });
    writeFileSync(statusFilePath(dbPath), JSON.stringify(status), 'utf8');
  } catch (error) {
    console.warn('[daemon] failed to write status file', error);
  }
}

function daemonPidPath(dbPath: string, installId: string): string {
  return join(stateDir(dbPath), `daemon-${installId}.pid`);
}

function writeDaemonPid(dbPath: string, installId: string): void {
  try {
    mkdirSync(stateDir(dbPath), { recursive: true });
    writeFileSync(daemonPidPath(dbPath, installId), String(process.pid), 'utf8');
  } catch (error) {
    console.warn('[daemon] failed to write pid file', error);
  }
}

function clearDaemonPid(dbPath: string, installId: string): void {
  try {
    unlinkSync(daemonPidPath(dbPath, installId));
  } catch {
    /* ignore */
  }
}

function runtimePidPath(dbPath: string, installId: string): string {
  return runtimePidFilePath(dbPath, installId);
}

function readRuntimePid(dbPath: string, installId: string): number | null {
  try {
    const pid = Number(readFileSync(runtimePidPath(dbPath, installId), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeRuntimePid(dbPath: string, installId: string, pid: number): void {
  try {
    mkdirSync(stateDir(dbPath), { recursive: true });
    writeFileSync(runtimePidPath(dbPath, installId), String(pid), 'utf8');
  } catch (error) {
    console.warn('[daemon] failed to write runtime pid', error);
  }
}

function clearRuntimePid(dbPath: string, installId: string): void {
  try {
    unlinkSync(runtimePidPath(dbPath, installId));
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
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch (error) {
    console.warn('[daemon] failed to stop Runtime', error);
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

function killManagedRuntimeProcessTree(pid: number, installId: string): boolean {
  if (!isProcessAlive(pid)) return true;
  if (!matchesManagedProcessCommandLine(readProcessCommandLine(pid), 'runtime', installId)) {
    console.warn('[daemon] refused to kill stale/reused Runtime pid', { pid, installId });
    return false;
  }
  killProcessTree(pid);
  return true;
}

async function waitForRuntimePipe(
  installId: string,
  timeoutMs = RUNTIME_START_TIMEOUT_MS,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeDesktopPipe(installId, undefined, 500)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return probeDesktopPipe(installId, undefined, 500);
}

async function waitForRuntimePipeDown(installId: string, timeoutMs = 8_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await probeDesktopPipe(installId, undefined, 300))) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export async function runDaemon(options: DaemonOptions = {}): Promise<void> {
  const installId =
    options.installId ?? process.env.SYNC_THINK_INSTALL_ID ?? DEFAULT_DEV_INSTALL_ID;
  const dbPath = options.dbPath ?? resolveRuntimeDatabasePath();
  configureFileLogging(dbPath);
  const now = options.now ?? (() => new Date());
  const helloSecret = options.helloSecret ?? process.env.SYNC_THINK_PIPE_SECRET;
  const allowNoToken =
    options.allowNoToken ?? (process.env.SYNC_THINK_DEV_NO_TOKEN === '1' || !helloSecret);

  // The daemon owns the detached long-lived Runtime. Desktop is only a client;
  // this supervisor keeps conversation runs alive when the window closes and
  // restarts the Runtime after an unexpected process failure.
  let runtimeChild: ChildProcess | null = null;
  let runtimeStarting: Promise<boolean> | null = null;
  let runtimeStopRequested = false;
  let runtimeRestartTimer: ReturnType<typeof setTimeout> | null = null;
  const ensureRuntime = async (): Promise<boolean> => {
    if (runtimeStopRequested) return false;
    if (await probeDesktopPipe(installId, undefined, 500)) return true;
    if (runtimeStarting) return runtimeStarting;
    runtimeStarting = (async () => {
      if (await probeDesktopPipe(installId, undefined, 500)) return true;
      const existingPid = readRuntimePid(dbPath, installId);
      if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
        const ready = await waitForRuntimePipe(installId);
        if (ready) return true;
      }
      if (existingPid) {
        killManagedRuntimeProcessTree(existingPid, installId);
        clearRuntimePid(dbPath, installId);
        await waitForRuntimePipeDown(installId);
      }
      const entry = resolveRuntimeEntry();
      if (!entry) {
        console.warn(
          '[daemon] Runtime entry not found; scheduled and background runs remain unavailable',
        );
        return false;
      }
      const nodeBin = resolveNodeBin();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SYNC_THINK_INSTALL_ID: installId,
        SYNC_THINK_DB_PATH: dbPath,
        SYNC_THINK_DEV_NO_TOKEN: allowNoToken ? '1' : '0',
      };
      if (helloSecret) env.SYNC_THINK_PIPE_SECRET = helloSecret;
      else delete env.SYNC_THINK_PIPE_SECRET;
      delete env.SYNC_THINK_DAEMON_WORKER;
      console.log('[daemon] starting supervised Runtime', { entry, nodeBin });
      const child = spawn(
        nodeBin,
        [entry, managedProcessMarker('runtime', installId)],
        buildSupervisedRuntimeSpawnOptions(env),
      );
      runtimeChild = child;
      writeRuntimePid(dbPath, installId, child.pid ?? 0);
      child.unref();
      child.once('exit', (code, signal) => {
        if (runtimeChild === child) runtimeChild = null;
        clearRuntimePid(dbPath, installId);
        if (!runtimeStopRequested) {
          console.warn('[daemon] supervised Runtime exited', { code, signal });
          if (!runtimeRestartTimer) {
            runtimeRestartTimer = setTimeout(() => {
              runtimeRestartTimer = null;
              void ensureRuntime();
            }, 1_000);
          }
        }
      });
      child.once('error', (error) =>
        console.warn('[daemon] supervised Runtime spawn failed', error),
      );
      return waitForRuntimePipe(installId);
    })().finally(() => {
      runtimeStarting = null;
    });
    return runtimeStarting;
  };
  const stopRuntime = async (): Promise<void> => {
    runtimeStopRequested = true;
    if (runtimeRestartTimer) {
      clearTimeout(runtimeRestartTimer);
      runtimeRestartTimer = null;
    }
    const child = runtimeChild;
    runtimeChild = null;
    let gracefulRequested = false;
    if (child && child.exitCode === null) {
      const result = await stopSupervisedRuntimeChild(child, {
        timeoutMs: 12_000,
        forceWaitMs: 2_000,
        forceKillTree: killProcessTree,
      });
      gracefulRequested = result.gracefulRequested;
      if (result.forced) {
        console.warn('[daemon] Runtime graceful shutdown timed out; terminated process tree');
      }
    }
    if (!gracefulRequested && (await probeDesktopPipe(installId, undefined, 500))) {
      gracefulRequested = await requestRuntimeShutdown({
        installId,
        helloSecret,
        appVersion: 'sync-think-daemon',
        timeoutMs: 5_000,
      });
      if (gracefulRequested) await waitForRuntimePipeDown(installId, 12_000);
    }
    const pid = readRuntimePid(dbPath, installId);
    if (pid && pid !== process.pid && isProcessAlive(pid)) {
      // PID is a last-resort orphan fallback after authenticated shutdown or
      // private child IPC was unavailable/expired.
      const observationMs = gracefulRequested ? 2_000 : 500;
      const startedAt = Date.now();
      while (Date.now() - startedAt < observationMs && isProcessAlive(pid)) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (isProcessAlive(pid)) killManagedRuntimeProcessTree(pid, installId);
    }
    clearRuntimePid(dbPath, installId);
    await waitForRuntimePipeDown(installId);
  };

  // 轻量 DB：只建 daemon 需要的 store，不启动完整 Runtime。
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const taskStore = new SqliteScheduledTaskStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);
  // 并发队列（T9）：DB 持久化队列表（进程重启不丢，按入队顺序出队）。
  const queueStore = {
    enqueue: (taskId: string): boolean => {
      try {
        connection.raw
          .prepare('INSERT OR IGNORE INTO daemon_task_queue (task_id, created_at) VALUES (?, ?)')
          .run(taskId, new Date().toISOString());
        return true;
      } catch {
        return false;
      }
    },
    dequeue: (): string | undefined => {
      try {
        const row = connection.raw
          .prepare('SELECT task_id FROM daemon_task_queue ORDER BY created_at ASC LIMIT 1')
          .get() as { task_id: string } | undefined;
        if (!row) return undefined;
        connection.raw.prepare('DELETE FROM daemon_task_queue WHERE task_id = ?').run(row.task_id);
        return row.task_id;
      } catch {
        return undefined;
      }
    },
    count: (): number => {
      try {
        const row = connection.raw
          .prepare('SELECT COUNT(*) AS count FROM daemon_task_queue')
          .get() as { count: number };
        return Number(row.count ?? 0);
      } catch {
        return 0;
      }
    },
    list: (): string[] => {
      try {
        const rows = connection.raw
          .prepare('SELECT task_id FROM daemon_task_queue ORDER BY created_at ASC')
          .all() as Array<{ task_id: string }>;
        return rows.map((row) => row.task_id);
      } catch {
        return [];
      }
    },
    remove: (taskId: string): void => {
      try {
        connection.raw.prepare('DELETE FROM daemon_task_queue WHERE task_id = ?').run(taskId);
      } catch {
        // Best effort cleanup; the next startup can retry the row.
      }
    },
  };

  // 定时器注册表：每个任务按自身规则/nextRunAt 注册，避免固定每秒唤醒。
  const registrar = options.registrar ?? createRuleAwareTimerRegistrar({ now });
  const registry = new TimerRegistry(registrar);

  // 状态。
  const readPersistedStatus = options.statusStore
    ? await options.statusStore.read()
    : readStatus(dbPath);
  let status = rollDaemonStatusDay(readPersistedStatus ?? createDaemonStatus(now()), now());
  const persistStatus = (next: DaemonStatus): void => {
    if (options.statusStore) {
      void options.statusStore
        .write(next)
        .catch((error) => console.warn('[daemon] failed to write injected status store', error));
      return;
    }
    writeStatus(dbPath, next);
  };
  // 投递任务跟踪（T8：崩溃检测 + abort 处理）。
  const dispatched = new DispatchedTracker();
  const recordInterruptionHistory = (
    taskId: string,
    firedAt: string,
    reason: 'app-closed' | 'runtime-crash',
  ): void => {
    const task = taskStore.get(taskId);
    if (!task) return;
    taskStore.addHistoryEntry({
      id: ulid(),
      taskId,
      status: 'failed',
      firedAt,
      reason,
    });
    taskStore.update(taskId, {
      lastResult: { status: 'failed', firedAt, reason },
    });
  };
  // 补跑计数（T10：latest_only，每任务最多补跑 1 次；内存态，重启后按
  // nextRunAt 与窗口重新判定，幂等）。
  const catchupCounts = new Map<string, number>();

  // 并发上限（app-setting 'task-scheduler' → {maxConcurrent}，默认 2，1–8）。
  const taskMaxConcurrent = (): number => {
    const raw = appSettingStore.get('task-scheduler')?.value;
    const value =
      raw && typeof raw === 'object'
        ? ((raw as Record<string, unknown>).maxConcurrent as number | undefined)
        : undefined;
    const clamped = Number.isFinite(value) ? Math.min(8, Math.max(1, Math.floor(value ?? 2))) : 2;
    return clamped;
  };

  // 并发执行管理器（T9）：信号量 + running 跟踪 + DB 排队。
  const concurrency = new TaskConcurrencyManager({
    maxConcurrent: taskMaxConcurrent(),
    enqueue: (taskId) => queueStore.enqueue(taskId),
    store: queueStore,
  });
  const dispatchedReleases = new Map<string, () => void>();

  // 到点处理器（默认：日志 + 今日触发计数；执行路径 = 投递 or 自拉）。
  const onFire: TaskFireHandler =
    options.onFire ??
    ((taskId, decision) => {
      console.log(`[daemon] task ${taskId} due → action=${decision.action.type}`);
      status = rollDaemonStatusDay(status, now());
      status = updateDaemonStatus(status, { todayFired: status.todayFired + 1 });
      if (decision.action.type !== 'fire') return;
      // 并发槽位（T9）：占满则入队等待（decideDue 已给出 enqueue）。
      if (!concurrency.acquire(taskId)) {
        queueStore.enqueue(taskId);
        status = updateDaemonStatus(status, { queued: queueStore.count() });
        console.log(`[daemon] ${taskId} no slot; queued`);
        return;
      }
      let released = false;
      const completeTask = (): void => {
        if (released) return;
        released = true;
        concurrency.release(taskId);
        // 空出槽位 → 自动接上队首任务（同时清理重启后失效的行）。
        drainQueue();
      };
      // 执行路径（T7）：探测桌面活着 → 投递；否则自拉 worker。
      void (async () => {
        let releaseInFinally = true;
        try {
          const task = taskStore.get(taskId);
          if (!task) {
            console.warn(`[daemon] queued task ${taskId} no longer exists`);
            return;
          }
          const desktopAlive = await probeDesktopPipe(installId);
          const path = chooseDispatchPath(desktopAlive);
          if (path.kind === 'dispatched') {
            // Register before waiting for the ack. A fast Runtime can finish and
            // send task.dispatch.complete in the same event-loop turn as ack;
            // registering only after dispatchTaskToDesktop resolves would lose
            // that completion frame and leave a stale crash-retry entry.
            dispatched.add(taskId, now());
            const result = await dispatchTaskToDesktop(
              {
                installId,
                helloSecret,
                appVersion: 'sync-think-daemon',
                timeoutMs: 30_000,
              },
              composeTaskCommand(task),
            );
            console.log(
              `[daemon] dispatched ${taskId} → ok=${result.ok} acked=${result.acked}` +
                (result.ok && !result.acked ? ' (no ack; taking over)' : ''),
            );
            if (result.outcome === 'accepted') {
              // Ack means accepted, not completed. Keep the daemon slot and
              // crash tracker until Runtime reports task.dispatch.complete.
              dispatchedReleases.set(taskId, completeTask);
              releaseInFinally = false;
              return;
            }
            dispatched.markCompleted(taskId);
            if (result.outcome === 'timeout') {
              // 桌面假死（30s 无 ack）→ desktop-hung → 接管自拉（T8）。
              console.warn(`[daemon] ${taskId} hung (no ack); taking over`);
            }
            if (result.outcome === 'rejected') {
              console.warn(
                `[daemon] desktop rejected ${taskId}; no worker takeover` +
                  (result.reason ? ` reason=${result.reason}` : ''),
              );
              return;
            }
            // 投递失败（桌面刚关/握手失败）→ 降级自拉。
            if (!result.ok)
              console.warn(`[daemon] dispatch ${taskId} failed; falling back to worker`);
          }
          const entry = resolveRuntimeEntry();
          if (!entry) {
            console.error('[daemon] runtime entry not found; cannot spawn worker');
            return;
          }
          const workerOptions = {
            runtimeEntry: entry,
            taskId,
            dbPath,
            installId,
            baseEnv: process.env,
          };
          const command = buildWorkerCommand(resolveNodeBin(), workerOptions);
          console.log(
            `[daemon] spawning worker for ${taskId}: ${command.command} ${command.args.join(' ')}`,
          );
          const result = await runWorkerProcess(resolveNodeBin(), workerOptions);
          console.log(
            `[worker] task ${taskId} exited code=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`,
          );
        } catch (error) {
          console.error(`[daemon] task ${taskId} execution failed`, error);
        } finally {
          // Every acquired slot is released exactly once, including lookup,
          // probe, spawn and worker failures.
          if (releaseInFinally) completeTask();
        }
      })();
    });

  // 到点回调：查询任务 → decideDue 决策 → 交给处理器。
  const fireTask = (taskId: string, force = false): void => {
    const task = taskStore.get(taskId);
    if (!task || !task.enabled) return;
    const currentNow = now();
    if (!force && task.nextRunAt && Date.parse(task.nextRunAt) > currentNow.getTime()) return;
    // 补跑判定（T10）：nextRunAt 已过期 → 限量补跑或顺延。
    const catchupPlan = planCatchupSweep({
      tasks: [task],
      now: currentNow,
      catchupCounts: catchupCounts,
    });
    const catchupAction = catchupPlan.actions[0];
    if (catchupAction?.action === 'defer') {
      // 错过 >24h / 已补跑过 → 直接顺延，本次不触发。
      if (catchupAction.nextRunAt) {
        taskStore.update(task.id, { nextRunAt: catchupAction.nextRunAt });
      }
      console.log(`[daemon] ${taskId} missed beyond catch-up window; deferring`);
      return;
    }
    if (catchupAction?.action === 'catchup') {
      // 限量补跑（latest_only）：记录计数 + 标记历史后照常触发。
      catchupCounts.set(task.id, (catchupCounts.get(task.id) ?? 0) + 1);
      console.log(`[daemon] ${taskId} catching up (missed, count=${catchupCounts.get(task.id)})`);
    }
    const decision = decideDue({
      task,
      state: {
        running: concurrency.isRunning(task.id),
        activeRuns: concurrency.activeCount(),
      },
      now: currentNow,
      maxConcurrent: taskMaxConcurrent(),
    });
    if (decision.action.type === 'fire') {
      taskStore.update(task.id, { nextRunAt: decision.nextRunAt ?? null });
    }
    if (decision.action.type === 'enqueue') {
      // 并发满 → 排队（DB 持久化，完成自动接上）。不重复入队。
      if (!concurrency.isRunning(task.id)) {
        const queued = queueStore.enqueue(task.id);
        console.log(`[daemon] ${taskId} concurrency full; queued=${queued}`);
        status = updateDaemonStatus(status, { queued: queueStore.count() });
      }
      return;
    }
    onFire(taskId, decision);
  };

  // 全量重扫 + 定时重扫（支持任务增删改同步）。
  const rescan = (): void => {
    const tasks = taskStore
      .list(false)
      .filter((t) => t.enabled && !(t.rule.kind === 'at' && !t.nextRunAt));
    const changed = registry.sync(tasks);
    status = updateDaemonStatus(status, { timerCount: registry.size });
    if (changed.length > 0) {
      for (const taskId of changed) registry.onFire(taskId, () => fireTask(taskId));
      console.log(`[daemon] timers synced: ${changed.length} changed (${registry.size} active)`);
    }
    // 崩溃检测（T8）：pending 投递任务 + 桌面管道已死 → runtime-crash 重试一次。
    void (async () => {
      const pending = dispatched.listPending();
      if (pending.length === 0) return;
      const desktopAlive = await probeDesktopPipe(installId);
      for (const taskId of pending) {
        const entry = dispatched.get(taskId);
        if (!entry) continue;
        const c = classifyInterruption({
          aborted: entry.aborted,
          desktopAlive,
          alreadyRetried: entry.retried,
        });
        if (c.status === 'runtime-crash' && c.retry) {
          console.warn(`[daemon] ${taskId} runtime-crash; retrying once`);
          dispatched.markRetried(taskId);
          dispatchedReleases.get(taskId)?.();
          dispatchedReleases.delete(taskId);
          fireTask(taskId, true); // 重试一次（自拉 worker），忽略已推进的周期时间
        } else if (c.status === 'runtime-crash') {
          console.warn(`[daemon] ${taskId} runtime-crash; already retried, terminal`);
          recordInterruptionHistory(taskId, entry.dispatchedAt, 'runtime-crash');
          dispatched.markCompleted(taskId);
          dispatchedReleases.get(taskId)?.();
          dispatchedReleases.delete(taskId);
        }
      }
    })();
  };
  // 调度器在单实例管道成功监听后才启动，避免 loser daemon 在 EADDRINUSE
  // 之前已经注册定时器或触发任务。
  const startupCatchup = (): void => {
    const overdue = taskStore.list(false).filter((t) => {
      if (!t.enabled || !t.nextRunAt) return false;
      return Date.parse(t.nextRunAt) <= now().getTime();
    });
    if (overdue.length === 0) return;
    console.log(`[daemon] startup catch-up: ${overdue.length} overdue task(s)`);
    for (const t of overdue) fireTask(t.id);
  };
  const drainQueue = (): void => {
    while (concurrency.activeCount() < taskMaxConcurrent()) {
      const taskId = queueStore.dequeue();
      if (!taskId) break;
      const task = taskStore.get(taskId);
      if (!task || !task.enabled) {
        console.warn(`[daemon] dropping stale queued task ${taskId}`);
        continue;
      }
      // A queued row represents an already-due trigger. The scheduler has
      // already advanced nextRunAt when it enqueued the task, so do not wait
      // for the next periodic occurrence before draining it.
      fireTask(taskId, true);
    }
    status = updateDaemonStatus(status, { queued: queueStore.count() });
  };

  // 心跳（1 次/秒）→ 状态文件。
  const heartbeat = (): void => {
    status = updateDaemonStatus(status, { heartbeatAt: now() });
    status = rollDaemonStatusDay(status, now());
    persistStatus(status);
  };

  // Installed before the pipe starts listening so an authenticated daemon.stop
  // can never hit an uninitialized closure.
  const lifecycle: {
    server?: ReturnType<typeof createPipeServer>;
    startupCatchupTimer?: ReturnType<typeof setTimeout>;
    rescanTimer?: ReturnType<typeof setInterval>;
    heartbeatTimer?: ReturnType<typeof setInterval>;
    runtimeHealthTimer?: ReturnType<typeof setInterval>;
  } = {};
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[daemon] shutting down');
    if (lifecycle.rescanTimer) clearInterval(lifecycle.rescanTimer);
    if (lifecycle.heartbeatTimer) clearInterval(lifecycle.heartbeatTimer);
    if (lifecycle.runtimeHealthTimer) clearInterval(lifecycle.runtimeHealthTimer);
    if (lifecycle.startupCatchupTimer) clearTimeout(lifecycle.startupCatchupTimer);
    lifecycle.server?.destroyConnections?.();
    lifecycle.server?.close();
    await stopRuntime();
    if (connection.raw.open) connection.raw.close();
    persistStatus({ ...status, running: false });
    clearDaemonPid(dbPath, installId);
    process.exit(0);
  };

  // 管道服务端（HMAC 握手；供 CLI 查询 / 未来投递协议）。
  const handlers: PipeServerHandlers = {
    expectedInstallId: installId,
    expectedSecret: helloSecret,
    allowNoToken,
    onReady: (address) => console.log(`[daemon] pipe ready ${address}`),
    onClientHello: (_socket, hello, result) => {
      if (!result.ok) {
        console.warn('[daemon] hello rejected:', hello.installId);
        return;
      }
      console.log('[daemon] client hello ok:', hello.installId);
    },
    onClientGone: () => {},
    onFrame: (socket, frame) => {
      // abort 帧：桌面退出前告知（用户主动关闭 → app-closed，不重试）。
      const parsed = parseTaskFrame(frame);
      if (parsed.ok && parsed.frame.type === 'task.abort') {
        const { taskId, reason } = parsed.frame.payload;
        const entry = dispatched.get(taskId);
        const classification = applyAbort(dispatched, taskId);
        if (classification?.status === 'app-closed' && entry) {
          recordInterruptionHistory(taskId, entry.dispatchedAt, 'app-closed');
        }
        dispatchedReleases.get(taskId)?.();
        dispatchedReleases.delete(taskId);
        console.log(
          `[daemon] abort ${taskId} reason=${reason} → ${classification?.status ?? 'unknown'}`,
        );
        return;
      }
      if (parsed.ok && parsed.frame.type === 'task.dispatch.complete') {
        const { taskId, status, reason } = parsed.frame.payload;
        dispatched.markCompleted(taskId);
        dispatchedReleases.get(taskId)?.();
        dispatchedReleases.delete(taskId);
        console.log(
          `[daemon] dispatch complete ${taskId} status=${status}${reason ? ` reason=${reason}` : ''}`,
        );
        return;
      }
      // 管理帧（T11）：设置页状态查询 / 停止 / 配置。
      if (frame.type === 'daemon.status') {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'daemon.status',
            payload: buildDaemonStatusPayload(status, {
              running: true,
              autostartRegistered: autostartRegistered(),
              maxConcurrent: taskMaxConcurrent(),
            }),
          }),
        );
        return;
      }
      if (frame.type === 'daemon.stop') {
        console.log('[daemon] stop requested via pipe');
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'daemon.stop',
            payload: { ok: true },
          }),
        );
        void shutdown();
        return;
      }
      if (frame.type === 'daemon.setConfig') {
        const raw = frame.payload as { maxConcurrent?: unknown } | undefined;
        const value = Number(raw?.maxConcurrent ?? 2);
        const clamped = Number.isFinite(value) ? Math.min(8, Math.max(1, Math.floor(value))) : 2;
        try {
          appSettingStore.set('task-scheduler', { maxConcurrent: clamped });
          concurrency.setMaxConcurrent(clamped);
        } catch (error) {
          console.warn('[daemon] setConfig failed', error);
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'daemon.setConfig',
              payload: { ok: false },
            }),
          );
          return;
        }
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'daemon.setConfig',
            payload: { ok: true, maxConcurrent: clamped },
          }),
        );
        return;
      }
    },
  };
  lifecycle.server = createPipeServer(handlers, installId);
  // 单实例约束：管道已被占用（另一个 daemon 已在监听）→ 立即退出。
  // 后启动的 daemon 不参与调度（唯一调度者），避免多实例重复触发任务。
  lifecycle.server.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `[daemon] pipe ${daemonPipePath(installId)} in use; another daemon is running. Exiting.`,
      );
      process.exit(0);
    }
    console.error('[daemon] pipe server error', err);
  });
  await new Promise<void>((resolve, reject) => {
    lifecycle.server?.once('error', reject);
    lifecycle.server?.listen(daemonPipePath(installId), () => {
      lifecycle.server?.removeListener('error', reject);
      handlers.onReady(daemonPipePath(installId));
      resolve();
    });
  });

  const runtimeReady = await ensureRuntime();
  if (!runtimeReady) {
    console.warn('[daemon] Runtime is not ready; will keep retrying in the background');
  }

  // 只有成功成为管道 owner 后才开启调度、补跑和心跳。
  writeDaemonPid(dbPath, installId);
  rescan();
  lifecycle.startupCatchupTimer = setTimeout(startupCatchup, 1_000);
  lifecycle.rescanTimer = setInterval(rescan, 15_000);
  heartbeat();
  lifecycle.heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  lifecycle.runtimeHealthTimer = setInterval(() => {
    void ensureRuntime().catch((error) =>
      console.warn('[daemon] Runtime supervision failed', error),
    );
  }, RUNTIME_HEALTH_INTERVAL_MS);
  drainQueue();

  console.log(`[daemon] started. installId=${installId} pid=${process.pid} db=${dbPath}`);

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
