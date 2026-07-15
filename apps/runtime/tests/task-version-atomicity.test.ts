import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
} from '@sync-think/protocol';
import { ulid, type Event, type WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqlitePolicyStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistentRuntime } from '../src/persistence.js';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixturePaths(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return {
    dir,
    dbPath: join(dir, 'sync-think.db'),
    secureStoreKeyPath: join(dir, 'secure-store-key.bin'),
  };
}

function createFrameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (error: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };
  socket.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (error) {
      while (waiters.length > 0) waiters.shift()!.reject(error);
    }
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()!.reject(error);
  });
  socket.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });
  return {
    read(count: number): Promise<Frame[]> {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function send(
  socket: Socket,
  reader: ReturnType<typeof createFrameReader>,
  id: string,
  type: string,
  payload: unknown,
): Promise<Frame> {
  const response = reader.read(1);
  socket.write(encodeFrame({ id, kind: 'request', type, payload }));
  return (await response)[0]!;
}

async function connectAndHello(installId: string) {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const reader = createFrameReader(socket);
  const hello = await send(socket, reader, 'hello', '__hello', {
    protocolVersion: 2,
    appVersion: '0.0.1',
    installId,
    nonce: randomBytes(8).toString('hex'),
    features: [
      'workspace.create',
      'task.create',
      'task.list',
      'task.open',
      'task.appendMessage',
      'task.setParticipationMode',
      'policy.save',
    ],
  });
  expect(hello.payload).toMatchObject({ ok: true });
  return { socket, reader };
}

describe('Runtime task version and transaction atomicity', () => {
  it('rolls back mode, policy, message version, events, and checkpoints when state persistence throws', async () => {
    const paths = makeFixturePaths('sync-think-atomic-domain-');
    await runMigrations(paths.dbPath);
    const connection = await openDatabaseAsync({ path: paths.dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const policyStore = new SqlitePolicyStore(connection.raw);
    const persistedState = new SqliteEventCheckpointStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({
      folderPath: paths.dir,
      name: 'Atomic domain',
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Atomic task',
      goal: 'Roll back every domain write',
    });
    const throwingStateStore: RuntimeStateStore = {
      commitTransition(input) {
        persistedState.commitTransition(input);
        throw new Error('forced state-store failure');
      },
      listEvents(workspaceId, afterSequence) {
        return persistedState.listEvents(workspaceId, afterSequence);
      },
      loadLatestCheckpoint(runId) {
        return persistedState.loadLatestCheckpoint(runId);
      },
    };
    const installId = `atomic-${randomBytes(5).toString('hex')}`;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      workspaceId: workspace.id,
      workspaceStore,
      policyStore,
      stateStore: throwingStateStore,
      unitOfWork: new SqliteUnitOfWork(connection.raw),
    });
    await runtime.start();
    const { socket, reader } = await connectAndHello(installId);

    try {
      const mode = await send(socket, reader, 'mode-fail', 'task.setParticipationMode', {
        taskId: task.taskId,
        mode: 'collaboration',
        expectedTaskVersion: 0,
      });
      const policy = await send(socket, reader, 'policy-fail', 'policy.save', {
        workspaceId: workspace.id,
        policyId: 'policy-atomic',
        scopeType: 'workspace',
        scopeId: workspace.id,
        approvalMode: 'full',
        rules: [],
      });
      const append = await send(socket, reader, 'append-fail', 'task.appendMessage', {
        threadId: task.threadId,
        expectedTaskVersion: 0,
        role: 'user',
        text: 'must roll back',
      });

      expect(mode.error).toMatchObject({ code: 'storage.write_failed' });
      expect(policy.error).toMatchObject({ code: 'storage.write_failed' });
      expect(append.error).toMatchObject({ code: 'storage.write_failed' });
      expect(workspaceStore.getTask(task.taskId)).toMatchObject({
        participationMode: 'conversation',
        version: 0,
      });
      expect(policyStore.listLatest()).toEqual([]);
      expect(persistedState.listEvents(workspace.id, 0)).toEqual([]);
      expect(runtime.createCheckpoint()).toMatchObject({
        eventSequence: 0,
        threadVersions: [],
        events: [],
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('advances append then mode through the SQLite task version and preserves it after restart', async () => {
    const paths = makeFixturePaths('sync-think-task-version-');
    const firstInstallId = `version-first-${randomBytes(5).toString('hex')}`;
    const first = await openPersistentRuntime({
      ...paths,
      installId: firstInstallId,
      allowNoToken: true,
    });
    await first.runtime.start();
    const firstClient = await connectAndHello(firstInstallId);
    let workspaceId = '';
    let taskId = '';
    let threadId = '';
    try {
      const workspace = await send(
        firstClient.socket,
        firstClient.reader,
        'workspace-create',
        'workspace.create',
        { folderPath: paths.dir, name: 'Version workspace' },
      );
      workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const task = await send(firstClient.socket, firstClient.reader, 'task-create', 'task.create', {
        workspaceId,
        title: 'Versioned task',
        goal: 'Use one durable version',
      });
      taskId = (task.payload as { taskId: string }).taskId;
      threadId = (task.payload as { threadId: string }).threadId;

      const appended = await send(
        firstClient.socket,
        firstClient.reader,
        'append-1',
        'task.appendMessage',
        { threadId, expectedTaskVersion: 0, role: 'user', text: 'version one' },
      );
      expect(appended.payload).toMatchObject({ taskVersion: 1 });

      const mode = await send(
        firstClient.socket,
        firstClient.reader,
        'mode-2',
        'task.setParticipationMode',
        { taskId, mode: 'collaboration', expectedTaskVersion: 1 },
      );
      expect(mode.payload).toMatchObject({
        task: { taskVersion: 2, participationMode: 'collaboration' },
      });

      const stale = await send(
        firstClient.socket,
        firstClient.reader,
        'mode-stale',
        'task.setParticipationMode',
        { taskId, mode: 'conversation', expectedTaskVersion: 1 },
      );
      expect(stale.error).toMatchObject({ code: 'task.version_mismatch' });

      const listed = await send(firstClient.socket, firstClient.reader, 'list-before', 'task.list', {
        workspaceId,
      });
      expect(listed.payload).toMatchObject({ tasks: [{ taskId, taskVersion: 2 }] });
    } finally {
      firstClient.socket.destroy();
      await first.close();
    }

    const database = await openDatabaseAsync({ path: paths.dbPath });
    try {
      expect(new SqliteWorkspaceStore(database.raw).getTask(taskId as never)?.version).toBe(2);
    } finally {
      database.raw.close();
    }

    const secondInstallId = `version-second-${randomBytes(5).toString('hex')}`;
    const second = await openPersistentRuntime({
      ...paths,
      installId: secondInstallId,
      allowNoToken: true,
    });
    await second.runtime.start();
    const secondClient = await connectAndHello(secondInstallId);
    try {
      const listed = await send(secondClient.socket, secondClient.reader, 'list-after', 'task.list', {
        workspaceId,
      });
      expect(listed.payload).toMatchObject({
        tasks: [{ taskId, taskVersion: 2, participationMode: 'collaboration' }],
      });
      const opened = await send(secondClient.socket, secondClient.reader, 'open-after', 'task.open', {
        taskId,
      });
      expect(opened.payload).toMatchObject({
        task: { taskId, taskVersion: 2, participationMode: 'collaboration' },
      });
    } finally {
      secondClient.socket.destroy();
      await second.close();
    }
  });

  it('repairs a historical mode event version before accepting the next mutation', async () => {
    const paths = makeFixturePaths('sync-think-mode-version-repair-');
    await runMigrations(paths.dbPath);
    const seed = await openDatabaseAsync({ path: paths.dbPath });
    const workspaceStore = new SqliteWorkspaceStore(seed.raw);
    const workspace = workspaceStore.createWorkspace({
      folderPath: paths.dir,
      name: 'Mode repair workspace',
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Mode repair task',
      goal: 'Continue after historical mode version 2',
    });
    new SqliteEventCheckpointStore(seed.raw).commitTransition({
      events: [
        {
          id: ulid() as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          messageId: ulid() as Event['messageId'],
          category: 'message',
          type: 'message.appended',
          occurredAt: '2026-07-13T07:00:00.000Z',
          payload: { threadId: task.threadId, taskVersion: 1, text: 'history v1' },
        },
        {
          id: ulid() as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          category: 'system',
          type: 'task.participation-mode.changed',
          occurredAt: '2026-07-13T07:01:00.000Z',
          payload: {
            taskId: task.taskId,
            previousMode: 'conversation',
            participationMode: 'collaboration',
            taskVersion: 2,
          },
        },
      ],
    });
    seed.raw
      .prepare("UPDATE task SET participation_mode = 'collaboration', version = 1 WHERE id = ?")
      .run(task.taskId);
    seed.raw.close();

    const installId = `mode-repair-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      ...paths,
      installId,
      allowNoToken: true,
      workspaceId: workspace.id as WorkspaceId,
    });
    await session.runtime.start();
    const client = await connectAndHello(installId);
    try {
      const opened = await send(client.socket, client.reader, 'open-after-mode-repair', 'task.open', {
        taskId: task.taskId,
      });
      expect(opened.payload).toMatchObject({
        task: { taskVersion: 2, participationMode: 'collaboration' },
      });

      const mode = await send(
        client.socket,
        client.reader,
        'mode-after-mode-repair',
        'task.setParticipationMode',
        {
          taskId: task.taskId,
          mode: 'conversation',
          expectedTaskVersion: 2,
        },
      );
      expect(mode.error).toBeUndefined();
      expect(mode.payload).toMatchObject({
        task: { taskVersion: 3, participationMode: 'conversation' },
      });
    } finally {
      client.socket.destroy();
      await session.close();
    }

    const verified = await openDatabaseAsync({ path: paths.dbPath });
    try {
      expect(new SqliteWorkspaceStore(verified.raw).getTask(task.taskId)?.version).toBe(3);
    } finally {
      verified.raw.close();
    }
  });

  it('repairs a historical cache-only message version before accepting the next write', async () => {
    const paths = makeFixturePaths('sync-think-task-version-repair-');
    await runMigrations(paths.dbPath);
    const seed = await openDatabaseAsync({ path: paths.dbPath });
    const workspaceStore = new SqliteWorkspaceStore(seed.raw);
    const workspace = workspaceStore.createWorkspace({
      folderPath: paths.dir,
      name: 'Repair workspace',
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Repair task',
      goal: 'Continue from historical version 18',
    });
    new SqliteEventCheckpointStore(seed.raw).commitTransition({
      events: [
        {
          id: ulid() as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          messageId: ulid() as Event['messageId'],
          category: 'message',
          type: 'message.appended',
          occurredAt: '2026-07-13T07:00:00.000Z',
          payload: { threadId: task.threadId, taskVersion: 18, text: 'history' },
        },
      ],
    });
    seed.raw.close();

    const installId = `repair-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      ...paths,
      installId,
      allowNoToken: true,
      workspaceId: workspace.id as WorkspaceId,
    });
    await session.runtime.start();
    const client = await connectAndHello(installId);
    try {
      const mode = await send(client.socket, client.reader, 'mode-after-repair', 'task.setParticipationMode', {
        taskId: task.taskId,
        mode: 'collaboration',
        expectedTaskVersion: 18,
      });
      expect(mode.error).toBeUndefined();
      expect(mode.payload).toMatchObject({ task: { taskVersion: 19 } });
    } finally {
      client.socket.destroy();
      await session.close();
    }

    const verified = await openDatabaseAsync({ path: paths.dbPath });
    try {
      expect(new SqliteWorkspaceStore(verified.raw).getTask(task.taskId)?.version).toBe(19);
    } finally {
      verified.raw.close();
    }
  });
});
