/**
 * 守护进程 / worker 的环境变量构造。
 *
 * worker = 复用完整 runtime 入口 + SYNC_THINK_DAEMON_WORKER=1
 * （禁用自身调度 tick，其余功能全保留——spec Q11）。
 * 凭据零障碍：API key 走 DPAPI vault（同 Windows 用户任何进程可解密），
 * 不额外传凭据（spec §24）。
 */

export interface BuildRuntimeEnvOptions {
  dbPath: string;
  installId: string;
  /** 基础环境（process.env 或注入）。 */
  base?: NodeJS.ProcessEnv;
}

/** 构造 worker runtime 的环境变量（注入 daemon-worker 标记 + 路径）。 */
export function buildRuntimeEnv(options: BuildRuntimeEnvOptions): NodeJS.ProcessEnv {
  const base = options.base ?? process.env;
  return {
    ...base,
    SYNC_THINK_INSTALL_ID: options.installId,
    SYNC_THINK_DB_PATH: options.dbPath,
    SYNC_THINK_DAEMON_WORKER: '1',
  };
}
