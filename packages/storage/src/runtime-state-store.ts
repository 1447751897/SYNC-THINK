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
import { EventPayloadSidecarStore, parseStoredEventPayload } from './event-payload-sidecar.js';

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

export interface EventCursor {
  sequence: number;
  eventId: string;
}

export interface ListEventPageInput {
  afterSequence: number;
  afterId?: string;
  throughSequence: number;
  throughId?: string;
  limit: number;
}

export interface EventPayloadExternalizationOptions {
  sidecar: EventPayloadSidecarStore;
  minimumBytes?: number;
  shouldExternalize?: (event: Event) => boolean;
  project?: (event: Event) => Record<string, unknown>;
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

function mapEventRow(row: EventDatabaseRow, sidecar?: EventPayloadSidecarStore): Event {
  return {
    id: row.id as EventId,
    workspaceId: row.workspaceId as WorkspaceId,
    ...(row.taskId === null ? {} : { taskId: row.taskId as TaskId }),
    ...(row.runId === null ? {} : { runId: row.runId as RunId }),
    ...(row.stepId === null ? {} : { stepId: row.stepId as StepId }),
    ...(row.messageId === null ? {} : { messageId: row.messageId as MessageId }),
    category: row.category as EventCategory,
    type: row.type,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    payload: sidecar
      ? parseStoredEventPayload(row.payloadJson, sidecar)
      : parseStoredEventPayload(row.payloadJson),
  };
}

export class SqliteEventCheckpointStore {
  constructor(
    private readonly raw: BetterSQLite3Raw,
    private readonly payloadExternalization?: EventPayloadExternalizationOptions,
  ) {}

  private serializeEventPayload(event: Event): string {
    const payloadJson = JSON.stringify(event.payload);
    const policy = this.payloadExternalization;
    if (!policy) return payloadJson;
    const minimumBytes = Math.max(1, Math.trunc(policy.minimumBytes ?? 64 * 1024));
    if (Buffer.byteLength(payloadJson, 'utf8') < minimumBytes) return payloadJson;
    if (policy.shouldExternalize && !policy.shouldExternalize(event)) return payloadJson;
    const projection = policy.project?.(event) ?? {};
    return JSON.stringify(policy.sidecar.writePayloadJson(payloadJson, projection));
  }

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
          this.serializeEventPayload(event),
        );
      }

      if (!transition.checkpoint) return { events };

      const checkpoint: Checkpoint = {
        ...transition.checkpoint,
        lastEventSequence: events[events.length - 1].sequence,
      };
      this.raw
        .prepare(
          `INSERT INTO checkpoint (
            id, run_id, last_event_sequence, state_json, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
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
        ORDER BY sequence ASC, id ASC`,
      )
      .all(workspaceId, afterSequence) as EventDatabaseRow[];

    return rows.map((row) => mapEventRow(row, this.payloadExternalization?.sidecar));
  }

  listEventsByRun(runId: RunId): Event[] {
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
        WHERE run_id = ?
        ORDER BY sequence ASC, id ASC`,
      )
      .all(runId) as EventDatabaseRow[];

    return rows.map((row) => mapEventRow(row, this.payloadExternalization?.sidecar));
  }

  /**
   * Reads the durable stream for one Task through event_task_idx. This keeps
   * task-local maintenance paths from materializing the global Event log.
   */
  listEventsByTask(taskId: TaskId): Event[] {
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
        FROM event INDEXED BY event_task_idx
        WHERE task_id = ?
        ORDER BY sequence ASC, id ASC`,
      )
      .all(taskId) as EventDatabaseRow[];

    return rows.map((row) => mapEventRow(row, this.payloadExternalization?.sidecar));
  }

  getLatestEventSequence(): number {
    return this.getLatestEventCursor().sequence;
  }

  getLatestEventCursor(): EventCursor {
    const row = this.raw
      .prepare('SELECT sequence, id FROM event ORDER BY sequence DESC, id DESC LIMIT 1')
      .get() as { sequence: number; id: string } | undefined;
    return row ? { sequence: row.sequence, eventId: row.id } : { sequence: 0, eventId: '' };
  }

  /**
   * Reads one strictly bounded global replay page ordered by (sequence, id).
   * Optional ids preserve sequence-only cursor compatibility while allowing
   * legacy duplicate sequences to span pages without omission or duplication.
   */
  listEventPage(input: ListEventPageInput): Event[] {
    const limit = Math.max(1, Math.min(1_000, Math.trunc(input.limit)));
    if (input.throughSequence < input.afterSequence) return [];
    const select = `SELECT
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
        FROM event`;

    // Keep each cursor shape as a concrete keyset range. A single query with
    // nullable OR predicates makes SQLite scan the complete cursor index for
    // every page, which turns a large replay into quadratic work.
    let sql: string;
    let params: readonly unknown[];
    if (input.afterId !== undefined && input.throughId !== undefined) {
      sql = `${select}
        WHERE (sequence, id) > (?, ?)
          AND (sequence, id) <= (?, ?)
        ORDER BY sequence ASC, id ASC
        LIMIT ?`;
      params = [
        input.afterSequence,
        input.afterId,
        input.throughSequence,
        input.throughId,
        limit,
      ];
    } else if (input.afterId !== undefined) {
      sql = `${select}
        WHERE (sequence, id) > (?, ?)
          AND sequence <= ?
        ORDER BY sequence ASC, id ASC
        LIMIT ?`;
      params = [input.afterSequence, input.afterId, input.throughSequence, limit];
    } else if (input.throughId !== undefined) {
      sql = `${select}
        WHERE sequence > ?
          AND (sequence, id) <= (?, ?)
        ORDER BY sequence ASC, id ASC
        LIMIT ?`;
      params = [input.afterSequence, input.throughSequence, input.throughId, limit];
    } else {
      sql = `${select}
        WHERE sequence > ?
          AND sequence <= ?
        ORDER BY sequence ASC, id ASC
        LIMIT ?`;
      params = [input.afterSequence, input.throughSequence, limit];
    }

    const rows = this.raw.prepare(sql).all(...params) as EventDatabaseRow[];
    return rows.map((row) => mapEventRow(row, this.payloadExternalization?.sidecar));
  }

  /**
   * Global durable replay. Historical databases may contain duplicate sequence
   * values from the former per-workspace allocator, so id is a stable tie-breaker.
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
        ORDER BY sequence ASC, id ASC`,
      )
      .all(afterSequence) as EventDatabaseRow[];
    return rows.map((row) => mapEventRow(row, this.payloadExternalization?.sidecar));
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
