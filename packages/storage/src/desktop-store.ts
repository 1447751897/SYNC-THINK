import { createHash, randomUUID } from 'node:crypto';
import type { BetterSQLite3Raw } from './connection.js';

const MAX_JSON_BYTES = 256 * 1024;
const ID_RE = /^\S{1,256}$/;

export type DesktopCommandStatus =
  | 'requested'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting_user';

export interface DesktopCommandResult {
  output: unknown;
}

export interface DesktopCommandRecord {
  id: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  toolName: string;
  action: string;
  targetIdentity: string;
  requestDigest: string;
  sanitizedArgs: Record<string, unknown>;
  state: DesktopCommandStatus;
  result?: DesktopCommandResult;
  errorCode?: string;
  failureClass?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

interface DesktopCommandRow {
  id: string;
  idempotency_key: string;
  workspace_id: string;
  run_id: string;
  owner_id: string;
  tool_name: string;
  action: string;
  target_identity: string;
  request_digest: string;
  sanitized_args_json: string;
  state: string;
  result_json: string | null;
  error_code: string | null;
  failure_class: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export class SqliteDesktopStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  reserveCommand(input: {
    id?: string;
    idempotencyKey: string;
    workspaceId: string;
    runId: string;
    ownerId: string;
    toolName: string;
    action: string;
    targetIdentity: string;
    sanitizedArgs: Record<string, unknown>;
    now?: string;
  }): DesktopCommandRecord & { created: boolean } {
    const normalized = normalizeCommandInput(input);
    const now = normalizeNow(input.now);
    return this.raw.transaction(() => {
      const existing = this.getCommandByIdempotencyKey(normalized.idempotencyKey);
      if (existing) {
        if (existing.requestDigest !== normalized.requestDigest) {
          throw new Error('desktop.command_idempotency_mismatch');
        }
        return { ...existing, created: false };
      }
      this.raw
        .prepare(
          `INSERT INTO desktop_command (
             id, idempotency_key, workspace_id, run_id, owner_id, tool_name, action,
             target_identity, request_digest, sanitized_args_json, state, result_json,
             error_code, failure_class, created_at, updated_at, approved_at, started_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          normalized.id,
          normalized.idempotencyKey,
          normalized.workspaceId,
          normalized.runId,
          normalized.ownerId,
          normalized.toolName,
          normalized.action,
          normalized.targetIdentity,
          normalized.requestDigest,
          normalized.sanitizedArgsJson,
          now,
          now,
        );
      return { ...this.getRequiredCommand(normalized.id), created: true };
    }).immediate();
  }

  markApproved(id: string, now?: string): DesktopCommandRecord {
    return this.transition(id, ['requested', 'waiting_user'], 'approved', normalizeNow(now), {
      approvedAt: true,
      clearError: true,
    });
  }

  markRunning(id: string, now?: string): DesktopCommandRecord & { startedNow: boolean } {
    const at = normalizeNow(now);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'running') return { ...existing, startedNow: false };
      if (existing.state !== 'approved') throw new Error('desktop.command_transition_invalid');
      this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'running', updated_at = ?, started_at = COALESCE(started_at, ?),
                 error_code = NULL, failure_class = NULL
           WHERE id = ? AND state = 'approved'`,
        )
        .run(at, at, existing.id);
      return { ...this.getRequiredCommand(existing.id), startedNow: true };
    }).immediate();
  }

