import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import {
  captureEventPayloadSidecarManifest,
  createEventPayloadSidecarBackup,
  readEventPayloadSidecarBackupManifest,
  verifyEventPayloadSidecarBackup,
} from './event-payload-backup.js';
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
  connection: Awaited<ReturnType<typeof openDatabaseAsync>>;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-event-payload-backup-'));
  tempDirs.push(dir);
  const databasePath = join(dir, 'sync-think.db');
  const sidecarRoot = join(dir, 'event-payloads');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  return { dir, databasePath, sidecarRoot, connection };
}

function insertEnvelope(
  raw: Awaited<ReturnType<typeof openDatabaseAsync>>['raw'],
  sidecar: EventPayloadSidecarStore,
  id: string,
  sequence: number,
  payload: Record<string, unknown>,
): void {
  const envelope = sidecar.writePayloadJson(JSON.stringify(payload), {
    packetId: payload.packetId,
  });
  raw
    .prepare(
      `INSERT INTO event (
         id, workspace_id, run_id, category, type, sequence, occurred_at, payload_json
       ) VALUES (?, 'workspace-sidecar-backup', 'run-sidecar-backup', 'system',
                 'context.packet.built', ?, ?, ?)`,
    )
    .run(id, sequence, `2026-08-02T12:00:0${sequence}.000Z`, JSON.stringify(envelope));
}

describe('event payload sidecar backup manifest', () => {
  it('captures an exact ordered reference hash and deduplicated immutable blob list', async () => {
    const item = await fixture();
    try {
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      const payload = { packetId: 'packet-shared', body: 'same'.repeat(256) };
      insertEnvelope(item.connection.raw, sidecar, 'event-b', 2, payload);
      insertEnvelope(item.connection.raw, sidecar, 'event-a', 1, payload);

      const manifest = captureEventPayloadSidecarManifest(item.connection.raw, item.sidecarRoot);

      expect(manifest).toMatchObject({
        version: 1,
        sourceRootDirectory: item.sidecarRoot,
        eventReferenceCount: 2,
      });
      expect(manifest.referenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.blobs).toHaveLength(1);
      expect(manifest.blobs[0]).toMatchObject({ referenceCount: 2 });
      expect(manifest.blobs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      item.connection.raw.close();
    }
  });

  it('requires the configured source root when the database contains sidecar references', async () => {
    const item = await fixture();
    try {
      insertEnvelope(
        item.connection.raw,
        new EventPayloadSidecarStore(item.sidecarRoot),
        'event-root-required',
        1,
        { packetId: 'packet-root-required' },
      );
      expect(() => captureEventPayloadSidecarManifest(item.connection.raw)).toThrow(
        'sidecar root is required',
      );
    } finally {
      item.connection.raw.close();
    }
  });

  it('copies an exact portable blob set and verifies every backup database reference', async () => {
    const item = await fixture();
    try {
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      insertEnvelope(item.connection.raw, sidecar, 'event-copy', 1, {
        packetId: 'packet-copy',
        body: 'payload'.repeat(256),
      });
      const expected = captureEventPayloadSidecarManifest(item.connection.raw, item.sidecarRoot);
      const databaseBackupPath = join(item.dir, 'recovery.backup.db');
      await item.connection.raw.backup(databaseBackupPath);
      const backupRoot = join(item.dir, 'recovery.backup.db.sidecars');

      const created = createEventPayloadSidecarBackup(expected, backupRoot);
      expect(created.eventReferenceCount).toBe(1);
      expect(created.blobCount).toBe(1);
      expect(created.storedBytes).toBeGreaterThan(0);
      expect(existsSync(created.manifestPath)).toBe(true);
      expect(readEventPayloadSidecarBackupManifest(created.manifestPath).manifestHash).toBe(
        created.manifestHash,
      );

      const backupConnection = await openDatabaseAsync({
        path: databaseBackupPath,
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(
          verifyEventPayloadSidecarBackup(backupConnection.raw, expected, backupRoot),
        ).toMatchObject({ eventReferenceCount: 1, blobCount: 1 });
      } finally {
        backupConnection.raw.close();
      }
    } finally {
      item.connection.raw.close();
    }
  });

  it('fails closed when a copied recovery blob is corrupted', async () => {
    const item = await fixture();
    try {
      const sidecar = new EventPayloadSidecarStore(item.sidecarRoot);
      insertEnvelope(item.connection.raw, sidecar, 'event-corrupt-backup', 1, {
        packetId: 'packet-corrupt-backup',
        body: 'payload'.repeat(256),
      });
      const expected = captureEventPayloadSidecarManifest(item.connection.raw, item.sidecarRoot);
      const databaseBackupPath = join(item.dir, 'recovery-corrupt.backup.db');
      await item.connection.raw.backup(databaseBackupPath);
      const backupRoot = join(item.dir, 'recovery-corrupt.backup.db.sidecars');
      createEventPayloadSidecarBackup(expected, backupRoot);
      const blob = expected.blobs[0];
      expect(blob).toBeDefined();
      writeFileSync(join(backupRoot, blob!.relativePath), 'corrupt');

      const backupConnection = await openDatabaseAsync({
        path: databaseBackupPath,
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(() =>
          verifyEventPayloadSidecarBackup(backupConnection.raw, expected, backupRoot),
        ).toThrow('sidecar size mismatch');
      } finally {
        backupConnection.raw.close();
      }
    } finally {
      item.connection.raw.close();
    }
  });

  it('detects invalid envelope metadata during the exact database scan', async () => {
    const item = await fixture();
    try {
      item.connection.raw
        .prepare(
          `INSERT INTO event (
             id, workspace_id, category, type, sequence, occurred_at, payload_json
           ) VALUES ('event-invalid-envelope', 'workspace-sidecar-backup', 'system',
                     'context.packet.built', 1, '2026-08-02T12:00:01.000Z', ?)`,
        )
        .run(
          JSON.stringify({
            [EVENT_PAYLOAD_ENVELOPE_KEY]: { version: 999 },
            projection: {},
          }),
        );

      expect(() =>
        captureEventPayloadSidecarManifest(item.connection.raw, item.sidecarRoot),
      ).toThrow('unsupported version');
    } finally {
      item.connection.raw.close();
    }
  });
});
