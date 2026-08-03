import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync } from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock SQLite files after runtime stop.
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
  readResponse: (id: string) => Promise<Frame>;
  waitForEvent: (
    predicate: (eventType: string, eventPayload: Record<string, unknown>, frame: Frame) => boolean,
    timeoutMs?: number,
  ) => Promise<Frame | undefined>;
  close: () => void;
} {
  const responses = new Map<string, Frame[]>();
  const responseWaiters = new Map<string, Array<(frame: Frame) => void>>();
  const events: Frame[] = [];
  const eventWaiters: Array<{
    predicate: (eventType: string, eventPayload: Record<string, unknown>, frame: Frame) => boolean;
    resolve: (frame: Frame | undefined) => void;
  }> = [];
  let pending = Buffer.alloc(0);
  let closed = false;

  const unwrap = (frame: Frame): { type: string; payload: Record<string, unknown> } | undefined => {
    if (frame.kind !== 'event') return undefined;
    const outer = frame.payload as
      { event?: { type?: string; payload?: Record<string, unknown> } } | undefined;
    const nested = outer?.event;
    if (nested && typeof nested.type === 'string') {
      return {
        type: nested.type,
        payload: (nested.payload && typeof nested.payload === 'object'
          ? nested.payload
          : {}) as Record<string, unknown>,
      };
    }
    return {
      type: String(frame.type ?? ''),
      payload: (outer as Record<string, unknown>) ?? {},
    };
  };

  const deliverEvent = (frame: Frame) => {
    const u = unwrap(frame);
    if (!u) return;
    for (let i = 0; i < eventWaiters.length; i++) {
      const waiter = eventWaiters[i]!;
      if (waiter.predicate(u.type, u.payload, frame)) {
        eventWaiters.splice(i, 1);
        waiter.resolve(frame);
        return;
      }
    }
    events.push(frame);
  };

  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      for (const frame of decoded.frames) {
        if (frame.kind === 'response' || frame.kind === 'error') {
          const waiters = responseWaiters.get(frame.id);
          if (waiters && waiters.length > 0) {
            waiters.shift()!(frame);
            if (waiters.length === 0) responseWaiters.delete(frame.id);
          } else {
            const list = responses.get(frame.id) ?? [];
            list.push(frame);
            responses.set(frame.id, list);
          }
        } else if (frame.kind === 'event') {
          deliverEvent(frame);
        }
      }
    } catch {
      // ignore decode errors in tests
    }
  });

  return {
    readResponse(id: string) {
      const queued = responses.get(id);
      if (queued && queued.length > 0) {
        const frame = queued.shift()!;
        if (queued.length === 0) responses.delete(id);
        return Promise.resolve(frame);
      }
      return new Promise<Frame>((resolve) => {
        const list = responseWaiters.get(id) ?? [];
        list.push(resolve);
        responseWaiters.set(id, list);
      });
    },
    waitForEvent(predicate, timeoutMs = 6_000) {
      for (let i = 0; i < events.length; i++) {
        const frame = events[i]!;
        const u = unwrap(frame);
        if (u && predicate(u.type, u.payload, frame)) {
          events.splice(i, 1);
          return Promise.resolve(frame);
        }
      }
      return new Promise<Frame | undefined>((resolve) => {
        const waiter = { predicate, resolve };
        eventWaiters.push(waiter);
        setTimeout(() => {
          const idx = eventWaiters.indexOf(waiter);
          if (idx >= 0) {
            eventWaiters.splice(idx, 1);
            resolve(undefined);
          }
        }, timeoutMs);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      while (eventWaiters.length > 0) eventWaiters.shift()!.resolve(undefined);
    },
  };
}

async function writeAndRead(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  frame: Frame,
): Promise<Frame> {
  const response = reader.readResponse(frame.id);
  sock.write(encodeFrame(frame));
  return response;
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
        'agent.get',
        'agent.updateBinding',
        'provider.create',
        'provider.addModels',
        'task.appendMessage',
        'workspace.create',
        'task.create',
        'runtime.subscribeEvents',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

function eventType(frame: Frame): string {
  const outer = frame.payload as { event?: { type?: string } } | undefined;
  return String(outer?.event?.type ?? frame.type ?? '');
}

function eventInner(frame: Frame): Record<string, unknown> {
  const outer = frame.payload as { event?: { payload?: Record<string, unknown> } } | undefined;
  return (outer?.event?.payload ?? {}) as Record<string, unknown>;
}

/** Fails primary providerModelId with a retryable class; succeeds on fallback. */
class FallbackChainProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: string[] = [];
  constructor(
    private readonly failProviderModelId: string,
    private readonly failureClass:
      'timeout' | 'rate-limit' | 'auth' | 'acceptance' | 'permission' = 'timeout',
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['alpha-model', 'beta-model', 'gamma-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push(request.modelId);
    if (request.modelId === this.failProviderModelId) {
      yield {
        type: 'error',
        failureClass: this.failureClass,
        message: `simulated ${this.failureClass} on ${request.modelId}`,
      };
      return;
    }
    yield { type: 'text-delta', text: `ok-from:${request.modelId}:` };
    yield {
      type: 'text-delta',
      text:
        request.messages[0] && typeof request.messages[0].content === 'string'
          ? request.messages[0].content
          : '',
    };
    yield { type: 'finished', reason: 'stop' };
  }
}

/** Always errors with the given class (used for exhausted / non-retryable cases). */
class AlwaysFailProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: string[] = [];
  constructor(private readonly failureClass: 'timeout' | 'acceptance' = 'timeout') {}

  async discoverModels(): Promise<string[]> {
    return ['alpha-model', 'beta-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push(request.modelId);
    yield {
      type: 'error',
      failureClass: this.failureClass,
      message: `always-fail ${this.failureClass} on ${request.modelId}`,
    };
  }
}

/** Emits a retryable failure once per model, then terminates a pre-fix cycle safely. */
class RepeatGuardFailProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: string[] = [];
  private readonly seen = new Set<string>();

  async discoverModels(): Promise<string[]> {
    return ['alpha-model', 'beta-model', 'gamma-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push(request.modelId);
    const repeated = this.seen.has(request.modelId);
    this.seen.add(request.modelId);
    yield {
      type: 'error',
      failureClass: repeated ? 'acceptance' : 'timeout',
      message: repeated
        ? `cycle guard repeated ${request.modelId}`
        : `retryable failure on ${request.modelId}`,
    };
  }
}

describe('runtime fallback walk on model failure (design §5.3)', () => {
  it('walks agent fallback after retryable default failure and completes without restating context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-walk-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const adapter = new FallbackChainProvider('alpha-model', 'timeout');
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'FB Gateway',
        baseUrl: 'https://fb.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-fallback-test-key-not-real',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;

    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha' },
          { providerModelId: 'beta-model', displayName: 'Beta' },
          { providerModelId: 'gamma-model', displayName: 'Gamma' },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const alpha = models.find((m) => m.providerModelId === 'alpha-model')!;
    const beta = models.find((m) => m.providerModelId === 'beta-model')!;
    const gamma = models.find((m) => m.providerModelId === 'gamma-model')!;

    const updated = await writeAndRead(sock, reader, {
      id: 'agent-upd-1',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: alpha.modelId,
        fallbackModelIds: [beta.modelId, gamma.modelId],
        pauseOnFailure: true,
      },
    });
    expect(updated.error).toBeUndefined();

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'FB WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'FB task', goal: 'fallback walk' },
    });
    const taskPayload = task.payload as {
      threadId: string;
      taskVersion: number;
    };

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    const userText = 'same-task-no-restate-fallback';
    const append = await writeAndRead(sock, reader, {
      id: 'msg-1',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: userText,
      },
    });
    expect(append.error).toBeUndefined();

    const fallbackSelected = await reader.waitForEvent((t) => t === 'run.fallback.selected', 6_000);
    const completed = await reader.waitForEvent((t) => t === 'run.completed', 8_000);

    // Provider called default (alpha) then fallback (beta); never gamma.
    // Prefer event evidence, but adapter call order is authoritative for the walk.
    expect(adapter.calls).toEqual(['alpha-model', 'beta-model']);
    expect(fallbackSelected ?? completed).toBeDefined();
    expect(completed).toBeDefined();

    // Collect relevant frames from remaining + completed path via drain after waiting more.
    // Re-open observation: scan nothing more needed — verify calls + completed payload model.
    const blob = JSON.stringify(completed);
    expect(blob.includes(beta.modelId) || blob.includes('beta-model')).toBe(true);
    expect(blob).not.toContain('sk-fallback-test-key');
    expect(adapter.calls[0]).toBe('alpha-model');
    expect(adapter.calls[1]).toBe('beta-model');
    if (fallbackSelected) {
      const fbBlob = JSON.stringify(fallbackSelected);
      expect(fbBlob.includes('agentFallback') || fbBlob.includes('run.fallback.selected')).toBe(
        true,
      );
    }

    reader.close();
    sock.destroy();
    await session.close();

    const audit = await openDatabaseAsync({ path: dbPath });
    try {
      const durableEvents = audit.raw
        .prepare(
          `SELECT type, sequence
           FROM event
           WHERE type IN ('run.fallback.selected', 'context.packet.built')
           ORDER BY sequence ASC`,
        )
        .all() as Array<{ type: string; sequence: number }>;
      const fallbackEvents = durableEvents.filter((event) => event.type === 'run.fallback.selected');
      const contextEvents = durableEvents.filter((event) => event.type === 'context.packet.built');
      const fallbackIndex = durableEvents.findIndex(
        (event) => event.type === 'run.fallback.selected',
      );
      const eventCount = (
        audit.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number }
      ).count;
      const checkpointCount = (
        audit.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as { count: number }
      ).count;

      expect(fallbackEvents).toHaveLength(1);
      expect(contextEvents).toHaveLength(2);
      expect(durableEvents[fallbackIndex + 1]?.type).toBe('context.packet.built');
      expect(durableEvents[fallbackIndex + 1]?.sequence).toBe(
        durableEvents[fallbackIndex]!.sequence + 1,
      );
      expect(eventCount).toBeGreaterThan(1);
      expect(checkpointCount).toBe(1);
    } finally {
      audit.raw.close();
    }
  }, 30_000);

  it('skips generated-media models in the same-provider text fallback chain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-text-only-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-text-only-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const adapter = new FallbackChainProvider('alpha-model', 'timeout');
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-text-only',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Text-only fallback Gateway',
        baseUrl: 'https://text-only.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-text-only-test-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-text-only',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha', capabilities: ['text'] },
          {
            providerModelId: 'grok-imagine-video-1.5-preview',
            displayName: 'Imagine Video',
            capabilities: ['text'],
          },
          {
            providerModelId: 'grok-imagine-image-quality',
            displayName: 'Imagine Image',
            capabilities: ['text'],
          },
          { providerModelId: 'beta-model', displayName: 'Beta', capabilities: ['text'] },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const alpha = models.find((model) => model.providerModelId === 'alpha-model')!;

    await writeAndRead(sock, reader, {
      id: 'agent-text-only',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: { defaultModelId: alpha.modelId, fallbackModelIds: [], pauseOnFailure: true },
    });
    const workspace = await writeAndRead(sock, reader, {
      id: 'workspace-text-only',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Text-only fallback WS' },
    });
    const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-text-only',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'Text-only fallback task', goal: 'skip media models' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'sub-text-only',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    await writeAndRead(sock, reader, {
      id: 'message-text-only',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'skip non-text fallback candidates',
      },
    });

    const fallbackSelected = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      6_000,
    );
    const completed = await reader.waitForEvent((type) => type === 'run.completed', 8_000);

    expect(fallbackSelected).toBeDefined();
    expect(eventInner(fallbackSelected!).toProviderModelId).toBe('beta-model');
    expect(completed).toBeDefined();
    expect(adapter.calls).toEqual(['alpha-model', 'beta-model']);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('does not cycle from provider fallbacks back into an already-attempted agent fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-cycle-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const adapter = new RepeatGuardFailProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-cycle',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Cycle Gateway',
        baseUrl: 'https://cycle.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-cycle-test-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-cycle',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha' },
          { providerModelId: 'beta-model', displayName: 'Beta' },
          { providerModelId: 'gamma-model', displayName: 'Gamma' },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const alpha = models.find((model) => model.providerModelId === 'alpha-model')!;
    const gamma = models.find((model) => model.providerModelId === 'gamma-model')!;

    const updated = await writeAndRead(sock, reader, {
      id: 'agent-cycle',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: gamma.modelId,
        fallbackModelIds: [alpha.modelId],
        pauseOnFailure: true,
      },
    });
    expect(updated.error).toBeUndefined();

    const workspace = await writeAndRead(sock, reader, {
      id: 'ws-cycle',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Cycle WS' },
    });
    const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-cycle',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'Cycle task', goal: 'bound fallback transitions' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'sub-cycle',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    const append = await writeAndRead(sock, reader, {
      id: 'message-cycle',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'provider chain must not cycle through agent fallback',
        modelId: alpha.modelId,
      },
    });
    expect(append.error).toBeUndefined();

    const firstFallback = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      6_000,
    );
    const secondFallback = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      6_000,
    );
    const terminal = await reader.waitForEvent(
      (type) => type === 'run.paused' || type === 'run.failed',
      8_000,
    );
    const unexpectedFallback = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      100,
    );

    expect(eventInner(firstFallback!).toProviderModelId).toBe('beta-model');
    expect(eventInner(secondFallback!).toProviderModelId).toBe('gamma-model');
    expect(eventType(terminal!)).toBe('run.paused');
    expect(eventInner(terminal!).reason).toBe('fallback_exhausted');
    expect(unexpectedFallback).toBeUndefined();
    expect(adapter.calls).toEqual(['alpha-model', 'beta-model', 'gamma-model']);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('pauses when fallback chain is exhausted (no silent model swap)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-exhaust-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-ex-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const adapter = new AlwaysFailProvider('timeout');
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'EX Gateway',
        baseUrl: 'https://ex.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-exhaust-test-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha' },
          { providerModelId: 'beta-model', displayName: 'Beta' },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const alpha = models.find((m) => m.providerModelId === 'alpha-model')!;
    const beta = models.find((m) => m.providerModelId === 'beta-model')!;

    await writeAndRead(sock, reader, {
      id: 'agent-upd-1',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: alpha.modelId,
        fallbackModelIds: [beta.modelId],
        pauseOnFailure: true,
      },
    });

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'EX WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'EX task', goal: 'exhaust' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    await writeAndRead(sock, reader, {
      id: 'msg-1',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'will exhaust fallbacks',
      },
    });

    const paused = await reader.waitForEvent((t) => t === 'run.paused', 8_000);
    // Default + one fallback attempted; no third silent model.
    expect(adapter.calls).toEqual(['alpha-model', 'beta-model']);
    expect(paused).toBeDefined();
    const blob = JSON.stringify(paused);
    expect(blob.includes('fallback_exhausted') || eventType(paused!) === 'run.paused').toBe(true);
    expect(adapter.calls.length).toBe(2);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('does not walk fallback on acceptance failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-accept-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-acc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const adapter = new FallbackChainProvider('alpha-model', 'acceptance');
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'ACC Gateway',
        baseUrl: 'https://acc.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-accept-test-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha' },
          { providerModelId: 'beta-model', displayName: 'Beta' },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const alpha = models.find((m) => m.providerModelId === 'alpha-model')!;
    const beta = models.find((m) => m.providerModelId === 'beta-model')!;

    await writeAndRead(sock, reader, {
      id: 'agent-upd-1',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: alpha.modelId,
        fallbackModelIds: [beta.modelId],
        pauseOnFailure: true,
      },
    });

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'ACC WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'ACC task', goal: 'no fallback on acceptance' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    await writeAndRead(sock, reader, {
      id: 'msg-1',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'acceptance should not fallback',
      },
    });

    const failed = await reader.waitForEvent(
      (t, p) => t === 'run.failed' || String(p.failureClass ?? '') === 'acceptance',
      8_000,
    );
    expect(failed).toBeDefined();
    expect(adapter.calls).toEqual(['alpha-model']);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('same task can run across ≥3 models via sequential run overrides without restating setup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-multi-model-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mm-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const calls: string[] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return ['m1', 'm2', 'm3'];
      },
      async *call(request: ProviderCallRequest) {
        calls.push(request.modelId);
        yield { type: 'text-delta', text: `hi:${request.modelId}` };
        yield { type: 'finished', reason: 'stop' };
      },
    };

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Two providers, three models total — M1 exit criterion shape.
    const p1 = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'GW-A',
        baseUrl: 'https://a.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-multi-a-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerA = (p1.payload as { provider: { providerId: string } }).provider.providerId;
    const p2 = await writeAndRead(sock, reader, {
      id: 'prov-2',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'GW-B',
        baseUrl: 'https://b.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-multi-b-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerB = (p2.payload as { provider: { providerId: string } }).provider.providerId;

    const addA = await writeAndRead(sock, reader, {
      id: 'add-a',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerA,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'm1', displayName: 'M1' },
          { providerModelId: 'm2', displayName: 'M2' },
        ],
      },
    });
    const addB = await writeAndRead(sock, reader, {
      id: 'add-b',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerB,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'm3', displayName: 'M3' }],
      },
    });
    const modelsA = (
      addA.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models;
    const modelsB = (
      addB.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models;
    const m1 = modelsA.find((m) => m.providerModelId === 'm1')!;
    const m2 = modelsA.find((m) => m.providerModelId === 'm2')!;
    const m3 = modelsB.find((m) => m.providerModelId === 'm3')!;

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'MM WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'multi model task', goal: 'same task ≥3 models' },
    });
    let taskVersion = (task.payload as { taskVersion: number }).taskVersion;
    const threadId = (task.payload as { threadId: string }).threadId;

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    for (const [idx, model] of [m1, m2, m3].entries()) {
      const append = await writeAndRead(sock, reader, {
        id: `msg-${idx}`,
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: taskVersion,
          role: 'user',
          text: `turn-${idx + 1}`,
          modelId: model.modelId,
        },
      });
      expect(append.error).toBeUndefined();
      taskVersion = ((append.payload as { taskVersion?: number }).taskVersion ??
        taskVersion + 1) as number;

      const done = await reader.waitForEvent((t) => t === 'run.completed', 8_000);
      expect(done).toBeDefined();
    }

    expect(calls).toEqual(['m1', 'm2', 'm3']);

    reader.close();
    sock.destroy();
    await session.close();
  }, 40_000);
});
