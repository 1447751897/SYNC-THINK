import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskId, ThreadId, WorkspaceId } from '@sync-think/shared';
import { ulid, type Event } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteWorkspaceStore } from './workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-workspace-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore(dbPath = makeDbPath()) {
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteWorkspaceStore(connection.raw),
    raw: connection.raw,
    close: () => connection.raw.close(),
  };
}

describe('SqliteWorkspaceStore', () => {
  it('creates a workspace from an absolute folder path and lists it', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createWorkspace({
        folderPath: 'D:\\projects\\sync-think-demo',
        name: 'Demo',
      });
      expect(created.id).toBeTruthy();
      expect(created.folderPath).toMatch(/^[A-Za-z]:\\projects\\sync-think-demo$/i);
      expect(created.name).toBe('Demo');

      const listed = store.listWorkspaces();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.id);
    } finally {
      close();
    }
  });

  it('rejects duplicate folder paths for workspaces', async () => {
    const { store, close } = await openStore();
    try {
      store.createWorkspace({
        folderPath: 'D:\\projects\\same-folder',
        name: 'One',
      });
      expect(() =>
        store.createWorkspace({
          folderPath: 'D:\\projects\\same-folder\\.',
          name: 'Two',
        }),
      ).toThrow(/already exists/i);
    } finally {
      close();
    }
  });

  it('creates nested tasks under a workspace with a default thread', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\task-demo',
        name: 'Task Demo',
      });
      const root = store.createTask({
        workspaceId: workspace.id,
        id: 'z-root-task' as TaskId,
        threadId: 'z-root-thread' as ThreadId,
        now: '2026-07-12T00:00:00.000Z',
        title: 'Root task',
        goal: 'Plan the product',
      });
      const child = store.createTask({
        workspaceId: workspace.id,
        id: 'a-child-task' as TaskId,
        threadId: 'a-child-thread' as ThreadId,
        now: '2026-07-12T00:00:00.000Z',
        parentTaskId: root.taskId,
        title: 'Child task',
        goal: 'Break down the plan',
      });

      expect(root.taskVersion).toBe(0);
      expect(root.threadId).toBeTruthy();
      expect(child.parentTaskId).toBe(root.taskId);

      const tasks = store.listTasks(workspace.id);
      expect(tasks.map((task) => task.title)).toEqual(['Root task', 'Child task']);
      expect(tasks.find((task) => task.id === child.taskId)?.parentTaskId).toBe(root.taskId);
    } finally {
      close();
    }
  });

  it('records last-open memory when a task is opened', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\last-open',
        name: 'Last Open',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Resume me',
        goal: 'Remember last open',
      });
      expect(store.getTask(task.taskId)?.lastOpenedAt).toBeUndefined();

      const opened = store.openTask(task.taskId);
      expect(opened.lastOpenedAt).toBeTruthy();
      expect(store.getTask(task.taskId)?.lastOpenedAt).toBe(opened.lastOpenedAt);
      expect(store.getLastOpenedTask(workspace.id)?.id).toBe(task.taskId as TaskId);
    } finally {
      close();
    }
  });

  it('searches tasks by title and goal within a workspace', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\search-demo',
        name: 'Search',
      });
      store.createTask({
        workspaceId: workspace.id,
        title: 'Provider adapters',
        goal: 'Wire OpenAI-compatible streaming',
      });
      store.createTask({
        workspaceId: workspace.id,
        title: 'UI polish',
        goal: 'Theme and a11y',
      });

      const hits = store.searchTasks(workspace.id, 'streaming');
      expect(hits).toHaveLength(1);
      expect(hits[0]?.title).toBe('Provider adapters');
    } finally {
      close();
    }
  });

  it('rejects tasks for unknown workspaces', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.createTask({
          workspaceId: 'missing-workspace' as WorkspaceId,
          title: 'Orphan',
          goal: 'Should fail',
        }),
      ).toThrow(/workspace/i);
    } finally {
      close();
    }
  });

  it('normalizes bounded criteria and rejects direct storage bypasses', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\criteria-bounds',
        name: 'Criteria bounds',
      });
      const valid = store.createTask({
        workspaceId: workspace.id,
        title: 'Valid criteria',
        goal: 'Persist normalized criteria',
        acceptanceCriteria: ['  exact criterion  '],
      });
      expect(store.getTask(valid.taskId)?.acceptanceCriteria).toEqual(['exact criterion']);

      const invalidCriteria = [
        {
          value: Array.from({ length: 65 }, (_, index) => `criterion-${index}`),
          code: 'acceptance_criteria.too_many',
        },
        { value: ['x'.repeat(4_001)], code: 'acceptance_criteria.item_too_large' },
        {
          value: Array.from({ length: 17 }, () => 'x'.repeat(4_000)),
          code: 'acceptance_criteria.total_too_large',
        },
        { value: ['   '], code: 'acceptance_criteria.empty' },
      ];
      for (const [index, invalid] of invalidCriteria.entries()) {
        expect(() =>
          store.createTask({
            workspaceId: workspace.id,
            id: `invalid-criteria-${index}` as TaskId,
            title: 'Invalid criteria',
            goal: 'Must not persist',
            acceptanceCriteria: invalid.value,
          }),
        ).toThrow(invalid.code);
      }
      expect(
        raw
          .prepare("SELECT COUNT(*) AS count FROM task WHERE title = 'Invalid criteria'")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      close();
    }
  });

  it('fails closed instead of treating corrupt stored acceptance criteria as empty', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\criteria-corruption',
        name: 'Criteria corruption',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Corrupt criteria',
        goal: 'Fail closed on read',
      });
      raw
        .prepare('UPDATE task SET acceptance_criteria_json = ? WHERE id = ?')
        .run('{', task.taskId);
      expect(() => store.getTask(task.taskId)).toThrow('acceptance_criteria.invalid');
    } finally {
      close();
    }
  });
});

