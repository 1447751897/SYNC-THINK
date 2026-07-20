import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserIdentityId, RunId, TaskId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteExecutionEnvironmentStore } from './execution-environment-store.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteWorkspaceStore } from './workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStores() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-execution-store-'));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    root,
    workspaceStore: new SqliteWorkspaceStore(connection.raw),
    executionStore: new SqliteExecutionEnvironmentStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteExecutionEnvironmentStore', () => {
  it('creates an independent default profile, browser identity, resource, and task snapshot', async () => {
    const stores = await openStores();
    try {
      const folder = join(stores.root, 'project');
      const workspace = stores.workspaceStore.createWorkspace({ name: 'Project', folderPath: folder });
      const defaults = stores.executionStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(stores.root, 'browser-profile'),
      });
      expect(defaults.profile.retentionDays).toBe(7);
      expect(defaults.profile.browserIdentityId).toBe(defaults.browserIdentity.id);
      expect(defaults.resource).toMatchObject({ type: 'local_directory', localPath: folder });

      const task = stores.workspaceStore.createTask({
        workspaceId: workspace.id,
        title: 'Implement',
        goal: 'Create the feature',
      });
      const context = stores.executionStore.createTaskContext({
        taskId: task.taskId,
        workspaceId: workspace.id,
      });
      expect(context).toMatchObject({
        taskId: task.taskId,
        state: 'pending',
        mode: 'none',
        browserIdentityId: defaults.browserIdentity.id,
      });
    } finally {
      stores.close();
    }
  });

  it('updates the primary local resource when a Git remote is bound or changed', async () => {
    const stores = await openStores();
    try {
      const folder = join(stores.root, 'project');
      const workspace = stores.workspaceStore.createWorkspace({ name: 'Project', folderPath: folder });
      stores.executionStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(stores.root, 'browser-profile'),
      });

      const first = stores.executionStore.configureResource({
        workspaceId: workspace.id,
        type: 'git_repository',
        repositoryUrl: 'https://github.com/example/project.git',
        defaultRef: 'main',
      });
      const changed = stores.executionStore.configureResource({
        workspaceId: workspace.id,
        type: 'git_repository',
        repositoryUrl: 'https://github.com/example/project-renamed.git',
        defaultRef: 'develop',
      });

      expect(changed.id).toBe(first.id);
      expect(stores.executionStore.getPrimaryResource(workspace.id)).toMatchObject({
        id: first.id,
        type: 'git_repository',
        localPath: folder,
        repositoryUrl: 'https://github.com/example/project-renamed.git',
        defaultRef: 'develop',
      });
    } finally {
      stores.close();
    }
  });

  it('serializes write leases for tasks sharing a local directory', async () => {
    const stores = await openStores();
    try {
      const folder = join(stores.root, 'project');
      const workspace = stores.workspaceStore.createWorkspace({ name: 'Project', folderPath: folder });
      stores.executionStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(stores.root, 'browser-profile'),
      });
      const first = stores.workspaceStore.createTask({ workspaceId: workspace.id, title: 'A', goal: 'A' });
      const second = stores.workspaceStore.createTask({ workspaceId: workspace.id, title: 'B', goal: 'B' });
      for (const taskId of [first.taskId, second.taskId]) {
        stores.executionStore.createTaskContext({ taskId, workspaceId: workspace.id });
        stores.executionStore.markTaskReady({
          taskId,
          mode: 'local_serial',
          sourcePath: folder,
          executionPath: folder,
        });
      }
      stores.executionStore.acquireWriteLease(first.taskId, 'run-a' as RunId);
      expect(() =>
        stores.executionStore.acquireWriteLease(second.taskId, 'run-b' as RunId),
      ).toThrow(/directory_busy/);
      stores.executionStore.releaseWriteLease(first.taskId, 'run-a' as RunId);
      expect(stores.executionStore.acquireWriteLease(second.taskId, 'run-b' as RunId).leaseOwnerRunId).toBe('run-b');
    } finally {
      stores.close();
    }
  });

  it('manages independent browser identities and pins one to a task', async () => {
    const stores = await openStores();
    try {
      const folder = join(stores.root, 'project');
      const workspace = stores.workspaceStore.createWorkspace({ name: 'Project', folderPath: folder });
      const defaults = stores.executionStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(stores.root, 'browser-default'),
      });
      const task = stores.workspaceStore.createTask({ workspaceId: workspace.id, title: 'A', goal: 'A' });
      stores.executionStore.createTaskContext({ taskId: task.taskId, workspaceId: workspace.id });
      const identityId = 'browser-work' as BrowserIdentityId;
      stores.executionStore.createBrowserIdentity({
        id: identityId,
        name: '工作账号',
        profilePath: join(stores.root, 'browser-work'),
      });
      expect(stores.executionStore.setTaskBrowserIdentity(task.taskId, identityId).browserIdentityId).toBe(identityId);
      expect(() => stores.executionStore.deleteBrowserIdentity(identityId)).toThrow(/in_use/);
      stores.executionStore.setTaskBrowserIdentity(task.taskId, defaults.browserIdentity.id);
      expect(stores.executionStore.updateBrowserIdentity(identityId, { name: '发布账号', makeDefault: true })).toMatchObject({
        name: '发布账号',
        isDefault: true,
      });
      expect(stores.executionStore.getWorkspaceProfile(workspace.id)?.browserIdentityId).toBe(identityId);
      expect(() => stores.executionStore.deleteBrowserIdentity(identityId)).toThrow(/default_cannot_delete/);
    } finally {
      stores.close();
    }
  });

  it('schedules managed worktree cleanup exactly seven days after completion', async () => {
    const stores = await openStores();
    try {
      const folder = join(stores.root, 'project');
      const workspace = stores.workspaceStore.createWorkspace({ name: 'Project', folderPath: folder });
      stores.executionStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(stores.root, 'browser-profile'),
      });
      const task = stores.workspaceStore.createTask({ workspaceId: workspace.id, title: 'A', goal: 'A' });
      stores.executionStore.createTaskContext({ taskId: task.taskId, workspaceId: workspace.id });
      stores.executionStore.markTaskReady({
        taskId: task.taskId,
        mode: 'managed_worktree',
        sourcePath: folder,
        executionPath: join(stores.root, 'worktree'),
      });
      const context = stores.executionStore.scheduleCleanup(
        task.taskId as TaskId,
        7,
        new Date('2026-07-19T00:00:00.000Z'),
      );
      expect(context.state).toBe('cleanup_pending');
      expect(context.cleanupAfter).toBe('2026-07-26T00:00:00.000Z');
    } finally {
      stores.close();
    }
  });
});
