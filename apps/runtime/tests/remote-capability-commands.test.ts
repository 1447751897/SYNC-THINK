import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteMcpStore,
} from '@sync-think/storage';
import { SecureStore, XorDevBackend, type SecureStoreBackend } from '@sync-think/secure-store';
import { openPersistentRuntime, type PersistentRuntimeSession } from '../src/persistence.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
const sessions: PersistentRuntimeSession[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0).reverse()) await session.close();
  for (const server of servers.splice(0).reverse()) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Native SQLite handles can stay locked briefly on Windows.
    }
  }
});

function frameReader(sock: Socket): { read(): Promise<Frame> } {
  const queue: Frame[] = [];
  const waiting: Array<{ resolve: (frame: Frame) => void; reject: (error: unknown) => void }> = [];
  let pending = Buffer.alloc(0);
  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      for (const frame of decoded.frames) {
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(frame);
        else queue.push(frame);
      }
    } catch (error) {
      while (waiting.length > 0) waiting.shift()!.reject(error);
    }
  });
  sock.on('error', (error) => {
    while (waiting.length > 0) waiting.shift()!.reject(error);
  });
  return {
    read() {
      const frame = queue.shift();
      if (frame) return Promise.resolve(frame);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
}

async function request(
  socket: Socket,
  reader: ReturnType<typeof frameReader>,
  frame: Frame,
): Promise<Frame> {
  const result = reader.read();
  socket.write(encodeFrame(frame));
  return result;
}

async function connectAndHello(installId: string): Promise<{
  socket: Socket;
  reader: ReturnType<typeof frameReader>;
}> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const reader = frameReader(socket);
  const hello = await request(socket, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: ['skill.import', 'mcp.register'],
    },
  });
  expect(hello.error).toBeUndefined();
  return { socket, reader };
}

