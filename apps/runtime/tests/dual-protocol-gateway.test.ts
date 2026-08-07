/**
 * M1 evidence: dual-protocol live gateways - OpenAI Chat + Anthropic Messages.
 * Real node:http servers, SecureStore keys, no FakeProvider for the live path.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { OpenAIChatAdapter, AnthropicMessagesAdapter } from '@sync-think/adapters';
import { openPersistentRuntime } from '../src/persistence.js';

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
  xApiKey?: string;
  anthropicVersion?: string;
  model?: string;
  messages?: unknown;
  bodyText: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function startOpenAiGateway(
  name: string,
  modelBehavior: Record<string, 'ok' | 'rate-limit'>,
): Promise<{ name: string; baseUrl: string; calls: GatewayCall[] }> {
  const calls: GatewayCall[] = [];
  const behavior = new Map(Object.entries(modelBehavior));
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();
      const bodyText = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);
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
      calls.push({
        method,
        url,
        authorization: req.headers.authorization,
        model,
        messages,
        bodyText,
      });

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
        if (mode === 'rate-limit') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'rate limited openai gw' } }));
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
              usage: { prompt_tokens: 2, completion_tokens: 4 },
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
  if (!addr || typeof addr === 'string') throw new Error('bind failed openai gw');
  return {
    name,
    baseUrl: 'http://127.0.0.1:' + addr.port + '/v1',
    calls,
  };
}

async function startAnthropicGateway(
  name: string,
  modelBehavior: Record<string, 'ok' | 'rate-limit'>,
): Promise<{ name: string; baseUrl: string; calls: GatewayCall[] }> {
  const calls: GatewayCall[] = [];
  const behavior = new Map(Object.entries(modelBehavior));
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();
      const bodyText = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);
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
      const xApiKeyHeader = req.headers['x-api-key'];
      const xApiKey = Array.isArray(xApiKeyHeader) ? xApiKeyHeader[0] : xApiKeyHeader;
      const versionHeader = req.headers['anthropic-version'];
      const anthropicVersion = Array.isArray(versionHeader) ? versionHeader[0] : versionHeader;
      calls.push({
        method,
        url,
        xApiKey,
        anthropicVersion,
        model,
        messages,
        bodyText,
      });

      if (method === 'GET' && /\/models\/?$/i.test(url.split('?')[0] ?? '')) {
        const data = [...behavior.keys()].map((id) => ({ id, type: 'model' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data }));
        return;
      }

      if (method === 'POST' && /\/messages\/?$/i.test(url.split('?')[0] ?? '')) {
        const mode = model ? behavior.get(model) : undefined;
        if (!mode) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'unknown model ' + (model ?? '') } }));
          return;
        }
        if (mode === 'rate-limit') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'rate limited anthropic gw' } }));
          return;
        }
        const reply = 'ok-from:' + name + ':' + model;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('event: content_block_delta\n');
        res.write(
          'data: ' +
            JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: reply },
            }) +
            '\n\n',
        );
        res.write('event: message_delta\n');
        res.write(
          'data: ' +
            JSON.stringify({
              type: 'message_delta',
              usage: { input_tokens: 3, output_tokens: 5 },
            }) +
            '\n\n',
        );
        res.write('event: message_stop\n');
        res.write('data: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
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
  if (!addr || typeof addr === 'string') throw new Error('bind failed anthropic gw');
  return {
    name,
    baseUrl: 'http://127.0.0.1:' + addr.port + '/v1',
    calls,
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

describe('dual-protocol OpenAI + Anthropic live gateways', () => {
  it('same task streams openai-chat then anthropic-messages with Manifest + secret scrub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-dual-proto-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = 'test-dual-proto-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    const gwOpenAi = await startOpenAiGateway('OPENAI-GW', {
      'oa-mini': 'ok',
      'oa-large': 'ok',
    });
    const gwAnthropic = await startAnthropicGateway('ANTHROPIC-GW', {
      'claude-haiku-local': 'ok',
    });

    const secretOa = 'sk-DUAL_PROTO_OPENAI_SECRET_NEVER_LEAK_AAA';
    const secretAnt = 'sk-ant-DUAL_PROTO_ANTHROPIC_SECRET_NEVER_LEAK_BBB';

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ timeoutMs: 8_000 }),
        'anthropic-messages': new AnthropicMessagesAdapter({ timeoutMs: 8_000 }),
      },
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const p1 = await writeAndRead(sock, reader, {
      id: 'prov-oa',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Local OpenAI GW',
        baseUrl: gwOpenAi.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretOa,
        supportsDiscovery: false,
      },
    });
    expect(p1.error).toBeUndefined();
    const providerOa = (p1.payload as { provider: { providerId: string } }).provider.providerId;

    const p2 = await writeAndRead(sock, reader, {
      id: 'prov-ant',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Local Anthropic GW',
        baseUrl: gwAnthropic.baseUrl,
        protocol: 'anthropic-messages',
        apiKey: secretAnt,
        supportsDiscovery: false,
      },
    });
    expect(p2.error).toBeUndefined();
    const providerAnt = (p2.payload as { provider: { providerId: string } }).provider.providerId;

    const addOa = await writeAndRead(sock, reader, {
      id: 'add-oa',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerOa,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'oa-mini', displayName: 'OA Mini' },
          { providerModelId: 'oa-large', displayName: 'OA Large' },
        ],
      },
    });
    const addAnt = await writeAndRead(sock, reader, {
      id: 'add-ant',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerAnt,
        protocol: 'anthropic-messages',
        models: [{ providerModelId: 'claude-haiku-local', displayName: 'Claude Haiku Local' }],
      },
    });
    const modelsOa = (
      addOa.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models;
    const modelsAnt = (
      addAnt.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models;
    const m1 = modelsOa.find((m) => m.providerModelId === 'oa-mini')!;
    const m2 = modelsOa.find((m) => m.providerModelId === 'oa-large')!;
    const m3 = modelsAnt.find((m) => m.providerModelId === 'claude-haiku-local')!;
    expect(m1 && m2 && m3).toBeTruthy();

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Dual Proto WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'dual protocol multi model',
        goal: 'same task openai + anthropic live',
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
      { model: m1, prompt: 'turn-1-openai', expectText: 'ok-from:OPENAI-GW:oa-mini' },
      { model: m2, prompt: 'turn-2-openai', expectText: 'ok-from:OPENAI-GW:oa-large' },
      {
        model: m3,
        prompt: 'turn-3-anthropic',
        expectText: 'ok-from:ANTHROPIC-GW:claude-haiku-local',
      },
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

    const chatOa = gwOpenAi.calls.filter((c) => c.method === 'POST');
    const chatAnt = gwAnthropic.calls.filter((c) => c.method === 'POST');
    expect(chatOa.map((c) => c.model).sort()).toEqual(['oa-large', 'oa-mini']);
    expect(chatAnt.map((c) => c.model)).toEqual(['claude-haiku-local']);
    expect(chatOa.every((c) => c.authorization === 'Bearer ' + secretOa)).toBe(true);
    expect(chatAnt.every((c) => c.xApiKey === secretAnt)).toBe(true);
    expect(chatAnt.every((c) => c.anthropicVersion === '2023-06-01')).toBe(true);

    expect(packetFrames.length).toBeGreaterThanOrEqual(1);
    const lastPacket = eventInner(packetFrames[packetFrames.length - 1]!);
    expect(String(lastPacket.proofHash ?? '')).toMatch(/^[a-f0-9]{32}$/);
    expect(String(lastPacket.resolutionSource ?? '')).toBe('runOverride');

    const eventBlob = JSON.stringify([...completedFrames, ...packetFrames]);
    expect(eventBlob).not.toContain(secretOa);
    expect(eventBlob).not.toContain(secretAnt);
    expect(eventBlob).not.toMatch(/sk-DUAL_PROTO_/);
    expect(eventBlob).not.toMatch(/sk-ant-DUAL_PROTO_/);

    expect(chatOa.every((c) => !c.bodyText.includes(secretAnt))).toBe(true);
    expect(chatAnt.every((c) => !c.bodyText.includes(secretOa))).toBe(true);

    void providerAnt;
    reader.close();
    sock.destroy();
    await session.close();
  }, 60_000);

  it('cross-protocol fallback: openai rate-limit -> anthropic-messages success (same task)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-dual-proto-fb-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId =
      'test-dual-proto-fb-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    const gwOpenAi = await startOpenAiGateway('OPENAI-FAIL', {
      'primary-oa': 'rate-limit',
    });
    const gwAnthropic = await startAnthropicGateway('ANTHROPIC-OK', {
      'fallback-claude': 'ok',
    });

    const secretOa = 'sk-LIVE_PROTO_FB_OPENAI_SECRET_NEVER_LEAK_111';
    const secretAnt = 'sk-ant-LIVE_PROTO_FB_ANTHROPIC_SECRET_NEVER_LEAK_222';

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      modelRetryBaseDelayMs: 0,
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ timeoutMs: 8_000 }),
        'anthropic-messages': new AnthropicMessagesAdapter({ timeoutMs: 8_000 }),
      },
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const p1 = await writeAndRead(sock, reader, {
      id: 'prov-oa',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'OA Fail',
        baseUrl: gwOpenAi.baseUrl,
        protocol: 'openai-chat',
        apiKey: secretOa,
        supportsDiscovery: false,
      },
    });
    const providerOa = (p1.payload as { provider: { providerId: string } }).provider.providerId;
    const p2 = await writeAndRead(sock, reader, {
      id: 'prov-ant',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Anthropic OK',
        baseUrl: gwAnthropic.baseUrl,
        protocol: 'anthropic-messages',
        apiKey: secretAnt,
        supportsDiscovery: false,
      },
    });
    const providerAnt = (p2.payload as { provider: { providerId: string } }).provider.providerId;

    const addOa = await writeAndRead(sock, reader, {
      id: 'add-oa',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerOa,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'primary-oa', displayName: 'Primary OA' }],
      },
    });
    const addAnt = await writeAndRead(sock, reader, {
      id: 'add-ant',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerAnt,
        protocol: 'anthropic-messages',
        models: [{ providerModelId: 'fallback-claude', displayName: 'Fallback Claude' }],
      },
    });
    const primary = (
      addOa.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models[0]!;
    const fallback = (
      addAnt.payload as { models: Array<{ modelId: string; providerModelId: string }> }
    ).models[0]!;

    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Dual Proto FB WS' },
    });
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'dual proto fallback',
        goal: 'cross protocol fallback',
      },
    });
    const taskPayload = task.payload as { threadId: string; taskVersion: number };

    // Agent default + ordered fallback across protocols
    const updated = await writeAndRead(sock, reader, {
      id: 'bind-1',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: primary.modelId,
        fallbackModelIds: [fallback.modelId],
        pauseOnFailure: true,
      },
    });
    expect(updated.error).toBeUndefined();

    await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });

    const userText = 'same-task-cross-protocol-fallback-no-restate';
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
    expect(completed, 'run.completed after cross-protocol fallback').toBeDefined();

    const fbPayload = eventInner(fallbackSelected!);
    expect(String(fbPayload.fromProviderModelId ?? fbPayload.fromModelId ?? '')).toMatch(
      /primary/,
    );
    expect(String(fbPayload.toProviderModelId ?? '')).toBe('fallback-claude');
    expect(String(fbPayload.failureClass ?? '')).toBe('rate-limit');
    expect(String(fbPayload.resolutionSource ?? '')).toBe('agentFallback');

    const donePayload = eventInner(completed!);
    expect(String(donePayload.assistantText ?? '')).toContain(
      'ok-from:ANTHROPIC-OK:fallback-claude',
    );
    expect(String(donePayload.providerModelId ?? '')).toBe('fallback-claude');

    expect(gwOpenAi.calls.some((c) => c.method === 'POST' && c.model === 'primary-oa')).toBe(true);
    expect(
      gwAnthropic.calls.some((c) => c.method === 'POST' && c.model === 'fallback-claude'),
    ).toBe(true);

    const eventBlob = JSON.stringify([fallbackSelected, completed]);
    expect(eventBlob).not.toContain(secretOa);
    expect(eventBlob).not.toContain(secretAnt);
    expect(eventBlob).not.toMatch(/sk-LIVE_PROTO_FB_/);
    expect(eventBlob).not.toMatch(/sk-ant-LIVE_PROTO_FB_/);

    const aPost = gwOpenAi.calls.find((c) => c.method === 'POST')!;
    expect(aPost.authorization).toBe('Bearer ' + secretOa);
    const bPost = gwAnthropic.calls.find(
      (c) => c.method === 'POST' && c.model === 'fallback-claude',
    )!;
    expect(bPost.xApiKey).toBe(secretAnt);
    expect(JSON.stringify(bPost.messages ?? bPost.bodyText)).toContain(userText);

    reader.close();
    sock.destroy();
    await session.close();
  }, 60_000);
});
