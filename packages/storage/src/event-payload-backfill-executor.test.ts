import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import { prepareEventPayloadBackfillPlan } from './event-payload-backfill.js';
import {
  executeEventPayloadBackfill,
  expectedEventPayloadBackfillConfirmationToken,
  readEventPayloadBackfillAudit,
} from './event-payload-backfill-executor.js';
import { EVENT_PAYLOAD_ENVELOPE_KEY, EventPayloadSidecarStore } from './event-payload-sidecar.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture(count = 3): Promise<{
  dir: string;
  databasePath: string;
  sidecarRoot: string;
  auditPath: string;
  raw: BetterSQLite3Raw;
  payloads: string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-event-backfill-executor-'));
  tempDirs.push(dir);
  const databasePath = join(dir, 'sync-think.db');
  const sidecarRoot = join(dir, 'event-payloads');
  const auditPath = join(dir, 'audit.json');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const payloads: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const payloadJson = JSON.stringify({
      threadId: 'thread-1',
      packetId: index < 2 ? 'shared-packet' : `packet-${index}`,
      proofHash: `proof-${index}`,
      tokenEstimate: 1000 + index,
      body: (index < 2 ? 'shared-body' : `body-${index}`).repeat(300),
    });
    payloads.push(payloadJson);
    connection.raw
      .prepare(
        `INSERT INTO event (
          id, workspace_id, run_id, category, type, sequence, occurred_at, payload_json
        ) VALUES (?, 'workspace-1', 'run-1', 'context', 'context.packet.built', ?, ?, ?)`,
      )
      .run(
        `event-${index}`,
        index + 1,
        `2026-08-02T10:00:${String(index).padStart(2, '0')}.000Z`,
        payloadJson,
      );
  }
  return { dir, databasePath, sidecarRoot, auditPath, raw: connection.raw, payloads };
}

function prepare(item: Awaited<ReturnType<typeof fixture>>, planId = 'backfill-execute') {
  return prepareEventPayloadBackfillPlan(item.raw, {
    databasePath: item.databasePath,
    sidecarRootDirectory: item.sidecarRoot,
    minimumPayloadBytes: 128,
    planId,
    now: new Date('2026-08-02T10:30:00.000Z'),
  });
}

function executionOptions(
  plan: ReturnType<typeof prepareEventPayloadBackfillPlan>,
  auditPath: string,
) {
  return {
    plan,
    auditPath,
    confirmationToken: expectedEventPayloadBackfillConfirmationToken(plan),
    maintenanceWindowConfirmed: true,
  } as const;
}

