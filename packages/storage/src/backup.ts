import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ErrorCode, type AppError } from '@sync-think/shared';

// §20 rule 10: Database migration creates a backup first; failure rolls back.
// Failure to create the backup is non-recoverable: opens read-only diagnostic mode.

export interface BackupResult {
  backupPath: string;
  size: number;
}

export function backupDatabase(dbPath: string, now: Date = new Date()): BackupResult {
  if (!existsSync(dbPath)) {
    throw backupError(ErrorCode.DB_BACKUP_FAILED, `source db not found: ${dbPath}`);
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = dirname(dbPath);
  const name = `${stamp}.backup.db`;
  const backupPath = join(dir, 'backups', name);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(dbPath, backupPath);
  return { backupPath, size: 0 };
}

function backupError(code: ErrorCode, message: string): AppError & Error {
  const e = Object.assign(new Error(message), { code }) as Error & { code: ErrorCode };
  return e as unknown as AppError & Error;
}