  completeCommand(id: string, output: unknown, now?: string): DesktopCommandRecord {
    const at = normalizeNow(now);
    const resultJson = boundedJson({ output }, 'desktop.command_result_too_large');
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'completed') return existing;
      if (existing.state !== 'running') throw new Error('desktop.command_transition_invalid');
      this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'completed', result_json = ?, error_code = NULL, failure_class = NULL,
                 updated_at = ?, completed_at = ?
           WHERE id = ? AND state = 'running'`,
        )
        .run(resultJson, at, at, existing.id);
      return this.getRequiredCommand(existing.id);
    }).immediate();
  }

  failCommand(
    id: string,
    failure: { code: string; failureClass: string },
    now?: string,
  ): DesktopCommandRecord {
    const at = normalizeNow(now);
    const code = normalizeId(failure.code, 'desktop.command_error_code_invalid');
    const failureClass = normalizeId(
      failure.failureClass,
      'desktop.command_failure_class_invalid',
    );
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'failed') return existing;
      if (existing.state === 'completed') throw new Error('desktop.command_transition_invalid');
      this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'failed', result_json = NULL, error_code = ?, failure_class = ?,
                 updated_at = ?, completed_at = ?
           WHERE id = ? AND state NOT IN ('completed', 'failed')`,
        )
        .run(code, failureClass, at, at, existing.id);
      return this.getRequiredCommand(existing.id);
    }).immediate();
  }

  markWaitingUser(
    id: string,
    errorCode = 'desktop.command-inspection-required',
    now?: string,
  ): DesktopCommandRecord {
    const at = normalizeNow(now);
    const code = normalizeId(errorCode, 'desktop.command_error_code_invalid');
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'waiting_user' && existing.errorCode === code) return existing;
      if (existing.state === 'completed' || existing.state === 'failed') {
        throw new Error('desktop.command_transition_invalid');
      }
      this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'waiting_user', error_code = ?, failure_class = 'permission',
                 result_json = NULL, updated_at = ?, completed_at = NULL
           WHERE id = ? AND state NOT IN ('completed', 'failed')`,
        )
        .run(code, at, existing.id);
      return this.getRequiredCommand(existing.id);
    }).immediate();
  }

  recoverUnknownInFlight(now?: string): number {
    const at = normalizeNow(now);
    return Number(
      this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'waiting_user', error_code = 'desktop.command-inspection-required',
                 failure_class = 'permission', updated_at = ?, completed_at = NULL
           WHERE state = 'running'`,
        )
        .run(at).changes,
    );
  }

  listWaitingCommands(input: {
    workspaceId?: string;
    runId?: string;
  } = {}): DesktopCommandRecord[] {
    const clauses = ["state = 'waiting_user'"];
    const values: string[] = [];
    if (input.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      values.push(normalizeId(input.workspaceId, 'desktop.workspace_id_invalid'));
    }
    if (input.runId !== undefined) {
      clauses.push('run_id = ?');
      values.push(normalizeId(input.runId, 'desktop.run_id_invalid'));
    }
    const rows = this.raw
      .prepare(
        `${commandSelect()} WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC, created_at DESC, id ASC`,
      )
      .all(...values) as DesktopCommandRow[];
    return rows.map(mapCommand);
  }

  continueWaitingCommand(input: {
    id: string;
    expectedUpdatedAt: string;
    now?: string;
  }): DesktopCommandRecord & { replayed: boolean } {
    const id = normalizeId(input.id, 'desktop.command_id_invalid');
    const expectedUpdatedAt = normalizeNow(input.expectedUpdatedAt);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      const existingOutput = existing.result?.output;
      if (
        existing.state === 'completed' &&
        isRecord(existingOutput) &&
        existingOutput.resolution === 'user-confirmed' &&
        existingOutput.sourceUpdatedAt === expectedUpdatedAt
      ) {
        return { ...existing, replayed: true };
      }
      if (existing.state !== 'waiting_user') throw new Error('desktop.command_not_waiting');
      if (existing.updatedAt !== expectedUpdatedAt) throw new Error('desktop.command_conflict');
      const at = nextTimestamp(input.now, existing.updatedAt);
      const resultJson = boundedJson(
        {
          output: {
            ok: true,
            commandId: existing.id,
            resolution: 'user-confirmed',
            sourceUpdatedAt: expectedUpdatedAt,
          },
        },
        'desktop.command_result_too_large',
      );
      const changed = this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'completed', result_json = ?, error_code = NULL, failure_class = NULL,
                 updated_at = ?, completed_at = ?
           WHERE id = ? AND state = 'waiting_user' AND updated_at = ?`,
        )
        .run(resultJson, at, at, existing.id, expectedUpdatedAt).changes;
      if (changed !== 1) throw new Error('desktop.command_conflict');
      return { ...this.getRequiredCommand(existing.id), replayed: false };
    }).immediate();
  }

  cancelWaitingCommand(input: {
    id: string;
    expectedUpdatedAt: string;
    now?: string;
  }): DesktopCommandRecord & { replayed: boolean } {
    const id = normalizeId(input.id, 'desktop.command_id_invalid');
    const expectedUpdatedAt = normalizeNow(input.expectedUpdatedAt);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'failed' && existing.errorCode === 'desktop.command-cancelled') {
        return { ...existing, replayed: true };
      }
      if (existing.state !== 'waiting_user') throw new Error('desktop.command_not_waiting');
      if (existing.updatedAt !== expectedUpdatedAt) throw new Error('desktop.command_conflict');
      const at = nextTimestamp(input.now, existing.updatedAt);
      const changed = this.raw
        .prepare(
          `UPDATE desktop_command
             SET state = 'failed', result_json = NULL, error_code = 'desktop.command-cancelled',
                 failure_class = 'acceptance', updated_at = ?, completed_at = ?
           WHERE id = ? AND state = 'waiting_user' AND updated_at = ?`,
        )
        .run(at, at, existing.id, expectedUpdatedAt).changes;
      if (changed !== 1) throw new Error('desktop.command_conflict');
      return { ...this.getRequiredCommand(existing.id), replayed: false };
    }).immediate();
  }

  getCommand(id: string): DesktopCommandRecord | undefined {
    const normalized = normalizeId(id, 'desktop.command_id_invalid');
    const row = this.raw.prepare(`${commandSelect()} WHERE id = ?`).get(normalized) as
      | DesktopCommandRow
      | undefined;
    return row ? mapCommand(row) : undefined;
  }

  getCommandByIdempotencyKey(idempotencyKey: string): DesktopCommandRecord | undefined {
    const normalized = normalizeId(
      idempotencyKey,
      'desktop.command_idempotency_key_invalid',
    );
    const row = this.raw
      .prepare(`${commandSelect()} WHERE idempotency_key = ?`)
      .get(normalized) as DesktopCommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  private getRequiredCommand(id: string): DesktopCommandRecord {
    const command = this.getCommand(id);
    if (!command) throw new Error('desktop.command_not_found');
    return command;
  }

  private transition(
    id: string,
    from: DesktopCommandStatus[],
    to: DesktopCommandStatus,
    at: string,
    options: { approvedAt?: boolean; clearError?: boolean } = {},
  ): DesktopCommandRecord {
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === to) return existing;
      if (!from.includes(existing.state)) throw new Error('desktop.command_transition_invalid');
      const placeholders = from.map(() => '?').join(', ');
      this.raw
        .prepare(
          `UPDATE desktop_command SET state = ?, updated_at = ?${
            options.approvedAt ? ', approved_at = COALESCE(approved_at, ?)' : ''
          }${options.clearError ? ', error_code = NULL, failure_class = NULL' : ''}
           WHERE id = ? AND state IN (${placeholders})`,
        )
        .run(
          to,
          at,
          ...(options.approvedAt ? [at] : []),
          existing.id,
          ...from,
        );
      return this.getRequiredCommand(existing.id);
    }).immediate();
  }
}

function normalizeCommandInput(input: {
  id?: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  toolName: string;
  action: string;
  targetIdentity: string;
  sanitizedArgs: Record<string, unknown>;
}) {
  const id = normalizeId(input.id ?? randomUUID(), 'desktop.command_id_invalid');
  const idempotencyKey = normalizeId(
    input.idempotencyKey,
    'desktop.command_idempotency_key_invalid',
  );
  const workspaceId = normalizeId(input.workspaceId, 'desktop.workspace_id_invalid');
  const runId = normalizeId(input.runId, 'desktop.run_id_invalid');
  const ownerId = normalizeId(input.ownerId, 'desktop.owner_id_invalid');
  const toolName = normalizeId(input.toolName, 'desktop.tool_name_invalid');
  const action = normalizeId(input.action, 'desktop.action_invalid');
  const targetIdentity = String(input.targetIdentity ?? '').trim();
  if (!targetIdentity || Buffer.byteLength(targetIdentity, 'utf8') > 4096) {
    throw new Error('desktop.target_identity_invalid');
  }
  const sanitizedArgsJson = boundedJson(
    input.sanitizedArgs,
    'desktop.command_args_too_large',
  );
  const requestDigest = createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        runId,
        ownerId,
        toolName,
        action,
        targetIdentity,
        sanitizedArgs: JSON.parse(sanitizedArgsJson),
      }),
    )
    .digest('hex');
  return {
    id,
    idempotencyKey,
    workspaceId,
    runId,
    ownerId,
    toolName,
    action,
    targetIdentity,
    sanitizedArgsJson,
    requestDigest,
  };
}

function normalizeId(value: string, code: string): string {
  const normalized = String(value ?? '').trim();
  if (!ID_RE.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeNow(value?: string): string {
  const now = value ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) ||
    !Number.isFinite(Date.parse(now))
  ) {
    throw new Error('desktop.timestamp_invalid');
  }
  return now;
}

function nextTimestamp(value: string | undefined, previous: string): string {
  const requested = normalizeNow(value);
  if (requested > previous) return requested;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedJson(value: unknown, tooLargeCode: string): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error('desktop.json_invalid');
  }
  if (typeof json !== 'string') throw new Error('desktop.json_invalid');
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new Error(tooLargeCode);
  return json;
}

function commandSelect(): string {
  return `SELECT id, idempotency_key, workspace_id, run_id, owner_id, tool_name, action,
    target_identity, request_digest, sanitized_args_json, state, result_json, error_code,
    failure_class, created_at, updated_at, approved_at, started_at, completed_at
    FROM desktop_command`;
}

function mapCommand(row: DesktopCommandRow): DesktopCommandRecord {
  const result = row.result_json
    ? (JSON.parse(row.result_json) as DesktopCommandResult)
    : undefined;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    ownerId: row.owner_id,
    toolName: row.tool_name,
    action: row.action,
    targetIdentity: row.target_identity,
    requestDigest: row.request_digest,
    sanitizedArgs: JSON.parse(row.sanitized_args_json) as Record<string, unknown>,
    state: row.state as DesktopCommandStatus,
    ...(result ? { result } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.failure_class ? { failureClass: row.failure_class } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}
