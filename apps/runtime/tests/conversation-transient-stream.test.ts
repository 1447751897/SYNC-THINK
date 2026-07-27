import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationTransientFrame,
  type Frame,
} from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class ScriptedProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  constructor(
    private readonly createEvents: () => AdapterEvent[],
    private readonly tickMs: number = 1,
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    for (const event of this.createEvents()) {
      yield event;
      if (this.tickMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.tickMs));
      }
    }
  }
}

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createInbox(socket: Socket) {
  const queued: Frame[] = [];
  const responseWaiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = responseWaiters.get(frame.id);
      if (frame.kind === 'response' && waiter) {
        responseWaiters.delete(frame.id);
        waiter(frame);
      } else {
        queued.push(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => responseWaiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
    queued,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

async function hello(
  inbox: ReturnType<typeof createInbox>,
  installId: string,
  id: string,
): Promise<void> {
  const response = await inbox.send({
    id,
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: id,
      features: ['task.appendMessage', 'conversation.transientStream'],
    },
  });
  expect(response.error).toBeUndefined();
}

async function createFixture(events: () => AdapterEvent[], tickMs: number = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-transient-stream-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = 'workspace-transient-stream' as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: new ScriptedProvider(events, tickMs),
  });
  await runtime.start();
  return { connection, installId, runtime, store, workspaceId };
}

function transientFrames(inbox: ReturnType<typeof createInbox>): ConversationTransientFrame[] {
  return inbox.queued
    .filter((frame) => frame.kind === 'event' && frame.type === 'conversation.transientFrame')
    .map(
      (frame) =>
        (frame.payload as { frame: ConversationTransientFrame }).frame,
    );
}

