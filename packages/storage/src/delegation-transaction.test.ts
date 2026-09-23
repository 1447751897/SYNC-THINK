import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteDelegatedRunStore } from './delegated-run-store.js';
import { SqliteEventCheckpointStore, type EventDraft } from './runtime-state-store.js';
import type { DelegatedRunSnapshot, EventId, RunId, WorkspaceId } from '@sync-think/shared';

const child = 'child' as RunId;
const facts: DelegatedRunSnapshot = {
  childRunId: child,
  parentRunId: 'parent',
  threadId: 'thread',
  agentId: 'reviewer',
  name: 'Reviewer',
  status: 'running',
  toolCount: 5,
};
function draft(id: string, type: string, changes: Partial<DelegatedRunSnapshot> = {}): EventDraft {
  return {
    id: id as EventId,
    workspaceId: 'workspace' as WorkspaceId,
    runId: child,
    category: 'run',
    type,
    occurredAt: '2026-09-19T00:00:00Z',
    payload: { threadId: 'thread', delegatedRun: { ...facts, ...changes } },
  };
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'delegation-transaction-'));
  const path = join(dir, 'test.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  db.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run('thread', 'task', '2026-09-19T00:00:00Z');
  return { dir, path, ...db };
}

describe('atomic delegation projection', () => {
  it('runs an injected projection inside the event transaction and rolls back its events', async () => {
    const f = await fixture();
    try {
      const observed: Array<{ eventIds: string[]; visibleEventCount: number }> = [];
      const store = new SqliteEventCheckpointStore(f.raw, undefined, {
        projectEventsInTransaction(events) {
          const row = f.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as {
            count: number;
          };
          observed.push({
            eventIds: events.map((event) => event.id),
            visibleEventCount: row.count,
          });
          throw new Error('injected projection failure');
        },
      });

      expect(() => store.commitTransition({ events: [draft('start', 'run.started')] })).toThrow(
        'injected projection failure',
      );
      expect(observed).toEqual([{ eventIds: ['start'], visibleEventCount: 1 }]);
      expect(store.listAllEvents(0)).toEqual([]);
    } finally {
      f.raw.close();
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it.each(['event', 'delegated_run', 'checkpoint'] as const)(
    'rolls back the whole transition when %s fails and retries with no sequence gap',
    async (table) => {
      const f = await fixture();
      try {
        const store = new SqliteEventCheckpointStore(f.raw);
        const repository = new SqliteDelegatedRunStore(f.raw);
        store.commitTransition({ events: [draft('start', 'run.started')] });
        f.raw.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON ${table}
          BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);
        const transition = {
          events: [
            draft('done', 'run.completed', {
              status: 'completed',
              toolCount: 81,
              result: 'final report'.repeat(1000),
            }),
          ] as const,
          checkpoint: { id: 'checkpoint', runId: child, createdAt: 'now', state: {} },
        };
        expect(() => store.commitTransition(transition)).toThrow('injected write failure');
        expect(store.listEventsByRun(child).map((event) => event.id)).toEqual(['start']);
        expect(repository.get(child)).toMatchObject({
          status: 'running',
          sequence: 1,
          toolCount: 5,
        });
        expect(store.loadLatestCheckpoint(child)).toBeUndefined();
        f.raw.exec('DROP TRIGGER injected_failure');
        const committed = store.commitTransition(transition);
        expect(committed.events[0]!.sequence).toBe(2);
        expect(committed.checkpoint?.lastEventSequence).toBe(2);
        expect(repository.get(child)).toMatchObject({
          status: 'completed',
          toolCount: 81,
          result: 'final report'.repeat(1000),
          sequence: 2,
        });
      } finally {
        f.raw.close();
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
  );

  it.each(['completed', 'cancelled', 'timed_out'] as const)(
    'restores %s without UI publication, and rebuilds missing state from events',
    async (status) => {
      const f = await fixture();
      let db = f;
      try {
        const store = new SqliteEventCheckpointStore(db.raw);
        store.commitTransition({
          events: [
            draft('start', 'run.started'),
            draft('terminal', status === 'completed' ? 'run.completed' : 'run.cancelled', {
              status,
              toolCount: 120,
              result: 'report beyond the card budget'.repeat(1000),
            }),
          ],
        });
        db.raw.close();
        db = { ...f, ...(await openDatabaseAsync({ path: f.path })) };
        const repository = new SqliteDelegatedRunStore(db.raw);
        const expected = repository.get(child);
        expect(expected).toMatchObject({ status, toolCount: 120, sequence: 2 });
        // Simulate a missing projection; the durable event log remains intact.
        db.raw.prepare('DELETE FROM delegated_run WHERE child_run_id = ?').run(child);
        const durable = new SqliteEventCheckpointStore(db.raw).listEventsByRun(child);
        repository.projectEvents(durable);
        repository.projectEvents(durable);
        expect(repository.get(child)).toEqual(expected);
        new SqliteEventCheckpointStore(db.raw).commitTransition({
          events: [draft('late-progress', 'provider.usage')],
        });
        expect(repository.get(child)).toEqual(expected);
        expect(repository.listByThread('other')).toEqual([]);
      } finally {
        db.raw.close();
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
  );

  it('rejects a mismatched event scope without appending the event', async () => {
    const f = await fixture();
    try {
      const store = new SqliteEventCheckpointStore(f.raw);
      store.commitTransition({ events: [draft('start', 'run.started')] });
      expect(() =>
        store.commitTransition({
          events: [
            draft('wrong-parent', 'run.completed', { status: 'completed', parentRunId: 'other' }),
          ],
        }),
      ).toThrow('delegation.event_scope_mismatch');
      expect(store.listEventsByRun(child)).toHaveLength(1);
    } finally {
      f.raw.close();
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});
