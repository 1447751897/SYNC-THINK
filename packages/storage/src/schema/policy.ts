import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';
import { mcpServer } from './mcp.js';
import { agentVersion } from './provider.js';
import { skillVersion } from './skill.js';

export const policyVersion = sqliteTable(
  'policy_version',
  {
    id: idColumn('id'),
    policyId: text('policy_id').notNull(),
    version: integer('version').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    approvalMode: text('approval_mode').notNull().default('request'),
    rulesJson: text('rules_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byPolicyVersion: uniqueIndex('policy_version_policy_version_uidx').on(
      t.policyId,
      t.version,
    ),
    byScope: index('policy_version_scope_idx').on(t.scopeType, t.scopeId),
  }),
);

export type PolicyVersionRow = typeof policyVersion.$inferSelect;

export const authorizationGrantVersion = sqliteTable(
  'authorization_grant_version',
  {
    id: idColumn('id'),
    grantId: text('grant_id').notNull(),
    version: integer('version').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    targetType: text('target_type').notNull(),
    skillVersionId: text('skill_version_id').references(() => skillVersion.id, {
      onDelete: 'restrict',
    }),
    mcpServerId: text('mcp_server_id').references(() => mcpServer.id, {
      onDelete: 'restrict',
    }),
    toolsJson: text('tools_json'),
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byGrantVersion: uniqueIndex('authorization_grant_version_uidx').on(
      t.grantId,
      t.version,
    ),
    byScope: index('authorization_grant_scope_idx').on(t.scopeType, t.scopeId),
    byAgent: index('authorization_grant_agent_idx').on(t.agentVersionId),
    bySkill: index('authorization_grant_skill_idx').on(t.skillVersionId),
    byMcpServer: index('authorization_grant_mcp_server_idx').on(t.mcpServerId),
    positiveVersion: check('authorization_grant_version_positive_check', sql`${t.version} > 0`),
    validScope: check(
      'authorization_grant_scope_check',
      sql`${t.scopeType} IN ('user', 'workspace', 'project', 'task', 'run')`,
    ),
    validTarget: check(
      'authorization_grant_target_check',
      sql`(
        ${t.targetType} = 'skill'
        AND ${t.skillVersionId} IS NOT NULL
        AND ${t.mcpServerId} IS NULL
        AND ${t.toolsJson} IS NULL
      ) OR (
        ${t.targetType} = 'mcp'
        AND ${t.skillVersionId} IS NULL
        AND ${t.mcpServerId} IS NOT NULL
      )`,
    ),
  }),
);

export type AuthorizationGrantVersionRow = typeof authorizationGrantVersion.$inferSelect;
