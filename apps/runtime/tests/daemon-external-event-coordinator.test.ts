import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteExternalEventStore } from '@sync-think/storage';
import type { ExternalEventEnvelope } from '@sync-think/shared';
import { ExternalEventCoordinator } from '../src/daemon/external-event-coordinator.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-event-coordinator-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteExternalEventStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

const event: ExternalEventEnvelope = {
  id: 'evt-1',
  dedupeKey: 'github:delivery-1',
  source: { kind: 'git', name: 'github' },
  instruction: 'review push',
  target: { kind: 'model', modelId: 'model-1' },
  skillVersionIds: [],
};

describe('ExternalEventCoordinator', () => {
  it('claims, dispatches and binds the Runtime run to the active lease', async () => {
    const { store, close } = await setup();
    try {
      const dispatch = vi.fn(async () => ({ ok: true, accepted: true, runId: 'run-1' }));
      const coordinator = new ExternalEventCoordinator({
        store,
        ownerId: 'daemon-1',
        now: () => new Date('2026-08-21T00:00:00.000Z'),
        leaseMs: 30_000,
        createToken: () => 'lease-1',
        dispatch,
      });

      expect(coordinator.submit(event)).toMatchObject({ created: true });
      await expect(coordinator.pumpOnce()).resolves.toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(store.get('evt-1')).toMatchObject({
        state: 'leased',
        leaseToken: 'lease-1',
        runId: 'run-1',
      });
    } finally {
      close();
    }
  });

  it('requeues a rejected dispatch and lets an expired lease move to a new owner', async () => {
    const { store, close } = await setup();
    try {
      let now = new Date('2026-08-21T00:00:00.000Z');
      const firstDispatch = vi.fn(async () => ({
        ok: true,
        accepted: false,
        reason: 'runtime-busy',
      }));
      const first = new ExternalEventCoordinator({
        store,
        ownerId: 'daemon-1',
        now: () => now,
        leaseMs: 10_000,
        createToken: () => 'lease-1',
        dispatch: firstDispatch,
      });
      first.submit(event);
      await first.pumpOnce();
      expect(store.get('evt-1')).toMatchObject({ state: 'pending', attemptCount: 1 });

      const acceptedDispatch = vi.fn(async () => ({ ok: true, accepted: true, runId: 'run-a' }));
      const accepted = new ExternalEventCoordinator({
        store,
        ownerId: 'daemon-1',
        now: () => now,
        leaseMs: 10_000,
        createToken: () => 'lease-a',
        dispatch: acceptedDispatch,
      });
      await accepted.pumpOnce();

      now = new Date('2026-08-21T00:00:12.000Z');
      const takeoverDispatch = vi.fn(async () => ({ ok: true, accepted: true, runId: 'run-b' }));
      const takeover = new ExternalEventCoordinator({
        store,
        ownerId: 'daemon-2',
        now: () => now,
        leaseMs: 10_000,
        createToken: () => 'lease-b',
        dispatch: takeoverDispatch,
      });
      await takeover.pumpOnce();

      expect(takeoverDispatch).toHaveBeenCalledTimes(1);
      expect(store.get('evt-1')).toMatchObject({
        leaseOwner: 'daemon-2',
        leaseToken: 'lease-b',
        runId: 'run-b',
        attemptCount: 3,
      });
    } finally {
      close();
    }
  });

  it('uses the fencing token for heartbeat and terminal completion', async () => {
    const { store, close } = await setup();
    try {
      const coordinator = new ExternalEventCoordinator({
        store,
        ownerId: 'daemon-1',
        now: () => new Date('2026-08-21T00:00:00.000Z'),
        leaseMs: 30_000,
        createToken: () => 'lease-1',
        dispatch: async () => ({ ok: true, accepted: true, runId: 'run-1' }),
      });
      coordinator.submit(event);
      await coordinator.pumpOnce();

      expect(
        coordinator.heartbeat({ eventId: 'evt-1', leaseToken: 'stale', runId: 'run-old' }),
      ).toBe(false);
      expect(
        coordinator.complete({
          eventId: 'evt-1',
          leaseToken: 'lease-1',
          runId: 'run-1',
          status: 'success',
        }),
      ).toBe(true);
      expect(store.get('evt-1')).toMatchObject({ state: 'completed', runId: 'run-1' });
    } finally {
      close();
    }
  });
});
