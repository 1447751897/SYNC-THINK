import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';
import { agentVersion } from './provider.js';
import { task } from './task.js';

export const agentGroup = sqliteTable(
  'agent_group',
  {
    id: idColumn('id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull().default('fixed'),
    visualIdentityJson: text('visual_identity_json')
      .notNull()
      .default('{"icon":"users","color":"#1faa74"}'),
    leadAgentVersionId: text('lead_agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    approvalMode: text('approval_mode').notNull().default('full'),
    collaborationMode: text('collaboration_mode').notNull().default('parallel'),
    maxConcurrency: integer('max_concurrency').notNull().default(3),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byUpdated: index('agent_group_updated_idx').on(t.updatedAt),
    kindCheck: check('agent_group_kind_check', sql`${t.kind} IN ('fixed', 'temporary')`),
    approvalModeCheck: check(
      'agent_group_approval_mode_check',
      sql`${t.approvalMode} IN ('request', 'delegate', 'full', 'custom')`,
    ),
    collaborationModeCheck: check(
      'agent_group_collaboration_mode_check',
      sql`${t.collaborationMode} IN ('parallel', 'sequential')`,
    ),
    concurrencyCheck: check(
      'agent_group_concurrency_check',
      sql`${t.maxConcurrency} BETWEEN 1 AND 16`,
    ),
    versionCheck: check('agent_group_version_check', sql`${t.version} > 0`),
  }),
);

export const agentGroupMember = sqliteTable(
  'agent_group_member',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => agentGroup.id, { onDelete: 'cascade' }),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    responsibility: text('responsibility').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.agentVersionId] }),
    byAgent: index('agent_group_member_agent_idx').on(t.agentVersionId),
    byOrder: index('agent_group_member_order_idx').on(t.groupId, t.sortOrder),
    orderCheck: check('agent_group_member_order_check', sql`${t.sortOrder} >= 0`),
  }),
);

export const groupTask = sqliteTable(
  'group_task',
  {
    taskId: text('task_id')
      .primaryKey()
      .references(() => task.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => agentGroup.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byGroup: index('group_task_group_idx').on(t.groupId),
  }),
);

export type AgentGroupRow = typeof agentGroup.$inferSelect;
export type AgentGroupMemberRow = typeof agentGroupMember.$inferSelect;
export type GroupTaskRow = typeof groupTask.$inferSelect;
