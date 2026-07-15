import type { BetterSQLite3Raw } from './connection.js';
import { ulid } from '@sync-think/shared';
import type {
  ApprovalMode,
  ApprovalRequestId,
  HumanOnlyAction,
  TaskId,
  WorkspaceId,
  RunId,
  StepId,
} from '@sync-think/shared';

export type ApprovalRequestState = 'pending' | 'approved' | 'rejected';
export type ApprovalRequestKind =
  | 'plan'
  | 'tool'
  | 'memory'
  | 'export'
  | 'skill-permission'
  | 'mcp-permission'
  | 'human-only'
  | 'other';

export type ApprovalDecidedBy = 'human' | 'delegate' | 'auto' | 'system';

export interface ApprovalRequestRecord {
  id: ApprovalRequestId;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  stepId?: StepId;
  kind: ApprovalRequestKind;
  action: string;
  summary: string;
  humanOnly: boolean;
  humanOnlyAction?: HumanOnlyAction;
  mode: ApprovalMode;
  gate: string;
  state: ApprovalRequestState;
  decidedBy?: ApprovalDecidedBy;
  decisionNote?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
}

export interface EnqueueApprovalInput {
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  stepId?: StepId;
  kind?: ApprovalRequestKind | string;
  action: string;
  summary?: string;
  humanOnly?: boolean;
  humanOnlyAction?: HumanOnlyAction | string;
  mode?: ApprovalMode | string;
  gate?: string;
  metadata?: Record<string, unknown>;
  id?: ApprovalRequestId;
  now?: string;
}

export interface DecideApprovalInput {
  id: ApprovalRequestId;
  decision: 'approved' | 'rejected';
  decidedBy?: ApprovalDecidedBy;
  decisionNote?: string;
  now?: string;
}

export interface ListApprovalsFilter {
  workspaceId?: WorkspaceId;
  taskId?: TaskId;
  state?: ApprovalRequestState;
  humanOnly?: boolean;
  limit?: number;
}

interface ApprovalRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  run_id: string | null;
  step_id: string | null;
  kind: string;
  action: string;
  summary: string;
  human_only: number;
  human_only_action: string | null;
  mode: string;
  gate: string;
  state: string;
  decided_by: string | null;
  decision_note: string | null;
  metadata_json: string;
  created_at: string;
  decided_at: string | null;
}

const KINDS = new Set([
  'plan',
  'tool',
  'memory',
  'export',
  'skill-permission',
  'mcp-permission',
  'human-only',
  'other',
]);

function normalizeKind(value: unknown): ApprovalRequestKind {
  const k = String(value ?? 'other').trim().toLowerCase();
  if (KINDS.has(k)) return k as ApprovalRequestKind;
  return 'other';
}

