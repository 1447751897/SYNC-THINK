import { describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { openDatabaseAsync, runMigrations, SqliteWorkspaceStore } from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

function createFrameReader(sock: Socket): {
  read: (count: number) => Promise<Frame[]>;
} {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0].count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };

  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (e) {
      while (waiters.length > 0) waiters.shift()!.reject(e);
    }
  });
  sock.on('error', (e) => {
    while (waiters.length > 0) waiters.shift()!.reject(e);
  });
  sock.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });

  return {
    read(count: number) {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function writeAndRead(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  frame: Frame,
): Promise<Frame> {
  const next = reader.read(1);
  sock.write(encodeFrame(frame));
  return (await next)[0];
}

async function hello(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  installId: string,
): Promise<void> {
  const resp = await writeAndRead(sock, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: [
        'workspace.create',
        'workspace.list',
        'workspace.bindGitRepository',
        'agent.get',
        'browserIdentity.list',
        'browserIdentity.create',
        'browserIdentity.update',
        'browserIdentity.delete',
        'task.create',
        'task.setBrowserIdentity',
        'task.describeExecutionAccess',
        'task.list',
        'task.open',
        'task.search',
        'task.discardEmpty',
        'task.appendMessage',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('workspace IA commands', () => {
  it('lazily prepares execution access for a task created before execution contexts existed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-legacy-execution-context-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const legacyConnection = await openDatabaseAsync({ path: dbPath });
    const legacyWorkspaceStore = new SqliteWorkspaceStore(legacyConnection.raw);
    const workspace = legacyWorkspaceStore.createWorkspace({
      name: 'Legacy execution project',
      folderPath: dir,
    });
    const task = legacyWorkspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Legacy task',
      goal: 'Open after the execution environment upgrade',
    });
    legacyConnection.raw.close();

    const installId = `legacy-execution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({ dbPath, installId, allowNoToken: true });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const agent = await writeAndRead(sock, reader, {
        id: 'legacy-agent',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const agentVersionId = (agent.payload as { agent: { agentVersionId: string } }).agent
        .agentVersionId;

      const access = await writeAndRead(sock, reader, {
        id: 'legacy-access',
        kind: 'request',
        type: 'task.describeExecutionAccess',
        payload: { taskId: task.taskId, agentVersionId },
      });

      expect(access.error).toBeUndefined();
      expect(access.payload).toMatchObject({
        taskId: task.taskId,
        agentVersionId,
        executionMode: 'local_serial',
        executionState: 'ready',
      });
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('manages browser identities and reports the effective task execution access', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-browser-identity-'));
    tempDirs.push(dir);
    const installId = `browser-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const workspace = await writeAndRead(sock, reader, {
        id: 'browser-workspace',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Browser identity project' },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const bound = await writeAndRead(sock, reader, {
        id: 'browser-workspace-bind',
        kind: 'request',
        type: 'workspace.bindFolder',
        payload: { workspaceId, folderPath: join(dir, 'workspace') },
      });
      expect(bound.error).toBeUndefined();
      const task = await writeAndRead(sock, reader, {
        id: 'browser-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Browser task', goal: 'Use one browser profile' },
      });
      const taskId = (task.payload as { taskId: string }).taskId;

      const initial = await writeAndRead(sock, reader, {
        id: 'browser-list-initial',
        kind: 'request',
        type: 'browserIdentity.list',
        payload: {},
      });
      const defaultIdentity = (
        initial.payload as { identities: Array<{ id: string; name: string; isDefault: boolean }> }
      ).identities.find((identity) => identity.isDefault)!;
      expect(defaultIdentity).toBeDefined();

      const created = await writeAndRead(sock, reader, {
        id: 'browser-create',
        kind: 'request',
        type: 'browserIdentity.create',
        payload: { name: 'Work account' },
      });
      expect(created.error).toBeUndefined();
      const identityId = (created.payload as { identity: { id: string } }).identity.id;

      const updated = await writeAndRead(sock, reader, {
        id: 'browser-update',
        kind: 'request',
        type: 'browserIdentity.update',
        payload: { id: identityId, name: 'Project account', makeDefault: true },
      });
      expect(updated.payload).toMatchObject({
        identity: { id: identityId, name: 'Project account', isDefault: true },
      });

      const selected = await writeAndRead(sock, reader, {
        id: 'browser-select',
        kind: 'request',
        type: 'task.setBrowserIdentity',
        payload: { taskId, browserIdentityId: identityId },
      });
      expect(selected.payload).toMatchObject({
        taskId,
        browserIdentityId: identityId,
        browserIdentityName: 'Project account',
      });

      const agent = await writeAndRead(sock, reader, {
        id: 'browser-agent',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const agentVersionId = (agent.payload as { agent: { agentVersionId: string } }).agent
        .agentVersionId;
      const access = await writeAndRead(sock, reader, {
        id: 'browser-access',
        kind: 'request',
        type: 'task.describeExecutionAccess',
        payload: { taskId, agentVersionId },
      });
      expect(access.error).toBeUndefined();
      expect(access.payload).toMatchObject({
        taskId,
        agentVersionId,
        executionMode: 'local_serial',
        executionState: 'ready',
        browserIdentityId: identityId,
        browserIdentityName: 'Project account',
      });
      expect((access.payload as { effectiveToolNames: string[] }).effectiveToolNames).toEqual(
        expect.arrayContaining(['browser_navigate', 'desktop_snapshot']),
      );

      const referencedDelete = await writeAndRead(sock, reader, {
        id: 'browser-delete-referenced',
        kind: 'request',
        type: 'browserIdentity.delete',
        payload: { id: identityId },
      });
      expect(referencedDelete.error).toBeDefined();

      await writeAndRead(sock, reader, {
        id: 'browser-restore-default',
        kind: 'request',
        type: 'browserIdentity.update',
        payload: { id: defaultIdentity.id, makeDefault: true },
      });
      await writeAndRead(sock, reader, {
        id: 'browser-restore-task',
        kind: 'request',
        type: 'task.setBrowserIdentity',
        payload: { taskId, browserIdentityId: defaultIdentity.id },
      });
      const deleted = await writeAndRead(sock, reader, {
        id: 'browser-delete',
        kind: 'request',
        type: 'browserIdentity.delete',
        payload: { id: identityId },
      });
      expect(deleted.payload).toEqual({ id: identityId, deleted: true });
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('auto-names a placeholder task from its first user message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-task-title-'));
    tempDirs.push(dir);
    const installId = `task-title-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const workspace = await writeAndRead(sock, reader, {
        id: 'auto-title-workspace',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Auto title' },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const task = await writeAndRead(sock, reader, {
        id: 'auto-title-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: '新任务', goal: '新任务' },
      });
      const created = task.payload as { threadId: string };

      const appended = await writeAndRead(sock, reader, {
        id: 'auto-title-message',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: created.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '请帮我分析现有项目，然后修复登录流程并补充测试。',
        },
      });
      expect(appended.error).toBeUndefined();
      expect(appended.payload).toMatchObject({
        taskVersion: 1,
        taskTitle: '分析现有项目，然后修复登录流程并补充测试',
      });

      const listed = await writeAndRead(sock, reader, {
        id: 'auto-title-list',
        kind: 'request',
        type: 'task.list',
        payload: { workspaceId },
      });
      expect(
        (listed.payload as { tasks: Array<{ title: string; goal: string }> }).tasks[0],
      ).toMatchObject({
        title: '分析现有项目，然后修复登录流程并补充测试',
        goal: '请帮我分析现有项目，然后修复登录流程并补充测试。',
      });
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('discards an untouched placeholder task through the guarded Runtime command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-task-discard-empty-'));
    tempDirs.push(dir);
    const installId = `task-discard-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const workspace = await writeAndRead(sock, reader, {
        id: 'discard-workspace',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Discard empty task' },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const task = await writeAndRead(sock, reader, {
        id: 'discard-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: '新任务', goal: '新任务' },
      });
      const taskId = (task.payload as { taskId: string }).taskId;

      const discarded = await writeAndRead(sock, reader, {
        id: 'discard-empty',
        kind: 'request',
        type: 'task.discardEmpty',
        payload: { taskId, expectedTaskVersion: 0 },
      });
      expect(discarded.error).toBeUndefined();
      expect(discarded.payload).toEqual({ taskId, discarded: true });

      const listed = await writeAndRead(sock, reader, {
        id: 'discard-list',
        kind: 'request',
        type: 'task.list',
        payload: { workspaceId },
      });
      expect((listed.payload as { tasks: unknown[] }).tasks).toEqual([]);
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('creates an unbound project, creates a task, and binds one folder later', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-project-binding-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `project-binding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({ dbPath, installId, allowNoToken: true });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const createdProject = await writeAndRead(sock, reader, {
        id: 'project-create',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Project Atlas' },
      });
      expect(createdProject.error).toBeUndefined();
      expect(createdProject.payload).toMatchObject({ name: 'Project Atlas' });
      expect(createdProject.payload).not.toHaveProperty('folderPath');
      const workspaceId = (createdProject.payload as { workspaceId: string }).workspaceId;

      const createdTask = await writeAndRead(sock, reader, {
        id: 'project-task-create',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'First task', goal: 'Work before folder binding' },
      });
      expect(createdTask.error).toBeUndefined();
      const createdTaskPayload = createdTask.payload as { taskId: string; threadId: string };

      const openedTask = await writeAndRead(sock, reader, {
        id: 'project-task-open',
        kind: 'request',
        type: 'task.open',
        payload: { taskId: createdTaskPayload.taskId },
      });
      expect(openedTask.error).toBeUndefined();
      expect(openedTask.payload).toMatchObject({
        task: {
          taskId: createdTaskPayload.taskId,
          threadId: createdTaskPayload.threadId,
          workspaceId,
        },
      });

      const folderPath = join(dir, 'atlas-folder');
      const bound = await writeAndRead(sock, reader, {
        id: 'project-bind-folder',
        kind: 'request',
        type: 'workspace.bindFolder',
        payload: { workspaceId, folderPath },
      });
      expect(bound.error).toBeUndefined();
      expect(bound.payload).toMatchObject({ workspaceId, folderPath });

      const rebound = await writeAndRead(sock, reader, {
        id: 'project-rebind-folder',
        kind: 'request',
        type: 'workspace.bindFolder',
        payload: { workspaceId, folderPath: join(dir, 'other-folder') },
      });
      expect(rebound.error).toBeDefined();
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('binds a Git repository and gives a new task a persisted managed worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-project-git-'));
    tempDirs.push(dir);
    const repository = join(dir, 'repository');
    execFileSync('git', ['init', repository], { windowsHide: true });
    writeFileSync(join(repository, 'README.md'), 'base\n');
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'SYNC-THINK Test',
      GIT_AUTHOR_EMAIL: 'sync-think@example.invalid',
      GIT_COMMITTER_NAME: 'SYNC-THINK Test',
      GIT_COMMITTER_EMAIL: 'sync-think@example.invalid',
    };
    execFileSync('git', ['-C', repository, 'add', 'README.md'], { windowsHide: true, env: gitEnv });
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial'], {
      windowsHide: true,
      env: gitEnv,
    });
    const installId = `project-git-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const project = await writeAndRead(sock, reader, {
        id: 'git-project',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Git project' },
      });
      const workspaceId = (project.payload as { workspaceId: string }).workspaceId;
      const bound = await writeAndRead(sock, reader, {
        id: 'git-bind',
        kind: 'request',
        type: 'workspace.bindGitRepository',
        payload: { workspaceId, repositoryUrl: repository, defaultRef: 'HEAD' },
      });
      expect(bound.error).toBeUndefined();
      expect(bound.payload).toMatchObject({ workspaceId, resourceType: 'git_repository' });

      const created = await writeAndRead(sock, reader, {
        id: 'git-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Git task', goal: 'Use an isolated checkout' },
      });
      const taskId = (created.payload as { taskId: string }).taskId;
      let execution: { mode: string; state: string; executionPath?: string } | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const opened = await writeAndRead(sock, reader, {
          id: `git-open-${attempt}`,
          kind: 'request',
          type: 'task.open',
          payload: { taskId },
        });
        execution = (
          opened.payload as {
            task: { execution?: { mode: string; state: string; executionPath?: string } };
          }
        ).task.execution;
        if (execution?.state === 'ready') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(execution).toMatchObject({ mode: 'managed_worktree', state: 'ready' });
      expect(execution?.executionPath && existsSync(execution.executionPath)).toBe(true);
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('creates workspace/tasks, opens last task, and searches by goal text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-workspace-cmd-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);

    try {
      await hello(sock, reader, installId);

      const createdWorkspace = await writeAndRead(sock, reader, {
        id: 'ws-create',
        kind: 'request',
        type: 'workspace.create',
        payload: {
          folderPath: 'D:\\projects\\m1-workspace-ia',
          name: 'M1 Workspace',
        },
      });
      expect(createdWorkspace.error).toBeUndefined();
      expect(createdWorkspace.payload).toMatchObject({
        name: 'M1 Workspace',
      });
      const workspaceId = (createdWorkspace.payload as { workspaceId: string }).workspaceId;
      expect(workspaceId).toBeTruthy();

      const listedWorkspaces = await writeAndRead(sock, reader, {
        id: 'ws-list',
        kind: 'request',
        type: 'workspace.list',
        payload: {},
      });
      expect(listedWorkspaces.error).toBeUndefined();
      expect((listedWorkspaces.payload as { workspaces: unknown[] }).workspaces).toHaveLength(1);

      const createdTask = await writeAndRead(sock, reader, {
        id: 'task-create',
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: 'Provider adapters',
          goal: 'Wire OpenAI-compatible streaming',
        },
      });
      expect(createdTask.error).toBeUndefined();
      const taskId = (createdTask.payload as { taskId: string }).taskId;
      const threadId = (createdTask.payload as { threadId: string }).threadId;
      expect(taskId).toBeTruthy();
      expect(threadId).toBeTruthy();

      for (let version = 0; version < 2; version++) {
        const appended = await writeAndRead(sock, reader, {
          id: `task-append-${version + 1}`,
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId,
            expectedTaskVersion: version,
            role: 'user',
            text: `turn ${version + 1}`,
          },
        });
        expect(appended.error).toBeUndefined();
        expect(appended.payload).toMatchObject({ taskVersion: version + 1 });
      }

      const listedTasks = await writeAndRead(sock, reader, {
        id: 'task-list',
        kind: 'request',
        type: 'task.list',
        payload: { workspaceId },
      });
      expect(listedTasks.error).toBeUndefined();
      const listed = (listedTasks.payload as { tasks: Array<{ taskVersion: number }> }).tasks;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.taskVersion).toBe(2);

      const opened = await writeAndRead(sock, reader, {
        id: 'task-open',
        kind: 'request',
        type: 'task.open',
        payload: { taskId },
      });
      expect(opened.error).toBeUndefined();
      expect(
        (opened.payload as { task: { lastOpenedAt?: string; taskVersion: number } }).task,
      ).toMatchObject({ taskVersion: 2 });
      expect(
        (opened.payload as { task: { lastOpenedAt?: string } }).task.lastOpenedAt,
      ).toBeTruthy();

      const searched = await writeAndRead(sock, reader, {
        id: 'task-search',
        kind: 'request',
        type: 'task.search',
        payload: { workspaceId, query: 'streaming' },
      });
      expect(searched.error).toBeUndefined();
      const hits = (searched.payload as { tasks: Array<{ title: string }> }).tasks;
      expect(hits).toHaveLength(1);
      expect(hits[0]?.title).toBe('Provider adapters');

      const rejectedPath = await writeAndRead(sock, reader, {
        id: 'ws-create-bad',
        kind: 'request',
        type: 'workspace.create',
        payload: {
          folderPath: 'relative\\not-allowed',
          name: 'Bad',
        },
      });
      expect(rejectedPath.error?.code).toBe('security.path_traversal');
    } finally {
      sock.destroy();
      await session.close();
    }
  });
});