describe('SqliteWorkspaceStore.getTaskByThreadId', () => {
  it('resolves task by thread id for context packet assembly', async () => {
    const { store, close } = await openStore();
    try {
      const root = tempDirs[tempDirs.length - 1]!;
      const ws = store.createWorkspace({
        folderPath: join(root, 'proj-thread'),
        name: 'Thread Map',
        allowedRoots: [root],
      });
      const task = store.createTask({
        workspaceId: ws.id,
        title: 'T1',
        goal: 'Protect goal in packet',
        acceptanceCriteria: ['must keep goal'],
      });
      const found = store.getTaskByThreadId(task.threadId);
      expect(found?.id).toBe(task.taskId);
      expect(found?.goal).toBe('Protect goal in packet');
      expect(found?.acceptanceCriteria).toEqual(['must keep goal']);
      expect(store.getTaskByThreadId('missing-thread' as ThreadId)).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe('SqliteWorkspaceStore participation mode', () => {
  it('defaults new tasks to conversation mode', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\participation-default',
        name: 'Participation Default',
      });
      const created = store.createTask({
        workspaceId: workspace.id,
        title: 'Default mode',
        goal: 'Start as a conversation',
      });

      expect(created.participationMode).toBe('conversation');
      expect(store.getTask(created.taskId)).toMatchObject({
        participationMode: 'conversation',
        version: 0,
      });
    } finally {
      close();
    }
  });

  it('updates participation mode with optimistic task versioning', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\participation-version',
        name: 'Participation Version',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Versioned mode',
        goal: 'Reject stale writers',
      });

      const changed = store.setParticipationMode(
        task.taskId,
        'collaboration',
        task.taskVersion,
        '2026-07-13T01:00:00.000Z',
      );
      expect(changed).toMatchObject({
        participationMode: 'collaboration',
        version: 1,
        updatedAt: '2026-07-13T01:00:00.000Z',
      });

      expect(() =>
        store.setParticipationMode(
          task.taskId,
          'automatic',
          task.taskVersion,
          '2026-07-13T01:01:00.000Z',
        ),
      ).toThrow(/task version conflict/i);
      expect(store.getTask(task.taskId)).toMatchObject({
        participationMode: 'collaboration',
        version: 1,
      });
    } finally {
      close();
    }
  });

  it('retains participation mode after reopening the database', async () => {
    const dbPath = makeDbPath();
    const first = await openStore(dbPath);
    let taskId: TaskId;
    try {
      const workspace = first.store.createWorkspace({
        folderPath: 'D:\\projects\\participation-reopen',
        name: 'Participation Reopen',
      });
      const task = first.store.createTask({
        workspaceId: workspace.id,
        title: 'Persisted mode',
        goal: 'Survive a cold reopen',
      });
      taskId = task.taskId;
      first.store.setParticipationMode(
        task.taskId,
        'collaboration',
        task.taskVersion,
        '2026-07-13T02:00:00.000Z',
      );
    } finally {
      first.close();
    }

    const reopened = await openStore(dbPath);
    try {
      expect(reopened.store.getTask(taskId!)).toMatchObject({
        participationMode: 'collaboration',
        version: 1,
      });
    } finally {
      reopened.close();
    }
  });

  it('rejects an unknown persisted participation mode', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\participation-invalid',
        name: 'Participation Invalid',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Invalid persisted mode',
        goal: 'Reject corrupt state',
      });
      raw
        .prepare('UPDATE task SET participation_mode = ? WHERE id = ?')
        .run('unknown-mode', task.taskId);

      expect(() => store.getTask(task.taskId)).toThrow(
        'Invalid participation mode in task row: unknown-mode',
      );
    } finally {
      close();
    }
  });
});

