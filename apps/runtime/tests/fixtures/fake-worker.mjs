// Seam 3 fixture：模拟守护进程拉起的 worker 进程。
// 读环境变量，把 taskId / worker 标志写入标记文件，按 FAKE_WORKER_EXIT 退出。
import { writeFileSync } from 'node:fs';

const marker = process.env.FAKE_WORKER_MARKER;
if (marker) {
  writeFileSync(
    marker,
    JSON.stringify({
      taskId: process.env.SYNC_THINK_DAEMON_TASK_ID ?? null,
      worker: process.env.SYNC_THINK_DAEMON_WORKER ?? null,
      dbPath: process.env.SYNC_THINK_DB_PATH ?? null,
    }),
    'utf8',
  );
}

const exitCode = Number(process.env.FAKE_WORKER_EXIT ?? '0');
setTimeout(() => process.exit(Number.isFinite(exitCode) ? exitCode : 0), 50);
