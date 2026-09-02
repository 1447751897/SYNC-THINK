import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type {
  BrowserExtensionHostLike,
  BrowserExtensionStatus,
} from '../src/browser/browser-extension-host.js';
import { Runtime } from '../src/runtime.js';

const runtimes: Runtime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', resolveConnect);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (!waiter) continue;
      waiters.delete(frame.id);
      waiter(frame);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolveResponse) =>
        waiters.set(frame.id, resolveResponse),
      );
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

function status(state: BrowserExtensionStatus['state'] = 'connected'): BrowserExtensionStatus {
  return {
    state,
    hostAvailable: state !== 'disabled',
    connected: state === 'connected',
    installedVersion: state === 'connected' ? '1.1.4' : null,
    versionMismatch: false,
    busy: false,
    lastErrorCode: null,
    connectionInfo: state === 'disabled'
      ? null
      : { bundledVersion: '1.1.4', url: 'ws://127.0.0.1:17373/browser-extension/v1', token: 'test-token' },
  };
}

function makeHost(overrides: Partial<BrowserExtensionHostLike> = {}): BrowserExtensionHostLike {
  return {
    status: vi.fn(() => status()),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => status()),
    resetPairing: vi.fn(async () => status('disconnected')),
    openFolder: vi.fn(async () => ({ success: true, path: 'C:/extension' })),
    ...overrides,
  };
}

async function startRuntime(host?: BrowserExtensionHostLike): Promise<{
  runtime: Runtime;
  inbox: ReturnType<typeof createFrameInbox>;
  socket: Socket;
}> {
  const installId = `browser-extension-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    ...(host ? { browserExtensionHost: host } : {}),
  });
  runtimes.push(runtime);
  await runtime.start();
  const socket = await connectRuntime(installId);
  const inbox = createFrameInbox(socket);
  const hello = await inbox.send({
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: 'browser-extension-runtime',
      features: [],
    },
  });
  expect(hello.error).toBeUndefined();
  return { runtime, inbox, socket };
}

describe('Runtime Browser Extension commands', () => {
  it('routes all extension host commands over the local pipe and preserves results', async () => {
    const host = makeHost();
    const { inbox, socket } = await startRuntime(host);
    try {
      const commands = [
        ['browser.extension.status', status()],
        ['browser.extension.restart', status()],
        ['browser.extension.resetPairing', status('disconnected')],
        ['browser.extension.openFolder', { success: true, path: 'C:/extension' }],
      ] as const;
      for (const [type, expected] of commands) {
        const response = await inbox.send({
          id: type,
          kind: 'request',
          type,
          payload: {},
        });
        expect(response.error).toBeUndefined();
        expect(response.payload).toEqual(expected);
      }
      expect(host.status).toHaveBeenCalledTimes(1);
      expect(host.restart).toHaveBeenCalledTimes(1);
      expect(host.resetPairing).toHaveBeenCalledTimes(1);
      expect(host.openFolder).toHaveBeenCalledTimes(1);
      expect(host.start).toHaveBeenCalledTimes(1);
    } finally {
      socket.destroy();
    }
  });

  it('rejects non-empty command payloads and returns disabled state without a host', async () => {
    const withHost = await startRuntime(makeHost());
    try {
      for (const type of [
        'browser.extension.status',
        'browser.extension.restart',
        'browser.extension.resetPairing',
        'browser.extension.openFolder',
      ]) {
        const response = await withHost.inbox.send({
          id: `invalid-${type}`,
          kind: 'request',
          type,
          payload: { unexpected: true },
        });
        expect(response.error?.code).toBe('protocol.frame_malformed');
      }
    } finally {
      withHost.socket.destroy();
    }

    const withoutHost = await startRuntime();
    try {
      const response = await withoutHost.inbox.send({
        id: 'disabled-status',
        kind: 'request',
        type: 'browser.extension.status',
        payload: {},
      });
      expect(response.error).toBeUndefined();
      expect(response.payload).toMatchObject({
        state: 'disabled',
        hostAvailable: false,
        connected: false,
        lastErrorCode: 'host-unavailable',
      });
    } finally {
      withoutHost.socket.destroy();
    }
  });

  it('turns host exceptions into responses instead of leaving requests pending', async () => {
    const host = makeHost({
      status: vi.fn(() => {
        throw new Error('status exploded');
      }),
      restart: vi.fn(async () => {
        throw new Error('restart exploded');
      }),
    });
    const { inbox, socket } = await startRuntime(host);
    try {
      const statusResponse = await inbox.send({
        id: 'status-error',
        kind: 'request',
        type: 'browser.extension.status',
        payload: {},
      });
      expect(statusResponse.error).toMatchObject({
        code: 'storage.write_failed',
        message: 'status exploded',
      });

      const restartResponse = await inbox.send({
        id: 'restart-error',
        kind: 'request',
        type: 'browser.extension.restart',
        payload: {},
      });
      expect(restartResponse.error).toMatchObject({
        code: 'storage.write_failed',
        message: 'restart exploded',
      });
    } finally {
      socket.destroy();
    }
  });
});