function normalizeMode(value: unknown): ApprovalMode {
  const m = String(value ?? 'request').trim().toLowerCase();
  if (m === 'delegate' || m === 'full' || m === 'custom' || m === 'request') return m;
  return 'request';
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function mapRow(row: ApprovalRow): ApprovalRequestRecord {
  return {
    id: row.id as ApprovalRequestId,
    workspaceId: row.workspace_id as WorkspaceId,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    runId: row.run_id ? (row.run_id as RunId) : undefined,
    stepId: row.step_id ? (row.step_id as StepId) : undefined,
    kind: normalizeKind(row.kind),
    action: row.action,
    summary: row.summary,
    humanOnly: row.human_only === 1,
    humanOnlyAction: row.human_only_action
      ? (row.human_only_action as HumanOnlyAction)
      : undefined,
    mode: normalizeMode(row.mode),
    gate: row.gate || 'require-human',
    state: (row.state as ApprovalRequestState) || 'pending',
    decidedBy: row.decided_by
      ? (row.decided_by as ApprovalDecidedBy)
      : undefined,
    decisionNote: row.decision_note ?? undefined,
    metadata: parseMetadata(row.metadata_json || '{}'),
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

export class SqliteApprovalStore {
  constructor(private readonly db: BetterSQLite3Raw) {}

  enqueue(input: EnqueueApprovalInput): ApprovalRequestRecord {
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? ulid()) as ApprovalRequestId;
    const action = String(input.action ?? '').trim();
    if (!action) throw new Error('approval.action_required');
    const kind = normalizeKind(input.kind);
    const mode = normalizeMode(input.mode);
    const humanOnly = Boolean(input.humanOnly) || kind === 'human-only';
    const humanOnlyAction = input.humanOnlyAction
      ? String(input.humanOnlyAction).trim()
      : undefined;
    const summary =
      String(input.summary ?? '').trim() ||
      (humanOnly ? `Human-only: ${action}` : action);
    const gate = String(input.gate ?? (humanOnly ? 'require-human' : 'require-human')).trim();
    const metadataJson = JSON.stringify(input.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO approval_request (
          id, workspace_id, task_id, run_id, step_id, kind, action, summary,
          human_only, human_only_action, mode, gate, state, decided_by, decision_note,
          metadata_json, created_at, decided_at
        ) VALUES (
          @id, @workspace_id, @task_id, @run_id, @step_id, @kind, @action, @summary,
          @human_only, @human_only_action, @mode, @gate, 'pending', NULL, NULL,
          @metadata_json, @created_at, NULL
        )`,
      )
      .run({
        id,
        workspace_id: input.workspaceId,
        task_id: input.taskId ?? null,
        run_id: input.runId ?? null,
        step_id: input.stepId ?? null,
        kind,
        action: action.slice(0, 256),
        summary: summary.slice(0, 1000),
        human_only: humanOnly ? 1 : 0,
        human_only_action: humanOnlyAction ? humanOnlyAction.slice(0, 128) : null,
        mode,
        gate: gate.slice(0, 64),
        metadata_json: metadataJson.slice(0, 16_000),
        created_at: now,
      });

    const row = this.db
      .prepare(`SELECT * FROM approval_request WHERE id = ?`)
      .get(id) as ApprovalRow;
    return mapRow(row);
  }

  list(filter: ListApprovalsFilter = {}): ApprovalRequestRecord[] {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.workspaceId) {
      clauses.push('workspace_id = ?');
      params.push(filter.workspaceId);
    }
    if (filter.taskId) {
      clauses.push('task_id = ?');
      params.push(filter.taskId);
    }
    if (filter.state) {
      clauses.push('state = ?');
      params.push(filter.state);
    }
    if (filter.humanOnly === true) {
      clauses.push('human_only = 1');
    } else if (filter.humanOnly === false) {
      clauses.push('human_only = 0');
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_request ${where}
         ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
         LIMIT ?`,
      )
      .all(...params) as ApprovalRow[];
    return rows.map(mapRow);
  }

  get(id: ApprovalRequestId): ApprovalRequestRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM approval_request WHERE id = ?`)
      .get(id) as ApprovalRow | undefined;
    return row ? mapRow(row) : null;
  }

  findLatestForStepAction(
    runId: RunId,
    stepId: StepId,
    actionDigest: string,
  ): ApprovalRequestRecord | null {
    if (!/^[a-f0-9]{64}$/.test(actionDigest)) {
      throw new Error('approval.action_digest_invalid');
    }
    const row = this.db
      .prepare(
        `SELECT * FROM approval_request
         WHERE run_id = ? AND step_id = ?
           AND json_valid(metadata_json)
           AND json_extract(metadata_json, '$.actionDigest') = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(runId, stepId, actionDigest) as ApprovalRow | undefined;
    return row ? mapRow(row) : null;
  }

  decide(input: DecideApprovalInput): ApprovalRequestRecord {
    const existing = this.get(input.id);
    if (!existing) throw new Error('approval.not_found');
    if (existing.state !== 'pending') throw new Error('approval.already_decided');
    const now = input.now ?? new Date().toISOString();
    const decidedBy = input.decidedBy ?? 'human';
    // Human-only may only be decided by human (or system refuse path)
    if (existing.humanOnly && decidedBy !== 'human') {
      throw new Error('approval.human_only_requires_human');
    }
    this.db
      .prepare(
        `UPDATE approval_request
         SET state = @state,
             decided_by = @decided_by,
             decision_note = @decision_note,
             decided_at = @decided_at
         WHERE id = @id AND state = 'pending'`,
      )
      .run({
        id: input.id,
        state: input.decision,
        decided_by: decidedBy,
        decision_note: input.decisionNote ? String(input.decisionNote).slice(0, 1000) : null,
        decided_at: now,
      });
    const row = this.get(input.id);
    if (!row) throw new Error('approval.not_found');
    return row;
  }

  countPending(workspaceId?: WorkspaceId): number {
    if (workspaceId) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM approval_request WHERE workspace_id = ? AND state = 'pending'`,
        )
        .get(workspaceId) as { c: number };
      return row?.c ?? 0;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM approval_request WHERE state = 'pending'`)
      .get() as { c: number };
    return row?.c ?? 0;
  }
}
