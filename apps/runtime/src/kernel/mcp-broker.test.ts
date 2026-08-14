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
});
