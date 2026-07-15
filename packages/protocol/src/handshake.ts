import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorCode, type AppError } from '@sync-think/shared';
import {
  PROTOCOL_VERSION,
  type Feature,
  DEFAULT_FEATURES,
  isVersionCompatible,
} from './version.js';

// Handshake (TD-006 §4-6). Both sides exchange Hello over the authenticated pipe.

export interface Hello {
  protocolVersion: number;
  appVersion: string;
  installId: string;
  /** Random per-session nonce; combined with install-shared secret for HMAC. */
  nonce: string;
  features: Feature[];
  /** HMAC-SHA256( installSecret, nonce || installId ). Dev mode may omit. */
  token?: string;
}

export interface HelloChallengePayload {
  challenge: true;
  runtimeNonce: string;
  runtimeToken: string;
  agreedFeatures: Feature[];
}

export interface HelloProofPayload {
  installId: string;
  clientNonce: string;
  runtimeNonce: string;
  token: string;
}

export interface HelloAcceptedPayload {
  ok: true;
  agreedFeatures: Feature[];
}

export type HelloResult =
  { ok: true; agreedFeatures: Feature[]; runtimeHello?: Hello } | { ok: false; error: AppError };

export function verifyClientHello(
  clientHello: Hello,
  opts: {
    expectedInstallId: string;
    expectedSecret?: string;
    allowNoToken?: boolean;
    runtimeHello?: Hello;
  },
): HelloResult {
  if (!isVersionCompatible(clientHello.protocolVersion, PROTOCOL_VERSION)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.PROTOCOL_VERSION_MISMATCH,
        message: `UI protocol ${clientHello.protocolVersion} vs runtime ${PROTOCOL_VERSION}`,
        detail: { ui: clientHello.protocolVersion, runtime: PROTOCOL_VERSION },
      },
    };
  }
  if (clientHello.installId !== opts.expectedInstallId) {
    return {
      ok: false,
      error: { code: ErrorCode.PROTOCOL_AUTH_REJECTED, message: 'install id mismatch' },
    };
  }
  const tokenExpected = !opts.allowNoToken;
  if (tokenExpected && !clientHello.token) {
    return {
      ok: false,
      error: { code: ErrorCode.PROTOCOL_AUTH_REJECTED, message: 'missing auth token' },
    };
  }
  if (tokenExpected && !opts.expectedSecret) {
    return {
      ok: false,
      error: {
        code: ErrorCode.PROTOCOL_AUTH_REJECTED,
        message: 'runtime authentication is not configured',
      },
    };
  }
  if (tokenExpected && opts.expectedSecret && clientHello.token) {
    const expected = computeHmac(opts.expectedSecret, clientHello.nonce, clientHello.installId);
    if (!verifyHmac(expected, clientHello.token)) {
      return {
        ok: false,
        error: { code: ErrorCode.PROTOCOL_AUTH_REJECTED, message: 'token mismatch' },
      };
    }
  }
  const agreed = intersectFeatures(
    clientHello.features,
    opts.runtimeHello?.features ?? DEFAULT_FEATURES,
  );
  return { ok: true, agreedFeatures: agreed, runtimeHello: opts.runtimeHello };
}

export function intersectFeatures(a: Feature[], b: Feature[]): Feature[] {
  const mb = new Set(b);
  return a.filter((f) => mb.has(f));
}

export function computeHmac(secret: string, nonce: string, installId: string): string {
  return createHmac('sha256', secret).update(`${nonce}${installId}`).digest('hex');
}

export function computeRuntimeProof(
  secret: string,
  clientNonce: string,
  runtimeNonce: string,
  installId: string,
): string {
  return createHmac('sha256', secret)
    .update(`runtime-proof\0${clientNonce}\0${runtimeNonce}\0${installId}`)
    .digest('hex');
}

export function computeClientProof(
  secret: string,
  clientNonce: string,
  runtimeNonce: string,
  installId: string,
): string {
  return createHmac('sha256', secret)
    .update(`client-proof\0${clientNonce}\0${runtimeNonce}\0${installId}`)
    .digest('hex');
}

export function verifyHmac(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
