import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConfigurationCommandPreview,
  type Frame,
} from '@sync-think/protocol';
import { Runtime } from '../src/runtime.js';

const runtimes: Runtime[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

async function connectRuntime(installId: string): Promise<{
  socket: Socket;
  request(frame: Frame): Promise<Frame>;
}> {
  const socket = connect(pipePathPortable(installId));
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let pending = Buffer.alloc(0);
  const queued: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queued.push(frame);
    }
  });
  const request = (frame: Frame): Promise<Frame> => {
    const response = queued.length
      ? Promise.resolve(queued.shift()!)
      : new Promise<Frame>((resolve) => waiters.push(resolve));
    socket.write(encodeFrame(frame));
    return response;
  };
  await request({
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: 'confirmation-test',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: ['workspace.create'],
    },
  });
  return { socket, request };
}

describe('Runtime configuration confirmation', () => {
  it('previews external configuration commands and accepts one exact confirmation', async () => {
    const installId = `confirmation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    runtimes.push(runtime);
    await runtime.start();
    const client = await connectRuntime(installId);
    const payload = { name: 'External project' };

    const previewResponse = await client.request({
      id: 'preview',
      kind: 'request',
      type: 'workspace.create',
      payload,
      meta: { callerSurface: 'mcp' },
    });
    expect(previewResponse.error).toBeUndefined();
    const preview = previewResponse.payload as ConfigurationCommandPreview;
    expect(preview).toMatchObject({
      status: 'confirmation_required',
      command: 'workspace.create',
      callerSurface: 'mcp',
      payloadKeys: ['name'],
    });
    expect(preview.confirmationToken).toBeTruthy();
    expect(preview.auditEventId).toBeTruthy();

    const confirmed = await client.request({
      id: 'confirmed',
      kind: 'request',
      type: 'workspace.create',
      payload,
      meta: { callerSurface: 'mcp', confirmationToken: preview.confirmationToken },
    });
    expect(confirmed.error?.code).toBe('storage.write_failed');

    const replayed = await client.request({
      id: 'replayed',
      kind: 'request',
      type: 'workspace.create',
      payload,
      meta: { callerSurface: 'mcp', confirmationToken: preview.confirmationToken },
    });
    expect(replayed.error).toMatchObject({
      code: 'approval.required',
      detail: { reason: 'unknown-token' },
    });

    const desktop = await client.request({
      id: 'desktop',
      kind: 'request',
      type: 'workspace.create',
      payload: { name: 'Desktop project' },
      meta: { callerSurface: 'desktop' },
    });
    expect(desktop.error?.code).toBe('storage.write_failed');
    expect(desktop.payload).not.toMatchObject({ status: 'confirmation_required' });
  });
});
