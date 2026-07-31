import type {
  FailureClass,
  MemoryChangeId,
  MemoryScope,
  RunId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type MemoryApprovalState = 'pending' | 'approved' | 'rejected' | 'rolled_back';

export interface MemoryEntryValue {
  id: string;
  key: string;
  value: string;
  targetScope: MemoryScope;
}

export interface MemoryChangeRecord {
  id: MemoryChangeId;
  workspaceId: WorkspaceId;
  taskId: TaskId;
  targetScope: MemoryScope;
  additions: MemoryEntryValue[];
  modifications: MemoryEntryValue[];
  deprecations: string[];
  evidenceRefs: string[];
  confidence: number;
  unresolvedAmbiguity?: string;
  approvalState: MemoryApprovalState;
  proposedByRunId?: RunId;
  createdAt: string;
  decidedAt?: string;
}

export interface DurableMemoryEntry {
  id: string;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  scope: MemoryScope;
  key: string;
  value: string;
  sourceChangeId?: MemoryChangeId;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProposeMemoryChangeInput {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  targetScope?: MemoryScope;
  additions?: MemoryEntryValue[];
  modifications?: MemoryEntryValue[];
  deprecations?: string[];
  evidenceRefs?: string[];
  confidence?: number;
  unresolvedAmbiguity?: string;
  proposedByRunId?: RunId;
  /** When true, auto-approve (M1 policy: task-scope milestones may auto-approve). */
  autoApprove?: boolean;
  now?: string;
  id?: MemoryChangeId;
}

export interface DecideMemoryChangeInput {
  changeId: MemoryChangeId;
  decision: 'approved' | 'rejected';
  now?: string;
}

export interface RollbackMemoryChangeInput {
  changeId: MemoryChangeId;
  now?: string;
}

export interface DiagnosticRecord {
  id: string;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  category: string;
  failureClass?: FailureClass | string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AppendDiagnosticInput {
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  category: string;
  failureClass?: FailureClass | string;
  summary: string;
  detail?: Record<string, unknown>;
  now?: string;
  id?: string;
}

interface MemoryChangeRow {
  id: string;
  workspace_id: string;
  task_id: string;
  target_scope: string;
  additions_json: string;
  modifications_json: string;
  deprecations_json: string;
  evidence_refs_json: string;
  confidence: number;
  unresolved_ambiguity: string | null;
  approval_state: string;
  proposed_by_run_id: string | null;
  created_at: string;
  decided_at: string | null;
}

interface MemoryEntryRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  scope: string;
  entry_key: string;
  entry_value: string;
  source_change_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface DiagnosticRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  run_id: string | null;
  category: string;
  failure_class: string | null;
  summary: string;
  detail_json: string;
  created_at: string;
}

const SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replace: '[REDACTED]' },
  { re: /Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, replace: 'Bearer [REDACTED]' },
  { re: /api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,}/gi, replace: 'api_key=[REDACTED]' },
  { re: /plaintext-secret/gi, replace: '[REDACTED]' },
  { re: /\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, replace: '[PATH]' },
  { re: /\/(?:Users|home|var|tmp|private|opt|srv)\/[^\s"']+/g, replace: '[PATH]' },
  { re: /\b(?:response\s+body|body)\s*[:=]?\s*[\s\S]*/gi, replace: 'response body [REDACTED]' },
];

/** Shared scrubber for diagnostic text — never keeps provider keys in store. */
export function scrubDiagnosticText(text: string, maxLen = 480): string {
  let out = text;
  for (const { re, replace } of SECRET_PATTERNS) {
    out = out.replace(re, replace);
  }
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return scrubDiagnosticText(value, 240);
  if (Array.isArray(value)) return value.slice(0, 32).map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (key.includes('secret') || key.includes('apikey') || key.includes('api_key') || key === 'authorization') {
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function normalizeEntries(entries: readonly MemoryEntryValue[] | undefined, scope: MemoryScope): MemoryEntryValue[] {
  if (!entries || entries.length === 0) return [];
  const out: MemoryEntryValue[] = [];
  for (const entry of entries) {
    const key = String(entry?.key ?? '').trim();
    const value = String(entry?.value ?? '').trim();
    if (!key || !value) continue;
    out.push({
      id: entry.id?.trim() || ulid(),
      key: key.slice(0, 128),
      value: value.slice(0, 4000),
      targetScope: (entry.targetScope as MemoryScope) || scope,
    });
  }
  return out;
}

function rowToChange(row: MemoryChangeRow): MemoryChangeRecord {
  return {
    id: row.id as MemoryChangeId,
    workspaceId: row.workspace_id as WorkspaceId,
    taskId: row.task_id as TaskId,
    targetScope: row.target_scope as MemoryScope,
    additions: parseJsonArray<MemoryEntryValue>(row.additions_json),
    modifications: parseJsonArray<MemoryEntryValue>(row.modifications_json),
    deprecations: parseJsonArray<string>(row.deprecations_json),
    evidenceRefs: parseJsonArray<string>(row.evidence_refs_json),
    confidence: row.confidence,
    unresolvedAmbiguity: row.unresolved_ambiguity ?? undefined,
    approvalState: row.approval_state as MemoryApprovalState,
    proposedByRunId: (row.proposed_by_run_id as RunId | null) ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

function rowToEntry(row: MemoryEntryRow): DurableMemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id as WorkspaceId,
    taskId: (row.task_id as TaskId | null) ?? undefined,
    scope: row.scope as MemoryScope,
    key: row.entry_key,
    value: row.entry_value,
    sourceChangeId: (row.source_change_id as MemoryChangeId | null) ?? undefined,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDiagnostic(row: DiagnosticRow): DiagnosticRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id as WorkspaceId,
    taskId: (row.task_id as TaskId | null) ?? undefined,
    runId: (row.run_id as RunId | null) ?? undefined,
    category: row.category,
    failureClass: row.failure_class ?? undefined,
    summary: row.summary,
    detail: parseJsonObject(row.detail_json),
    createdAt: row.created_at,
  };
}

/**
 * Sqlite-backed MemoryChange + scrubbed Diagnostics store (§10.4 / §19).
 * Memory: propose → approve/reject (versioned). Diagnostics: append-only, scrubbed.
 */
export class SqliteMemoryStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  proposeChange(input: ProposeMemoryChangeInput): MemoryChangeRecord {
    const scope = input.targetScope ?? 'task';
    const additions = normalizeEntries(input.additions, scope);
    const modifications = normalizeEntries(input.modifications, scope);
    const deprecations = (input.deprecations ?? [])
      .map((d) => String(d).trim())
      .filter(Boolean)
      .slice(0, 64);
    if (additions.length === 0 && modifications.length === 0 && deprecations.length === 0) {
      throw new Error('Memory change must include additions, modifications, or deprecations');
    }
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? ulid()) as MemoryChangeId;
    const confidence =
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? Math.min(1, Math.max(0, input.confidence))
        : 0.5;
    const autoApprove = Boolean(input.autoApprove);
    const approvalState: MemoryApprovalState = autoApprove ? 'approved' : 'pending';
    const decidedAt = autoApprove ? now : null;

    const apply = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO memory_change (
            id, workspace_id, task_id, target_scope,
            additions_json, modifications_json, deprecations_json, evidence_refs_json,
            confidence, unresolved_ambiguity, approval_state, proposed_by_run_id,
            created_at, decided_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.taskId,
          scope,
          JSON.stringify(additions),
          JSON.stringify(modifications),
          JSON.stringify(deprecations),
          JSON.stringify((input.evidenceRefs ?? []).slice(0, 32)),
          confidence,
          input.unresolvedAmbiguity?.slice(0, 500) ?? null,
          approvalState,
          input.proposedByRunId ?? null,
          now,
          decidedAt,
        );

      if (autoApprove) {
        this.applyApprovedChange({
          id,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          targetScope: scope,
          additions,
          modifications,
          deprecations,
          now,
        });
      }
    });
    apply.immediate();

    return this.getChange(id)!;
  }

  decideChange(input: DecideMemoryChangeInput): MemoryChangeRecord {
    const existing = this.getChange(input.changeId);
    if (!existing) throw new Error(`Memory change not found: ${input.changeId}`);
    if (existing.approvalState !== 'pending') {
      throw new Error(`Memory change already decided: ${existing.approvalState}`);
    }
    const now = input.now ?? new Date().toISOString();
    const apply = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE memory_change SET approval_state = ?, decided_at = ? WHERE id = ?`,
        )
        .run(input.decision, now, input.changeId);

      if (input.decision === 'approved') {
        this.applyApprovedChange({
          id: existing.id,
          workspaceId: existing.workspaceId,
          taskId: existing.taskId,
          targetScope: existing.targetScope,
          additions: existing.additions,
          modifications: existing.modifications,
          deprecations: existing.deprecations,
          now,
        });
      }
    });
    apply.immediate();
    return this.getChange(input.changeId)!;
  }

  getChange(id: MemoryChangeId | string): MemoryChangeRecord | undefined {
    const row = this.raw
      .prepare(`SELECT * FROM memory_change WHERE id = ?`)
      .get(id) as MemoryChangeRow | undefined;
    return row ? rowToChange(row) : undefined;
  }

  listChanges(input: {
    workspaceId: WorkspaceId;
    taskId?: TaskId;
    approvalState?: MemoryApprovalState;
    limit?: number;
  }): MemoryChangeRecord[] {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const clauses = ['workspace_id = ?'];
    const params: unknown[] = [input.workspaceId];
    if (input.taskId) {
      clauses.push('task_id = ?');
      params.push(input.taskId);
    }
    if (input.approvalState) {
      clauses.push('approval_state = ?');
      params.push(input.approvalState);
    }
    params.push(limit);
    const rows = this.raw
      .prepare(
        `SELECT * FROM memory_change WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as MemoryChangeRow[];
    return rows.map(rowToChange);
  }

  listActiveEntries(input: {
    workspaceId: WorkspaceId;
    taskId?: TaskId;
    scope?: MemoryScope;
    limit?: number;
  }): DurableMemoryEntry[] {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const clauses = ['workspace_id = ?', 'active = 1'];
    const params: unknown[] = [input.workspaceId];
    if (input.taskId) {
      clauses.push('(task_id IS NULL OR task_id = ?)');
      params.push(input.taskId);
    }
    if (input.scope) {
      clauses.push('scope = ?');
      params.push(input.scope);
    }
    params.push(limit);
    const rows = this.raw
      .prepare(
        `SELECT * FROM memory_entry WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params) as MemoryEntryRow[];
    return rows.map(rowToEntry);
  }

  appendDiagnostic(input: AppendDiagnosticInput): DiagnosticRecord {
    const now = input.now ?? new Date().toISOString();
    const id = input.id ?? ulid();
    const summary = scrubDiagnosticText(input.summary || 'diagnostic', 240);
    const detail = (scrubDeep(input.detail ?? {}) as Record<string, unknown>) ?? {};
    this.raw
      .prepare(
        `INSERT INTO diagnostic_record (
          id, workspace_id, task_id, run_id, category, failure_class, summary, detail_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.taskId ?? null,
        input.runId ?? null,
        String(input.category || 'system').slice(0, 64),
        input.failureClass ? String(input.failureClass).slice(0, 64) : null,
        summary,
        JSON.stringify(detail),
        now,
      );
    return this.getDiagnostic(id)!;
  }

  getDiagnostic(id: string): DiagnosticRecord | undefined {
    const row = this.raw
      .prepare(`SELECT * FROM diagnostic_record WHERE id = ?`)
      .get(id) as DiagnosticRow | undefined;
    return row ? rowToDiagnostic(row) : undefined;
  }

  listDiagnostics(input: {
    workspaceId: WorkspaceId;
    taskId?: TaskId;
    runId?: RunId;
    limit?: number;
  }): DiagnosticRecord[] {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const clauses = ['workspace_id = ?'];
    const params: unknown[] = [input.workspaceId];
    if (input.taskId) {
      clauses.push('task_id = ?');
      params.push(input.taskId);
    }
    if (input.runId) {
      clauses.push('run_id = ?');
      params.push(input.runId);
    }
    params.push(limit);
    const rows = this.raw
      .prepare(
        `SELECT * FROM diagnostic_record WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as DiagnosticRow[];
    return rows.map(rowToDiagnostic);
  }

  private applyApprovedChange(input: {
    id: MemoryChangeId;
    workspaceId: WorkspaceId;
    taskId: TaskId;
    targetScope: MemoryScope;
    additions: MemoryEntryValue[];
    modifications: MemoryEntryValue[];
    deprecations: string[];
    now: string;
  }): void {
    const deactivateActive = (key: string) => {
      this.raw
        .prepare(
          `UPDATE memory_entry
           SET active = 0, updated_at = ?
           WHERE workspace_id = ? AND entry_key = ? AND active = 1`,
        )
        .run(input.now, input.workspaceId, key);
    };

    const insertActive = (entry: MemoryEntryValue) => {
      this.raw
        .prepare(
          `INSERT INTO memory_entry (
            id, workspace_id, task_id, scope, entry_key, entry_value,
            source_change_id, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          entry.id || ulid(),
          input.workspaceId,
          entry.targetScope === 'task' ? input.taskId : null,
          entry.targetScope,
          entry.key,
          entry.value,
          input.id,
          input.now,
          input.now,
        );
    };

    for (const entry of input.additions) {
      deactivateActive(entry.key);
      insertActive(entry);
    }
    for (const entry of input.modifications) {
      deactivateActive(entry.key);
      insertActive(entry);
    }
    for (const key of input.deprecations) {
      deactivateActive(key);
    }
  }

  /**
   * Reverse an approved MemoryChange (design §10.4 — every version remains reversible).
   * Deactivates entries introduced by the change and restores the prior version when present.
   */
  rollbackChange(input: RollbackMemoryChangeInput): MemoryChangeRecord {
    const existing = this.getChange(input.changeId);
    if (!existing) throw new Error(`Memory change not found: ${input.changeId}`);
    if (existing.approvalState !== 'approved') {
      throw new Error(
        `Only approved memory changes can be rolled back (current: ${existing.approvalState})`,
      );
    }
    const now = input.now ?? new Date().toISOString();
    const touchedKeys = new Set<string>();
    for (const e of existing.additions) touchedKeys.add(e.key);
    for (const e of existing.modifications) touchedKeys.add(e.key);
    for (const k of existing.deprecations) touchedKeys.add(k);

    const apply = this.raw.transaction(() => {
      // Deactivate rows this change introduced.
      this.raw
        .prepare(
          `UPDATE memory_entry
           SET active = 0, updated_at = ?
           WHERE source_change_id = ? AND active = 1`,
        )
        .run(now, input.changeId);

      for (const key of touchedKeys) {
        const stillActive = this.raw
          .prepare(
            `SELECT id FROM memory_entry
             WHERE workspace_id = ? AND entry_key = ? AND active = 1
             LIMIT 1`,
          )
          .get(existing.workspaceId, key) as { id: string } | undefined;
        if (stillActive) continue;

        // Restore the most recent predecessor not introduced by this change,
        // and not from a later change that has itself been rolled back (§10.4).
        const prev = this.raw
          .prepare(
            `SELECT me.id AS id FROM memory_entry me
             WHERE me.workspace_id = ? AND me.entry_key = ? AND me.active = 0
               AND (me.source_change_id IS NULL OR me.source_change_id != ?)
               AND (
                 me.source_change_id IS NULL
                 OR NOT EXISTS (
                   SELECT 1 FROM memory_change mc
                   WHERE mc.id = me.source_change_id
                     AND mc.approval_state = 'rolled_back'
                 )
               )
             ORDER BY me.updated_at DESC, me.created_at DESC
             LIMIT 1`,
          )
          .get(existing.workspaceId, key, input.changeId) as { id: string } | undefined;

        if (prev) {
          this.raw
            .prepare(
              `UPDATE memory_entry SET active = 1, updated_at = ? WHERE id = ?`,
            )
            .run(now, prev.id);
        }
      }

      this.raw
        .prepare(
          `UPDATE memory_change SET approval_state = ?, decided_at = ? WHERE id = ?`,
        )
        .run('rolled_back', now, input.changeId);
    });
    apply.immediate();
    return this.getChange(input.changeId)!;
  }
}
