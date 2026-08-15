import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKernelMcpBroker } from './mcp-broker.js';
import { executePlatformTool, PLATFORM_MCP_TOOL_DEFINITIONS } from './platform-tools.js';

const MCP_SERVER_ENTRY = fileURLToPath(
  new URL('../../../mcp-server/platform-mcp-server.mjs', import.meta.url),
);

interface McpTestHarness {
  workspaceDir: string;
  brokerPort: number;
  brokerToken: string;
  child: ChildProcess;
  call(method: string, params?: unknown): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

interface DelayedCatalogHarness {
  child: ChildProcess;
  call(method: string, params?: unknown): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('delayed MCP broker failed to bind loopback'));
        return;
      }
      server.removeListener('error', reject);
      resolve(address.port);
    });
  });
}

async function startDelayedCatalogHarness(helloDelayMs: number): Promise<DelayedCatalogHarness> {
  const token = 'delayed-catalog-token';
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
          const frame = JSON.parse(line) as { type?: string; token?: string };
          if (frame.type === 'hello' && frame.token === token) {
            setTimeout(() => {
              if (socket.destroyed) return;
              socket.write(
                JSON.stringify({
                  type: 'hello-ok',
                  tools: PLATFORM_MCP_TOOL_DEFINITIONS,
                }) + '\n',
              );
            }, helloDelayMs);
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
  });
  const port = await listen(server);
  const child = spawn(process.execPath, [MCP_SERVER_ENTRY], {
    env: {
      ...process.env,
      ST_BROKER_HOST: '127.0.0.1',
      ST_BROKER_PORT: String(port),
      ST_BROKER_TOKEN: token,
    },
  });

  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  let nextId = 0;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let msg: { id?: number; result?: Record<string, unknown> };
    try {
      msg = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? {});
      pending.delete(msg.id);
    }
  });

  return {
    child,
    call: (method: string, params?: unknown) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }),
    close: async () => {
      rl.close();
      child.kill();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function startHarness(): Promise<McpTestHarness> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-channel-'));
  writeFileSync(join(workspaceDir, 'demo.txt'), 'hello channel\n');
  const broker = await startKernelMcpBroker({
    workspaceDir,
    tools: PLATFORM_MCP_TOOL_DEFINITIONS,
    onToolCall: async (call) => {
      try {
        const content = await executePlatformTool(call.tool, call.input, { workspaceDir });
        return { ok: true, content };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  const child = spawn(process.execPath, [MCP_SERVER_ENTRY], {
    env: {
      ...process.env,
      ST_BROKER_HOST: broker.host,
      ST_BROKER_PORT: String(broker.port),
      ST_BROKER_TOKEN: broker.token,
    },
  });

  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  let nextId = 0;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let msg: { id?: number; result?: Record<string, unknown> };
    try {
      msg = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? {});
      pending.delete(msg.id);
    }
  });

  const call = (method: string, params?: unknown): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  // Poll tools/list until the broker catalog arrives via hello-ok (the server
  // boots asynchronously; under parallel test load 500ms can be too short).
  const deadline = Date.now() + 10_000;
  for (;;) {
    const probe = (await call('tools/list', {})) as { tools?: Array<{ name: string }> };
    if (Array.isArray(probe.tools) && probe.tools.length > 0) break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    workspaceDir,
    brokerPort: broker.port,
    brokerToken: broker.token,
    child,
    call,
    close: async () => {
      rl.close();
      child.kill();
      await broker.close();
    },
  };
}

describe('platform MCP channel (server ↔ broker ↔ executor)', () => {
  it('waits for the broker catalog before answering the first tools/list request', async () => {
    const harness = await startDelayedCatalogHarness(300);
    try {
      const listPromise = harness.call('tools/list', {});
      const state = await Promise.race([
        listPromise.then(() => 'resolved'),
        delay(75).then(() => 'pending'),
      ]);
      expect(state).toBe('pending');

      const list = (await listPromise) as { tools?: Array<{ name: string }> };
      expect((list.tools ?? []).map((tool) => tool.name)).toContain('file_write');
    } finally {
      await harness.close();
    }
  });

  it('closes resource and prompt capability probes with empty collections', async () => {
    const harness = await startDelayedCatalogHarness(300);
    try {
      await expect(harness.call('resources/list', {})).resolves.toEqual({ resources: [] });
      await expect(harness.call('prompts/list', {})).resolves.toEqual({ prompts: [] });
    } finally {
      await harness.close();
    }
  });

  it('authenticates with the per-run token and serves the catalog from the broker', async () => {
    const harness = await startHarness();
    try {
      const list = (await harness.call('tools/list', {})) as { tools?: Array<{ name: string }> };
      expect(Array.isArray(list.tools)).toBe(true);
      const names = (list.tools ?? []).map((tool) => tool.name);
      expect(names).toContain('file_read');
      expect(names).toContain('file_write');
      expect(names).toContain('platform_context');
    } finally {
      await harness.close();
    }
  });

  it('executes file_read through the broker executor', async () => {
    const harness = await startHarness();
    try {
      const read = (await harness.call('tools/call', {
        name: 'file_read',
        arguments: { path: 'demo.txt' },
      })) as { content?: Array<{ text?: string }> };
      const text = read.content?.[0]?.text ?? '';
      expect(text).toContain('hello channel');
    } finally {
      await harness.close();
    }
  });

  it('executes file_write and rejects path escapes', async () => {
    const harness = await startHarness();
    try {
      const write = (await harness.call('tools/call', {
        name: 'file_write',
        arguments: { path: 'out.txt', content: 'written via mcp' },
      })) as { content?: Array<{ text?: string }> };
      expect(write.content?.[0]?.text).toContain('"ok":true');
      expect(existsSync(join(harness.workspaceDir, 'out.txt'))).toBe(true);
      expect(readFileSync(join(harness.workspaceDir, 'out.txt'), 'utf8')).toBe('written via mcp');

      const escape = (await harness.call('tools/call', {
        name: 'file_read',
        arguments: { path: '../outside.txt' },
      })) as { content?: Array<{ text?: string }>; isError?: boolean };
      expect(escape.isError).toBe(true);
      expect(escape.content?.[0]?.text ?? '').toMatch(/escapes the workspace/);
    } finally {
      await harness.close();
    }
  });

  it('rejects unknown tools with an error result', async () => {
    const harness = await startHarness();
    try {
      const result = (await harness.call('tools/call', {
        name: 'no_such_tool',
        arguments: {},
      })) as { content?: Array<{ text?: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
