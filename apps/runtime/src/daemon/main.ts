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

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Cron } from 'croner';
import { openDatabaseAsync, runMigrations } from '@sync-think/storage';
import { SqliteScheduledTaskStore } from '@sync-think/storage';
import { SqliteAppSettingStore } from '@sync-think/storage';
import { DEFAULT_DEV_INSTALL_ID } from '@sync-think/protocol';
import { daemonPipePath } from './yield.js';
import { createPipeServer, type PipeServerHandlers } from '../pipe/server.js';
import { resolveRuntimeDatabasePath } from '../persistence.js';
import {
  TimerRegistry,
  createDaemonStatus,
  updateDaemonStatus,
  type DaemonStatus,
} from './core.js';
import { decideDue, type SchedulerDecision } from '../scheduler-core.js';
import { chooseDispatchPath } from './dispatch.js';
import { buildWorkerCommand, runWorkerProcess } from './worker.js';

const HEARTBEAT_INTERVAL_MS = 1_000;
const STATUS_FILE = 'daemon-status.json';

/** runtime 入口探测（与 desktop runtime-supervisor 一致的多路径候选）。 */
export function resolveRuntimeEntry(): string | null {
  const candidates = [
    process.env.SYNC_THINK_RUNTIME_ENTRY,
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
  registrar?: TimerRegistry['registrar'] & { registerTimer(taskId: string, fire: () => void): unknown };
  statusStore?: import('./core.js').StatusFileStore;
  now?: () => Date;
}

function stateDir(): string {
  const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), '.sync-think');
  return join(dataRoot, 'SYNC-THINK');
}

function statusFilePath(): string {
  return join(stateDir(), STATUS_FILE);
}

function readStatus(): DaemonStatus | undefined {
  try {
    const raw = readFileSync(statusFilePath(), 'utf8');
    return JSON.parse(raw) as DaemonStatus;
  } catch {
    return undefined;
  }
}

function writeStatus(status: DaemonStatus): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(statusFilePath(), JSON.stringify(status), 'utf8');
  } catch (error) {
    console.warn('[daemon] failed to write status file', error);
  }
}

export async function runDaemon(options: DaemonOptions = {}): Promise<void> {
  const installId = options.installId ?? process.env.SYNC_THINK_INSTALL_ID ?? DEFAULT_DEV_INSTALL_ID;
  const dbPath = options.dbPath ?? resolveRuntimeDatabasePath();
  const now = options.now ?? (() => new Date());
  const helloSecret = options.helloSecret ?? process.env.SYNC_THINK_PIPE_SECRET;
  const allowNoToken = options.allowNoToken ?? (process.env.SYNC_THINK_DEV_NO_TOKEN === '1' || !helloSecret);

  // 轻量 DB：只建 daemon 需要的 store，不启动完整 Runtime。
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const taskStore = new SqliteScheduledTaskStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);

  // 定时器注册表（croner 注册器）。
  const registrar = options.registrar ?? {
    registerTimer(_taskId: string, fire: () => void) {
      const cron = new Cron('* * * * * *', () => fire());
      return { cancel: () => cron.stop() };
    },
    unregisterTimer(_taskId: string) {
      // croner 定时器由返回的 handle.cancel() 控制，注销由 TimerRegistry 处理。
    },
  };
  const registry = new TimerRegistry(registrar);

  // 状态。
  let status = readStatus() ?? createDaemonStatus();

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

  // 到点处理器（默认：日志 + 今日触发计数；桌面活着投递在 T7 接入）。
  const onFire: TaskFireHandler = options.onFire ?? ((taskId, decision) => {
    console.log(`[daemon] task ${taskId} due → action=${decision.action.type}`);
    status = updateDaemonStatus(status, { todayFired: status.todayFired + 1 });
    if (decision.action.type !== 'fire') return;
    // 自拉路径（T6）：桌面探测 → 关着 → spawn worker 执行。
    void (async () => {
      const entry = resolveRuntimeEntry();
      if (!entry) {
        console.error('[daemon] runtime entry not found; cannot spawn worker');
        return;
      }
      const path = chooseDispatchPath(false); // T7 接入真实桌面探测
      if (path.kind !== 'spawn-worker') return;
      const command = buildWorkerCommand(resolveNodeBin(), {
        runtimeEntry: entry,
        taskId,
        dbPath,
        installId,
        baseEnv: process.env,
      });
      console.log(`[daemon] spawning worker for ${taskId}: ${command.command} ${command.args.join(' ')}`);
      const result = await runWorkerProcess(resolveNodeBin(), {
        runtimeEntry: entry,
        taskId,
        dbPath,
        installId,
        baseEnv: process.env,
      });
      console.log(
        `[worker] task ${taskId} exited code=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`,
      );
    })();
  });

  // 到点回调：查询任务 → decideDue 决策 → 交给处理器。
  const fireTask = (taskId: string): void => {
    const task = taskStore.get(taskId);
    if (!task || !task.enabled) return;
    const decision = decideDue({
      task,
      state: { running: false, activeRuns: 0 }, // T6/T9 接入真实并发状态
      now: now(),
      maxConcurrent: taskMaxConcurrent(),
    });
    onFire(taskId, decision);
  };

  // 全量重扫 + 定时重扫（支持任务增删改同步）。
  const rescan = (): void => {
    const tasks = taskStore.list(false).filter((t) => t.enabled);
    const changed = registry.sync(tasks);
    status = updateDaemonStatus(status, { timerCount: registry.size });
    if (changed.length > 0) {
      for (const taskId of changed) registry.onFire(taskId, () => fireTask(taskId));
      console.log(`[daemon] timers synced: ${changed.length} changed (${registry.size} active)`);
    }
  };
  rescan();
  const rescanTimer = setInterval(rescan, 15_000);

  // 心跳（1 次/秒）→ 状态文件。
  const heartbeat = (): void => {
    status = updateDaemonStatus(status, { heartbeatAt: now() });
    writeStatus(status);
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

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
    onFrame: () => {}, // T4/T7 接入投递帧
  };
  const server = createPipeServer(handlers, installId);
  server.on('error', (err) => console.error('[daemon] pipe server error', err));
  await new Promise<void>((resolve) => {
    server.listen(daemonPipePath(installId), () => {
      handlers.onReady(daemonPipePath(installId));
      resolve();
    });
  });

  console.log(`[daemon] started. installId=${installId} pid=${process.pid} db=${dbPath}`);

  // 优雅关闭。
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[daemon] shutting down');
    clearInterval(rescanTimer);
    clearInterval(heartbeatTimer);
    server.destroyConnections?.();
    server.close();
    if (connection.raw.open) connection.raw.close();
    writeStatus({ ...status, running: false });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
