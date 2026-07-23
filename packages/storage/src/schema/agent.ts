import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

/**
 * Global agents — MUTABLE model (2026-07-22 decision, replaces the immutable
 * agent_version chain as the source of truth).
 *
 * An agent is a reusable global identity: persona + default model + equipment
 * (skills / MCP). Editing is a plain UPDATE — 改了就是改了. The legacy
 * agent_version table stays on disk only because historical orchestration
 * steps reference it (restrict FK); new code never appends to it.
 *
 * NO permission/approval columns here: permission is the conversation-level
 * three-mode knob only. Agents carry capability, not gates.
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
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...tsColumns(),
});
export type AgentRow = typeof agent.$inferSelect;
