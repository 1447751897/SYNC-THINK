// E2E 环境搭建：用 better-sqlite3 backup 把用户 db 复制为隔离副本（WAL 一致），
// 供独立 e2e runtime 实例使用（provider/凭据配置复用，vault 同用户可解密）。
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const storageRequire = createRequire(join(repo, 'packages', 'storage', 'package.json'));
const Database = storageRequire('better-sqlite3');

const source = process.env.SYNC_THINK_SOURCE_DB ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.sync-think'), 'SYNC-THINK', 'sync-think.db');
const targetDir = process.env.SYNC_THINK_E2E_DIR ?? join(process.env.TEMP ?? '/tmp', 'sync-think-e2e');
const target = join(targetDir, 'sync-think.db');

if (!existsSync(source)) {
  console.error('source db not found:', source);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
for (const suffix of ['-wal', '-shm']) {
  const sidecar = source + suffix;
  if (existsSync(sidecar)) {
    // WAL 侧车不复制——backup API 已包含已提交内容。
  }
}

const src = new Database(source, { readonly: true });
const backup = src.backup(target);
await backup;
src.close();
console.log(`e2e db ready: ${target} (${existsSync(target) ? statSync(target).size : 0} bytes)`);
