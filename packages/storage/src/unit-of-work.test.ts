import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteUnitOfWork } from './unit-of-work.js';
import { SqliteWorkspaceStore } from './workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function openFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-uow-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    dir,
    raw: connection.raw,
    unitOfWork: new SqliteUnitOfWork(connection.raw),
    workspaceStore: new SqliteWorkspaceStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteUnitOfWork', () => {
  it('runs the callback inside an outer transaction and returns its value', async () => {
    const fixture = await openFixture();
    try {
      expect(fixture.raw.inTransaction).toBe(false);
      const result = fixture.unitOfWork.run(() => {
        expect(fixture.raw.inTransaction).toBe(true);
        return 'committed';
      });
      expect(result).toBe('committed');
      expect(fixture.raw.inTransaction).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it('rolls back a nested store transaction when a later operation throws', async () => {
    const fixture = await openFixture();
    try {
      expect(() =>
        fixture.unitOfWork.run(() => {
          fixture.workspaceStore.createWorkspace({
            folderPath: fixture.dir,
            name: 'Must roll back',
          });
          throw new Error('forced outer failure');
        }),
      ).toThrow('forced outer failure');
      expect(fixture.workspaceStore.listWorkspaces()).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
