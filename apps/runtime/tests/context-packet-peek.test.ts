import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

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
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
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
  return (await next)[0]!;
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
        'context.packet.peek',
        'memory.list',
        'memory.propose',
        'memory.decide',
        'memory.rollback',
        'task.create',
        'workspace.create',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('context.packet.peek', () => {
  it('returns inspectable packet without durable packet.built; memory approve/rollback changes peek', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-peek-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'db.sqlite');
    const installId = `peek-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'key.bin'),
      demoProvider: new FakeProvider(),
      allowNoToken: true,
    });

    try {
      await session.runtime.start();
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      const ws = await writeAndRead(sock, reader, {
        id: 'ws-1',
        kind: 'request',
        type: 'workspace.create',
        payload: { folderPath: dir, name: 'Peek WS' },
      });
      expect(ws.error).toBeUndefined();
      const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;

      const taskResp = await writeAndRead(sock, reader, {
        id: 'task-1',
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: 'Peek task',
          goal: 'Inspect packet before run',
          acceptanceCriteria: ['peek works'],
        },
      });
      expect(taskResp.error).toBeUndefined();
      const task = taskResp.payload as { taskId: string; threadId: string };

      const emptyPeek = await writeAndRead(sock, reader, {
        id: 'peek-0',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId },
      });
      expect(emptyPeek.error).toBeUndefined();
      expect(emptyPeek.type).toBe('context.packet.peek');
      const emptyBody = emptyPeek.payload as {
        packetId: string;
        proofHash: string;
        skillVersionIds?: string[];
        agentVersion?: number;
        policyId?: string;
        includedSources: Array<{ id: string; kind: string }>;
        evidenceRefsForMemory: string[];
        tokenEstimate: number;
      };
      expect(emptyBody.packetId.length).toBeGreaterThan(4);
      expect(emptyBody.proofHash.length).toBeGreaterThan(8);
      expect(Array.isArray(emptyBody.skillVersionIds)).toBe(true);
      // M1 conversation agent seeds empty Skill allowlist until Skills land.
      expect(emptyBody.skillVersionIds).toEqual([]);
      expect(emptyBody.tokenEstimate).toBeGreaterThan(0);
      expect(emptyBody.includedSources.some((s) => s.kind === 'project-memory')).toBe(false);
      expect(emptyBody.evidenceRefsForMemory).toEqual([]);

      const propose = await writeAndRead(sock, reader, {
        id: 'mem-p',
        kind: 'request',
        type: 'memory.propose',
        payload: {
          taskId: task.taskId,
          targetScope: 'task',
          additions: [
            {
              id: 'e-peek-1',
              key: 'binding-rule',
              value: 'run override beats agent default',
              targetScope: 'task',
            },
          ],
          confidence: 0.95,
        },
      });
      expect(propose.error).toBeUndefined();
      const changeId = (propose.payload as { change: { id: string } }).change.id;

      const decide = await writeAndRead(sock, reader, {
        id: 'mem-d',
        kind: 'request',
        type: 'memory.decide',
        payload: { changeId, decision: 'approved' },
      });
      expect(decide.error).toBeUndefined();

      const withMem = await writeAndRead(sock, reader, {
        id: 'peek-1',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId, userText: 'preview after approve' },
      });
      expect(withMem.error).toBeUndefined();
      const withBody = withMem.payload as {
        includedSources: Array<{ id: string; kind: string }>;
        evidenceRefsForMemory: string[];
        summaries: Array<{ sourceId: string; summary: string }>;
      };
      expect(withBody.includedSources.some((s) => s.kind === 'project-memory')).toBe(true);
      expect(withBody.evidenceRefsForMemory.length).toBeGreaterThan(0);
      expect(
        withBody.summaries.some((s) => /binding-rule|run override/i.test(s.summary)),
      ).toBe(true);

      const rollback = await writeAndRead(sock, reader, {
        id: 'mem-r',
        kind: 'request',
        type: 'memory.rollback',
        payload: { changeId },
      });
      expect(rollback.error).toBeUndefined();

      const afterRb = await writeAndRead(sock, reader, {
        id: 'peek-2',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId },
      });
      expect(afterRb.error).toBeUndefined();
      const afterBody = afterRb.payload as {
        includedSources: Array<{ id: string; kind: string }>;
        evidenceRefsForMemory: string[];
      };
      expect(afterBody.includedSources.some((s) => s.kind === 'project-memory')).toBe(false);
      expect(afterBody.evidenceRefsForMemory).toEqual([]);

      sock.destroy();
      await session.close();

      // Re-open DB read-only to assert peek never wrote context.packet.built.
      const connection = await openDatabaseAsync({ path: dbPath });
      try {
        const store = new SqliteEventCheckpointStore(connection.raw);
        const events = store.listEvents(workspaceId as never, 0);
        expect(events.some((e) => e.type === 'context.packet.built')).toBe(false);
      } finally {
        connection.raw.close();
      }
    } catch (error) {
      try {
        await session.close();
      } catch {
        /* ignore */
      }
      throw error;
    }
  }, 25_000);
});
