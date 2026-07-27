import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteProviderStore,
} from '@sync-think/storage';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import type { WorkspaceId, RunId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
      } else frames.push(frame);
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

class LiveRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  calls: ProviderCallRequest[] = [];
  async discoverModels(): Promise<string[]> {
    return ['live-mini'];
  }
  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({
      ...request,
      apiKey: request.apiKey ? '[present]' : '',
    });
    yield { type: 'text-delta', text: `live:${request.modelId}:` };
    yield { type: 'text-delta', text: request.messages[0] && typeof request.messages[0].content === 'string' ? request.messages[0].content : '' };
    yield { type: 'finished', reason: 'stop' };
  }
}

describe('model binding + live stream', () => {
  it('builds Manifest, resolves registered model, streams via protocol adapter with secret retrieve', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-binding-live-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-bind-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-binding' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const secret = 'sk-LIVE_BINDING_TEST_KEY_NEVER_PERSIST';
    const handle = await secureStore.storeSecret(secret);
    const created = providerStore.createProvider({
      name: 'Live Gateway',
      baseUrl: 'https://live.example/v1',
      protocol: 'openai-chat',
      storeHandle: handle,
    });
    const models = providerStore.upsertModels({
      providerId: created.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'gpt-live-mini', displayName: 'Live Mini' },
        { providerModelId: 'gpt-live-large', displayName: 'Live Large' },
      ],
    });
    const adapter = new LiveRecordingAdapter();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId,
      providerStore,
      secureStore,
      discoveryByProtocol: { 'openai-chat': adapter },
      // no demoProvider ? must take live path
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
          nonce: 'binding-live',
          features: ['task.appendMessage'],
        },
      });
      const append = await inbox.send({
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-binding',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'hello live binding',
          modelId: models[0]!.id,
        },
      });
      expect(append.error).toBeUndefined();
      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((e) => e.type === 'run.completed'),
        ),
      ).toBe(true);

      const types = store.listEvents(workspaceId, 0).map((e) => e.type);
      expect(types).toContain('context.packet.built');
      expect(types).toContain('run.started');
      expect(types).not.toContain('message.delta');
      expect(types).toContain('run.completed');

      const packet = store.listEvents(workspaceId, 0).find((e) => e.type === 'context.packet.built');
      expect(packet?.payload).toMatchObject({
        resolutionSource: 'runOverride',
        providerModelId: 'gpt-live-mini',
      });
      expect(String(packet?.payload.proofHash ?? '')).toMatch(/^[a-f0-9]{32}$/);

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]).toMatchObject({
        modelId: 'gpt-live-mini',
        baseUrl: 'https://live.example/v1',
        apiKey: '[present]',
      });
      // secret never in event log
      expect(JSON.stringify(store.listEvents(workspaceId, 0))).not.toContain(secret);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
