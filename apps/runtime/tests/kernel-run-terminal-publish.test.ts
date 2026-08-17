import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteMemoryStore,
} from '@sync-think/storage';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
} from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain a better-sqlite3 file handle after a failure.
    }
  }
});

class FailingKernelAdapter implements KernelAdapter {
  readonly id = 'fixture-kernel';
  readonly name = 'Fixture Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(_request: KernelRequest): AsyncIterable<KernelEvent> {
    yield { type: 'terminal', status: 'failed', error: 'boom-kernel' };
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class StubDemoProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }
  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield { type: 'finished', reason: 'stop' };
  }
}

function createFrameReader(sock: Socket): {
  read: (count: number) => Promise<Frame[]>;
  queuedCount: () => number;
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
    } catch (error) {
      while (waiters.length > 0) waiters.shift()!.reject(error);
    }
  });
  sock.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()!.reject(error);
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
    queuedCount: () => queued.length,
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

async function waitForLiveEvents(
  reader: ReturnType<typeof createFrameReader>,
  count: number,
  timeoutMs = 8_000,
): Promise<Frame[]> {
  const deadline = Date.now() + timeoutMs;
  while (reader.queuedCount() < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (reader.queuedCount() < count) {
    throw new Error(`timed out waiting for ${count} live frames; got ${reader.queuedCount()}`);
  }
  return reader.read(count);
}

describe('kernel run terminal publish ordering', () => {
  it('publishes run.failed live before the diagnostics event so subscribers never miss the terminal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kf-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });

    const installId = `test-kf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adapter = new FailingKernelAdapter();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      memoryStore: new SqliteMemoryStore(connection.raw),
      demoProvider: new StubDemoProvider(),
      kernelAdapterResolver: () => adapter,
    });
    await runtime.start();

    const sock = connect(pipePathPortable(installId));
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', resolve);
      sock.once('error', reject);
    });
    const reader = createFrameReader(sock);
    try {
      const hello = await writeAndRead(sock, reader, {
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['task.appendMessage', 'runtime.subscribeEvents'],
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const subscribe = await writeAndRead(sock, reader, {
        id: 'sub',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });
      expect(subscribe.type).toBe('runtime.subscribeEvents');

      const append = await writeAndRead(sock, reader, {
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-kf-1',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'trigger failing kernel run',
          kernelId: 'fixture-kernel',
        },
      });
      expect(append.error).toBeUndefined();
      const runId = (append.payload as { streamId?: string }).streamId;
      expect(runId).toBeTruthy();

      // Live frames after the append response: message.appended,
      // context.packet.built, run.started, run.failed, diagnostics.appended.
      const live = await waitForLiveEvents(reader, 5, 8_000);
      const events = live
        .filter((frame) => frame.kind === 'event' && frame.type === 'runtime.event')
        .map((frame) => (frame.payload as { event: { type: string; sequence: number } }).event);

      const failedIndex = events.findIndex((event) => event.type === 'run.failed');
      const diagnosticIndex = events.findIndex((event) => event.type === 'diagnostics.appended');
      expect(failedIndex).toBeGreaterThanOrEqual(0);
      expect(diagnosticIndex).toBeGreaterThanOrEqual(0);
      expect(failedIndex).toBeLessThan(diagnosticIndex);
      const failed = events[failedIndex]!;
      const diagnostic = events[diagnosticIndex]!;
      expect(failed.sequence).toBeLessThan(diagnostic.sequence);
      expect((diagnostic.payload as { runId?: string }).runId).toBe(runId);
    } finally {
      sock.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
