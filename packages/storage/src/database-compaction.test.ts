import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import {
  assertDatabaseCompactionManifestIntegrity,
  captureDatabaseCompactionFingerprint,
  executeIncrementalVacuum,
  executeOfflineDatabaseCompaction,
  prepareDatabaseCompactionManifest,
  verifyOfflineDatabaseCompactionResult,
  type DatabaseCompactionManifest,
  type DatabaseCompactionOperation,
} from './database-compaction.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Fixture {
  directory: string;
  databasePath: string;
  raw: BetterSQLite3Raw;
}

async function fixture(autoVacuum: 'NONE' | 'INCREMENTAL' = 'INCREMENTAL'): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-db-compaction-'));
  tempDirectories.push(directory);
  const databasePath = join(directory, 'sync-think.db');
  const { raw } = await openDatabaseAsync({ path: databasePath });
  raw.pragma(`auto_vacuum = ${autoVacuum === 'INCREMENTAL' ? 2 : 0}`);
  raw.exec('VACUUM');
  raw.exec(`
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE checkpoint (
      id TEXT PRIMARY KEY,
      last_event_sequence INTEGER NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE sample_data (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE waste_pages (
      id INTEGER PRIMARY KEY,
      payload BLOB NOT NULL
    );
  `);
  raw.pragma('user_version = 35');
  raw.prepare('INSERT INTO event (id, sequence, payload_json) VALUES (?, ?, ?)').run(
    'event-1',
    1,
    '{"ok":true}',
  );
  raw
    .prepare(
      'INSERT INTO checkpoint (id, last_event_sequence, state_json) VALUES (?, ?, ?)',
    )
    .run('checkpoint-1', 1, '{}');
  raw.prepare('INSERT INTO sample_data (value) VALUES (?)').run('alpha');
  const insertWaste = raw.prepare('INSERT INTO waste_pages (payload) VALUES (?)');
  raw.transaction(() => {
    for (let index = 0; index < 96; index += 1) {
      insertWaste.run(Buffer.alloc(8 * 1024, index % 255));
    }
  })();
  raw.exec('DELETE FROM waste_pages');
  raw.pragma('wal_checkpoint(TRUNCATE)');
  return { directory, databasePath, raw };
}

async function manifestFor(
  item: Fixture,
  operation: DatabaseCompactionOperation,
  planId: string,
): Promise<DatabaseCompactionManifest> {
  return prepareDatabaseCompactionManifest({
    databasePath: item.databasePath,
    governanceRootDirectory: item.directory,
    operation,
    planId,
    now: new Date('2026-08-02T12:00:00.000Z'),
  });
}

