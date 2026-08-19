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
import { chooseDispatchPath, composeTaskCommand } from './dispatch.js';
import { buildWorkerCommand, runWorkerProcess } from './worker.js';
import { dispatchTaskToDesktop } from './dispatch-client.js';
import { probeDaemonPipe } from './yield.js';
import { classifyInterruption, DispatchedTracker, applyAbort } from './interrupt.js';
import { parseTaskFrame } from './protocol.js';
import { planCatchupSweep } from './catchup.js';

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
  // 投递任务跟踪（T8：崩溃检测 + abort 处理）。
  const dispatched = new DispatchedTracker();
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

  // 到点处理器（默认：日志 + 今日触发计数；执行路径 = 投递 or 自拉）。
  const onFire: TaskFireHandler = options.onFire ?? ((taskId, decision) => {
    console.log(`[daemon] task ${taskId} due → action=${decision.action.type}`);
    status = updateDaemonStatus(status, { todayFired: status.todayFired + 1 });
    if (decision.action.type !== 'fire') return;
    // 执行路径（T7）：探测桌面活着 → 投递；否则自拉 worker。
    void (async () => {
      const task = taskStore.get(taskId);
      if (!task) return;
      const desktopAlive = await probeDaemonPipe(installId);
      const path = chooseDispatchPath(desktopAlive);
      if (path.kind === 'dispatched') {
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
        if (result.ok && result.acked) {
          dispatched.add(taskId, now());
          return;
        }
        if (result.ok && !result.acked) {
          // 桌面假死（30s 无 ack）→ desktop-hung → 接管自拉（T8）。
          console.warn(`[daemon] ${taskId} hung (no ack); taking over`);
          status = updateDaemonStatus(status, {});
        }
        // 投递失败（桌面刚关/握手失败）→ 降级自拉。
        if (!result.ok) console.warn(`[daemon] dispatch ${taskId} failed; falling back to worker`);
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
      console.log(`[daemon] spawning worker for ${taskId}: ${command.command} ${command.args.join(' ')}`);
      const result = await runWorkerProcess(resolveNodeBin(), workerOptions);
      console.log(
        `[worker] task ${taskId} exited code=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`,
      );
    })();
  });

  // 到点回调：查询任务 → decideDue 决策 → 交给处理器。
  const fireTask = (taskId: string): void => {
    const task = taskStore.get(taskId);
    if (!task || !task.enabled) return;
    // 补跑判定（T10）：nextRunAt 已过期 → 限量补跑或顺延。
    const catchupPlan = planCatchupSweep({
      tasks: [task],
      now: now(),
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
    // 崩溃检测（T8）：pending 投递任务 + 桌面管道已死 → runtime-crash 重试一次。
    void (async () => {
      const pending = dispatched.listPending();
      if (pending.length === 0) return;
      const desktopAlive = await probeDaemonPipe(installId);
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
          fireTask(taskId); // 重试一次（自拉 worker）
        } else if (c.status === 'runtime-crash') {
          console.warn(`[daemon] ${taskId} runtime-crash; already retried, terminal`);
          dispatched.markCompleted(taskId);
        }
      }
    })();
  };
  rescan();
  // 启动补跑（T10）：守护进程错过期间的任务立即补跑（≤24h + latest_only）。
  // fireTask 内含补跑判定，这里只对「nextRunAt 已过期」的任务触发。
  const startupCatchup = (): void => {
    const overdue = taskStore.list(false).filter((t) => {
      if (!t.enabled || !t.nextRunAt) return false;
      return Date.parse(t.nextRunAt) <= now().getTime();
    });
    if (overdue.length === 0) return;
    console.log(`[daemon] startup catch-up: ${overdue.length} overdue task(s)`);
    for (const t of overdue) fireTask(t.id);
  };
  setTimeout(startupCatchup, 1_000);
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
    onFrame: (_socket, frame) => {
      // abort 帧：桌面退出前告知（用户主动关闭 → app-closed，不重试）。
      const parsed = parseTaskFrame(frame);
      if (!parsed.ok || parsed.frame.type !== 'task.abort') return;
      const { taskId, reason } = parsed.frame.payload;
      const classification = applyAbort(dispatched, taskId);
      console.log(`[daemon] abort ${taskId} reason=${reason} → ${classification?.status ?? 'unknown'}`);
    },
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
