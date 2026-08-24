import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, SqliteMessageStore } from '@sync-think/storage';
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

/** Always fails with a retryable class so the in-place retry budget is spent
 *  before the fallback circuit opens (no acceptance cliff mid-retry). */
class RepeatGuardFailProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: string[] = [];

  async discoverModels(): Promise<string[]> {
    return ['alpha-model', 'beta-model', 'gamma-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push(request.modelId);
    yield {
      type: 'error',
      failureClass: 'timeout',
      message: `retryable failure on ${request.modelId}`,
    };
  }
}

class ForwardedImageFallbackProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['gpt-4o-primary', 'deepseek-text', 'gpt-4.1-vision-fallback'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    if (request.modelId === 'gpt-4o-primary') {
      yield {
        type: 'error',
        failureClass: 'timeout',
        message: 'simulated vision-primary timeout',
      };
      return;
    }
    yield { type: 'text-delta', text: `ok-from:${request.modelId}` };
    yield { type: 'finished', reason: 'stop' };
  }
}

class PartialCommentaryFallbackProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  constructor(private readonly failureMode: 'error-event' | 'stream-throw') {}

  async discoverModels(): Promise<string[]> {
    return ['alpha-model', 'beta-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    if (request.modelId === 'alpha-model') {
      yield {
        type: 'assistant-message-start',
        phase: 'commentary',
        itemId: 'partial-commentary',
      };
      yield {
        type: 'assistant-message-delta',
        phase: 'commentary',
        itemId: 'partial-commentary',
        text: '我先检查当前状态。',
      };
      yield {
        type: 'assistant-message-end',
        phase: 'commentary',
        itemId: 'partial-commentary',
      };
      if (this.failureMode === 'error-event') {
        yield {
          type: 'error',
          failureClass: 'timeout',
          message: 'simulated timeout after commentary',
        };
        return;
      }
      throw new Error('simulated provider stream timed out after commentary');
    }

    yield {
      type: 'assistant-message-start',
      phase: 'final_answer',
      itemId: 'fallback-final',
    };
    yield {
      type: 'assistant-message-delta',
      phase: 'final_answer',
      itemId: 'fallback-final',
      text: '已从备用模型继续完成。',
    };
    yield {
      type: 'assistant-message-end',
      phase: 'final_answer',
      itemId: 'fallback-final',
    };
    yield { type: 'finished', reason: 'stop' };
  }
}

