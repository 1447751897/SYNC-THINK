import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FakeProvider,
  type AdapterEvent,
  type ProviderAdapter,
  type ProviderCallRequest,
} from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore } from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

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

async function waitFor(predicate: () => boolean, timeoutMs: number = 1_500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

class PauseAfterFirstDeltaProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  private readonly delegate = new FakeProvider({ chunksPerWord: 1 });

  discoverModels(): Promise<string[]> {
    return this.delegate.discoverModels();
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    let emitted = 0;
    for await (const event of this.delegate.call(request)) {
      yield event;
      emitted++;
      if (emitted === 2) await new Promise<void>(() => {});
    }
  }
}

class RecordingFinishedProvider implements ProviderAdapter {
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

class ThrowingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  callCount = 0;

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.callCount++;
    throw new Error('provider failure with plaintext-secret evidence');
  }
}

describe('M0 fake provider run', () => {
  it('persists a scrubbed terminal failure when the provider throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-provider-throw-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-provider-throw' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const provider = new ThrowingProvider();
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
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello-provider-throw',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'provider-throw',
          features: ['task.appendMessage'],
        },
      });
      await inbox.send({
        id: 'append-provider-throw',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-provider-throw',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'provider should fail durably',
        },
      });

      // §5.3: without a configured fallback chain, provider throw pauses (no silent swap).
      expect(
        await waitFor(() =>
          store
            .listEvents(workspaceId, 0)
            .some((event) => event.type === 'run.paused' || event.type === 'run.failed'),
        ),
      ).toBe(true);
      const terminal = store
        .listEvents(workspaceId, 0)
        .find((event) => event.type === 'run.paused' || event.type === 'run.failed');
      expect(terminal?.payload).toMatchObject({ failureClass: 'unknown' });
      expect(JSON.stringify(terminal)).not.toContain('plaintext-secret');
      expect(String(terminal?.payload.errorMessage ?? '')).toContain('[REDACTED]');
      if (terminal?.type === 'run.paused') {
        expect(terminal.payload).toMatchObject({ reason: 'no_fallback_configured' });
      }
      expect(store.loadLatestCheckpoint(checkpointRunId)).toMatchObject({
        state: { demoRuns: [] },
      });
      expect(provider.callCount).toBe(1);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('persists a terminal failure after an adapter transition write fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-transition-failure-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-transition-failure' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const durableStore = new SqliteEventCheckpointStore(connection.raw);
    let transitionCount = 0;
    const failOnceStore: RuntimeStateStore = {
      commitTransition(input) {
        transitionCount++;
        if (transitionCount === 2) throw new Error('forced adapter transition write failure');
        return durableStore.commitTransition(input);
      },
      listEvents(workspace, afterSequence) {
        return durableStore.listEvents(workspace, afterSequence);
      },
      loadLatestCheckpoint(runId) {
        return durableStore.loadLatestCheckpoint(runId);
      },
    };
    const provider = new RecordingFinishedProvider();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: failOnceStore,
      workspaceId,
      checkpointRunId,
      demoProvider: provider,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello-transition-failure',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'transition-failure',
          features: ['task.appendMessage'],
        },
      });
      await inbox.send({
        id: 'append-transition-failure',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-transition-failure',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'transition should fail durably',
        },
      });

      expect(
        await waitFor(() =>
          durableStore
            .listEvents(workspaceId, 0)
            .some((event) => event.type === 'run.failed' || event.type === 'run.paused'),
        ),
      ).toBe(true);
      const types = durableStore.listEvents(workspaceId, 0).map((event) => event.type);
      expect(types.slice(0, 3)).toEqual([
        'message.appended',
        'context.packet.built',
        'run.started',
      ]);
      expect(types.some((t) => t === 'run.failed' || t === 'run.paused')).toBe(true);
      expect(durableStore.loadLatestCheckpoint(checkpointRunId)).toMatchObject({
        state: { demoRuns: [] },
      });
      expect(provider.callCount).toBe(1);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('recovers a committed Run intent when the process stops before provider execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-run-intent-crash-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-intent-crash' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);

    const firstConnection = await openDatabaseAsync({ path: dbPath });
    const durableStore = new SqliteEventCheckpointStore(firstConnection.raw);
    const interruptedStore: RuntimeStateStore = {
      commitTransition(input) {
        durableStore.commitTransition(input);
        throw new Error('simulated process stop after commit');
      },
      listEvents(workspace, afterSequence) {
        return durableStore.listEvents(workspace, afterSequence);
      },
      loadLatestCheckpoint(runId) {
        return durableStore.loadLatestCheckpoint(runId);
      },
    };
    const firstProvider = new RecordingFinishedProvider();
    const firstRuntime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: interruptedStore,
      workspaceId,
      checkpointRunId,
      demoProvider: firstProvider,
    });
    await firstRuntime.start();
    const firstSocket = await connectRuntime(installId);
    const firstInbox = createFrameInbox(firstSocket);
    try {
      await firstInbox.send({
        id: 'hello-intent-crash',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'demo-intent-crash',
          features: ['task.appendMessage'],
        },
      });
      const append = await firstInbox.send({
        id: 'append-intent-crash',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-demo-intent-crash',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'resume committed intent',
        },
      });
      expect(append.error).toMatchObject({ code: 'storage.write_failed' });
      expect(firstProvider.callCount).toBe(0);
      expect(durableStore.listEvents(workspaceId, 0).map((event) => event.type)).toEqual([
        'message.appended',
        'context.packet.built',
        'run.started',
      ]);
    } finally {
      firstSocket.destroy();
      await firstRuntime.stop();
      firstConnection.raw.close();
    }

    const secondConnection = await openDatabaseAsync({ path: dbPath });
    const secondStore = new SqliteEventCheckpointStore(secondConnection.raw);
    const secondProvider = new RecordingFinishedProvider();
    const secondRuntime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: secondStore,
      workspaceId,
      checkpointRunId,
      demoProvider: secondProvider,
    });
    await secondRuntime.start();
    try {
      expect(await waitFor(() => secondProvider.callCount === 1)).toBe(true);
      expect(
        await waitFor(() =>
          secondStore.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const events = secondStore.listEvents(workspaceId, 0);
      expect(events.filter((event) => event.type === 'message.appended')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'run.started')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(1);
    } finally {
      await secondRuntime.stop();
      secondConnection.raw.close();
    }
  });

  it('persists the full stream and keeps running after its UI client disconnects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-run-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-run' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId,
      demoProvider: new FakeProvider({ chunksPerWord: 1, tickMs: 5 }),
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);

    try {
      const hello = await inbox.send({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'demo-run-test',
          features: ['task.appendMessage', 'runtime.subscribeEvents'],
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const append = await inbox.send({
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-demo-run',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'stream after disconnect',
        },
      });
      expect(append.error).toBeUndefined();
      expect(append.payload).toMatchObject({ taskVersion: 1 });
      expect((append.payload as { streamId?: string }).streamId).toBeTruthy();
      socket.destroy();

      const completed = await waitFor(() =>
        store.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
      );
      expect(completed).toBe(true);

      const events = store.listEvents(workspaceId, 0);
      const types = events.map((event) => event.type);
      expect(types[0]).toBe('message.appended');
      expect(types).toContain('run.started');
      expect(types).toContain('provider.usage');
      expect(types).toContain('message.delta');
      expect(types[types.length - 1]).toBe('run.completed');
      expect(events.every((event) => !Object.hasOwn(event.payload, 'run'))).toBe(true);
      expect(
        connection.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(checkpointRunId),
      ).toEqual({ count: 1 });
      expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
      expect(store.loadLatestCheckpoint(checkpointRunId)?.lastEventSequence).toBe(events.length);
      expect(runtime.currentHealthcheck()).toMatchObject({ ok: true, inFlightRuns: 0 });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('resumes at the next adapter event after restart without duplicating durable output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-run-restart-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-restart' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);

    const firstConnection = await openDatabaseAsync({ path: dbPath });
    const firstStore = new SqliteEventCheckpointStore(firstConnection.raw);
    const firstRuntime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: firstStore,
      workspaceId,
      checkpointRunId,
      demoProvider: new PauseAfterFirstDeltaProvider(),
    });
    await firstRuntime.start();
    const firstSocket = await connectRuntime(installId);
    const firstInbox = createFrameInbox(firstSocket);
    try {
      await firstInbox.send({
        id: 'hello-first',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'demo-restart-first',
          features: ['task.appendMessage'],
        },
      });
      const append = await firstInbox.send({
        id: 'append-first',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-demo-restart',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'resume without duplicate',
        },
      });
      expect((append.payload as { streamId?: string }).streamId).toBeTruthy();
      expect(
        await waitFor(() =>
          firstStore.listEvents(workspaceId, 0).some((event) => event.type === 'message.delta'),
        ),
      ).toBe(true);
      expect(
        firstStore.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
      ).toBe(false);
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
      demoProvider: new FakeProvider({ chunksPerWord: 1 }),
    });
    await secondRuntime.start();
    try {
      expect(
        await waitFor(() =>
          secondStore.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const events = secondStore.listEvents(workspaceId, 0);
      expect(events.filter((event) => event.type === 'run.started')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'provider.usage')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(1);
      expect(
        events
          .filter((event) => event.type === 'message.delta')
          .map((event) => event.payload.textDelta)
          .join(''),
      ).toBe('[fake-mini] Echo from fake provider: resume without duplicate ');
      expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
      expect(secondStore.loadLatestCheckpoint(checkpointRunId)).toMatchObject({
        lastEventSequence: events.length,
        state: { demoRuns: [] },
      });
    } finally {
      await secondRuntime.stop();
      secondConnection.raw.close();
    }
  });
  it('cancels an in-flight demo run and persists run.cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-demo-cancel-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-demo-cancel' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const provider = new PauseAfterFirstDeltaProvider();
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
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello-cancel',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'cancel-run',
          features: ['task.appendMessage', 'run.cancel'],
        },
      });
      const append = await inbox.send({
        id: 'append-cancel',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-cancel',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'please stream then cancel',
        },
      });
      expect(append.error).toBeUndefined();
      const runId = (append.payload as { streamId?: string }).streamId;
      expect(typeof runId).toBe('string');

      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((event) => event.type === 'message.delta'),
        ),
      ).toBe(true);

      const cancel = await inbox.send({
        id: 'cancel-run',
        kind: 'request',
        type: 'run.cancel',
        payload: { runId },
      });
      expect(cancel.error).toBeUndefined();
      expect(cancel.payload).toMatchObject({ runId, state: 'cancelled' });

      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((event) => event.type === 'run.cancelled'),
        ),
      ).toBe(true);
      const cancelled = store
        .listEvents(workspaceId, 0)
        .find((event) => event.type === 'run.cancelled');
      expect(cancelled?.runId).toBe(runId);
      expect(store.loadLatestCheckpoint(checkpointRunId)).toMatchObject({
        state: { demoRuns: [] },
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
