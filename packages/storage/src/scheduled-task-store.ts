// 0044: 定时任务表（ScheduledTask）持久化。
// 规则/目标/最近结果以 JSON 列存储；nextRunAt 索引支撑心跳扫描。
import type { BetterSQLite3Raw } from './connection.js';
import type {
  ScheduledTask,
  ScheduledTaskHistoryEntry,
  ScheduledTaskRunResult,
  ScheduledTaskRunStatus,
  ScheduledTaskTarget,
  TaskRule,
} from '@sync-think/shared';

interface ScheduledTaskRow {
  id: string;
  name: string;
  instruction: string;
  target_kind: string;
  target_ref: string;
  rule_json: string;
  time_zone: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result_json: string | null;
  conversation_id: string | null;
  workspace_id: string | null;
  skill_version_ids_json: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ScheduledTaskHistoryRow {
  id: string;
  task_id: string;
  status: string;
  fired_at: string;
  run_id: string | null;
  summary: string | null;
  reason: string | null;
  created_at: string;
}

function mapHistoryRow(row: ScheduledTaskHistoryRow): ScheduledTaskHistoryEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as ScheduledTaskHistoryEntry['status'],
    firedAt: row.fired_at,
    runId: row.run_id ?? undefined,
    summary: row.summary ?? undefined,
    reason: row.reason ?? undefined,
  };
}

function targetRefOf(target: ScheduledTaskTarget): string {
  if (target.kind === 'agent') return target.agentId;
  if (target.kind === 'model') return target.modelId;
  return target.teamId;
}

