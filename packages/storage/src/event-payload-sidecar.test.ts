import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventId, WorkspaceId } from '@sync-think/shared';
import {
  EVENT_PAYLOAD_ENVELOPE_KEY,
  EventPayloadSidecarStore,
  openDatabaseAsync,
  SqliteEventCheckpointStore,
} from './index.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeFixture(): { databasePath: string; sidecarRoot: string } {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-event-payload-'));
  tempDirs.push(directory);
  return {
    databasePath: join(directory, 'sync-think.db'),
    sidecarRoot: join(directory, 'event-payloads'),
  };
}

function eventDraft(id: string, payload: Record<string, unknown>) {
  return {
    id: id as EventId,
    workspaceId: 'workspace-payload' as WorkspaceId,
    category: 'context' as const,
    type: 'context.packet.built',
    occurredAt: '2026-08-02T00:00:00.000Z',
    payload,
  };
}

describe('EventPayloadSidecarStore', () => {
  it('keeps the default event store fully inline and backward compatible', async () => {
    const fixture = makeFixture();
    await runMigrations(fixture.databasePath);
    const connection = await openDatabaseAsync({ path: fixture.databasePath });
    try {
      const payload = { packetId: 'packet-inline', summaries: ['inline'] };
      const store = new SqliteEventCheckpointStore(connection.raw);
      store.commitTransition({ events: [eventDraft('event-inline', payload)] });

      const row = connection.raw
        .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
        .get('event-inline') as { payloadJson: string };
      expect(JSON.parse(row.payloadJson)).toEqual(payload);
      expect(store.listAllEvents(0)[0]?.payload).toEqual(payload);
      expect(existsSync(fixture.sidecarRoot)).toBe(false);
    } finally {
      connection.raw.close();
    }
  });

  it('externalizes selected large payloads while preserving a query-safe projection', async () => {
    const fixture = makeFixture();
    await runMigrations(fixture.databasePath);
    const connection = await openDatabaseAsync({ path: fixture.databasePath });
    try {
      const payload = {
        packetId: 'packet-sidecar',
        modelId: 'model-a',
        summaries: ['sensitive-large-body'.repeat(256)],
      };
      const sidecar = new EventPayloadSidecarStore(fixture.sidecarRoot);
      const store = new SqliteEventCheckpointStore(connection.raw, {
        sidecar,
        minimumBytes: 128,
        shouldExternalize: (event) => event.type === 'context.packet.built',
        project: (event) => ({
          packetId: event.payload.packetId,
          modelId: event.payload.modelId,
        }),
      });
      store.commitTransition({ events: [eventDraft('event-sidecar', payload)] });

      const row = connection.raw
        .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
        .get('event-sidecar') as { payloadJson: string };
      expect(row.payloadJson).not.toContain('sensitive-large-body');
      const envelope = JSON.parse(row.payloadJson) as Record<string, unknown>;
      expect(envelope.projection).toEqual({ packetId: 'packet-sidecar', modelId: 'model-a' });
      const reference = envelope[EVENT_PAYLOAD_ENVELOPE_KEY] as {
        version: number;
        sha256: string;
        relativePath: string;
        byteLength: number;
        storedByteLength: number;
      };
      expect(reference.version).toBe(1);
      expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(reference.byteLength).toBeGreaterThan(reference.storedByteLength);
      expect(existsSync(join(fixture.sidecarRoot, reference.relativePath))).toBe(true);
      expect(store.listEventsByRun('missing-run' as never)).toEqual([]);
      expect(store.listAllEvents(0)[0]?.payload).toEqual(payload);
    } finally {
      connection.raw.close();
    }
  });

  it('deduplicates immutable content by the uncompressed SHA-256 digest', async () => {
    const fixture = makeFixture();
    await runMigrations(fixture.databasePath);
    const connection = await openDatabaseAsync({ path: fixture.databasePath });
    try {
      const payload = { packetId: 'packet-shared', summaries: ['same'.repeat(128)] };
      const sidecar = new EventPayloadSidecarStore(fixture.sidecarRoot);
      const store = new SqliteEventCheckpointStore(connection.raw, {
        sidecar,
        minimumBytes: 1,
      });
      store.commitTransition({
        events: [eventDraft('event-shared-a', payload), eventDraft('event-shared-b', payload)],
      });

      const rows = connection.raw
        .prepare('SELECT payload_json AS payloadJson FROM event ORDER BY id')
        .all() as Array<{ payloadJson: string }>;
      const first = JSON.parse(rows[0].payloadJson)[EVENT_PAYLOAD_ENVELOPE_KEY] as {
        sha256: string;
        relativePath: string;
      };
      const second = JSON.parse(rows[1].payloadJson)[EVENT_PAYLOAD_ENVELOPE_KEY] as {
        sha256: string;
        relativePath: string;
      };
      expect(second).toEqual(first);
      expect(store.listAllEvents(0).map((event) => event.payload)).toEqual([payload, payload]);
    } finally {
      connection.raw.close();
    }
  });

  it('fails closed when an externalized payload is opened without its sidecar', async () => {
    const fixture = makeFixture();
    await runMigrations(fixture.databasePath);
    const connection = await openDatabaseAsync({ path: fixture.databasePath });
    try {
      const writer = new SqliteEventCheckpointStore(connection.raw, {
        sidecar: new EventPayloadSidecarStore(fixture.sidecarRoot),
        minimumBytes: 1,
      });
      writer.commitTransition({
        events: [eventDraft('event-needs-sidecar', { packetId: 'packet-required' })],
      });

      const reader = new SqliteEventCheckpointStore(connection.raw);
      expect(() => reader.listAllEvents(0)).toThrowError(
        expect.objectContaining({
          code: 'event-payload.sidecar-required',
        }),
      );
    } finally {
      connection.raw.close();
    }
  });

  it('detects missing or corrupted immutable payload bytes before hydration', async () => {
    const fixture = makeFixture();
    await runMigrations(fixture.databasePath);
    const connection = await openDatabaseAsync({ path: fixture.databasePath });
    try {
      const sidecar = new EventPayloadSidecarStore(fixture.sidecarRoot);
      const store = new SqliteEventCheckpointStore(connection.raw, {
        sidecar,
        minimumBytes: 1,
      });
      store.commitTransition({
        events: [
          eventDraft('event-corrupt', { packetId: 'packet-corrupt', body: 'x'.repeat(512) }),
        ],
      });
      const row = connection.raw
        .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
        .get('event-corrupt') as { payloadJson: string };
      const reference = JSON.parse(row.payloadJson)[EVENT_PAYLOAD_ENVELOPE_KEY] as {
        relativePath: string;
      };
      writeFileSync(join(fixture.sidecarRoot, reference.relativePath), 'corrupt');

      expect(() => store.listAllEvents(0)).toThrowError(
        expect.objectContaining({
          code: 'event-payload.corrupt',
        }),
      );
    } finally {
      connection.raw.close();
    }
  });
});
