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
      expect(() =>
        store.createTask({
          workspaceId: workspace.id,
          parentTaskId: child.taskId,
          title: 'Grandchild task',
          goal: 'This phase only supports one child level',
        }),
      ).toThrow(/one level/i);

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

  it('discards only an untouched placeholder and keeps real or parent tasks', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\discard-placeholder',
        name: 'Discard Placeholder',
      });
      const blank = store.createTask({
        workspaceId: workspace.id,
        title: '新任务',
        goal: '新任务',
      });
      expect(store.discardEmptyTask(blank.taskId, 0)).toBe(true);
      expect(store.getTask(blank.taskId)).toBeUndefined();

      const renamedBlank = store.createTask({
        workspaceId: workspace.id,
        title: '沿用下来的旧标题',
        goal: '沿用下来的旧目标',
      });
      expect(store.discardEmptyTask(renamedBlank.taskId, 0)).toBe(true);
      expect(store.getTask(renamedBlank.taskId)).toBeUndefined();

      const blankGroup = store.createTask({
        workspaceId: workspace.id,
        title: '新任务',
        goal: '新任务',
        participationMode: 'collaboration',
      });
      expect(blankGroup).toMatchObject({ taskVersion: 0, participationMode: 'collaboration' });
      expect(store.discardEmptyTask(blankGroup.taskId, blankGroup.taskVersion)).toBe(true);
      expect(store.getTask(blankGroup.taskId)).toBeUndefined();

      const legacyBlankGroup = store.createTask({
        workspaceId: workspace.id,
        title: '沿用下来的旧标题',
        goal: '沿用下来的旧目标',
      });
      const legacyGroupMode = store.setParticipationMode(
        legacyBlankGroup.taskId,
        'collaboration',
        legacyBlankGroup.taskVersion,
      );
      expect(store.discardEmptyTask(legacyBlankGroup.taskId, legacyGroupMode.version)).toBe(true);

      const parent = store.createTask({
        workspaceId: workspace.id,
        title: '新任务',
        goal: '新任务',
      });
      store.createTask({
        workspaceId: workspace.id,
        parentTaskId: parent.taskId,
        title: '子任务',
        goal: '子任务',
      });
      expect(store.discardEmptyTask(parent.taskId, 0)).toBe(false);
      expect(store.getTask(parent.taskId)).toBeTruthy();

      const started = store.createTask({
        workspaceId: workspace.id,
        title: '新任务',
        goal: '新任务',
      });
      store.advanceTaskVersionByThreadId(started.threadId, 0, '2026-07-19T00:00:00.000Z', {
        generatedTitle: '已经开始的任务',
        generatedGoal: '已经发送第一条消息',
      });
      expect(store.discardEmptyTask(started.taskId, 0)).toBe(false);
      expect(store.getTask(started.taskId)).toBeTruthy();
    } finally {
      close();
    }
  });

  it('reassigns only empty placeholder tasks across projects', async () => {
    const { store, raw, close } = await openStore();
    try {
      const source = store.createWorkspace({
        name: 'Chat Project',
      });
      const target = store.createWorkspace({
        folderPath: 'D:\\projects\\reassign-target',
        name: 'Code Project',
      });
      const blank = store.createTask({
        workspaceId: source.id,
        title: '新任务',
        goal: '新任务',
      });
      const moved = store.setEmptyTaskWorkspace(blank.taskId, target.id, 0);
      expect(moved).toMatchObject({
        id: blank.taskId,
        workspaceId: target.id,
        version: 1,
      });
      expect(store.getTask(blank.taskId)?.workspaceId).toBe(target.id);
      expect(store.listTasks(source.id)).toHaveLength(0);
      expect(store.listTasks(target.id).map((task) => task.id)).toContain(blank.taskId);

      const started = store.createTask({
        workspaceId: source.id,
        title: '新任务',
        goal: '新任务',
      });
      // Real conversation content must block in-place project reassignment.
      raw
        .prepare(
          `INSERT INTO message (id, thread_id, role, sequence, blocks_json, created_at)
           VALUES (?, ?, 'user', 0, ?, ?)`,
        )
        .run(
          'msg-started-1',
          started.threadId,
          JSON.stringify([{ type: 'text', text: 'hello' }]),
          '2026-07-20T00:00:00.000Z',
        );
      store.advanceTaskVersionByThreadId(started.threadId, 0, '2026-07-20T00:00:00.000Z', {
        generatedTitle: '已开始',
        generatedGoal: '已发送',
      });
      const startedVersion = store.getTask(started.taskId)!.version;
      expect(store.setEmptyTaskWorkspace(started.taskId, target.id, startedVersion)).toBeUndefined();
      expect(store.getTask(started.taskId)?.workspaceId).toBe(source.id);

      const parent = store.createTask({
        workspaceId: source.id,
        title: '新任务',
        goal: '新任务',
      });
      store.createTask({
        workspaceId: source.id,
        parentTaskId: parent.taskId,
        title: '子任务',
        goal: '子任务',
      });
      expect(store.setEmptyTaskWorkspace(parent.taskId, target.id, 0)).toBeUndefined();
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
      const persistedTask = store.getTask(task.taskId);
      expect(persistedTask?.lastOpenedAt).toBeUndefined();
      const contentUpdatedAt = persistedTask?.updatedAt;

      const opened = store.openTask(task.taskId, '2026-07-18T12:00:00.000Z');
      expect(opened.lastOpenedAt).toBe('2026-07-18T12:00:00.000Z');
      expect(opened.updatedAt).toBe(contentUpdatedAt);
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
        raw.prepare("SELECT COUNT(*) AS count FROM task WHERE title = 'Invalid criteria'").get(),
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

describe('SqliteWorkspaceStore execution mode', () => {
  it('defaults new tasks to workspace execution mode', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\execution-default',
        name: 'Execution Default',
      });
      const created = store.createTask({
        workspaceId: workspace.id,
        title: 'Default execution',
        goal: 'Start in workspace mode',
      });

      expect(created.executionMode).toBe('workspace');
      expect(store.getTask(created.taskId)).toMatchObject({
        executionMode: 'workspace',
        version: 0,
      });
    } finally {
      close();
    }
  });

  it('updates execution mode with optimistic task versioning', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\execution-version',
        name: 'Execution Version',
      });
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Versioned execution',
        goal: 'Reject stale writers',
      });

      const changed = store.setExecutionMode(
        task.taskId,
        'full-access',
        task.taskVersion,
        '2026-07-20T01:00:00.000Z',
      );
      expect(changed).toMatchObject({
        executionMode: 'full-access',
        version: 1,
        updatedAt: '2026-07-20T01:00:00.000Z',
      });

      expect(() =>
        store.setExecutionMode(
          task.taskId,
          'read-only',
          task.taskVersion,
          '2026-07-20T01:01:00.000Z',
        ),
      ).toThrow(/task version conflict/i);
      expect(store.getTask(task.taskId)).toMatchObject({
        executionMode: 'full-access',
        version: 1,
      });
    } finally {
      close();
    }
  });

  it('inherits parent execution mode for child tasks', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\execution-inherit',
        name: 'Execution Inherit',
      });
      const parent = store.createTask({
        workspaceId: workspace.id,
        title: 'Parent',
        goal: 'Parent task',
        executionMode: 'read-only',
      });
      const child = store.createTask({
        workspaceId: workspace.id,
        parentTaskId: parent.taskId,
        title: 'Child',
        goal: 'Child inherits parent mode',
      });
      expect(child.executionMode).toBe('read-only');
      expect(store.getTask(child.taskId)?.executionMode).toBe('read-only');
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

      expect(store.reconcileTaskVersionsFromMessageEvents('2026-07-13T06:11:00.000Z')).toBe(1);
      expect(store.getTask(task.taskId)).toMatchObject({
        version: 18,
        updatedAt: '2026-07-13T06:11:00.000Z',
      });

      raw.prepare('UPDATE task SET version = 20 WHERE id = ?').run(task.taskId);
      expect(store.reconcileTaskVersionsFromMessageEvents('2026-07-13T06:12:00.000Z')).toBe(0);
      expect(store.getTask(task.taskId)?.version).toBe(20);
    } finally {
      close();
    }
  });
});


