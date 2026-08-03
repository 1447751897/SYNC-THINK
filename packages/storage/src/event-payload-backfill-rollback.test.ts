import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { prepareEventPayloadBackfillPlan } from './event-payload-backfill.js';
import { executeEventPayloadBackfill, expectedEventPayloadBackfillConfirmationToken } from './event-payload-backfill-executor.js';
import { expectedEventPayloadBackfillRollbackConfirmationToken, rollbackEventPayloadBackfill } from './event-payload-backfill-rollback.js';
import { EVENT_PAYLOAD_ENVELOPE_KEY, EventPayloadSidecarStore } from './event-payload-sidecar.js';
import { runMigrations } from './scripts/migrate.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function fixture(count = 3, includeSourceSidecar = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-backfill-rollback-'));
  dirs.push(dir);
  const databasePath = join(dir, 'sync-think.db');
  const sidecarRootDirectory = join(dir, 'sidecars');
  await runMigrations(databasePath);
  const { raw } = await openDatabaseAsync({ path: databasePath });
  const payloads: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const payload = JSON.stringify({ threadId: 'thread', packetId: `packet-${i}`, body: `body-${i}`.repeat(300) });
    payloads.push(payload);
    raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES (?, 'ws', 'context', 'context.packet.built', ?, ?, ?)`).run(`event-${i}`, i + 1, `2026-08-02T11:00:${String(i).padStart(2, '0')}.000Z`, payload);
  }
  const sourceEnvelope = includeSourceSidecar
    ? new EventPayloadSidecarStore(sidecarRootDirectory).writePayloadJson(
        JSON.stringify({ packetId: 'source-sidecar', body: 'source-sidecar-body'.repeat(128) }),
        { packetId: 'source-sidecar' },
      )
    : undefined;
  if (sourceEnvelope) {
    raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES ('event-source-sidecar', 'ws', 'context', 'context.packet.built', ?, '2026-08-02T11:01:00.000Z', ?)`).run(count + 1, JSON.stringify(sourceEnvelope));
  }
  const plan = prepareEventPayloadBackfillPlan(raw, { databasePath, sidecarRootDirectory, minimumPayloadBytes: 128, planId: 'rollback-plan' });
  return { dir, databasePath, sidecarRootDirectory, raw, payloads, plan, sourceEnvelope };
}

async function execute(raw: BetterSQLite3Raw, item: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
  return executeEventPayloadBackfill(raw, {
    plan: item.plan,
    confirmationToken: expectedEventPayloadBackfillConfirmationToken(item.plan),
    maintenanceWindowConfirmed: true,
    auditPath: join(item.dir, 'execute.audit.json'),
    batchSize: 1,
    ...(signal ? { signal } : {}),
  });
}

function rollbackOptions(item: Awaited<ReturnType<typeof fixture>>, executionAudit: Awaited<ReturnType<typeof execute>>) {
  return {
    plan: item.plan,
    executionAudit,
    confirmationToken: expectedEventPayloadBackfillRollbackConfirmationToken(item.plan),
    maintenanceWindowConfirmed: true,
    auditPath: join(item.dir, 'rollback.audit.json'),
  } as const;
}

