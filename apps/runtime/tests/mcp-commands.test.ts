import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider, type ProviderAdapter } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  SqliteAuthorizationStore,
  SqliteOrchestrationStore,
  SqlitePolicyStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock better-sqlite3 files after session.close.
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
  read: (count: number) => Promise<Frame[]>;
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
        'mcp.register',
        'mcp.list',
        'mcp.policy.probe',
        'agent.get',
        'agent.updateBinding',
        'provider.create',
        'provider.list',
        'provider.addModels',
        'context.packet.peek',
        'workspace.create',
        'task.create',
        'capability.workspace.setActive',
        'mcp.tool.request',
        'mcp.spawn.probe',
        'mcp.tool.call',
        'approval.list',
        'approval.decide',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('mcp commands (§9.3 authz skeleton)', () => {
  it('requires exact orchestration scope for actual calls while keeping soft requests scope-optional', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-required-scope-'));
    tempDirs.push(dir);
    const installId = `test-mcp-required-scope-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);
    try {
      const actual = await writeAndRead(sock, reader, {
        id: 'actual-without-scope',
        kind: 'request',
        type: 'mcp.tool.call',
        payload: { mcpServerId: 'server-forged', toolName: 'read_file' },
      });
      expect(actual.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const soft = await writeAndRead(sock, reader, {
        id: 'soft-without-scope',
        kind: 'request',
        type: 'mcp.tool.request',
        payload: { toolName: 'read_file' },
      });
      expect(soft.error).toBeUndefined();
      expect(soft.payload).toMatchObject({ simulated: true });
    } finally {
      sock.destroy();
      await session.close();
    }
  });

  it('registers MCP metadata without spawn, binds allowlist, peeks tool-schema, clears allowlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-cmd-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Seed model for agent binding + peek
    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'MCP Gateway',
        baseUrl: 'https://mcp-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-mcp-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;

    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'mcp-model', displayName: 'MCP Model' }],
      },
    });
    expect(add.error).toBeUndefined();
    const modelId = (add.payload as { models: Array<{ modelId: string }> }).models[0]!.modelId;

    // Register MCP server (metadata only)
    const registered = await writeAndRead(sock, reader, {
      id: 'mcp-reg-1',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'filesystem',
        transport: 'local-stdio',
        endpoint: 'stdio://filesystem-demo',
        tools: [
          { name: 'read_file', description: 'Read a file' },
          { name: 'list_dir', description: 'List directory' },
        ],
        trusted: false,
      },
    });
    expect(registered.error).toBeUndefined();
    const regBody = registered.payload as {
      server: {
        mcpServerId: string;
        name: string;
        tools: Array<{ name: string }>;
        trusted: boolean;
      };
      updated: boolean;
    };
    expect(regBody.updated).toBe(false);
    expect(regBody.server.name).toBe('filesystem');
    expect(regBody.server.tools.map((t) => t.name).sort()).toEqual(['list_dir', 'read_file']);
    const mcpServerId = regBody.server.mcpServerId;

    // List
    const listed = await writeAndRead(sock, reader, {
      id: 'mcp-list-1',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(listed.error).toBeUndefined();
    const listBody = listed.payload as { servers: Array<{ mcpServerId: string }> };
    expect(listBody.servers.some((s) => s.mcpServerId === mcpServerId)).toBe(true);

    // Bind agent default model + MCP allowlist
    const agentBefore = await writeAndRead(sock, reader, {
      id: 'agent-get-1',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect(agentBefore.error).toBeUndefined();

    const bound = await writeAndRead(sock, reader, {
      id: 'agent-bind-mcp',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        mcpServerIds: [mcpServerId],
      },
    });
    expect(bound.error).toBeUndefined();
    const agentAfter = (bound.payload as { agent: { mcpServerIds: string[]; version: number } }).agent;
    expect(agentAfter.mcpServerIds).toEqual([mcpServerId]);

    // Need a task/thread for peek — create workspace + task
    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: dir, name: 'MCP WS' },
    });
    expect(ws.error).toBeUndefined();
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;

    const activated = await writeAndRead(sock, reader, {
      id: 'mcp-workspace-active',
      kind: 'request',
      type: 'capability.workspace.setActive',
      payload: {
        capabilityType: 'mcp',
        capabilityId: mcpServerId,
        workspaceId,
        active: true,
      },
    });
    expect(activated.error).toBeUndefined();

    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'MCP peek task',
        goal: 'Verify MCP tool-schema enters Context Packet',
      },
    });
    expect(task.error).toBeUndefined();
    const taskPayload = task.payload as { taskId: string; threadId: string };

    const peek = await writeAndRead(sock, reader, {
      id: 'peek-mcp',
      kind: 'request',
      type: 'context.packet.peek',
      payload: { threadId: taskPayload.threadId },
    });
    expect(peek.error).toBeUndefined();
    const peekBody = peek.payload as {
      mcpServerIds?: string[];
      includedSources?: Array<{ id: string; kind: string; tokenEstimate: number }>;
      summaries?: Array<{ sourceId: string; summary: string }>;
    };
    expect(Array.isArray(peekBody.mcpServerIds)).toBe(true);
    expect(peekBody.mcpServerIds).toContain(mcpServerId);

    const toolSources = (peekBody.includedSources ?? []).filter((src) => src.kind === 'tool-schema');
    expect(toolSources.length).toBeGreaterThanOrEqual(1);
    expect(toolSources.some((src) => src.id.includes(mcpServerId) || src.id.startsWith('tool:'))).toBe(
      true,
    );
    const toolSummaries = (peekBody.summaries ?? []).filter((row) => row.sourceId.startsWith('tool:'));
    expect(toolSummaries.length).toBeGreaterThanOrEqual(1);
    expect(toolSummaries[0]?.summary).toMatch(/MCP|filesystem|read_file|tool/i);

    // Empty allowlist → no tool-schema (register ≠ available)
    const cleared = await writeAndRead(sock, reader, {
      id: 'agent-clear-mcp',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        mcpServerIds: [],
      },
    });
    expect(cleared.error).toBeUndefined();

    const peekEmpty = await writeAndRead(sock, reader, {
      id: 'peek-empty-mcp',
      kind: 'request',
      type: 'context.packet.peek',
      payload: { threadId: taskPayload.threadId },
    });
    expect(peekEmpty.error).toBeUndefined();
    const emptyBody = peekEmpty.payload as {
      mcpServerIds?: string[];
      includedSources?: Array<{ kind: string }>;
    };
    expect(emptyBody.mcpServerIds ?? []).toEqual([]);
    expect((emptyBody.includedSources ?? []).some((src) => src.kind === 'tool-schema')).toBe(false);

    sock.destroy();
    await session.close();
  }, 60_000);

  it('probes MCP policy with truncate + untrusted (no real spawn)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-probe-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const registered = await writeAndRead(sock, reader, {
      id: 'mcp-reg-probe',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'probe-fs',
        transport: 'local-stdio',
        endpoint: 'stdio://probe',
        tools: [{ name: 'echo', description: 'echo' }],
        trusted: false,
        maxOutputBytes: 512,
        timeoutMs: 5000,
      },
    });
    expect(registered.error).toBeUndefined();
    const mcpServerId = (registered.payload as { server: { mcpServerId: string } }).server.mcpServerId;

    const probe = await writeAndRead(sock, reader, {
      id: 'mcp-probe-1',
      kind: 'request',
      type: 'mcp.policy.probe',
      payload: {
        mcpServerId,
        simulatedOutput: 'Z'.repeat(2000),
        simulatedElapsedMs: 0,
        toolName: 'echo',
      },
    });
    expect(probe.error).toBeUndefined();
    const body = probe.payload as {
      ok: boolean;
      truncated: boolean;
      timedOut: boolean;
      contentTrust: string;
      rawBytes: number;
      keptBytes: number;
      simulated: boolean;
      policyLabel: string;
    };
    expect(body.ok).toBe(true);
    expect(body.simulated).toBe(true);
    expect(body.truncated).toBe(true);
    expect(body.timedOut).toBe(false);
    expect(body.contentTrust).toBe('untrusted');
    expect(body.rawBytes).toBe(2000);
    expect(body.maxOutputBytes).toBe(512);
    expect(body.keptBytes).toBeLessThanOrEqual(512);
    expect(body.keptBytes).toBeGreaterThan(0);
    expect(body.policyLabel).toMatch(/untrusted/);

    const timeoutProbe = await writeAndRead(sock, reader, {
      id: 'mcp-probe-2',
      kind: 'request',
      type: 'mcp.policy.probe',
      payload: {
        mcpServerId,
        simulatedOutput: 'late',
        simulatedElapsedMs: 60_000,
        toolName: 'slow',
      },
    });
    expect(timeoutProbe.error).toBeUndefined();
    const tbody = timeoutProbe.payload as { ok: boolean; timedOut: boolean; contentTrust: string };
    expect(tbody.ok).toBe(false);
    expect(tbody.timedOut).toBe(true);
    expect(tbody.contentTrust).toBe('untrusted');

    const created = await writeAndRead(sock, reader, {
      id: 'provider-after-mcp-events',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Replay ordering gateway',
        baseUrl: 'https://replay-order.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-replay-order-test-only',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();

    const replay = await writeAndRead(sock, reader, {
      id: 'replay-after-mixed-events',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    const replayedSequences = (
      replay.payload as { replayedEvents: Array<{ sequence: number }> }
    ).replayedEvents.map((event) => event.sequence);
    expect(replayedSequences).toEqual(
      Array.from({ length: replayedSequences.length }, (_, index) => index + 1),
    );

    sock.destroy();
    await session.runtime.stop();
  });

  it('mcp.tool.request enqueues sensitive untrusted tools into Approval Center (no spawn)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-tool-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Register untrusted MCP with write tool
    const reg = await writeAndRead(sock, reader, {
      id: 'mcp-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'Local Tools',
        transport: 'local-stdio',
        endpoint: 'fake://local-tools',
        tools: [
          { name: 'read_file', description: 'read' },
          { name: 'write_file', description: 'write' },
        ],
        trusted: false,
        maxOutputBytes: 4096,
        timeoutMs: 5000,
      },
    });
    expect(reg.error).toBeUndefined();
    const mcpServerId = (reg.payload as { server: { mcpServerId: string } }).server.mcpServerId;

    // A) sensitive write on untrusted ? enqueue
    const req = await writeAndRead(sock, reader, {
      id: 'mcp-req-1',
      kind: 'request',
      type: 'mcp.tool.request',
      payload: {
        mcpServerId,
        toolName: 'write_file',
        argumentsJson: JSON.stringify({ path: 'x.txt', content: 'hi' }),
      },
    });
    expect(req.error).toBeUndefined();
    const body = req.payload as {
      enqueued: boolean;
      autoApproved: boolean;
      simulated: boolean;
      sensitivity: { sensitive: boolean; reasons: string[] };
      approvalRequest?: { id: string; kind: string; action: string; state: string };
      toolName: string;
    };
    expect(body.simulated).toBe(true);
    expect(body.sensitivity.sensitive).toBe(true);
    expect(body.enqueued).toBe(true);
    expect(body.autoApproved).toBe(false);
    expect(body.approvalRequest?.kind).toBe('mcp-permission');
    expect(body.approvalRequest?.action).toBe('mcp.tool.request:write_file');
    expect(body.approvalRequest?.state).toBe('pending');
    const approvalId = body.approvalRequest!.id;

    const listed = await writeAndRead(sock, reader, {
      id: 'mcp-list-appr',
      kind: 'request',
      type: 'approval.list',
      payload: { state: 'pending', limit: 50 },
    });
    expect(listed.error).toBeUndefined();
    const items = (listed.payload as { items: Array<{ id: string; kind: string }> }).items;
    expect(items.some((i) => i.id === approvalId && i.kind === 'mcp-permission')).toBe(true);

    // B) human decides
    const dec = await writeAndRead(sock, reader, {
      id: 'mcp-dec',
      kind: 'request',
      type: 'approval.decide',
      payload: { id: approvalId, decision: 'approved', decisionNote: 'allow write once' },
    });
    expect(dec.error).toBeUndefined();
    expect((dec.payload as { item: { state: string } }).item.state).toBe('approved');

    // C) trusted low-risk read ? auto (full inside policy) no enqueue
    const reg2 = await writeAndRead(sock, reader, {
      id: 'mcp-reg-2',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'Trusted Read',
        transport: 'local-stdio',
        endpoint: 'fake://trusted-read',
        tools: [{ name: 'read_file', description: 'read' }],
        trusted: true,
      },
    });
    expect(reg2.error).toBeUndefined();
    const mcp2 = (reg2.payload as { server: { mcpServerId: string } }).server.mcpServerId;
    const safe = await writeAndRead(sock, reader, {
      id: 'mcp-req-safe',
      kind: 'request',
      type: 'mcp.tool.request',
      payload: { mcpServerId: mcp2, toolName: 'read_file' },
    });
    expect(safe.error).toBeUndefined();
    const safeBody = safe.payload as {
      enqueued: boolean;
      autoApproved: boolean;
      sensitivity: { sensitive: boolean };
    };
    expect(safeBody.sensitivity.sensitive).toBe(false);
    expect(safeBody.autoApproved).toBe(true);
    expect(safeBody.enqueued).toBe(false);

    sock.destroy();
    await session.close();
  }, 30_000);


  it('real spawn probe runs allowlisted node endpoint and refuses fake://', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-spawn-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const registered = await writeAndRead(sock, reader, {
      id: 'mcp-spawn-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'spawn-node-echo',
        transport: 'local-stdio',
        endpoint: 'node -e "process.stdout.write(\'SPAWN_OK\')"',
        tools: [{ name: 'ping', description: 'noop' }],
        trusted: false,
        timeoutMs: 10_000,
        maxOutputBytes: 4096,
      },
    });
    expect(registered.error).toBeUndefined();
    const mcpServerId = (registered.payload as { server: { mcpServerId: string } }).server.mcpServerId;

    const spawned = await writeAndRead(sock, reader, {
      id: 'mcp-spawn-1',
      kind: 'request',
      type: 'mcp.spawn.probe',
      payload: { mcpServerId },
    });
    expect(spawned.error).toBeUndefined();
    const body = spawned.payload as {
      simulated: boolean;
      spawned: boolean;
      ok: boolean;
      exitCode: number | null;
      preview: string;
      contentTrust: string;
      auditNote: string;
    };
    expect(body.simulated).toBe(false);
    expect(body.spawned).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.exitCode).toBe(0);
    expect(body.preview).toMatch(/SPAWN_OK/);
    expect(body.contentTrust).toBe('untrusted');
    expect(body.auditNote).toMatch(/real-spawn/);

    const refused = await writeAndRead(sock, reader, {
      id: 'mcp-spawn-refuse',
      kind: 'request',
      type: 'mcp.spawn.probe',
      payload: {
        endpoint: 'fake://nope',
        transport: 'local-stdio',
        timeoutMs: 2000,
        maxOutputBytes: 1024,
        trusted: false,
      },
    });
    expect(refused.error).toBeUndefined();
    const refuseBody = refused.payload as {
      simulated: boolean;
      spawned: boolean;
      ok: boolean;
      refuseReason?: string;
    };
    expect(refuseBody.simulated).toBe(false);
    expect(refuseBody.spawned).toBe(false);
    expect(refuseBody.ok).toBe(false);

    sock.destroy();
    await session.close();
  }, 30_000);



  it('keeps M1 soft requests while rejecting scope-less actual calls after Agent binding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-call-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-call-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Resolve mini MCP fixture from monorepo (relative to this test file)
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const fromTest = join(here, '../../../packages/workers/src/mcp/fixtures/mini-mcp-server.mjs');
    expect(existsSync(fromTest), 'mini-mcp fixture must exist at ' + fromTest).toBe(true);
    const endpoint = 'node "' + fromTest + '"';

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Seed model for agent binding
    const created = await writeAndRead(sock, reader, {
      id: 'prov-call',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Call GW',
        baseUrl: 'https://call-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-call-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-call',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'call-model', displayName: 'Call Model' }],
      },
    });
    expect(add.error).toBeUndefined();
    const modelId = (add.payload as { models: Array<{ modelId: string }> }).models[0]!.modelId;

    const registered = await writeAndRead(sock, reader, {
      id: 'mcp-call-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'mini-jsonrpc',
        transport: 'local-stdio',
        endpoint,
        tools: [
          { name: 'echo', description: 'echo' },
          { name: 'ping', description: 'ping' },
          { name: 'write_file', description: 'write' },
        ],
        trusted: false,
        timeoutMs: 15_000,
        maxOutputBytes: 16_384,
      },
    });
    expect(registered.error).toBeUndefined();
    const mcpServerId = (registered.payload as { server: { mcpServerId: string } }).server
      .mcpServerId;

    // M1 keeps the scope-optional request surface. Actual calls are orchestration-only.
    const requested = await writeAndRead(sock, reader, {
      id: 'mcp-request-without-scope',
      kind: 'request',
      type: 'mcp.tool.request',
      payload: {
        mcpServerId,
        toolName: 'echo',
        argumentsJson: JSON.stringify({ text: 'HELLO_JSONRPC' }),
      },
    });
    expect(requested.error).toBeUndefined();
    expect(requested.payload).toMatchObject({ simulated: true });

    const bound = await writeAndRead(sock, reader, {
      id: 'agent-bind-call',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        mcpServerIds: [mcpServerId],
      },
    });
    expect(bound.error).toBeUndefined();

    const actualWithoutScope = await writeAndRead(sock, reader, {
      id: 'mcp-call-without-scope-after-binding',
      kind: 'request',
      type: 'mcp.tool.call',
      payload: { mcpServerId, toolName: 'echo', argumentsJson: '{}' },
    });
    expect(actualWithoutScope.error).toMatchObject({ code: 'protocol.frame_malformed' });

    sock.destroy();
    await session.close();
  }, 60_000);

  it('authorizes orchestration MCP calls through the production persistent Scheduler', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-orchestration-authz-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-mcp-orchestration-${randomBytes(5).toString('hex')}`;
    const { fileURLToPath } = await import('node:url');
    const fixturePath = fileURLToPath(
      new URL('../../../packages/workers/src/mcp/fixtures/mini-mcp-server.mjs', import.meta.url),
    );
    const endpoint = `node "${fixturePath}"`;
    const executionEntered = [deferred<void>(), deferred<void>()];
    const releaseExecution = [deferred<void>(), deferred<void>()];
    let executionAttempts = 0;
    const orchestrationProvider: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return ['orchestration-model'];
      },
      async *call() {
        const attempt = executionAttempts++;
        executionEntered[attempt]?.resolve();
        await (releaseExecution[attempt]?.promise ?? Promise.resolve());
        yield { type: 'text-delta', text: `production step attempt ${attempt + 1}` };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': orchestrationProvider },
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);
    try {
      const provider = await writeAndRead(sock, reader, {
        id: 'orchestration-provider',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Orchestration Authz Provider',
          baseUrl: 'https://orchestration-authz.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-orchestration-authz-test',
          supportsDiscovery: false,
        },
      });
      const providerId = (provider.payload as { provider: { providerId: string } }).provider
        .providerId;
      const models = await writeAndRead(sock, reader, {
        id: 'orchestration-model',
        kind: 'request',
        type: 'provider.addModels',
        payload: {
          providerId,
          protocol: 'openai-chat',
          models: [{ providerModelId: 'orchestration-model', displayName: 'Orchestration' }],
        },
      });
      const modelId = (models.payload as { models: Array<{ modelId: string }> }).models[0]!
        .modelId;
      const registered = await writeAndRead(sock, reader, {
        id: 'orchestration-mcp',
        kind: 'request',
        type: 'mcp.register',
        payload: {
          name: 'orchestration-server',
          transport: 'local-stdio',
          endpoint,
          tools: [{ name: 'echo', description: 'echo' }],
          trusted: false,
        },
      });
      const mcpServerId = (registered.payload as { server: { mcpServerId: string } }).server
        .mcpServerId;

      const beforeBinding = await writeAndRead(sock, reader, {
        id: 'orchestration-agent-before',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const oldAgentVersionId = (
        beforeBinding.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;
      const binding = await writeAndRead(sock, reader, {
        id: 'orchestration-agent-binding',
        kind: 'request',
        type: 'agent.updateBinding',
        payload: {
          defaultModelId: modelId,
          fallbackModelIds: [],
          pauseOnFailure: true,
          mcpServerIds: [mcpServerId],
        },
      });
      const agentVersionId = (
        binding.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;

      const workspace = await writeAndRead(sock, reader, {
        id: 'orchestration-workspace',
        kind: 'request',
        type: 'workspace.create',
        payload: { folderPath: join(dir, 'workspace'), name: 'Orchestration Authz' },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const task = await writeAndRead(sock, reader, {
        id: 'orchestration-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Authz task', goal: 'Verify exact MCP ownership' },
      });
      const taskId = (task.payload as { taskId: string }).taskId;
      expect(
        (
          await writeAndRead(sock, reader, {
            id: 'orchestration-mode',
            kind: 'request',
            type: 'task.setParticipationMode',
            payload: {
              taskId,
              mode: 'collaboration',
              expectedTaskVersion: 0,
            },
          })
        ).error,
      ).toBeUndefined();
      const draft = await writeAndRead(sock, reader, {
        id: 'orchestration-plan',
        kind: 'request',
        type: 'plan.draft',
        payload: {
          taskId,
          expectedTaskVersion: 1,
          title: 'MCP authorization plan',
          steps: [
            {
              id: 'orchestration-mcp-step',
              title: 'Read one file',
              instructions: 'Use the authorized MCP tool',
              agentVersionId,
              dependsOn: [],
            },
          ],
        },
      });
      expect(draft.error).toBeUndefined();
      const approved = await writeAndRead(sock, reader, {
        id: 'orchestration-approve',
        kind: 'request',
        type: 'plan.approve',
        payload: {
          planId: (draft.payload as { planId: string }).planId,
          revision: 1,
        },
      });
      expect(approved.error).toBeUndefined();
      const runId = (approved.payload as { run: { id: string } }).run.id;
      await Promise.race([
        executionEntered[0]!.promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('production StepExecutor did not enter')), 2_000),
        ),
      ]);
      const scope = {
        workspaceId,
        taskId,
        runId,
        stepId: 'orchestration-mcp-step',
        agentVersionId,
      };
      const call = async (id: string, overrides: Record<string, unknown> = {}) =>
        writeAndRead(sock, reader, {
          id,
          kind: 'request',
          type: 'mcp.tool.call',
          payload: {
            mcpServerId,
            toolName: 'echo',
            argumentsJson: JSON.stringify({ text: 'ORCHESTRATION_EFFECT' }),
            forceSensitive: true,
            executeIfAutoApproved: false,
            ...scope,
            ...overrides,
          },
        });
      const request = async (id: string) =>
        writeAndRead(sock, reader, {
          id,
          kind: 'request',
          type: 'mcp.tool.request',
          payload: {
            mcpServerId,
            toolName: 'echo',
            argumentsJson: JSON.stringify({ text: 'ORCHESTRATION_EFFECT' }),
            forceSensitive: true,
            ...scope,
          },
        });

      const deniedByDefault = await call('orchestration-denied-default');
      expect(deniedByDefault.error).toBeUndefined();
      expect(deniedByDefault.payload).toMatchObject({
        executed: false,
        enqueued: false,
        onAgentAllowlist: false,
      });
      expect(String((deniedByDefault.payload as { refuseReason?: string }).refuseReason)).toMatch(
        /not-authorized|authorization/i,
      );
      expect((await request('orchestration-request-denied')).payload).toMatchObject({
        authorized: false,
        enqueued: false,
      });

      const auditConnection = await openDatabaseAsync({ path: dbPath });
      const refusedBefore = (
        auditConnection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'mcp.tool_refused'")
          .get() as { count: number }
      ).count;
      const forgedBeforeGrant = await call('orchestration-forged-no-audit', {
        stepId: 'forged-step',
      });
      expect(forgedBeforeGrant.payload).toMatchObject({ executed: false, enqueued: false });
      const refusedAfter = (
        auditConnection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'mcp.tool_refused'")
          .get() as { count: number }
      ).count;
      expect.soft(refusedAfter).toBe(refusedBefore);
      auditConnection.raw.close();

      const external = await openDatabaseAsync({ path: dbPath });
      const authorizationStore = new SqliteAuthorizationStore(external.raw);
      const grant = authorizationStore.grant({
        grantId: 'grant-orchestration-read',
        scope: 'run',
        scopeId: runId,
        agentVersionId: agentVersionId as never,
        target: 'mcp',
        serverId: mcpServerId as never,
        tools: ['echo'],
      });
      try {
        const authorized = await call('orchestration-authorized');
        expect(authorized.error).toBeUndefined();
        expect(authorized.payload).toMatchObject({
          executed: false,
          enqueued: true,
          onAgentAllowlist: true,
        });
        const gatedGraph = await writeAndRead(sock, reader, {
          id: 'orchestration-gated-graph',
          kind: 'request',
          type: 'run.getGraph',
          payload: { workspaceId, taskId, runId },
        });
        expect.soft(gatedGraph.payload).toMatchObject({
          run: { state: 'awaitingToolApproval' },
          steps: [{ id: 'orchestration-mcp-step', state: 'awaitingApproval' }],
        });
        expect((authorized.payload as { refuseReason?: string }).refuseReason).not.toBe(
          'scheduler.step_action_unavailable',
        );
        releaseExecution[0]!.resolve();
        const audit = await openDatabaseAsync({ path: dbPath });
        const requestedAudit = audit.raw
          .prepare(
            `SELECT workspace_id, task_id, run_id, step_id, payload_json
             FROM event WHERE type = 'mcp.tool_requested'
             ORDER BY sequence DESC LIMIT 1`,
          )
          .get() as
          | {
              workspace_id: string;
              task_id: string | null;
              run_id: string | null;
              step_id: string | null;
              payload_json: string;
            }
          | undefined;
        expect.soft(requestedAudit).toMatchObject({
          workspace_id: workspaceId,
          task_id: taskId,
          run_id: runId,
          step_id: 'orchestration-mcp-step',
        });
        expect.soft(JSON.parse(requestedAudit?.payload_json ?? '{}')).toMatchObject({
          workspaceId,
          taskId,
          runId,
          stepId: 'orchestration-mcp-step',
          agentVersionId,
          actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        audit.raw.close();
        const approvedRequestId = (
          authorized.payload as { approvalRequest?: { id: string } }
        ).approvalRequest!.id;
        expect((await request('orchestration-request-authorized')).payload).toMatchObject({
          authorized: true,
          enqueued: false,
        });

        const decisions = reader.read(2);
        for (const id of ['orchestration-approve-a', 'orchestration-approve-b']) {
          sock.write(
            encodeFrame({
              id,
              kind: 'request',
              type: 'approval.decide',
              payload: { id: approvedRequestId, decision: 'approved' },
            }),
          );
        }
        const decisionResponses = await decisions;
        expect(decisionResponses.map((response) => response.error)).toEqual([
          undefined,
          undefined,
        ]);
        await executionEntered[1]!.promise;
        expect(executionAttempts).toBe(2);

        const resumedCall = await call('orchestration-resumed-call');
        expect(resumedCall.error).toBeUndefined();
        expect(resumedCall.payload).toMatchObject({
          enqueued: false,
          executed: true,
          onAgentAllowlist: true,
          result: {
            ok: true,
            spawned: true,
            jsonRpcOk: true,
            toolResultText: expect.stringMatching(/ECHO:ORCHESTRATION_EFFECT/),
          },
        });
        releaseExecution[1]!.resolve();

        let completedState = '';
        for (let attempt = 0; attempt < 40 && completedState !== 'completed'; attempt += 1) {
          const completedGraph = await writeAndRead(sock, reader, {
            id: `orchestration-completed-${attempt}`,
            kind: 'request',
            type: 'run.getGraph',
            payload: { workspaceId, taskId, runId },
          });
          completedState =
            (completedGraph.payload as { run?: { state?: string } }).run?.state ?? '';
        }
        expect(completedState).toBe('completed');
        const productionOutput = external.raw
          .prepare(
            `SELECT artifact_version.content, artifact_version.status
             FROM artifact_version
             INNER JOIN artifact ON artifact.id = artifact_version.artifact_id
             WHERE artifact.run_id = ? AND artifact_version.source_step_id = ?`,
          )
          .get(runId, 'orchestration-mcp-step') as
          | { content: string | null; status: string }
          | undefined;
        expect(productionOutput).toEqual({
          content: 'production step attempt 2',
          status: 'candidate',
        });

        const calledAudit = external.raw
          .prepare(
            `SELECT workspace_id, task_id, run_id, step_id, payload_json
             FROM event WHERE type = 'mcp.tool_called'
             ORDER BY sequence DESC LIMIT 1`,
          )
          .get() as {
          workspace_id: string;
          task_id: string;
          run_id: string;
          step_id: string;
          payload_json: string;
        };
        expect(calledAudit).toMatchObject({
          workspace_id: workspaceId,
          task_id: taskId,
          run_id: runId,
          step_id: 'orchestration-mcp-step',
        });
        expect(JSON.parse(calledAudit.payload_json)).toMatchObject({
          workspaceId,
          taskId,
          runId,
          stepId: 'orchestration-mcp-step',
          agentVersionId,
          actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const actionIntent = external.raw
          .prepare(
            `SELECT run_id, step_id, agent_version_id, execution_owner_id,
                    execution_attempt, action_digest, state
             FROM mcp_action_execution_intent
             WHERE run_id = ? AND step_id = ?`,
          )
          .get(runId, 'orchestration-mcp-step') as
          | {
              run_id: string;
              step_id: string;
              agent_version_id: string;
              execution_owner_id: string;
              execution_attempt: number;
              action_digest: string;
              state: string;
            }
          | undefined;
        expect(actionIntent).toMatchObject({
          run_id: runId,
          step_id: 'orchestration-mcp-step',
          agent_version_id: agentVersionId,
          execution_owner_id: expect.stringMatching(/^scheduler-/),
          execution_attempt: 2,
          action_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
          state: 'completed',
        });
        expect(
          external.raw
            .prepare(
              "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'approval.decided'",
            )
            .get(runId),
        ).toEqual({ count: 1 });

        const wrongStep = await call('orchestration-wrong-step', {
          stepId: 'forged-step',
        });
        expect(wrongStep.payload).toMatchObject({ executed: false, enqueued: false });
        expect(String((wrongStep.payload as { refuseReason?: string }).refuseReason)).toMatch(
          /scope|Step|authorization/i,
        );

        const wrongAgent = await call('orchestration-wrong-agent', {
          agentVersionId: oldAgentVersionId,
        });
        expect(wrongAgent.payload).toMatchObject({ executed: false, enqueued: false });
        expect(String((wrongAgent.payload as { refuseReason?: string }).refuseReason)).toMatch(
          /AgentVersion|authorization/i,
        );

        authorizationStore.revoke({ grantId: grant.grantId });
        const revoked = await call('orchestration-revoked');
        expect(revoked.payload).toMatchObject({ executed: false, enqueued: false });
        expect(String((revoked.payload as { refuseReason?: string }).refuseReason)).toMatch(
          /revoked|authorization/i,
        );
        const refusedAudit = external.raw
          .prepare(
            `SELECT workspace_id, task_id, run_id, step_id, payload_json
             FROM event WHERE run_id = ? AND type = 'mcp.tool_refused'
             ORDER BY sequence DESC LIMIT 1`,
          )
          .get(runId) as {
          workspace_id: string;
          task_id: string;
          run_id: string;
          step_id: string;
          payload_json: string;
        };
        expect(refusedAudit).toMatchObject({
          workspace_id: workspaceId,
          task_id: taskId,
          run_id: runId,
          step_id: 'orchestration-mcp-step',
        });
        expect(JSON.parse(refusedAudit.payload_json)).toMatchObject({
          workspaceId,
          taskId,
          runId,
          stepId: 'orchestration-mcp-step',
          agentVersionId,
          actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          reason: expect.stringMatching(/revoked|authorization/i),
        });
        expect((await request('orchestration-request-revoked')).payload).toMatchObject({
          authorized: false,
          enqueued: false,
        });
      } finally {
        external.raw.close();
      }

      const partialScope = await writeAndRead(sock, reader, {
        id: 'orchestration-partial-scope',
        kind: 'request',
        type: 'mcp.tool.call',
        payload: {
          mcpServerId,
          toolName: 'echo',
          runId,
        },
      });
      expect(partialScope.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      for (const pending of releaseExecution) pending.resolve();
      sock.destroy();
      await session.close();
    }
  }, 60_000);

  it('waits for a spawned exact MCP call to abort and persist refusal before session close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-close-dispatch-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const markerPath = join(dir, 'spawned.pid');
    const installId = `test-mcp-close-dispatch-${randomBytes(5).toString('hex')}`;
    const { fileURLToPath } = await import('node:url');
    const fixturePath = fileURLToPath(
      new URL(
        '../../../packages/workers/src/mcp/fixtures/cancellable-process.mjs',
        import.meta.url,
      ),
    );
    const workspaceId = 'workspace-mcp-close';
    const taskId = 'task-mcp-close';
    const agentVersionId = 'agent-version-mcp-close';
    const mcpServerId = 'mcp-server-close';
    const stepId = 'step-mcp-close';
    const entered = deferred<void>();
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
      stepExecutor: {
        async execute(context) {
          entered.resolve();
          if (!context.signal.aborted) {
            await new Promise<void>((resolve) => {
              context.signal.addEventListener('abort', () => resolve(), { once: true });
            });
          }
          return {};
        },
      },
    });

    const seed = await openDatabaseAsync({ path: dbPath });
    let runId = '';
    try {
      seed.raw.prepare(
        `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
         VALUES (?, ?, 'MCP close', 't0', 't0')`,
      ).run(workspaceId, join(dir, 'workspace'));
      seed.raw.prepare(
        `INSERT INTO task (
           id, workspace_id, title, goal, status, participation_mode,
           acceptance_criteria_json, version, created_at, updated_at
         ) VALUES (?, ?, 'MCP close', 'Wait for handler shutdown', 'active',
           'automatic', '[]', 0, 't0', 't0')`,
      ).run(taskId, workspaceId);
      seed.raw.prepare(
        `INSERT INTO thread (id, task_id, created_at)
         VALUES ('thread-mcp-close', ?, 't0')`,
      ).run(taskId);
      seed.raw.prepare(
        `INSERT INTO agent_version (
           id, agent_id, version, name, role, developer_instructions,
           input_contract, output_contract, default_model_id,
           default_credential_group_id, pinned_credential_ref_id,
           pause_on_failure, fallback_model_ids_json, memory_scope,
           skill_version_ids_json, mcp_server_ids_json, policy_id,
           approval_mode, created_at
         ) VALUES (?, 'agent-mcp-close', 1, 'MCP close worker', 'worker', '', '', '',
           'model-mcp-close', 'group-mcp-close', NULL, 1, '[]', 'task', '[]', ?,
           NULL, 'full', 't0')`,
      ).run(agentVersionId, JSON.stringify([mcpServerId]));
      seed.raw.prepare(
        `INSERT INTO mcp_server (
           id, name, transport, endpoint, tools_json, trusted,
           max_output_bytes, timeout_ms, notes, created_at, updated_at
         ) VALUES (?, 'MCP close server', 'local-stdio', ?, ?, 0,
           4096, 30000, '', 't0', 't0')`,
      ).run(
        mcpServerId,
        `node "${fixturePath}" "${markerPath}"`,
        JSON.stringify([{ name: 'wait_for_cancel', description: 'Wait until Runtime closes' }]),
      );

      new SqlitePolicyStore(seed.raw).save({
        policyId: 'policy-mcp-close',
        scopeType: 'agent',
        scopeId: 'agent-mcp-close',
        approvalMode: 'full',
        rules: [{ action: 'mcp.tool.request:wait_for_cancel', approvalMode: 'full' }],
        now: 't0',
      });
      const orchestration = new SqliteOrchestrationStore(seed.raw);
      const draft = orchestration.createPlanDraft({
        taskId: taskId as never,
        title: 'MCP close plan',
        steps: [
          {
            id: stepId as never,
            title: 'Wait for MCP cancellation',
            instructions: 'Invoke one exact MCP action',
            agentVersionId: agentVersionId as never,
            dependsOn: [],
          },
        ],
        now: '2026-07-14T00:00:00.000Z',
      });
      const graph = orchestration.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: '2026-07-14T00:00:01.000Z',
      });
      runId = graph.run.id;
      new SqliteAuthorizationStore(seed.raw).grant({
        grantId: 'grant-mcp-close',
        scope: 'run',
        scopeId: runId,
        agentVersionId: agentVersionId as never,
        target: 'mcp',
        serverId: mcpServerId as never,
        tools: ['wait_for_cancel'],
        now: '2026-07-14T00:00:02.000Z',
      });
    } finally {
      seed.raw.close();
    }

    let socket: Socket | undefined;
    let childPid: number | undefined;
    let closed = false;
    try {
      await session.runtime.start();
      await Promise.race([
        entered.promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Scheduler did not start the test Step')), 2_000),
        ),
      ]);
      socket = await connectRuntime(installId);
      const reader = createFrameReader(socket);
      await hello(socket, reader, installId);
      let earlyResponse: Frame | undefined;
      const responseAfterClose = reader
        .read(1)
        .then((frames) => {
          earlyResponse = frames[0];
          return frames;
        })
        .catch(() => []);
      socket.write(
        encodeFrame({
          id: 'mcp-close-call',
          kind: 'request',
          type: 'mcp.tool.call',
          payload: {
            workspaceId,
            taskId,
            runId,
            stepId,
            agentVersionId,
            mcpServerId,
            toolName: 'wait_for_cancel',
            argumentsJson: '{}',
            forceSensitive: true,
          },
        }),
      );

      const markerDeadline = Date.now() + 3_000;
      while (!existsSync(markerPath)) {
        if (earlyResponse) {
          throw new Error(`MCP call returned before spawn: ${JSON.stringify(earlyResponse)}`);
        }
        if (Date.now() >= markerDeadline) throw new Error('MCP child process did not spawn');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      childPid = Number(readFileSync(markerPath, 'utf8'));

      await session.close();
      closed = true;
      await responseAfterClose;
      expect(() => process.kill(childPid!, 0)).toThrow();

      const audit = await openDatabaseAsync({ path: dbPath });
      try {
        const counts = () =>
          audit.raw.prepare(
            `SELECT
               SUM(CASE WHEN type = 'mcp.tool_refused' THEN 1 ELSE 0 END) AS refused,
               SUM(CASE WHEN type = 'mcp.tool_called' THEN 1 ELSE 0 END) AS called
             FROM event WHERE run_id = ? AND step_id = ?`,
          ).get(runId, stepId) as { refused: number; called: number };
        expect(counts()).toEqual({ refused: 1, called: 0 });
        expect(
          audit.raw.prepare(
            `SELECT state FROM mcp_action_execution_intent
             WHERE run_id = ? AND step_id = ?`,
          ).get(runId, stepId),
        ).toEqual({ state: 'started' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(counts()).toEqual({ refused: 1, called: 0 });
      } finally {
        audit.raw.close();
      }
    } finally {
      socket?.destroy();
      if (!closed) await session.close();
      if (childPid) {
        try {
          process.kill(childPid);
        } catch {
          // The expected shutdown path already terminated it.
        }
      }
    }
  }, 30_000);

  it('does not let an Agent allowlist bypass required actual-call scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-call-fake-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-call-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const created = await writeAndRead(sock, reader, {
      id: 'prov-fake',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Fake GW',
        baseUrl: 'https://fake-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-fake-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;
    const add = await writeAndRead(sock, reader, {
      id: 'add-fake',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'fake-model', displayName: 'Fake Model' }],
      },
    });
    expect(add.error).toBeUndefined();
    const modelId = (add.payload as { models: Array<{ modelId: string }> }).models[0]!.modelId;

    const reg = await writeAndRead(sock, reader, {
      id: 'mcp-fake-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'fake-server',
        transport: 'local-stdio',
        endpoint: 'fake://nope',
        tools: [{ name: 'echo', description: 'echo' }],
        trusted: true,
        timeoutMs: 3000,
        maxOutputBytes: 1024,
      },
    });
    expect(reg.error).toBeUndefined();
    const mcpServerId = (reg.payload as { server: { mcpServerId: string } }).server.mcpServerId;

    const bound = await writeAndRead(sock, reader, {
      id: 'agent-bind-fake',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        mcpServerIds: [mcpServerId],
      },
    });
    expect(bound.error).toBeUndefined();

    const call = await writeAndRead(sock, reader, {
      id: 'mcp-fake-call',
      kind: 'request',
      type: 'mcp.tool.call',
      payload: {
        mcpServerId,
        toolName: 'echo',
        argumentsJson: JSON.stringify({ text: 'x' }),
      },
    });
    expect(call.error).toMatchObject({ code: 'protocol.frame_malformed' });

    sock.destroy();
    await session.close();
  }, 30_000);

  it('mcp.tools.refresh discovers tools via JSON-RPC and persists catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-refresh-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-mcp-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const { fileURLToPath } = await import('node:url');
    const fixturePath = fileURLToPath(
      new URL('../../../packages/workers/src/mcp/fixtures/mini-mcp-server.mjs', import.meta.url),
    );
    const endpoint = 'node "' + fixturePath + '"';

    // Register without tools — discovery should fill them
    const reg = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'mini-refresh',
        transport: 'local-stdio',
        endpoint,
        tools: [],
        trusted: false,
        timeoutMs: 12_000,
        maxOutputBytes: 65_536,
      },
    });
    expect(reg.error).toBeUndefined();
    const mcpServerId = (reg.payload as { server: { mcpServerId: string; tools: unknown[] } })
      .server.mcpServerId;
    expect((reg.payload as { server: { tools: unknown[] } }).server.tools).toHaveLength(0);

    const refresh = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-1',
      kind: 'request',
      type: 'mcp.tools.refresh',
      payload: { mcpServerId, maxTools: 32 },
    });
    expect(refresh.error).toBeUndefined();
    const body = refresh.payload as {
      ok: boolean;
      simulated: boolean;
      spawned: boolean;
      jsonRpcOk: boolean;
      toolCount: number;
      previousToolCount: number;
      addedToolNames: string[];
      tools: Array<{ name: string; description: string; inputSchemaJson?: string }>;
      server?: { tools: Array<{ name: string }> };
      contentTrust: string;
      auditNote: string;
    };
    expect(body.simulated).toBe(false);
    expect(body.spawned).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.jsonRpcOk).toBe(true);
    expect(body.previousToolCount).toBe(0);
    expect(body.toolCount).toBeGreaterThanOrEqual(3);
    expect(body.addedToolNames).toEqual(expect.arrayContaining(['echo', 'ping', 'write_file']));
    expect(body.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['echo', 'ping', 'write_file']),
    );
    expect(body.contentTrust).toBe('untrusted');
    expect(body.auditNote).toMatch(/tools\/list|real-jsonrpc/);

    // list should now show persisted tools
    const listed = await writeAndRead(sock, reader, {
      id: 'mcp-list-after',
      kind: 'request',
      type: 'mcp.list',
      payload: {},
    });
    expect(listed.error).toBeUndefined();
    const servers = (listed.payload as { servers: Array<{ mcpServerId: string; tools: Array<{ name: string }> }> })
      .servers;
    const found = servers.find((x) => x.mcpServerId === mcpServerId);
    expect(found).toBeTruthy();
    expect(found!.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['echo', 'ping', 'write_file']),
    );

    // refresh then bind then peek tool-schema (discovery → allowlist → §10.2 packet)
    const createdProv = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-prov',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Refresh GW',
        baseUrl: 'https://refresh-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-refresh-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(createdProv.error).toBeUndefined();
    const providerId = (createdProv.payload as { provider: { providerId: string } }).provider
      .providerId;
    const addModels = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-models',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'refresh-model', displayName: 'Refresh Model' }],
      },
    });
    expect(addModels.error).toBeUndefined();
    const modelId = (addModels.payload as { models: Array<{ modelId: string }> }).models[0]!
      .modelId;

    const bound = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-bind',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        mcpServerIds: [mcpServerId],
      },
    });
    expect(bound.error).toBeUndefined();

    const ws = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-ws',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: dir, name: 'Refresh WS' },
    });
    expect(ws.error).toBeUndefined();
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;
    const activated = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-workspace-active',
      kind: 'request',
      type: 'capability.workspace.setActive',
      payload: {
        capabilityType: 'mcp',
        capabilityId: mcpServerId,
        workspaceId,
        active: true,
      },
    });
    expect(activated.error).toBeUndefined();

    const task = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-task',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'After tools/list',
        goal: 'Discovered schemas enter Context Packet only when allowlisted',
      },
    });
    expect(task.error).toBeUndefined();
    const threadId = (task.payload as { threadId: string }).threadId;

    const peek = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-peek',
      kind: 'request',
      type: 'context.packet.peek',
      payload: { threadId, userText: 'preview after refresh' },
    });
    expect(peek.error).toBeUndefined();
    const peekBody = peek.payload as {
      mcpServerIds?: string[];
      includedSources?: Array<{ id: string; kind: string }>;
      summaries?: Array<{ sourceId: string; summary: string }>;
    };
    expect(peekBody.mcpServerIds).toContain(mcpServerId);
    const toolSources = (peekBody.includedSources ?? []).filter((src) => src.kind === 'tool-schema');
    expect(toolSources.length).toBeGreaterThanOrEqual(1);
    const names = toolSources.map((src) => src.id).join(' ');
    expect(names).toMatch(/echo|ping|write_file/);

    // fake endpoint refuses
    const regFake = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-fake-reg',
      kind: 'request',
      type: 'mcp.register',
      payload: {
        name: 'fake-refresh',
        transport: 'local-stdio',
        endpoint: 'fake://nope',
        tools: [{ name: 'x', description: 'x' }],
        trusted: false,
      },
    });
    expect(regFake.error).toBeUndefined();
    const fakeId = (regFake.payload as { server: { mcpServerId: string } }).server.mcpServerId;
    const refreshFake = await writeAndRead(sock, reader, {
      id: 'mcp-refresh-fake',
      kind: 'request',
      type: 'mcp.tools.refresh',
      payload: { mcpServerId: fakeId },
    });
    expect(refreshFake.error).toBeUndefined();
    const fakeBody = refreshFake.payload as {
      ok: boolean;
      spawned: boolean;
      simulated: boolean;
      refuseReason?: string;
      toolCount: number;
      previousToolCount: number;
    };
    expect(fakeBody.simulated).toBe(false);
    expect(fakeBody.spawned).toBe(false);
    expect(fakeBody.ok).toBe(false);
    expect(fakeBody.refuseReason).toBeTruthy();
    // catalog not wiped on refuse
    expect(fakeBody.previousToolCount).toBe(1);

    sock.destroy();
    await session.close();
  }, 60_000);


});
