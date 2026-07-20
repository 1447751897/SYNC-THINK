import { createHash, randomBytes } from 'node:crypto';
import {
  commandRequiresConfigurationConfirmation,
  configurationCommandSummary,
  type CommandCallerSurface,
  type CommandType,
  type ConfigurationCommandPreview,
} from '@sync-think/protocol';

const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_PENDING = 256;

interface PendingConfirmation {
  command: CommandType;
  callerSurface: Exclude<CommandCallerSurface, 'desktop'>;
  payloadDigest: string;
  expiresAtMs: number;
  tokenHash: string;
}

export interface ConfigurationCommandConfirmationGateOptions {
  now?: () => number;
  tokenFactory?: () => string;
  ttlMs?: number;
  maxPending?: number;
}

export interface ConfigurationCommandConfirmationInput {
  command: CommandType;
  callerSurface: CommandCallerSurface;
  payload: unknown;
  confirmationToken?: string;
}

export type ConfigurationCommandConfirmationDecision =
  | { kind: 'execute'; confirmed: false }
  | { kind: 'execute'; confirmed: true; tokenHash: string; payloadDigest: string }
  | { kind: 'preview'; preview: ConfigurationCommandPreview; tokenHash: string }
  | {
      kind: 'reject';
      reason:
        | 'unknown-token'
        | 'expired-token'
        | 'command-mismatch'
        | 'caller-mismatch'
        | 'payload-mismatch';
    };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function payloadDigest(command: CommandType, payload: unknown): string {
  return createHash('sha256')
    .update(command)
    .update('\0')
    .update(JSON.stringify(canonicalize(payload)) ?? 'null')
    .digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function payloadKeys(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.keys(payload as Record<string, unknown>).sort();
}

export class ConfigurationCommandConfirmationGate {
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly ttlMs: number;
  private readonly maxPending: number;

  constructor(options: ConfigurationCommandConfirmationGateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  }

  evaluate(input: ConfigurationCommandConfirmationInput): ConfigurationCommandConfirmationDecision {
    if (
      input.callerSurface === 'desktop' ||
      !commandRequiresConfigurationConfirmation(input.command)
    ) {
      return { kind: 'execute', confirmed: false };
    }

    const digest = payloadDigest(input.command, input.payload);
    if (!input.confirmationToken) {
      return this.issuePreview(input.command, input.callerSurface, input.payload, digest);
    }

    const pending = this.pending.get(input.confirmationToken);
    this.pending.delete(input.confirmationToken);
    if (!pending) return { kind: 'reject', reason: 'unknown-token' };
    if (pending.expiresAtMs < this.now()) return { kind: 'reject', reason: 'expired-token' };
    if (pending.command !== input.command) return { kind: 'reject', reason: 'command-mismatch' };
    if (pending.callerSurface !== input.callerSurface) {
      return { kind: 'reject', reason: 'caller-mismatch' };
    }
    if (pending.payloadDigest !== digest) return { kind: 'reject', reason: 'payload-mismatch' };
    return {
      kind: 'execute',
      confirmed: true,
      tokenHash: pending.tokenHash,
      payloadDigest: pending.payloadDigest,
    };
  }

  private issuePreview(
    command: CommandType,
    callerSurface: Exclude<CommandCallerSurface, 'desktop'>,
    payload: unknown,
    digest: string,
  ): Extract<ConfigurationCommandConfirmationDecision, { kind: 'preview' }> {
    const now = this.now();
    for (const [token, pending] of this.pending) {
      if (pending.expiresAtMs < now) this.pending.delete(token);
    }
    while (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (!oldest) break;
      this.pending.delete(oldest);
    }

    const token = this.tokenFactory();
    const tokenHash = hashToken(token);
    const expiresAtMs = now + this.ttlMs;
    this.pending.set(token, {
      command,
      callerSurface,
      payloadDigest: digest,
      expiresAtMs,
      tokenHash,
    });
    return {
      kind: 'preview',
      tokenHash,
      preview: {
        status: 'confirmation_required',
        command,
        callerSurface,
        confirmationToken: token,
        payloadDigest: digest,
        payloadKeys: payloadKeys(payload),
        summary: configurationCommandSummary(command),
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  }
}
