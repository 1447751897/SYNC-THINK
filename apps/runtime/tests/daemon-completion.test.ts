import { afterEach, describe, expect, it } from 'vitest';
import { createPipeServer } from '../src/pipe/server.js';
import {
  sendAbortToDaemon,
  sendTaskCompletionToDaemon,
} from '../src/daemon/dispatch-client.js';
import { daemonPipePath } from '../src/daemon/yield.js';

const installId = `daemon-completion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const secret = 'completion-test-secret';
const servers: Array<ReturnType<typeof createPipeServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.destroyConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

async function startDaemon(received: unknown[]): Promise<void> {
  const server = createPipeServer(
    {
      expectedInstallId: installId,
      expectedSecret: secret,
      allowNoToken: false,
      onReady: () => {},
      onClientHello: () => {},
      onClientGone: () => {},
      onFrame: (_socket, frame) => received.push(frame),
    },
    installId,
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(daemonPipePath(installId), resolve));
}

describe('daemon completion/abort sender', () => {
  it('flushes a completion frame before closing the daemon connection', async () => {
    const received: unknown[] = [];
    await startDaemon(received);
    await expect(
      sendTaskCompletionToDaemon(
        { installId, helloSecret: secret, appVersion: 'test', handshakeTimeoutMs: 500 },
        { taskId: 'task-1', runId: 'run-1', status: 'success' },
      ),
    ).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'task.dispatch.complete' }),
      ]),
    );
  });

  it('flushes every abort frame and reports false when daemon is absent', async () => {
    const received: unknown[] = [];
    await startDaemon(received);
    await expect(
      sendAbortToDaemon(
        { installId, helloSecret: secret, appVersion: 'test', handshakeTimeoutMs: 500 },
        ['task-a', 'task-b'],
      ),
    ).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received.filter((frame) => (frame as { type?: string }).type === 'task.abort')).toHaveLength(2);

    const absent = await sendAbortToDaemon(
      { installId: `${installId}-absent`, helloSecret: secret, appVersion: 'test', handshakeTimeoutMs: 100 },
      ['task-a'],
    );
    expect(absent).toBe(false);
  });
});
