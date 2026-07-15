import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Raw row from CC Switch `providers` table. */
export interface CcSwitchDbProviderRow {
  id: string;
  app_type: string;
  name: string;
  settings_config: string;
  meta: string | null;
  is_current: number | null;
}

export interface LoadCcSwitchDbResult {
  dbPath: string;
  rows: CcSwitchDbProviderRow[];
}

/**
 * Read CC Switch local SQLite providers table (read-only).
 */
export function loadCcSwitchProviderRows(dbPath: string): LoadCcSwitchDbResult {
  const path = dbPath.trim();
  if (!path) throw new Error('CC Switch database path must not be empty');
  if (!existsSync(path)) {
    throw new Error(`CC Switch database not found: ${path}`);
  }

  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, app_type, name, settings_config, meta, is_current
         FROM providers
         ORDER BY is_current DESC, name ASC`,
      )
      .all() as Array<{
      id: string;
      app_type: string;
      name: string;
      settings_config: string;
      meta: string | null;
      is_current: number | null;
    }>;

    return {
      dbPath: path,
      rows: rows.map((r) => ({
        id: String(r.id),
        app_type: String(r.app_type ?? ''),
        name: String(r.name ?? ''),
        settings_config: r.settings_config ?? '{}',
        meta: r.meta,
        is_current: r.is_current,
      })),
    };
  } finally {
    db.close();
  }
}

export function defaultCcSwitchDbPath(
  homeDir: string = process.env.USERPROFILE ?? process.env.HOME ?? '',
): string {
  const home = homeDir.trim();
  if (!home) return '';
  return join(home, '.cc-switch', 'cc-switch.db');
}
