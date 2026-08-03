import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { task } from './task.js';
import { agentVersion } from './provider.js';

export const agentContextThread = sqliteTable(
  'agent_context_thread',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    agentVersionId: text('agent_version_id').notNull().references(() => agentVersion.id, { onDelete: 'restrict' }),
    workstreamKey: text('workstream_key').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    taskAgentWorkstream: uniqueIndex('agent_context_thread_task_agent_workstream_uidx').on(t.taskId, t.agentVersionId, t.workstreamKey),
    byTask: index('agent_context_thread_task_idx').on(t.taskId),
    statusCheck: check('agent_context_thread_status_check', sql`${t.status} IN ('active', 'closed')`),
  }),
);

export const contextEpoch = sqliteTable(
  'context_epoch',
  {
    id: text('id').primaryKey(),
    agentContextThreadId: text('agent_context_thread_id').notNull().references(() => agentContextThread.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    reasoningEffort: text('reasoning_effort'),
    contextWindow: integer('context_window'),
    parentEpochId: text('parent_epoch_id'),
    status: text('status').notNull().default('active'),
    startedAt: text('started_at').notNull(),
    closedAt: text('closed_at'),
  },
  (t) => ({
    byThread: index('context_epoch_thread_idx').on(t.agentContextThreadId, t.startedAt),
    activeUnique: uniqueIndex('context_epoch_active_uidx').on(t.agentContextThreadId).where(sql`${t.status} = 'active'`),
    parentForeignKey: foreignKey({ columns: [t.parentEpochId], foreignColumns: [t.id] }).onDelete('restrict'),
    statusCheck: check('context_epoch_status_check', sql`${t.status} IN ('active', 'closed')`),
    closedCheck: check('context_epoch_closed_check', sql`(${t.status} = 'active' AND ${t.closedAt} IS NULL) OR (${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL)`),
  }),
);

export type AgentContextThreadRow = typeof agentContextThread.$inferSelect;
export type ContextEpochRow = typeof contextEpoch.$inferSelect;
