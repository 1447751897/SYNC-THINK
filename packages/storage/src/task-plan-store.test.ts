import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteTaskPlanStore } from './task-plan-store.js';

const dirs: string[] = [];

async function openStores(): Promise<{
  store: SqliteTaskPlanStore;
  close: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-task-plan-'));
  dirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const database = await openDatabaseAsync({ path: dbPath });
  // Seed workspaces referenced by task_plan.workspace_id (FK restrict).
  for (const id of ['ws-alpha', 'ws-beta']) {
    database.raw
      .prepare(
        `INSERT OR IGNORE INTO workspace (id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at)
         VALUES (?, NULL, ?, NULL, NULL, ?, ?)`,
      )
      .run(id, id, '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
  }
  return {
    store: new SqliteTaskPlanStore(database.raw),
    close: () => database.raw.close(),
  };
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SqliteTaskPlanStore', () => {
  it('creates and lists checklist rows in sort order', async () => {
    const { store, close } = await openStores();
    try {
      store.create({ workspaceId: 'ws-alpha', title: '设计接口', priority: 'high' });
      store.create({ workspaceId: 'ws-alpha', title: '实现服务' });
      store.create({ workspaceId: 'ws-alpha', title: '补充测试', status: 'completed' });

      const list = store.list('ws-alpha');
      expect(list.map((t) => t.title)).toEqual(['设计接口', '实现服务', '补充测试']);
      expect(list[0]!.priority).toBe('high');
      expect(list[2]!.status).toBe('completed');
      // 其他工作区隔离
      expect(store.list('ws-beta')).toEqual([]);
    } finally {
      close();
    }
  });

  it('updates status with lifecycle timestamps and reorders', async () => {
    const { store, close } = await openStores();
    try {
      const task = store.create({ workspaceId: 'ws-alpha', title: '迁移数据' });
      expect(task.actualStartAt).toBeUndefined();

      const started = store.update({ taskId: task.id, status: 'in_progress' })!;
      expect(started.status).toBe('in_progress');
      expect(started.actualStartAt).toBeTruthy();

      const done = store.update({ taskId: task.id, status: 'completed' })!;
      expect(done.actualEndAt).toBeTruthy();

      const reordered = store.update({ taskId: task.id, sortOrder: 5 })!;
      expect(reordered.sortOrder).toBe(5);
    } finally {
      close();
    }
  });

  it('stores dependency edges and execution records', async () => {
    const { store, close } = await openStores();
    try {
      const base = store.create({ workspaceId: 'ws-alpha', title: '准备环境' });
      const child = store.create({
        workspaceId: 'ws-alpha',
        title: '构建发布',
        dependsOn: [base.id],
      });
      expect(child.dependsOn).toEqual([base.id]);

      const execution = store.startExecution({
        taskId: child.id,
        conversationId: 'conv-1',
      });
      expect(execution.status).toBe('running');

      const finished = store.finishExecution({
        executionId: execution.id,
        status: 'completed',
      })!;
      expect(finished.status).toBe('completed');
      expect(finished.finishedAt).toBeTruthy();
      expect(store.listExecutions(child.id).length).toBe(1);
    } finally {
      close();
    }
  });

  it('deletes a task with its edges and executions', async () => {
    const { store, close } = await openStores();
    try {
      const task = store.create({ workspaceId: 'ws-alpha', title: '临时任务' });
      store.startExecution({ taskId: task.id });
      expect(store.delete(task.id)).toBe(true);
      expect(store.get(task.id)).toBeUndefined();
      expect(store.listExecutions(task.id)).toEqual([]);
    } finally {
      close();
    }
  });
});