async function startFixtureServer(secret: string): Promise<{
  baseUrl: string;
  authorizationHeaders: string[];
  methods: string[];
}> {
  const authorizationHeaders: string[] = [];
  const methods: string[] = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/SKILL.md') {
      const source = [
        '---',
        'name: remote-market-skill',
        'description: Imported from a remote URL',
        'version: 1.0.0',
        '---',
        'Use this remote skill without executing scripts.',
      ].join('\n');
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(source);
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      authorizationHeaders.push(String(req.headers.authorization ?? ''));
      if (req.headers.authorization !== `Bearer ${secret}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const rpc = JSON.parse(body) as { id: number; method: string };
        methods.push(rpc.method);
        if (rpc.method === 'notifications/initialized') {
          res.writeHead(202);
          res.end();
          return;
        }
        const result =
          rpc.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'remote_lookup',
                    description: 'Lookup remote data',
                    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
                  },
                ],
              }
            : rpc.method === 'tools/call'
              ? { content: [{ type: 'text', text: 'REMOTE_CALL_OK' }] }
              : {};
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  void secret;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authorizationHeaders,
    methods,
  };
}

describe('remote capability commands', () => {
  it('imports remote SKILL.md and securely registers a remote MCP across restart', async () => {
    const secret = 'remote-mcp-secret-canary';
    const fixture = await startFixtureServer(secret);
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-remote-capability-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKeyPath = join(dir, 'secure', 'key.bin');
    const installId = `remote-capability-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const first = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKeyPath,
      allowNoToken: true,
    });
    sessions.push(first);
    await first.runtime.start();
    const firstClient = await connectAndHello(installId);

    const imported = await request(firstClient.socket, firstClient.reader, {
      id: 'remote-skill',
      kind: 'request',
      type: 'skill.importRemote',
      payload: { url: `${fixture.baseUrl}/SKILL.md` },
    });
    expect(imported.error).toBeUndefined();
    expect(imported.payload).toMatchObject({
      sourceUrl: `${fixture.baseUrl}/SKILL.md`,
      skill: {
        name: 'remote-market-skill',
        originType: 'market',
        originRef: `${fixture.baseUrl}/SKILL.md`,
      },
      deduped: false,
    });

    const registered = await request(firstClient.socket, firstClient.reader, {
      id: 'remote-mcp',
      kind: 'request',
      type: 'mcp.registerRemote',
      payload: {
        name: 'remote-fixture',
        endpoint: `${fixture.baseUrl}/mcp`,
        key: secret,
        authScheme: 'bearer',
      },
    });
    expect(registered.error).toBeUndefined();
    const body = registered.payload as {
      server: { mcpServerId: string; tools: Array<{ name: string }>; authConfigured: boolean };
      authConfigured: boolean;
      discovered: boolean;
    };
    expect(body.authConfigured).toBe(true);
    expect(body.discovered).toBe(true);
    expect(body.server.tools.map((tool) => tool.name)).toContain('remote_lookup');
    // Keys are stored in plaintext and echoed back (register dialog preview).
    expect(JSON.stringify(registered.payload)).toContain(secret);

    const refreshed = await request(firstClient.socket, firstClient.reader, {
      id: 'remote-mcp-refresh',
      kind: 'request',
      type: 'mcp.tools.refresh',
      payload: { mcpServerId: body.server.mcpServerId },
    });
    expect(refreshed.error).toBeUndefined();
    expect(refreshed.payload).toMatchObject({
      ok: true,
      spawned: false,
      jsonRpcOk: true,
      transport: 'remote-http',
      toolCount: 1,
    });
    expect(JSON.stringify(refreshed.payload)).toContain(secret);
    expect(fixture.authorizationHeaders).toEqual([
      `Bearer ${secret}`,
      `Bearer ${secret}`,
      `Bearer ${secret}`,
      `Bearer ${secret}`,
      `Bearer ${secret}`,
      `Bearer ${secret}`,
    ]);

    const mcpServerId = body.server.mcpServerId;
    const listed = await request(firstClient.socket, firstClient.reader, {
      id: 'remote-mcp-list',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(JSON.stringify(listed.payload)).toContain(secret);
    expect(
      (
        listed.payload as { servers: Array<{ mcpServerId: string; authConfigured?: boolean }> }
      ).servers.find((server) => server.mcpServerId === mcpServerId)?.authConfigured,
    ).toBe(true);

    firstClient.socket.destroy();
    await first.close();
    sessions.splice(sessions.indexOf(first), 1);

    const second = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKeyPath,
      allowNoToken: true,
    });
    sessions.push(second);
    await second.runtime.start();
    const secondClient = await connectAndHello(installId);
    const listedAfterRestart = await request(secondClient.socket, secondClient.reader, {
      id: 'remote-mcp-list-restart',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(
      (
        listedAfterRestart.payload as {
          servers: Array<{ mcpServerId: string; authConfigured?: boolean }>;
        }
      ).servers.find((server) => server.mcpServerId === mcpServerId)?.authConfigured,
    ).toBe(true);
    expect(JSON.stringify(listedAfterRestart.payload)).toContain(secret);
    secondClient.socket.destroy();
    await second.close();
    sessions.splice(sessions.indexOf(second), 1);

    const database = await openDatabaseAsync({ path: dbPath, readonly: true, fileMustExist: true });
    const setting = database.raw
      .prepare(`SELECT value_json FROM app_setting WHERE key = ?`)
      .get(`mcp.auth.${mcpServerId}`) as { value_json: string } | undefined;
    expect(setting?.value_json).toContain('key');
    expect(setting?.value_json).toContain(secret);
    database.raw.close();
  }, 60_000);

  it('rolls back a new MCP registry row when auth persistence fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-remote-mcp-rollback-'));
    tempDirs.push(dir);
    const secret = 'rollback-secret-canary';
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const database = await openDatabaseAsync({ path: dbPath });
    const mcpStore = new SqliteMcpStore(database.raw);
    const realSettingStore = new SqliteAppSettingStore(database.raw);
    // Keys persist as plaintext app settings; a failing settings write must
    // roll the whole registration back (no half-registered MCP row).
    const failingSettingStore = {
      get: (key: string) => realSettingStore.get(key),
      set: () => {
        throw new Error('settings write failed');
      },
    } as unknown as SqliteAppSettingStore;
    const installId = `remote-rollback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      mcpStore,
      appSettingStore: failingSettingStore,
    });
    await runtime.start();
    const client = await connectAndHello(installId);

    const registered = await request(client.socket, client.reader, {
      id: 'remote-mcp-failing-key',
      kind: 'request',
      type: 'mcp.registerRemote',
      payload: {
        name: 'must-rollback',
        endpoint: 'https://mcp.example.test/rpc',
        key: secret,
        discoverTools: false,
      },
    });
    expect(registered.error).toBeDefined();
    expect(JSON.stringify(registered)).not.toContain(secret);

    const listed = await request(client.socket, client.reader, {
      id: 'remote-mcp-list-after-failure',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(listed.error).toBeUndefined();
    expect((listed.payload as { servers: unknown[] }).servers).toEqual([]);
    client.socket.destroy();
    await runtime.stop();
    database.raw.close();
  }, 30_000);

  it('migrates a legacy MCP credential so the configuration dialog can echo its key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-remote-mcp-legacy-key-'));
    tempDirs.push(dir);
    const secret = 'legacy-mcp-key-canary';
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const database = await openDatabaseAsync({ path: dbPath });
    const mcpStore = new SqliteMcpStore(database.raw);
    const appSettingStore = new SqliteAppSettingStore(database.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const server = mcpStore.register({
      name: 'legacy-key-server',
      transport: 'remote-http',
      endpoint: 'https://mcp.example.test/legacy',
    });
    const storeHandle = await secureStore.storeSecret(secret);
    appSettingStore.set(`mcp.auth.${server.id}`, { storeHandle, authScheme: 'bearer' });
    const installId = `legacy-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      mcpStore,
      appSettingStore,
      secureStore,
    });
    let client: Awaited<ReturnType<typeof connectAndHello>> | undefined;
    try {
      await runtime.start();
      client = await connectAndHello(installId);
      const listed = await request(client.socket, client.reader, {
        id: 'legacy-key-list',
        kind: 'request',
        type: 'mcp.list',
        payload: {},
      });
      expect(listed.error).toBeUndefined();
      expect(listed.payload).toMatchObject({
        servers: [
          expect.objectContaining({
            mcpServerId: server.id,
            authConfigured: true,
            authScheme: 'bearer',
            authKey: secret,
          }),
        ],
      });
      expect(appSettingStore.get(`mcp.auth.${server.id}`)?.value).toEqual({
        key: secret,
        authScheme: 'bearer',
      });
    } finally {
      client?.socket.destroy();
      await runtime.stop();
      secureStore.shutdown();
      database.raw.close();
    }
  }, 30_000);

  it('preserves an existing MCP catalog when re-discovery fails', async () => {
    const secret = 'preserve-tools-secret';
    const fixture = await startFixtureServer(secret);
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-remote-mcp-preserve-'));
    tempDirs.push(dir);
    const installId = `remote-preserve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
    });
    sessions.push(session);
    await session.runtime.start();
    const client = await connectAndHello(installId);

    const first = await request(client.socket, client.reader, {
      id: 'remote-preserve-first',
      kind: 'request',
      type: 'mcp.registerRemote',
      payload: {
        name: 'preserve-catalog',
        endpoint: `${fixture.baseUrl}/mcp`,
        key: secret,
        authScheme: 'bearer',
      },
    });
    expect(first.error).toBeUndefined();
    expect((first.payload as { server: { tools: Array<{ name: string }> } }).server.tools).toEqual([
      expect.objectContaining({ name: 'remote_lookup' }),
    ]);

    const failed = await request(client.socket, client.reader, {
      id: 'remote-preserve-failed',
      kind: 'request',
      type: 'mcp.registerRemote',
      payload: {
        name: 'preserve-catalog',
        endpoint: `${fixture.baseUrl}/mcp`,
        key: 'wrong-key',
        authScheme: 'bearer',
      },
    });
    expect(failed.error).toBeUndefined();
    expect(failed.payload).toMatchObject({
      updated: true,
      discovered: false,
      discoveryError: expect.stringMatching(/HTTP 401/),
      server: { tools: [expect.objectContaining({ name: 'remote_lookup' })] },
    });

    const refreshFailed = await request(client.socket, client.reader, {
      id: 'remote-preserve-refresh-failed',
      kind: 'request',
      type: 'mcp.tools.refresh',
      payload: {
        mcpServerId: (failed.payload as { server: { mcpServerId: string } }).server.mcpServerId,
      },
    });
    expect(refreshFailed.error).toBeUndefined();
    expect(refreshFailed.payload).toMatchObject({
      ok: false,
      toolCount: 1,
      previousToolCount: 1,
      tools: [expect.objectContaining({ name: 'remote_lookup' })],
      refuseReason: expect.stringMatching(/HTTP 401/),
    });

    const listed = await request(client.socket, client.reader, {
      id: 'remote-preserve-list',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(
      (
        listed.payload as { servers: Array<{ name: string; tools: Array<{ name: string }> }> }
      ).servers.find((server) => server.name === 'preserve-catalog')?.tools,
    ).toEqual([expect.objectContaining({ name: 'remote_lookup' })]);
    client.socket.destroy();
  }, 30_000);

  it('keeps the chat registration handler metadata-only even with hidden fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-chat-mcp-metadata-only-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const database = await openDatabaseAsync({ path: dbPath });
    const mcpStore = new SqliteMcpStore(database.raw);
    const runtime = new Runtime({
      installId: `chat-metadata-only-${Date.now()}`,
      allowNoToken: true,
      mcpStore,
    });
    const internal = runtime as unknown as {
      executeChatRemoteMcpTool(input: {
        run: { threadId: string };
        toolCall: { name: string; callId: string; argumentsJson: string };
      }): Promise<string>;
    };
    const secret = 'chat-hidden-secret-canary';
    const blockedText = await internal.executeChatRemoteMcpTool({
      run: { threadId: 'thread-metadata-only' },
      toolCall: {
        name: 'register_remote_mcp',
        callId: 'call-hidden-secret',
        argumentsJson: JSON.stringify({
          name: 'Hidden Secret MCP',
          endpoint: 'https://mcp.example.test/hidden',
          discoverTools: false,
          apiKey: secret,
          authScheme: 'bearer',
        }),
      },
    });
    expect(JSON.parse(blockedText)).toMatchObject({ ok: false, error: 'mcp.metadata-only' });
    expect(blockedText).not.toContain(secret);
    expect(mcpStore.list()).toEqual([]);

    const registeredText = await internal.executeChatRemoteMcpTool({
      run: { threadId: 'thread-metadata-only' },
      toolCall: {
        name: 'register_remote_mcp',
        callId: 'call-public-metadata',
        argumentsJson: JSON.stringify({
          name: 'Public Metadata MCP',
          endpoint: 'https://mcp.example.test/public',
        }),
      },
    });
    expect(JSON.parse(registeredText)).toMatchObject({
      ok: true,
      authConfigured: false,
      discovered: false,
    });
    expect(mcpStore.list()).toEqual([
      expect.objectContaining({ name: 'Public Metadata MCP', tools: [] }),
    ]);
    database.raw.close();
  });

  it('routes a chat-bound remote MCP tool over HTTP instead of LocalStdio', async () => {
    const secret = 'chat-remote-secret-canary';
    const fixture = await startFixtureServer(secret);
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-chat-remote-mcp-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const database = await openDatabaseAsync({ path: dbPath });
    const mcpStore = new SqliteMcpStore(database.raw);
    const appSettingStore = new SqliteAppSettingStore(database.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const server = mcpStore.register({
      name: 'chat-remote',
      transport: 'remote-http',
      endpoint: `${fixture.baseUrl}/mcp`,
      tools: [{ name: 'remote_lookup', description: 'Lookup remote data' }],
    });
    const storeHandle = await secureStore.storeSecret(secret);
    appSettingStore.set(`mcp.auth.${server.id}`, { storeHandle, authScheme: 'bearer' });
    const runtime = new Runtime({
      installId: `chat-remote-${Date.now()}`,
      allowNoToken: true,
      mcpStore,
      appSettingStore,
      secureStore,
    });

    const internal = runtime as unknown as {
      executeChatBoundMcpTool(input: {
        run: { runId: string; threadId: string; mcpServerIds: string[] };
        mcpServerId: string;
        toolName: string;
        toolCallId: string;
        argumentsJson: string;
      }): Promise<string>;
    };
    const resultText = await internal.executeChatBoundMcpTool({
      run: {
        runId: 'run-remote-chat',
        threadId: 'thread-remote-chat',
        mcpServerIds: [server.id],
      },
      mcpServerId: server.id,
      toolName: 'remote_lookup',
      toolCallId: 'tool-call-remote-chat',
      argumentsJson: JSON.stringify({ q: 'status' }),
    });
    const result = JSON.parse(resultText) as {
      ok: boolean;
      result?: { remote?: boolean; jsonRpcOk?: boolean; toolResultText?: string };
    };
    expect(result).toMatchObject({
      ok: true,
      result: {
        remote: true,
        jsonRpcOk: true,
        toolResultText: 'REMOTE_CALL_OK',
      },
    });
    expect(fixture.methods).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fixture.authorizationHeaders).toEqual([
      `Bearer ${secret}`,
      `Bearer ${secret}`,
      `Bearer ${secret}`,
    ]);
    await runtime.stop();
    secureStore.shutdown();
    database.raw.close();
  }, 30_000);

  it('deletes a registered MCP server and clears its auth config', async () => {
    const secret = 'delete-mcp-secret';
    const fixture = await startFixtureServer(secret);
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-remote-mcp-delete-'));
    tempDirs.push(dir);
    const installId = `remote-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
    });
    sessions.push(session);
    await session.runtime.start();
    const client = await connectAndHello(installId);

    const registered = await request(client.socket, client.reader, {
      id: 'remote-delete-register',
      kind: 'request',
      type: 'mcp.registerRemote',
      payload: {
        name: 'delete-me',
        endpoint: `${fixture.baseUrl}/mcp`,
        key: secret,
        authScheme: 'bearer',
      },
    });
    expect(registered.error).toBeUndefined();
    const mcpServerId = (registered.payload as { server: { mcpServerId: string } }).server
      .mcpServerId;

    const deleted = await request(client.socket, client.reader, {
      id: 'remote-delete-command',
      kind: 'request',
      type: 'mcp.delete',
      payload: { mcpServerId },
    });
    expect(deleted.error).toBeUndefined();
    expect(deleted.payload).toMatchObject({ mcpServerId, deleted: true });

    const listed = await request(client.socket, client.reader, {
      id: 'remote-delete-list',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(listed.error).toBeUndefined();
    expect((listed.payload as { servers: unknown[] }).servers).toEqual([]);
    client.socket.destroy();
  }, 60_000);
});