describe('database compaction governance', () => {
  it('prepares a readonly exact manifest with physical, high-water, schema, and all-table projections', async () => {
    const item = await fixture();
    try {
      const before = captureDatabaseCompactionFingerprint(item.raw);
      const manifest = await manifestFor(item, 'incremental-vacuum', 'prepare-exact');
      const after = captureDatabaseCompactionFingerprint(item.raw);

      expect(manifest.databasePath).toBe(item.databasePath);
      expect(manifest.sourceFingerprint).toEqual(before);
      expect(after).toEqual(before);
      expect(manifest.sourceFingerprint.autoVacuum).toEqual({ code: 2, mode: 'INCREMENTAL' });
      expect(manifest.sourceFingerprint.event).toEqual({
        count: 1,
        highWater: { sequence: 1, id: 'event-1' },
      });
      expect(manifest.sourceFingerprint.checkpoint).toEqual({
        count: 1,
        highWater: { sequence: 1, id: 'checkpoint-1' },
      });
      expect(manifest.sourceFingerprint.userTableRowCounts).toEqual([
        { tableName: 'checkpoint', rowCount: 1 },
        { tableName: 'event', rowCount: 1 },
        { tableName: 'sample_data', rowCount: 1 },
        { tableName: 'waste_pages', rowCount: 0 },
      ]);
      expect(manifest.sourceFingerprint.freelistCount).toBeGreaterThan(0);
      expect(manifest.maintenanceFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.confirmationToken).toMatch(
        /^EXECUTE-INCREMENTAL-VACUUM:prepare-exact:[a-f0-9]{16}$/,
      );
      assertDatabaseCompactionManifestIntegrity(manifest);
    } finally {
      item.raw.close();
    }
  });

  it('requires INCREMENTAL mode, an exact token, a maintenance window, and a writable source', async () => {
    const item = await fixture('NONE');
    try {
      const manifest = await manifestFor(item, 'incremental-vacuum', 'incremental-guards');
      await expect(
        executeIncrementalVacuum(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          pageBudget: 1,
        }),
      ).rejects.toThrow(/auto_vacuum=INCREMENTAL/);

      const incremental = await fixture();
      try {
        const validManifest = await manifestFor(
          incremental,
          'incremental-vacuum',
          'incremental-exact-guards',
        );
        await expect(
          executeIncrementalVacuum(incremental.raw, {
            manifest: validManifest,
            confirmationToken: 'wrong-token',
            maintenanceWindowConfirmed: true,
            pageBudget: 1,
          }),
        ).rejects.toThrow(/confirmation/);
        await expect(
          executeIncrementalVacuum(incremental.raw, {
            manifest: validManifest,
            confirmationToken: validManifest.confirmationToken,
            maintenanceWindowConfirmed: false,
            pageBudget: 1,
          }),
        ).rejects.toThrow(/maintenance window/);
        incremental.raw.pragma('query_only = ON');
        await expect(
          executeIncrementalVacuum(incremental.raw, {
            manifest: validManifest,
            confirmationToken: validManifest.confirmationToken,
            maintenanceWindowConfirmed: true,
            pageBudget: 1,
          }),
        ).rejects.toThrow(/writable connection/);
      } finally {
        incremental.raw.close();
      }
    } finally {
      item.raw.close();
    }
  });

  it('honors page/time budgets and supports durable cancellation plus resume', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'incremental-vacuum', 'incremental-resume');
      const auditPath = join(item.directory, 'incremental.audit.json');
      const controller = new AbortController();
      const cancelled = await executeIncrementalVacuum(item.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        auditPath,
        pageBudget: 4,
        batchPages: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.stopReason).toBe('signal');
      expect(cancelled.progress.batchesCommitted).toBe(1);
      expect(existsSync(auditPath)).toBe(true);

      const completed = await executeIncrementalVacuum(item.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        auditPath,
        pageBudget: 4,
        batchPages: 1,
      });
      expect(completed.status).toBe('completed');
      expect(completed.progress.batchesCommitted).toBeGreaterThanOrEqual(1);
      expect(completed.progress.pagesRequested).toBeLessThanOrEqual(4);
      expect(completed.progress.pagesFreed).toBeGreaterThanOrEqual(0);

      const timedItem = await fixture();
      try {
        const timedManifest = await manifestFor(
          timedItem,
          'incremental-vacuum',
          'incremental-time-budget',
        );
        let tick = 0;
        const timed = await executeIncrementalVacuum(timedItem.raw, {
          manifest: timedManifest,
          confirmationToken: timedManifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          pageBudget: 4,
          batchPages: 1,
          timeBudgetMs: 1,
          monotonicNow: () => tick++,
        });
        expect(timed.status).toBe('cancelled');
        expect(timed.stopReason).toBe('time-budget');
        expect(timed.progress.batchesCommitted).toBe(0);
      } finally {
        timedItem.raw.close();
      }
    } finally {
      item.raw.close();
    }
  });

  it('reconciles a committed incremental-vacuum batch when audit progress was not advanced', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'incremental-vacuum', 'incremental-crash-window');
      const auditPath = join(item.directory, 'incremental-crash.audit.json');
      await expect(
        executeIncrementalVacuum(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          auditPath,
          pageBudget: 2,
          batchPages: 1,
          onBatchDatabaseCommitted: () => {
            throw new Error('simulated crash after database commit');
          },
        }),
      ).rejects.toThrow(/simulated crash/);
      const failedAudit = JSON.parse(readFileSync(auditPath, 'utf8')) as {
        status: string;
        progress: { pendingBatch?: unknown };
      };
      expect(failedAudit.status).toBe('failed');
      expect(failedAudit.progress.pendingBatch).toBeTruthy();

      const resumed = await executeIncrementalVacuum(item.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        auditPath,
        pageBudget: 2,
        batchPages: 1,
      });
      expect(resumed.status).toBe('completed');
      expect(resumed.progress.pendingBatch).toBeUndefined();
    } finally {
      item.raw.close();
    }
  });

  it('fails closed on manifest, audit, schema, high-water, row-count, and physical drift', async () => {
    const tampered = await fixture();
    try {
      const manifest = await manifestFor(tampered, 'incremental-vacuum', 'tamper-manifest');
      const altered = structuredClone(manifest);
      altered.sourceFingerprint.pageCount += 1;
      expect(() => assertDatabaseCompactionManifestIntegrity(altered)).toThrow(/fingerprint hash/);

      const auditPath = join(tampered.directory, 'tampered.audit.json');
      const controller = new AbortController();
      controller.abort();
      await executeIncrementalVacuum(tampered.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        auditPath,
        pageBudget: 1,
        signal: controller.signal,
      });
      const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as Record<string, unknown>;
      audit.status = 'completed';
      writeFileSync(auditPath, JSON.stringify(audit));
      await expect(
        executeIncrementalVacuum(tampered.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          auditPath,
          pageBudget: 1,
        }),
      ).rejects.toThrow(/audit hash/);
    } finally {
      tampered.raw.close();
    }

    for (const drift of ['schema', 'event', 'checkpoint', 'row-count', 'physical'] as const) {
      const item = await fixture();
      try {
        const manifest = await manifestFor(item, 'incremental-vacuum', `drift-${drift}`);
        if (drift === 'schema') item.raw.exec('CREATE TABLE drift_table (id INTEGER)');
        if (drift === 'event') {
          item.raw
            .prepare('INSERT INTO event (id, sequence, payload_json) VALUES (?, ?, ?)')
            .run('event-2', 2, '{}');
        }
        if (drift === 'checkpoint') {
          item.raw
            .prepare(
              'INSERT INTO checkpoint (id, last_event_sequence, state_json) VALUES (?, ?, ?)',
            )
            .run('checkpoint-2', 2, '{}');
        }
        if (drift === 'row-count') {
          item.raw.prepare('INSERT INTO sample_data (value) VALUES (?)').run('beta');
        }
        if (drift === 'physical') item.raw.pragma('incremental_vacuum(1)');
        await expect(
          executeIncrementalVacuum(item.raw, {
            manifest,
            confirmationToken: manifest.confirmationToken,
            maintenanceWindowConfirmed: true,
            pageBudget: 1,
          }),
        ).rejects.toThrow(/drifted/);
      } finally {
        item.raw.close();
      }
    }
  });

  it('creates a verified VACUUM INTO candidate while preserving the source and handoff metadata', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'offline-compaction', 'offline-success');
      const sourceBefore = captureDatabaseCompactionFingerprint(item.raw);
      const outputPath = join(item.directory, 'compacted.db');
      const auditPath = join(item.directory, 'compacted.audit.json');
      const audit = await executeOfflineDatabaseCompaction(item.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        outputPath,
        auditPath,
      });

      expect(audit.status).toBe('completed');
      expect(existsSync(outputPath)).toBe(true);
      expect(existsSync(item.databasePath)).toBe(true);
      expect(captureDatabaseCompactionFingerprint(item.raw)).toEqual(sourceBefore);
      expect(audit.output.bytes).toBeGreaterThan(0);
      expect(audit.output.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(audit.output.verification).toMatchObject({
        quickCheck: 'ok',
        integrityCheck: 'ok',
      });
      expect(audit.output.verification?.outputFingerprint.freelistCount).toBe(0);
      expect(audit.handoff).toEqual({
        sourceDatabasePath: item.databasePath,
        compactedDatabasePath: outputPath,
        sourceDatabasePreserved: true,
        automaticSwitchPerformed: false,
        switchRequiresOfflineMaintenanceWindow: true,
        rollbackDatabasePath: item.databasePath,
      });
      await expect(verifyOfflineDatabaseCompactionResult(manifest, auditPath)).resolves.toEqual(
        audit,
      );
    } finally {
      item.raw.close();
    }
  });

  it('rejects wrong offline confirmation, missing maintenance, existing output, and source drift', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'offline-compaction', 'offline-guards');
      const outputPath = join(item.directory, 'guard-output.db');
      await expect(
        executeOfflineDatabaseCompaction(item.raw, {
          manifest,
          confirmationToken: 'wrong',
          maintenanceWindowConfirmed: true,
          outputPath,
        }),
      ).rejects.toThrow(/confirmation/);
      await expect(
        executeOfflineDatabaseCompaction(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: false,
          outputPath,
        }),
      ).rejects.toThrow(/maintenance window/);
      writeFileSync(outputPath, 'occupied');
      await expect(
        executeOfflineDatabaseCompaction(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          outputPath,
        }),
      ).rejects.toThrow(/existing output/);
      rmSync(outputPath);
      item.raw.prepare('INSERT INTO sample_data (value) VALUES (?)').run('drift');
      await expect(
        executeOfflineDatabaseCompaction(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          outputPath,
        }),
      ).rejects.toThrow(/drifted/);
    } finally {
      item.raw.close();
    }
  });

  it('detects output and audit tampering after offline compaction', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'offline-compaction', 'offline-tamper');
      const outputPath = join(item.directory, 'tamper-output.db');
      const auditPath = join(item.directory, 'tamper-output.audit.json');
      await executeOfflineDatabaseCompaction(item.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        outputPath,
        auditPath,
      });
      appendFileSync(outputPath, Buffer.from('tamper'));
      await expect(verifyOfflineDatabaseCompactionResult(manifest, auditPath)).rejects.toThrow(
        /output bytes or hash/,
      );

      const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as Record<string, unknown>;
      audit.status = 'failed';
      writeFileSync(auditPath, JSON.stringify(audit));
      await expect(verifyOfflineDatabaseCompactionResult(manifest, auditPath)).rejects.toThrow(
        /audit hash/,
      );
    } finally {
      item.raw.close();
    }
  });

  it('enforces output containment and rejects symlink or junction path components', async () => {
    const item = await fixture();
    try {
      const manifest = await manifestFor(item, 'offline-compaction', 'offline-paths');
      const escaped = join(item.directory, '..', `escaped-${Date.now()}.db`);
      await expect(
        executeOfflineDatabaseCompaction(item.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          outputPath: escaped,
        }),
      ).rejects.toThrow(/escaped/);

      const target = mkdtempSync(join(tmpdir(), 'sync-think-db-compaction-target-'));
      tempDirectories.push(target);
      const link = join(item.directory, 'linked-output');
      let linkCreated = false;
      try {
        symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
      } catch {
        // The containment assertion above remains the portable path-boundary coverage.
      }
      if (linkCreated) {
        await expect(
          executeOfflineDatabaseCompaction(item.raw, {
            manifest,
            confirmationToken: manifest.confirmationToken,
            maintenanceWindowConfirmed: true,
            outputPath: join(link, 'compacted.db'),
          }),
        ).rejects.toThrow(/symlink|junction|reparse-point/);
      }
    } finally {
      item.raw.close();
    }
  });
});
