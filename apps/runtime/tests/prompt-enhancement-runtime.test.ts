import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  PROTOCOL_VERSION,
  type Frame,
} from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { Runtime } from '../src/runtime.js';

class PromptEnhancementProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    yield { type: 'text-delta', text: '请制定一份包含里程碑、风险和验收标准的发布计划。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

const runtimes: Runtime[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function frameClient(socket: Socket) {
  const pending = new Map<string, (frame: Frame) => void>();
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([buffer, chunk]));
    buffer = decoded.remaining;
    for (const frame of decoded.frames) {
      pending.get(frame.id)?.(frame);
      pending.delete(frame.id);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => pending.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

async function hello(client: ReturnType<typeof frameClient>, installId: string): Promise<void> {
  const response = await client.send({
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      appVersion: '0.0.1',
      installId,
      nonce: 'prompt-enhancement-test',
      features: ['prompt.enhance'],
    },
  });
  expect(response.error).toBeUndefined();
}

describe('prompt enhancement runtime', () => {
  it('rewrites a draft through the provider without writing conversation history', async () => {
    const installId = `prompt-enhance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const provider = new PromptEnhancementProvider();
    const runtime = new Runtime({ installId, allowNoToken: true, demoProvider: provider });
    runtimes.push(runtime);
    await runtime.start();
    const socket = await connectRuntime(installId);
    const client = frameClient(socket);
    await hello(client, installId);

    const response = await client.send({
      id: 'enhance-frame-1',
      kind: 'request',
      type: 'prompt.enhance',
      payload: {
        requestId: 'enhance-1',
        text: '写一个发布计划',
        modelId: 'fake-mini',
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.payload).toEqual({
      requestId: 'enhance-1',
      text: '请制定一份包含里程碑、风险和验收标准的发布计划。',
      modelId: 'fake-mini',
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages).toEqual([{ role: 'user', content: '写一个发布计划' }]);
    expect(provider.requests[0]?.systemPrompt).toContain('只输出优化后的提示词');
    expect(runtime.createCheckpoint()).toMatchObject({ events: [], threadVersions: [] });
  });
});
