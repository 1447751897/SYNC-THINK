import type {
  AgentId,
  ConversationId,
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
  archived_at, execution_mode, last_message_at, task_id, created_at, updated_at`;

export class SqliteConversationStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: CreateConversationInput): ConversationRecord {
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? (`conv-${ulid()}` as ConversationId)) as ConversationId;
    this.raw
      .prepare(
        `INSERT INTO conversation (
           id, track, target_ref, workspace_id, title, execution_mode,
           last_message_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.target.track,
        targetRefOf(input.target),
        input.workspaceId ?? null,
        input.title ?? '',
        input.executionMode ?? 'workspace',
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

  delete(conversationId: ConversationId): void {
    this.raw.prepare('DELETE FROM conversation WHERE id = ?').run(conversationId);
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
