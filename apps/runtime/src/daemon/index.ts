/**
 * 守护进程 CLI 入口（计划任务 / 桌面兜底拉起的目标）。
 *
 * 用法：node dist/daemon/index.js
 * 环境变量：SYNC_THINK_INSTALL_ID / SYNC_THINK_DB_PATH / SYNC_THINK_PIPE_SECRET 等
 * （与 runtime main.js 同一套环境约定）。
 */

import { runDaemon } from './main.js';
import { applyDaemonBootstrap } from './bootstrap.js';
import { existsSync } from 'node:fs';

async function main(): Promise<void> {
  process.env.SYNC_THINK_DAEMON_FILE_LOG = '1';
  const bootstrapFlag = process.argv.indexOf('--bootstrap');
  const bootstrapPath =
    process.env.SYNC_THINK_DAEMON_BOOTSTRAP ??
    (bootstrapFlag >= 0 ? process.argv[bootstrapFlag + 1] : undefined);
  if (bootstrapPath && existsSync(bootstrapPath)) await applyDaemonBootstrap(bootstrapPath);
  await runDaemon();
}

main().catch((error) => {
  console.error('[daemon] fatal', error);
  process.exit(1);
});
