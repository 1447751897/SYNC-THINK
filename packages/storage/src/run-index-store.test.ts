import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteRunIndexStore, type RunIndexUpsert } from './run-index-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-run-index-store-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteRunIndexStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function entry(overrides: Partial<RunIndexUpsert> = {}): RunIndexUpsert {
  return {
    runId: 'run-1',
    workspaceId: 'workspace-1',
    conversationId: 'conv-1',
    source: 'chat',
    state: 'running',
    kernelId: 'codex',
    startedAt: '2026-08-21T00:00:00.000Z',
    now: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteRunIndexStore', () => {
  it('inserts and reads back a run projection', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.upsert(entry({ title: '总结这次 push', modelId: 'gpt-5' }));
      expect(created.runId).toBe('run-1');
      expect(created.state).toBe('running');
      expect(created.kernelId).toBe('codex');
      expect(created.title).toBe('总结这次 push');
      expect(created.finishedAt).toBeUndefined();
      expect(store.get('run-1')).toEqual(created);
    } finally {
      close();
    }
  });

  it('returns undefined for an unknown run', async () => {
    const { store, close } = await openStore();
    try {
      expect(store.get('missing')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('advances a running run to a terminal state', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry());
      const done = store.upsert(
        entry({
          state: 'completed',
          finishedAt: '2026-08-21T00:01:00.000Z',
          now: '2026-08-21T00:01:00.000Z',
        }),
      );
      expect(done.state).toBe('completed');
      expect(done.finishedAt).toBe('2026-08-21T00:01:00.000Z');
    } finally {
      close();
    }
  });

  it('keeps terminal state sticky when a late lifecycle event arrives', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry());
      store.upsert(entry({ state: 'completed', finishedAt: '2026-08-21T00:01:00.000Z' }));
      // A duplicated or out-of-order `run.started` must not resurrect the run.
      const late = store.upsert(entry({ state: 'running' }));
      expect(late.state).toBe('completed');
      expect(late.finishedAt).toBe('2026-08-21T00:01:00.000Z');
    } finally {
      close();
    }
  });

  it('never blanks a field that an earlier event supplied', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ kernelId: 'codex', modelId: 'gpt-5', title: '原标题' }));
      const later = store.upsert(
        entry({ state: 'completed', kernelId: undefined, modelId: undefined, title: undefined }),
      );
      expect(later.kernelId).toBe('codex');
      expect(later.modelId).toBe('gpt-5');
      expect(later.title).toBe('原标题');
    } finally {
      close();
    }
  });

  it('keeps the earliest startedAt across events', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ startedAt: '2026-08-21T00:00:05.000Z' }));
      const later = store.upsert(
        entry({ state: 'completed', startedAt: '2026-08-21T00:00:09.000Z' }),
      );
      expect(later.startedAt).toBe('2026-08-21T00:00:05.000Z');
    } finally {
      close();
    }
  });

  it('truncates an over-long title and error message', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.upsert(
        entry({
          state: 'failed',
          title: 'x'.repeat(400),
          errorMessage: 'y'.repeat(400),
          failureClass: 'provider',
        }),
      );
      expect(created.title).toHaveLength(120);
      expect(created.title?.endsWith('…')).toBe(true);
      expect(created.errorMessage).toHaveLength(240);
      expect(created.failureClass).toBe('provider');
    } finally {
      close();
    }
  });

  it('drops blank titles instead of storing empty text', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.upsert(entry({ title: '   ' }));
      expect(created.title).toBeUndefined();
    } finally {
      close();
    }
  });

  it('lists newest first', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', startedAt: '2026-08-21T00:00:01.000Z' }));
      store.upsert(entry({ runId: 'run-b', startedAt: '2026-08-21T00:00:03.000Z' }));
      store.upsert(entry({ runId: 'run-c', startedAt: '2026-08-21T00:00:02.000Z' }));
      const page = store.list();
      expect(page.entries.map((item) => item.runId)).toEqual(['run-b', 'run-c', 'run-a']);
      expect(page.nextCursor).toBeUndefined();
    } finally {
      close();
    }
  });

  it('paginates without dropping runs that share a timestamp', async () => {
    const { store, close } = await openStore();
    try {
      // Fan-out regularly starts several runs inside the same millisecond. A
      // timestamp-only cursor would skip every row after the first.
      for (const runId of ['run-1', 'run-2', 'run-3', 'run-4', 'run-5']) {
        store.upsert(entry({ runId, startedAt: '2026-08-21T00:00:00.000Z' }));
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = store.list({ limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.entries.map((item) => item.runId));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    } finally {
      close();
    }
  });

  it('paginates a mixed timestamp set exactly once per run', async () => {
    const { store, close } = await openStore();
    try {
      for (let index = 0; index < 12; index += 1) {
        store.upsert(
          entry({
            runId: `run-${index}`,
            startedAt: `2026-08-21T00:00:${String(index % 4).padStart(2, '0')}.000Z`,
          }),
        );
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = store.list({ limit: 5, ...(cursor ? { cursor } : {}) });
        seen.push(...page.entries.map((item) => item.runId));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
    } finally {
      close();
    }
  });

  it('omits nextCursor on the final exact-fit page', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a' }));
      store.upsert(entry({ runId: 'run-b' }));
      const page = store.list({ limit: 2 });
      expect(page.entries).toHaveLength(2);
      expect(page.nextCursor).toBeUndefined();
    } finally {
      close();
    }
  });

  it('falls back to the first page when a cursor is malformed', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a' }));
      // A persisted stale cursor must not wedge the list permanently.
      const page = store.list({ cursor: 'not-a-real-cursor' });
      expect(page.entries.map((item) => item.runId)).toEqual(['run-a']);
    } finally {
      close();
    }
  });

  it('filters by workspace, conversation, state and source', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', workspaceId: 'ws-1', state: 'running' }));
      store.upsert(
        entry({
          runId: 'run-b',
          workspaceId: 'ws-1',
          state: 'failed',
          source: 'external',
          conversationId: 'conv-2',
        }),
      );
      store.upsert(entry({ runId: 'run-c', workspaceId: 'ws-2', state: 'running' }));

      expect(store.list({ workspaceId: 'ws-1' }).entries).toHaveLength(2);
      expect(store.list({ states: ['failed'] }).entries.map((i) => i.runId)).toEqual(['run-b']);
      expect(store.list({ sources: ['external'] }).entries.map((i) => i.runId)).toEqual(['run-b']);
      expect(store.list({ conversationId: 'conv-2' }).entries.map((i) => i.runId)).toEqual([
        'run-b',
      ]);
      expect(
        store.list({ workspaceId: 'ws-1', states: ['running', 'failed'] }).entries,
      ).toHaveLength(2);
    } finally {
      close();
    }
  });

  it('ignores unknown state and source filter members', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', state: 'running' }));
      // A stale client must not be able to widen the query past the CHECK vocabulary.
      const page = store.list({
        states: ['running', 'bogus' as never],
        sources: ['chat', 'nope' as never],
      });
      expect(page.entries.map((item) => item.runId)).toEqual(['run-a']);
    } finally {
      close();
    }
  });

  it('clamps the page limit to the documented maximum', async () => {
    const { store, close } = await openStore();
    try {
      for (let index = 0; index < 60; index += 1) {
        store.upsert(entry({ runId: `run-${index}` }));
      }
      expect(store.list({ limit: 5000 }).entries).toHaveLength(50);
      expect(store.list({ limit: 0 }).entries).toHaveLength(1);
      expect(store.list({ limit: Number.NaN }).entries).toHaveLength(25);
    } finally {
      close();
    }
  });

  it('lists unfinished runs oldest first', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', startedAt: '2026-08-21T00:00:02.000Z' }));
      store.upsert(entry({ runId: 'run-b', startedAt: '2026-08-21T00:00:01.000Z' }));
      store.upsert(entry({ runId: 'run-c', state: 'paused' }));
      store.upsert(entry({ runId: 'run-d', state: 'completed' }));
      expect(store.listUnfinished().map((item) => item.runId)).toEqual([
        'run-c',
        'run-b',
        'run-a',
      ]);
    } finally {
      close();
    }
  });

  it('marks interrupted runs failed without touching terminal rows', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', state: 'running' }));
      store.upsert(entry({ runId: 'run-b', state: 'completed' }));
      const updated = store.markInterrupted({
        runIds: ['run-a', 'run-b'],
        reason: 'Runtime 重启',
        now: '2026-08-21T01:00:00.000Z',
      });
      expect(updated).toBe(1);

      const interrupted = store.get('run-a');
      expect(interrupted?.state).toBe('failed');
      expect(interrupted?.failureClass).toBe('interrupted');
      expect(interrupted?.errorMessage).toBe('Runtime 重启');
      expect(interrupted?.finishedAt).toBe('2026-08-21T01:00:00.000Z');

      expect(store.get('run-b')?.state).toBe('completed');
    } finally {
      close();
    }
  });

  it('treats markInterrupted as a no-op for an empty list', async () => {
    const { store, close } = await openStore();
    try {
      expect(store.markInterrupted({ runIds: [], reason: 'x' })).toBe(0);
    } finally {
      close();
    }
  });

  it('counts runs by state', async () => {
    const { store, close } = await openStore();
    try {
      store.upsert(entry({ runId: 'run-a', state: 'running' }));
      store.upsert(entry({ runId: 'run-b', state: 'failed' }));
      store.upsert(entry({ runId: 'run-c', state: 'failed' }));
      store.upsert(entry({ runId: 'run-d', workspaceId: 'ws-2', state: 'completed' }));

      const all = store.countByState();
      expect(all.running).toBe(1);
      expect(all.failed).toBe(2);
      expect(all.completed).toBe(1);
      expect(all.cancelled).toBe(0);

      const scoped = store.countByState({ workspaceId: 'workspace-1' });
      expect(scoped.completed).toBe(0);
      expect(scoped.failed).toBe(2);
    } finally {
      close();
    }
  });

  it('rejects a state outside the schema vocabulary', async () => {
    const { store, close } = await openStore();
    try {
      expect(() => store.upsert(entry({ state: 'bogus' as never }))).toThrow();
    } finally {
      close();
    }
  });

  it('records external event provenance', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.upsert(
        entry({
          runId: 'run-ext',
          source: 'external',
          externalEventId: 'evt-1',
          triggerMessageId: 'msg-1',
        }),
      );
      expect(created.externalEventId).toBe('evt-1');
      expect(created.triggerMessageId).toBe('msg-1');
    } finally {
      close();
    }
  });
});
