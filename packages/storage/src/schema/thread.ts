import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

export const thread = sqliteTable('thread', {
  id: idColumn('id'),
  taskId: text('task_id').notNull(),
  createdAt: text('created_at').notNull(),
});
export type ThreadRow = typeof thread.$inferSelect;

export const message = sqliteTable(
  'message',
  {
    id: idColumn('id'),
    threadId: text('thread_id').notNull(),
    role: text('role').notNull(),
    agentVersionId: text('agent_version_id'),
    modelId: text('model_id'),
    credentialRefId: text('credential_ref_id'),
    runId: text('run_id'),
    stepId: text('step_id'),
    sequence: integer('sequence').notNull(),
    blocksJson: text('blocks_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    threadSequenceUnique: uniqueIndex('message_thread_sequence_uidx').on(t.threadId, t.sequence),
    byRun: index('message_run_idx').on(t.runId),
  }),
);
export type MessageRow = typeof message.$inferSelect;
