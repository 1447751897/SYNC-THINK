/**
 * 投递客户端（spec T7）：守护进程 → 桌面 runtime 的任务投递。
 *
 * 链路：connect 桌面 runtime 管道（pipePathPortable(installId)）→ HMAC
 * 握手（与 desktop runtime-client 同款协议：__hello → challenge → __hello.proof）
 * → 发 task.dispatch → 等 task.dispatch.ack（超时阈值内）。
 *
 * 结果语义：
 *   { ok: true, acked: true }   桌面已确认接收（正在执行）
 *   { ok: true, acked: false }  投递已发出但超时无 ack（桌面假死，T8 接管）
 *   { ok: false }               连接失败 / 握手失败（桌面未运行，降级自拉）
 */

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
import { encodeDispatchFrame, type DispatchPayload } from './protocol.js';

export interface DispatchClientOptions {
  installId: string;
  helloSecret?: string;
  appVersion: string;
  /** 等 ack 超时（毫秒，默认 30_000——spec Q15）。 */
  timeoutMs?: number;
  /** 握手超时（毫秒，默认 5_000）。 */
  handshakeTimeoutMs?: number;
}

export interface DispatchResult {
  ok: boolean;
  acked: boolean;
}

function isChallenge(payload: unknown): payload is {
  challenge: true;
  runtimeNonce: string;
  runtimeToken: string;
  agreedFeatures: string[];
} {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    p.challenge === true &&
    typeof p.runtimeNonce === 'string' &&
    typeof p.runtimeToken === 'string' &&
    Array.isArray(p.agreedFeatures)
  );
}

function isAccepted(payload: unknown): payload is { ok: true } {
  return Boolean(payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true);
}

/**
 * 投递一个任务到桌面 runtime。内部新建连接（握手 + dispatch + ack
 * 一次完成），无论结果如何都会关闭连接。
 */
export async function dispatchTaskToDesktop(
  options: DispatchClientOptions,
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: DispatchResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = connect(pipePathPortable(options.installId));
    socket.setNoDelay(true);
    let buffer: Buffer = Buffer.alloc(0);
    let authenticated = false;
    let ackTimer: NodeJS.Timeout | null = null;

    // 握手状态机。
    let helloPhase: 'hello' | 'proof' | 'done' = 'hello';
    let helloNonce = '';
    let helloResolve: ((ok: boolean) => void) | null = null;
    let helloTimer: NodeJS.Timeout | null = null;

    const handleFrame = (frame: Frame): void => {
      if (!authenticated) {
        handleHelloFrame(frame);
        return;
      }
      if (frame.type === 'task.dispatch.ack') {
        if (ackTimer) clearTimeout(ackTimer);
        done({ ok: true, acked: Boolean((frame.payload as { accepted?: boolean }).accepted) });
        socket.end();
      }
    };

    const handleHelloFrame = (frame: Frame): void => {
      if (helloPhase === 'hello' && frame.type === '__hello') {
        const payload = frame.payload as { challenge?: boolean; ok?: boolean; runtimeNonce?: string; runtimeToken?: string };
        if (isAccepted(payload)) {
          helloPhase = 'done';
          authenticated = true;
          helloResolve?.(true);
          return;
        }
        if (!isChallenge(payload) || !options.helloSecret) {
          helloPhase = 'done';
          helloResolve?.(false);
          return;
        }
        const expectedRuntimeProof = computeRuntimeProof(
          options.helloSecret,
          helloNonce,
          payload.runtimeNonce,
          options.installId,
        );
        if (!verifyHmac(expectedRuntimeProof, payload.runtimeToken)) {
          helloPhase = 'done';
          helloResolve?.(false);
          return;
        }
        helloPhase = 'proof';
        const proof: HelloProofPayload = {
          installId: options.installId,
          clientNonce: helloNonce,
          runtimeNonce: payload.runtimeNonce,
          token: computeClientProof(
            options.helloSecret,
            helloNonce,
            payload.runtimeNonce,
            options.installId,
          ),
        };
        socket.write(encodeFrame({ id: 'hello-proof', kind: 'request', type: '__hello.proof', payload: proof }));
        return;
      }
      if (helloPhase === 'proof' && frame.type === '__hello.proof') {
        if (isAccepted(frame.payload)) {
          helloPhase = 'done';
          authenticated = true;
          helloResolve?.(true);
          return;
        }
        helloPhase = 'done';
        helloResolve?.(false);
      }
    };

    socket.on('data', (chunk: Buffer) => {
      const prev = buffer;
      try {
        const decoded = decodeFrames(prev.length === 0 ? chunk : Buffer.concat([prev, chunk]));
        buffer = decoded.remaining;
        for (const frame of decoded.frames) handleFrame(frame);
      } catch {
        socket.destroy();
        done({ ok: false, acked: false });
      }
    });

    socket.on('connect', () => {
      // 1. 握手（带超时）。
      const helloOk = new Promise<boolean>((resolve) => {
        helloResolve = resolve;
        helloNonce = randomBytes(16).toString('hex');
        const hello: Hello = {
          protocolVersion: PROTOCOL_VERSION,
          appVersion: options.appVersion,
          installId: options.installId,
          nonce: helloNonce,
          features: [...DEFAULT_FEATURES],
        };
        if (options.helloSecret) {
          hello.token = computeHmac(options.helloSecret, helloNonce, options.installId);
        }
        socket.write(encodeFrame({ id: 'hello', kind: 'request', type: '__hello', payload: hello }));
        helloTimer = setTimeout(() => {
          if (helloPhase !== 'done') {
            helloPhase = 'done';
            resolve(false);
          }
        }, handshakeTimeoutMs);
      });
      void helloOk.then((ok) => {
        if (!ok) {
          socket.end();
          done({ ok: false, acked: false });
          return;
        }
        // 2. dispatch + 等 ack（超时 → acked=false）。
        ackTimer = setTimeout(() => {
          done({ ok: true, acked: false });
          socket.end();
        }, timeoutMs);
        socket.write(encodeFrame(encodeDispatchFrame(payload)));
      });
    });

    socket.on('error', () => done({ ok: false, acked: false }));
    socket.on('close', () => {
      if (ackTimer) clearTimeout(ackTimer);
      if (helloTimer) clearTimeout(helloTimer);
      done({ ok: false, acked: false });
    });
  });
}
