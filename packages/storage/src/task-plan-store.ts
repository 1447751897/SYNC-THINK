// NewMax-style structured task checklist store (project_tasks parity).
// Tasks are workspace-scoped, persist across conversations/restarts, and carry
// dependency edges (task_plan_dependency) plus per-attempt execution records
// (task_plan_execution). The model maintains rows through TaskCreate /
// TaskUpdate / TaskList chat tools.
import type { BetterSQLite3Raw } from './connection.js';
import { ulid } from '@sync-think/shared';

export type TaskPlanStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPlanPriority = 'low' | 'medium' | 'high';
export type TaskPlanExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskPlanRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: TaskPlanStatus;
  priority: TaskPlanPriority;
  estimatedMinutes?: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** task ids this task depends on (DAG edges). */
  dependsOn: string[];
}

export interface CreateTaskPlanInput {
  workspaceId: string;
  title: string;
  description?: string;
  status?: TaskPlanStatus;
  priority?: TaskPlanPriority;
  estimatedMinutes?: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  /** Task ids this task depends on; validated to exist in the same workspace. */
  dependsOn?: readonly string[];
  id?: string;
  now?: string;
}

export interface UpdateTaskPlanInput {
  taskId: string;
  title?: string;
  description?: string;
  status?: TaskPlanStatus;
  priority?: TaskPlanPriority;
  estimatedMinutes?: number | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  sortOrder?: number;
  now?: string;
}

export interface TaskPlanExecutionRecord {
  id: string;
  taskId: string;
  conversationId?: string;
  status: TaskPlanExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  isRetry: boolean;
  createdAt: string;
}

interface TaskPlanRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  estimated_minutes: number | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function parseOptional(value: string | null): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function mapRow(row: TaskPlanRow, dependsOn: string[]): TaskPlanRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskPlanStatus,
    priority: row.priority as TaskPlanPriority,
    estimatedMinutes: row.estimated_minutes ?? undefined,
    plannedStartAt: parseOptional(row.planned_start_at),
    plannedEndAt: parseOptional(row.planned_end_at),
    actualStartAt: parseOptional(row.actual_start_at),
    actualEndAt: parseOptional(row.actual_end_at),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dependsOn,
  };
}

const TASK_COLUMNS =
  'id, workspace_id, title, description, status, priority, estimated_minutes, ' +
  'planned_start_at, planned_end_at, actual_start_at, actual_end_at, sort_order, created_at, updated_at';

