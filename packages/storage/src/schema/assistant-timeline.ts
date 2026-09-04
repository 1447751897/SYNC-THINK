import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const assistantTimelineSegment = sqliteTable(
  'assistant_timeline_segment',
  {
    runId: text('run_id').notNull(),
    segmentId: text('segment_id').notNull(),
    sequence: integer('sequence').notNull(),
    segmentJson: text('segment_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    primary: primaryKey({ columns: [table.runId, table.segmentId] }),
    ordered: index('assistant_timeline_segment_order_idx').on(
      table.runId,
      table.sequence,
      table.segmentId,
    ),
    sequenceCheck: check('assistant_timeline_segment_sequence_check', sql`${table.sequence} >= 0`),
    jsonCheck: check(
      'assistant_timeline_segment_json_check',
      sql`json_valid(${table.segmentJson})`,
    ),
  }),
);
