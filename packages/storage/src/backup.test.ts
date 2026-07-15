import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from './backup.js';

describe('backupDatabase', () => {
  let dir: string;
  it('copies db file to <dir>/backups/<timestamp>.backup.db', () => {
    dir = mkdtempSync(join(tmpdir(), 'st-bk-'));
    const dbPath = join(dir, 'app.db');
    writeFileSync(dbPath, 'hello-db-content');
    const r = backupDatabase(dbPath, new Date('2026-07-11T10:00:00Z'));
    expect(existsSync(r.backupPath)).toBe(true);
    expect(readFileSync(r.backupPath, 'utf8')).toBe('hello-db-content');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when source db missing', () => {
    expect(() => backupDatabase(join(tmpdir(), 'nope.db'))).toThrow();
  });
});
