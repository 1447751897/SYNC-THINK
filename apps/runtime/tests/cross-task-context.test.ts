import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeProvider } from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may briefly lock SQLite */
    }
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

function createFrameInbox(socket: Socket) {
  const frames: Frame[] = [];
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      } else {
        frames.push(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
    frames,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

/**
 * Design §10.1 — cross-task content only via explicit parent edge.
 */
describe('cross-task explicit parent refs in context packet', () => {
  it(
    'child task includes parent in crossTaskRefs and included cross-task-ref source',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-cross-task-'));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const installId = `test-xref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const workspaceId = 'workspace-cross-task' as WorkspaceId;
      const checkpointRunId = `runtime-${installId}` as RunId;

      await runMigrations(dbPath);
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const workspaceStore = new SqliteWorkspaceStore(connection.raw);

      const ws = workspaceStore.createWorkspace({
        folderPath: 'D:\\projects\\m1-cross-task',
        name: 'Cross Task WS',
        id: workspaceId,
      });

      const parent = workspaceStore.createTask({
        workspaceId: ws.id,
        title: 'Parent Alpha',
        goal: 'Ship multi-model conversation alpha with inspectable Manifest',
        acceptanceCriteria: ['Binding precedence holds'],
      });

      const child = workspaceStore.createTask({
        workspaceId: ws.id,
        title: 'Child binding',
        goal: 'Verify parent goal enters context via explicit ref',
        parentTaskId: parent.taskId,
      });
      expect(child.parentTaskId).toBe(parent.taskId);

      const runtime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: store,
        workspaceStore,
        workspaceId,
        checkpointRunId,
        demoProvider: new FakeProvider({ chunksPerWord: 8, tickMs: 0 }),
      });
      await runtime.start();
      const socket = await connectRuntime(installId);
      const inbox = createFrameInbox(socket);

      try {
        await inbox.send({
          id: 'hello',
          kind: 'request',
          type: '__hello',
          payload: {
            protocolVersion: 2,
            appVersion: '0.0.1',
            installId,
            nonce: 'cross-task-child',
            features: ['task.appendMessage'],
          },
        });

        const append = await inbox.send({
          id: 'append-1',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: child.threadId,
            expectedTaskVersion: child.taskVersion,
            role: 'user',
            text: 'What does the parent task require?',
          },
        });
        expect(append.error).toBeUndefined();

        expect(
          await waitFor(() =>
            store.listEvents(workspaceId, 0).some((e) => e.type === 'context.packet.built'),
          ),
        ).toBe(true);

        const packet = store
          .listEvents(workspaceId, 0)
          .find((e) => e.type === 'context.packet.built');
        expect(packet).toBeTruthy();
        const payload = packet!.payload as Record<string, unknown>;
        const cross = (payload.crossTaskRefs as string[] | undefined) ?? [];
        expect(cross).toContain(parent.taskId);

        const included =
          (payload.includedSources as Array<{ id: string; kind: string }> | undefined) ?? [];
        expect(included.some((s) => s.kind === 'cross-task-ref')).toBe(true);
        expect(included.some((s) => s.kind === 'task-goal')).toBe(true);
        expect(included.some((s) => s.id.includes(String(parent.taskId)))).toBe(true);
        expect(JSON.stringify(payload)).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      } finally {
        socket.destroy();
        await runtime.stop();
        connection.raw.close();
      }
    },
    15_000,
  );

  it(
    'root task without parent does not invent cross-task refs',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-cross-task-root-'));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const installId = `test-xref-root-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const workspaceId = 'workspace-cross-task-root' as WorkspaceId;
      const checkpointRunId = `runtime-${installId}` as RunId;

      await runMigrations(dbPath);
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const workspaceStore = new SqliteWorkspaceStore(connection.raw);

      const ws = workspaceStore.createWorkspace({
        folderPath: 'D:\\projects\\m1-cross-task-root',
        name: 'Root WS',
        id: workspaceId,
      });
      const root = workspaceStore.createTask({
        workspaceId: ws.id,
        title: 'Root only',
        goal: 'No parent edge',
      });

      const runtime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: store,
        workspaceStore,
        workspaceId,
        checkpointRunId,
        demoProvider: new FakeProvider({ chunksPerWord: 8, tickMs: 0 }),
      });
      await runtime.start();
      const socket = await connectRuntime(installId);
      const inbox = createFrameInbox(socket);

      try {
        await inbox.send({
          id: 'hello',
          kind: 'request',
          type: '__hello',
          payload: {
            protocolVersion: 2,
            appVersion: '0.0.1',
            installId,
            nonce: 'cross-task-root',
            features: ['task.appendMessage'],
          },
        });

        const append = await inbox.send({
          id: 'append-root',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: root.threadId,
            expectedTaskVersion: root.taskVersion,
            role: 'user',
            text: 'hello root',
          },
        });
        expect(append.error).toBeUndefined();

        expect(
          await waitFor(() =>
            store.listEvents(workspaceId, 0).some((e) => e.type === 'context.packet.built'),
          ),
        ).toBe(true);

        const packet = store
          .listEvents(workspaceId, 0)
          .find((e) => e.type === 'context.packet.built');
        const payload = packet!.payload as Record<string, unknown>;
        const cross = (payload.crossTaskRefs as string[] | undefined) ?? [];
        expect(cross).toEqual([]);
        const included =
          (payload.includedSources as Array<{ kind: string }> | undefined) ?? [];
        expect(included.some((s) => s.kind === 'cross-task-ref')).toBe(false);
      } finally {
        socket.destroy();
        await runtime.stop();
        connection.raw.close();
      }
    },
    15_000,
  );
});