describe('SqliteWorkspaceStore task version source of truth', () => {
  it('advances a task version by thread with compare-and-swap semantics', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\thread-version-cas',
        name: 'Thread Version CAS',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'CAS task',
        goal: 'Advance one version at a time',
      });

      const advanced = store.advanceTaskVersionByThreadId(
        task.threadId,
        0,
        '2026-07-13T06:00:00.000Z',
      );
      expect(advanced).toMatchObject({
        id: task.taskId,
        version: 1,
        updatedAt: '2026-07-13T06:00:00.000Z',
      });
      expect(() => store.advanceTaskVersionByThreadId(task.threadId, 0)).toThrow(
        /task version conflict.*actual 1/i,
      );
      expect(store.getTask(task.taskId)?.version).toBe(1);
    } finally {
      close();
    }
  });

  it('reconciles historical message versions without lowering a newer database version', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\task-version-repair',
        name: 'Task Version Repair',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Historical task',
        goal: 'Continue after cache-only message history',
      });
      const events = new SqliteEventCheckpointStore(raw);
      events.commitTransition({
        events: [
          {
            id: ulid() as Event['id'],
            workspaceId: workspace.id,
            taskId: task.taskId,
            messageId: ulid() as Event['messageId'],
            category: 'message',
            type: 'message.appended',
            occurredAt: '2026-07-13T06:10:00.000Z',
            payload: { threadId: task.threadId, taskVersion: 18, text: 'historical' },
          },
        ],
      });

      expect(
        store.reconcileTaskVersionsFromMessageEvents('2026-07-13T06:11:00.000Z'),
      ).toBe(1);
      expect(store.getTask(task.taskId)).toMatchObject({
        version: 18,
        updatedAt: '2026-07-13T06:11:00.000Z',
      });

      raw.prepare('UPDATE task SET version = 20 WHERE id = ?').run(task.taskId);
      expect(
        store.reconcileTaskVersionsFromMessageEvents('2026-07-13T06:12:00.000Z'),
      ).toBe(0);
      expect(store.getTask(task.taskId)?.version).toBe(20);
    } finally {
      close();
    }
  });
});
