import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';
import { workspace } from './workspace.js';

/**
 * NewMax-style structured task checklist (project_tasks parity), scoped to a
 * workspace instead of a project. Tasks persist across conversations and
 * restarts; the model maintains them through TaskCreate / TaskUpdate / TaskList
 * tools (chat tool layer), and the runtime aggregates the latest snapshot for
 * context injection and the composer capsule.
 */
export const taskPlan = sqliteTable(
  'task_plan',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** pending | in_progress | completed | cancelled */
    status: text('status').notNull().default('pending'),
    /** low | medium | high (NewMax priority parity). */
    priority: text('priority').notNull().default('medium'),
    estimatedMinutes: integer('estimated_minutes'),
    plannedStartAt: text('planned_start_at'),
    plannedEndAt: text('planned_end_at'),
    actualStartAt: text('actual_start_at'),
    actualEndAt: text('actual_end_at'),
    /** Order within the checklist (ascending). */
    sortOrder: integer('sort_order').notNull().default(0),
    ...tsColumns(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    byWorkspaceOrder: index('task_plan_workspace_order_idx').on(
      table.workspaceId,
      table.sortOrder,
      table.createdAt,
    ),
    byWorkspaceStatus: index('task_plan_workspace_status_idx').on(table.workspaceId, table.status),
  }),
);
export type TaskPlanRow = typeof taskPlan.$inferSelect;

/** task_id → depends_on_task_id (DAG edges, NewMax task_dependencies parity). */
export const taskPlanDependency = sqliteTable(
  'task_plan_dependency',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => taskPlan.id, { onDelete: 'cascade' }),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => taskPlan.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    byDependency: index('task_plan_dependency_depends_idx').on(table.dependsOnTaskId),
  }),
);

/** Per-attempt execution record (NewMax task_executions parity). */
export const taskPlanExecution = sqliteTable(
  'task_plan_execution',
  {
    id: idColumn('id'),
    taskId: text('task_id')
      .notNull()
      .references(() => taskPlan.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    /** pending | running | completed | failed | cancelled */
    status: text('status').notNull().default('pending'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    error: text('error'),
    isRetry: integer('is_retry', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    byTask: index('task_plan_execution_task_idx').on(table.taskId, table.createdAt),
  }),
);
export type TaskPlanExecutionRow = typeof taskPlanExecution.$inferSelect;
