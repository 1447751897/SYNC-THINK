import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskId, ThreadId, WorkspaceId } from '@sync-think/shared';
import { ulid, type Event } from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteWorkspaceStore, workspaceIconFromPrefs } from './workspace-store.js';

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

function insertMessage(raw: BetterSQLite3Raw, threadId: ThreadId, sequence: number): void {
  raw
    .prepare(
      `INSERT INTO message (
        id, thread_id, role, agent_version_id, model_id, credential_ref_id,
        run_id, step_id, sequence, blocks_json, created_at
      ) VALUES (?, ?, 'user', NULL, NULL, NULL, NULL, NULL, ?, '[]', ?)`,
    )
    .run(
      `message-${threadId}-${sequence}`,
      threadId,
      sequence,
      `2026-08-02T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    );
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
  it('creates a project without a folder and binds exactly one canonical folder later', async () => {
    const { store, close } = await openStore();
    try {
      const project = store.createWorkspace({ name: 'Unbound Project' });
      expect(project.folderPath).toBeUndefined();
      expect(store.listWorkspaces()).toEqual([
        expect.objectContaining({ id: project.id, name: 'Unbound Project', folderPath: undefined }),
      ]);

      const bound = store.bindWorkspaceFolder({
        workspaceId: project.id,
        folderPath: 'D:\\projects\\bound-project\\.',
      });
      expect(bound.folderPath).toMatch(/^[A-Za-z]:\\projects\\bound-project$/i);
      expect(
        store.bindWorkspaceFolder({
          workspaceId: project.id,
          folderPath: 'D:\\projects\\bound-project',
        }),
      ).toEqual(bound);
      expect(() =>
        store.bindWorkspaceFolder({
          workspaceId: project.id,
          folderPath: 'D:\\projects\\different-project',
        }),
      ).toThrow(/already has a folder/i);
    } finally {
      close();
    }
  });

  it('does not bind one canonical folder to two projects', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.createWorkspace({ name: 'First' });
      const second = store.createWorkspace({ name: 'Second' });
      store.bindWorkspaceFolder({
        workspaceId: first.id,
        folderPath: 'D:\\projects\\shared-binding',
      });
      expect(() =>
        store.bindWorkspaceFolder({
          workspaceId: second.id,
          folderPath: 'D:\\projects\\shared-binding\\.',
        }),
      ).toThrow(/already exists/i);
    } finally {
      close();
    }
  });

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
  it('generates a placeholder task identity in the first version transition only', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Generated identity' });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: '新任务',
        goal: '新任务',
      });
      const advanced = store.advanceTaskVersionByThreadId(task.threadId, 0, undefined, {
        generatedTitle: '修复登录流程',
        generatedGoal: '请修复登录流程并补充测试',
      });
      expect(advanced).toMatchObject({
        title: '修复登录流程',
        goal: '请修复登录流程并补充测试',
        version: 1,
      });
      const second = store.advanceTaskVersionByThreadId(task.threadId, 1, undefined, {
        generatedTitle: '不应覆盖',
        generatedGoal: '不应覆盖',
      });
      expect(second).toMatchObject({ title: '修复登录流程', version: 2 });
    } finally {
      close();
    }
  });

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

  it('raises task versions from task-indexed legacy events without lowering newer rows', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Indexed event floor project' });
      const first = store.createTask({
        workspaceId: workspace.id,
        title: 'Lagging indexed task',
        goal: 'Recover an event-only version',
      });
      const second = store.createTask({
        workspaceId: workspace.id,
        title: 'Newer indexed task',
        goal: 'Keep its newer durable version',
      });
      const events = new SqliteEventCheckpointStore(raw);
      events.commitTransition({
        events: [
          {
            id: ulid() as Event['id'],
            workspaceId: workspace.id,
            taskId: first.taskId,
            category: 'system',
            type: 'task.participation-mode.changed',
            occurredAt: '2026-08-02T08:05:00.000Z',
            payload: { taskId: first.taskId, taskVersion: 6 },
          },
          {
            id: ulid() as Event['id'],
            workspaceId: workspace.id,
            taskId: second.taskId,
            messageId: ulid() as Event['messageId'],
            category: 'message',
            type: 'message.appended',
            occurredAt: '2026-08-02T08:06:00.000Z',
            payload: { threadId: second.threadId, taskVersion: 4 },
          },
        ],
      });
      raw.prepare('UPDATE task SET version = 9 WHERE id = ?').run(second.taskId);

      expect(
        store.reconcileTaskVersionFloorsFromTaskEvents('2026-08-02T08:07:00.000Z'),
      ).toBe(1);
      expect(store.getTask(first.taskId)?.version).toBe(6);
      expect(store.getTask(second.taskId)?.version).toBe(9);
    } finally {
      close();
    }
  });

  it('raises a task version to its latest durable message sequence', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Message floor project' });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Lagging task',
        goal: 'Recover its durable message floor',
      });
      insertMessage(raw, task.threadId, 3);
      insertMessage(raw, task.threadId, 8);
      raw.prepare('UPDATE task SET version = 1 WHERE id = ?').run(task.taskId);

      expect(
        store.reconcileTaskVersionFloorsFromMessages('2026-08-02T08:10:00.000Z'),
      ).toBe(1);
      expect(store.getTask(task.taskId)).toMatchObject({
        version: 8,
        updatedAt: '2026-08-02T08:10:00.000Z',
      });
    } finally {
      close();
    }
  });

  it('does not lower a task version that is newer than its message floor', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Newer version project' });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Newer task',
        goal: 'Keep non-message version advances',
        now: '2026-08-02T08:20:00.000Z',
      });
      insertMessage(raw, task.threadId, 4);
      raw.prepare('UPDATE task SET version = 9 WHERE id = ?').run(task.taskId);

      expect(
        store.reconcileTaskVersionFloorsFromMessages('2026-08-02T08:21:00.000Z'),
      ).toBe(0);
      expect(store.getTask(task.taskId)).toMatchObject({
        version: 9,
        updatedAt: '2026-08-02T08:20:00.000Z',
      });
    } finally {
      close();
    }
  });

  it('leaves tasks without durable messages unchanged', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Empty thread project' });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Empty task',
        goal: 'Remain at its current version',
        now: '2026-08-02T08:30:00.000Z',
      });

      expect(
        store.reconcileTaskVersionFloorsFromMessages('2026-08-02T08:31:00.000Z'),
      ).toBe(0);
      expect(store.getTask(task.taskId)).toMatchObject({
        version: 0,
        updatedAt: '2026-08-02T08:30:00.000Z',
      });
    } finally {
      close();
    }
  });

  it('isolates message floors per task without reading the event table', async () => {
    const { store, raw, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Isolated floors project' });
      const first = store.createTask({
        workspaceId: workspace.id,
        title: 'First task',
        goal: 'Recover independently',
      });
      const second = store.createTask({
        workspaceId: workspace.id,
        title: 'Second task',
        goal: 'Recover independently',
      });
      insertMessage(raw, first.threadId, 5);
      insertMessage(raw, second.threadId, 11);
      raw.exec('DROP TABLE event');

      expect(
        store.reconcileTaskVersionFloorsFromMessages('2026-08-02T08:40:00.000Z'),
      ).toBe(2);
      expect(store.getTask(first.taskId)?.version).toBe(5);
      expect(store.getTask(second.taskId)?.version).toBe(11);
    } finally {
      close();
    }
  });

  it('persists custom sortOrder and lists workspaces in that order', async () => {
    const { store, close } = await openStore();
    try {
      const a = store.createWorkspace({ name: 'Alpha' });
      const b = store.createWorkspace({ name: 'Beta' });
      const c = store.createWorkspace({ name: 'Gamma' });
      // Natural creation order: a, b, c. Reorder to c, a, b.
      store.updateWorkspace({ workspaceId: c.id, sortOrder: 0 });
      store.updateWorkspace({ workspaceId: a.id, sortOrder: 1 });
      store.updateWorkspace({ workspaceId: b.id, sortOrder: 2 });
      expect(
        store.listWorkspaces().map((w) => w.id),
      ).toEqual([c.id, a.id, b.id]);
    } finally {
      close();
    }
  });

  it('trails workspaces without sortOrder behind positioned ones by creation order', async () => {
    const { store, close } = await openStore();
    try {
      const a = store.createWorkspace({ name: 'Alpha' });
      const b = store.createWorkspace({ name: 'Beta' });
      const c = store.createWorkspace({ name: 'Gamma' });
      store.updateWorkspace({ workspaceId: c.id, sortOrder: 0 });
      expect(
        store.listWorkspaces().map((w) => w.id),
      ).toEqual([c.id, a.id, b.id]);
    } finally {
      close();
    }
  });

  it('keeps icon and sortOrder together in ui prefs', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Iconic' });
      const withIcon = store.updateWorkspace({
        workspaceId: workspace.id,
        icon: '🚀',
        sortOrder: 3,
      });
      expect(store.listWorkspaces()).toEqual([
        expect.objectContaining({
          id: workspace.id,
          name: 'Iconic',
          sortOrder: 3,
        }),
      ]);
      // Updating the icon alone must not drop sortOrder and vice versa.
      store.updateWorkspace({ workspaceId: workspace.id, icon: '🧠' });
      const refreshed = store.listWorkspaces().find((w) => w.id === workspace.id);
      expect(refreshed?.sortOrder).toBe(3);
      void withIcon;
    } finally {
      close();
    }
  });

  it('persists hidden flag without deleting the workspace', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Sneaky' });
      const hidden = store.updateWorkspace({ workspaceId: workspace.id, hidden: true });
      expect(hidden.hidden).toBe(true);
      // The row still exists with all its data — hidden is a display-only flag.
      expect(store.listWorkspaces()).toEqual([
        expect.objectContaining({ id: workspace.id, name: 'Sneaky', hidden: true }),
      ]);
      // Unhide clears the flag and keeps everything else intact.
      const shown = store.updateWorkspace({ workspaceId: workspace.id, hidden: false });
      expect(shown.hidden).toBe(false);
      expect(store.getWorkspace(workspace.id)?.name).toBe('Sneaky');
    } finally {
      close();
    }
  });

  it('keeps icon and hidden together in ui prefs', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Iconic Hidden' });
      store.updateWorkspace({ workspaceId: workspace.id, icon: '🚀', hidden: true });
      // Updating the icon alone must not drop hidden and vice versa.
      store.updateWorkspace({ workspaceId: workspace.id, icon: '🧠' });
      const refreshed = store.listWorkspaces().find((w) => w.id === workspace.id);
      expect(refreshed?.hidden).toBe(true);
      expect(workspaceIconFromPrefs(refreshed?.uiPrefsJson)).toBe('🧠');
    } finally {
      close();
    }
  });
});
