import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

export const checkpoint = sqliteTable(
  'checkpoint',
  {
    id: idColumn('id'),
    runId: text('run_id').notNull(),
    lastEventSequence: integer('last_event_sequence').notNull(),
    stateJson: text('state_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byRun: index('checkpoint_run_idx').on(t.runId),
    byRunSeq: index('checkpoint_run_seq_idx').on(t.runId, t.lastEventSequence),
  }),
);
export type CheckpointRow = typeof checkpoint.$inferSelect;
