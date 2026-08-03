import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { prepareEventPayloadBackfillPlan } from './event-payload-backfill.js';
import { executeEventPayloadBackfill, expectedEventPayloadBackfillConfirmationToken } from './event-payload-backfill-executor.js';
import { expectedEventPayloadBackfillRollbackConfirmationToken, rollbackEventPayloadBackfill } from './event-payload-backfill-rollback.js';
import {
  executeEventPayloadSidecarGc,
  expectedEventPayloadSidecarGcConfirmationToken,
  prepareEventPayloadSidecarGcManifest,
  readEventPayloadSidecarGcManifest,
  writeEventPayloadSidecarGcManifest,
  type EventPayloadSidecarGcAudit,
} from './event-payload-sidecar-gc.js';
import { EVENT_PAYLOAD_ENVELOPE_KEY, EventPayloadSidecarStore } from './event-payload-sidecar.js';
import { runMigrations } from './scripts/migrate.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-sidecar-gc-'));
  dirs.push(dir);
  const databasePath = join(dir, 'sync-think.db');
  const sidecarRootDirectory = join(dir, 'event-payloads');
  await runMigrations(databasePath);
  const { raw } = await openDatabaseAsync({ path: databasePath });
  const store = new EventPayloadSidecarStore(sidecarRootDirectory);
  const live = store.writePayloadJson(JSON.stringify({ packetId: 'live', body: 'live'.repeat(128) }), { packetId: 'live' });
  raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES ('event-live-a', 'ws', 'context', 'context.packet.built', 1, '2026-08-02T12:00:00.000Z', ?)`).run(JSON.stringify(live));
  raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES ('event-live-b', 'ws', 'context', 'context.packet.built', 2, '2026-08-02T12:00:01.000Z', ?)`).run(JSON.stringify(live));
  const orphanA = store.writePayloadJson(JSON.stringify({ packetId: 'orphan-a', body: 'a'.repeat(256) }));
  const orphanB = store.writePayloadJson(JSON.stringify({ packetId: 'orphan-b', body: 'b'.repeat(256) }));
  return { dir, databasePath, sidecarRootDirectory, raw, store, live, orphanA, orphanB };
}

function options(item: Awaited<ReturnType<typeof fixture>>, manifest: ReturnType<typeof prepareEventPayloadSidecarGcManifest>) {
  return {
    manifest,
    confirmationToken: expectedEventPayloadSidecarGcConfirmationToken(manifest),
    maintenanceWindowConfirmed: true,
    auditPath: join(item.dir, 'sidecar-gc.audit.json'),
  } as const;
}

