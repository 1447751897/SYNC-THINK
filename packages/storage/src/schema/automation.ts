import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';
import { workspace } from './workspace.js';
import { task } from './task.js';
import { agentVersion } from './provider.js';
import { agentGroup } from './group.js';

export const automation = sqliteTable(
  'automation',
  {
    id: idColumn('id'),
    name: text('name').notNull(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'restrict' }),
    targetType: text('target_type').notNull(),
    agentVersionId: text('agent_version_id').references(() => agentVersion.id, { onDelete: 'restrict' }),
    groupId: text('group_id').references(() => agentGroup.id, { onDelete: 'restrict' }),
    instruction: text('instruction').notNull(),
    approvalMode: text('approval_mode').notNull().default('full'),
    triggerType: text('trigger_type').notNull(),
    cronExpression: text('cron_expression'),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    webhookPath: text('webhook_path'),
    webhookSecretHandle: text('webhook_secret_handle'),
    concurrencyPolicy: text('concurrency_policy').notNull().default('skip'),
    maxConcurrency: integer('max_concurrency').notNull().default(1),
    maxRetries: integer('max_retries').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(1),
    lastTriggeredAt: text('last_triggered_at'),
    nextTriggerAt: text('next_trigger_at'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byWorkspace: index('automation_workspace_idx').on(t.workspaceId, t.updatedAt),
    bySchedule: index('automation_schedule_idx').on(t.enabled, t.nextTriggerAt),
    webhookPathUnique: uniqueIndex('automation_webhook_path_uidx').on(t.webhookPath),
    targetCheck: check(
      'automation_target_check',
      sql`(${t.targetType} = 'agent' AND ${t.agentVersionId} IS NOT NULL AND ${t.groupId} IS NULL) OR (${t.targetType} = 'group' AND ${t.groupId} IS NOT NULL AND ${t.agentVersionId} IS NULL)`,
    ),
    triggerCheck: check(
      'automation_trigger_check',
      sql`(${t.triggerType} = 'cron' AND ${t.cronExpression} IS NOT NULL AND ${t.webhookPath} IS NULL AND ${t.webhookSecretHandle} IS NULL) OR (${t.triggerType} = 'webhook' AND ${t.cronExpression} IS NULL AND ${t.webhookPath} IS NOT NULL AND ${t.webhookSecretHandle} IS NOT NULL)`,
    ),
    concurrencyCheck: check('automation_concurrency_check', sql`${t.concurrencyPolicy} IN ('skip', 'queue', 'parallel')`),
    maxConcurrencyCheck: check('automation_max_concurrency_check', sql`${t.maxConcurrency} BETWEEN 1 AND 8`),
    maxRetriesCheck: check('automation_max_retries_check', sql`${t.maxRetries} BETWEEN 0 AND 2`),
    approvalCheck: check('automation_approval_mode_check', sql`${t.approvalMode} IN ('request', 'delegate', 'full', 'custom')`),
    versionCheck: check('automation_version_check', sql`${t.version} > 0`),
  }),
);

export const automationExecution = sqliteTable(
  'automation_execution',
  {
    id: idColumn('id'),
    automationId: text('automation_id').notNull().references(() => automation.id, { onDelete: 'restrict' }),
    triggerId: text('trigger_id').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(0),
    taskId: text('task_id').references(() => task.id, { onDelete: 'restrict' }),
    inputDigest: text('input_digest').notNull(),
    errorSummary: text('error_summary'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byAutomation: index('automation_execution_automation_idx').on(t.automationId, t.createdAt),
    byStatus: index('automation_execution_status_idx').on(t.status, t.createdAt),
    triggerAttemptUnique: uniqueIndex('automation_execution_trigger_attempt_uidx').on(t.triggerId, t.attempt),
    sourceCheck: check('automation_execution_source_check', sql`${t.source} IN ('schedule', 'webhook', 'manual')`),
    statusCheck: check('automation_execution_status_check', sql`${t.status} IN ('queued', 'running', 'completed', 'failed', 'skipped')`),
    attemptCheck: check('automation_execution_attempt_check', sql`${t.attempt} BETWEEN 0 AND 2`),
  }),
);
