import { randomUUID } from 'node:crypto';
import type { SqliteExternalEventStore } from '@sync-think/storage';
import type { ExternalEventEnvelope, ExternalEventRecord } from '@sync-think/shared';
import type {
  ExternalEventCompletePayload,
  ExternalEventHeartbeatPayload,
} from './external-event-protocol.js';

export interface ExternalEventDispatchOutcome {
  ok: boolean;
  accepted: boolean;
  runId?: string;
  reason?: string;
}

export interface ExternalEventCoordinatorOptions {
  store: SqliteExternalEventStore;
  ownerId: string;
  dispatch: (event: ExternalEventRecord) => Promise<ExternalEventDispatchOutcome>;
  now?: () => Date;
  leaseMs?: number;
  maxConcurrent?: () => number;
  maxAttempts?: number;
  createToken?: () => string;
}

/**
 * Durable daemon-side inbox coordinator. It knows lease mechanics and Runtime
 * delivery, but nothing about conversation or kernel execution.
 */
export class ExternalEventCoordinator {
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly maxConcurrent: () => number;
  private readonly maxAttempts: number;
  private readonly createToken: () => string;
  private pumping = false;

  constructor(private readonly options: ExternalEventCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxConcurrent = options.maxConcurrent ?? (() => 2);
    this.maxAttempts = options.maxAttempts ?? 10;
    this.createToken = options.createToken ?? randomUUID;
  }

  submit(event: ExternalEventEnvelope): ReturnType<SqliteExternalEventStore['submit']> {
    return this.options.store.submit({ ...event, now: this.now().toISOString() });
  }

  async pumpOnce(): Promise<boolean> {
    if (this.pumping) return false;
    this.pumping = true;
    try {
      const now = this.now();
      const active = this.options.store
        .list()
        .filter(
          (event) =>
            event.state === 'leased' &&
            Boolean(event.leaseExpiresAt) &&
            Date.parse(event.leaseExpiresAt!) > now.getTime(),
        ).length;
      if (active >= Math.max(1, this.maxConcurrent())) return false;

      const claimed = this.options.store.claimNext({
        owner: this.options.ownerId,
        token: this.createToken(),
        now: now.toISOString(),
        leaseMs: this.leaseMs,
      });
      if (!claimed?.leaseToken) return false;

      let outcome: ExternalEventDispatchOutcome;
      try {
        outcome = await this.options.dispatch(claimed);
      } catch (error) {
        outcome = {
          ok: false,
          accepted: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (outcome.ok && outcome.accepted) {
        this.options.store.heartbeat({
          eventId: claimed.id,
          token: claimed.leaseToken,
          ...(outcome.runId ? { runId: outcome.runId } : {}),
          now: this.now().toISOString(),
          leaseMs: this.leaseMs,
        });
        return true;
      }

      if (claimed.attemptCount >= this.maxAttempts) {
        this.options.store.complete({
          eventId: claimed.id,
          token: claimed.leaseToken,
          status: 'failed',
          reason: outcome.reason ?? 'Runtime dispatch failed',
          now: this.now().toISOString(),
        });
      } else {
        this.options.store.release({
          eventId: claimed.id,
          token: claimed.leaseToken,
          reason: outcome.reason ?? 'Runtime dispatch rejected',
          now: this.now().toISOString(),
        });
      }
      return true;
    } finally {
      this.pumping = false;
    }
  }

  heartbeat(payload: ExternalEventHeartbeatPayload): boolean {
    return this.options.store.heartbeat({
      eventId: payload.eventId,
      token: payload.leaseToken,
      ...(payload.runId ? { runId: payload.runId } : {}),
      now: this.now().toISOString(),
      leaseMs: this.leaseMs,
    });
  }

  complete(payload: ExternalEventCompletePayload): boolean {
    return this.options.store.complete({
      eventId: payload.eventId,
      token: payload.leaseToken,
      status: payload.status,
      ...(payload.runId ? { runId: payload.runId } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
      now: this.now().toISOString(),
    });
  }
}
