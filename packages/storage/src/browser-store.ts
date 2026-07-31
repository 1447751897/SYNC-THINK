import { createHash, randomUUID } from 'node:crypto';
import type { BetterSQLite3Raw } from './connection.js';

const MAX_JSON_BYTES = 256 * 1024;
const ID_RE = /^\S{1,256}$/;
const ORIGIN_ACTION_ALL = '*';

export type BrowserCommandStatus =
  | 'requested'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting_user';
export type BrowserGrantScopeType = 'user' | 'workspace' | 'agent-version' | 'workflow' | 'run';
export type BrowserGrantDecision = 'allow' | 'deny';

export interface BrowserCommandResult {
  output: unknown;
}

export interface BrowserCommandRecord {
  id: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  profileId: string;
  leaseId?: string;
  pageId?: string;
  toolName: string;
  action: string;
  targetOrigin: string;
  requestDigest: string;
  sanitizedArgs: Record<string, unknown>;
  state: BrowserCommandStatus;
  result?: BrowserCommandResult;
  errorCode?: string;
  failureClass?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BrowserOriginGrantRecord {
  id: string;
  scopeType: BrowserGrantScopeType;
  scopeId: string;
  origin: string;
  action: string;
  decision: BrowserGrantDecision;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface BrowserGrantScope {
  scopeType: BrowserGrantScopeType;
  scopeId: string;
}

interface BrowserCommandRow {
  id: string;
  idempotency_key: string;
  workspace_id: string;
  run_id: string;
  owner_id: string;
  profile_id: string;
  lease_id: string | null;
  page_id: string | null;
  tool_name: string;
  action: string;
  target_origin: string;
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

interface BrowserGrantRow {
  id: string;
  scope_type: string;
  scope_id: string;
  origin: string;
  action: string;
  decision: string;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export class SqliteBrowserStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  reserveCommand(input: {
    id?: string;
    idempotencyKey: string;
    workspaceId: string;
    runId: string;
    ownerId: string;
    profileId: string;
    toolName: string;
    action: string;
    targetOrigin: string;
    sanitizedArgs: Record<string, unknown>;
    now?: string;
  }): BrowserCommandRecord & { created: boolean } {
    const normalized = normalizeCommandInput(input);
    const now = normalizeNow(input.now);
    return this.raw.transaction(() => {
      const existing = this.getCommandByIdempotencyKey(normalized.idempotencyKey);
      if (existing) {
        assertSameCommand(existing, normalized.requestDigest);
        return { ...existing, created: false };
      }
      this.raw.prepare(
        `INSERT INTO browser_command (
           id, idempotency_key, workspace_id, run_id, owner_id, profile_id,
           tool_name, action, target_origin, request_digest, sanitized_args_json,
           state, result_json, error_code, failure_class, created_at, updated_at,
           approved_at, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
      ).run(
        normalized.id,
        normalized.idempotencyKey,
        normalized.workspaceId,
        normalized.runId,
        normalized.ownerId,
        normalized.profileId,
        normalized.toolName,
        normalized.action,
        normalized.targetOrigin,
        normalized.requestDigest,
        normalized.sanitizedArgsJson,
        now,
        now,
      );
      return { ...this.getRequiredCommand(normalized.id), created: true };
    }).immediate();
  }

  markApproved(id: string, now?: string): BrowserCommandRecord {
    return this.transition(id, ['requested', 'waiting_user'], 'approved', normalizeNow(now), {
      approvedAt: true,
    });
  }

  markRunning(id: string, now?: string): BrowserCommandRecord & { startedNow: boolean } {
    const at = normalizeNow(now);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'running') return { ...existing, startedNow: false };
      if (existing.state !== 'approved') throw new Error('browser.command_not_approved');
      const update = this.raw.prepare(
        `UPDATE browser_command
         SET state = 'running', updated_at = ?, started_at = ?
         WHERE id = ? AND state = 'approved'`,
      ).run(at, at, id);
      if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
      return { ...this.getRequiredCommand(id), startedNow: true };
    }).immediate();
  }

  completeCommand(
    id: string,
    output: unknown,
    lease?: { leaseId: string; pageId: string },
    now?: string,
  ): BrowserCommandRecord {
    const resultJson = boundedJson({ output }, 'browser.command_result_too_large');
    const at = normalizeNow(now);
    const leaseId = lease ? normalizeId(lease.leaseId, 'browser.command_lease_id_invalid') : undefined;
    const pageId = lease ? normalizeId(lease.pageId, 'browser.command_page_id_invalid') : undefined;
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'completed') {
        if (JSON.stringify(existing.result) !== resultJson) {
          throw new Error('browser.command_result_mismatch');
        }
        return existing;
      }
      if (existing.state !== 'running') throw new Error('browser.command_not_running');
      const update = this.raw.prepare(
        `UPDATE browser_command
         SET state = 'completed', result_json = ?, lease_id = ?, page_id = ?,
             error_code = NULL, failure_class = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND state = 'running'`,
      ).run(resultJson, leaseId ?? null, pageId ?? null, at, at, id);
      if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
      return this.getRequiredCommand(id);
    }).immediate();
  }

  failCommand(
    id: string,
    error: { code: string; failureClass: string },
    now?: string,
  ): BrowserCommandRecord {
    const code = normalizeId(error.code, 'browser.command_error_code_invalid');
    const failureClass = normalizeId(error.failureClass, 'browser.command_failure_class_invalid');
    const at = normalizeNow(now);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'completed') throw new Error('browser.command_already_completed');
      if (existing.state === 'failed') return existing;
      const update = this.raw.prepare(
        `UPDATE browser_command
         SET state = 'failed', error_code = ?, failure_class = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND state IN ('requested', 'approved', 'running', 'waiting_user')`,
      ).run(code, failureClass, at, at, id);
      if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
      return this.getRequiredCommand(id);
    }).immediate();
  }

  markWaitingUser(id: string, errorCode = 'browser.command-inspection-required', now?: string): BrowserCommandRecord {
    const code = normalizeId(errorCode, 'browser.command_error_code_invalid');
    const at = normalizeNow(now);
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === 'waiting_user') return existing;
      if (!['requested', 'approved', 'running'].includes(existing.state)) {
        throw new Error('browser.command_cannot_wait');
      }
      const update = this.raw.prepare(
        `UPDATE browser_command
         SET state = 'waiting_user', error_code = ?, failure_class = 'permission', updated_at = ?
         WHERE id = ? AND state IN ('requested', 'approved', 'running')`,
      ).run(code, at, id);
      if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
      return this.getRequiredCommand(id);
    }).immediate();
  }

  recoverUnknownInFlight(now?: string): number {
    const at = normalizeNow(now);
    return this.raw.prepare(
      `UPDATE browser_command
       SET state = 'waiting_user', error_code = 'browser.command-inspection-required',
           failure_class = 'permission', updated_at = ?
       WHERE state = 'running'`,
    ).run(at).changes;
  }

  getCommand(id: string): BrowserCommandRecord | undefined {
    const row = this.raw.prepare(`${commandSelect()} WHERE id = ?`).get(id) as BrowserCommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  getCommandByIdempotencyKey(idempotencyKey: string): BrowserCommandRecord | undefined {
    const key = normalizeId(idempotencyKey, 'browser.command_idempotency_key_invalid');
    const row = this.raw.prepare(`${commandSelect()} WHERE idempotency_key = ?`).get(key) as
      | BrowserCommandRow
      | undefined;
    return row ? mapCommand(row) : undefined;
  }

  getLastCompletedOrigin(input: {
    workspaceId: string;
    ownerId: string;
    profileId: string;
  }): string | undefined {
    const workspaceId = normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid');
    const ownerId = normalizeId(input.ownerId, 'browser.command_owner_id_invalid');
    const profileId = normalizeId(input.profileId, 'browser.command_profile_id_invalid');
    const row = this.raw.prepare(
      `SELECT target_origin
       FROM browser_command
       WHERE workspace_id = ? AND owner_id = ? AND profile_id = ?
         AND state = 'completed'
       ORDER BY completed_at DESC, id DESC
       LIMIT 1`,
    ).get(workspaceId, ownerId, profileId) as { target_origin: string } | undefined;
    return row?.target_origin;
  }

  upsertOriginGrant(input: {
    id?: string;
    scopeType: BrowserGrantScopeType;
    scopeId: string;
    origin: string;
    action?: string;
    decision: BrowserGrantDecision;
    approvalId?: string;
    expiresAt?: string;
    revokedAt?: string;
    now?: string;
  }): BrowserOriginGrantRecord {
    const id = normalizeId(input.id ?? randomUUID(), 'browser.grant_id_invalid');
    const scopeType = normalizeScopeType(input.scopeType);
    const scopeId = normalizeId(input.scopeId, 'browser.grant_scope_id_invalid');
    const origin = normalizeOrigin(input.origin);
    const action = normalizeAction(input.action ?? ORIGIN_ACTION_ALL);
    const decision = normalizeDecision(input.decision);
    const approvalId = input.approvalId
      ? normalizeId(input.approvalId, 'browser.grant_approval_id_invalid')
      : undefined;
    const now = normalizeNow(input.now);
    const expiresAt = input.expiresAt ? normalizeNow(input.expiresAt) : undefined;
    const revokedAt = input.revokedAt ? normalizeNow(input.revokedAt) : undefined;
    this.raw.prepare(
      `INSERT INTO browser_origin_grant (
         id, scope_type, scope_id, origin, action, decision, approval_id,
         created_at, updated_at, expires_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_type, scope_id, origin, action) DO UPDATE SET
         decision = excluded.decision,
         approval_id = excluded.approval_id,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         revoked_at = excluded.revoked_at`,
    ).run(
      id,
      scopeType,
      scopeId,
      origin,
      action,
      decision,
      approvalId ?? null,
      now,
      now,
      expiresAt ?? null,
      revokedAt ?? null,
    );
    return this.getRequiredGrant(scopeType, scopeId, origin, action);
  }

  resolveOriginDecision(input: {
    scopes: readonly BrowserGrantScope[];
    origin: string;
    action: string;
    now?: string;
  }): { decision: BrowserGrantDecision | 'none'; matches: BrowserOriginGrantRecord[] } {
    const origin = normalizeOrigin(input.origin);
    const action = normalizeAction(input.action);
    const now = normalizeNow(input.now);
    const matches: BrowserOriginGrantRecord[] = [];
    for (const scope of input.scopes) {
      const scopeType = normalizeScopeType(scope.scopeType);
      const scopeId = normalizeId(scope.scopeId, 'browser.grant_scope_id_invalid');
      const rows = this.raw.prepare(
        `${grantSelect()}
         WHERE scope_type = ? AND scope_id = ? AND origin = ? AND action IN (?, '*')`,
      ).all(scopeType, scopeId, origin, action) as BrowserGrantRow[];
      for (const row of rows) {
        const grant = mapGrant(row);
        if (grant.revokedAt) continue;
        if (grant.expiresAt && grant.expiresAt <= now) continue;
        matches.push(grant);
      }
    }
    if (matches.some((grant) => grant.decision === 'deny')) return { decision: 'deny', matches };
    if (matches.some((grant) => grant.decision === 'allow')) return { decision: 'allow', matches };
    return { decision: 'none', matches: [] };
  }

  private transition(
    id: string,
    fromStates: BrowserCommandStatus[],
    toState: BrowserCommandStatus,
    now: string,
    options: { approvedAt?: boolean } = {},
  ): BrowserCommandRecord {
    return this.raw.transaction(() => {
      const existing = this.getRequiredCommand(id);
      if (existing.state === toState) return existing;
      if (!fromStates.includes(existing.state)) throw new Error('browser.command_transition_invalid');
      const placeholders = fromStates.map(() => '?').join(', ');
      const update = this.raw.prepare(
        `UPDATE browser_command
         SET state = ?, updated_at = ?, approved_at = ${options.approvedAt ? '?' : 'approved_at'}
         WHERE id = ? AND state IN (${placeholders})`,
      ).run(
        toState,
        now,
        ...(options.approvedAt ? [now] : []),
        id,
        ...fromStates,
      );
      if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
      return this.getRequiredCommand(id);
    }).immediate();
  }

  private getRequiredCommand(id: string): BrowserCommandRecord {
    const normalized = normalizeId(id, 'browser.command_id_invalid');
    const command = this.getCommand(normalized);
    if (!command) throw new Error('browser.command_not_found');
    return command;
  }

  private getRequiredGrant(
    scopeType: BrowserGrantScopeType,
    scopeId: string,
    origin: string,
    action: string,
  ): BrowserOriginGrantRecord {
    const row = this.raw.prepare(
      `${grantSelect()} WHERE scope_type = ? AND scope_id = ? AND origin = ? AND action = ?`,
    ).get(scopeType, scopeId, origin, action) as BrowserGrantRow | undefined;
    if (!row) throw new Error('browser.grant_not_found');
    return mapGrant(row);
  }
}

function normalizeCommandInput(input: {
  id?: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  profileId: string;
  toolName: string;
  action: string;
  targetOrigin: string;
  sanitizedArgs: Record<string, unknown>;
}) {
  const id = normalizeId(input.id ?? randomUUID(), 'browser.command_id_invalid');
  const idempotencyKey = normalizeId(input.idempotencyKey, 'browser.command_idempotency_key_invalid');
  const workspaceId = normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid');
  const runId = normalizeId(input.runId, 'browser.command_run_id_invalid');
  const ownerId = normalizeId(input.ownerId, 'browser.command_owner_id_invalid');
  const profileId = normalizeId(input.profileId, 'browser.command_profile_id_invalid');
  const toolName = normalizeId(input.toolName, 'browser.command_tool_name_invalid');
  const action = normalizeAction(input.action);
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const sanitizedArgsJson = boundedJson(input.sanitizedArgs, 'browser.command_args_too_large');
  const requestDigest = createHash('sha256')
    .update(JSON.stringify({ workspaceId, runId, ownerId, profileId, toolName, action, targetOrigin, sanitizedArgs: JSON.parse(sanitizedArgsJson) }))
    .digest('hex');
  return {
    id,
    idempotencyKey,
    workspaceId,
    runId,
    ownerId,
    profileId,
    toolName,
    action,
    targetOrigin,
    sanitizedArgsJson,
    requestDigest,
  };
}

function normalizeId(value: string, code: string): string {
  const normalized = String(value ?? '').trim();
  if (!ID_RE.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeAction(value: string): string {
  return normalizeId(value, 'browser.action_invalid');
}

function normalizeScopeType(value: string): BrowserGrantScopeType {
  if (['user', 'workspace', 'agent-version', 'workflow', 'run'].includes(value)) {
    return value as BrowserGrantScopeType;
  }
  throw new Error('browser.grant_scope_type_invalid');
}

function normalizeDecision(value: string): BrowserGrantDecision {
  if (value === 'allow' || value === 'deny') return value;
  throw new Error('browser.grant_decision_invalid');
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('browser.origin_invalid');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin === 'null') {
    throw new Error('browser.origin_invalid');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('browser.origin_invalid');
  }
  return parsed.origin.toLowerCase();
}

function normalizeNow(value?: string): string {
  const now = value ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) || !Number.isFinite(Date.parse(now))) {
    throw new Error('browser.timestamp_invalid');
  }
  return now;
}

function boundedJson(value: unknown, tooLargeCode: string): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error('browser.json_invalid');
  }
  if (typeof json !== 'string') throw new Error('browser.json_invalid');
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new Error(tooLargeCode);
  return json;
}

function assertSameCommand(existing: BrowserCommandRecord, requestDigest: string): void {
  if (existing.requestDigest !== requestDigest) throw new Error('browser.command_idempotency_mismatch');
}

function commandSelect(): string {
  return `SELECT id, idempotency_key, workspace_id, run_id, owner_id, profile_id,
    lease_id, page_id, tool_name, action, target_origin, request_digest, sanitized_args_json, state,
    result_json, error_code, failure_class, created_at, updated_at, approved_at,
    started_at, completed_at FROM browser_command`;
}

function grantSelect(): string {
  return `SELECT id, scope_type, scope_id, origin, action, decision, approval_id,
    created_at, updated_at, expires_at, revoked_at FROM browser_origin_grant`;
}

function mapCommand(row: BrowserCommandRow): BrowserCommandRecord {
  const state = row.state as BrowserCommandStatus;
  const result = row.result_json ? (JSON.parse(row.result_json) as BrowserCommandResult) : undefined;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    ownerId: row.owner_id,
    profileId: row.profile_id,
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.page_id ? { pageId: row.page_id } : {}),
    toolName: row.tool_name,
    action: row.action,
    targetOrigin: row.target_origin,
    requestDigest: row.request_digest,
    sanitizedArgs: JSON.parse(row.sanitized_args_json) as Record<string, unknown>,
    state,
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

function mapGrant(row: BrowserGrantRow): BrowserOriginGrantRecord {
  return {
    id: row.id,
    scopeType: row.scope_type as BrowserGrantScopeType,
    scopeId: row.scope_id,
    origin: row.origin,
    action: row.action,
    decision: row.decision as BrowserGrantDecision,
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}
