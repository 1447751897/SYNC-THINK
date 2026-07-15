import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { ErrorCode, type AppError } from '@sync-think/shared';
import {
  computeClientProof,
  computeRuntimeProof,
  decodeFrames,
  DEFAULT_DEV_INSTALL_ID,
  encodeFrame,
  pipePathPortable,
  verifyClientHello,
  verifyHmac,
  type Feature,
  type Frame,
  type Hello,
  type HelloProofPayload,
  type HelloResult,
} from '@sync-think/protocol';

// createPipeServer: listens on the named pipe and refuses clients whose Hello
// fails verification. Per design §19: transport accessible only to the current
// OS user; installation identity validated.

export interface PipeServerHandlers {
  expectedInstallId: string;
  expectedSecret?: string;
  allowNoToken?: boolean;
  onReady: (address: string) => void;
  onClientHello: (socket: Socket, hello: Hello, result: HelloResult) => void;
  onClientGone: (socket: Socket) => void;
  onFrame: (socket: Socket, frame: Frame) => void;
  onServerError?: (err: Error) => void;
}

const HELLO_TIMEOUT_MS = 10_000;

const AUTHENTICATION_FAILED: AppError = {
  code: ErrorCode.PROTOCOL_AUTH_REJECTED,
  message: 'authentication failed',
};

interface PendingChallenge {
  hello: Hello;
  clientNonce: string;
  runtimeNonce: string;
  installId: string;
  agreedFeatures: Feature[];
}

function isHelloProofPayload(payload: unknown): payload is HelloProofPayload {
  if (!payload || typeof payload !== 'object') return false;
  const proof = payload as Partial<HelloProofPayload>;
  return (
    typeof proof.installId === 'string' &&
    typeof proof.clientNonce === 'string' &&
    typeof proof.runtimeNonce === 'string' &&
    typeof proof.token === 'string'
  );
}

export interface PipeServer extends Server {
  destroyConnections(): void;
}

export function createPipeServer(
  handlers: PipeServerHandlers,
  installId: string = DEFAULT_DEV_INSTALL_ID,
): PipeServer {
  void pipePathPortable(installId);
  const authenticatedSockets = new WeakSet<Socket>();
  const buffers = new WeakMap<Socket, Buffer>();
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    const runtimeNonce = randomBytes(16).toString('hex');
    let pendingChallenge: PendingChallenge | null = null;
    let helloTimer: NodeJS.Timeout | null = null;
    let connectionCleaned = false;

    const clearHandshakeState = (): void => {
      pendingChallenge = null;
      if (!helloTimer) return;
      clearTimeout(helloTimer);
      helloTimer = null;
    };

    const rejectAuthentication = (frame: Frame, error: AppError = AUTHENTICATION_FAILED): void => {
      clearHandshakeState();
      socket.end(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: {}, error }),
        () => socket.destroy(),
      );
    };

    const cleanupConnection = (): void => {
      if (connectionCleaned) return;
      connectionCleaned = true;
      clearHandshakeState();
      authenticatedSockets.delete(socket);
      buffers.delete(socket);
      sockets.delete(socket);
      handlers.onClientGone(socket);
    };

    // The timeout covers both token-mode handshake stages.
    helloTimer = setTimeout(() => {
      if (authenticatedSockets.has(socket)) return;
      clearHandshakeState();
      socket.destroy();
    }, HELLO_TIMEOUT_MS);

    socket.on('data', (chunk: Buffer) => {
      const prev = buffers.get(socket) ?? Buffer.alloc(0);
      try {
        const decoded = decodeFrames(prev.length === 0 ? chunk : Buffer.concat([prev, chunk]));
        buffers.set(socket, decoded.remaining);
        for (const frame of decoded.frames) {
          if (authenticatedSockets.has(socket)) {
            handlers.onFrame(socket, frame);
            continue;
          }

          if (frame.type === '__hello' && !pendingChallenge && frame.kind === 'request') {
            const hello = frame.payload as Hello;
            const result = verifyClientHello(hello, {
              expectedInstallId: handlers.expectedInstallId,
              expectedSecret: handlers.expectedSecret,
              allowNoToken: handlers.allowNoToken,
            });
            if (!result.ok) {
              handlers.onClientHello(socket, hello, result);
              rejectAuthentication(frame, result.error);
              return;
            }

            if (!handlers.allowNoToken) {
              const secret = handlers.expectedSecret;
              if (!secret) {
                rejectAuthentication(frame);
                return;
              }
              pendingChallenge = {
                hello,
                clientNonce: hello.nonce,
                runtimeNonce,
                installId: hello.installId,
                agreedFeatures: result.agreedFeatures,
              };
              socket.write(
                encodeFrame({
                  id: frame.id,
                  kind: 'response',
                  type: '__hello',
                  payload: {
                    challenge: true,
                    runtimeNonce,
                    runtimeToken: computeRuntimeProof(
                      secret,
                      hello.nonce,
                      runtimeNonce,
                      hello.installId,
                    ),
                    agreedFeatures: result.agreedFeatures,
                  },
                }),
              );
              continue;
            }

            authenticatedSockets.add(socket);
            clearHandshakeState();
            handlers.onClientHello(socket, hello, result);
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true, agreedFeatures: result.agreedFeatures },
              }),
            );
            continue;
          }

          if (
            frame.type === '__hello.proof' &&
            frame.kind === 'request' &&
            pendingChallenge &&
            isHelloProofPayload(frame.payload)
          ) {
            const proof = frame.payload;
            const secret = handlers.expectedSecret;
            if (!secret) {
              rejectAuthentication(frame);
              return;
            }
            const expectedProof = computeClientProof(
              secret,
              pendingChallenge.clientNonce,
              pendingChallenge.runtimeNonce,
              pendingChallenge.installId,
            );
            if (
              proof.installId !== pendingChallenge.installId ||
              proof.clientNonce !== pendingChallenge.clientNonce ||
              proof.runtimeNonce !== pendingChallenge.runtimeNonce ||
              !verifyHmac(expectedProof, proof.token)
            ) {
              rejectAuthentication(frame);
              return;
            }

            const acceptedChallenge = pendingChallenge;
            const agreedFeatures = acceptedChallenge.agreedFeatures;
            authenticatedSockets.add(socket);
            clearHandshakeState();
            handlers.onClientHello(socket, acceptedChallenge.hello, {
              ok: true,
              agreedFeatures,
            });
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello.proof',
                payload: { ok: true, agreedFeatures },
              }),
            );
            continue;
          }

          rejectAuthentication(frame);
          return;
        }
      } catch {
        clearHandshakeState();
        socket.destroy();
      }
    });

    socket.on('close', cleanupConnection);
    socket.on('error', cleanupConnection);
  }) as PipeServer;

  server.destroyConnections = () => {
    for (const socket of sockets) socket.destroy();
  };

  server.on('error', (err) => handlers.onServerError?.(err));
  return server;
}
