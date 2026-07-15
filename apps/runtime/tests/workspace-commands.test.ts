import { describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
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
        'task.create',
        'task.list',
        'task.open',
        'task.search',
        'task.appendMessage',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('workspace IA commands', () => {
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
      expect((opened.payload as { task: { lastOpenedAt?: string } }).task.lastOpenedAt).toBeTruthy();

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
