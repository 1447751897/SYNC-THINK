import type {
  AgentId,
  ChatPlanRevision,
  ChatPlanSubmission,
  ConversationId,
  ConversationPlanSummary,
  ModelId,
  TaskId,
  TeamId,
  WorkspaceId,
} from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

/**
 * First-class conversation store (2026-07-22 model). A conversation is the
 * chat unit in「最近对话」, carrying its own track (model|agent|team) + target.
 * Pinning is DB truth here (replaces the interim local UI-pref pinning).
 *
 * The executionMode column is the conversation-level three-mode permission
 * knob — the ONLY permission surface in the product.
 */

export type ConversationTrack = 'model' | 'agent' | 'team';

export interface ConversationRecord {
  id: ConversationId;
  track: ConversationTrack;
  targetRef: string;
  workspaceId?: WorkspaceId;
  title: string;
  pinnedAt?: string;
  archivedAt?: string;
  executionMode: string;
  /** 'plan' | 'execute' — independent of the executionMode permission knob. */
  interactionMode: 'plan' | 'execute';
  /** Per-conversation capacity override; undefined inherits the selected model. */
  contextWindowOverride?: number;
  lastMessageAt?: string;
  /** Task backing this conversation's thread; undefined until first message. */
  taskId?: TaskId;
  createdAt: string;
  updatedAt: string;
}

export type ConversationTarget =
  | { track: 'model'; modelId: ModelId }
  | { track: 'agent'; agentId: AgentId }
  | { track: 'team'; teamId: TeamId };

export interface CreateConversationInput {
  target: ConversationTarget;
  workspaceId?: WorkspaceId;
  title?: string;
  executionMode?: string;
  interactionMode?: 'plan' | 'execute';
  contextWindowOverride?: number;
  id?: ConversationId;
  now?: string;
}

export interface ListConversationsOptions {
  track?: ConversationTrack;
  workspaceId?: WorkspaceId;
  includeArchived?: boolean;
}

