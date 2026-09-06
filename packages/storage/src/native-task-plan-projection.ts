import {
  reduceTaskPlanEvents,
  type Event,
  type TaskId,
  type TaskPlanState,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

interface ProjectionRow {
  threadId: string | null;
  sequence: number;
  eventId: string;
  stateJson: string;
}

interface SourceCursor {
  sequence: number;
  eventId: string;
}

export interface TaskPlanSnapshot {
  taskId: TaskId;
  threadId?: string;
  cursor: SourceCursor;
  state: TaskPlanState;
}

export class SqliteNativeTaskPlanProjection {
  private tableAvailable: boolean | undefined;

  constructor(
    private readonly raw: BetterSQLite3Raw,
    private readonly loadEvents: (taskId: TaskId) => Event[],
  ) {}

  private available(): boolean {
    this.tableAvailable ??= Boolean(
      this.raw
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'native_task_plan_projection'",
        )
        .get(),
    );
    return this.tableAvailable;
  }

  private row(taskId: TaskId): ProjectionRow | undefined {
    return this.raw
      .prepare(
        `SELECT thread_id AS threadId, last_event_sequence AS sequence,
      last_event_id AS eventId, state_json AS stateJson
      FROM native_task_plan_projection WHERE task_id = ?`,
      )
      .get(taskId) as ProjectionRow | undefined;
  }

  private cursor(taskId: TaskId, beforeSequence?: number): SourceCursor {
    const clause = beforeSequence === undefined ? '' : ' AND sequence < ?';
    const index = this.available() ? ' INDEXED BY event_task_cursor_idx' : '';
    return (
      (this.raw
        .prepare(
          `SELECT sequence, id AS eventId FROM event${index}
      WHERE task_id = ?${clause} ORDER BY sequence DESC, id DESC LIMIT 1`,
        )
        .get(...(beforeSequence === undefined ? [taskId] : [taskId, beforeSequence])) as
        SourceCursor | undefined) ?? { sequence: 0, eventId: '' }
    );
  }

  private matches(row: ProjectionRow, cursor: SourceCursor, threadId?: string): boolean {
    return (
      row.sequence === cursor.sequence &&
      row.eventId === cursor.eventId &&
      row.threadId === (threadId ?? null)
    );
  }

  private save(
    taskId: TaskId,
    threadId: string | undefined,
    cursor: SourceCursor,
    state: TaskPlanState,
  ): void {
    this.raw
      .prepare(
        `INSERT INTO native_task_plan_projection
      (task_id, thread_id, last_event_sequence, last_event_id, state_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET thread_id = excluded.thread_id,
        last_event_sequence = excluded.last_event_sequence, last_event_id = excluded.last_event_id,
        state_json = excluded.state_json`,
      )
      .run(taskId, threadId ?? null, cursor.sequence, cursor.eventId, JSON.stringify(state));
  }

  readCached(taskId: TaskId, threadId?: string): TaskPlanState | undefined {
    if (!this.available()) return;
    const cached = this.row(taskId);
    if (cached && this.matches(cached, this.cursor(taskId), threadId))
      return JSON.parse(cached.stateJson) as TaskPlanState;
    return undefined;
  }

  capture(taskId: TaskId, threadId?: string): TaskPlanSnapshot {
    return this.raw
      .transaction(() => ({
        taskId,
        threadId,
        cursor: this.cursor(taskId),
        state: reduceTaskPlanEvents(this.loadEvents(taskId), { taskId, threadId }),
      }))
      .deferred();
  }

  install(snapshot: TaskPlanSnapshot): boolean {
    if (!this.available() || this.raw.readonly) return false;
    return this.raw
      .transaction(() => {
        const cursor = this.cursor(snapshot.taskId);
        if (
          cursor.sequence !== snapshot.cursor.sequence ||
          cursor.eventId !== snapshot.cursor.eventId
        )
          return false;
        this.save(snapshot.taskId, snapshot.threadId, cursor, snapshot.state);
        return true;
      })
      .immediate();
  }

  read(taskId: TaskId, threadId?: string): TaskPlanState {
    const cached = this.readCached(taskId, threadId);
    if (cached) return cached;
    const snapshot = this.capture(taskId, threadId);
    this.install(snapshot);
    return snapshot.state;
  }

  updateExisting(events: readonly Event[]): void {
    if (!this.available()) return;
    const byTask = new Map<TaskId, Event[]>();
    for (const event of events) {
      if (!event.taskId) continue;
      const taskEvents = byTask.get(event.taskId) ?? [];
      taskEvents.push(event);
      byTask.set(event.taskId, taskEvents);
    }
    for (const [taskId, taskEvents] of byTask) {
      const cached = this.row(taskId);
      if (!cached) continue;
      const previous = this.cursor(taskId, taskEvents[0]!.sequence);
      const threadId = cached.threadId ?? undefined;
      if (!this.matches(cached, previous, threadId)) {
        this.raw.prepare('DELETE FROM native_task_plan_projection WHERE task_id = ?').run(taskId);
        continue;
      }
      const state = reduceTaskPlanEvents(
        taskEvents,
        { taskId, threadId },
        JSON.parse(cached.stateJson) as TaskPlanState,
      );
      const last = taskEvents[taskEvents.length - 1]!;
      this.save(taskId, threadId, { sequence: last.sequence, eventId: last.id }, state);
    }
  }
}
