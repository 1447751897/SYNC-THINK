import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { skillVersion } from './skill.js';
import { workspace } from './workspace.js';

export const capabilityWorkspaceActivation = sqliteTable(
  'capability_workspace_activation',
  {
    capabilityType: text('capability_type').notNull(),
    capabilityId: text('capability_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    active: integer('active', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.capabilityType, table.capabilityId, table.workspaceId],
    }),
    byWorkspace: index('capability_workspace_activation_workspace_idx').on(
      table.workspaceId,
      table.capabilityType,
      table.active,
      table.updatedAt,
    ),
  }),
);

export const capabilityUsageEvent = sqliteTable(
  'capability_usage_event',
  {
    id: text('id').primaryKey(),
    capabilityType: text('capability_type').notNull(),
    capabilityId: text('capability_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    agentId: text('agent_id'),
    agentVersionId: text('agent_version_id'),
    runId: text('run_id'),
    outcome: text('outcome').notNull(),
    contextTokens: integer('context_tokens').notNull().default(0),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => ({
    byCapability: index('capability_usage_event_lookup_idx').on(
      table.workspaceId,
      table.capabilityType,
      table.capabilityId,
      table.occurredAt,
    ),
    byRun: index('capability_usage_event_run_idx').on(
      table.runId,
      table.capabilityType,
      table.capabilityId,
    ),
  }),
);

export const skillPublishDraft = sqliteTable(
  'skill_publish_draft',
  {
    id: text('id').primaryKey(),
    skillVersionId: text('skill_version_id')
      .notNull()
      .references(() => skillVersion.id, { onDelete: 'restrict' }),
    skillId: text('skill_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull(),
    skillMd: text('skill_md').notNull(),
    category: text('category').notNull(),
    version: text('version').notNull(),
    icon: text('icon').notNull(),
    attachmentsJson: text('attachments_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    bySkill: index('skill_publish_draft_skill_idx').on(table.skillId, table.updatedAt),
  }),
);

export const capabilityOrganizeReport = sqliteTable(
  'capability_organize_report',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    contextBudgetTokens: integer('context_budget_tokens').notNull(),
    categoriesJson: text('categories_json').notNull(),
    summaryJson: text('summary_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    byWorkspace: index('capability_organize_report_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export type CapabilityWorkspaceActivationRow =
  typeof capabilityWorkspaceActivation.$inferSelect;
export type CapabilityUsageEventRow = typeof capabilityUsageEvent.$inferSelect;
export type SkillPublishDraftRow = typeof skillPublishDraft.$inferSelect;
export type CapabilityOrganizeReportRow = typeof capabilityOrganizeReport.$inferSelect;
