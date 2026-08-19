/**
 * worker 执行器（spec T6）：守护进程自拉 worker 执行定时任务。
 *
 * worker = 复用完整 runtime 入口（main.js）+ 环境变量开关：
 *   SYNC_THINK_DAEMON_WORKER=1       → runtime 以 worker 模式启动
 *                                      （禁自身调度 tick、不监听管道，其余全保留）
 *   SYNC_THINK_DAEMON_TASK_ID=t_xxx  → 启动后执行该任务，跑完即退
 *
 * 本模块提供：worker 模式 env 解析（纯函数）、worker 进程命令构造（纯函数）、
 * 进程 spawn + 退出码等待（Seam 3 fixture 可注入）。
 */

import { spawn } from 'node:child_process';

// ── worker 模式 env 解析 ───────────────────────────────────────────────────

export interface DaemonWorkerEnv {
  enabled: boolean;
  taskId?: string;
}

/** 从进程环境解析 worker 模式开关与任务 id（纯函数，可测）。 */
export function parseDaemonWorkerEnv(env: NodeJS.ProcessEnv): DaemonWorkerEnv {
  const enabled = env.SYNC_THINK_DAEMON_WORKER === '1';
  const taskId = env.SYNC_THINK_DAEMON_TASK_ID;
  return { enabled, ...(enabled && taskId ? { taskId } : {}) };
}

// ── worker 命令构造 ────────────────────────────────────────────────────────

export interface WorkerEnvOptions {
  /** runtime 入口（apps/runtime/dist/main.js 或 src/main.ts）。 */
  runtimeEntry: string;
  taskId: string;
  dbPath: string;
  installId: string;
  /** 基础环境（默认 process.env）。 */
  baseEnv?: NodeJS.ProcessEnv;
}

export interface WorkerCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 构造 worker 进程的命令与环境（纯函数，可测）。 */
export function buildWorkerCommand(
  nodeBin: string,
  options: WorkerEnvOptions,
): WorkerCommand {
  return {
    command: nodeBin,
    args: [options.runtimeEntry],
    env: {
      ...(options.baseEnv ?? process.env),
      SYNC_THINK_DAEMON_WORKER: '1',
      SYNC_THINK_DAEMON_TASK_ID: options.taskId,
      SYNC_THINK_DB_PATH: options.dbPath,
      SYNC_THINK_INSTALL_ID: options.installId,
    },
  };
}

// ── worker 进程执行 ────────────────────────────────────────────────────────

export interface WorkerProcessResult {
  code: number | null;
  signal: string | null;
}

/**
 * 启动 worker 进程并等待退出。
 * - 超时（timeoutMs，默认 60 分钟）未退出 → kill 并返回 code=null。
 * - 退出码非 0 由调用方（daemon）记录失败。
 */
export function runWorkerProcess(
  nodeBin: string,
  options: WorkerEnvOptions,
  timeoutMs = 60 * 60_000,
): Promise<WorkerProcessResult> {
  const command = buildWorkerCommand(nodeBin, options);
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      env: command.env,
      detached: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, signal: null });
    });
  });
}
