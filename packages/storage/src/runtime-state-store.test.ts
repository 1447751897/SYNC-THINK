import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventId, RunId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync, SqliteEventCheckpointStore } from './index.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-state-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

function eventDraft(id: string, workspaceId: WorkspaceId, text: string) {
  return {
    id: id as EventId,
    workspaceId,
    category: 'message' as const,
    type: 'message.appended',
    occurredAt: '2026-07-11T00:00:00.000Z',
    payload: { threadId: 'thread-1', text },
  };
}

describe('SqliteEventCheckpointStore', () => {
  it('lists one run in stable (sequence, id) order without returning other runs', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-run-events' as WorkspaceId;
    const runA = 'run-a' as RunId;
    const runB = 'run-b' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      store.commitTransition({
        events: [
          { ...eventDraft('event-run-a-1', workspaceId, 'a1'), runId: runA },
          { ...eventDraft('event-run-b-1', workspaceId, 'b1'), runId: runB },
          { ...eventDraft('event-run-a-3', workspaceId, 'a3'), runId: runA },
          { ...eventDraft('event-run-a-2', workspaceId, 'a2'), runId: runA },
        ],
      });
      connection.raw
        .prepare('UPDATE event SET sequence = 3 WHERE id IN (?, ?)')
        .run('event-run-a-2', 'event-run-a-3');

      expect(store.listEventsByRun(runA).map((event) => [event.sequence, event.id])).toEqual([
        [1, 'event-run-a-1'],
        [3, 'event-run-a-2'],
        [3, 'event-run-a-3'],
      ]);
      expect(store.listEventsByRun(runB).map((event) => event.id)).toEqual(['event-run-b-1']);
      expect(store.listEventsByRun('missing-run' as RunId)).toEqual([]);
    } finally {
      connection.raw.close();
    }
  });

  it('allocates a global sequence across workspaces and lists the durable global stream', async () => {
    const dbPath = makeDbPath();
    const workspaceA = 'workspace-global-a' as WorkspaceId;
    const workspaceB = 'workspace-global-b' as WorkspaceId;
    await runMigrations(dbPath);
    const firstConnection = await openDatabaseAsync({ path: dbPath });
    try {
      const store = new SqliteEventCheckpointStore(firstConnection.raw);
      const first = store.commitTransition({
        events: [eventDraft('event-global-a', workspaceA, 'workspace A')],
      });
      const second = store.commitTransition({
        events: [eventDraft('event-global-b', workspaceB, 'workspace B')],
      });

      expect([first.events[0].sequence, second.events[0].sequence]).toEqual([1, 2]);
      expect(store.listAllEvents(0).map((event) => [event.workspaceId, event.sequence])).toEqual([
        [workspaceA, 1],
        [workspaceB, 2],
      ]);
      expect(store.listEvents(workspaceA, 0).map((event) => event.sequence)).toEqual([1]);
      expect(store.listEvents(workspaceB, 0).map((event) => event.sequence)).toEqual([2]);
    } finally {
      firstConnection.raw.close();
    }

    const reopenedConnection = await openDatabaseAsync({ path: dbPath });
    try {
      expect(
        new SqliteEventCheckpointStore(reopenedConnection.raw)
          .listAllEvents(0)
          .map((event) => event.id),
      ).toEqual(['event-global-a', 'event-global-b']);
    } finally {
      reopenedConnection.raw.close();
    }
  });

  it('reads the global event stream in bounded pages with a stable duplicate-sequence order', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-page' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      store.commitTransition({
        events: [
          eventDraft('event-page-1', workspaceId, 'message 1'),
          ...Array.from({ length: 5 }, (_, index) =>
            eventDraft(`event-page-${index + 2}`, workspaceId, `message ${index + 2}`),
          ),
        ],
      });
      connection.raw
        .prepare('UPDATE event SET sequence = 2 WHERE id IN (?, ?)')
        .run('event-page-3', 'event-page-4');

      expect(store.getLatestEventSequence()).toBe(6);
      expect(store.getLatestEventCursor()).toEqual({
        sequence: 6,
        eventId: 'event-page-6',
      });
      const first = store.listEventPage({ afterSequence: 0, throughSequence: 6, limit: 2 });
      expect(first).toHaveLength(2);
      expect(first.map((event) => [event.sequence, event.id])).toEqual([
        [1, 'event-page-1'],
        [2, 'event-page-2'],
      ]);
      const second = store.listEventPage({
        afterSequence: 2,
        afterId: 'event-page-2',
        throughSequence: 6,
        throughId: 'event-page-6',
        limit: 2,
      });
      expect(second).toHaveLength(2);
      expect(second.map((event) => [event.sequence, event.id])).toEqual([
        [2, 'event-page-3'],
        [2, 'event-page-4'],
      ]);
      const third = store.listEventPage({
        afterSequence: 2,
        afterId: 'event-page-4',
        throughSequence: 6,
        throughId: 'event-page-6',
        limit: 2,
      });
      expect(third).toHaveLength(2);
      expect(third.map((event) => [event.sequence, event.id])).toEqual([
        [5, 'event-page-5'],
        [6, 'event-page-6'],
      ]);
      expect(
        store
          .listEventPage({ afterSequence: 2, throughSequence: 6, limit: 10 })
          .map((event) => event.id),
      ).toEqual(['event-page-5', 'event-page-6']);
    } finally {
      connection.raw.close();
    }
  });

  it('commits an ordered event batch with one final checkpoint', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-batch' as WorkspaceId;
    const runId = 'run-batch' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      const committed = store.commitTransition({
        events: [
          eventDraft('event-batch-1', workspaceId, 'message'),
          {
            ...eventDraft('event-batch-2', workspaceId, 'run intent'),
            category: 'run',
            type: 'run.started',
          },
        ],
        checkpoint: {
          id: 'checkpoint-batch',
          runId,
          state: { threadVersions: [['thread-1', 1]], demoRuns: ['run-batch'] },
          createdAt: '2026-07-11T00:00:02.000Z',
        },
      });

      expect(committed.events.map((event) => event.sequence)).toEqual([1, 2]);
      expect(committed.checkpoint?.lastEventSequence).toBe(2);
      expect(store.listEvents(workspaceId, 0).map((event) => event.id)).toEqual([
        'event-batch-1',
        'event-batch-2',
      ]);
      expect(store.loadLatestCheckpoint(runId)?.lastEventSequence).toBe(2);
    } finally {
      connection.raw.close();
    }
  });

  it('rolls back every event when a later event in the batch fails', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-batch-rollback' as WorkspaceId;
    const runId = 'run-batch-rollback' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      expect(() =>
        store.commitTransition({
          events: [
            eventDraft('event-duplicate', workspaceId, 'first insert'),
            eventDraft('event-duplicate', workspaceId, 'must fail'),
          ],
          checkpoint: {
            id: 'checkpoint-must-roll-back',
            runId,
            state: { version: 1 },
            createdAt: '2026-07-11T00:00:01.000Z',
          },
        }),
      ).toThrow();
      expect(store.listEvents(workspaceId, 0)).toEqual([]);
      expect(store.loadLatestCheckpoint(runId)).toBeUndefined();

      const next = store.commitTransition({
        events: [eventDraft('event-after-rollback', workspaceId, 'next')],
      });
      expect(next.events[0].sequence).toBe(1);
    } finally {
      connection.raw.close();
    }
  });

  it('restores durable events and the latest checkpoint after reopening SQLite', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-1' as WorkspaceId;
    const runId = 'run-1' as RunId;
    await runMigrations(dbPath);

    const firstConnection = await openDatabaseAsync({ path: dbPath });
    try {
      const firstStore = new SqliteEventCheckpointStore(firstConnection.raw);
      const committed = firstStore.commitTransition({
        events: [eventDraft('event-1', workspaceId, 'first')],
        checkpoint: {
          id: 'checkpoint-1',
          runId,
          state: { threadVersions: [['thread-1', 1]] },
          createdAt: '2026-07-11T00:00:01.000Z',
        },
      });
      expect(committed.events[0].sequence).toBe(1);
      expect(committed.checkpoint?.lastEventSequence).toBe(1);
    } finally {
      firstConnection.raw.close();
    }

    const reopenedConnection = await openDatabaseAsync({ path: dbPath });
    try {
      const reopenedStore = new SqliteEventCheckpointStore(reopenedConnection.raw);
      expect(reopenedStore.listEvents(workspaceId, 0)).toEqual([
        expect.objectContaining({
          id: 'event-1',
          sequence: 1,
          payload: { threadId: 'thread-1', text: 'first' },
        }),
      ]);
      expect(reopenedStore.loadLatestCheckpoint(runId)).toEqual({
        id: 'checkpoint-1',
        runId,
        lastEventSequence: 1,
        state: { threadVersions: [['thread-1', 1]] },
        createdAt: '2026-07-11T00:00:01.000Z',
      });

      const second = reopenedStore.commitTransition({
        events: [eventDraft('event-2', workspaceId, 'second')],
        checkpoint: {
          id: 'checkpoint-2',
          runId,
          state: { threadVersions: [['thread-1', 2]] },
          createdAt: '2026-07-11T00:00:02.000Z',
        },
      });
      expect(second.events[0].sequence).toBe(2);
    } finally {
      reopenedConnection.raw.close();
    }
  });

  it('rolls back the event when its checkpoint cannot be written', async () => {
    const dbPath = makeDbPath();
    const workspaceId = 'workspace-1' as WorkspaceId;
    const runId = 'run-1' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      store.commitTransition({
        events: [eventDraft('event-1', workspaceId, 'first')],
        checkpoint: {
          id: 'checkpoint-shared',
          runId,
          state: { version: 1 },
          createdAt: '2026-07-11T00:00:01.000Z',
        },
      });

      expect(() =>
        store.commitTransition({
          events: [eventDraft('event-2', workspaceId, 'must roll back')],
          checkpoint: {
            id: 'checkpoint-shared',
            runId,
            state: { version: 2 },
            createdAt: '2026-07-11T00:00:02.000Z',
          },
        }),
      ).toThrow();

      expect(store.listEvents(workspaceId, 0).map((event) => event.id)).toEqual(['event-1']);
    } finally {
      connection.raw.close();
    }
  });
});
