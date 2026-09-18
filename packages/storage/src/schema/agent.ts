import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';
import { workspace } from './workspace.js';

/**
 * Global agents — MUTABLE model (2026-07-22 decision, replaces the immutable
 * agent_version chain as the source of truth).
 *
 * An agent is a reusable global identity: persona + default model + equipment
 * (skills / MCP). Editing is a plain UPDATE — 改了就是改了. The legacy
 * agent_version table stays on disk only because historical orchestration
 * steps reference it (restrict FK); new code never appends to it.
 *
 * Permission gates still live on the conversation (the three-mode knob). The one
 * exception is `writePolicy`: a delegated child runs headless, so the
 * conversation knob cannot express "this Agent is a reviewer and must never
 * write" versus "this Agent merely happens to run inside an ask conversation".
 * See docs/adr/0001-delegated-agent-write-policy.md.
 */
export const agent = sqliteTable('agent', {
  id: idColumn('id'),
  name: text('name').notNull(),
  avatar: text('avatar').notNull().default(''),
  /** Persona / system instructions. */
  persona: text('persona').notNull().default(''),
  description: text('description').notNull().default(''),
  defaultModelId: text('default_model_id').notNull(),
  defaultCredentialGroupId: text('default_credential_group_id'),
  fallbackModelIdsJson: text('fallback_model_ids_json').notNull().default('[]'),
  /** Equipment travels with the agent into any project. */
  skillIdsJson: text('skill_ids_json').notNull().default('[]'),
  mcpServerIdsJson: text('mcp_server_ids_json').notNull().default('[]'),
  /** Reasoning-effort default offered on Compose ('auto' unless overridden). */
  reasoningEffort: text('reasoning_effort').notNull().default('auto'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  source: text('source').notNull().default('user'),
  availabilityScope: text('availability_scope').notNull().default('global'),
  /**
   * Delegated write policy.
   * - `read-only`: the Agent never writes when delegated.
   * - `inherit` (default): the child follows the conversation's permission mode, except in
   *   `ask`, where a headless child has no approval card to answer.
   */
  writePolicy: text('write_policy').notNull().default('inherit'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...tsColumns(),
});
export type AgentRow = typeof agent.$inferSelect;

export const agentWorkspaceActivation = sqliteTable(
  'agent_workspace_activation',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.workspaceId] }),
    byWorkspace: index('agent_workspace_activation_workspace_idx').on(
      table.workspaceId,
      table.active,
      table.updatedAt,
    ),
  }),
);

export type AgentWorkspaceActivationRow = typeof agentWorkspaceActivation.$inferSelect;