describe('conversation transient shadow stream', () => {
  it('delivers process, text, reasoning, and terminal frames without persisting delta events', async () => {
    const fixture = await createFixture(() => [
      { type: 'reasoning-delta', text: 'think' },
      { type: 'text-delta', text: 'answer' },
      { type: 'finished', reason: 'stop' },
    ]);
    const socketA = await connectRuntime(fixture.installId);
    const socketB = await connectRuntime(fixture.installId);
    const inboxA = createInbox(socketA);
    const inboxB = createInbox(socketB);
    try {
      await hello(inboxA, fixture.installId, 'hello-a');
      await hello(inboxB, fixture.installId, 'hello-b');
      const subscribedA = await inboxA.send({
        id: 'subscribe-a',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-a', afterStreamSequence: 0 },
      });
      await inboxB.send({
        id: 'subscribe-b',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-b', afterStreamSequence: 0 },
      });
      expect(subscribedA.payload).toMatchObject({
        threadId: 'thread-a',
        replayedFrames: [],
        latestStreamSequence: 0,
        resetRequired: false,
      });

      await inboxA.send({
        id: 'append-a',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-a',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'hello',
        },
      });
      expect(await waitFor(() => transientFrames(inboxA).length === 4)).toBe(true);
      expect(transientFrames(inboxA)).toMatchObject([
        { threadId: 'thread-a', streamSequence: 1, kind: 'process' },
        { threadId: 'thread-a', streamSequence: 2, kind: 'reasoning', textDelta: 'think' },
        { threadId: 'thread-a', streamSequence: 3, kind: 'text', textDelta: 'answer' },
        {
          threadId: 'thread-a',
          streamSequence: 4,
          kind: 'terminal',
          terminalState: 'completed',
        },
      ]);
      expect(transientFrames(inboxB)).toEqual([]);

      const durable = fixture.store.listEvents(fixture.workspaceId, 0);
      expect(durable.map((event) => event.type)).toContain('run.completed');
      expect(durable.map((event) => event.type)).not.toContain('message.reasoning_delta');
      expect(durable.map((event) => event.type)).not.toContain('message.delta');
      expect(durable.every((event) => Number.isSafeInteger(event.sequence))).toBe(true);
    } finally {
      socketA.destroy();
      socketB.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('replays frames after a thread-local cursor and stops delivery after unsubscribe', async () => {
    const fixture = await createFixture(() => [
      { type: 'reasoning-delta', text: 'r' },
      { type: 'text-delta', text: 't' },
      { type: 'finished', reason: 'stop' },
    ]);
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, fixture.installId, 'hello-producer');
      await hello(subscriberInbox, fixture.installId, 'hello-subscriber');
      await producerInbox.send({
        id: 'append-before-replay',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-replay',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'first',
        },
      });
      expect(
        await waitFor(() =>
          fixture.store
            .listEvents(fixture.workspaceId, 0)
            .some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-replay',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-replay', afterStreamSequence: 1 },
      });
      expect(subscribed.payload).toMatchObject({
        latestStreamSequence: 4,
        resetRequired: false,
        replayedFrames: [
          { streamSequence: 2, kind: 'reasoning' },
          { streamSequence: 3, kind: 'text' },
          { streamSequence: 4, kind: 'terminal' },
        ],
      });
      const streamId = (subscribed.payload as { streamId: string }).streamId;
      const unsubscribed = await subscriberInbox.send({
        id: 'unsubscribe-replay',
        kind: 'request',
        type: 'conversation.unsubscribeTransientStream',
        payload: { streamId },
      });
      expect(unsubscribed.payload).toEqual({ streamId });

      await producerInbox.send({
        id: 'append-after-unsubscribe',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-replay',
          expectedTaskVersion: 1,
          role: 'user',
          text: 'second',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .filter((event) => event.type === 'run.completed').length === 2,
        ),
      ).toBe(true);
      expect(transientFrames(subscriberInbox)).toEqual([]);
    } finally {
      producer.destroy();
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('returns an active snapshot when replay reset is required mid-run', async () => {
    let releaseCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    class PausedProvider implements ProviderAdapter {
      readonly protocol = 'openai-chat' as const;
      async discoverModels(): Promise<string[]> {
        return ['fake-mini'];
      }
      async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
        for (let index = 0; index < 260; index++) {
          yield { type: 'text-delta', text: 'x' };
        }
        await completionGate;
        yield { type: 'finished', reason: 'stop' };
      }
    }

    const dir = mkdtempSync(join(tmpdir(), 'sync-think-transient-snapshot-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-transient-snapshot' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: new PausedProvider(),
    });
    await runtime.start();
    const producer = await connectRuntime(installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, installId, 'hello-snapshot-producer');
      await hello(subscriberInbox, installId, 'hello-snapshot-subscriber');
      await producerInbox.send({
        id: 'append-snapshot',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-snapshot',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'produce active snapshot',
        },
      });
      expect(
        await waitFor(() => {
          const events = store.listEvents(workspaceId, 0);
          return (
            events.some((event) => event.type === 'run.started') &&
            !events.some((event) => event.type === 'run.completed')
          );
        }, 5_000),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-snapshot',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-snapshot', afterStreamSequence: 0 },
      });
      expect(subscribed.payload).toMatchObject({
        latestStreamSequence: 261,
        resetRequired: true,
        snapshot: {
          threadId: 'thread-snapshot',
          streamSequence: 261,
          text: 'x'.repeat(260),
        },
      });
      const durableTypes = store.listEvents(workspaceId, 0).map((event) => event.type);
      expect(durableTypes).not.toContain('message.delta');
      expect(durableTypes).not.toContain('message.reasoning_delta');
    } finally {
      releaseCompletion();
      producer.destroy();
      subscriber.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
  it('signals resetRequired for a cursor ahead of the Runtime without rejecting the subscription', async () => {
    const fixture = await createFixture(() => []);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(subscriberInbox, fixture.installId, 'hello-ahead-subscriber');
      const subscribed = await subscriberInbox.send({
        id: 'subscribe-ahead',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-ahead', afterStreamSequence: 99 },
      });
      expect(subscribed.error).toBeUndefined();
      expect(subscribed.payload).toMatchObject({
        threadId: 'thread-ahead',
        replayedFrames: [],
        latestStreamSequence: 0,
        resetRequired: true,
      });
    } finally {
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('keeps 1000 output chunks transient while persisting one terminal boundary', async () => {
    const fixture = await createFixture(() => [
      ...Array.from({ length: 1_000 }, (_, index) =>
        index % 2 === 0
          ? ({ type: 'text-delta', text: 'a' } as const)
          : ({ type: 'reasoning-delta', text: 'r' } as const),
      ),
      { type: 'finished', reason: 'stop' } as const,
    ], 0);
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    try {
      await hello(producerInbox, fixture.installId, 'hello-1000-deltas');
      await producerInbox.send({
        id: 'append-1000-deltas',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-1000-deltas',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'stream 1000 chunks',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === 'run.completed'),
          10_000,
        ),
      ).toBe(true);

      const durable = fixture.store.listEvents(fixture.workspaceId, 0);
      expect(durable.filter((event) => event.type === 'message.delta')).toHaveLength(0);
      expect(durable.filter((event) => event.type === 'message.reasoning_delta')).toHaveLength(0);
      expect(durable.filter((event) => event.type === 'run.completed')).toHaveLength(1);
      const completed = durable.find((event) => event.type === 'run.completed');
      expect(String(completed?.payload.assistantText ?? '')).toHaveLength(500);
      expect(String(completed?.payload.reasoningText ?? '')).toHaveLength(500);
      // The exact count includes message/run intent boundaries, but must remain
      // constant rather than growing with the 1000 provider chunks.
      expect(durable.length).toBeLessThan(20);
    } finally {
      producer.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
  it('signals resetRequired when a cursor falls outside the bounded replay window', async () => {
    const fixture = await createFixture(() => [
      ...Array.from({ length: 260 }, () => ({ type: 'text-delta', text: 'x' }) as const),
      { type: 'finished', reason: 'stop' } as const,
    ]);
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, fixture.installId, 'hello-reset-producer');
      await hello(subscriberInbox, fixture.installId, 'hello-reset-subscriber');
      await producerInbox.send({
        id: 'append-reset',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-reset',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'produce many frames',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === 'run.completed'),
          5_000,
        ),
      ).toBe(true);

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-reset',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-reset', afterStreamSequence: 0 },
      });
      const payload = subscribed.payload as {
        replayedFrames: ConversationTransientFrame[];
        latestStreamSequence: number;
        resetRequired: boolean;
      };
      expect(payload.latestStreamSequence).toBe(262);
      expect(payload.resetRequired).toBe(true);
      expect(payload.replayedFrames).toHaveLength(256);
      expect(payload.replayedFrames[0]?.streamSequence).toBe(7);
      expect(payload.replayedFrames.at(-1)).toMatchObject({
        streamSequence: 262,
        kind: 'terminal',
      });
    } finally {
      producer.destroy();
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
