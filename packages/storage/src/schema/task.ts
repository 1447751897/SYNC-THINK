import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

export const task = sqliteTable('task', {
  id: idColumn('id'),
  workspaceId: text('workspace_id').notNull(),
  parentTaskId: text('parent_task_id'),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  status: text('status').notNull().default('active'),
  participationMode: text('participation_mode').notNull().default('conversation'),
  /** Codex three-mode execution authority for this task. */
  executionMode: text('execution_mode').notNull().default('workspace'),
  acceptanceCriteriaJson: text('acceptance_criteria_json').notNull().default('[]'),
  // task_version supports optimistic concurrency on commands (side effects must
  // be deterministic & guarded by expectedTaskVersion per AI rules §5.1).
  version: integer('version').notNull().default(0),
  lastOpenedAt: text('last_opened_at'),
  ...tsColumns(),
});
export type TaskRow = typeof task.$inferSelect;