describe('event payload backfill exact rollback', () => {
  it('restores every original payload from the verified recovery database in batches', async () => {
    const item = await fixture();
    try {
      const executionAudit = await execute(item.raw, item);
      const audit = await rollbackEventPayloadBackfill(item.raw, { ...rollbackOptions(item, executionAudit), batchSize: 2 });
      expect(audit.status).toBe('completed');
      expect(audit.progress).toMatchObject({ nextCandidateIndex: 3, rowsRestored: 3, rowsAlreadyOriginal: 0, batchesCommitted: 2 });
      const rows = item.raw.prepare('SELECT payload_json AS payloadJson FROM event ORDER BY id').all() as Array<{ payloadJson: string }>;
      expect(rows.map((row) => row.payloadJson)).toEqual(item.payloads);
      expect(await rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).toEqual(audit);
    } finally { item.raw.close(); }
  });

  it('rolls back a cancelled partial execution and treats untouched rows as already original', async () => {
    const item = await fixture();
    try {
      const controller = new AbortController();
      const executionAudit = await executeEventPayloadBackfill(item.raw, {
        plan: item.plan,
        confirmationToken: expectedEventPayloadBackfillConfirmationToken(item.plan),
        maintenanceWindowConfirmed: true,
        auditPath: join(item.dir, 'execute.audit.json'),
        batchSize: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      const audit = await rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit));
      expect(audit.progress).toMatchObject({ rowsRestored: 1, rowsAlreadyOriginal: 2 });
    } finally { item.raw.close(); }
  });

  it('resumes idempotently across rollback commit/audit and cancellation boundaries', async () => {
    const item = await fixture();
    try {
      const executionAudit = await execute(item.raw, item);
      await expect(rollbackEventPayloadBackfill(item.raw, { ...rollbackOptions(item, executionAudit), batchSize: 2, onBatchDatabaseCommitted: () => { throw new Error('rollback crash'); } })).rejects.toThrow('rollback crash');
      const controller = new AbortController();
      const cancelled = await rollbackEventPayloadBackfill(item.raw, { ...rollbackOptions(item, executionAudit), batchSize: 2, signal: controller.signal, onBatchCommitted: () => controller.abort() });
      expect(cancelled.status).toBe('cancelled');
      const completed = await rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit));
      expect(completed.status).toBe('completed');
      expect(completed.progress.rowsAlreadyOriginal).toBeGreaterThanOrEqual(2);
    } finally { item.raw.close(); }
  });

  it('rejects invalid confirmation and current-state drift', async () => {
    const item = await fixture(1);
    try {
      const executionAudit = await execute(item.raw, item);
      await expect(rollbackEventPayloadBackfill(item.raw, { ...rollbackOptions(item, executionAudit), confirmationToken: 'wrong' })).rejects.toThrow('confirmation');
      item.raw.prepare("UPDATE event SET payload_json = '{\"drift\":true}' WHERE id = 'event-0'").run();
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).rejects.toThrow('outside the exact');
    } finally { item.raw.close(); }
  });

  it('rejects readonly handles and execution audits that do not match the plan', async () => {
    const item = await fixture(1);
    try {
      const executionAudit = await execute(item.raw, item);
      const readonly = await openDatabaseAsync({ path: item.databasePath, readonly: true, fileMustExist: true });
      try {
        await expect(rollbackEventPayloadBackfill(readonly.raw, rollbackOptions(item, executionAudit))).rejects.toThrow('writable connection');
      } finally {
        readonly.raw.close();
      }
      await expect(rollbackEventPayloadBackfill(item.raw, {
        ...rollbackOptions(item, { ...executionAudit, databasePath: join(item.dir, 'other.db') }),
      })).rejects.toThrow('execution audit does not match the plan');
    } finally { item.raw.close(); }
  });

  it('rejects recovery database corruption', async () => {
    const item = await fixture(1);
    try {
      const executionAudit = await execute(item.raw, item);
      writeFileSync(executionAudit.recoverySet!.databasePath, 'corrupt recovery database');
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).rejects.toThrow();
    } finally { item.raw.close(); }
  });

  it('rejects recovery sidecar manifest and blob corruption', async () => {
    const manifestItem = await fixture(1, true);
    try {
      const executionAudit = await execute(manifestItem.raw, manifestItem);
      writeFileSync(executionAudit.recoverySet!.sidecars.manifestPath, '{"corrupt":true}\n');
      await expect(rollbackEventPayloadBackfill(manifestItem.raw, rollbackOptions(manifestItem, executionAudit))).rejects.toThrow();
    } finally { manifestItem.raw.close(); }

    const blobItem = await fixture(1, true);
    try {
      const executionAudit = await execute(blobItem.raw, blobItem);
      const reference = blobItem.sourceEnvelope![EVENT_PAYLOAD_ENVELOPE_KEY];
      writeFileSync(join(executionAudit.recoverySet!.sidecarRootDirectory, reference.relativePath), 'corrupt');
      await expect(rollbackEventPayloadBackfill(blobItem.raw, rollbackOptions(blobItem, executionAudit))).rejects.toThrow('sidecar size mismatch');
    } finally { blobItem.raw.close(); }
  });

  it('rejects rollback audit cursor, path, and execution-updatedAt tampering', async () => {
    const item = await fixture(2);
    try {
      const executionAudit = await execute(item.raw, item);
      const controller = new AbortController();
      const cancelled = await rollbackEventPayloadBackfill(item.raw, {
        ...rollbackOptions(item, executionAudit),
        batchSize: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      const persisted = JSON.parse(readFileSync(cancelled.auditPath, 'utf8')) as typeof cancelled;
      persisted.progress.nextCandidateIndex = 0;
      writeFileSync(cancelled.auditPath, `${JSON.stringify(persisted, null, 2)}\n`);
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).rejects.toThrow('audit does not match execution');

      persisted.progress.nextCandidateIndex = 1;
      persisted.auditPath = join(item.dir, 'other.rollback.audit.json');
      writeFileSync(cancelled.auditPath, `${JSON.stringify(persisted, null, 2)}\n`);
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).rejects.toThrow('audit does not match execution');

      persisted.auditPath = cancelled.auditPath;
      writeFileSync(cancelled.auditPath, `${JSON.stringify(persisted, null, 2)}\n`);
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, {
        ...executionAudit,
        updatedAt: '2026-08-02T23:59:59.000Z',
      }))).rejects.toThrow('audit does not match execution');
    } finally { item.raw.close(); }
  });

  it('rejects a processed rollback row that is changed back to the envelope before resume', async () => {
    const item = await fixture(2);
    try {
      const executionAudit = await execute(item.raw, item);
      const controller = new AbortController();
      await rollbackEventPayloadBackfill(item.raw, {
        ...rollbackOptions(item, executionAudit),
        batchSize: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      item.raw.prepare('UPDATE event SET payload_json = ? WHERE id = ?').run(
        JSON.stringify({
          [EVENT_PAYLOAD_ENVELOPE_KEY]: item.plan.candidates[0]!.destinationReference,
          projection: item.plan.candidates[0]!.projection,
        }),
        item.plan.candidates[0]!.eventId,
      );
      await expect(rollbackEventPayloadBackfill(item.raw, rollbackOptions(item, executionAudit))).rejects.toThrow('outside the exact');
    } finally { item.raw.close(); }
  });
});
