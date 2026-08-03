import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import {
  assertEventPayloadBackfillPlanFresh,
  assertEventPayloadBackfillPlanIntegrity,
  prepareEventPayloadBackfillPlan,
  readEventPayloadBackfillPlan,
  writeEventPayloadBackfillPlan,
} from './event-payload-backfill.js';
import { EVENT_PAYLOAD_ENVELOPE_KEY, EventPayloadSidecarStore } from './event-payload-sidecar.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture(): Promise<{
  dir: string;
  databasePath: string;
  sidecarRoot: string;
  raw: BetterSQLite3Raw;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-event-payload-backfill-'));
  tempDirs.push(dir);
  const databasePath = join(dir, 'sync-think.db');
  const sidecarRoot = join(dir, 'event-payloads');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  return { dir, databasePath, sidecarRoot, raw: connection.raw };
}

function insertEvent(
  raw: BetterSQLite3Raw,
  input: { id: string; sequence: number; payloadJson: string; type?: string },
): void {
  raw
    .prepare(
      `INSERT INTO event (
         id, workspace_id, run_id, category, type, sequence, occurred_at, payload_json
       ) VALUES (?, 'workspace-backfill', 'run-backfill', 'context', ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.type ?? 'context.packet.built',
      input.sequence,
      `2026-08-02T12:00:${String(input.sequence).padStart(2, '0')}.000Z`,
      input.payloadJson,
    );
}

function largePayload(packetId = 'packet-large'): string {
  return JSON.stringify({
    threadId: 'thread-1',
    packetId,
    proofHash: 'proof-1',
    modelId: 'model-1',
    providerModelId: 'provider-model-1',
    agentVersionId: 'agent-version-1',
    policyId: 'policy-1',
    tokenEstimate: 4096,
    summaries: ['sensitive-context-body'.repeat(256)],
    includedSources: [{ id: 'source-1', body: 'private-source'.repeat(64) }],
  });
}

describe('event payload exact backfill dry-run', () => {
  it('builds a deterministic exact Event/reference plan without changing SQLite or creating sidecars', async () => {
    const item = await fixture();
    try {
      const payloadJson = largePayload();
      insertEvent(item.raw, { id: 'event-b', sequence: 2, payloadJson });
      insertEvent(item.raw, { id: 'event-a', sequence: 1, payloadJson });
      insertEvent(item.raw, {
        id: 'event-small',
        sequence: 3,
        payloadJson: JSON.stringify({ packetId: 'small' }),
      });
      insertEvent(item.raw, {
        id: 'event-other',
        sequence: 4,
        type: 'run.started',
        payloadJson: largePayload('other-type'),
      });
      const before = item.raw
        .prepare('SELECT id, payload_json AS payloadJson FROM event ORDER BY id')
        .all();

      const first = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        now: new Date('2026-08-02T12:30:00.000Z'),
        planId: 'backfill-plan-fixed',
      });
      const second = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        now: new Date('2026-08-02T12:30:00.000Z'),
        planId: 'backfill-plan-fixed',
      });

      expect(second).toEqual(first);
      expect(first.mode).toBe('dry-run');
      expect(first.projectionBuilder).toEqual({
        id: 'context-packet-query-v1',
        version: 1,
      });
      expect(first.scan).toMatchObject({
        matchedEventCount: 3,
        inlineCandidateCount: 2,
        alreadyExternalizedCount: 0,
        belowThresholdCount: 1,
      });
      expect(first.candidates.map((candidate) => candidate.eventId)).toEqual([
        'event-a',
        'event-b',
      ]);
      expect(first.candidates[0]?.projection).toEqual({
        threadId: 'thread-1',
        packetId: 'packet-large',
        proofHash: 'proof-1',
        modelId: 'model-1',
        providerModelId: 'provider-model-1',
        agentVersionId: 'agent-version-1',
        policyId: 'policy-1',
        tokenEstimate: 4096,
      });
      expect(JSON.stringify(first)).not.toContain('sensitive-context-body');
      expect(first.candidates[0]?.destinationReference.sha256).toBe(
        first.candidates[1]?.destinationReference.sha256,
      );
      expect(first.estimates.sidecarReferencedStoredBytes).toBe(
        first.estimates.sidecarUniqueStoredBytes * 2,
      );
      expect(first.estimates.sidecarDeduplicatedStoredBytes).toBe(
        first.estimates.sidecarUniqueStoredBytes,
      );
      expect(first.estimates.logicalSqlitePayloadBytesReduced).toBeGreaterThan(0);
      expect(existsSync(item.sidecarRoot)).toBe(false);
      expect(
        item.raw.prepare('SELECT id, payload_json AS payloadJson FROM event ORDER BY id').all(),
      ).toEqual(before);
      assertEventPayloadBackfillPlanIntegrity(first);
      assertEventPayloadBackfillPlanFresh(item.raw, first);
    } finally {
      item.raw.close();
    }
  });

  it('reuses an already governed content hash and estimates zero new sidecar bytes', async () => {
    const item = await fixture();
    try {
      const payloadJson = largePayload('packet-shared');
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      const envelope = sidecar.writePayloadJson(payloadJson, {
        packetId: 'packet-shared',
        modelId: 'model-1',
      });
      insertEvent(item.raw, {
        id: 'event-externalized',
        sequence: 1,
        payloadJson: JSON.stringify(envelope),
      });
      insertEvent(item.raw, { id: 'event-inline', sequence: 2, payloadJson });

      const plan = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        now: new Date('2026-08-02T12:31:00.000Z'),
        planId: 'backfill-existing-reference',
      });

      expect(plan.scan).toMatchObject({
        matchedEventCount: 2,
        inlineCandidateCount: 1,
        alreadyExternalizedCount: 1,
        belowThresholdCount: 0,
      });
      expect(plan.candidates[0]?.destinationAlreadyReferenced).toBe(true);
      expect(plan.estimates.sidecarNewStoredBytes).toBe(0);
      expect(plan.candidates[0]?.destinationReference).toEqual(
        envelope[EVENT_PAYLOAD_ENVELOPE_KEY],
      );
      assertEventPayloadBackfillPlanFresh(item.raw, plan);
    } finally {
      item.raw.close();
    }
  });

  it('fails the stale source fence when an exact candidate payload changes without changing row count', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, {
        id: 'event-stale',
        sequence: 1,
        payloadJson: largePayload('before'),
      });
      const plan = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        planId: 'backfill-stale-source',
      });

      item.raw
        .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
        .run(largePayload('after'), 'event-stale');

      expect(() => assertEventPayloadBackfillPlanFresh(item.raw, plan)).toThrow(
        /database changed|source references changed/,
      );
    } finally {
      item.raw.close();
    }
  });

  it('fails the sidecar reference fence when the governed reference set changes', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, {
        id: 'event-inline',
        sequence: 1,
        payloadJson: largePayload('inline'),
      });
      const plan = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        planId: 'backfill-stale-sidecars',
      });
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      const envelope = sidecar.writePayloadJson(largePayload('externalized-later'), {
        packetId: 'externalized-later',
      });
      insertEvent(item.raw, {
        id: 'event-externalized-later',
        sequence: 2,
        payloadJson: JSON.stringify(envelope),
      });

      expect(() => assertEventPayloadBackfillPlanFresh(item.raw, plan)).toThrow(
        /database changed|sidecar references changed/,
      );
    } finally {
      item.raw.close();
    }
  });

  it('round-trips a hashed plan and rejects manifest tampering', async () => {
    const item = await fixture();
    try {
      insertEvent(item.raw, { id: 'event-plan', sequence: 1, payloadJson: largePayload('plan') });
      const plan = prepareEventPayloadBackfillPlan(item.raw, {
        databasePath: item.databasePath,
        sidecarRootDirectory: item.sidecarRoot,
        minimumPayloadBytes: 128,
        planId: 'backfill-round-trip',
      });
      const path = join(item.dir, 'plans', 'backfill.json');
      writeEventPayloadBackfillPlan(path, plan);
      expect(readEventPayloadBackfillPlan(path)).toEqual(plan);

      const tampered = structuredClone(plan);
      tampered.estimates.sidecarNewStoredBytes += 1;
      expect(() => assertEventPayloadBackfillPlanIntegrity(tampered)).toThrow(
        /byte estimates do not reconcile|plan hash mismatch/,
      );
    } finally {
      item.raw.close();
    }
  });
});
