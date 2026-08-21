import type {
  ExternalEventEnvelope,
  ExternalEventRecord,
  ExternalEventTerminalStatus,
  ScheduledTaskTarget,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

interface ExternalEventRow {
  id: string;
  dedupe_key: string;
  source_kind: string;
  source_name: string | null;
  instruction: string;
  target_kind: string;
  target_ref: string;
  workspace_id: string | null;
  skill_version_ids_json: string;
  conversation_key: string | null;
  title: string | null;
  metadata_json: string | null;
  state: ExternalEventRecord['state'];
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  run_id: string | null;
  result_status: ExternalEventTerminalStatus | null;
  result_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function targetRef(target: ScheduledTaskTarget): string {
  if (target.kind === 'agent') return target.agentId;
  if (target.kind === 'team') return target.teamId;
  return target.modelId;
}

function mapTarget(row: ExternalEventRow): ScheduledTaskTarget {
  if (row.target_kind === 'agent') return { kind: 'agent', agentId: row.target_ref };
  if (row.target_kind === 'team') return { kind: 'team', teamId: row.target_ref };
  return { kind: 'model', modelId: row.target_ref };
}

function mapRow(row: ExternalEventRow): ExternalEventRecord {
  const metadata = parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined);
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    source: {
      kind: row.source_kind as ExternalEventRecord['source']['kind'],
      ...(row.source_name ? { name: row.source_name } : {}),
    },
    instruction: row.instruction,
    target: mapTarget(row),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    skillVersionIds: parseJson<string[]>(row.skill_version_ids_json, []),
    ...(row.conversation_key ? { conversationKey: row.conversation_key } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(metadata ? { metadata } : {}),
    state: row.state,
    attemptCount: Number(row.attempt_count),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.result_status ? { resultStatus: row.result_status } : {}),
    ...(row.result_reason ? { resultReason: row.result_reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function leaseExpiry(now: string, leaseMs: number): string {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error('external_event_invalid_lease');
  }
  return new Date(nowMs + leaseMs).toISOString();
}

export class SqliteExternalEventStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  submit(
    input: ExternalEventEnvelope & { now?: string },
  ): { event: ExternalEventRecord; created: boolean } {
    const now = input.now ?? new Date().toISOString();
    const result = this.raw
      .prepare(
        `INSERT OR IGNORE INTO daemon_external_event (
          id, dedupe_key, source_kind, source_name, instruction,
          target_kind, target_ref, workspace_id, skill_version_ids_json,
          conversation_key, title, metadata_json, state, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(
        input.id,
        input.dedupeKey,
        input.source.kind,
        input.source.name ?? null,
        input.instruction,
        input.target.kind,
        targetRef(input.target),
        input.workspaceId ?? null,
        JSON.stringify(input.skillVersionIds),
        input.conversationKey ?? null,
        input.title ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
      );
    const event = this.getByDedupeKey(input.dedupeKey);
    if (!event) throw new Error('external_event_id_conflict');
    return { event, created: Number(result.changes) === 1 };
  }

  get(id: string): ExternalEventRecord | undefined {
    const row = this.raw
      .prepare('SELECT * FROM daemon_external_event WHERE id = ?')
      .get(id) as ExternalEventRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getByDedupeKey(dedupeKey: string): ExternalEventRecord | undefined {
    const row = this.raw
      .prepare('SELECT * FROM daemon_external_event WHERE dedupe_key = ?')
      .get(dedupeKey) as ExternalEventRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): ExternalEventRecord[] {
    return (
      this.raw
        .prepare('SELECT * FROM daemon_external_event ORDER BY created_at ASC, id ASC')
        .all() as ExternalEventRow[]
    ).map(mapRow);
  }

  claimNext(input: {
    owner: string;
    token: string;
    now?: string;
    leaseMs: number;
  }): ExternalEventRecord | undefined {
    const now = input.now ?? new Date().toISOString();
    const expiresAt = leaseExpiry(now, input.leaseMs);
    return this.raw.transaction(() => {
      const candidate = this.raw
        .prepare(
          `SELECT id FROM daemon_external_event
           WHERE state = 'pending'
              OR (state = 'leased' AND lease_expires_at <= ?)
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(now) as { id: string } | undefined;
      if (!candidate) return undefined;
      const updated = this.raw
        .prepare(
          `UPDATE daemon_external_event
           SET state = 'leased', lease_owner = ?, lease_token = ?,
               lease_expires_at = ?, attempt_count = attempt_count + 1,
               updated_at = ?
           WHERE id = ?
             AND (state = 'pending' OR (state = 'leased' AND lease_expires_at <= ?))`,
        )
        .run(input.owner, input.token, expiresAt, now, candidate.id, now);
      return Number(updated.changes) === 1 ? this.get(candidate.id) : undefined;
    })();
  }

  heartbeat(input: {
    eventId: string;
    token: string;
    runId?: string;
    now?: string;
    leaseMs: number;
  }): boolean {
    const now = input.now ?? new Date().toISOString();
    const expiresAt = leaseExpiry(now, input.leaseMs);
    const result = this.raw
      .prepare(
        `UPDATE daemon_external_event
         SET lease_expires_at = ?, run_id = COALESCE(?, run_id), updated_at = ?
         WHERE id = ? AND state = 'leased' AND lease_token = ?`,
      )
      .run(expiresAt, input.runId ?? null, now, input.eventId, input.token);
    return Number(result.changes) === 1;
  }

  complete(input: {
    eventId: string;
    token: string;
    status: ExternalEventTerminalStatus;
    runId?: string;
    reason?: string;
    now?: string;
  }): boolean {
    const now = input.now ?? new Date().toISOString();
    const state =
      input.status === 'success'
        ? 'completed'
        : input.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    const result = this.raw
      .prepare(
        `UPDATE daemon_external_event
         SET state = ?, run_id = COALESCE(?, run_id), result_status = ?,
             result_reason = ?, lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, completed_at = ?, updated_at = ?
         WHERE id = ? AND state = 'leased' AND lease_token = ?`,
      )
      .run(
        state,
        input.runId ?? null,
        input.status,
        input.reason ?? null,
        now,
        now,
        input.eventId,
        input.token,
      );
    return Number(result.changes) === 1;
  }

  release(input: { eventId: string; token: string; reason?: string; now?: string }): boolean {
    const now = input.now ?? new Date().toISOString();
    const result = this.raw
      .prepare(
        `UPDATE daemon_external_event
         SET state = 'pending', result_reason = ?, lease_owner = NULL,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'leased' AND lease_token = ?`,
      )
      .run(input.reason ?? null, now, input.eventId, input.token);
    return Number(result.changes) === 1;
  }
}
