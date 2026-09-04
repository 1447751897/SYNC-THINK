import type { BetterSQLite3Raw } from './connection.js';

export const DEFAULT_ASSISTANT_TIMELINE_PAGE_LIMIT = 64;
export const MAX_ASSISTANT_TIMELINE_PAGE_LIMIT = 100;

export interface AssistantTimelineSegmentInput {
  id: string;
  sequence: number;
  value: Record<string, unknown>;
}

export interface StoredAssistantTimelineSegment extends AssistantTimelineSegmentInput {
  createdAt: string;
  updatedAt: string;
}

export interface AssistantTimelinePage {
  segments: StoredAssistantTimelineSegment[];
  totalSegments: number;
  nextCursor?: string;
}

interface AssistantTimelineRow {
  runId: string;
  segmentId: string;
  sequence: number;
  segmentJson: string;
  createdAt: string;
  updatedAt: string;
}

function encodeCursor(row: Pick<AssistantTimelineRow, 'sequence' | 'segmentId'>): string {
  return Buffer.from(`${row.sequence}\0${row.segmentId}`, 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
): { sequence: number; segmentId: string } | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('\0');
    if (separator <= 0) return undefined;
    const sequence = Number(decoded.slice(0, separator));
    const segmentId = decoded.slice(separator + 1);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !segmentId) return undefined;
    return { sequence, segmentId };
  } catch {
    return undefined;
  }
}

function pageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_ASSISTANT_TIMELINE_PAGE_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), MAX_ASSISTANT_TIMELINE_PAGE_LIMIT));
}

function requireRunId(runId: string): void {
  if (!runId || runId.length > 128) throw new Error('assistant_timeline.invalid_run_id');
}

function encodeSegment(input: AssistantTimelineSegmentInput): string {
  if (!input.id || input.id.length > 512) throw new Error('assistant_timeline.invalid_segment_id');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new Error('assistant_timeline.invalid_sequence');
  }
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
    throw new Error('assistant_timeline.invalid_segment');
  }
  let json: string;
  try {
    json = JSON.stringify(input.value);
  } catch {
    throw new Error('assistant_timeline.invalid_segment');
  }
  if (!json || JSON.parse(json) === null) throw new Error('assistant_timeline.invalid_segment');
  return json;
}

function mapRow(row: AssistantTimelineRow): StoredAssistantTimelineSegment {
  let value: unknown;
  try {
    value = JSON.parse(row.segmentJson);
  } catch {
    throw new Error('assistant_timeline.invalid_record');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('assistant_timeline.invalid_record');
  }
  return {
    id: row.segmentId,
    sequence: row.sequence,
    value: value as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_SEGMENTS = `SELECT
  run_id AS runId,
  segment_id AS segmentId,
  sequence,
  segment_json AS segmentJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM assistant_timeline_segment`;

/** Durable, append-friendly storage for the full assistant execution timeline. */
export class SqliteAssistantTimelineStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  upsertSegments(
    runId: string,
    segments: readonly AssistantTimelineSegmentInput[],
    now = new Date().toISOString(),
  ): number {
    requireRunId(runId);
    if (segments.length === 0) return 0;
    const statement = this.raw.prepare(
      `INSERT INTO assistant_timeline_segment (
         run_id, segment_id, sequence, segment_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, segment_id) DO UPDATE SET
         sequence = excluded.sequence,
         segment_json = excluded.segment_json,
         updated_at = excluded.updated_at
       WHERE assistant_timeline_segment.sequence <> excluded.sequence
          OR assistant_timeline_segment.segment_json <> excluded.segment_json`,
    );
    const encoded = segments.map((segment) => ({ segment, json: encodeSegment(segment) }));
    return this.raw.transaction(() => {
      let changed = 0;
      for (const { segment, json } of encoded) {
        changed += statement.run(runId, segment.id, segment.sequence, json, now, now).changes;
      }
      return changed;
    })();
  }

  listSegments(
    runId: string,
    options: { cursor?: string; limit?: number } = {},
  ): AssistantTimelinePage {
    requireRunId(runId);
    const limit = pageLimit(options.limit);
    const cursor = decodeCursor(options.cursor);
    const rows = (
      cursor
        ? this.raw
            .prepare(
              `${SELECT_SEGMENTS}
               WHERE run_id = ?
                 AND (sequence > ? OR (sequence = ? AND segment_id > ?))
               ORDER BY sequence ASC, segment_id ASC
               LIMIT ?`,
            )
            .all(runId, cursor.sequence, cursor.sequence, cursor.segmentId, limit + 1)
        : this.raw
            .prepare(
              `${SELECT_SEGMENTS}
               WHERE run_id = ?
               ORDER BY sequence ASC, segment_id ASC
               LIMIT ?`,
            )
            .all(runId, limit + 1)
    ) as AssistantTimelineRow[];
    const total = this.raw
      .prepare('SELECT COUNT(*) AS total FROM assistant_timeline_segment WHERE run_id = ?')
      .get(runId) as { total: number };
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      segments: pageRows.map(mapRow),
      totalSegments: Number(total.total),
      ...(hasMore && last ? { nextCursor: encodeCursor(last) } : {}),
    };
  }
}