describe('event payload backfill durable executor', () => {
  it('externalizes exact envelopes in durable batches and verifies the portable recovery set', async () => {
    const item = await fixture(4);
    try {
      const plan = prepare(item);
      const audit = await executeEventPayloadBackfill(item.raw, {
        ...executionOptions(plan, item.auditPath),
        batchSize: 2,
      });

      expect(audit.status).toBe('completed');
      expect(audit.progress).toMatchObject({
        candidateCount: 4,
        nextCandidateIndex: 4,
        rowsConverted: 4,
        rowsAlreadyConverted: 0,
        batchesCommitted: 2,
      });
      expect(audit.recoverySet?.quickCheck).toBe('ok');
      expect(existsSync(audit.recoverySet!.databasePath)).toBe(true);
      expect(existsSync(audit.recoverySet!.sidecarRootDirectory)).toBe(true);

      const rows = item.raw
        .prepare('SELECT id, payload_json AS payloadJson FROM event ORDER BY id')
        .all() as Array<{ id: string; payloadJson: string }>;
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      for (const [index, row] of rows.entries()) {
        const envelope = JSON.parse(row.payloadJson) as Record<string, unknown>;
        expect(envelope).toEqual({
          [EVENT_PAYLOAD_ENVELOPE_KEY]: plan.candidates[index]!.destinationReference,
          projection: plan.candidates[index]!.projection,
        });
        expect(sidecar.resolveEnvelope(envelope)).toEqual(JSON.parse(item.payloads[index]!));
      }

      const backup = await openDatabaseAsync({
        path: audit.recoverySet!.databasePath,
        readonly: true,
        fileMustExist: true,
      });
      try {
        const backupRows = backup.raw
          .prepare('SELECT payload_json AS payloadJson FROM event ORDER BY id')
          .all() as Array<{ payloadJson: string }>;
        expect(backupRows.map((row) => row.payloadJson)).toEqual(item.payloads);
      } finally {
        backup.raw.close();
      }

      const repeated = await executeEventPayloadBackfill(
        item.raw,
        executionOptions(plan, item.auditPath),
      );
      expect(repeated).toEqual(audit);
    } finally {
      item.raw.close();
    }
  });

  it('cancels only at a batch boundary and resumes from the durable cursor', async () => {
    const item = await fixture(3);
    try {
      const plan = prepare(item, 'backfill-cancel');
      const controller = new AbortController();
      const cancelled = await executeEventPayloadBackfill(item.raw, {
        ...executionOptions(plan, item.auditPath),
        batchSize: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.progress).toMatchObject({
        nextCandidateIndex: 1,
        rowsConverted: 1,
        batchesCommitted: 1,
      });

      const completed = await executeEventPayloadBackfill(item.raw, {
        ...executionOptions(plan, item.auditPath),
        batchSize: 2,
      });
      expect(completed.status).toBe('completed');
      expect(completed.progress).toMatchObject({
        nextCandidateIndex: 3,
        rowsConverted: 3,
        rowsAlreadyConverted: 0,
        batchesCommitted: 2,
      });
    } finally {
      item.raw.close();
    }
  });

  it('recovers idempotently when SQLite commits before the audit cursor is persisted', async () => {
    const item = await fixture(3);
    try {
      const plan = prepare(item, 'backfill-crash-window');
      await expect(
        executeEventPayloadBackfill(item.raw, {
          ...executionOptions(plan, item.auditPath),
          batchSize: 2,
          onBatchDatabaseCommitted: () => {
            throw new Error('simulated crash after sqlite commit');
          },
        }),
      ).rejects.toThrow('simulated crash');

      const failed = readEventPayloadBackfillAudit(item.auditPath);
      expect(failed.status).toBe('failed');
      expect(failed.progress.nextCandidateIndex).toBe(0);

      const completed = await executeEventPayloadBackfill(item.raw, {
        ...executionOptions(plan, item.auditPath),
        batchSize: 2,
      });
      expect(completed.status).toBe('completed');
      expect(completed.progress).toMatchObject({
        nextCandidateIndex: 3,
        rowsConverted: 1,
        rowsAlreadyConverted: 2,
        batchesCommitted: 2,
      });
    } finally {
      item.raw.close();
    }
  });

  it('fails closed when source, processed envelopes, sidecars, or recovery data drift', async () => {
    const sourceDrift = await fixture(1);
    try {
      const plan = prepare(sourceDrift, 'backfill-source-drift');
      sourceDrift.raw
        .prepare("UPDATE event SET payload_json = '{\"changed\":true}' WHERE id = 'event-0'")
        .run();
      await expect(
        executeEventPayloadBackfill(
          sourceDrift.raw,
          executionOptions(plan, sourceDrift.auditPath),
        ),
      ).rejects.toThrow(/changed after|source references changed/);
    } finally {
      sourceDrift.raw.close();
    }

    const resumeDrift = await fixture(2);
    try {
      const plan = prepare(resumeDrift, 'backfill-resume-drift');
      const controller = new AbortController();
      await executeEventPayloadBackfill(resumeDrift.raw, {
        ...executionOptions(plan, resumeDrift.auditPath),
        batchSize: 1,
        signal: controller.signal,
        onBatchCommitted: () => controller.abort(),
      });
      resumeDrift.raw
        .prepare("UPDATE event SET payload_json = '{\"changed\":true}' WHERE id = 'event-0'")
        .run();
      await expect(
        executeEventPayloadBackfill(
          resumeDrift.raw,
          executionOptions(plan, resumeDrift.auditPath),
        ),
      ).rejects.toThrow('processed Event event-0');
    } finally {
      resumeDrift.raw.close();
    }

    const recoveryDrift = await fixture(1);
    try {
      const plan = prepare(recoveryDrift, 'backfill-recovery-drift');
      const audit = await executeEventPayloadBackfill(
        recoveryDrift.raw,
        executionOptions(plan, recoveryDrift.auditPath),
      );
      writeFileSync(audit.recoverySet!.databasePath, 'corrupt');
      await expect(
        executeEventPayloadBackfill(
          recoveryDrift.raw,
          executionOptions(plan, recoveryDrift.auditPath),
        ),
      ).rejects.toThrow();
    } finally {
      recoveryDrift.raw.close();
    }
  });

  it('rejects missing confirmation, maintenance windows, audit mismatches, and readonly handles', async () => {
    const item = await fixture(1);
    try {
      const plan = prepare(item, 'backfill-fences');
      await expect(
        executeEventPayloadBackfill(item.raw, {
          plan,
          auditPath: item.auditPath,
          confirmationToken: 'wrong',
          maintenanceWindowConfirmed: true,
        }),
      ).rejects.toThrow('explicit confirmation did not match');
      await expect(
        executeEventPayloadBackfill(item.raw, {
          plan,
          auditPath: item.auditPath,
          confirmationToken: expectedEventPayloadBackfillConfirmationToken(plan),
          maintenanceWindowConfirmed: false,
        }),
      ).rejects.toThrow('offline maintenance window');

      const readonly = await openDatabaseAsync({
        path: item.databasePath,
        readonly: true,
        fileMustExist: true,
      });
      try {
        await expect(
          executeEventPayloadBackfill(
            readonly.raw,
            executionOptions(plan, item.auditPath),
          ),
        ).rejects.toThrow('writable connection');
      } finally {
        readonly.raw.close();
      }

      const auditPath = join(item.dir, 'mismatch.audit.json');
      writeFileSync(
        auditPath,
        JSON.stringify({
          version: 1,
          planId: 'different',
          planHash: plan.planHash,
          databasePath: plan.databasePath,
          sidecarRootDirectory: plan.sidecarRootDirectory,
          auditPath,
          status: 'failed',
          startedAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          progress: {
            candidateCount: 1,
            nextCandidateIndex: 0,
            rowsConverted: 0,
            rowsAlreadyConverted: 0,
            batchesCommitted: 0,
            uniqueDestinationReferencesVerified: 0,
          },
        }),
      );
      await expect(
        executeEventPayloadBackfill(item.raw, executionOptions(plan, auditPath)),
      ).rejects.toThrow('audit does not match');
      expect(readFileSync(auditPath, 'utf8')).toContain('different');
    } finally {
      item.raw.close();
    }
  });
});