interface ConversationDbRow {
  id: string;
  track: string;
  target_ref: string;
  workspace_id: string | null;
  title: string;
  pinned_at: string | null;
  archived_at: string | null;
  execution_mode: string;
  interaction_mode: string;
  context_window_override: number | null;
  last_message_at: string | null;
  task_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ConversationDbRow): ConversationRecord {
  return {
    id: row.id as ConversationId,
    track: row.track as ConversationTrack,
    targetRef: row.target_ref,
    workspaceId: row.workspace_id ? (row.workspace_id as WorkspaceId) : undefined,
    title: row.title,
    pinnedAt: row.pinned_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    executionMode: row.execution_mode,
    interactionMode: row.interaction_mode === 'plan' ? 'plan' : 'execute',
    contextWindowOverride: row.context_window_override ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function targetRefOf(target: ConversationTarget): string {
  switch (target.track) {
    case 'model':
      return target.modelId;
    case 'agent':
      return target.agentId;
    case 'team':
      return target.teamId;
  }
}

const SELECT_COLUMNS = `id, track, target_ref, workspace_id, title, pinned_at,
  archived_at, execution_mode, interaction_mode, context_window_override,
  last_message_at, task_id, created_at, updated_at`;

function normalizeContextWindowOverride(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 10_000_000) {
    throw new Error('contextWindowOverride must be an integer between 1024 and 10000000');
  }
  return value;
}

export class SqliteConversationStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: CreateConversationInput): ConversationRecord {
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? (`conv-${ulid()}` as ConversationId)) as ConversationId;
    this.raw
      .prepare(
        `INSERT INTO conversation (
           id, track, target_ref, workspace_id, title, execution_mode, interaction_mode,
           context_window_override, last_message_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.target.track,
        targetRefOf(input.target),
        input.workspaceId ?? null,
        input.title ?? '',
        input.executionMode ?? 'full-access',
        input.interactionMode ?? 'execute',
        normalizeContextWindowOverride(input.contextWindowOverride),
        now,
        now,
      );
    const created = this.get(id);
    if (!created) throw new Error('conversation insert failed');
    return created;
  }

  get(conversationId: ConversationId | string): ConversationRecord | undefined {
    const row = this.raw
      .prepare(`SELECT ${SELECT_COLUMNS} FROM conversation WHERE id = ?`)
      .get(conversationId) as ConversationDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** Lookup the conversation bound to a task (one-task-per-conversation). */
  getByTaskId(taskId: TaskId | string): ConversationRecord | undefined {
    const row = this.raw
      .prepare(`SELECT ${SELECT_COLUMNS} FROM conversation WHERE task_id = ? LIMIT 1`)
      .get(taskId) as ConversationDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Sidebar ordering: pinned first (newest pin first), then by recency
   * (last message, falling back to creation time).
   */
  list(options?: ListConversationsOptions): ConversationRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options?.track) {
      clauses.push('track = ?');
      params.push(options.track);
    }
    if (options?.workspaceId) {
      clauses.push('workspace_id = ?');
      params.push(options.workspaceId);
    }
    if (!options?.includeArchived) clauses.push('archived_at IS NULL');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.raw
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM conversation ${where}
         ORDER BY (pinned_at IS NULL), pinned_at DESC,
                  COALESCE(last_message_at, created_at) DESC`,
      )
      .all(...params) as ConversationDbRow[];
    return rows.map(mapRow);
  }

  rename(conversationId: ConversationId, title: string, now?: string): ConversationRecord {
    return this.patch(conversationId, 'title = ?', [title], now);
  }

  setPinned(conversationId: ConversationId, pinned: boolean, now?: string): ConversationRecord {
    const ts = now ?? new Date().toISOString();
    return this.patch(conversationId, 'pinned_at = ?', [pinned ? ts : null], ts);
  }

  setArchived(conversationId: ConversationId, archived: boolean, now?: string): ConversationRecord {
    const ts = now ?? new Date().toISOString();
    return this.patch(conversationId, 'archived_at = ?', [archived ? ts : null], ts);
  }

  setExecutionMode(conversationId: ConversationId, mode: string, now?: string): ConversationRecord {
    return this.patch(conversationId, 'execution_mode = ?', [mode], now);
  }

  setInteractionMode(
    conversationId: ConversationId,
    mode: 'plan' | 'execute',
    now?: string,
  ): ConversationRecord {
    return this.patch(conversationId, 'interaction_mode = ?', [mode], now);
  }

  setContextWindowOverride(
    conversationId: ConversationId,
    contextWindowOverride: number | null,
    now?: string,
  ): ConversationRecord {
    return this.patch(
      conversationId,
      'context_window_override = ?',
      [normalizeContextWindowOverride(contextWindowOverride)],
      now,
    );
  }

  touchLastMessage(conversationId: ConversationId, now?: string): ConversationRecord {
    const ts = now ?? new Date().toISOString();
    return this.patch(conversationId, 'last_message_at = ?', [ts], ts);
  }

  /**
   * Bind the task backing this conversation's thread. Idempotent: once bound,
   * a conversation keeps its task — re-binding a different task throws so the
   * one-task-per-conversation invariant (P1.1) can't be silently violated.
   */
  bindTask(conversationId: ConversationId, taskId: TaskId, now?: string): ConversationRecord {
    const current = this.get(conversationId);
    if (!current) throw new Error(`conversation not found: ${conversationId}`);
    if (current.taskId) {
      if (current.taskId !== taskId) {
        throw new Error(`conversation ${conversationId} already bound to task ${current.taskId}`);
      }
      return current;
    }
    return this.patch(conversationId, 'task_id = ?', [taskId], now);
  }

  /**
   * Upgrade a model-direct chat to an agent/team conversation. Requires an
   * explicit user confirmation upstream (never silent); history is preserved,
   * only track/target change.
   */
  upgradeTrack(
    conversationId: ConversationId,
    target: Exclude<ConversationTarget, { track: 'model' }>,
    now?: string,
  ): ConversationRecord {
    const current = this.get(conversationId);
    if (!current) throw new Error(`conversation not found: ${conversationId}`);
    if (current.track !== 'model') {
      throw new Error(
        `only model-direct conversations can be upgraded (current: ${current.track})`,
      );
    }
    const ts = now ?? new Date().toISOString();
    this.raw
      .prepare('UPDATE conversation SET track = ?, target_ref = ?, updated_at = ? WHERE id = ?')
      .run(target.track, targetRefOf(target), ts, conversationId);
    const updated = this.get(conversationId);
    if (!updated) throw new Error('conversation upgrade failed');
    return updated;
  }

  /**
   * Rebind "who this conversation talks to" — same-track retarget (agent→
   * another agent, model→another model, …) or a free cross-track switch.
   * Unlike upgradeTrack there is no directionality restriction; history is
   * preserved, only track/target_ref change.
   */
  rebindTarget(
    conversationId: ConversationId,
    track: ConversationTrack,
    targetRef: string,
    now?: string,
  ): ConversationRecord {
    if (typeof targetRef !== 'string' || targetRef.trim().length === 0) {
      throw new Error('targetRef must be a non-empty string');
    }
    const current = this.get(conversationId);
    if (!current) throw new Error(`conversation not found: ${conversationId}`);
    const ts = now ?? new Date().toISOString();
    this.raw
      .prepare('UPDATE conversation SET track = ?, target_ref = ?, updated_at = ? WHERE id = ?')
      .run(track, targetRef.trim(), ts, conversationId);
    const updated = this.get(conversationId);
    if (!updated) throw new Error('conversation rebind failed');
    return updated;
  }

  delete(conversationId: ConversationId): void {
    this.raw.prepare('DELETE FROM conversation WHERE id = ?').run(conversationId);
  }

  // ── Conversation plan (chat planning mode) ────────────────────────────────

  getConversationPlan(conversationId: ConversationId): ConversationPlanSummary | undefined {
    const plan = this.raw
      .prepare('SELECT id FROM conversation_plan WHERE conversation_id = ?')
      .get(conversationId) as { id: string } | undefined;
    return plan ? this.toPlanSummary(plan.id) : undefined;
  }

  submitConversationPlan(
    conversationId: ConversationId,
    plan: ChatPlanSubmission,
    now?: string,
  ): ConversationPlanSummary {
    const ts = now ?? new Date().toISOString();
    const existing = this.getConversationPlan(conversationId);
    let planId: string;
    if (!existing) {
      planId = `plan-${ulid()}`;
      this.raw
        .prepare(
          `INSERT INTO conversation_plan (id, conversation_id, current_revision, state, created_at, updated_at)
           VALUES (?, ?, 0, 'draft', ?, ?)`,
        )
        .run(planId, conversationId, ts, ts);
    } else {
      planId = existing.planId;
      // A fresh revision flips an approved plan back to draft.
      this.raw
        .prepare(`UPDATE conversation_plan SET state = 'draft', updated_at = ? WHERE id = ?`)
        .run(ts, planId);
    }
    const revision = (existing?.currentRevision ?? 0) + 1;
    const revisionId = `planrev-${ulid()}`;
    this.raw
      .prepare(
        `INSERT INTO conversation_plan_revision (id, plan_id, revision, plan_json, state, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?)`,
      )
      .run(revisionId, planId, revision, JSON.stringify(plan), ts);
    this.raw
      .prepare(`UPDATE conversation_plan SET current_revision = ?, updated_at = ? WHERE id = ?`)
      .run(revision, ts, planId);
    const summary = this.toPlanSummary(planId);
    if (!summary) throw new Error('conversation plan submit failed');
    return summary;
  }

  /** Idempotent: approving an already-approved plan returns the existing plan. */
  approveConversationPlan(
    conversationId: ConversationId,
    revision: number,
    now?: string,
  ): ConversationPlanSummary {
    const existing = this.getConversationPlan(conversationId);
    if (!existing) throw new Error('conversation plan not found');
    const target = existing.revisions.find((r) => r.revision === revision);
    if (!target) throw new Error(`conversation plan revision not found: ${revision}`);
    if (existing.state === 'approved') return existing;
    const ts = now ?? new Date().toISOString();
    this.raw
      .prepare(`UPDATE conversation_plan SET state = 'approved', updated_at = ? WHERE id = ?`)
      .run(ts, existing.planId);
    this.raw
      .prepare(
        `UPDATE conversation_plan_revision SET state = 'approved', approved_at = ?
         WHERE plan_id = ? AND revision = ?`,
      )
      .run(ts, existing.planId, revision);
    const summary = this.toPlanSummary(existing.planId);
    if (!summary) throw new Error('conversation plan approve failed');
    return summary;
  }

  reviseConversationPlan(
    conversationId: ConversationId,
    expectedRevision: number,
    plan: ChatPlanSubmission,
    now?: string,
  ): ConversationPlanSummary {
    const existing = this.getConversationPlan(conversationId);
    if (!existing) throw new Error('conversation plan not found');
    if (existing.currentRevision !== expectedRevision) {
      throw new Error('conversation plan stale revision');
    }
    return this.submitConversationPlan(conversationId, plan, now);
  }

  cancelConversationPlan(conversationId: ConversationId, now?: string): ConversationPlanSummary {
    const existing = this.getConversationPlan(conversationId);
    if (!existing) throw new Error('conversation plan not found');
    if (existing.state === 'cancelled') return existing;
    const ts = now ?? new Date().toISOString();
    this.raw
      .prepare(`UPDATE conversation_plan SET state = 'cancelled', updated_at = ? WHERE id = ?`)
      .run(ts, existing.planId);
    const summary = this.toPlanSummary(existing.planId);
    if (!summary) throw new Error('conversation plan cancel failed');
    return summary;
  }

  private toPlanSummary(planId: string): ConversationPlanSummary | undefined {
    const plan = this.raw
      .prepare(
        `SELECT id, conversation_id, current_revision, state, created_at, updated_at
         FROM conversation_plan WHERE id = ?`,
      )
      .get(planId) as
      | {
          id: string;
          conversation_id: string;
          current_revision: number;
          state: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!plan) return undefined;
    const rows = this.raw
      .prepare(
        `SELECT id, revision, plan_json, state, approved_at, created_at
         FROM conversation_plan_revision WHERE plan_id = ? ORDER BY revision ASC`,
      )
      .all(planId) as Array<{
      id: string;
      revision: number;
      plan_json: string;
      state: string;
      approved_at: string | null;
      created_at: string;
    }>;
    const revisions: ChatPlanRevision[] = rows.map((r) => ({
      id: r.id,
      conversationId: plan.conversation_id as ConversationId,
      revision: r.revision,
      plan: JSON.parse(r.plan_json) as ChatPlanSubmission,
      state: r.state as ChatPlanRevision['state'],
      createdAt: r.created_at,
      approvedAt: r.approved_at ?? undefined,
    }));
    const latest = revisions[revisions.length - 1];
    if (!latest) return undefined;
    return {
      planId: plan.id,
      conversationId: plan.conversation_id as ConversationId,
      currentRevision: plan.current_revision,
      state: plan.state as ConversationPlanSummary['state'],
      latest,
      revisions,
    };
  }

  private patch(
    conversationId: ConversationId | string,
    setSql: string,
    values: unknown[],
    now?: string,
  ): ConversationRecord {
    const ts = now ?? new Date().toISOString();
    const result = this.raw
      .prepare(`UPDATE conversation SET ${setSql}, updated_at = ? WHERE id = ?`)
      .run(...values, ts, conversationId);
    if (result.changes === 0) throw new Error(`conversation not found: ${conversationId}`);
    const updated = this.get(conversationId);
    if (!updated) throw new Error('conversation update failed');
    return updated;
  }
}
