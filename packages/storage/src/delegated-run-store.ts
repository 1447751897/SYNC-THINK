import {
  delegatedRunFromEvent,
  type Event,
  type DelegatedRunRecord,
  type DelegatedRunRepository,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

const SELECT = `SELECT child_run_id AS childRunId, parent_run_id AS parentRunId,
  thread_id AS threadId, agent_id AS agentId, name, status, tool_count AS toolCount,
  result, updated_at AS updatedAt, sequence FROM delegated_run`;

function record(row: unknown): DelegatedRunRecord | undefined {
  if (!row) return undefined;
  const value = row as DelegatedRunRecord & { result: string | null };
  const { result, ...rest } = value;
  return { ...rest, ...(result !== null ? { result } : {}) };
}

export class SqliteDelegatedRunStore implements DelegatedRunRepository {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  /** Also supports repairing a missing projection by replaying durable events. */
  projectEvents(events: readonly Event[]): void {
    this.raw.transaction(() => this.projectEventsInTransaction(events)).immediate();
  }

  /** Called by the event-store transaction coordinator after event rows are visible. */
  projectEventsInTransaction(events: readonly Event[]): void {
    const records = events.map(delegatedRunFromEvent).filter((value) => value !== undefined);
    if (!records.length) return;
    for (const value of records) {
      const previous = this.get(value.childRunId);
      if (
        previous &&
        (previous.parentRunId !== value.parentRunId ||
          previous.threadId !== value.threadId ||
          previous.agentId !== value.agentId)
      )
        throw new Error('delegation.event_scope_mismatch');
      this.upsert(value);
    }
  }

  get(childRunId: string): DelegatedRunRecord | undefined {
    return record(this.raw.prepare(`${SELECT} WHERE child_run_id = ?`).get(childRunId));
  }

  listByThread(threadId: string): DelegatedRunRecord[] {
    return this.raw
      .prepare(`${SELECT} WHERE thread_id = ? ORDER BY updated_at, child_run_id`)
      .all(threadId)
      .map((row) => record(row)!);
  }

  upsert(value: DelegatedRunRecord): DelegatedRunRecord {
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      !Number.isSafeInteger(value.toolCount) ||
      value.toolCount < 0
    )
      throw new Error('delegation.invalid_record');
    this.raw
      .prepare(
        `INSERT INTO delegated_run
      (child_run_id, parent_run_id, thread_id, agent_id, name, status, tool_count, result, updated_at, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(child_run_id) DO UPDATE SET
        name = excluded.name, status = excluded.status, tool_count = excluded.tool_count,
        result = COALESCE(excluded.result, delegated_run.result),
        updated_at = excluded.updated_at, sequence = excluded.sequence
      WHERE excluded.sequence > delegated_run.sequence
        AND excluded.thread_id = delegated_run.thread_id
        AND excluded.parent_run_id = delegated_run.parent_run_id
        AND (delegated_run.status = 'running' OR delegated_run.status = excluded.status)`,
      )
      .run(
        value.childRunId,
        value.parentRunId,
        value.threadId,
        value.agentId,
        value.name,
        value.status,
        value.toolCount,
        value.result ?? null,
        value.updatedAt,
        value.sequence,
      );
    return this.get(value.childRunId)!;
  }
}
