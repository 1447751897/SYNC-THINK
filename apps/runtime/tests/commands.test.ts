import { describe, it, expect } from 'vitest';
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
  SqliteConversationStore,
  SqliteScheduledTaskStore,
} from '@sync-think/storage';
import type { Event, RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

class RecordingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  callCount = 0;

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.callCount++;
    yield { type: 'finished', reason: 'stop' };
  }
}

class FailingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield {
      type: 'error',
      failureClass: 'unknown',
      message: 'fixture provider failure',
    };
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

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
      features: ['task.appendMessage', 'runtime.subscribeEvents', 'runtime.healthcheck'],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('runtime commands', () => {
  it('acknowledges an authenticated shutdown request and schedules process cleanup', async () => {
    const installId = `runtime-shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let shutdownRequests = 0;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      onShutdownRequested: () => {
        shutdownRequests += 1;
      },
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);
    try {
      await hello(socket, reader, installId);
      const response = await writeAndRead(socket, reader, {
        id: 'runtime-shutdown',
        kind: 'request',
        type: 'runtime.shutdown',
        payload: {},
      });
      expect(response.payload).toEqual({ accepted: true });
      expect(await waitFor(() => shutdownRequests === 1)).toBe(true);
    } finally {
      socket.destroy();
      await runtime.stop();
    }
  });

  it('reports a scheduled task trigger as fired without creating a duplicate failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduled-trigger-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-scheduled-trigger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const provider = new RecordingProvider();
    const session = await (
      await import('../src/persistence.js')
    ).openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      allowNoToken: true,
      demoProvider: provider,
    });
    const inspectConnection = await openDatabaseAsync({ path: dbPath });
    const taskStore = new SqliteScheduledTaskStore(inspectConnection.raw);
    const taskId = 'scheduled-regression-1';
    taskStore.create({
      id: taskId,
      name: 'Regression task',
      instruction: 'run the regression task',
      target: { kind: 'model', modelId: 'fake-mini' },
      rule: { kind: 'every', intervalMinutes: 30 },
      timeZone: 'UTC',
      enabled: true,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);

    try {
      await hello(socket, reader, installId);
      const response = await writeAndRead(socket, reader, {
        id: 'scheduled-trigger-regression',
        kind: 'request',
        type: 'scheduledTask.trigger',
        payload: { taskId },
      });

      expect(response.error).toBeUndefined();
      expect(response.payload).toMatchObject({ fired: true });
      expect(
        await waitFor(
          () => provider.callCount > 0 && taskStore.listHistory(taskId).length === 1,
          2_000,
        ),
      ).toBe(true);

      const stored = taskStore.get(taskId);
      expect(stored?.lastResult?.status).toBe('success');
      expect(taskStore.listHistory(taskId)).toHaveLength(1);
      expect(taskStore.listHistory(taskId)[0]?.status).toBe('success');
    } finally {
      socket.destroy();
      await session.close();
      inspectConnection.raw.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs a leased external event in a durable conversation and deduplicates takeover delivery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-external-event-runtime-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-external-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const provider = new RecordingProvider();
    const session = await (
      await import('../src/persistence.js')
    ).openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      allowNoToken: true,
      demoProvider: provider,
    });
    const inspectConnection = await openDatabaseAsync({ path: dbPath });
    const conversationStore = new SqliteConversationStore(inspectConnection.raw);
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);
    const event = {
      id: 'external-event-1',
      dedupeKey: 'github:delivery-1',
      source: { kind: 'git', name: 'github' },
      instruction: 'review this push',
      target: { kind: 'model', modelId: 'fake-mini' },
      workspaceId: undefined,
      skillVersionIds: [],
      metadata: { ref: 'refs/heads/main' },
    };

    try {
      await hello(socket, reader, installId);
      const first = await writeAndRead(socket, reader, {
        id: 'external-dispatch-1',
        kind: 'request',
        type: 'external.event.dispatch',
        payload: {
          event,
          leaseToken: 'lease-1',
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
          attemptCount: 1,
        },
      });

      expect(first.type).toBe('external.event.ack');
      expect(first.payload).toMatchObject({
        eventId: 'external-event-1',
        leaseToken: 'lease-1',
        accepted: true,
      });
      const runId = (first.payload as { runId?: string }).runId;
      expect(runId).toBeTruthy();
      expect(await waitFor(() => provider.callCount === 1, 2_000)).toBe(true);
      expect(conversationStore.list().some((item) => item.title === '事件 · github')).toBe(true);

      const retry = await writeAndRead(socket, reader, {
        id: 'external-dispatch-2',
        kind: 'request',
        type: 'external.event.dispatch',
        payload: {
          event,
          leaseToken: 'lease-2',
          leaseExpiresAt: '2099-01-01T00:01:00.000Z',
          attemptCount: 2,
        },
      });
      expect(retry.payload).toMatchObject({
        accepted: true,
        eventId: 'external-event-1',
        leaseToken: 'lease-2',
        runId,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(provider.callCount).toBe(1);
    } finally {
      socket.destroy();
      await session.close();
      inspectConnection.raw.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records a provider failure as one failed terminal history entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduled-failure-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-scheduled-failure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await (
      await import('../src/persistence.js')
    ).openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      allowNoToken: true,
      demoProvider: new FailingProvider(),
    });
    const inspectConnection = await openDatabaseAsync({ path: dbPath });
    const taskStore = new SqliteScheduledTaskStore(inspectConnection.raw);
    const taskId = 'scheduled-regression-failure';
    taskStore.create({
      id: taskId,
      name: 'Failure task',
      instruction: 'fail the regression task',
      target: { kind: 'model', modelId: 'fake-mini' },
      rule: { kind: 'every', intervalMinutes: 30 },
      timeZone: 'UTC',
      enabled: true,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);
    try {
      await hello(socket, reader, installId);
      const response = await writeAndRead(socket, reader, {
        id: 'scheduled-failure-regression',
        kind: 'request',
        type: 'scheduledTask.trigger',
        payload: { taskId },
      });
      expect(response.payload).toMatchObject({ fired: true });
      expect(await waitFor(() => taskStore.listHistory(taskId).length === 1, 2_000)).toBe(true);
      expect(taskStore.listHistory(taskId)[0]?.status).toBe('failed');
      expect(taskStore.get(taskId)?.lastResult?.status).toBe('failed');
    } finally {
      socket.destroy();
      await session.close();
      inspectConnection.raw.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops while an authenticated client is still connected', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const stopped = await Promise.race([
      runtime.stop().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);

    expect(stopped).toBe(true);
    expect(
      await new Promise<boolean>((resolve) => {
        if (sock.destroyed) return resolve(true);
        sock.once('close', () => resolve(true));
        setTimeout(() => resolve(false), 250);
      }),
    ).toBe(true);
    sock.destroy();
  });

  it('streams an append-message event to subscribed clients', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);

      const subscribe = await writeAndRead(sock, reader, {
        id: 'sub',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });
      expect(subscribe.type).toBe('runtime.subscribeEvents');
      expect(subscribe.payload).toMatchObject({ startingSequence: 1 });

      sock.write(
        encodeFrame({
          id: 'append',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: 'thread-dev-1',
            expectedTaskVersion: 0,
            role: 'user',
            text: 'hello runtime',
          },
        }),
      );
      const frames = await reader.read(2);
      const append = frames.find((frame) => frame.id === 'append')!;
      const eventFrame = frames.find((frame) => frame.kind === 'event')!;

      expect(append.type).toBe('task.appendMessage');
      expect(append.payload).toMatchObject({ taskVersion: 1 });

      expect(eventFrame.kind).toBe('event');
      expect(eventFrame.type).toBe('runtime.event');
      expect(eventFrame.payload).toMatchObject({
        event: {
          category: 'message',
          type: 'message.appended',
          sequence: 1,
          payload: {
            threadId: 'thread-dev-1',
            role: 'user',
            text: 'hello runtime',
          },
        },
      });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('replays events newer than the subscription cursor', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      await writeAndRead(sock, reader, {
        id: 'append-before-subscribe',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-replay',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'durable before subscribe',
        },
      });

      const subscribe = await writeAndRead(sock, reader, {
        id: 'sub-replay',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });

      expect(subscribe.payload).toMatchObject({
        startingSequence: 1,
        replayedEvents: [
          {
            sequence: 1,
            type: 'message.appended',
            payload: { text: 'durable before subscribe' },
          },
        ],
      });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('replays thirty-two large durable events across bounded encodable pages', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const events = Array.from({ length: 32 }, (_, index) => {
      const sequence = index + 1;
      return {
        id: `event-large-${sequence}` as Event['id'],
        workspaceId: 'workspace-dev' as WorkspaceId,
        category: 'message' as const,
        type: 'message.appended',
        sequence,
        occurredAt: new Date().toISOString(),
        payload: { text: `${sequence}:`.padEnd(40_000, 'x') },
      } satisfies Event;
    });
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      checkpoint: {
        eventSequence: 32,
        threadVersions: [],
        events,
        createdAt: new Date().toISOString(),
      },
    });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const pageFrames: Frame[] = [];
      let response = await writeAndRead(sock, reader, {
        id: 'sub-large-replay',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });

      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        pageFrames.push(response);
        expect(() => encodeFrame(response)).not.toThrow();
        const page = response.payload as {
          streamId: string;
          replayedEvents: Event[];
          nextCursor: number;
          highWatermark: number;
          replayComplete: boolean;
        };
        expect(page.highWatermark).toBe(32);
        if (page.replayComplete) break;
        response = await writeAndRead(sock, reader, {
          id: `continue-large-replay-${pageIndex}`,
          kind: 'request',
          type: 'runtime.continueEventReplay',
          payload: { streamId: page.streamId, afterCursor: page.nextCursor },
        });
      }

      const pages = pageFrames.map(
        (frame) =>
          frame.payload as {
            replayedEvents: Event[];
            nextCursor: number;
            highWatermark: number;
            replayComplete: boolean;
          },
      );
      expect(pages.length).toBeGreaterThanOrEqual(2);
      expect(pages.flatMap((page) => page.replayedEvents.map((event) => event.sequence))).toEqual(
        Array.from({ length: 32 }, (_, index) => index + 1),
      );
      expect(pages.at(-1)).toMatchObject({
        nextCursor: 32,
        highWatermark: 32,
        replayComplete: true,
      });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('keeps a fixed replay high-watermark and hands concurrent events to live once', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const events = Array.from(
      { length: 32 },
      (_, index) =>
        ({
          id: `event-handoff-${index + 1}` as Event['id'],
          workspaceId: 'workspace-dev' as WorkspaceId,
          category: 'message' as const,
          type: 'message.appended',
          sequence: index + 1,
          occurredAt: new Date().toISOString(),
          payload: { text: `${index + 1}:`.padEnd(40_000, 'x') },
        }) satisfies Event,
    );
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      checkpoint: {
        eventSequence: 32,
        threadVersions: [],
        events,
        createdAt: new Date().toISOString(),
      },
    });
    await runtime.start();
    const subscriber = await connectRuntime(installId);
    const subscriberReader = createFrameReader(subscriber);
    const producer = await connectRuntime(installId);
    const producerReader = createFrameReader(producer);
    try {
      await hello(subscriber, subscriberReader, installId);
      await hello(producer, producerReader, installId);
      const pages: Array<{
        streamId: string;
        replayedEvents: Event[];
        nextCursor: number;
        highWatermark: number;
        replayComplete: boolean;
      }> = [];
      let response = await writeAndRead(subscriber, subscriberReader, {
        id: 'sub-handoff',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });
      pages.push(response.payload as (typeof pages)[number]);
      expect(pages[0].replayComplete).toBe(false);

      const append = await writeAndRead(producer, producerReader, {
        id: 'append-during-replay',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-handoff',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'live during replay',
        },
      });
      expect(append.error).toBeUndefined();
      expect(subscriberReader.queuedCount()).toBe(0);

      while (!pages.at(-1)!.replayComplete) {
        const previous = pages.at(-1)!;
        response = await writeAndRead(subscriber, subscriberReader, {
          id: `continue-handoff-${pages.length}`,
          kind: 'request',
          type: 'runtime.continueEventReplay',
          payload: { streamId: previous.streamId, afterCursor: previous.nextCursor },
        });
        pages.push(response.payload as (typeof pages)[number]);
      }

      expect(pages.every((page) => page.highWatermark === 32)).toBe(true);
      expect(pages.flatMap((page) => page.replayedEvents.map((event) => event.sequence))).toEqual(
        Array.from({ length: 32 }, (_, index) => index + 1),
      );
      const [live] = await subscriberReader.read(1);
      expect(live).toMatchObject({
        kind: 'event',
        type: 'runtime.event',
        payload: { event: { sequence: 33, payload: { text: 'live during replay' } } },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(subscriberReader.queuedCount()).toBe(0);
    } finally {
      subscriber.destroy();
      producer.destroy();
      await runtime.stop();
    }
  });

  it('applies categories to replay and live while advancing the global cursor', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const events = [
      { sequence: 1, category: 'message', type: 'message.appended' },
      { sequence: 2, category: 'run', type: 'run.started' },
      { sequence: 3, category: 'message', type: 'message.appended' },
    ].map(
      ({ sequence, category, type }) =>
        ({
          id: `event-category-${sequence}` as Event['id'],
          workspaceId: 'workspace-dev' as WorkspaceId,
          category: category as Event['category'],
          type,
          sequence,
          occurredAt: new Date().toISOString(),
          payload: { sequence },
        }) satisfies Event,
    );
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      checkpoint: {
        eventSequence: 3,
        threadVersions: [],
        events,
        createdAt: new Date().toISOString(),
      },
    });
    await runtime.start();
    const messageSocket = await connectRuntime(installId);
    const messageReader = createFrameReader(messageSocket);
    const runSocket = await connectRuntime(installId);
    const runReader = createFrameReader(runSocket);
    const producer = await connectRuntime(installId);
    const producerReader = createFrameReader(producer);
    try {
      await hello(messageSocket, messageReader, installId);
      await hello(runSocket, runReader, installId);
      await hello(producer, producerReader, installId);
      const messages = await writeAndRead(messageSocket, messageReader, {
        id: 'sub-message-category',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, categories: ['message'] },
      });
      const runs = await writeAndRead(runSocket, runReader, {
        id: 'sub-run-category',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, categories: ['run'] },
      });
      expect(messages.payload).toMatchObject({
        replayedEvents: [{ sequence: 1 }, { sequence: 3 }],
        nextCursor: 3,
        highWatermark: 3,
        replayComplete: true,
      });
      expect(runs.payload).toMatchObject({
        replayedEvents: [{ sequence: 2 }],
        nextCursor: 3,
        highWatermark: 3,
        replayComplete: true,
      });

      await writeAndRead(producer, producerReader, {
        id: 'append-category-live',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-category-live',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'message live only',
        },
      });
      const [messageLive] = await messageReader.read(1);
      expect(messageLive).toMatchObject({
        payload: { event: { sequence: 4, category: 'message' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(runReader.queuedCount()).toBe(0);
    } finally {
      messageSocket.destroy();
      runSocket.destroy();
      producer.destroy();
      await runtime.stop();
    }
  });

  it('rejects future, unknown, and stale replay cursors without advancing the stream', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const events = Array.from(
      { length: 65 },
      (_, index) =>
        ({
          id: `event-cursor-${index + 1}` as Event['id'],
          workspaceId: 'workspace-dev' as WorkspaceId,
          category: 'message' as const,
          type: 'message.appended',
          sequence: index + 1,
          occurredAt: new Date().toISOString(),
          payload: { sequence: index + 1 },
        }) satisfies Event,
    );
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      checkpoint: {
        eventSequence: 65,
        threadVersions: [],
        events,
        createdAt: new Date().toISOString(),
      },
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);
    try {
      await hello(socket, reader, installId);
      const future = await writeAndRead(socket, reader, {
        id: 'sub-future-cursor',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 66 },
      });
      expect(future.error).toMatchObject({ code: 'protocol.unexpected_request' });
      const unknown = await writeAndRead(socket, reader, {
        id: 'continue-unknown-stream',
        kind: 'request',
        type: 'runtime.continueEventReplay',
        payload: { streamId: 'missing-stream', afterCursor: 0 },
      });
      expect(unknown.error).toMatchObject({ code: 'protocol.unexpected_request' });

      const first = await writeAndRead(socket, reader, {
        id: 'sub-stale-cursor',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });
      const firstPage = first.payload as {
        streamId: string;
        nextCursor: number;
        replayComplete: boolean;
      };
      expect(firstPage).toMatchObject({ nextCursor: 64, replayComplete: false });
      const stale = await writeAndRead(socket, reader, {
        id: 'continue-stale-cursor',
        kind: 'request',
        type: 'runtime.continueEventReplay',
        payload: { streamId: firstPage.streamId, afterCursor: 63 },
      });
      expect(stale.error).toMatchObject({ code: 'protocol.unexpected_request' });
      const final = await writeAndRead(socket, reader, {
        id: 'continue-correct-cursor',
        kind: 'request',
        type: 'runtime.continueEventReplay',
        payload: { streamId: firstPage.streamId, afterCursor: 64 },
      });
      expect(final.payload).toMatchObject({
        replayedEvents: [{ sequence: 65 }],
        nextCursor: 65,
        highWatermark: 65,
        replayComplete: true,
      });
    } finally {
      socket.destroy();
      await runtime.stop();
    }
  });

  it('bounds replay scanning and serialization work per page', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const events = Array.from(
      { length: 1_000 },
      (_, index) =>
        ({
          id: `event-bounded-work-${index + 1}` as Event['id'],
          workspaceId: 'workspace-dev' as WorkspaceId,
          category: 'message' as const,
          type: 'message.appended',
          sequence: index + 1,
          occurredAt: new Date().toISOString(),
          payload: { sequence: index + 1 },
        }) satisfies Event,
    );
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      checkpoint: {
        eventSequence: 1_000,
        threadVersions: [],
        events,
        createdAt: new Date().toISOString(),
      },
    });
    let serializations = 0;
    for (const event of (runtime as unknown as { events: Event[] }).events) {
      Object.defineProperty(event, 'toJSON', {
        enumerable: false,
        value() {
          serializations++;
          return { ...event };
        },
      });
    }
    await runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);
    try {
      await hello(socket, reader, installId);
      const matching = await writeAndRead(socket, reader, {
        id: 'sub-bounded-matching',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, categories: ['message'] },
      });
      expect(matching.payload).toMatchObject({
        nextCursor: 64,
        highWatermark: 1_000,
        replayComplete: false,
      });
      expect(serializations).toBeLessThanOrEqual(128);

      const filtered = await writeAndRead(socket, reader, {
        id: 'sub-bounded-filtered',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, categories: ['run'] },
      });
      expect(filtered.payload).toMatchObject({
        replayedEvents: [],
        nextCursor: 256,
        highWatermark: 1_000,
        replayComplete: false,
      });
    } finally {
      socket.destroy();
      await runtime.stop();
    }
  });

  it('rejects append-message when expectedTaskVersion is stale', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      await writeAndRead(sock, reader, {
        id: 'append-1',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-dev-1',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'first',
        },
      });

      const stale = await writeAndRead(sock, reader, {
        id: 'append-2',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-dev-1',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'stale',
        },
      });

      expect(stale.error).toMatchObject({ code: 'task.version_mismatch' });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('rejects malformed append and subscription payloads without mutating state', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const malformedAppend = await writeAndRead(sock, reader, {
        id: 'append-malformed',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: '',
          expectedTaskVersion: 0,
          role: 'user',
          text: '',
        },
      });
      expect(malformedAppend.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const malformedSubscription = await writeAndRead(sock, reader, {
        id: 'subscribe-malformed',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: -1 },
      });
      expect(malformedSubscription.error).toMatchObject({ code: 'protocol.frame_malformed' });
      expect(runtime.createCheckpoint()).toMatchObject({
        eventSequence: 0,
        threadVersions: [],
        events: [],
      });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('returns a scrubbed storage error without mutating state when persistence fails', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stateStore: RuntimeStateStore = {
      commitTransition() {
        throw new Error('sensitive sqlite path and internal detail');
      },
      listEvents() {
        return [];
      },
      loadLatestCheckpoint() {
        return undefined;
      },
    };
    const runtime = new Runtime({ installId, allowNoToken: true, stateStore });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      const failed = await writeAndRead(sock, reader, {
        id: 'append-storage-failure',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-storage-failure',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'do not partially persist',
        },
      });
      expect(failed.error).toEqual({
        code: 'storage.write_failed',
        message: 'The runtime could not persist this transition',
      });
      expect(JSON.stringify(failed)).not.toContain('sensitive sqlite path');
      expect(runtime.createCheckpoint()).toMatchObject({
        eventSequence: 0,
        threadVersions: [],
        events: [],
      });

      const health = await writeAndRead(sock, reader, {
        id: 'health-after-storage-failure',
        kind: 'request',
        type: 'runtime.healthcheck',
        payload: {},
      });
      expect(health.payload).toMatchObject({ ok: true });
    } finally {
      sock.destroy();
      await runtime.stop();
    }
  });

  it('atomically persists the message and demo Run intent before provider execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-atomic-run-intent-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-atomic-run-intent' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    const provider = new RecordingProvider();
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    connection.raw.exec(`
      CREATE TRIGGER fail_run_started
      BEFORE INSERT ON event
      WHEN NEW.type = 'run.started'
      BEGIN
        SELECT RAISE(ABORT, 'forced run intent failure');
      END;
    `);
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId,
      demoProvider: provider,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const reader = createFrameReader(socket);

    try {
      await hello(socket, reader, installId);
      const failed = await writeAndRead(socket, reader, {
        id: 'append-atomic-failure',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-atomic-run-intent',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'persist message and run together',
        },
      });
      expect(failed.error).toEqual({
        code: 'storage.write_failed',
        message: 'The runtime could not persist this transition',
      });
      expect(store.listEvents(workspaceId, 0)).toEqual([]);
      expect(store.loadLatestCheckpoint(checkpointRunId)).toBeUndefined();
      expect(provider.callCount).toBe(0);
      expect(runtime.createCheckpoint()).toMatchObject({
        eventSequence: 0,
        threadVersions: [],
        events: [],
      });

      connection.raw.exec('DROP TRIGGER fail_run_started');
      const retried = await writeAndRead(socket, reader, {
        id: 'append-atomic-retry',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-atomic-run-intent',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'persist message and run together',
        },
      });
      expect(retried.error).toBeUndefined();
      expect(retried.payload).toMatchObject({ taskVersion: 1 });
      expect(await waitFor(() => provider.callCount === 1)).toBe(true);
      const intentTypes = store
        .listEvents(workspaceId, 0)
        .map((event) => event.type)
        .slice(0, 3);
      expect(intentTypes).toEqual(['message.appended', 'context.packet.built', 'run.started']);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores task versions and event sequence from a checkpoint snapshot', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    try {
      await hello(sock, reader, installId);
      await writeAndRead(sock, reader, {
        id: 'append-before-checkpoint',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-restore-1',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'before checkpoint',
        },
      });
    } finally {
      sock.destroy();
      await runtime.stop();
    }

    const checkpoint = runtime.createCheckpoint();
    const restoredInstallId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const restored = new Runtime({
      installId: restoredInstallId,
      allowNoToken: true,
      checkpoint,
    });
    await restored.start();
    const restoredSock = await connectRuntime(restoredInstallId);
    const restoredReader = createFrameReader(restoredSock);
    try {
      await hello(restoredSock, restoredReader, restoredInstallId);
      const subscribe = await writeAndRead(restoredSock, restoredReader, {
        id: 'sub-after-restore',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 1 },
      });
      expect(subscribe.payload).toMatchObject({ startingSequence: 2 });

      restoredSock.write(
        encodeFrame({
          id: 'append-after-restore',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: 'thread-restore-1',
            expectedTaskVersion: 1,
            role: 'user',
            text: 'after restore',
          },
        }),
      );
      const frames = await restoredReader.read(2);
      const append = frames.find((frame) => frame.id === 'append-after-restore')!;
      const eventFrame = frames.find((frame) => frame.kind === 'event')!;

      expect(append.payload).toMatchObject({ taskVersion: 2 });
      expect(eventFrame.payload).toMatchObject({
        event: {
          sequence: 2,
          payload: { text: 'after restore', taskVersion: 2 },
        },
      });
    } finally {
      restoredSock.destroy();
      await restored.stop();
    }
  });

  it('reconstructs task version and event sequence from SQLite after a Runtime restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-recovery-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-dev' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;

    try {
      await runMigrations(dbPath);
      const firstConnection = await openDatabaseAsync({ path: dbPath });
      const firstRuntime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: new SqliteEventCheckpointStore(firstConnection.raw),
        workspaceId,
        checkpointRunId,
      });
      await firstRuntime.start();
      const firstSocket = await connectRuntime(installId);
      const firstReader = createFrameReader(firstSocket);
      try {
        await hello(firstSocket, firstReader, installId);
        const firstAppend = await writeAndRead(firstSocket, firstReader, {
          id: 'append-before-restart',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: 'thread-durable-1',
            expectedTaskVersion: 0,
            role: 'user',
            text: 'persist me',
          },
        });
        expect(firstAppend.payload).toMatchObject({ taskVersion: 1 });
      } finally {
        firstSocket.destroy();
        await firstRuntime.stop();
        firstConnection.raw.close();
      }

      const secondConnection = await openDatabaseAsync({ path: dbPath });
      const secondStore = new SqliteEventCheckpointStore(secondConnection.raw);
      const secondRuntime = new Runtime({
        installId,
        allowNoToken: true,
        stateStore: secondStore,
        workspaceId,
        checkpointRunId,
      });
      await secondRuntime.start();
      const secondSocket = await connectRuntime(installId);
      const secondReader = createFrameReader(secondSocket);
      try {
        await hello(secondSocket, secondReader, installId);
        const appendAfterRestart = await writeAndRead(secondSocket, secondReader, {
          id: 'append-after-restart',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: 'thread-durable-1',
            expectedTaskVersion: 1,
            role: 'user',
            text: 'continue after restart',
          },
        });
        expect(appendAfterRestart.error).toBeUndefined();
        expect(appendAfterRestart.payload).toMatchObject({
          taskVersion: 2,
        });
        expect(secondStore.listEvents(workspaceId, 0).map((event) => event.sequence)).toEqual([
          1, 2,
        ]);
        // Two non-terminal events stay below the sparse-checkpoint cadence;
        // the successful restart above proves Event replay reconstructs the version.
        expect(secondStore.loadLatestCheckpoint(checkpointRunId)).toBeUndefined();
      } finally {
        secondSocket.destroy();
        await secondRuntime.stop();
        secondConnection.raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('rejects a saved Pi selection before recording a user message or starting a run', async () => {
  const installId = 'test-pi-admission-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const provider = new RecordingProvider();
  const runtime = new Runtime({ installId, allowNoToken: true, demoProvider: provider });
  await runtime.start();
  const socket = await connectRuntime(installId);
  const reader = createFrameReader(socket);
  try {
    await hello(socket, reader, installId);
    const before = runtime.createCheckpoint();
    const response = await writeAndRead(socket, reader, {
      id: 'append-saved-pi',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-pi',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'keep draft',
        kernelId: 'pi',
      },
    });
    expect(response.error).toMatchObject({ code: 'protocol.unexpected_request' });
    expect(response.error?.message).toContain('执行尚未接通');
    const after = runtime.createCheckpoint();
    expect(after.eventSequence).toBe(before.eventSequence);
    expect(after.threadVersions).toEqual(before.threadVersions);
    expect(after.events).toEqual(before.events);
    expect(provider.callCount).toBe(0);
  } finally {
    socket.destroy();
    await runtime.stop();
  }
});
