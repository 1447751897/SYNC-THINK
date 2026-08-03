import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import {
  assertEventRetentionArchiveManifestIntegrity,
  executeEventRetentionArchive,
  prepareEventRetentionArchiveManifest,
  rollbackEventRetentionArchive,
  type EventRetentionArchiveManifest,
} from './event-retention-archive.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) });

async function fixture(): Promise<{ dir: string; databasePath: string; archiveRoot: string; raw: BetterSQLite3Raw }> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-retention-archive-')); tempDirs.push(dir);
  const databasePath = join(dir, 'sync-think.db'); const archiveRoot = join(dir, 'archives');
  await runMigrations(databasePath); const connection = await openDatabaseAsync({ path: databasePath });
  return { dir, databasePath, archiveRoot, raw: connection.raw };
}
interface InsertInput {
  id: string; sequence: number; occurredAt?: string; workspaceId?: string;
  taskId?: string | null; runId?: string | null; stepId?: string | null; messageId?: string | null;
  category?: string; type?: string; payloadJson?: string;
}
function insertEvent(raw: BetterSQLite3Raw, input: InsertInput): void {
  raw.prepare(`INSERT INTO event (id, workspace_id, task_id, run_id, step_id, message_id, category, type, sequence, occurred_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.workspaceId ?? 'workspace-retention', input.taskId ?? null, input.runId ?? null,
      input.stepId ?? null, input.messageId ?? null, input.category ?? 'system',
      input.type ?? 'runtime.telemetry.health.sampled', input.sequence,
      input.occurredAt ?? `2026-07-01T00:00:${String(input.sequence).padStart(2, '0')}.000Z`,
      input.payloadJson ?? JSON.stringify({ id: input.id, detail: 'x'.repeat(16) }),
    );
}
function ids(raw: BetterSQLite3Raw): string[] { return (raw.prepare('SELECT id FROM event ORDER BY sequence, id').all() as Array<{ id: string }>).map((row) => row.id) }
async function manifestFor(item: Awaited<ReturnType<typeof fixture>>, archiveId = 'archive-test'): Promise<EventRetentionArchiveManifest> {
  return prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot,
    cutoff: '2026-08-01T00:00:00.000Z', maxRows: 100, maxBytes: 1024 * 1024, archiveId,
    now: () => new Date('2026-08-02T00:00:00.000Z') });
}
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

describe('event retention archive', () => {
  it('prepares readonly exact manifest and selects only fully-global low-value old rows below high-water', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 });
      insertEvent(item.raw, { id: 'scoped-task', sequence: 2, taskId: 'task-1' });
      insertEvent(item.raw, { id: 'scoped-run', sequence: 3, runId: 'run-1' });
      insertEvent(item.raw, { id: 'protected-type', sequence: 4, type: 'context.telemetry.sampled' });
      insertEvent(item.raw, { id: 'new-row', sequence: 5, occurredAt: '2026-08-01T00:00:00.000Z' });
      insertEvent(item.raw, { id: 'high-water', sequence: 6 });
      const before = ids(item.raw); const manifest = await manifestFor(item);
      expect(manifest.rows.map((row) => row.id)).toEqual(['candidate']);
      expect(manifest.highWaterFence).toMatchObject({ id: 'high-water', sequence: 6 });
      expect(manifest.schemaHash).toBe(manifest.sourceFingerprint.schemaHash);
      expect(manifest.rows[0]).toMatchObject({ workspaceId: 'workspace-retention', category: 'system', type: 'runtime.telemetry.health.sampled' });
      expect(manifest.rows[0]?.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.rows[0]?.fullRowSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(ids(item.raw)).toEqual(before); expect(existsSync(item.archiveRoot)).toBe(false);
      assertEventRetentionArchiveManifestIntegrity(manifest);
    } finally { item.raw.close() }
  });

  it('enforces canonical cutoff and positive safe budgets', async () => {
    const item = await fixture();
    try {
      await expect(prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot, cutoff: 'not-iso', maxRows: 1, maxBytes: 1 })).rejects.toThrow(/cutoff/);
      await expect(prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot, cutoff: '2026-08-01T08:00:00+08:00', maxRows: 1, maxBytes: 1 })).rejects.toThrow(/canonical/);
      await expect(prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot, cutoff: '2026-02-31T00:00:00.000Z', maxRows: 1, maxBytes: 1 })).rejects.toThrow(/canonical/);
      await expect(prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot, cutoff: '2026-08-01T00:00:00.000Z', maxRows: 0, maxBytes: 1 })).rejects.toThrow(/maxRows/);
      await expect(prepareEventRetentionArchiveManifest({ databasePath: item.databasePath, archiveRootDirectory: item.archiveRoot, cutoff: '2026-08-01T00:00:00.000Z', maxRows: 1, maxBytes: -1 })).rejects.toThrow(/maxBytes/);
      insertEvent(item.raw, { id: 'non-canonical-candidate', sequence: 1, occurredAt: '2026-07-01T00:00:01Z' });
      insertEvent(item.raw, { id: 'high-water', sequence: 2 });
      await expect(manifestFor(item, 'non-canonical-row')).rejects.toThrow(/canonical/);
    } finally { item.raw.close() }
  });

  it('creates a verified portable recovery set before exact deletion', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate-a', sequence: 1 }); insertEvent(item.raw, { id: 'candidate-b', sequence: 2 }); insertEvent(item.raw, { id: 'durable', sequence: 3, category: 'run', type: 'run.completed' });
      insertEvent(item.raw, { id: 'high-water', sequence: 4 }); const manifest = await manifestFor(item);
      const audit = await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true, batchSize: 1 });
      expect(audit.status).toBe('completed'); expect(audit.progress.rowsDeleted).toBe(2); expect(ids(item.raw)).toEqual(['durable', 'high-water']);
      const directory = join(item.archiveRoot, manifest.archiveId); const compressed = readFileSync(join(directory, 'events.jsonl.gz'));
      const descriptor = JSON.parse(readFileSync(join(directory, 'segment.json'), 'utf8')) as { storedSha256: string; rowCount: number; uncompressedSha256: string };
      const text = gunzipSync(compressed).toString('utf8'); expect(descriptor.rowCount).toBe(2); expect(descriptor.storedSha256).toBe(sha(compressed)); expect(descriptor.uncompressedSha256).toBe(sha(Buffer.from(text)));
      expect(text.trim().split('\n').map((line) => (JSON.parse(line) as { id: string }).id)).toEqual(['candidate-a', 'candidate-b']);
      expect(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))).toEqual(manifest);
    } finally { item.raw.close() }
  });

  it('cancels after a committed batch and resumes from durable audit', async () => {
    const item = await fixture();
    try {
      for (let sequence = 1; sequence <= 4; sequence += 1) insertEvent(item.raw, { id: `candidate-${sequence}`, sequence });
      insertEvent(item.raw, { id: 'high-water', sequence: 5 }); const manifest = await manifestFor(item); const controller = new AbortController();
      const cancelled = await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true, batchSize: 1, signal: controller.signal, onBatchCommitted: () => controller.abort() });
      expect(cancelled.status).toBe('cancelled'); expect(cancelled.progress.nextRowIndex).toBe(1); expect(ids(item.raw)).toEqual(['candidate-2','candidate-3','candidate-4','high-water']);
      const completed = await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true, batchSize: 2 });
      expect(completed.status).toBe('completed'); expect(completed.progress.rowsDeleted).toBe(4); expect(ids(item.raw)).toEqual(['high-water']);
    } finally { item.raw.close() }
  });
  it('recovers execute and rollback when the database batch commits before the audit cursor', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate-a', sequence: 1, payloadJson: 'opaque-payload-a' });
      insertEvent(item.raw, { id: 'candidate-b', sequence: 2, payloadJson: 'opaque-payload-b' });
      insertEvent(item.raw, { id: 'high-water', sequence: 3 });
      const manifest = await manifestFor(item, 'archive-crash-window');
      let executeCrash = true;
      await expect(executeEventRetentionArchive(item.raw, {
        manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true, batchSize: 1,
        onBatchDatabaseCommitted: () => { if (executeCrash) { executeCrash = false; throw new Error('simulated execute crash') } },
      })).rejects.toThrow(/simulated execute crash/);
      expect(ids(item.raw)).toEqual(['candidate-b', 'high-water']);
      const executed = await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true, batchSize: 1 });
      expect(executed.status).toBe('completed');

      let rollbackCrash = true;
      await expect(rollbackEventRetentionArchive(item.raw, {
        manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true, batchSize: 1,
        onBatchDatabaseCommitted: () => { if (rollbackCrash) { rollbackCrash = false; throw new Error('simulated rollback crash') } },
      })).rejects.toThrow(/simulated rollback crash/);
      expect(ids(item.raw)).toEqual(['candidate-a', 'high-water']);
      const restored = await rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true, batchSize: 1 });
      expect(restored.status).toBe('completed');
      expect(ids(item.raw)).toEqual(['candidate-a', 'candidate-b', 'high-water']);
      expect(item.raw.prepare('SELECT payload_json FROM event WHERE id = ?').pluck().get('candidate-a')).toBe('opaque-payload-a');
    } finally { item.raw.close() }
  });

  it('cancels rollback after a durable batch and resumes from its exact prefix', async () => {
    const item = await fixture();
    try {
      for (let sequence = 1; sequence <= 3; sequence += 1) insertEvent(item.raw, { id: `candidate-${sequence}`, sequence });
      insertEvent(item.raw, { id: 'high-water', sequence: 4 });
      const manifest = await manifestFor(item, 'archive-rollback-cancel');
      await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true });
      const controller = new AbortController();
      const cancelled = await rollbackEventRetentionArchive(item.raw, {
        manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true, batchSize: 1,
        signal: controller.signal, onBatchCommitted: () => controller.abort(),
      });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.progress.nextRowIndex).toBe(1);
      expect(ids(item.raw)).toEqual(['candidate-1', 'high-water']);
      const completed = await rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true, batchSize: 2 });
      expect(completed.status).toBe('completed');
      expect(ids(item.raw)).toEqual(['candidate-1', 'candidate-2', 'candidate-3', 'high-water']);
    } finally { item.raw.close() }
  });

  it('rolls the verified segment back exactly and keeps original high-water row', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate-a', sequence: 1, payloadJson: '{"a":1}' }); insertEvent(item.raw, { id: 'candidate-b', sequence: 2, payloadJson: '{"b":2}' }); insertEvent(item.raw, { id: 'high-water', sequence: 3 });
      const manifest = await manifestFor(item); await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true });
      const audit = await rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true, batchSize: 1 });
      expect(audit.status).toBe('completed'); expect(ids(item.raw)).toEqual(['candidate-a','candidate-b','high-water']);
      expect(item.raw.prepare('SELECT id FROM event ORDER BY sequence DESC, id DESC LIMIT 1').pluck().get()).toBe('high-water');
      const again = await rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true }); expect(again).toEqual(audit);
    } finally { item.raw.close() }
  });

  it('rejects manifest tamper and candidate database drift before deletion', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 }); insertEvent(item.raw, { id: 'high-water', sequence: 2 }); const manifest = await manifestFor(item);
      const tampered = structuredClone(manifest); tampered.rows[0]!.payloadByteLength += 1;
      await expect(executeEventRetentionArchive(item.raw, { manifest: tampered, confirmationToken: tampered.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/manifest|totals|hash/);
      item.raw.prepare(`UPDATE event SET payload_json = '{"drift":true}' WHERE id = 'candidate'`).run();
      await expect(executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/identity changed/);
      expect(ids(item.raw)).toEqual(['candidate','high-water']);
    } finally { item.raw.close() }
  });

  it('rejects protected database drift and high-water drift', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 }); insertEvent(item.raw, { id: 'durable', sequence: 2, category: 'run', type: 'run.completed' }); insertEvent(item.raw, { id: 'high-water', sequence: 3 }); const manifest = await manifestFor(item);
      item.raw.prepare(`UPDATE event SET payload_json = '{"changed":true}' WHERE id = 'durable'`).run();
      await expect(executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/protected rows changed/);
      item.raw.prepare(`UPDATE event SET payload_json = '{}' WHERE id = 'durable'`).run();
      const second = await manifestFor(item, 'archive-high-water-drift'); item.raw.prepare(`INSERT INTO event (id,workspace_id,category,type,sequence,occurred_at,payload_json) VALUES ('later','workspace-retention','run','run.completed',99,'2026-08-02T01:00:00.000Z','{}')`).run();
      await expect(executeEventRetentionArchive(item.raw, { manifest: second, confirmationToken: second.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/protected rows changed|high-water/);
    } finally { item.raw.close() }
  });

  it('rejects segment and execute-audit tamper without rewriting the archive', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 }); insertEvent(item.raw, { id: 'high-water', sequence: 2 }); const manifest = await manifestFor(item);
      await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true });
      const directory = join(item.archiveRoot, manifest.archiveId); const auditPath = join(directory, 'execute.audit.json'); const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as { progress: { rowsDeleted: number } }; audit.progress.rowsDeleted = 99; writeFileSync(auditPath, JSON.stringify(audit));
      await expect(executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/audit/);
      writeFileSync(join(directory, 'events.jsonl.gz'), Buffer.from('corrupt'));
      await expect(rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/descriptor|corrupt/);
      expect(ids(item.raw)).toEqual(['high-water']);
    } finally { item.raw.close() }
  });

  it('rejects structurally invalid audit timestamps even when the audit hash is recomputed', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 }); insertEvent(item.raw, { id: 'high-water', sequence: 2 });
      const manifest = await manifestFor(item, 'archive-audit-structure');
      await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true });
      const auditPath = join(item.archiveRoot, manifest.archiveId, 'execute.audit.json');
      const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as Record<string, unknown>;
      audit.updatedAt = '2026-08-02T00:00:00Z';
      delete audit.auditHash;
      audit.auditHash = sha(Buffer.from(JSON.stringify(audit), 'utf8'));
      writeFileSync(auditPath, JSON.stringify(audit));
      await expect(executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/audit/);
    } finally { item.raw.close() }
  });

  it('rejects an archive root junction before writing outside the governed path', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'candidate', sequence: 1 }); insertEvent(item.raw, { id: 'high-water', sequence: 2 }); const manifest = await manifestFor(item);
      const outside = join(item.dir, 'outside'); const { mkdirSync } = await import('node:fs'); mkdirSync(outside); symlinkSync(outside, item.archiveRoot, 'junction'); expect(lstatSync(item.archiveRoot).isSymbolicLink()).toBe(true);
      await expect(executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true })).rejects.toThrow(/links|reparse/);
      expect(ids(item.raw)).toEqual(['candidate','high-water']);
    } finally { item.raw.close() }
  });

  it('handles an empty exact plan as a verified no-op archive and rollback', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'high-water', sequence: 1 }); const manifest = await manifestFor(item); expect(manifest.rows).toEqual([]);
      const executed = await executeEventRetentionArchive(item.raw, { manifest, confirmationToken: manifest.confirmationToken, maintenanceWindowConfirmed: true }); expect(executed.status).toBe('completed'); expect(executed.progress.rowsDeleted).toBe(0);
      const rolledBack = await rollbackEventRetentionArchive(item.raw, { manifest, rollbackToken: manifest.rollbackToken, maintenanceWindowConfirmed: true }); expect(rolledBack.status).toBe('completed'); expect(ids(item.raw)).toEqual(['high-water']);
      expect(gunzipSync(readFileSync(join(item.archiveRoot, manifest.archiveId, 'events.jsonl.gz'))).byteLength).toBe(0);
    } finally { item.raw.close() }
  });
});
