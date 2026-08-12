import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

// Single point of DB construction for the Runtime (AI rules §6: business never
// calls `new Database` directly). Native `better-sqlite3` is required at runtime
// — it must be rebuilt against the Electron ABI at packaging time (TD-004 risk).
// Subject to the VS Build Tools blocker described in current-status.md.

export type Database = BetterSQLite3Database<typeof schema>;
export type BetterSQLite3Raw = BetterSqlite3.Database;

export interface OpenDbOptions {
  path: string;
  readonly?: boolean;
  /** When true, fail if the file does not exist (helps diagnose missing data). */
  fileMustExist?: boolean;
}

async function openInternal(opts: OpenDbOptions): Promise<{ db: Database; raw: BetterSQLite3Raw }> {
  const mod = (await import('better-sqlite3')).default;
  const raw = new mod(opts.path, {
    readonly: opts.readonly ?? false,
    fileMustExist: opts.fileMustExist ?? false,
  });
  if (opts.readonly) {
    raw.pragma('query_only = ON');
  } else {
    raw.pragma('journal_mode = WAL');
    // Concurrent writers (e.g. two Runtime instances migrating/opening the same
    // database) wait up to 5s for a busy lock instead of failing immediately
    // with SQLITE_BUSY (audit #6).
    raw.pragma('busy_timeout = 5000');
  }
  raw.pragma('foreign_keys = ON');
  return { db: drizzle(raw, { schema }), raw };
}

// Public async opener for tests + Runtime bootstrap.
export async function openDatabaseAsync(
  opts: OpenDbOptions,
): Promise<{ db: Database; raw: BetterSQLite3Raw }> {
  return openInternal(opts);
}

// Synchronous variant for hot-path use; better-sqlite3 itself is sync, but
// we expose async entry for ESM dynamic import. After first warm-up, callers
// can hold the raw handle for sync access via the returned `raw`.
export async function openDatabase(
  opts: OpenDbOptions,
): Promise<{ db: Database; raw: BetterSQLite3Raw }> {
  return openInternal(opts);
}