describe('SqliteWorkspaceStore project default and child mode sync', () => {
  it('inherits project default execution mode for new root tasks', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\project-default-mode',
        name: 'Project Default Mode',
        defaultExecutionMode: 'full-access',
      });
      expect(workspace.defaultExecutionMode).toBe('full-access');
      const task = store.createTask({
        workspaceId: workspace.id,
        title: 'Root inherits project',
        goal: 'Use project default',
      });
      expect(task.executionMode).toBe('full-access');
      // Explicit task mode is not overwritten by project default
      const explicit = store.createTask({
        workspaceId: workspace.id,
        title: 'Explicit mode',
        goal: 'Override project',
        executionMode: 'read-only',
      });
      expect(explicit.executionMode).toBe('read-only');
    } finally {
      close();
    }
  });

  it('updates non-terminal children when parent live mode changes', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({
        folderPath: 'D:\\projects\\parent-live-mode',
        name: 'Parent Live Mode',
      });
      const parent = store.createTask({
        workspaceId: workspace.id,
        title: 'Parent',
        goal: 'Parent goal',
        executionMode: 'workspace',
      });
      const liveChild = store.createTask({
        workspaceId: workspace.id,
        parentTaskId: parent.taskId,
        title: 'Live child',
        goal: 'Follow parent',
      });
      const completedChild = store.createTask({
        workspaceId: workspace.id,
        parentTaskId: parent.taskId,
        title: 'Completed child',
        goal: 'Stay put',
      });
      store.setTaskStatus(completedChild.taskId, 'completed', 0);
      const cascade = store.setExecutionModeWithChildInheritance(
        parent.taskId,
        'full-access',
        0,
      );
      expect(cascade.task.executionMode).toBe('full-access');
      expect(cascade.inheritedChildren).toHaveLength(1);
      expect(cascade.inheritedChildren[0]?.task.id).toBe(liveChild.taskId);
      expect(cascade.inheritedChildren[0]?.task.executionMode).toBe('full-access');
      expect(store.getTask(completedChild.taskId)?.executionMode).toBe('workspace');
    } finally {
      close();
    }
  });

  it('persists workspace default execution mode updates', async () => {
    const { store, close } = await openStore();
    try {
      const workspace = store.createWorkspace({ name: 'Default update' });
      expect(workspace.defaultExecutionMode).toBe('workspace');
      const updated = store.setWorkspaceDefaultExecutionMode(workspace.id, 'read-only');
      expect(updated.defaultExecutionMode).toBe('read-only');
      expect(store.getWorkspace(workspace.id)?.defaultExecutionMode).toBe('read-only');
    } finally {
      close();
    }
  });
});