export class SqliteTaskPlanStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  /** All checklist rows for a workspace, ordered by sort_order then created_at. */
  list(workspaceId: string, options?: { statuses?: readonly TaskPlanStatus[] }): TaskPlanRecord[] {
    const id = String(workspaceId ?? '').trim();
    if (!id) return [];
    const rows = this.raw
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM task_plan
         WHERE workspace_id = ?${options?.statuses?.length ? ` AND status IN (${options.statuses.map(() => '?').join(', ')})` : ''}
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(id, ...(options?.statuses ?? [])) as unknown as TaskPlanRow[];
    const dependsByTask = this.listDependenciesFor(rows.map((row) => row.id));
    return rows.map((row) => mapRow(row, dependsByTask.get(row.id) ?? []));
  }

  get(taskId: string): TaskPlanRecord | undefined {
    const id = String(taskId ?? '').trim();
    if (!id) return undefined;
    const row = this.raw.prepare(`SELECT ${TASK_COLUMNS} FROM task_plan WHERE id = ?`).get(id) as
      TaskPlanRow | undefined;
    if (!row) return undefined;
    return mapRow(row, this.listDependenciesFor([row.id]).get(row.id) ?? []);
  }

  create(input: CreateTaskPlanInput): TaskPlanRecord {
    const id = String(input.id ?? ulid()).trim();
    const workspaceId = String(input.workspaceId ?? '').trim();
    const title = String(input.title ?? '').trim();
    if (!workspaceId || !title)
      throw new Error('task_plan.create: workspaceId and title are required');
    const now = input.now ?? new Date().toISOString();
    const dependsOn = (input.dependsOn ?? []).map((dep) => String(dep).trim()).filter(Boolean);
    // Next sort order: max + 1 within the workspace.
    const maxOrder = this.raw
      .prepare('SELECT MAX(sort_order) AS m FROM task_plan WHERE workspace_id = ?')
      .get(workspaceId) as { m: number | null };
    const sortOrder = (maxOrder.m ?? -1) + 1;
    this.raw
      .prepare(
        `INSERT INTO task_plan (
           id, workspace_id, title, description, status, priority,
           estimated_minutes, planned_start_at, planned_end_at, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspaceId,
        title,
        String(input.description ?? '').trim(),
        input.status ?? 'pending',
        input.priority ?? 'medium',
        input.estimatedMinutes ?? null,
        input.plannedStartAt ?? null,
        input.plannedEndAt ?? null,
        sortOrder,
        now,
        now,
      );
    for (const dep of dependsOn) {
      this.raw
        .prepare(
          'INSERT OR IGNORE INTO task_plan_dependency (task_id, depends_on_task_id) VALUES (?, ?)',
        )
        .run(id, dep);
    }
    return this.get(id)!;
  }

  update(input: UpdateTaskPlanInput): TaskPlanRecord | undefined {
    const taskId = String(input.taskId ?? '').trim();
    const existing = this.get(taskId);
    if (!existing) return undefined;
    const now = input.now ?? new Date().toISOString();
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    const push = (
      column: string,
      value: string | number | null | undefined,
      has: boolean,
    ): void => {
      if (!has) return;
      sets.push(`${column} = ?`);
      values.push(value ?? null);
    };
    push('title', input.title?.trim(), input.title !== undefined);
    push('description', input.description?.trim(), input.description !== undefined);
    push('status', input.status, input.status !== undefined);
    push('priority', input.priority, input.priority !== undefined);
    push('estimated_minutes', input.estimatedMinutes ?? null, input.estimatedMinutes !== undefined);
    push('planned_start_at', input.plannedStartAt ?? null, input.plannedStartAt !== undefined);
    push('planned_end_at', input.plannedEndAt ?? null, input.plannedEndAt !== undefined);
    push('sort_order', input.sortOrder, input.sortOrder !== undefined);
    // Lifecycle timestamps mirror status transitions.
    if (input.status === 'in_progress' && !existing.actualStartAt) {
      sets.push('actual_start_at = ?');
      values.push(now);
    }
    if (input.status === 'completed' || input.status === 'cancelled') {
      sets.push('actual_end_at = ?');
      values.push(now);
    }
    sets.push('updated_at = ?');
    values.push(now);
    values.push(taskId);
    this.raw.prepare(`UPDATE task_plan SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.get(taskId);
  }

  delete(taskId: string): boolean {
    const id = String(taskId ?? '').trim();
    if (!id) return false;
    return this.raw.prepare('DELETE FROM task_plan WHERE id = ?').run(id).changes > 0;
  }

  // ── Execution records (task_plan_execution) ─────────────────────────────

  startExecution(input: {
    taskId: string;
    conversationId?: string;
    isRetry?: boolean;
    now?: string;
  }): TaskPlanExecutionRecord {
    const id = ulid();
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO task_plan_execution (id, task_id, conversation_id, status, started_at, is_retry, created_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(id, input.taskId, input.conversationId ?? null, now, input.isRetry ? 1 : 0, now);
    return this.getExecution(id)!;
  }

  finishExecution(input: {
    executionId: string;
    status: 'completed' | 'failed' | 'cancelled';
    error?: string;
    now?: string;
  }): TaskPlanExecutionRecord | undefined {
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `UPDATE task_plan_execution
         SET status = ?, finished_at = ?, error = ? WHERE id = ?`,
      )
      .run(input.status, now, input.error ?? null, input.executionId);
    return this.getExecution(input.executionId);
  }

  listExecutions(taskId: string): TaskPlanExecutionRecord[] {
    const id = String(taskId ?? '').trim();
    if (!id) return [];
    return (
      this.raw
        .prepare(
          `SELECT id, task_id, conversation_id, status, started_at, finished_at, error, is_retry, created_at
           FROM task_plan_execution WHERE task_id = ? ORDER BY created_at DESC`,
        )
        .all(id) as Array<{
        id: string;
        task_id: string;
        conversation_id: string | null;
        status: string;
        started_at: string | null;
        finished_at: string | null;
        error: string | null;
        is_retry: number;
        created_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      conversationId: row.conversation_id ?? undefined,
      status: row.status as TaskPlanExecutionStatus,
      startedAt: parseOptional(row.started_at),
      finishedAt: parseOptional(row.finished_at),
      error: parseOptional(row.error),
      isRetry: row.is_retry === 1,
      createdAt: row.created_at,
    }));
  }

  private getExecution(executionId: string): TaskPlanExecutionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, task_id, conversation_id, status, started_at, finished_at, error, is_retry, created_at
         FROM task_plan_execution WHERE id = ?`,
      )
      .get(executionId) as
      | {
          id: string;
          task_id: string;
          conversation_id: string | null;
          status: string;
          started_at: string | null;
          finished_at: string | null;
          error: string | null;
          is_retry: number;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      taskId: row.task_id,
      conversationId: row.conversation_id ?? undefined,
      status: row.status as TaskPlanExecutionStatus,
      startedAt: parseOptional(row.started_at),
      finishedAt: parseOptional(row.finished_at),
      error: parseOptional(row.error),
      isRetry: row.is_retry === 1,
      createdAt: row.created_at,
    };
  }

  private listDependenciesFor(taskIds: readonly string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (taskIds.length === 0) return map;
    const placeholders = taskIds.map(() => '?').join(', ');
    const rows = this.raw
      .prepare(
        `SELECT task_id, depends_on_task_id FROM task_plan_dependency WHERE task_id IN (${placeholders})`,
      )
      .all(...taskIds) as Array<{ task_id: string; depends_on_task_id: string }>;
    for (const row of rows) {
      const list = map.get(row.task_id) ?? [];
      list.push(row.depends_on_task_id);
      map.set(row.task_id, list);
    }
    return map;
  }
}
