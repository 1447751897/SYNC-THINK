import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

// Append-only execution fact and audit log. Reconstructs Run state with
// checkpoint table on restart (§20 rules 1-7). Sequence is monotonic per
// workspace so subscribers can backpressure via cursor.
export const event = sqliteTable(
  'event',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id'),
    runId: text('run_id'),
    stepId: text('step_id'),
    messageId: text('message_id'),
    category: text('category').notNull(),
    type: text('type').notNull(),
    sequence: integer('sequence').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payloadJson: text('payload_json').notNull(),
  },
  (t) => ({
    byWorkspaceSeq: index('event_ws_seq_idx').on(t.workspaceId, t.sequence),
    byRun: index('event_run_idx').on(t.runId),
    byTask: index('event_task_idx').on(t.taskId),
  }),
);
export type EventRow = typeof event.$inferSelect;
