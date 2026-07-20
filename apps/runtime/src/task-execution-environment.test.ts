import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteExecutionEnvironmentStore, SqliteWorkspaceStore } from '@sync-think/storage';
import { TaskExecutionEnvironmentManager } from './task-execution-environment.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'SYNC-THINK Test',
      GIT_AUTHOR_EMAIL: 'sync-think@example.invalid',
      GIT_COMMITTER_NAME: 'SYNC-THINK Test',
      GIT_COMMITTER_EMAIL: 'sync-think@example.invalid',
    },
  });
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-worktree-manager-'));
  tempDirs.push(root);
  const repository = join(root, 'repo');
  const worktrees = join(root, 'worktrees');
  const cache = join(root, 'repo-cache');
  const browser = join(root, 'browser');
  execFileSync('git', ['init', repository], { windowsHide: true });
  writeFileSync(join(repository, 'README.md'), 'base\n');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'initial']);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const executionStore = new SqliteExecutionEnvironmentStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ name: 'Repo', folderPath: repository });
  executionStore.ensureWorkspaceDefaults({
    workspaceId: workspace.id,
    folderPath: workspace.folderPath,
    browserProfilePath: browser,
  });
  const manager = new TaskExecutionEnvironmentManager({
    store: executionStore,
    workspaceStore,
    worktreeRoot: worktrees,
    repositoryCacheRoot: cache,
    browserProfileRoot: join(root, 'browser-profiles'),
  });
  return { root, repository, workspace, workspaceStore, executionStore, manager, close: () => connection.raw.close() };
}

describe('TaskExecutionEnvironmentManager', () => {
  it('creates and reuses one detached managed worktree per Git-backed task', async () => {
    const fixture = await setup();
    try {
      const task = fixture.workspaceStore.createTask({
        workspaceId: fixture.workspace.id,
        title: 'Task',
        goal: 'Implement',
      });
      fixture.executionStore.createTaskContext({ taskId: task.taskId, workspaceId: fixture.workspace.id });
      const first = fixture.manager.prepareTask(task.taskId);
      const second = fixture.manager.prepareTask(task.taskId);
      expect(first.mode).toBe('managed_worktree');
      expect(first.executionPath).toBe(second.executionPath);
      expect(first.executionPath && existsSync(first.executionPath)).toBe(true);
      expect(first.executionPath && git(first.executionPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD');
    } finally {
      fixture.close();
    }
  });

  it('creates separate child worktrees and carries the parent dirty snapshot', async () => {
    const fixture = await setup();
    try {
      const parent = fixture.workspaceStore.createTask({ workspaceId: fixture.workspace.id, title: 'Parent', goal: 'Parent' });
      fixture.executionStore.createTaskContext({ taskId: parent.taskId, workspaceId: fixture.workspace.id });
      const parentContext = fixture.manager.prepareTask(parent.taskId);
      writeFileSync(join(parentContext.executionPath!, 'README.md'), 'parent change\n');
      const child = fixture.workspaceStore.createTask({
        workspaceId: fixture.workspace.id,
        parentTaskId: parent.taskId,
        title: 'Child',
        goal: 'Child',
      });
      fixture.executionStore.createTaskContext({
        taskId: child.taskId,
        workspaceId: fixture.workspace.id,
        parentTaskId: parent.taskId,
      });
      const childContext = fixture.manager.prepareTask(child.taskId);
      expect(childContext.executionPath).not.toBe(parentContext.executionPath);
      expect(readFileSync(join(childContext.executionPath!, 'README.md'), 'utf8')).toBe('parent change\n');
      expect(git(childContext.executionPath!, ['status', '--porcelain']).trim()).toBe('');

      writeFileSync(join(childContext.executionPath!, 'child.txt'), 'child result\n');
      const integration = fixture.manager.integrateChildTask(child.taskId);
      expect(integration).toMatchObject({
        integrationStatus: 'integrated',
        targetTaskId: parent.taskId,
        changedFiles: ['child.txt'],
      });
      expect(readFileSync(join(parentContext.executionPath!, 'README.md'), 'utf8')).toBe('parent change\n');
      expect(readFileSync(join(parentContext.executionPath!, 'child.txt'), 'utf8').replaceAll('\r\n', '\n')).toBe('child result\n');
    } finally {
      fixture.close();
    }
  });

  it('retains a real cherry-pick conflict and resolves it with either task version', async () => {
    const fixture = await setup();
    try {
      const parent = fixture.workspaceStore.createTask({ workspaceId: fixture.workspace.id, title: 'Parent', goal: 'Parent' });
      fixture.executionStore.createTaskContext({ taskId: parent.taskId, workspaceId: fixture.workspace.id });
      const parentContext = fixture.manager.prepareTask(parent.taskId);
      const child = fixture.workspaceStore.createTask({
        workspaceId: fixture.workspace.id,
        parentTaskId: parent.taskId,
        title: 'Child',
        goal: 'Child',
      });
      fixture.executionStore.createTaskContext({
        taskId: child.taskId,
        workspaceId: fixture.workspace.id,
        parentTaskId: parent.taskId,
      });
      const childContext = fixture.manager.prepareTask(child.taskId);
      writeFileSync(join(parentContext.executionPath!, 'README.md'), 'parent current\n');
      writeFileSync(join(childContext.executionPath!, 'README.md'), 'child current\n');

      const conflict = fixture.manager.integrateChildTask(child.taskId);
      expect(conflict).toMatchObject({
        integrationStatus: 'conflicted',
        conflictFiles: ['README.md'],
      });
      const resolved = fixture.manager.resolveChildIntegration(child.taskId, 'accept-child');
      expect(resolved.integrationStatus).toBe('integrated');
      expect(readFileSync(join(parentContext.executionPath!, 'README.md'), 'utf8').replaceAll('\r\n', '\n')).toBe('child current\n');
    } finally {
      fixture.close();
    }
  });

  it('retains dirty expired worktrees instead of deleting them', async () => {
    const fixture = await setup();
    try {
      const task = fixture.workspaceStore.createTask({ workspaceId: fixture.workspace.id, title: 'Task', goal: 'Task' });
      fixture.executionStore.createTaskContext({ taskId: task.taskId, workspaceId: fixture.workspace.id });
      const context = fixture.manager.prepareTask(task.taskId);
      writeFileSync(join(context.executionPath!, 'README.md'), 'dirty\n');
      fixture.executionStore.scheduleCleanup(task.taskId, 7, new Date('2026-07-01T00:00:00.000Z'));
      const [result] = fixture.manager.cleanupExpired(new Date('2026-07-09T00:00:00.000Z'));
      expect(result?.state).toBe('retained');
      expect(result?.blockedReason).toContain('未提交');
      expect(existsSync(context.executionPath!)).toBe(true);
    } finally {
      fixture.close();
    }
  });
});
