import { createConnection, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  startKernelMcpBroker,
  type KernelMcpBroker,
  type PlatformMcpToolResult,
} from './mcp-broker.js';

const TOOLS = [
  {
    name: 'probe',
    description: 'Return the broker identity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never' as const,
  },
];

interface BrokerClient {
  socket: Socket;
  call(id: string): Promise<PlatformMcpToolResult>;
  send(frame: Record<string, unknown>): void;
  nextFrame(): Promise<Record<string, unknown>>;
  close(): void;
}

async function startBroker(identity: string): Promise<KernelMcpBroker> {
  return startKernelMcpBroker({
    workspaceDir: process.cwd(),
    tools: TOOLS,
    onToolCall: async () => ({ ok: true, content: identity }),
  });
}

async function connectClient(broker: KernelMcpBroker): Promise<BrokerClient> {
  const socket = createConnection({ host: broker.host, port: broker.port });
  const frames: Array<Record<string, unknown>> = [];
  const waiters: Array<(frame: Record<string, unknown>) => void> = [];
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const frame = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
      newline = buffer.indexOf('\n');
    }
  });
  const nextFrame = (): Promise<Record<string, unknown>> => {
    const frame = frames.shift();
    return frame ? Promise.resolve(frame) : new Promise((resolve) => waiters.push(resolve));
  };
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(JSON.stringify({ type: 'hello', token: broker.token }) + '\n');
  expect((await nextFrame()).type).toBe('hello-ok');
  return {
    socket,
    call: async (id) => {
      socket.write(JSON.stringify({ type: 'tool-call', id, tool: 'probe', input: {} }) + '\n');
      const frame = await nextFrame();
      return {
        ok: frame.ok === true,
        content: typeof frame.content === 'string' ? frame.content : undefined,
        error: typeof frame.error === 'string' ? frame.error : undefined,
      };
    },
    send: (frame) => socket.write(JSON.stringify(frame) + '\n'),
    nextFrame,
    close: () => socket.destroy(),
  };
}

describe('platform MCP broker lifecycle', () => {
  it('closing one run does not destroy another run socket', async () => {
    const brokerA = await startBroker('run-a');
    const brokerB = await startBroker('run-b');
    const clientA = await connectClient(brokerA);
    const clientB = await connectClient(brokerB);
    try {
      expect(await clientA.call('a-1')).toMatchObject({ ok: true, content: 'run-a' });
      expect(await clientB.call('b-1')).toMatchObject({ ok: true, content: 'run-b' });

      await brokerA.close();

      expect(await clientB.call('b-2')).toMatchObject({ ok: true, content: 'run-b' });
    } finally {
      clientA.close();
      clientB.close();
      await brokerA.close().catch(() => undefined);
      await brokerB.close().catch(() => undefined);
    }
  });

  it('aborts the host handler when the kernel cancels the call', async () => {
    let observedAbort = false;
    const broker = await startKernelMcpBroker({
      workspaceDir: process.cwd(),
      tools: TOOLS,
      onToolCall: (call) =>
        new Promise((resolve) => {
          call.signal.addEventListener('abort', () => {
            observedAbort = true;
            resolve({ ok: false, error: 'cancelled' });
          });
        }),
    });
    const client = await connectClient(broker);
    try {
      client.send({ type: 'tool-call', id: 'cancel-me', tool: 'probe', input: {} });
      await new Promise((resolve) => setTimeout(resolve, 30));
      client.send({ type: 'tool-cancel', id: 'cancel-me' });
      const frame = await client.nextFrame();
      expect(observedAbort).toBe(true);
      expect(frame).toMatchObject({ type: 'tool-result', id: 'cancel-me', ok: false });
    } finally {
      client.close();
      await broker.close().catch(() => undefined);
    }
  });

  it('serializes tool calls on one connection so two mutations cannot race', async () => {
    let active = 0;
    let maxActive = 0;
    const broker = await startKernelMcpBroker({
      workspaceDir: process.cwd(),
      tools: TOOLS,
      onToolCall: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { ok: true, content: 'done' };
      },
    });
    const client = await connectClient(broker);
    try {
      client.send({ type: 'tool-call', id: 's-1', tool: 'probe', input: {} });
      client.send({ type: 'tool-call', id: 's-2', tool: 'probe', input: {} });
      const first = await client.nextFrame();
      const second = await client.nextFrame();
      expect([first.id, second.id]).toEqual(['s-1', 's-2']);
      expect(maxActive).toBe(1);
    } finally {
      client.close();
      await broker.close().catch(() => undefined);
    }
  });
});