describe('runtime fallback walk on model failure (design §5.3)', () => {
  it.each(['error-event', 'stream-throw'] as const)(
    'carries visible commentary into fallback history after %s without inheriting incomplete tools',
    async (failureMode) => {
      const dir = mkdtempSync(join(tmpdir(), `sync-think-fb-commentary-${failureMode}-`));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const secureKey = join(dir, 'secure', 'key.bin');
      const installId = `test-fb-commentary-${failureMode}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      const adapter = new PartialCommentaryFallbackProvider(failureMode);
      const session = await openPersistentRuntime({
        installId,
        dbPath,
        secureStoreKeyPath: secureKey,
        allowNoToken: true,
        modelRetryBaseDelayMs: 0,
        demoProvider: adapter,
      });
      await session.runtime.start();

      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      const created = await writeAndRead(sock, reader, {
        id: `prov-commentary-${failureMode}`,
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: `Commentary ${failureMode} Gateway`,
          baseUrl: 'https://commentary.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-commentary-fallback-key-not-real',
          supportsDiscovery: false,
        },
      });
      const providerId = (created.payload as { provider: { providerId: string } }).provider
        .providerId;
      const add = await writeAndRead(sock, reader, {
        id: `add-commentary-${failureMode}`,
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
      const models = (
        add.payload as { models: Array<{ modelId: string; providerModelId: string }> }
      ).models;
      const alpha = models.find((model) => model.providerModelId === 'alpha-model')!;
      const beta = models.find((model) => model.providerModelId === 'beta-model')!;

      await writeAndRead(sock, reader, {
        id: `agent-commentary-${failureMode}`,
        kind: 'request',
        type: 'agent.updateBinding',
        payload: {
          defaultModelId: alpha.modelId,
          fallbackModelIds: [beta.modelId],
          pauseOnFailure: true,
        },
      });
      const workspace = await writeAndRead(sock, reader, {
        id: `workspace-commentary-${failureMode}`,
        kind: 'request',
        type: 'workspace.create',
        payload: {
          folderPath: join(dir, 'workspace'),
          name: `Commentary ${failureMode} workspace`,
        },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const task = await writeAndRead(sock, reader, {
        id: `task-commentary-${failureMode}`,
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: `Commentary ${failureMode} task`,
          goal: 'Preserve visible commentary across fallback',
        },
      });
      const taskPayload = task.payload as { threadId: string; taskVersion: number };

      await writeAndRead(sock, reader, {
        id: `subscribe-commentary-${failureMode}`,
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      });
      await writeAndRead(sock, reader, {
        id: `message-commentary-${failureMode}`,
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: taskPayload.threadId,
          expectedTaskVersion: taskPayload.taskVersion,
          role: 'user',
          text: '检查状态并继续完成。',
        },
      });

      const completed = await reader.waitForEvent((type) => type === 'run.completed', 8_000);
      expect(completed).toBeDefined();
      expect(adapter.requests.map((request) => request.modelId)).toEqual([
        'alpha-model',
        'beta-model',
      ]);

      const fallbackRequest = adapter.requests[1]!;
      expect(
        fallbackRequest.messages.filter(
          (message) => message.role === 'assistant' && message.phase === 'commentary',
        ),
      ).toEqual([
        {
          role: 'assistant',
          phase: 'commentary',
          content: '我先检查当前状态。',
        },
      ]);
      expect(
        fallbackRequest.messages.some(
          (message) =>
            message.role === 'assistant' &&
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === 'tool-call'),
        ),
      ).toBe(false);

      reader.close();
      sock.destroy();
      await session.close();

      const audit = await openDatabaseAsync({ path: dbPath });
      try {
        const assistant = new SqliteMessageStore(audit.raw)
          .listMessages(taskPayload.threadId as never)
          .messages.find((message) => message.role === 'assistant');
        expect(assistant?.blocks.map((block) => block.type)).toEqual([
          'commentary',
          'commentary',
          'text',
        ]);
        expect(assistant?.blocks[0]?.payload).toMatchObject({
          assistantTimeline: [
            expect.objectContaining({
              kind: 'text',
              phase: 'commentary',
              text: '我先检查当前状态。',
              completedAt: expect.any(String),
            }),
            expect.objectContaining({ kind: 'status', statusType: 'model_switch' }),
            expect.objectContaining({
              kind: 'text',
              phase: 'final_answer',
              text: '已从备用模型继续完成。',
            }),
          ],
        });
        expect(assistant?.blocks[1]).toEqual({
          type: 'commentary',
          text: '我先检查当前状态。',
        });
        expect(assistant?.blocks[2]).toEqual({
          type: 'text',
          text: '已从备用模型继续完成。',
        });
      } finally {
        audit.raw.close();
      }
    },
    30_000,
  );

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
      modelRetryBaseDelayMs: 0,
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

    const retrying = await reader.waitForEvent(
      (type, payload) =>
        type === 'run.retrying' && payload.attempt === 5 && payload.maxAttempts === 5,
      6_000,
    );
    const fallbackSelected = await reader.waitForEvent((t) => t === 'run.fallback.selected', 6_000);
    const completed = await reader.waitForEvent((t) => t === 'run.completed', 8_000);

    // Provider called default (alpha) then fallback (beta); never gamma.
    // In-place retry budget (5) is spent on alpha first, then the walk moves
    // to beta: 6 alpha attempts + 1 beta attempt, never gamma.
    expect(adapter.calls).toEqual([
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'beta-model',
    ]);
    expect(retrying).toBeDefined();
    expect(eventInner(retrying!).providerModelId).toBe('alpha-model');
    expect(fallbackSelected ?? completed).toBeDefined();
    expect(completed).toBeDefined();

    // Collect relevant frames from remaining + completed path via drain after waiting more.
    // Re-open observation: scan nothing more needed — verify calls + completed payload model.
    const blob = JSON.stringify(completed);
    expect(blob.includes(beta.modelId) || blob.includes('beta-model')).toBe(true);
    expect(blob).not.toContain('sk-fallback-test-key');
    expect(adapter.calls[0]).toBe('alpha-model');
    expect(adapter.calls[6]).toBe('beta-model');
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
           WHERE type IN ('run.retrying', 'run.fallback.selected', 'context.packet.built')
           ORDER BY sequence ASC`,
        )
        .all() as Array<{ type: string; sequence: number }>;
      const retryEvents = durableEvents.filter((event) => event.type === 'run.retrying');
      const fallbackEvents = durableEvents.filter(
        (event) => event.type === 'run.fallback.selected',
      );
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

      expect(retryEvents).toHaveLength(5);
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
      modelRetryBaseDelayMs: 0,
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
    expect(adapter.calls).toEqual([
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'beta-model',
    ]);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('keeps forwarded images on vision-capable fallback models and skips text candidates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-forwarded-image-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-forwarded-image-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const adapter = new ForwardedImageFallbackProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'provider-forwarded-image',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Forwarded image fallback Gateway',
        baseUrl: 'https://forwarded-image.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-forwarded-image-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'models-forwarded-image',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          {
            providerModelId: 'gpt-4o-primary',
            displayName: 'Vision primary',
            capabilities: ['text', 'vision'],
          },
          {
            providerModelId: 'deepseek-text',
            displayName: 'Text fallback',
            capabilities: ['text'],
          },
          {
            providerModelId: 'gpt-4.1-vision-fallback',
            displayName: 'Vision fallback',
            capabilities: ['text', 'vision'],
          },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const primary = models.find((model) => model.providerModelId === 'gpt-4o-primary')!;
    const textFallback = models.find((model) => model.providerModelId === 'deepseek-text')!;
    const visionFallback = models.find(
      (model) => model.providerModelId === 'gpt-4.1-vision-fallback',
    )!;

    await writeAndRead(sock, reader, {
      id: 'agent-forwarded-image',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: primary.modelId,
        fallbackModelIds: [textFallback.modelId, visionFallback.modelId],
        pauseOnFailure: true,
      },
    });
    const workspace = await writeAndRead(sock, reader, {
      id: 'workspace-forwarded-image',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Forwarded image fallback WS' },
    });
    const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-forwarded-image',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'Forwarded image fallback', goal: 'keep image-compatible' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'subscribe-forwarded-image',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    const append = await writeAndRead(sock, reader, {
      id: 'message-forwarded-image',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'inspect this image',
        modelId: primary.modelId,
        images: [
          {
            name: 'fixture.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
          },
        ],
      },
    });
    expect(append.error).toBeUndefined();
    expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');

    const fallbackSelected = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      6_000,
    );
    const completed = await reader.waitForEvent((type) => type === 'run.completed', 8_000);

    expect(eventInner(fallbackSelected!).toProviderModelId).toBe('gpt-4.1-vision-fallback');
    expect(completed).toBeDefined();
    expect(adapter.requests.map((request) => request.modelId)).toEqual([
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4.1-vision-fallback',
    ]);
    expect(adapter.requests.some((request) => request.modelId === 'deepseek-text')).toBe(false);
    expect(
      adapter.requests.every(
        (request) =>
          Array.isArray(request.messages[0]?.content) &&
          request.messages[0].content.some((part) => part.type === 'image'),
      ),
    ).toBe(true);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('pauses a forwarded-image run when only text fallback models remain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-fb-forwarded-image-exhausted-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-fb-forwarded-image-exhausted-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const adapter = new ForwardedImageFallbackProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      demoProvider: adapter,
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'provider-forwarded-image-exhausted',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Forwarded image exhausted Gateway',
        baseUrl: 'https://forwarded-image-exhausted.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-forwarded-image-exhausted-key-not-real',
        supportsDiscovery: false,
      },
    });
    const providerId = (created.payload as { provider: { providerId: string } }).provider
      .providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'models-forwarded-image-exhausted',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          {
            providerModelId: 'gpt-4o-primary',
            displayName: 'Vision primary',
            capabilities: ['text', 'vision'],
          },
          {
            providerModelId: 'deepseek-text',
            displayName: 'Text fallback',
            capabilities: ['text'],
          },
        ],
      },
    });
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const primary = models.find((model) => model.providerModelId === 'gpt-4o-primary')!;
    const textFallback = models.find((model) => model.providerModelId === 'deepseek-text')!;

    await writeAndRead(sock, reader, {
      id: 'agent-forwarded-image-exhausted',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: primary.modelId,
        fallbackModelIds: [textFallback.modelId],
        pauseOnFailure: true,
      },
    });
    const workspace = await writeAndRead(sock, reader, {
      id: 'workspace-forwarded-image-exhausted',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Forwarded image exhausted WS' },
    });
    const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-forwarded-image-exhausted',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'Forwarded image exhausted', goal: 'pause safely' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'subscribe-forwarded-image-exhausted',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    const append = await writeAndRead(sock, reader, {
      id: 'message-forwarded-image-exhausted',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'inspect this image',
        modelId: primary.modelId,
        images: [
          {
            name: 'fixture.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
          },
        ],
      },
    });
    expect(append.error).toBeUndefined();
    expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');

    const paused = await reader.waitForEvent((type) => type === 'run.paused', 8_000);
    expect(paused).toBeDefined();
    expect(eventInner(paused!).reason).toBe('no_fallback_configured');
    expect(adapter.requests.map((request) => request.modelId)).toEqual([
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
      'gpt-4o-primary',
    ]);
    expect(adapter.requests.some((request) => request.modelId === 'deepseek-text')).toBe(false);

    reader.close();
    sock.destroy();
    await session.close();
  }, 30_000);

  it('opens the provider circuit after two endpoint failures without cycling into more same-provider models', async () => {
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
      modelRetryBaseDelayMs: 0,
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
    const terminal = await reader.waitForEvent(
      (type) => type === 'run.paused' || type === 'run.failed',
      8_000,
    );
    const unexpectedFallback = await reader.waitForEvent(
      (type) => type === 'run.fallback.selected',
      100,
    );

    expect(eventInner(firstFallback!).toProviderModelId).toBe('beta-model');
    expect(eventType(terminal!)).toBe('run.paused');
    expect(eventInner(terminal!).reason).toBe('no_fallback_configured');
    expect(unexpectedFallback).toBeUndefined();
    expect(adapter.calls).toEqual([
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
    ]);

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
      modelRetryBaseDelayMs: 0,
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
    expect(adapter.calls).toEqual([
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'alpha-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
      'beta-model',
    ]);
    expect(paused).toBeDefined();
    const blob = JSON.stringify(paused);
    expect(blob.includes('fallback_exhausted') || eventType(paused!) === 'run.paused').toBe(true);
    expect(adapter.calls.length).toBe(12);

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
      modelRetryBaseDelayMs: 0,
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
      modelRetryBaseDelayMs: 0,
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
