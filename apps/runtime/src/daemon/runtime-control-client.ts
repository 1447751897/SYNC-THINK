import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import {
  computeClientProof,
  computeHmac,
  computeRuntimeProof,
  decodeFrames,
  DEFAULT_FEATURES,
  encodeFrame,
  pipePathPortable,
  PROTOCOL_VERSION,
  verifyHmac,
  type Frame,
  type Hello,
  type HelloProofPayload,
} from '@sync-think/protocol';

export interface RuntimeControlOptions {
  installId: string;
  helloSecret?: string;
  appVersion: string;
  timeoutMs?: number;
}

/** Authenticated Runtime shutdown request used when no private child IPC is available. */
export function requestRuntimeShutdown(options: RuntimeControlOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  return new Promise((resolve) => {
    let settled = false;
    let authenticated = false;
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let helloPhase: 'hello' | 'proof' | 'done' = 'hello';
    let clientNonce = '';
    const requestId = `runtime-shutdown-${randomBytes(8).toString('hex')}`;
    const socket = connect(pipePathPortable(options.installId));
    socket.setNoDelay(true);

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!socket.destroyed) socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    const sendShutdown = (): void => {
      socket.write(
        encodeFrame({
          id: requestId,
          kind: 'request',
          type: 'runtime.shutdown',
          payload: {},
        }),
      );
    };

    const handleFrame = (frame: Frame): void => {
      if (!authenticated) {
        if (helloPhase === 'hello' && frame.type === '__hello') {
          const payload = frame.payload as {
            challenge?: boolean;
            ok?: boolean;
            runtimeNonce?: string;
            runtimeToken?: string;
          };
          if (payload.ok === true) {
            authenticated = true;
            helloPhase = 'done';
            sendShutdown();
            return;
          }
          if (
            payload.challenge !== true ||
            typeof payload.runtimeNonce !== 'string' ||
            typeof payload.runtimeToken !== 'string' ||
            !options.helloSecret
          ) {
            finish(false);
            return;
          }
          const expected = computeRuntimeProof(
            options.helloSecret,
            clientNonce,
            payload.runtimeNonce,
            options.installId,
          );
          if (!verifyHmac(expected, payload.runtimeToken)) {
            finish(false);
            return;
          }
          helloPhase = 'proof';
          const proof: HelloProofPayload = {
            installId: options.installId,
            clientNonce,
            runtimeNonce: payload.runtimeNonce,
            token: computeClientProof(
              options.helloSecret,
              clientNonce,
              payload.runtimeNonce,
              options.installId,
            ),
          };
          socket.write(
            encodeFrame({
              id: 'runtime-shutdown-proof',
              kind: 'request',
              type: '__hello.proof',
              payload: proof,
            }),
          );
          return;
        }
        if (helloPhase === 'proof' && frame.type === '__hello.proof') {
          const payload = frame.payload as { ok?: unknown };
          if (payload.ok !== true) {
            finish(false);
            return;
          }
          authenticated = true;
          helloPhase = 'done';
          sendShutdown();
        }
        return;
      }

      if (frame.id === requestId && frame.type === 'runtime.shutdown') {
        finish((frame.payload as { accepted?: unknown } | undefined)?.accepted === true);
      }
    };

    socket.on('data', (chunk: Buffer) => {
      try {
        const decoded = decodeFrames(buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]));
        buffer = decoded.remaining;
        for (const frame of decoded.frames) handleFrame(frame);
      } catch {
        finish(false);
      }
    });
    socket.once('connect', () => {
      clientNonce = randomBytes(16).toString('hex');
      const hello: Hello = {
        protocolVersion: PROTOCOL_VERSION,
        appVersion: options.appVersion,
        installId: options.installId,
        nonce: clientNonce,
        features: [...DEFAULT_FEATURES],
      };
      if (options.helloSecret) {
        hello.token = computeHmac(options.helloSecret, clientNonce, options.installId);
      }
      socket.write(
        encodeFrame({
          id: 'runtime-shutdown-hello',
          kind: 'request',
          type: '__hello',
          payload: hello,
        }),
      );
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}
