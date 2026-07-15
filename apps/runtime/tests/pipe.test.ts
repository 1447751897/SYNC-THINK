import { describe, it, expect } from 'vitest';
import { connect } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import {
  computeHmac,
  encodeFrame,
  MAX_FRAME_BYTES,
  pipePathPortable,
} from '@sync-think/protocol';
import { createPipeServer, type PipeServerHandlers } from '../src/pipe/server.js';
import { ulidWrapper as _u } from './pipe-helpers.js';

function clientProof(
  secret: string,
  clientNonce: string,
  runtimeNonce: string,
  installId: string,
): string {
  return createHmac('sha256', secret)
    .update(`client-proof\0${clientNonce}\0${runtimeNonce}\0${installId}`)
    .digest('hex');
}

async function startServer(handlers: PipeServerHandlers, installId: string): Promise<{ server: ReturnType<typeof createPipeServer>; path: string }> {
  return new Promise((resolve, reject) => {
    const server = createPipeServer(handlers, installId);
    const path = pipePathPortable(installId);
    server.listen(path, () => resolve({ server, path }));
    server.on('error', reject);
  });
}

async function writeAndRead(socket: import('node:net').Socket, frame: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.write(encodeFrame(frame as never));
    socket.once('data', (b) => {
      try {
        const len = b.readUInt32BE(0);
        const json = b.subarray(4, 4 + len).toString('utf8');
        resolve(JSON.parse(json));
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe('named pipe handshake', () => {
  it('closes a client that declares an oversized frame before buffering its body', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { server } = await startServer(
      {
        expectedInstallId: installId,
        allowNoToken: true,
        onReady: () => {},
        onClientHello: () => {},
        onClientGone: () => {},
        onFrame: () => {},
      },
      installId,
    );
    const socket = connect(pipePathPortable(installId));

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const oversizedHeader = Buffer.alloc(4);
      oversizedHeader.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
      const closed = new Promise<boolean>((resolve) => {
        socket.once('close', () => resolve(true));
        setTimeout(() => resolve(false), 250);
      });
      socket.write(oversizedHeader);
      await expect(closed).resolves.toBe(true);
    } finally {
      socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('accepts a hello with the right installId when allowNoToken is set', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const helloEvents: string[] = [];
    const { server } = await startServer(
      {
        expectedInstallId: installId,
        allowNoToken: true,
        onReady: () => helloEvents.push('ready'),
        onClientHello: (_s, _hello, result) => helloEvents.push(result.ok ? 'ok' : 'denied'),
        onClientGone: () => {},
        onFrame: () => {},
      },
      installId,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const sock = connect(pipePathPortable(installId), async () => {
          try {
            const resp = (await writeAndRead(sock, {
              id: 'h1',
              kind: 'request',
              type: '__hello',
              payload: {
                protocolVersion: 2,
                appVersion: '0.0.1',
                installId,
                nonce: randomBytes(8).toString('hex'),
                features: ['task.appendMessage', 'runtime.healthcheck'],
              },
            })) as { type?: string; payload?: unknown; error?: unknown };
            expect(resp.payload).toMatchObject({ ok: true });
            expect(resp.error).toBeUndefined();
            sock.destroy();
            resolve();
          } catch (e) {
            sock.destroy();
            reject(e);
          }
        });
        sock.on('error', reject);
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8_000);

  it('rejects a foreign client that omits the required token', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { server } = await startServer(
      {
        expectedInstallId: installId,
        expectedSecret: 'install-secret',
        onReady: () => {},
        onClientHello: () => {},
        onClientGone: () => {},
        onFrame: () => {},
      },
      installId,
    );
    const socket = connect(pipePathPortable(installId));

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const response = (await writeAndRead(socket, {
        id: 'foreign-no-token',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['runtime.healthcheck'],
        },
      })) as { error?: { code?: string } };
      expect(response.error).toMatchObject({ code: 'protocol.auth_rejected' });
    } finally {
      socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a captured hello and proof when the Runtime issues a new challenge', async () => {
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secret = 'install-secret';
    const helloResults: string[] = [];
    const { server } = await startServer(
      {
        expectedInstallId: installId,
        expectedSecret: secret,
        onReady: () => {},
        onClientHello: (_socket, _hello, result) => {
          helloResults.push(result.ok ? 'accepted' : 'rejected');
        },
        onClientGone: () => {},
        onFrame: () => {},
      },
      installId,
    );
    const hello = {
      id: 'captured-hello',
      kind: 'request' as const,
      type: '__hello',
      payload: {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: 'captured-client-nonce',
        features: ['runtime.healthcheck'],
        token: computeHmac(secret, 'captured-client-nonce', installId),
      },
    };

    const first = connect(pipePathPortable(installId));
    try {
      await new Promise<void>((resolve, reject) => {
        first.once('connect', resolve);
        first.once('error', reject);
      });
      const firstChallengeFrame = (await writeAndRead(first, hello)) as {
        payload: { runtimeNonce?: string };
      };
      expect(typeof firstChallengeFrame.payload.runtimeNonce).toBe('string');
      expect(helloResults).toEqual([]);
      const capturedProof = {
        id: 'captured-proof',
        kind: 'request' as const,
        type: '__hello.proof',
        payload: {
          installId,
          clientNonce: hello.payload.nonce,
          runtimeNonce: firstChallengeFrame.payload.runtimeNonce!,
          token: clientProof(
            secret,
            hello.payload.nonce,
            firstChallengeFrame.payload.runtimeNonce!,
            installId,
          ),
        },
      };
      const accepted = (await writeAndRead(first, capturedProof)) as { error?: unknown };
      expect(accepted.error).toBeUndefined();
      expect(helloResults).toEqual(['accepted']);
      first.destroy();

      const second = connect(pipePathPortable(installId));
      try {
        await new Promise<void>((resolve, reject) => {
          second.once('connect', resolve);
          second.once('error', reject);
        });
        const secondChallengeFrame = (await writeAndRead(second, hello)) as {
          payload: { runtimeNonce?: string };
        };
        expect(secondChallengeFrame.payload.runtimeNonce).not.toBe(
          firstChallengeFrame.payload.runtimeNonce,
        );
        const replayed = (await writeAndRead(second, capturedProof)) as {
          error?: { code?: string };
        };
        expect(replayed.error).toMatchObject({ code: 'protocol.auth_rejected' });
        expect(helloResults).toEqual(['accepted']);
      } finally {
        second.destroy();
      }
    } finally {
      first.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
