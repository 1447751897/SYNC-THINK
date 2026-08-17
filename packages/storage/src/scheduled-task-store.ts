// 0044: 定时任务表（ScheduledTask）持久化。
// 规则/目标/最近结果以 JSON 列存储；nextRunAt 索引支撑心跳扫描。
import type { BetterSQLite3Raw } from './connection.js';
import type {
  ScheduledTask,
  ScheduledTaskHistoryEntry,
  ScheduledTaskRunResult,
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

function mapRow(row: ScheduledTaskRow): ScheduledTask {
  const target = parseJson<ScheduledTaskTarget>(
    JSON.stringify({
      kind: row.target_kind,
      ...(row.target_kind === 'agent'
        ? { agentId: row.target_ref }
        : { modelId: row.target_ref }),
    }),
    { kind: 'model', modelId: row.target_ref },
  );
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
    now?: string;
  }): ScheduledTask {
    const now = input.now ?? new Date().toISOString();
    const targetRef =
      input.target.kind === 'agent' ? input.target.agentId : input.target.modelId;
    this.raw
      .prepare(
        `INSERT INTO scheduled_task (
          id, name, instruction, target_kind, target_ref, rule_json, time_zone,
          enabled, next_run_at, conversation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.instruction,
        input.target.kind,
        targetRef,
        JSON.stringify(input.rule),
        input.timeZone,
        input.enabled ? 1 : 0,
        input.nextRunAt ?? null,
        input.conversationId ?? null,
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
        `SELECT * FROM scheduled_task ORDER BY created_at ASC${
          includeDisabled ? '' : ' WHERE enabled = 1'
        }`,
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
    };
    const targetRef = next.target.kind === 'agent' ? next.target.agentId : next.target.modelId;
    this.raw
      .prepare(
        `UPDATE scheduled_task SET
          name = ?, instruction = ?, target_kind = ?, target_ref = ?, rule_json = ?,
          time_zone = ?, enabled = ?, next_run_at = ?, last_run_at = ?,
          last_result_json = ?, conversation_id = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.name,
        next.instruction,
        next.target.kind,
        targetRef,
        JSON.stringify(next.rule),
        next.timeZone,
        next.enabled ? 1 : 0,
        next.nextRunAt ?? null,
        next.lastRunAt ?? null,
        next.lastResult ? JSON.stringify(next.lastResult) : null,
        next.conversationId ?? null,
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

  /** 最近执行历史（lastResult 快照 + 会话摘要，最多 N 条；按 firedAt 倒序）。 */
  listHistory(taskId: string, limit = 10): ScheduledTaskHistoryEntry[] {
    void taskId;
    void limit;
    // 历史来自任务会话消息流（run 事件回放），本 store 只提供 lastResult 快照；
    // 完整历史由 runtime 从会话事件构造。
    return [];
  }
}
