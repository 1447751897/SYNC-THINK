import { afterEach, describe, expect, it } from 'vitest';
import { createPipeServer } from '../src/pipe/server.js';
import { requestRuntimeShutdown } from '../src/daemon/runtime-control-client.js';
import { pipePathPortable, encodeFrame } from '@sync-think/protocol';

const servers: Array<ReturnType<typeof createPipeServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.destroyConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('requestRuntimeShutdown', () => {
  it('authenticates, requests shutdown, and accepts the Runtime acknowledgement', async () => {
    const installId = `runtime-control-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const server = createPipeServer(
      {
        expectedInstallId: installId,
        allowNoToken: true,
        onReady: () => undefined,
        onClientHello: () => undefined,
        onClientGone: () => undefined,
        onFrame: (socket, frame) => {
          if (frame.type !== 'runtime.shutdown') return;
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'runtime.shutdown',
              payload: { accepted: true },
            }),
          );
        },
      },
      installId,
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(pipePathPortable(installId), resolve));

    await expect(
      requestRuntimeShutdown({ installId, appVersion: 'daemon-test', timeoutMs: 2_000 }),
    ).resolves.toBe(true);
  });
});
