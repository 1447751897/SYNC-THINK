/**
 * PKCE (RFC 7636) helpers and the random tokens that protect the loopback
 * callback.
 *
 * Everything here is base64url without padding, which is what both RFC 7636 and
 * the `state` parameter in RFC 6749 expect on the wire.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type PkceMethod = 'S256';

export interface PkcePair {
  /** Kept in the flow record; sent only on the token request. */
  verifier: string;
  /** Sent on the authorize request. Derived, so it is safe to log. */
  challenge: string;
  method: PkceMethod;
}

/** base64url without padding. */
export function base64Url(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * RFC 7636 requires a verifier of 43–128 characters; 32 random bytes encode to
 * exactly 43, the minimum that still carries full 256-bit entropy.
 */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier, 'utf8').digest());
  return { verifier, challenge, method: 'S256' };
}

/** Opaque, unguessable, and compared in constant time on the way back. */
export function createState(): string {
  return base64Url(randomBytes(24));
}

/**
 * Constant-time comparison.
 *
 * Length is compared first because `timingSafeEqual` throws on a length
 * mismatch — leaking only the length, which is public anyway.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
