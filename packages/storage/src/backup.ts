import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ErrorCode, type AppError } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';

// §20 rule 10: Database migration creates a backup first; failure rolls back.
// Failure to create the backup is non-recoverable: opens read-only diagnostic mode.
//
// Audit #2: with journal_mode = WAL, the main db file may lag behind committed
// writes still sitting in the -wal file — copyFileSync would produce a stale,
// inconsistent snapshot. We use better-sqlite3's `backup()` (SQLite Online
// Backup API), which yields a consistent snapshot including WAL contents.

export interface BackupResult {
  backupPath: string;
  size: number;
}

export async function backupDatabase(dbPath: string, now: Date = new Date()): Promise<BackupResult> {
  if (!existsSync(dbPath)) {
    throw backupError(ErrorCode.DB_BACKUP_FAILED, `source db not found: ${dbPath}`);
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = dirname(dbPath);
  const name = `${stamp}.backup.db`;
  const backupPath = join(dir, 'backups', name);
  mkdirSync(dirname(backupPath), { recursive: true });

  const { raw } = await openDatabaseAsync({ path: dbPath });
  try {
    await raw.backup(backupPath);
  } finally {
    raw.close();
  }
  return { backupPath, size: 0 };
}

function backupError(code: ErrorCode, message: string): AppError & Error {
  const e = Object.assign(new Error(message), { code }) as Error & { code: ErrorCode };
  return e as unknown as AppError & Error;
}
