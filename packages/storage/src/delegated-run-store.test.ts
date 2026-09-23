import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteDelegatedRunStore } from './delegated-run-store.js';
import type { Event, EventId, RunId, WorkspaceId } from '@sync-think/shared';

function event(childRunId: string, sequence: number): Event {
  return {
    id: `event-${sequence}` as EventId,
    workspaceId: 'workspace' as WorkspaceId,
    runId: childRunId as RunId,
    category: 'run',
    type: 'run.started',
    sequence,
    occurredAt: '2026-09-19T00:00:00Z',
    payload: {
      threadId: 'thread',
      delegatedRun: {
        childRunId,
        parentRunId: 'parent',
        threadId: 'thread',
        agentId: 'reviewer',
        name: 'Reviewer',
        status: 'running',
        toolCount: 0,
      },
    },
  };
}

it('restores cancelled children independently of message pagination and rejects late progress', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'delegation-store-'));
  const path = join(dir, 'test.db');
  await runMigrations(path);
  let db = await openDatabaseAsync({ path });
  try {
    db.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run('thread', 'task', '2026-09-19T00:00:00Z');
    const store = new SqliteDelegatedRunStore(db.raw);
    const record = {
      childRunId: 'child',
      parentRunId: 'parent',
      threadId: 'thread',
      agentId: 'reviewer',
      name: 'Reviewer',
      status: 'running' as const,
      toolCount: 16,
      sequence: 1,
      updatedAt: '2026-09-19T00:00:00Z',
    };
    store.upsert(record);
    store.upsert({ ...record, status: 'cancelled', sequence: 2 });
    store.upsert({ ...record, sequence: 3 });
    db.raw.close();
    db = await openDatabaseAsync({ path });
    const restored = new SqliteDelegatedRunStore(db.raw);
    expect(restored.listByThread('thread')).toMatchObject([
      { childRunId: 'child', status: 'cancelled', toolCount: 16, sequence: 2 },
    ]);
    expect(restored.listByThread('other')).toEqual([]);
    db.raw.prepare('DELETE FROM thread WHERE id = ?').run('thread');
    expect(restored.get('child')).toBeUndefined();
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rolls back every record when standalone event projection fails partway through', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'delegation-store-atomic-'));
  const path = join(dir, 'test.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  try {
    db.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run('thread', 'task', '2026-09-19T00:00:00Z');
    db.raw.exec(`CREATE TRIGGER fail_second_delegated_run BEFORE INSERT ON delegated_run
      WHEN NEW.child_run_id = 'child-2'
      BEGIN SELECT RAISE(ABORT, 'injected second projection failure'); END;`);
    const store = new SqliteDelegatedRunStore(db.raw);

    expect(() => store.projectEvents([event('child-1', 1), event('child-2', 2)])).toThrow(
      'injected second projection failure',
    );
    expect(store.get('child-1')).toBeUndefined();
    expect(store.get('child-2')).toBeUndefined();
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
