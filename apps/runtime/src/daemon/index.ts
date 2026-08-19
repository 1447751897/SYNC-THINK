/**
 * 守护进程 CLI 入口（计划任务 / 桌面兜底拉起的目标）。
 *
 * 用法：node dist/daemon/index.js
 * 环境变量：SYNC_THINK_INSTALL_ID / SYNC_THINK_DB_PATH / SYNC_THINK_PIPE_SECRET 等
 * （与 runtime main.js 同一套环境约定）。
 */

import { runDaemon } from './main.js';

runDaemon().catch((error) => {
  console.error('[daemon] fatal', error);
  process.exit(1);
});
