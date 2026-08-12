import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { backupDatabase } from './backup.js';

describe('backupDatabase', () => {
  it('produces a consistent snapshot including uncheckpointed WAL writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-bk-'));
    try {
      const dbPath = join(dir, 'app.db');
      const source = new BetterSqlite3(dbPath);
      source.pragma('journal_mode = WAL');
      source.exec('CREATE TABLE t (v TEXT)');
      // WAL mode: this committed row lives in the -wal file, not the main db.
      source.prepare('INSERT INTO t VALUES (?)').run('wal-row');
      source.close();

      const r = await backupDatabase(dbPath, new Date('2026-07-11T10:00:00Z'));
      expect(existsSync(r.backupPath)).toBe(true);

      // The backup must open as a valid database AND contain the WAL row
      // (a naive copyFileSync of the main db file would miss it).
      const check = new BetterSqlite3(r.backupPath, { readonly: true });
      const rows = check.prepare('SELECT v FROM t').all() as Array<{ v: string }>;
      check.close();
      expect(rows).toEqual([{ v: 'wal-row' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when source db missing', async () => {
    await expect(backupDatabase(join(tmpdir(), 'nope.db'))).rejects.toThrow();
  });
});
