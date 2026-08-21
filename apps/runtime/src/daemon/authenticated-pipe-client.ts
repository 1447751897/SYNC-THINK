import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import {
  computeClientProof,
  computeHmac,
  computeRuntimeProof,
  decodeFrames,
  DEFAULT_FEATURES,
  encodeFrame,
  PROTOCOL_VERSION,
  verifyHmac,
  type Frame,
  type Hello,
  type HelloProofPayload,
} from '@sync-think/protocol';

export interface AuthenticatedPipeOptions {
  path: string;
  installId: string;
  helloSecret?: string;
  appVersion: string;
  handshakeTimeoutMs?: number;
  timeoutMs?: number;
}

export interface AuthenticatedRequestResult {
  ok: boolean;
  outcome: 'response' | 'timeout' | 'unreachable';
  frame?: Frame;
}

function accepted(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true);
}

function challenge(payload: unknown): payload is {
  challenge: true;
  runtimeNonce: string;
  runtimeToken: string;
} {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload as Record<string, unknown>;
  return (
    raw.challenge === true &&
    typeof raw.runtimeNonce === 'string' &&
    typeof raw.runtimeToken === 'string'
  );
}

function openAuthenticatedPipe(
  options: AuthenticatedPipeOptions,
  onAuthenticated: (socket: import('node:net').Socket) => void,
  onFrame: (frame: Frame) => void,
  finish: (ok: boolean) => void,
): import('node:net').Socket {
  const socket = connect(options.path);
  socket.setNoDelay(true);
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let phase: 'hello' | 'proof' | 'done' = 'hello';
  let nonce = '';
  const handshakeTimer = setTimeout(
    () => finish(false),
    options.handshakeTimeoutMs ?? 5_000,
  );

  const authenticate = (): void => {
    if (phase === 'done') return;
    phase = 'done';
    clearTimeout(handshakeTimer);
    onAuthenticated(socket);
  };

  socket.on('connect', () => {
    nonce = randomBytes(16).toString('hex');
    const hello: Hello = {
      protocolVersion: PROTOCOL_VERSION,
      appVersion: options.appVersion,
      installId: options.installId,
      nonce,
      features: [...DEFAULT_FEATURES],
    };
    if (options.helloSecret) hello.token = computeHmac(options.helloSecret, nonce, options.installId);
    socket.write(encodeFrame({ id: 'hello', kind: 'request', type: '__hello', payload: hello }));
  });
  socket.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]));
      buffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (phase === 'done') {
          onFrame(frame);
          continue;
        }
        if (phase === 'hello' && frame.type === '__hello') {
          if (accepted(frame.payload)) {
            authenticate();
            continue;
          }
          if (!challenge(frame.payload) || !options.helloSecret) {
            finish(false);
            continue;
          }
          const expected = computeRuntimeProof(
            options.helloSecret,
            nonce,
            frame.payload.runtimeNonce,
            options.installId,
          );
          if (!verifyHmac(expected, frame.payload.runtimeToken)) {
            finish(false);
            continue;
          }
          phase = 'proof';
          const proof: HelloProofPayload = {
            installId: options.installId,
            clientNonce: nonce,
            runtimeNonce: frame.payload.runtimeNonce,
            token: computeClientProof(
              options.helloSecret,
              nonce,
              frame.payload.runtimeNonce,
              options.installId,
            ),
          };
          socket.write(
            encodeFrame({ id: 'hello-proof', kind: 'request', type: '__hello.proof', payload: proof }),
          );
          continue;
        }
        if (phase === 'proof' && frame.type === '__hello.proof') {
          if (accepted(frame.payload)) authenticate();
          else finish(false);
        }
      }
    } catch {
      finish(false);
    }
  });
  socket.on('error', () => finish(false));
  return socket;
}

export function requestAuthenticatedPipe(
  options: AuthenticatedPipeOptions,
  request: Frame,
  acceptsResponse: (frame: Frame) => boolean,
): Promise<AuthenticatedRequestResult> {
  return new Promise((resolve) => {
    let settled = false;
    let responseTimer: NodeJS.Timeout | undefined;
    const finish = (result: AuthenticatedRequestResult): void => {
      if (settled) return;
      settled = true;
      if (responseTimer) clearTimeout(responseTimer);
      if (socket && !socket.destroyed) socket.destroy();
      resolve(result);
    };
    const socket = openAuthenticatedPipe(
      options,
      (authenticatedSocket) => {
        responseTimer = setTimeout(
          () => finish({ ok: false, outcome: 'timeout' }),
          options.timeoutMs ?? 30_000,
        );
        authenticatedSocket.write(encodeFrame(request));
      },
      (frame) => {
        if (acceptsResponse(frame)) finish({ ok: true, outcome: 'response', frame });
      },
      () => finish({ ok: false, outcome: 'unreachable' }),
    );
    socket.on('close', () => finish({ ok: false, outcome: 'unreachable' }));
  });
}

export function sendAuthenticatedPipeFrames(
  options: AuthenticatedPipeOptions,
  frames: readonly Frame[],
): Promise<boolean> {
  if (frames.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const totalTimer = setTimeout(
      () => finish(false),
      (options.handshakeTimeoutMs ?? 5_000) + (options.timeoutMs ?? 2_000),
    );
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      if (socket && !socket.destroyed) socket.destroy();
      resolve(ok);
    };
    const socket = openAuthenticatedPipe(
      options,
      (authenticatedSocket) => {
        for (const frame of frames) authenticatedSocket.write(encodeFrame(frame));
        authenticatedSocket.end(() => finish(true));
      },
      () => {},
      () => finish(false),
    );
    socket.on('close', () => {
      if (!settled) finish(false);
    });
  });
}
