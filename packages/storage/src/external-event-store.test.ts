import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteExternalEventStore } from './external-event-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-external-event-store-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteExternalEventStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    dedupeKey: 'github:delivery-123',
    source: { kind: 'git' as const, name: 'github' },
    instruction: '检查这次 push 并总结风险',
    target: { kind: 'model' as const, modelId: 'model-1' },
    workspaceId: 'workspace-1',
    skillVersionIds: ['skill-1'],
    metadata: { ref: 'refs/heads/main', after: 'abc123' },
    now: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteExternalEventStore', () => {
  it('deduplicates producer retries by dedupeKey and keeps the original envelope', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.submit(submission());
      const duplicate = store.submit(
        submission({ id: 'evt-duplicate', instruction: '重复投递不应覆盖原事件' }),
      );

      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(duplicate.event).toMatchObject({
        id: 'evt-1',
        dedupeKey: 'github:delivery-123',
        instruction: '检查这次 push 并总结风险',
        state: 'pending',
        attemptCount: 0,
      });
      expect(store.list()).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('atomically leases pending work and allows takeover only after expiry', async () => {
    const { store, close } = await openStore();
    try {
      store.submit(submission());

      const first = store.claimNext({
        owner: 'runtime-a',
        token: 'lease-a',
        now: '2026-08-21T00:00:01.000Z',
        leaseMs: 30_000,
      });
      expect(first).toMatchObject({
        id: 'evt-1',
        state: 'leased',
        leaseOwner: 'runtime-a',
        leaseToken: 'lease-a',
        attemptCount: 1,
      });

      expect(
        store.claimNext({
          owner: 'runtime-b',
          token: 'lease-b-early',
          now: '2026-08-21T00:00:20.000Z',
          leaseMs: 30_000,
        }),
      ).toBeUndefined();

      const takeover = store.claimNext({
        owner: 'runtime-b',
        token: 'lease-b',
        now: '2026-08-21T00:00:32.000Z',
        leaseMs: 30_000,
      });
      expect(takeover).toMatchObject({
        id: 'evt-1',
        leaseOwner: 'runtime-b',
        leaseToken: 'lease-b',
        attemptCount: 2,
      });
    } finally {
      close();
    }
  });

  it('fences stale heartbeat/completion and records the winning run terminal state', async () => {
    const { store, close } = await openStore();
    try {
      store.submit(submission());
      store.claimNext({
        owner: 'runtime-a',
        token: 'lease-a',
        now: '2026-08-21T00:00:01.000Z',
        leaseMs: 10_000,
      });
      store.claimNext({
        owner: 'runtime-b',
        token: 'lease-b',
        now: '2026-08-21T00:00:12.000Z',
        leaseMs: 30_000,
      });

      expect(
        store.heartbeat({
          eventId: 'evt-1',
          token: 'lease-a',
          now: '2026-08-21T00:00:13.000Z',
          leaseMs: 30_000,
        }),
      ).toBe(false);
      expect(
        store.complete({
          eventId: 'evt-1',
          token: 'lease-a',
          status: 'success',
          runId: 'run-stale',
          now: '2026-08-21T00:00:14.000Z',
        }),
      ).toBe(false);

      expect(
        store.heartbeat({
          eventId: 'evt-1',
          token: 'lease-b',
          runId: 'run-current',
          now: '2026-08-21T00:00:15.000Z',
          leaseMs: 30_000,
        }),
      ).toBe(true);
      expect(
        store.complete({
          eventId: 'evt-1',
          token: 'lease-b',
          status: 'success',
          runId: 'run-current',
          now: '2026-08-21T00:00:16.000Z',
        }),
      ).toBe(true);
      expect(store.get('evt-1')).toMatchObject({
        state: 'completed',
        runId: 'run-current',
        completedAt: '2026-08-21T00:00:16.000Z',
      });
    } finally {
      close();
    }
  });
});
