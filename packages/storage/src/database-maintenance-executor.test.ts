import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import {
  assertDatabaseMaintenanceManifestIntegrity,
  executeDatabaseMaintenance,
  prepareDatabaseMaintenanceManifest,
  readDatabaseMaintenanceManifest,
  writeDatabaseMaintenanceManifest,
} from './database-maintenance-executor.js';
import { EventPayloadSidecarStore, parseStoredEventPayload } from './event-payload-sidecar.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixturePath(): { dir: string; dbPath: string; backupsDirectory: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-db-maintenance-'));
  tempDirs.push(dir);
  return { dir, dbPath: join(dir, 'sync-think.db'), backupsDirectory: join(dir, 'backups') };
}

function insertEvent(
  raw: BetterSQLite3Raw,
  input: {
    id: string;
    sequence: number;
    category?: string;
    type?: string;
    taskId?: string;
    runId?: string;
    payloadJson?: string;
  },
): void {
  raw
    .prepare(
      `INSERT INTO event (
         id, workspace_id, task_id, run_id, category, type, sequence, occurred_at, payload_json
       ) VALUES (?, 'workspace-maintenance', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.taskId ?? null,
      input.runId ?? null,
      input.category ?? 'system',
      input.type ?? 'runtime.telemetry.health.sampled',
      input.sequence,
      `2026-08-02T00:00:${String(input.sequence).padStart(2, '0')}.000Z`,
      input.payloadJson ?? '{}',
    );
}

function writeBackup(path: string, bytes: number, modifiedAt: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, 1));
  const time = new Date(modifiedAt);
  utimesSync(path, time, time);
}

async function migratedFixture(): Promise<{
  fixture: ReturnType<typeof fixturePath>;
  connection: Awaited<ReturnType<typeof openDatabaseAsync>>;
}> {
  const fixture = fixturePath();
  await runMigrations(fixture.dbPath);
  const connection = await openDatabaseAsync({ path: fixture.dbPath });
  return { fixture, connection };
}

describe('database maintenance executor', () => {
  it('prepares an exact, hashed manifest without reading protected rows into the candidate list', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-health', sequence: 1 });
      insertEvent(connection.raw, {
        id: 'candidate-trace',
        sequence: 2,
        category: 'diagnostic',
        type: 'runtime.trace.sampled',
      });
      insertEvent(connection.raw, {
        id: 'protected-scoped',
        sequence: 3,
        runId: 'run-1',
      });
      insertEvent(connection.raw, {
        id: 'protected-approval',
        sequence: 4,
        category: 'approval',
        type: 'approval.requested',
      });
      insertEvent(connection.raw, {
        id: 'protected-context',
        sequence: 5,
        category: 'system',
        type: 'context.telemetry.snapshot',
      });
      writeBackup(join(fixture.backupsDirectory, 'old-a.backup.db'), 5, '2026-08-01T00:00:00Z');
      writeBackup(join(fixture.backupsDirectory, 'old-b.backup.db'), 7, '2026-08-01T01:00:00Z');
      writeBackup(join(fixture.backupsDirectory, 'new.backup.db'), 11, '2026-08-01T02:00:00Z');

      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        backupPolicy: { keepLatest: 1, maxTotalBytes: 1_000 },
        now: new Date('2026-08-02T10:00:00.000Z'),
        planId: 'plan-exact',
      });

      expect(manifest.eventCandidates).toMatchObject({ complete: true, total: 2 });
      expect(manifest.eventCandidates.items.map((item) => item.id)).toEqual([
        'candidate-health',
        'candidate-trace',
      ]);
      expect(manifest.backupCandidates.map((item) => item.name)).toEqual([
        'old-a.backup.db',
        'old-b.backup.db',
      ]);
      expect(manifest.protectedSummary).toEqual({ durableEventRows: 3, checkpointRows: 0 });
      expect(manifest.confirmationToken).toMatch(
        /^APPLY-DATABASE-MAINTENANCE:plan-exact:[a-f0-9]{16}$/,
      );

      const path = join(fixture.dir, 'manifest.json');
      writeDatabaseMaintenanceManifest(path, manifest);
      expect(readDatabaseMaintenanceManifest(path)).toEqual(manifest);
      const tampered = JSON.parse(readFileSync(path, 'utf8')) as typeof manifest;
      tampered.eventCandidates.items[0]!.id = 'protected-approval';
      expect(() => assertDatabaseMaintenanceManifestIntegrity(tampered)).toThrow(
        'manifest hash mismatch',
      );
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(5);
    } finally {
      connection.raw.close();
    }
  });

  it('rejects a truncated manifest and a mismatched explicit confirmation before backup or mutation', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-a', sequence: 1 });
      insertEvent(connection.raw, { id: 'candidate-b', sequence: 2 });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        maxEventCandidates: 1,
        planId: 'plan-truncated',
      });
      expect(manifest.eventCandidates).toMatchObject({ complete: false, total: 2 });

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('manifest is truncated');

      const completeManifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        planId: 'plan-confirmation',
      });
      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest: completeManifest,
          confirmationToken: 'wrong-token',
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('explicit confirmation did not match');
      expect(existsSync(join(fixture.dir, 'maintenance-audits'))).toBe(false);
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(2);
    } finally {
      connection.raw.close();
    }
  });

  it('creates and verifies a recovery backup, deletes only exact telemetry, and quarantines old backups', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-a', sequence: 1 });
      insertEvent(connection.raw, {
        id: 'candidate-b',
        sequence: 2,
        category: 'provider',
        type: 'provider.diagnostic.heartbeat',
      });
      insertEvent(connection.raw, {
        id: 'protected-message',
        sequence: 3,
        taskId: 'task-1',
        category: 'message',
        type: 'message.appended',
      });
      connection.raw
        .prepare(
          `INSERT INTO checkpoint (id, run_id, last_event_sequence, state_json, created_at)
           VALUES ('checkpoint-1', 'run-1', 3, '{}', '2026-08-02T00:00:04.000Z')`,
        )
        .run();
      writeBackup(join(fixture.backupsDirectory, 'old.backup.db'), 5, '2026-08-01T00:00:00Z');
      writeBackup(join(fixture.backupsDirectory, 'new.backup.db'), 11, '2026-08-01T01:00:00Z');

      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        backupPolicy: { keepLatest: 1, maxTotalBytes: 1_000 },
        planId: 'plan-execute',
      });
      const audit = await executeDatabaseMaintenance(connection.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        batchSize: 1,
      });

      expect(audit.status).toBe('completed');
      expect(audit.progress).toMatchObject({
        nextEventIndex: 2,
        eventRowsDeleted: 2,
        eventRowsAlreadyAbsent: 0,
        eventBatchesCommitted: 2,
        nextBackupIndex: 1,
        backupsQuarantined: 1,
      });
      expect(audit.recoveryBackup?.quickCheck).toBe('ok');
      expect(audit.recoveryBackup?.bytes).toBeGreaterThan(0);
      expect(existsSync(audit.recoveryBackup!.path)).toBe(true);
      expect(connection.raw.prepare('SELECT id FROM event ORDER BY sequence').all()).toEqual([
        { id: 'protected-message' },
      ]);
      expect(
        (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as {
            count: number;
          }
        ).count,
      ).toBe(1);
      expect(existsSync(join(fixture.backupsDirectory, 'new.backup.db'))).toBe(true);
      expect(existsSync(join(fixture.backupsDirectory, 'old.backup.db'))).toBe(false);
      expect(existsSync(join(audit.quarantineDirectory, 'old.backup.db'))).toBe(true);
      expect(JSON.parse(readFileSync(audit.auditPath, 'utf8'))).toMatchObject({
        status: 'completed',
        manifestHash: manifest.manifestHash,
      });
    } finally {
      connection.raw.close();
    }
  });

  it('creates a portable SQLite plus sidecar recovery set and hydrates it independently', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      const sidecarRoot = join(fixture.dir, 'event-payloads');
      const sourceSidecar = new EventPayloadSidecarStore(sidecarRoot);
      const payload = {
        packetId: 'packet-recovery-set',
        body: 'recovery-body'.repeat(256),
      };
      const envelope = sourceSidecar.writePayloadJson(JSON.stringify(payload), {
        packetId: payload.packetId,
      });
      insertEvent(connection.raw, { id: 'candidate-inline', sequence: 1 });
      insertEvent(connection.raw, {
        id: 'protected-sidecar',
        sequence: 2,
        category: 'system',
        type: 'context.packet.built',
        runId: 'run-sidecar',
        payloadJson: JSON.stringify(envelope),
      });

      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        eventPayloadSidecarDirectory: sidecarRoot,
        planId: 'plan-sidecar-recovery',
      });
      expect(manifest.version).toBe(2);
      expect(manifest.eventPayloadSidecars).toMatchObject({
        eventReferenceCount: 1,
        sourceRootDirectory: sidecarRoot,
      });
      expect(manifest.eventPayloadSidecars.blobs).toHaveLength(1);

      const audit = await executeDatabaseMaintenance(connection.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
      });
      const recovery = audit.recoveryBackup;
      expect(recovery?.eventPayloadSidecars).toMatchObject({
        eventReferenceCount: 1,
        blobCount: 1,
      });
      expect(existsSync(recovery!.eventPayloadSidecars.manifestPath)).toBe(true);

      const backupConnection = await openDatabaseAsync({
        path: recovery!.path,
        readonly: true,
        fileMustExist: true,
      });
      try {
        const row = backupConnection.raw
          .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
          .get('protected-sidecar') as { payloadJson: string };
        expect(
          parseStoredEventPayload(
            row.payloadJson,
            new EventPayloadSidecarStore(recovery!.eventPayloadSidecars.rootDirectory),
          ),
        ).toEqual(payload);
      } finally {
        backupConnection.raw.close();
      }
    } finally {
      connection.raw.close();
    }
  });

  it('revalidates a completed recovery set before returning its audit', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      const sidecarRoot = join(fixture.dir, 'event-payloads');
      const sourceSidecar = new EventPayloadSidecarStore(sidecarRoot);
      const envelope = sourceSidecar.writePayloadJson(
        JSON.stringify({ packetId: 'packet-completed-revalidate', body: 'body'.repeat(512) }),
      );
      insertEvent(connection.raw, {
        id: 'protected-completed-revalidate',
        sequence: 1,
        category: 'system',
        type: 'context.packet.built',
        runId: 'run-completed-revalidate',
        payloadJson: JSON.stringify(envelope),
      });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        eventPayloadSidecarDirectory: sidecarRoot,
        planId: 'plan-completed-revalidate',
      });
      const completed = await executeDatabaseMaintenance(connection.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
      });
      const recoveryBlob = manifest.eventPayloadSidecars.blobs[0];
      expect(recoveryBlob).toBeDefined();
      writeFileSync(
        join(
          completed.recoveryBackup!.eventPayloadSidecars.rootDirectory,
          recoveryBlob!.relativePath,
        ),
        'corrupt-completed-recovery',
      );

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
          auditPath: completed.auditPath,
        }),
      ).rejects.toThrow('sidecar size mismatch');
    } finally {
      connection.raw.close();
    }
  });

  it('cleans staged recovery files and records a failed audit when sidecar capture fails', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      const sidecarRoot = join(fixture.dir, 'event-payloads');
      const sourceSidecar = new EventPayloadSidecarStore(sidecarRoot);
      const envelope = sourceSidecar.writePayloadJson(
        JSON.stringify({ packetId: 'packet-staging-cleanup', body: 'body'.repeat(512) }),
      );
      insertEvent(connection.raw, {
        id: 'protected-staging-cleanup',
        sequence: 1,
        category: 'system',
        type: 'context.packet.built',
        runId: 'run-staging-cleanup',
        payloadJson: JSON.stringify(envelope),
      });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        eventPayloadSidecarDirectory: sidecarRoot,
        planId: 'plan-staging-cleanup',
      });
      const sourceBlob = manifest.eventPayloadSidecars.blobs[0];
      expect(sourceBlob).toBeDefined();
      const originalBackup = connection.raw.backup.bind(connection.raw);
      vi.spyOn(connection.raw, 'backup').mockImplementation(async (destination, options) => {
        const result = await originalBackup(destination, options);
        writeFileSync(join(sidecarRoot, sourceBlob!.relativePath), 'corrupt-during-backup');
        return result;
      });

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('sidecar size mismatch');

      const maintenanceDirectory = join(fixture.dir, 'backups', 'maintenance');
      expect(readdirSync(maintenanceDirectory)).toEqual([]);
      const auditPath = join(fixture.dir, 'maintenance-audits', 'plan-staging-cleanup.audit.json');
      expect(JSON.parse(readFileSync(auditPath, 'utf8'))).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('sidecar size mismatch'),
      });
      expect(JSON.parse(readFileSync(auditPath, 'utf8'))).not.toHaveProperty('recoveryBackup');
    } finally {
      connection.raw.close();
    }
  });

  it('rejects a source sidecar that changes after its exact manifest', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      const sidecarRoot = join(fixture.dir, 'event-payloads');
      const sourceSidecar = new EventPayloadSidecarStore(sidecarRoot);
      const envelope = sourceSidecar.writePayloadJson(
        JSON.stringify({ packetId: 'packet-stale-sidecar', body: 'x'.repeat(512) }),
      );
      insertEvent(connection.raw, {
        id: 'protected-stale-sidecar',
        sequence: 1,
        category: 'system',
        type: 'context.packet.built',
        runId: 'run-stale-sidecar',
        payloadJson: JSON.stringify(envelope),
      });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        eventPayloadSidecarDirectory: sidecarRoot,
        planId: 'plan-stale-sidecar',
      });
      const blob = manifest.eventPayloadSidecars.blobs[0];
      expect(blob).toBeDefined();
      writeFileSync(join(sidecarRoot, blob!.relativePath), 'corrupt-after-manifest');

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('sidecar size mismatch');
      expect(existsSync(join(fixture.backupsDirectory, 'maintenance'))).toBe(false);
    } finally {
      connection.raw.close();
    }
  });

  it('rejects a stale manifest before creating a recovery backup', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-a', sequence: 1 });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        planId: 'plan-stale',
      });
      insertEvent(connection.raw, {
        id: 'new-protected-event',
        sequence: 2,
        category: 'message',
        type: 'message.appended',
        taskId: 'task-new',
      });

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('database changed after maintenance manifest');
      expect(existsSync(join(fixture.dir, 'maintenance-audits'))).toBe(false);
      expect(existsSync(join(fixture.backupsDirectory, 'maintenance'))).toBe(false);
    } finally {
      connection.raw.close();
    }
  });

  it('cancels after a committed batch and resumes idempotently from the durable audit', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-a', sequence: 1 });
      insertEvent(connection.raw, { id: 'candidate-b', sequence: 2 });
      insertEvent(connection.raw, { id: 'candidate-c', sequence: 3 });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        planId: 'plan-resume',
      });
      const abort = new AbortController();
      const cancelled = await executeDatabaseMaintenance(connection.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        batchSize: 1,
        signal: abort.signal,
        onEventBatchCommitted: () => abort.abort(),
      });

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.progress).toMatchObject({
        nextEventIndex: 1,
        eventRowsDeleted: 1,
        eventBatchesCommitted: 1,
      });
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(2);

      const completed = await executeDatabaseMaintenance(connection.raw, {
        manifest,
        confirmationToken: manifest.confirmationToken,
        maintenanceWindowConfirmed: true,
        batchSize: 1,
        auditPath: cancelled.auditPath,
      });
      expect(completed.status).toBe('completed');
      expect(completed.progress).toMatchObject({
        nextEventIndex: 3,
        eventRowsDeleted: 3,
        eventRowsAlreadyAbsent: 0,
        eventBatchesCommitted: 3,
      });
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(0);
      expect(completed.recoveryBackup?.path).toBe(cancelled.recoveryBackup?.path);
    } finally {
      connection.raw.close();
    }
  });

  it('fails closed if an exact Event candidate becomes protected after the manifest', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      insertEvent(connection.raw, { id: 'candidate-a', sequence: 1 });
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        planId: 'plan-protected-change',
      });
      connection.raw
        .prepare("UPDATE event SET category = 'approval', type = 'approval.requested' WHERE id = ?")
        .run('candidate-a');

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('candidate no longer matches the protected selector');
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(1);
      const auditPath = join(fixture.dir, 'maintenance-audits', 'plan-protected-change.audit.json');
      expect(JSON.parse(readFileSync(auditPath, 'utf8'))).toMatchObject({ status: 'failed' });
    } finally {
      connection.raw.close();
    }
  });

  it('fails closed when a backup candidate identity changes after the manifest', async () => {
    const { fixture, connection } = await migratedFixture();
    try {
      writeBackup(join(fixture.backupsDirectory, 'old.backup.db'), 5, '2026-08-01T00:00:00Z');
      writeBackup(join(fixture.backupsDirectory, 'new.backup.db'), 11, '2026-08-01T01:00:00Z');
      const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.backupsDirectory,
        backupPolicy: { keepLatest: 1, maxTotalBytes: 1_000 },
        planId: 'plan-backup-changed',
      });
      writeFileSync(join(fixture.backupsDirectory, 'old.backup.db'), Buffer.alloc(9, 2));

      await expect(
        executeDatabaseMaintenance(connection.raw, {
          manifest,
          confirmationToken: manifest.confirmationToken,
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('backup candidate changed after manifest');
      expect(existsSync(join(fixture.backupsDirectory, 'old.backup.db'))).toBe(true);
      expect(statSync(join(fixture.backupsDirectory, 'old.backup.db')).size).toBe(9);
    } finally {
      connection.raw.close();
    }
  });
});
