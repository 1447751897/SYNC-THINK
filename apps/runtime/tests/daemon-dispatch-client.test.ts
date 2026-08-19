import { afterEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import {
  computeClientProof,
  computeHmac,
  computeRuntimeProof,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  verifyHmac,
  type Frame,
  type Hello,
} from '@sync-think/protocol';
import { createPipeServer, type PipeServerHandlers } from '../src/pipe/server.js';
import {
  dispatchTaskToDesktop,
  type DispatchClientOptions,
} from '../src/daemon/dispatch-client.js';
import type { DispatchPayload } from '../src/daemon/protocol.js';

const SECRET = 'test-secret';
const INSTALL_ID = 'dev-dispatch-test';
const APP_VERSION = 'test';

// ── 假桌面：真 createPipeServer + 握手，模拟桌面 runtime 管道 ──────────────

interface FakeDesktop {
  server: ReturnType<typeof createPipeServer>;
  path: string;
  received: Frame[];
  replyAck: boolean;
  close(): Promise<void>;
}

async function startFakeDesktop(options: { replyAck?: boolean; delayAckMs?: number } = {}): Promise<FakeDesktop> {
  const received: Frame[] = [];
  const server = createPipeServer({
    expectedInstallId: INSTALL_ID,
    expectedSecret: SECRET,
    allowNoToken: false,
    onReady: () => {},
    onClientHello: () => {},
    onClientGone: () => {},
    onFrame: (socket, frame) => {
      received.push(frame);
      if (frame.type === 'task.dispatch' && options.replyAck !== false) {
        const reply = () =>
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'task.dispatch.ack',
              payload: { taskId: (frame.payload as DispatchPayload).taskId, accepted: true },
            }),
          );
        if (options.delayAckMs) setTimeout(reply, options.delayAckMs);
        else reply();
      }
    },
  }, INSTALL_ID);
  const path = pipePathPortable(INSTALL_ID);
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  return {
    server,
    path,
    received,
    replyAck: options.replyAck !== false,
    close: () =>
      new Promise<void>((resolve) => {
        server.destroyConnections?.();
        server.close(() => resolve());
      }),
  };
}

const payload: DispatchPayload = {
  taskId: 't_1',
  instruction: '执行巡检',
  target: { kind: 'model', modelId: 'm-1' },
  skillVersionIds: [],
};

function clientOptions(): DispatchClientOptions {
  return {
    installId: INSTALL_ID,
    helloSecret: SECRET,
    appVersion: APP_VERSION,
    timeoutMs: 2_000,
  };
}

const servers: FakeDesktop[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('dispatchTaskToDesktop (Seam 2/3 集成)', () => {
  it('handshakes and dispatches, receiving an ack from the desktop', async () => {
    const desktop = await startFakeDesktop();
    servers.push(desktop);
    const result = await dispatchTaskToDesktop(clientOptions(), payload);
    expect(result.ok).toBe(true);
    expect(result.acked).toBe(true);
    expect(desktop.received.some((f) => f.type === 'task.dispatch')).toBe(true);
  });

  it('resolves unacked when the desktop does not reply (dispatch timeout)', async () => {
    const desktop = await startFakeDesktop({ replyAck: false });
    servers.push(desktop);
    const result = await dispatchTaskToDesktop(clientOptions(), payload);
    expect(result.ok).toBe(true);
    expect(result.acked).toBe(false);
  });

  it('fails when the desktop pipe is not listening (desktop closed)', async () => {
    const result = await dispatchTaskToDesktop(clientOptions(), payload);
    expect(result.ok).toBe(false);
  });

  it('fails when the secret does not match (auth rejected)', async () => {
    const desktop = await startFakeDesktop();
    servers.push(desktop);
    const result = await dispatchTaskToDesktop(
      { ...clientOptions(), helloSecret: 'wrong-secret' },
      payload,
    );
    expect(result.ok).toBe(false);
  });
});