describe('event payload sidecar orphan mark and quarantine sweep', () => {
  it('marks exact orphans read-only while hydrating deduplicated live references', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-read-only' });
      expect(manifest.liveReferences).toMatchObject({ eventReferenceCount: 2 });
      expect(manifest.liveReferences.blobs).toHaveLength(1);
      expect(manifest.orphans.map((entry) => entry.sha256).sort()).toEqual([
        item.orphanA[EVENT_PAYLOAD_ENVELOPE_KEY].sha256,
        item.orphanB[EVENT_PAYLOAD_ENVELOPE_KEY].sha256,
      ].sort());
      expect(existsSync(join(item.sidecarRootDirectory, item.orphanA[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath))).toBe(true);
      const path = join(item.dir, 'sidecar-gc.json');
      writeEventPayloadSidecarGcManifest(path, manifest);
      expect(readEventPayloadSidecarGcManifest(path)).toEqual(manifest);
    } finally { item.raw.close(); }
  });

  it('quarantines only manifest orphans and preserves live deduplicated blobs', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-exact' });
      const audit = await executeEventPayloadSidecarGc(item.raw, { ...options(item, manifest), batchSize: 1 });
      expect(audit.status).toBe('completed');
      expect(audit.progress).toMatchObject({ nextOrphanIndex: 2, blobsQuarantined: 2, blobsAlreadyQuarantined: 0, batchesCommitted: 2 });
      expect(existsSync(join(item.sidecarRootDirectory, item.live[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath))).toBe(true);
      for (const orphan of manifest.orphans) {
        expect(existsSync(join(item.sidecarRootDirectory, orphan.relativePath))).toBe(false);
        expect(existsSync(join(audit.quarantineDirectory, orphan.relativePath))).toBe(true);
      }
      expect(await executeEventPayloadSidecarGc(item.raw, options(item, manifest))).toEqual(audit);
    } finally { item.raw.close(); }
  });

  it('resumes idempotently across move/audit and cancellation boundaries', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-resume' });
      await expect(executeEventPayloadSidecarGc(item.raw, { ...options(item, manifest), batchSize: 1, onBatchFilesMoved: () => { throw new Error('sweep crash'); } })).rejects.toThrow('sweep crash');
      const controller = new AbortController();
      const cancelled = await executeEventPayloadSidecarGc(item.raw, { ...options(item, manifest), batchSize: 1, signal: controller.signal, onBatchCommitted: () => controller.abort() });
      expect(cancelled.status).toBe('cancelled');
      const completed = await executeEventPayloadSidecarGc(item.raw, options(item, manifest));
      expect(completed.status).toBe('completed');
      expect(completed.progress.blobsAlreadyQuarantined).toBeGreaterThanOrEqual(1);
      expect(completed.progress.bytesQuarantined).toBe(
        manifest.orphans.reduce((total, entry) => total + entry.storedByteLength, 0),
      );
    } finally { item.raw.close(); }
  });

  it('completes an empty exact plan without moving files', async () => {
    const item = await fixture();
    try {
      rmSync(join(item.sidecarRootDirectory, item.orphanA[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath));
      rmSync(join(item.sidecarRootDirectory, item.orphanB[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath));
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-empty',
      });
      expect(manifest.orphans).toEqual([]);
      const audit = await executeEventPayloadSidecarGc(item.raw, options(item, manifest));
      expect(audit.status).toBe('completed');
      expect(audit.progress).toEqual({
        orphanCount: 0, nextOrphanIndex: 0, blobsQuarantined: 0, blobsAlreadyQuarantined: 0,
        bytesQuarantined: 0, batchesCommitted: 0,
      });
    } finally { item.raw.close(); }
  });

  it('leaves a newly created managed orphan outside the exact marked set', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-new-orphan',
      });
      const later = item.store.writePayloadJson(JSON.stringify({ packetId: 'later', body: 'later'.repeat(128) }));
      const audit = await executeEventPayloadSidecarGc(item.raw, options(item, manifest));
      expect(audit.status).toBe('completed');
      expect(existsSync(join(item.sidecarRootDirectory, later[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath))).toBe(true);
    } finally { item.raw.close(); }
  });

  it('rejects a quarantine junction introduced after mark', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-late-junction',
      });
      const outside = join(item.dir, 'outside-late-quarantine');
      mkdirSync(outside);
      symlinkSync(outside, join(item.sidecarRootDirectory, '.quarantine'), 'junction');
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('plain directory');
    } finally { item.raw.close(); }
  });

  it('rejects tampered audit progress, completion state, and timestamps', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-audit-tamper',
      });
      const controller = new AbortController();
      const executeOptions = { ...options(item, manifest), batchSize: 1, signal: controller.signal, onBatchCommitted: () => controller.abort() };
      await executeEventPayloadSidecarGc(item.raw, executeOptions);
      const auditPath = options(item, manifest).auditPath;
      const original = JSON.parse(readFileSync(auditPath, 'utf8')) as EventPayloadSidecarGcAudit;

      const badBytes = structuredClone(original);
      badBytes.progress.bytesQuarantined += 1;
      writeFileSync(auditPath, `${JSON.stringify(badBytes, null, 2)}\n`);
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('audit does not match');

      const badCompletion = structuredClone(original);
      badCompletion.status = 'completed';
      badCompletion.completedAt = badCompletion.updatedAt;
      writeFileSync(auditPath, `${JSON.stringify(badCompletion, null, 2)}\n`);
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('audit does not match');

      const badTimestamp = structuredClone(original);
      badTimestamp.updatedAt = 'not-a-date';
      writeFileSync(auditPath, `${JSON.stringify(badTimestamp, null, 2)}\n`);
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('audit does not match');
    } finally { item.raw.close(); }
  });

  it('rejects unsafe sweep identifiers before any audit or quarantine path is derived', async () => {
    const item = await fixture();
    try {
      for (const sweepId of ['..', '../outside', '..\\..\\outside', 'nested/path', 'C:\\outside']) {
        expect(() => prepareEventPayloadSidecarGcManifest(item.raw, {
          databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId,
        })).toThrow('metadata is invalid');
      }
    } finally { item.raw.close(); }
  });

  it('rejects a self-consistent manifest that classifies a live blob as orphan before moving it', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-live-overlap',
      });
      const reference = item.live[EVENT_PAYLOAD_ENVELOPE_KEY];
      const livePath = join(item.sidecarRootDirectory, reference.relativePath);
      const stored = readFileSync(livePath);
      const modifiedAtMs = statSync(livePath).mtimeMs;
      manifest.orphans = [{
        ...reference, storedSha256: createHash('sha256').update(stored).digest('hex'),
        modifiedAtMs,
      }];
      const unsigned = {
        version: manifest.version, sweepId: manifest.sweepId, generatedAt: manifest.generatedAt,
        databasePath: manifest.databasePath, sidecarRootDirectory: manifest.sidecarRootDirectory,
        sourceFingerprint: manifest.sourceFingerprint, liveReferences: manifest.liveReferences,
        liveReferencesHash: manifest.liveReferencesHash, orphans: manifest.orphans,
      };
      manifest.manifestHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      manifest.confirmationToken = expectedEventPayloadSidecarGcConfirmationToken(manifest);
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('orphan identity is invalid');
      expect(existsSync(livePath)).toBe(true);
    } finally { item.raw.close(); }
  });

  it('rejects unknown layout introduced after mark before moving any orphan', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, {
        databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-late-unknown',
      });
      writeFileSync(join(item.sidecarRootDirectory, 'unknown.bin'), 'unknown');
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('uncontrolled entry');
      for (const orphan of manifest.orphans) {
        expect(existsSync(join(item.sidecarRootDirectory, orphan.relativePath))).toBe(true);
      }
    } finally { item.raw.close(); }
  });

  it('fails freshness when a marked orphan becomes referenced', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-stale-reference' });
      rawInsert(item.raw, 'event-new-reference', 3, item.orphanA);
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow('database changed');
    } finally { item.raw.close(); }
  });

  it('fails closed when an orphan identity changes after mark', async () => {
    const item = await fixture();
    try {
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-mutated' });
      writeFileSync(join(item.sidecarRootDirectory, manifest.orphans[0]!.relativePath), 'corrupt');
      await expect(executeEventPayloadSidecarGc(item.raw, options(item, manifest))).rejects.toThrow();
    } finally { item.raw.close(); }
  });

  it('fails closed when a currently referenced blob is missing or corrupt', async () => {
    const missing = await fixture();
    try {
      rmSync(join(missing.sidecarRootDirectory, missing.live[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath));
      expect(() => prepareEventPayloadSidecarGcManifest(missing.raw, { databasePath: missing.databasePath, sidecarRootDirectory: missing.sidecarRootDirectory })).toThrow('missing');
    } finally { missing.raw.close(); }

    const corrupt = await fixture();
    try {
      writeFileSync(join(corrupt.sidecarRootDirectory, corrupt.live[EVENT_PAYLOAD_ENVELOPE_KEY].relativePath), 'corrupt');
      expect(() => prepareEventPayloadSidecarGcManifest(corrupt.raw, { databasePath: corrupt.databasePath, sidecarRootDirectory: corrupt.sidecarRootDirectory })).toThrow('size mismatch');
    } finally { corrupt.raw.close(); }
  });

  it('marks destination blobs orphaned by an exact backfill rollback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-sidecar-gc-rollback-'));
    dirs.push(dir);
    const databasePath = join(dir, 'sync-think.db');
    const sidecarRootDirectory = join(dir, 'event-payloads');
    await runMigrations(databasePath);
    const { raw } = await openDatabaseAsync({ path: databasePath });
    try {
      const payload = JSON.stringify({ threadId: 'thread', packetId: 'rollback-orphan', body: 'body'.repeat(512) });
      raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES ('event-rollback-orphan', 'ws', 'context', 'context.packet.built', 1, '2026-08-02T12:30:00.000Z', ?)`).run(payload);
      const plan = prepareEventPayloadBackfillPlan(raw, { databasePath, sidecarRootDirectory, minimumPayloadBytes: 128, planId: 'gc-rollback-plan' });
      const executionAudit = await executeEventPayloadBackfill(raw, {
        plan, confirmationToken: expectedEventPayloadBackfillConfirmationToken(plan),
        maintenanceWindowConfirmed: true, auditPath: join(dir, 'execute.audit.json'),
      });
      await rollbackEventPayloadBackfill(raw, {
        plan, executionAudit, confirmationToken: expectedEventPayloadBackfillRollbackConfirmationToken(plan),
        maintenanceWindowConfirmed: true, auditPath: join(dir, 'rollback.audit.json'),
      });
      const manifest = prepareEventPayloadSidecarGcManifest(raw, { databasePath, sidecarRootDirectory, sweepId: 'sweep-rollback-orphan' });
      expect(manifest.orphans).toHaveLength(1);
      expect(manifest.orphans[0]!.sha256).toBe(plan.candidates[0]!.destinationReference.sha256);
    } finally { raw.close(); }
  });

  it('rejects links or reparse points in controlled layout slots', async () => {
    const item = await fixture();
    try {
      const outside = join(item.dir, 'outside-quarantine');
      mkdirSync(outside);
      symlinkSync(outside, join(item.sidecarRootDirectory, '.quarantine'), 'junction');
      expect(() => prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory })).toThrow('plain directory');
    } finally { item.raw.close(); }
  });

  it('rejects uncontrolled layouts and manifest tampering', async () => {
    const item = await fixture();
    try {
      writeFileSync(join(item.sidecarRootDirectory, 'unknown.bin'), 'unknown');
      expect(() => prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory })).toThrow('uncontrolled entry');
      rmSync(join(item.sidecarRootDirectory, 'unknown.bin'));
      const manifest = prepareEventPayloadSidecarGcManifest(item.raw, { databasePath: item.databasePath, sidecarRootDirectory: item.sidecarRootDirectory, sweepId: 'sweep-tamper' });
      const path = join(item.dir, 'tampered.json');
      writeEventPayloadSidecarGcManifest(path, manifest);
      const tampered = JSON.parse(readFileSync(path, 'utf8')) as typeof manifest;
      tampered.orphans[0]!.relativePath = '../escape.json.gz';
      writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
      expect(() => readEventPayloadSidecarGcManifest(path)).toThrow();
    } finally { item.raw.close(); }
  });
});

function rawInsert(raw: Awaited<ReturnType<typeof fixture>>['raw'], id: string, sequence: number, envelope: unknown): void {
  raw.prepare(`INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES (?, 'ws', 'context', 'context.packet.built', ?, '2026-08-02T12:00:02.000Z', ?)`).run(id, sequence, JSON.stringify(envelope));
}
