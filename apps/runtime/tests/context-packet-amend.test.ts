import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
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
        'context.packet.amend',
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

describe('context.packet.amend', () => {
  it('force-excludes non-protected sources on peek; refuses protected; clear restores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-amend-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'db.sqlite');
    const installId = `amend-${randomBytes(4).toString('hex')}`;
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
        payload: { folderPath: dir, name: 'Amend WS' },
      });
      expect(ws.error).toBeUndefined();
      const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;

      const taskResp = await writeAndRead(sock, reader, {
        id: 'task-1',
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: 'Amend task',
          goal: 'User can amend packet before run',
          acceptanceCriteria: ['amend works'],
        },
      });
      expect(taskResp.error).toBeUndefined();
      const task = taskResp.payload as { taskId: string; threadId: string };

      // Seed task memory so we have a non-protected exclude target
      const propose = await writeAndRead(sock, reader, {
        id: 'mem-propose',
        kind: 'request',
        type: 'memory.propose',
        payload: {
          taskId: task.taskId,
          targetScope: 'task',
          additions: [
            {
              id: 'e-amend-1',
              key: 'style-rule',
              value: 'Continuum Bench calm instrument',
              targetScope: 'task',
            },
          ],
          confidence: 0.95,
        },
      });
      expect(propose.error).toBeUndefined();
      const changeId = (propose.payload as { change: { id: string } }).change.id;

      const decide = await writeAndRead(sock, reader, {
        id: 'mem-decide',
        kind: 'request',
        type: 'memory.decide',
        payload: { changeId, decision: 'approved' },
      });
      expect(decide.error).toBeUndefined();

      const baseline = await writeAndRead(sock, reader, {
        id: 'peek-base',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId },
      });
      expect(baseline.error).toBeUndefined();
      expect(baseline.type).toBe('context.packet.peek');
      const basePayload = baseline.payload as {
        includedSourceIds: string[];
        includedSources: Array<{ id: string; kind: string }>;
        evidenceRefsForMemory: string[];
        tokenEstimate: number;
      };
      const memoryId = basePayload.includedSources.find((s) => s.kind === 'project-memory')?.id;
      expect(memoryId).toBeTruthy();
      const goalId = basePayload.includedSources.find((s) => s.kind === 'task-goal')?.id;
      expect(goalId).toBeTruthy();
      expect(basePayload.includedSourceIds).toContain(memoryId!);
      expect(basePayload.evidenceRefsForMemory.length).toBeGreaterThan(0);
      const baseTokens = basePayload.tokenEstimate;

      // Refuse protected goal
      const refuse = await writeAndRead(sock, reader, {
        id: 'amend-refuse',
        kind: 'request',
        type: 'context.packet.amend',
        payload: {
          threadId: task.threadId,
          excludeSourceIds: [goalId!, memoryId!],
        },
      });
      expect(refuse.error).toBeUndefined();
      const refusePayload = refuse.payload as {
        excludeSourceIds: string[];
        refusedProtectedIds: string[];
        cleared: boolean;
      };
      expect(refusePayload.cleared).toBe(false);
      expect(refusePayload.refusedProtectedIds).toContain(goalId!);
      expect(refusePayload.excludeSourceIds).toContain(memoryId!);
      expect(refusePayload.excludeSourceIds).not.toContain(goalId!);

      const after = await writeAndRead(sock, reader, {
        id: 'peek-after',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId },
      });
      expect(after.error).toBeUndefined();
      const afterPayload = after.payload as {
        includedSourceIds: string[];
        excludedSourceIds: string[];
        evidenceRefsForMemory: string[];
        tokenEstimate: number;
      };
      expect(afterPayload.includedSourceIds).not.toContain(memoryId!);
      expect(afterPayload.excludedSourceIds).toContain(memoryId!);
      expect(afterPayload.includedSourceIds).toContain(goalId!);
      expect(afterPayload.evidenceRefsForMemory).not.toContain(memoryId!);
      expect(afterPayload.tokenEstimate).toBeLessThan(baseTokens);

      // Clear restores
      const clear = await writeAndRead(sock, reader, {
        id: 'amend-clear',
        kind: 'request',
        type: 'context.packet.amend',
        payload: { threadId: task.threadId, clearAll: true },
      });
      expect(clear.error).toBeUndefined();
      expect((clear.payload as { cleared: boolean; excludeSourceIds: string[] }).cleared).toBe(true);
      expect((clear.payload as { excludeSourceIds: string[] }).excludeSourceIds).toEqual([]);

      const restored = await writeAndRead(sock, reader, {
        id: 'peek-restored',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: task.threadId },
      });
      expect(restored.error).toBeUndefined();
      const restoredPayload = restored.payload as {
        includedSourceIds: string[];
        evidenceRefsForMemory: string[];
      };
      expect(restoredPayload.includedSourceIds).toContain(memoryId!);
      expect(restoredPayload.evidenceRefsForMemory.length).toBeGreaterThan(0);

      sock.end();
    } finally {
      await session.runtime.stop();
      session.close();
    }
  }, 30_000);
});
