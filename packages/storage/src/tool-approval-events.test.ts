import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventId, RunId, WorkspaceId } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { runMigrations } from './scripts/migrate.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-approval-events-'));
  directories.push(directory);
  const path = join(directory, 'state.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const draft = (id: string, threadId: string, approvalId: string, decided = false) => ({
    id: id as EventId,
    workspaceId: 'workspace-a' as WorkspaceId,
    runId: `run-${threadId}` as RunId,
    category: 'approval' as const,
    type: decided ? 'tool.approval_decided' : 'tool.approval_requested',
    occurredAt: '2026-09-05T00:00:00.000Z',
    payload: { threadId, approvalId, ...(decided ? { decision: 'deny' } : { title: id }) },
  });
  store.commitTransition({
    events: [
      {
        ...draft('request-a', 'thread-a', 'approval-a'),
        payload: {
          ...draft('request-a', 'thread-a', 'approval-a').payload,
          run: { output: 'x'.repeat(2_000_000) },
        },
      },
      draft('request-b', 'thread-b', 'approval-b'),
      draft('decision-a', 'thread-a', 'approval-a', true),
      draft('request-c', 'thread-a', 'approval-c'),
      {
        ...draft('legacy-request', 'thread-legacy', 'approval-legacy'),
        runId: undefined,
        payload: { threadId: 'thread-legacy', approvalId: 'approval-legacy', runId: 'legacy-run' },
      },
    ],
  });
  connection.raw
    .prepare(
      `INSERT INTO event
    (id, workspace_id, category, type, sequence, occurred_at, payload_json)
    VALUES ('unrelated', 'workspace-a', 'system', 'noise.event', 6, '2026-09-05', 'invalid-json')`,
    )
    .run();
  return { connection, store };
}

describe('scoped tool approval events', () => {
  it('reads only the requested thread and removes unrelated run snapshots', async () => {
    const { connection, store } = await fixture();
    try {
      const events = store.listToolApprovalEvents({ threadId: 'thread-a' });
      expect(events.map((event) => event.id)).toEqual(['request-a', 'decision-a', 'request-c']);
      expect(events[0]?.payload).toEqual({
        threadId: 'thread-a',
        approvalId: 'approval-a',
        title: 'request-a',
      });
      expect(JSON.stringify(events).length).toBeLessThan(2_000);
      expect(
        store.listToolApprovalEvents({ threadId: 'thread-a', runId: 'other-run' as RunId }),
      ).toEqual([]);
      expect(
        store
          .listToolApprovalEvents({ threadId: 'thread-legacy', runId: 'legacy-run' as RunId })
          .map((event) => event.id),
      ).toEqual(['legacy-request']);
    } finally {
      connection.raw.close();
    }
  });

  it('looks up one approval without reading another thread or unrelated malformed payloads', async () => {
    const { connection, store } = await fixture();
    try {
      expect(
        store.listToolApprovalEvents({ approvalId: 'approval-a' }).map((event) => event.id),
      ).toEqual(['request-a', 'decision-a']);
      expect(store.listToolApprovalEvents({ approvalId: 'missing' })).toEqual([]);
    } finally {
      connection.raw.close();
    }
  });

  it('uses partial indexes for both query scopes without a temporary sort', async () => {
    const { connection } = await fixture();
    try {
      for (const scope of [{ threadId: 'thread-a' }, { approvalId: 'approval-a' }]) {
        let query = '';
        let parameters: unknown[] = [];
        const traced = {
          prepare(sql: string) {
            query = sql;
            return {
              all(...values: unknown[]) {
                parameters = values;
                return connection.raw.prepare(sql).all(...values);
              },
            };
          },
        } as unknown as BetterSQLite3Raw;
        new SqliteEventCheckpointStore(traced).listToolApprovalEvents(scope);
        const plan = connection.raw
          .prepare(`EXPLAIN QUERY PLAN ${query}`)
          .all(...parameters) as Array<{ detail: string }>;
        const details = plan.map((row) => row.detail).join('\n');
        expect(details).toContain('SEARCH event USING INDEX event_tool_approval_');
        expect(details).not.toContain('SCAN event');
        expect(details).not.toContain('TEMP B-TREE');
      }
    } finally {
      connection.raw.close();
    }
  });
});
