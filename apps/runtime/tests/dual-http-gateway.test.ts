import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { OpenAIChatAdapter } from '@sync-think/adapters';
import { openPersistentRuntime } from '../src/persistence.js';

/**
 * M1 exit evidence: real dual OpenAI-compatible HTTP gateways (not FakeProvider),
 * >=2 providers / >=3 models, same task, live OpenAIChatAdapter + SecureStore path,
 * Manifest inspectable, secrets scrubbed from events.
 */

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock SQLite files after runtime stop.
    }
  }
});

interface GatewayCall {
  method: string;
  url: string;
  authorization?: string;
  model?: string;
  messages?: unknown;
  bodyText: string;
}

interface LocalGateway {
  name: string;
  baseUrl: string;
  port: number;
  calls: GatewayCall[];
  modelBehavior: Map<string, 'ok' | 'auth' | 'rate-limit' | 'timeout'>;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function startLocalGateway(
  name: string,
  modelBehavior: Record<string, 'ok' | 'auth' | 'rate-limit' | 'timeout'>,
): Promise<LocalGateway> {
  const calls: GatewayCall[] = [];
  const behavior = new Map(Object.entries(modelBehavior));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();
      const bodyText = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);
      const authorization = req.headers.authorization;

      let model: string | undefined;
      let messages: unknown;
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText) as { model?: string; messages?: unknown };
          model = parsed.model;
          messages = parsed.messages;
        } catch {
          // ignore
        }
      }

      calls.push({ method, url, authorization, model, messages, bodyText });

      if (method === 'GET' && /\/models\/?$/i.test(url.split('?')[0] ?? '')) {
        const data = [...behavior.keys()].map((id) => ({ id, object: 'model' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
        return;
      }

      if (method === 'POST' && /\/chat\/completions\/?$/i.test(url.split('?')[0] ?? '')) {
        const mode = model ? behavior.get(model) : undefined;
        if (!mode) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'unknown model ' + (model ?? '') } }));
          return;
        }
        if (mode === 'auth') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { message: 'Invalid API key for ' + name + ': sk-SHOULD-NEVER-LEAK-IN-EVENTS' },
            }),
          );
          return;
        }
        if (mode === 'rate-limit') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'rate limited by gateway' } }));
          return;
        }
        if (mode === 'timeout') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'upstream timeout simulated' } }));
          return;
        }

        const reply = 'ok-from:' + name + ':' + model;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n');
        res.write(
          'data: ' +
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 4, completion_tokens: 6 },
            }) +
            '\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'no route ' + method + ' ' + url } }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });

  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to bind local gateway');
  }
  const port = addr.port;
  const baseUrl = 'http://127.0.0.1:' + port + '/v1';

  return {
    name,
    baseUrl,
    port,
    calls,
    modelBehavior: behavior,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
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

  const unwrap = (
    frame: Frame,
  ): { type: string; payload: Record<string, unknown> } | undefined => {
    if (frame.kind !== 'event') return undefined;
    const outer = frame.payload as
      | { event?: { type?: string; payload?: Record<string, unknown> } }
      | undefined;
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

function eventInner(frame: Frame): Record<string, unknown> {
  const outer = frame.payload as { event?: { payload?: Record<string, unknown> } } | undefined;
  return (outer?.event?.payload ?? {}) as Record<string, unknown>;
}

describe('dual local HTTP OpenAI-compatible gateways (live multi-provider M1 evidence)', () => {
  it('same task streams via >=2 real HTTP providers / >=3 models with Manifest + secret scrub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-dual-http-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = 'test-dual-http-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    const gwA = await startLocalGateway('GW-A', {
      'gw-a-mini': 'ok',
      'gw-a-large': 'ok',
    });
    const gwB = await startLocalGateway('GW-B', {
      'gw-b-pro': 'ok',
    });

    const secretA = 'sk-DUAL_HTTP_GATEWAY_A_SECRET_NEVER_LEAK_111';
    const secretB = 'sk-DUAL_HTTP_GATEWAY_B_SECRET_NEVER_LEAK_222';

    // No demoProvider — must take live OpenAIChatAdapter + SecureStore path.
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ timeoutMs: 8_000 }),
      },
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const p1 = await writeAndRead(sock, reader, {
      id: 'prov-a',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Local GW-A',
        baseUrl: gwA.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretA,
        supportsDiscovery: false,
      },
    });
    expect(p1.error).toBeUndefined();
    const providerA = (p1.payload as { provider: { providerId: string } }).provider.providerId;

    const p2 = await writeAndRead(sock, reader, {
      id: 'prov-b',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Local GW-B',
        baseUrl: gwB.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretB,
        supportsDiscovery: false,
      },
    });
    expect(p2.error).toBeUndefined();
    const providerB = (p2.payload as { provider: { providerId: string } }).provider.providerId;

    const addA = await writeAndRead(sock, reader, {
      id: 'add-a',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerA,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'gw-a-mini', displayName: 'A Mini' },
          { providerModelId: 'gw-a-large', displayName: 'A Large' },
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
        models: [{ providerModelId: 'gw-b-pro', displayName: 'B Pro' }],
      },
    });
    const modelsA = (addA.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const modelsB = (addB.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    const m1 = modelsA.find((m) => m.providerModelId === 'gw-a-mini')!;
    const m2 = modelsA.find((m) => m.providerModelId === 'gw-a-large')!;
    const m3 = modelsB.find((m) => m.providerModelId === 'gw-b-pro')!;
    expect(m1 && m2 && m3).toBeTruthy();

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Dual HTTP WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'dual http multi model',
        goal: 'same task multi provider live',
      },
    });
    let taskVersion = (task.payload as { taskVersion: number }).taskVersion;
    const threadId = (task.payload as { threadId: string }).threadId;

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    const turns: Array<{ model: typeof m1; prompt: string; expectText: string }> = [
      { model: m1, prompt: 'turn-1-same-task', expectText: 'ok-from:GW-A:gw-a-mini' },
      { model: m2, prompt: 'turn-2-same-task', expectText: 'ok-from:GW-A:gw-a-large' },
      { model: m3, prompt: 'turn-3-same-task', expectText: 'ok-from:GW-B:gw-b-pro' },
    ];

    const completedFrames: Frame[] = [];
    const packetFrames: Frame[] = [];

    for (const [idx, turn] of turns.entries()) {
      const append = await writeAndRead(sock, reader, {
        id: 'msg-' + idx,
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: taskVersion,
          role: 'user',
          text: turn.prompt,
          modelId: turn.model.modelId,
        },
      });
      expect(append.error).toBeUndefined();
      taskVersion = ((append.payload as { taskVersion?: number }).taskVersion ??
        taskVersion + 1) as number;

      const packet = await reader.waitForEvent(
        (t, p) =>
          t === 'context.packet.built' &&
          (String(p.providerModelId ?? '') === turn.model.providerModelId ||
            String(p.modelId ?? '') === turn.model.modelId),
        12_000,
      );
      if (packet) packetFrames.push(packet);

      const completed = await reader.waitForEvent((t) => t === 'run.completed', 12_000);
      expect(completed, 'run.completed for turn ' + (idx + 1)).toBeDefined();
      completedFrames.push(completed!);
      const payload = eventInner(completed!);
      expect(String(payload.assistantText ?? '')).toContain(turn.expectText);
      expect(
        String(payload.providerModelId ?? '') === turn.model.providerModelId ||
          String(payload.modelId ?? '') === turn.model.modelId,
      ).toBe(true);
    }

    const chatA = gwA.calls.filter((c) => c.method === 'POST');
    const chatB = gwB.calls.filter((c) => c.method === 'POST');
    expect(chatA.map((c) => c.model).sort()).toEqual(['gw-a-large', 'gw-a-mini']);
    expect(chatB.map((c) => c.model)).toEqual(['gw-b-pro']);
    expect(chatA.every((c) => c.authorization === 'Bearer ' + secretA)).toBe(true);
    expect(chatB.every((c) => c.authorization === 'Bearer ' + secretB)).toBe(true);

    expect(packetFrames.length).toBeGreaterThanOrEqual(1);
    const lastPacket = eventInner(packetFrames[packetFrames.length - 1]!);
    expect(String(lastPacket.proofHash ?? '')).toMatch(/^[a-f0-9]{32}$/);
    expect(String(lastPacket.resolutionSource ?? '')).toBe('runOverride');

    const eventBlob = JSON.stringify([...completedFrames, ...packetFrames]);
    expect(eventBlob).not.toContain(secretA);
    expect(eventBlob).not.toContain(secretB);
    expect(eventBlob).not.toMatch(/sk-DUAL_HTTP_/);

    expect(chatA.every((c) => !c.bodyText.includes(secretB))).toBe(true);
    expect(chatB.every((c) => !c.bodyText.includes(secretA))).toBe(true);

    void providerB;

    reader.close();
    sock.destroy();
    await session.close();
  }, 60_000);

  it('live fallback walk across two real HTTP providers after rate-limit (same task context)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-dual-fb-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = 'test-dual-fb-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    const gwA = await startLocalGateway('GW-A-fail', {
      'primary-model': 'rate-limit',
    });
    const gwB = await startLocalGateway('GW-B-ok', {
      'fallback-model': 'ok',
      'spare-model': 'ok',
    });

    const secretA = 'sk-LIVE_FB_PRIMARY_SECRET_AAA_999';
    const secretB = 'sk-LIVE_FB_FALLBACK_SECRET_BBB_888';

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ timeoutMs: 8_000 }),
      },
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const p1 = await writeAndRead(sock, reader, {
      id: 'prov-a',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Primary HTTP',
        baseUrl: gwA.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretA,
        supportsDiscovery: false,
      },
    });
    const providerA = (p1.payload as { provider: { providerId: string } }).provider.providerId;
    const p2 = await writeAndRead(sock, reader, {
      id: 'prov-b',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Fallback HTTP',
        baseUrl: gwB.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretB,
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
        models: [{ providerModelId: 'primary-model', displayName: 'Primary' }],
      },
    });
    const addB = await writeAndRead(sock, reader, {
      id: 'add-b',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerB,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'fallback-model', displayName: 'Fallback' },
          { providerModelId: 'spare-model', displayName: 'Spare' },
        ],
      },
    });
    const primary = (
      addA.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models[0]!;
    const modelsB = (
      addB.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models;
    const fallback = modelsB.find((m) => m.providerModelId === 'fallback-model')!;
    const spare = modelsB.find((m) => m.providerModelId === 'spare-model')!;

    const updated = await writeAndRead(sock, reader, {
      id: 'agent-upd',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: primary.modelId,
        fallbackModelIds: [fallback.modelId, spare.modelId],
        pauseOnFailure: true,
      },
    });
    expect(updated.error).toBeUndefined();

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Live FB WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'live fb', goal: 'cross-provider fallback' },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    const userText = 'same-task-live-fallback-no-restate';
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

    const fallbackSelected = await reader.waitForEvent(
      (t) => t === 'run.fallback.selected',
      12_000,
    );
    const completed = await reader.waitForEvent((t) => t === 'run.completed', 12_000);

    expect(fallbackSelected, 'run.fallback.selected').toBeDefined();
    expect(completed, 'run.completed after fallback').toBeDefined();

    const fbPayload = eventInner(fallbackSelected!);
    expect(String(fbPayload.fromProviderModelId ?? fbPayload.fromModelId ?? '')).toMatch(
      /primary/,
    );
    expect(String(fbPayload.toProviderModelId ?? '')).toBe('fallback-model');
    expect(String(fbPayload.failureClass ?? '')).toBe('rate-limit');
    expect(String(fbPayload.resolutionSource ?? '')).toBe('agentFallback');

    const donePayload = eventInner(completed!);
    expect(String(donePayload.assistantText ?? '')).toContain('ok-from:GW-B-ok:fallback-model');
    expect(String(donePayload.providerModelId ?? '')).toBe('fallback-model');

    expect(gwA.calls.some((c) => c.method === 'POST' && c.model === 'primary-model')).toBe(true);
    expect(gwB.calls.some((c) => c.method === 'POST' && c.model === 'fallback-model')).toBe(true);
    expect(gwB.calls.some((c) => c.model === 'spare-model')).toBe(false);

    const eventBlob = JSON.stringify([fallbackSelected, completed]);
    expect(eventBlob).not.toContain(secretA);
    expect(eventBlob).not.toContain(secretB);
    expect(eventBlob).not.toMatch(/sk-LIVE_FB_/);

    const aPost = gwA.calls.find((c) => c.method === 'POST')!;
    expect(aPost.authorization).toBe('Bearer ' + secretA);
    const bPost = gwB.calls.find((c) => c.method === 'POST' && c.model === 'fallback-model')!;
    expect(bPost.authorization).toBe('Bearer ' + secretB);
    expect(JSON.stringify(bPost.messages ?? bPost.bodyText)).toContain(userText);

    void providerB;

    reader.close();
    sock.destroy();
    await session.close();
  }, 60_000);
});
