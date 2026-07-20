import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

export const projectResource = sqliteTable('project_resource', {
  id: idColumn('id'),
  workspaceId: text('workspace_id').notNull(),
  type: text('resource_type').notNull(),
  localPath: text('local_path'),
  repositoryUrl: text('repository_url'),
  defaultRef: text('default_ref'),
  ...tsColumns(),
});

export const browserIdentity = sqliteTable('browser_identity', {
  id: idColumn('id'),
  name: text('name').notNull(),
  profilePath: text('profile_path').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  ...tsColumns(),
});

export const executionProfile = sqliteTable('execution_profile', {
  id: idColumn('id'),
  workspaceId: text('workspace_id'),
  name: text('name').notNull(),
  mode: text('mode').notNull().default('auto'),
  defaultRef: text('default_ref'),
  setupCommandsJson: text('setup_commands_json').notNull().default('[]'),
  includePatternsJson: text('include_patterns_json').notNull().default('[]'),
  retentionDays: integer('retention_days').notNull().default(7),
  browserIdentityId: text('browser_identity_id'),
  ...tsColumns(),
});

export const taskExecutionContext = sqliteTable('task_execution_context', {
  taskId: text('task_id').primaryKey(),
  resourceId: text('resource_id'),
  executionProfileId: text('execution_profile_id'),
  browserIdentityId: text('browser_identity_id'),
  mode: text('mode').notNull().default('none'),
  state: text('state').notNull().default('pending'),
  sourcePath: text('source_path'),
  executionPath: text('execution_path'),
  baseRef: text('base_ref'),
  headRef: text('head_ref'),
  leaseOwnerRunId: text('lease_owner_run_id'),
  blockedReason: text('blocked_reason'),
  cleanupAfter: text('cleanup_after'),
  ...tsColumns(),
});
