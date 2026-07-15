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
  SqliteMemoryStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId, TaskId } from '@sync-think/shared';
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
 * Design §10.1 / §10.2 — approved project memory enters Context Packet as project-memory sources.
 */
describe('project memory sources in context packet', () => {
  it(
    'includes active memory entries as project-memory sources with scrubbed evidence',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-mem-ctx-'));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const installId = `test-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const workspaceId = 'workspace-mem-ctx' as WorkspaceId;
      const checkpointRunId = `runtime-${installId}` as RunId;

      await runMigrations(dbPath);
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const workspaceStore = new SqliteWorkspaceStore(connection.raw);
      const memoryStore = new SqliteMemoryStore(connection.raw);

      const ws = workspaceStore.createWorkspace({
        folderPath: 'D:\\projects\\m1-mem-ctx',
        name: 'Memory Context WS',
        id: workspaceId,
      });

      const task = workspaceStore.createTask({
        workspaceId: ws.id,
        title: 'Memory binding task',
        goal: 'Verify approved memory enters Manifest as project-memory',
        acceptanceCriteria: ['project-memory visible'],
      });

      // Seed approved durable memory via propose+autoApprove (task scope).
      memoryStore.proposeChange({
        workspaceId: ws.id,
        taskId: task.taskId as TaskId,
        targetScope: 'task',
        additions: [
          {
            id: 'add-1',
            key: 'binding-rule',
            value: 'run override beats agent default',
            targetScope: 'task',
          },
        ],
        evidenceRefs: ['seed'],
        confidence: 0.9,
        autoApprove: true,
      });
      memoryStore.proposeChange({
        workspaceId: ws.id,
        taskId: task.taskId as TaskId,
        targetScope: 'project',
        additions: [
          {
            id: 'add-2',
            key: 'leaky',
            value: 'never store sk-abcdefghijklmnopqrstuvwxyz123456 in memory',
            targetScope: 'project',
          },
        ],
        evidenceRefs: ['seed-2'],
        confidence: 0.8,
        autoApprove: true,
      });

      const active = memoryStore.listActiveEntries({ workspaceId: ws.id, taskId: task.taskId as TaskId });
      expect(active.length).toBeGreaterThanOrEqual(2);

      const runtime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: store,
        workspaceStore,
        memoryStore,
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
            nonce: 'mem-ctx',
            features: ['task.appendMessage'],
          },
        });

        const append = await inbox.send({
          id: 'append-1',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: task.threadId,
            expectedTaskVersion: task.taskVersion,
            role: 'user',
            text: 'What is the binding rule we agreed?',
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
        const included =
          (payload.includedSources as Array<{ id: string; kind: string }> | undefined) ?? [];
        expect(included.some((s) => s.kind === 'project-memory')).toBe(true);
        expect(included.some((s) => s.kind === 'task-goal')).toBe(true);

        const evidence =
          (payload.evidenceRefsForMemory as string[] | undefined) ?? [];
        expect(evidence.some((e) => e.startsWith('memory:'))).toBe(true);

        const summaries =
          (payload.summaries as Array<{ sourceId: string; summary: string }> | undefined) ?? [];
        const memSummary = summaries.find((s) => s.sourceId.startsWith('memory:'));
        expect(memSummary?.summary).toMatch(/binding-rule|记忆/);
        // Secret scrub on memory summary trail
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
    'without memory store does not invent project-memory sources',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-mem-empty-'));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const installId = `test-mem-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const workspaceId = 'workspace-mem-empty' as WorkspaceId;
      const checkpointRunId = `runtime-${installId}` as RunId;

      await runMigrations(dbPath);
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const workspaceStore = new SqliteWorkspaceStore(connection.raw);

      const ws = workspaceStore.createWorkspace({
        folderPath: 'D:\\projects\\m1-mem-empty',
        name: 'Empty Mem WS',
        id: workspaceId,
      });
      const task = workspaceStore.createTask({
        workspaceId: ws.id,
        title: 'No memory',
        goal: 'Empty memory path',
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
            nonce: 'mem-empty',
            features: ['task.appendMessage'],
          },
        });

        const append = await inbox.send({
          id: 'append-1',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: task.threadId,
            expectedTaskVersion: task.taskVersion,
            role: 'user',
            text: 'Hello without memory',
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
        const included =
          (payload.includedSources as Array<{ id: string; kind: string }> | undefined) ?? [];
        expect(included.some((s) => s.kind === 'project-memory')).toBe(false);
        const evidence = (payload.evidenceRefsForMemory as string[] | undefined) ?? [];
        expect(evidence).toEqual([]);
      } finally {
        socket.destroy();
        await runtime.stop();
        connection.raw.close();
      }
    },
    15_000,
  );
});