function mapRow(row: ScheduledTaskRow): ScheduledTask {
  const target = parseJson<ScheduledTaskTarget>(
    JSON.stringify({
      kind: row.target_kind,
      ...(row.target_kind === 'agent'
        ? { agentId: row.target_ref }
        : row.target_kind === 'team'
          ? { teamId: row.target_ref }
          : { modelId: row.target_ref }),
    }),
    { kind: 'model', modelId: row.target_ref },
  );
  const skillVersionIds = parseJson<string[]>(row.skill_version_ids_json, []);
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    target,
    rule: parseJson<TaskRule>(row.rule_json, { kind: 'every', intervalMinutes: 60 }),
    timeZone: row.time_zone,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastResult: row.last_result_json
      ? parseJson<ScheduledTaskRunResult>(row.last_result_json, undefined as never)
      : undefined,
    conversationId: row.conversation_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    skillVersionIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteScheduledTaskStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: {
    id: string;
    name: string;
    instruction: string;
    target: ScheduledTaskTarget;
    rule: TaskRule;
    timeZone: string;
    enabled: boolean;
    nextRunAt?: string;
    conversationId?: string;
    workspaceId?: string;
    skillVersionIds?: string[];
    now?: string;
  }): ScheduledTask {
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO scheduled_task (
          id, name, instruction, target_kind, target_ref, rule_json, time_zone,
          enabled, next_run_at, conversation_id, workspace_id, skill_version_ids_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.instruction,
        input.target.kind,
        targetRefOf(input.target),
        JSON.stringify(input.rule),
        input.timeZone,
        input.enabled ? 1 : 0,
        input.nextRunAt ?? null,
        input.conversationId ?? null,
        input.workspaceId ?? null,
        JSON.stringify(input.skillVersionIds ?? []),
        now,
        now,
      );
    return this.get(input.id)!;
  }

  get(id: string): ScheduledTask | undefined {
    const row = this.raw
      .prepare(`SELECT * FROM scheduled_task WHERE id = ?`)
      .get(id) as ScheduledTaskRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(includeDisabled = true): ScheduledTask[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM scheduled_task${includeDisabled ? '' : ' WHERE enabled = 1'} ORDER BY created_at ASC`,
      )
      .all() as ScheduledTaskRow[];
    return rows.map(mapRow);
  }

  update(
    id: string,
    patch: Partial<{
      name: string;
      instruction: string;
      target: ScheduledTaskTarget;
      rule: TaskRule;
      timeZone: string;
      enabled: boolean;
      nextRunAt?: string | null;
      lastRunAt?: string | null;
      lastResult?: ScheduledTaskRunResult | null;
      conversationId?: string | null;
      workspaceId?: string | null;
      skillVersionIds?: string[] | null;
    }>,
    now?: string,
  ): ScheduledTask | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const ts = now ?? new Date().toISOString();
    const next = {
      name: patch.name ?? current.name,
      instruction: patch.instruction ?? current.instruction,
      target: patch.target ?? current.target,
      rule: patch.rule ?? current.rule,
      timeZone: patch.timeZone ?? current.timeZone,
      enabled: patch.enabled ?? current.enabled,
      nextRunAt:
        patch.nextRunAt === undefined ? current.nextRunAt : (patch.nextRunAt ?? undefined),
      lastRunAt: patch.lastRunAt === undefined ? current.lastRunAt : (patch.lastRunAt ?? undefined),
      lastResult:
        patch.lastResult === undefined ? current.lastResult : (patch.lastResult ?? undefined),
      conversationId:
        patch.conversationId === undefined
          ? current.conversationId
          : (patch.conversationId ?? undefined),
      workspaceId:
        patch.workspaceId === undefined ? current.workspaceId : (patch.workspaceId ?? undefined),
      skillVersionIds:
        patch.skillVersionIds === undefined
          ? current.skillVersionIds
          : (patch.skillVersionIds ?? []),
    };
    this.raw
      .prepare(
        `UPDATE scheduled_task SET
          name = ?, instruction = ?, target_kind = ?, target_ref = ?, rule_json = ?,
          time_zone = ?, enabled = ?, next_run_at = ?, last_run_at = ?,
          last_result_json = ?, conversation_id = ?, workspace_id = ?,
          skill_version_ids_json = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.name,
        next.instruction,
        next.target.kind,
        targetRefOf(next.target),
        JSON.stringify(next.rule),
        next.timeZone,
        next.enabled ? 1 : 0,
        next.nextRunAt ?? null,
        next.lastRunAt ?? null,
        next.lastResult ? JSON.stringify(next.lastResult) : null,
        next.conversationId ?? null,
        next.workspaceId ?? null,
        JSON.stringify(next.skillVersionIds ?? []),
        ts,
        id,
      );
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.raw.prepare(`DELETE FROM scheduled_task WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /** 下一次到期任务（心跳扫描用）。 */
  listDue(now: string): ScheduledTask[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM scheduled_task WHERE enabled = 1 AND next_run_at IS NOT NULL
         AND next_run_at <= ? ORDER BY next_run_at ASC`,
      )
      .all(now) as ScheduledTaskRow[];
    return rows.map(mapRow);
  }

  /** 最近执行历史（每次触发一条；按 firedAt 倒序，最多 N 条）。 */
  listHistory(taskId: string, limit = 20): ScheduledTaskHistoryEntry[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM scheduled_task_history WHERE task_id = ?
         ORDER BY fired_at DESC LIMIT ?`,
      )
      .all(taskId, limit) as ScheduledTaskHistoryRow[];
    return rows.map(mapHistoryRow);
  }

  /** 写入一条执行历史（触发/失败/跳过时）。 */
  addHistoryEntry(input: {
    id: string;
    taskId: string;
    status: ScheduledTaskRunStatus;
    firedAt: string;
    runId?: string;
    reason?: string;
    now?: string;
  }): void {
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO scheduled_task_history (
          id, task_id, status, fired_at, run_id, summary, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.status,
        input.firedAt,
        input.runId ?? null,
        null,
        input.reason ?? null,
        now,
      );
  }

  /** run 终态后回填执行摘要（任务会话最后一条助手消息前 200 字）。 */
  updateHistorySummary(entryId: string, summary: string): void {
    this.raw
      .prepare(`UPDATE scheduled_task_history SET summary = ? WHERE id = ?`)
      .run(summary.slice(0, 200), entryId);
  }
}
