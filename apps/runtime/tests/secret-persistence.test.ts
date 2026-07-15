import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecureStore, XorDevBackend, makeCredentialRef } from '@sync-think/secure-store';
import { openDatabaseAsync, runMigrations } from '@sync-think/storage';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('credential persistence boundary', () => {
  it('keeps the plaintext API key out of SQLite, WAL, and migration backups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-secret-boundary-'));
    tempDirs.push(dir);
    const secret = 'sk-LIVE_PLAINTEXT_MUST_NEVER_REACH_SQLITE_123456';
    const secureStore = new SecureStore(
      new XorDevBackend(join(dir, 'vault', 'development-key.bin')),
    );
    const handle = await secureStore.storeSecret(secret);
    const credentialRef = makeCredentialRef({
      credentialGroupId: 'credential-group-1' as never,
      label: 'main test key',
      kind: 'api-key',
      storeHandle: handle,
    });

    const dbPath = join(dir, 'database', 'sync-think.db');
    mkdirSync(join(dir, 'database'), { recursive: true });
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      connection.raw
        .prepare(
          `INSERT INTO credential_ref (
            id, credential_group_id, label, kind, store_handle, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          credentialRef.id,
          credentialRef.credentialGroupId,
          credentialRef.label,
          credentialRef.kind,
          credentialRef.storeHandle,
          credentialRef.createdAt,
          credentialRef.updatedAt,
        );
    } finally {
      connection.raw.close();
    }

    const databaseDir = join(dir, 'database');
    const databaseFiles = readdirSync(databaseDir)
      .map((name) => join(databaseDir, name))
      .filter((path) => statSync(path).isFile());
    expect(databaseFiles.length).toBeGreaterThan(0);
    for (const path of databaseFiles) {
      expect(readFileSync(path).includes(Buffer.from(secret, 'utf8'))).toBe(false);
    }
  });
});
