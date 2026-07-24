// 0026: generic app-level KV settings store (JSON values).
// Known keys:
//   'vision-fallback' → { enabled: boolean, modelId: string | null }
//   'plan-act'        → { enabled: boolean, planModelId: string | null, actModelId: string | null }
import type { BetterSQLite3Raw } from './connection.js';

export interface AppSettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class SqliteAppSettingStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  get(key: string): AppSettingRecord | undefined {
    const k = String(key ?? '').trim();
    if (!k) return undefined;
    const row = this.raw
      .prepare(`SELECT key, value_json, updated_at FROM app_setting WHERE key = ?`)
      .get(k) as { key: string; value_json: string; updated_at: string } | undefined;
    if (!row) return undefined;
    let value: unknown = null;
    try {
      value = JSON.parse(row.value_json);
    } catch {
      value = null;
    }
    return { key: row.key, value, updatedAt: row.updated_at };
  }

  set(key: string, value: unknown, now?: string): AppSettingRecord {
    const k = String(key ?? '').trim();
    if (!k) throw new Error('Setting key must not be empty');
    const ts = now ?? new Date().toISOString();
    const json = JSON.stringify(value ?? null);
    this.raw
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(k, json, ts);
    return { key: k, value: value ?? null, updatedAt: ts };
  }

  list(): AppSettingRecord[] {
    const rows = this.raw
      .prepare(`SELECT key, value_json, updated_at FROM app_setting ORDER BY key ASC`)
      .all() as Array<{ key: string; value_json: string; updated_at: string }>;
    return rows.map((row) => {
      let value: unknown = null;
      try {
        value = JSON.parse(row.value_json);
      } catch {
        value = null;
      }
      return { key: row.key, value, updatedAt: row.updated_at };
    });
  }
}
