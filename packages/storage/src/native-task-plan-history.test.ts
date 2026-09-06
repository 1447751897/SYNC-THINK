import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteWorkspaceStore } from './workspace-store.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { SqliteNativeTaskPlanHistory } from './native-task-plan-history.js';
import type { EventDraft } from './runtime-state-store.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('sync-think-plan-history-')
    )
      throw new Error('Unexpected fixture cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-plan-history-'));
  directories.push(directory);
  const path = join(directory, 'history.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ name: 'Task history' });
  const task = workspaces.createTask({
    workspaceId: workspace.id,
    title: 'Task history',
    goal: 'Read native snapshots',
  });
  const scope = { workspaceId: workspace.id, taskId: task.taskId, threadId: task.threadId };
  const store = new SqliteEventCheckpointStore(connection.raw);
  const draft = (
    id: string,
    runId: string,
    type: string,
    payload: Record<string, unknown> = {},
  ): EventDraft =>
    ({
      id: id as EventDraft['id'],
      runId: runId as EventDraft['runId'],
      type,
      payload: { threadId: task.threadId, ...payload },
      category: 'tool',
      workspaceId: workspace.id,
      taskId: task.taskId,
      occurredAt: '2026-09-06T03:00:00Z',
    }) as EventDraft;
  const requestPayload = {
    threadId: task.threadId,
    toolName: 'update_plan',
    toolCallId: 'plan',
    arguments: { plan: [{ step: '原生任务\n原生完整说明', status: 'in_progress' }] },
  };
  store.commitTransition({
    events: [
      draft('start', 'old', 'run.started', { kernelId: 'codex' }),
      draft('request', 'old', 'tool.requested', requestPayload),
      draft('result', 'old', 'tool.completed', {
        toolCallId: 'plan',
        structuredResult: { ok: true },
      }),
      draft('end', 'old', 'run.completed'),
      draft('new', 'new', 'run.started', { kernelId: 'codex' }),
      draft('new-end', 'new', 'run.completed'),
    ],
  });
  return { path, connection, workspaces, scope, store, draft, requestPayload };
}

describe('native task history storage', () => {
  it('restores historical descriptions while the current projection is empty, with warm source reuse and durable reopen', async () => {
    const data = await fixture();
    try {
      expect(data.store.getTaskPlanState(data.scope.taskId, data.scope.threadId).items).toBeNull();
      const read = vi.spyOn(data.store, 'listTaskPlanEvents');
      const first = data.store.getTaskPlanHistory(data.scope);
      expect(first.snapshot.selected).toMatchObject({
        runId: 'old',
        status: 'completed',
        items: [{ title: '原生任务', description: '原生完整说明', status: 'in_progress' }],
      });
      expect(data.store.getTaskPlanHistory(data.scope)).toBe(first);
      expect(read).toHaveBeenCalledTimes(1);
      const reopened = await openDatabaseAsync({
        path: data.path,
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(new SqliteEventCheckpointStore(reopened.raw).getTaskPlanHistory(data.scope)).toEqual(
          first,
        );
      } finally {
        reopened.raw.close();
      }
    } finally {
      data.connection.raw.close();
    }
  });

  it('revalidates ownership for every read and does not resolve another run from cached history', async () => {
    const data = await fixture();
    try {
      data.store.getTaskPlanHistory(data.scope);
      expect(() =>
        data.store.getTaskPlanHistory({
          ...data.scope,
          threadId: 'other' as typeof data.scope.threadId,
        }),
      ).toThrow('content.not-found');
      expect(() => data.store.getTaskPlanHistory(data.scope, { runId: 'foreign' })).toThrow(
        'history.plan-not-found',
      );
      data.connection.raw.prepare('DELETE FROM thread WHERE id = ?').run(data.scope.threadId);
      expect(() => data.store.getTaskPlanHistory(data.scope)).toThrow('content.not-found');
    } finally {
      data.connection.raw.close();
    }
  });

  it('invalidates external edits and bypasses cache in a rolled-back outer transaction', async () => {
    const data = await fixture();
    const other = await openDatabaseAsync({ path: data.path });
    try {
      const first = data.store.getTaskPlanHistory(data.scope);
      const payload = {
        ...data.requestPayload,
        arguments: { plan: [{ step: '已更新的任务', status: 'completed' }] },
      };
      other.raw
        .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify(payload), 'request');
      const updated = data.store.getTaskPlanHistory(data.scope);
      expect(updated.version).not.toBe(first.version);
      expect(updated.snapshot.selected?.items[0]?.title).toBe('已更新的任务');
      expect(() =>
        data.connection.raw.transaction(() => {
          data.connection.raw
            .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
            .run(JSON.stringify(data.requestPayload), 'request');
          expect(data.store.getTaskPlanHistory(data.scope).snapshot.selected?.items[0]?.title).toBe(
            '原生任务',
          );
          throw new Error('rollback');
        })(),
      ).toThrow('rollback');
      expect(data.store.getTaskPlanHistory(data.scope).snapshot.selected?.items[0]?.title).toBe(
        '已更新的任务',
      );
    } finally {
      other.raw.close();
      data.connection.raw.close();
    }
  });

  it('bounds cached prepared results and excludes unrelated large tools before deserialization', async () => {
    const data = await fixture();
    try {
      data.store.commitTransition({
        events: [
          data.draft('unrelated', 'new', 'tool.completed', {
            toolName: 'read_file',
            result: 'x'.repeat(2_000_000),
          }),
        ],
      });
      expect(
        data.store.listTaskPlanEvents(data.scope.taskId).some((event) => event.id === 'unrelated'),
      ).toBe(false);
      const load = vi.fn(data.store.listTaskPlanEvents.bind(data.store));
      const cache = new SqliteNativeTaskPlanHistory(data.connection.raw, load, 16 * 1024 * 1024, 1);
      cache.read(data.scope);
      cache.read(data.scope, { runId: 'old' });
      cache.read(data.scope);
      expect(load).toHaveBeenCalledTimes(3);
      const oversized = new SqliteNativeTaskPlanHistory(data.connection.raw, load, 1, 1);
      oversized.read(data.scope);
      oversized.read(data.scope);
      expect(load).toHaveBeenCalledTimes(5);
    } finally {
      data.connection.raw.close();
    }
  });
});

it('keeps different compound history cursors separate in the prepared cache', async () => {
  const data = await fixture();
  try {
    const included = data.store.getTaskPlanHistory(data.scope, {
      beforeSequence: 1,
      beforeRunId: 'zzz',
    });
    const excluded = data.store.getTaskPlanHistory(data.scope, {
      beforeSequence: 1,
      beforeRunId: 'aaa',
    });
    expect(included.snapshot.selected?.runId).toBe('old');
    expect(excluded.snapshot.runs).toEqual([]);
    expect(excluded.snapshot.selected).toBeUndefined();
  } finally {
    data.connection.raw.close();
  }
});
