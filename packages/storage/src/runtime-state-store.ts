import type {
  Checkpoint,
  Event,
  EventCategory,
  EventId,
  MessageId,
  RunId,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type EventDraft = Omit<Event, 'sequence'>;
export type CheckpointDraft = Omit<Checkpoint, 'lastEventSequence'>;
export type EventDraftBatch = readonly [EventDraft, ...EventDraft[]];

export interface CommitTransitionInput {
  events: EventDraftBatch;
  checkpoint?: CheckpointDraft;
}

export interface CommittedTransition {
  events: Event[];
  checkpoint?: Checkpoint;
}

interface EventDatabaseRow {
  id: string;
  workspaceId: string;
  taskId: string | null;
  runId: string | null;
  stepId: string | null;
  messageId: string | null;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
  payloadJson: string;
}

interface CheckpointDatabaseRow {
  id: string;
  runId: string;
  lastEventSequence: number;
  stateJson: string;
  createdAt: string;
}

function parseRecord(json: string, field: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function mapEventRow(row: EventDatabaseRow): Event {
  return {
    id: row.id as EventId,
    workspaceId: row.workspaceId as WorkspaceId,
    taskId: row.taskId === null ? undefined : (row.taskId as TaskId),
    runId: row.runId === null ? undefined : (row.runId as RunId),
    stepId: row.stepId === null ? undefined : (row.stepId as StepId),
    messageId: row.messageId === null ? undefined : (row.messageId as MessageId),
    category: row.category as EventCategory,
    type: row.type,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    payload: parseRecord(row.payloadJson, 'event.payload_json'),
  };
}

export class SqliteEventCheckpointStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  commitTransition(input: CommitTransitionInput): CommittedTransition {
    if (input.events.length === 0) throw new Error('A transition requires at least one event');
    const workspaceId = input.events[0].workspaceId;
    if (input.events.some((event) => event.workspaceId !== workspaceId)) {
      throw new Error('A transition cannot span workspaces');
    }
    const transaction = this.raw.transaction((transition: CommitTransitionInput) => {
      const sequenceRow = this.raw
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM event')
        .get() as { sequence: number };
      const insertEvent = this.raw.prepare(
        `INSERT INTO event (
          id, workspace_id, task_id, run_id, step_id, message_id,
          category, type, sequence, occurred_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const events = transition.events.map((draft, index): Event => ({
        ...draft,
        sequence: sequenceRow.sequence + index + 1,
      }));
      for (const event of events) {
        insertEvent.run(
          event.id,
          event.workspaceId,
          event.taskId ?? null,
          event.runId ?? null,
          event.stepId ?? null,
          event.messageId ?? null,
          event.category,
          event.type,
          event.sequence,
          event.occurredAt,
          JSON.stringify(event.payload),
        );
      }

      if (!transition.checkpoint) return { events };

      const checkpoint: Checkpoint = {
        ...transition.checkpoint,
        lastEventSequence: events[events.length - 1].sequence,
      };
      const checkpointSql = checkpoint.id.startsWith('runtime-latest:')
        ? `INSERT INTO checkpoint (
            id, run_id, last_event_sequence, state_json, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            run_id = excluded.run_id,
            last_event_sequence = excluded.last_event_sequence,
            state_json = excluded.state_json,
            created_at = excluded.created_at`
        : `INSERT INTO checkpoint (
            id, run_id, last_event_sequence, state_json, created_at
          ) VALUES (?, ?, ?, ?, ?)`;
      this.raw
        .prepare(checkpointSql)
        .run(
          checkpoint.id,
          checkpoint.runId,
          checkpoint.lastEventSequence,
          JSON.stringify(checkpoint.state),
          checkpoint.createdAt,
        );
      return { events, checkpoint };
    });

    return transaction.immediate(input);
  }

  listEvents(workspaceId: WorkspaceId, afterSequence: number): Event[] {
    const rows = this.raw
      .prepare(
        `SELECT
          id,
          workspace_id AS workspaceId,
          task_id AS taskId,
          run_id AS runId,
          step_id AS stepId,
          message_id AS messageId,
          category,
          type,
          sequence,
          occurred_at AS occurredAt,
          payload_json AS payloadJson
        FROM event
        WHERE workspace_id = ? AND sequence > ?
        ORDER BY sequence ASC, rowid ASC`,
      )
      .all(workspaceId, afterSequence) as EventDatabaseRow[];

    return rows.map(mapEventRow);
  }

  /**
   * Global durable replay. Historical databases may contain duplicate sequence
   * values from the former per-workspace allocator, so rowid is a stable tie-breaker.
   */
  listAllEvents(afterSequence: number): Event[] {
    const rows = this.raw
      .prepare(
        `SELECT
          id,
          workspace_id AS workspaceId,
          task_id AS taskId,
          run_id AS runId,
          step_id AS stepId,
          message_id AS messageId,
          category,
          type,
          sequence,
          occurred_at AS occurredAt,
          payload_json AS payloadJson
        FROM event
        WHERE sequence > ?
        ORDER BY sequence ASC, rowid ASC`,
      )
      .all(afterSequence) as EventDatabaseRow[];
    return rows.map(mapEventRow);
  }

  loadLatestCheckpoint(runId: RunId): Checkpoint | undefined {
    const row = this.raw
      .prepare(
        `SELECT
          id,
          run_id AS runId,
          last_event_sequence AS lastEventSequence,
          state_json AS stateJson,
          created_at AS createdAt
        FROM checkpoint
        WHERE run_id = ?
        ORDER BY last_event_sequence DESC, created_at DESC
        LIMIT 1`,
      )
      .get(runId) as CheckpointDatabaseRow | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      runId: row.runId as RunId,
      lastEventSequence: row.lastEventSequence,
      state: parseRecord(row.stateJson, 'checkpoint.state_json'),
      createdAt: row.createdAt,
    };
  }
}
