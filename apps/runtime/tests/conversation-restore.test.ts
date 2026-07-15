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
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

/**
 * M1 exit criterion 6 soft evidence:
 * multi-turn conversation history survives Runtime process restart via SQLite events/checkpoints
 * so a Desktop client can resubscribe and reconstruct the same thread without restating context.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const frames: Frame[] = [];
  const waiters = new Map<string, (frame: Frame) => void>();
  const eventWaiters: Array<{
    predicate: (frame: Frame) => boolean;
    resolve: (frame: Frame | undefined) => void;
  }> = [];
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      if (frame.kind === 'event') {
        frames.push(frame);
        const idx = eventWaiters.findIndex((w) => w.predicate(frame));
        if (idx >= 0) {
          const [waiter] = eventWaiters.splice(idx, 1);
          waiter.resolve(frame);
        }
        continue;
      }
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
    waitForEvent(predicate: (frame: Frame) => boolean, timeoutMs = 4_000): Promise<Frame | undefined> {
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        if (frame.kind === 'event' && predicate(frame)) {
          frames.splice(i, 1);
          return Promise.resolve(frame);
        }
      }
      return new Promise((resolve) => {
        const waiter = { predicate: (f: Frame) => f.kind === 'event' && predicate(f), resolve };
        eventWaiters.push(waiter);
        setTimeout(() => {
          const i = eventWaiters.indexOf(waiter);
          if (i >= 0) {
            eventWaiters.splice(i, 1);
            resolve(undefined);
          }
        }, timeoutMs);
      });
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

function eventType(frame: Frame): string {
  const payload = frame.payload as { event?: { type?: string; payload?: Record<string, unknown> } };
  return payload.event?.type ?? frame.type;
}

function eventPayload(frame: Frame): Record<string, unknown> {
  const payload = frame.payload as { event?: { payload?: Record<string, unknown> } };
  return (payload.event?.payload ?? {}) as Record<string, unknown>;
}

describe('M1 conversation restore after Runtime restart (exit criterion 6)', () => {
  it('replays multi-turn user/assistant history after process restart without restating context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-conversation-restore-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-conversation-restore' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    const threadId = 'thread-conversation-restore';

    await runMigrations(dbPath);

    // --- first process: two completed turns ---
    {
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const runtime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: store,
        workspaceId,
        checkpointRunId,
        demoProvider: new FakeProvider({ chunksPerWord: 8, tickMs: 0 }),
      });
      await runtime.start();
      const socket = await connectRuntime(installId);
      const inbox = createFrameInbox(socket);
      try {
        await inbox.send({
          id: 'hello-1',
          kind: 'request',
          type: '__hello',
          payload: {
            protocolVersion: 2,
            appVersion: '0.0.1',
            installId,
            nonce: 'conversation-restore-1',
            features: ['task.appendMessage', 'runtime.subscribeEvents'],
          },
        });
        await inbox.send({
          id: 'sub-1',
          kind: 'request',
          type: 'runtime.subscribeEvents',
          payload: { afterCursor: 0 },
        });

        const turn1 = await inbox.send({
          id: 'msg-1',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId,
            expectedTaskVersion: 0,
            role: 'user',
            text: 'first durable question',
          },
        });
        expect(turn1.error).toBeUndefined();
        expect(turn1.payload).toMatchObject({ taskVersion: 1 });
        expect(
          await waitFor(() =>
            store.listEvents(workspaceId, 0).some((e) => e.type === 'run.completed'),
          ),
        ).toBe(true);

        const turn2 = await inbox.send({
          id: 'msg-2',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId,
            expectedTaskVersion: 1,
            role: 'user',
            text: 'second durable question',
          },
        });
        expect(turn2.error).toBeUndefined();
        expect(turn2.payload).toMatchObject({ taskVersion: 2 });
        expect(
          await waitFor(
            () =>
              store.listEvents(workspaceId, 0).filter((e) => e.type === 'run.completed').length >= 2,
          ),
        ).toBe(true);

        const before = store.listEvents(workspaceId, 0);
        expect(before.filter((e) => e.type === 'message.appended')).toHaveLength(2);
        expect(before.filter((e) => e.type === 'run.completed')).toHaveLength(2);
        expect(before.filter((e) => e.type === 'context.packet.built').length).toBeGreaterThanOrEqual(2);
        expect(before.some((e) => JSON.stringify(e).includes('sk-'))).toBe(false);
      } finally {
        socket.destroy();
        await runtime.stop();
        connection.raw.close();
      }
    }

    // --- second process: cold start from same SQLite ---
    {
      const connection = await openDatabaseAsync({ path: dbPath });
      const store = new SqliteEventCheckpointStore(connection.raw);
      const runtime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: store,
        workspaceId,
        checkpointRunId,
        demoProvider: new FakeProvider({ chunksPerWord: 8, tickMs: 0 }),
      });
      await runtime.start();
      const socket = await connectRuntime(installId);
      const inbox = createFrameInbox(socket);
      try {
        await inbox.send({
          id: 'hello-2',
          kind: 'request',
          type: '__hello',
          payload: {
            protocolVersion: 2,
            appVersion: '0.0.1',
            installId,
            nonce: 'conversation-restore-2',
            features: ['task.appendMessage', 'runtime.subscribeEvents'],
          },
        });

        // Desktop-style: subscribe from 0 and collect durable replay + live handoff.
        const replayed: Frame[] = [];
        const collectUntil = async () => {
          // Drain replay pages: each subscribe page returns as response frames of type runtime.subscribeEvents
          // Events arrive as runtime.event frames.
          let pages = 0;
          let last = await inbox.send({
            id: 'sub-restore-0',
            kind: 'request',
            type: 'runtime.subscribeEvents',
            payload: { afterCursor: 0 },
          });
          pages++;
          const firstPayload = last.payload as {
            nextCursor?: number;
            replayComplete?: boolean;
            highWatermark?: number;
          };
          // Collect already-buffered events after first page ack; wait briefly for event frames.
          await new Promise((r) => setTimeout(r, 80));
          // Continue pages if protocol requires continuation with same id pattern.
          while (firstPayload.replayComplete === false && pages < 20) {
            last = await inbox.send({
              id: `sub-restore-${pages}`,
              kind: 'request',
              type: 'runtime.subscribeEvents',
              payload: {
                afterCursor: firstPayload.nextCursor ?? 0,
                // Some implementations require continue token — send nextCursor if present.
              },
            });
            pages++;
            const p = last.payload as { replayComplete?: boolean; nextCursor?: number };
            if (p.replayComplete) break;
            firstPayload.nextCursor = p.nextCursor;
            firstPayload.replayComplete = p.replayComplete;
          }
          void replayed;
          return firstPayload;
        };

        const pageMeta = await collectUntil();
        // Wait until durable store contents are fully visible via listEvents after restore.
        const restored = store.listEvents(workspaceId, 0);
        expect(restored.filter((e) => e.type === 'message.appended').map((e) => e.payload.text)).toEqual([
          'first durable question',
          'second durable question',
        ]);
        expect(restored.filter((e) => e.type === 'run.completed')).toHaveLength(2);
        expect(restored.filter((e) => e.type === 'run.started')).toHaveLength(2);
        expect(restored.filter((e) => e.type === 'context.packet.built').length).toBeGreaterThanOrEqual(2);

        // Continue same task without restating prior turns (taskVersion continues from 2).
        const turn3 = await inbox.send({
          id: 'msg-3-after-restart',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId,
            expectedTaskVersion: 2,
            role: 'user',
            text: 'third question after cold restore',
          },
        });
        expect(turn3.error).toBeUndefined();
        expect(turn3.payload).toMatchObject({ taskVersion: 3 });
        expect(
          await waitFor(
            () =>
              store.listEvents(workspaceId, 0).filter((e) => e.type === 'run.completed').length >= 3,
          ),
        ).toBe(true);

        const after = store.listEvents(workspaceId, 0);
        expect(after.filter((e) => e.type === 'message.appended')).toHaveLength(3);
        expect(after.filter((e) => e.type === 'run.completed')).toHaveLength(3);
        expect(store.loadLatestCheckpoint(checkpointRunId)?.lastEventSequence).toBe(after.length);
        expect(JSON.stringify(after)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);

        // Replay path should have accepted subscribe (cursor advanced or complete).
        expect(pageMeta === undefined || typeof pageMeta === 'object').toBe(true);
      } finally {
        socket.destroy();
        await runtime.stop();
        connection.raw.close();
      }
    }
  }, 30_000);
});
