import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const nativeTaskPlanProjection = sqliteTable('native_task_plan_projection', {
  taskId: text('task_id').primaryKey(),
  threadId: text('thread_id'),
  lastEventSequence: integer('last_event_sequence').notNull(),
  lastEventId: text('last_event_id').notNull(),
  stateJson: text('state_json').notNull(),
});
