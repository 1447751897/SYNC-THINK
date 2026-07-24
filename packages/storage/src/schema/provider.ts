import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

export const provider = sqliteTable('provider', {
  id: idColumn('id'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  // boolean via integer; 0=false 1=true (drizzle mode: 'boolean')
  supportsDiscovery: integer('supports_discovery', { mode: 'boolean' }).notNull().default(false),
  /** Default adapter protocol for discovery / manual models when catalog empty. */
  protocol: text('protocol').notNull().default('openai-chat'),
  importedFrom: text('imported_from'),
  /** CC Switch-style surface: claude | codex | gemini | generic. */
  surface: text('surface').notNull().default('generic'),
  /** 0026: entry toggle — disabled providers hide from pickers but keep config. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** 0026: manual ordering; first enabled provider is the default entry. */
  sortOrder: integer('sort_order').notNull().default(0),
  ...tsColumns(),
});
export type ProviderRow = typeof provider.$inferSelect;

export const credentialGroup = sqliteTable('credential_group', {
  id: idColumn('id'),
  providerId: text('provider_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});
export type CredentialGroupRow = typeof credentialGroup.$inferSelect;

export const model = sqliteTable('model', {
  id: idColumn('id'),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  displayName: text('display_name').notNull(),
  protocol: text('protocol').notNull(),
  capabilitiesJson: text('capabilities_json').notNull().default('[]'),
  limitsJson: text('limits_json'),
  capabilitiesConfirmed: integer('capabilities_confirmed', { mode: 'boolean' }).notNull().default(false),
  /** 0026: priority chain inside a provider — 0 is the primary model. */
  priority: integer('priority').notNull().default(0),
  /** 0026: optional pinned credential (relay-station key groups expose different models). */
  credentialRefId: text('credential_ref_id'),
  createdAt: text('created_at').notNull(),
});
export type ModelRow = typeof model.$inferSelect;

export const agentVersion = sqliteTable('agent_version', {
  id: idColumn('id'),
  agentId: text('agent_id').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visualIdentityJson: text('visual_identity_json')
    .notNull()
    .default('{"icon":"bot","color":"#64748b"}'),
  role: text('role').notNull(),
  developerInstructions: text('developer_instructions').notNull(),
  inputContract: text('input_contract').notNull(),
  outputContract: text('output_contract').notNull(),
  defaultModelId: text('default_model_id').notNull(),
  defaultCredentialGroupId: text('default_credential_group_id').notNull(),
  pinnedCredentialRefId: text('pinned_credential_ref_id'),
  pauseOnFailure: integer('pause_on_failure', { mode: 'boolean' }).notNull().default(true),
  fallbackModelIdsJson: text('fallback_model_ids_json').notNull().default('[]'),
  memoryScope: text('memory_scope').notNull().default('task'),
  skillVersionIdsJson: text('skill_version_ids_json').notNull().default('[]'),
  mcpServerIdsJson: text('mcp_server_ids_json').notNull().default('[]'),
  mcpToolAllowlistJson: text('mcp_tool_allowlist_json').notNull().default('[]'),
  permissionsJson: text('permissions_json')
    .notNull()
    .default('{"file":[],"command":[],"browser":[],"desktop":[],"network":[]}'),
  policyId: text('policy_id'),
  approvalMode: text('approval_mode').notNull().default('request'),
  reviewBehaviorJson: text('review_behavior_json')
    .notNull()
    .default('{"role":"none","maxIterations":0,"onLimitReached":"pause"}'),
  artifactRulesJson: text('artifact_rules_json')
    .notNull()
    .default('{"retainVersions":true,"requireReview":false,"defaultStatus":"candidate"}'),
  createdAt: text('created_at').notNull(),
});
export type AgentVersionRow = typeof agentVersion.$inferSelect;
