// Migration runner: writes pending migrations, audit-records, and triggers a backup
// BEFORE applying any migration (搂20 rule 10). Implemented to run as `pnpm db:migrate`.

import { existsSync } from 'node:fs';
import { openDatabaseAsync, type Database } from '../connection.js';
import * as schema from '../schema/index.js';
import { backupDatabase } from '../backup.js';
import { FTS_MESSAGES_SQL, FTS_MESSAGES_TRIGGER_SQL } from '../fts.js';

// Phase 0 baseline migrations. Ordered; each migration name is unique and
// recorded in `migration_record` so re-running is idempotent.
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '0001_baseline_v1',
    sql: allDdlSql(),
  },
  {
    name: '0002_fts_messages',
    sql: `${FTS_MESSAGES_SQL}\n${FTS_MESSAGES_TRIGGER_SQL}`,
  },
  {
    name: '0003_memory_diagnostics',
    sql: memoryDiagnosticsDdlSql(),
  },
  {
    name: '0004_skill_version',
    sql: skillVersionDdlSql(),
  },
  {
    name: '0005_mcp_server',
    sql: mcpServerDdlSql(),
  },
  {
    name: '0006_approval_request',
    sql: approvalRequestDdlSql(),
  },
  {
    name: '0007_provider_protocol',
    sql: providerProtocolDdlSql(),
  },
  {
    name: '0008_provider_surface',
    sql: providerSurfaceDdlSql(),
  },
  {
    name: '0009_participation_policy',
    sql: participationPolicyDdlSql(),
  },
  {
    name: '0010_orchestration_core',
    sql: orchestrationCoreDdlSql(),
  },
  {
    name: '0011_artifact_versions',
    sql: artifactVersionsDdlSql(),
  },
  {
    name: '0012_artifact_integrity',
    sql: artifactIntegrityDdlSql(),
  },
  {
    name: '0013_durable_scheduler',
    sql: durableSchedulerDdlSql(),
  },
  {
    name: '0014_scheduler_fencing',
    sql: schedulerFencingDdlSql(),
  },
  {
    name: '0015_capability_authorization',
    sql: capabilityAuthorizationDdlSql(),
  },
  {
    name: '0016_production_execution',
    sql: productionExecutionDdlSql(),
  },
  {
    name: '0017_reviewer_rework',
    sql: reviewerReworkDdlSql(),
  },
  {
    name: '0018_complete_agent_version',
    sql: completeAgentVersionDdlSql(),
  },
  {
    name: '0019_review_source_evidence_integrity',
    sql: reviewSourceEvidenceIntegrityDdlSql(),
  },
  {
    name: '0020_review_bounds_integrity',
    sql: reviewBoundsIntegrityDdlSql(),
  },
  {
    name: '0021_merge_step_conflict_resolution',
    sql: mergeStepConflictResolutionDdlSql(),
  },
  {
    name: '0022_optional_project_folder',
    sql: optionalProjectFolderDdlSql(),
  },
  {
    name: '0023_provider_execution_checkpoint',
    sql: providerExecutionCheckpointDdlSql(),
  },
  {
    name: '0024_mutable_agent_team_conversation',
    sql: mutableAgentTeamConversationDdlSql(),
  },
  {
    name: '0025_conversation_task_binding',
    sql: conversationTaskBindingDdlSql(),
  },
];

function conversationTaskBindingDdlSql(): string {
  return `
-- P1.1 (2026-07-23): bind a lazily-created task to each conversation so the
-- message thread has a backing task. Null until the first message.
ALTER TABLE conversation ADD COLUMN task_id TEXT;
CREATE INDEX conversation_task_idx ON conversation(task_id);
`;
}

function mutableAgentTeamConversationDdlSql(): string {
  return `
-- 2026-07-22 model: mutable global agents/teams + first-class conversations.
-- The legacy agent_version chain stays for historical step FKs; the new
-- 'agent' table is seeded from each agentId's LATEST version and becomes the
-- single source of truth going forward.

CREATE TABLE agent (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  default_model_id TEXT NOT NULL,
  default_credential_group_id TEXT,
  fallback_model_ids_json TEXT NOT NULL DEFAULT '[]',
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
  reasoning_effort TEXT NOT NULL DEFAULT 'auto',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed from the latest agent_version per agentId (persona <- developer_instructions).
INSERT INTO agent (
  id, name, avatar, persona, description, default_model_id,
  default_credential_group_id, fallback_model_ids_json, skill_ids_json,
  mcp_server_ids_json, reasoning_effort, archived, created_at, updated_at
)
SELECT
  av.agent_id, av.name, '', av.developer_instructions, av.description,
  av.default_model_id, av.default_credential_group_id,
  av.fallback_model_ids_json, av.skill_version_ids_json,
  av.mcp_server_ids_json, 'auto', 0, av.created_at, av.created_at
FROM agent_version av
WHERE av.version = (
  SELECT MAX(v2.version) FROM agent_version v2 WHERE v2.agent_id = av.agent_id
);

CREATE TABLE team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  mission TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT 'serial',
  coordinator_agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT team_strategy_check CHECK (strategy IN ('serial','parallel'))
);

CREATE TABLE team_member (
  team_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  member_order INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  title TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, agent_id),
  CONSTRAINT team_member_order_check CHECK (member_order >= 0),
  FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX team_member_team_order_uidx ON team_member(team_id, member_order);
CREATE INDEX team_member_agent_idx ON team_member(agent_id);

CREATE TABLE team_run (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  roster_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT team_run_status_check CHECK (status IN ('running','completed','failed','cancelled')),
  CONSTRAINT team_run_snapshot_json_check CHECK (json_valid(roster_snapshot_json)),
  FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE RESTRICT
);
CREATE INDEX team_run_team_idx ON team_run(team_id);
CREATE INDEX team_run_conversation_idx ON team_run(conversation_id);

CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  track TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  pinned_at TEXT,
  archived_at TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'workspace',
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT conversation_track_check CHECK (track IN ('model','agent','team'))
);
CREATE INDEX conversation_workspace_idx ON conversation(workspace_id);
CREATE INDEX conversation_track_recency_idx ON conversation(track, last_message_at);
CREATE INDEX conversation_target_idx ON conversation(target_ref);

-- Retire the never-shipped immutable team template chain (created only in
-- code, never released; drop guards are IF EXISTS for fresh DBs).
DROP TABLE IF EXISTS team_template_member;
DROP TABLE IF EXISTS team_template_version;
DROP TABLE IF EXISTS team_template;
`;
}

function providerExecutionCheckpointDdlSql(): string {
  return `
CREATE TABLE provider_execution_checkpoint (
  idempotency_key TEXT PRIMARY KEY,
  checkpoint_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT provider_execution_checkpoint_json_check CHECK (json_valid(checkpoint_json)),
  FOREIGN KEY (idempotency_key)
    REFERENCES provider_execution_reservation(idempotency_key)
    ON DELETE RESTRICT
);
`;
}

function optionalProjectFolderDdlSql(): string {
  return `
-- Bundled SQLite supports DROP COLUMN and RENAME COLUMN. Replacing only this
-- column preserves the workspace table identity and artifact foreign keys while
-- removing the legacy NOT NULL constraint without disabling foreign_keys.
ALTER TABLE workspace ADD COLUMN folder_path_0022 TEXT;
UPDATE workspace SET folder_path_0022 = folder_path;
ALTER TABLE workspace DROP COLUMN folder_path;
ALTER TABLE workspace RENAME COLUMN folder_path_0022 TO folder_path;

CREATE UNIQUE INDEX workspace_folder_path_uidx
  ON workspace(lower(folder_path))
  WHERE folder_path IS NOT NULL;
`;
}

function mergeStepConflictResolutionDdlSql(): string {
  return `
ALTER TABLE step ADD COLUMN kind TEXT NOT NULL DEFAULT 'execution'
  CHECK (kind IN ('execution', 'merge'));

CREATE TABLE artifact_merge_conflict_resolution (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  conflict_id TEXT NOT NULL UNIQUE,
  resolution_version_id TEXT NOT NULL UNIQUE,
  strategy TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  resulting_task_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT artifact_conflict_resolution_strategy_check
    CHECK (strategy IN ('left', 'right', 'manual')),
  CONSTRAINT artifact_conflict_resolution_task_version_check
    CHECK (expected_task_version >= 0 AND resulting_task_version = expected_task_version + 1),
  FOREIGN KEY (conflict_id) REFERENCES artifact_merge_conflict(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);

CREATE TRIGGER artifact_conflict_resolution_append_only_update
BEFORE UPDATE ON artifact_merge_conflict_resolution
BEGIN
  SELECT RAISE(ABORT, 'artifact conflict resolutions are append-only');
END;

CREATE TRIGGER artifact_conflict_resolution_append_only_delete
BEFORE DELETE ON artifact_merge_conflict_resolution
BEGIN
  SELECT RAISE(ABORT, 'artifact conflict resolutions are append-only');
END;

CREATE TRIGGER artifact_conflict_resolution_ownership_insert
BEFORE INSERT ON artifact_merge_conflict_resolution
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM artifact_merge_conflict AS conflict
    JOIN artifact_version AS resolution
      ON resolution.id = NEW.resolution_version_id
     AND resolution.artifact_id = conflict.artifact_id
     AND resolution.source_run_id = conflict.run_id
     AND resolution.source_step_id = conflict.source_step_id
     AND resolution.status = 'merged'
    WHERE conflict.id = NEW.conflict_id
  ) THEN RAISE(ABORT, 'artifact conflict resolution ownership mismatch') END;
END;
`;
}

function reviewBoundsIntegrityDdlSql(): string {
  const whitespace =
    'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)';
  const normalizedNewDescription = `trim(NEW.description, ${whitespace})`;
  const normalizedOldDescription = `trim(description, ${whitespace})`;
  return `
CREATE TABLE review_bounds_0020_preflight (id INTEGER PRIMARY KEY);
CREATE TRIGGER review_bounds_0020_preflight_guard
BEFORE INSERT ON review_bounds_0020_preflight
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM acceptance_gate
    WHERE typeof(max_iterations) <> 'integer'
      OR max_iterations < 0
      OR max_iterations > 100
  ) THEN RAISE(ABORT, 'review.max_iterations_invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM acceptance_criterion
    WHERE length(${normalizedOldDescription}) = 0
  ) THEN RAISE(ABORT, 'acceptance_criteria.empty') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM acceptance_criterion
    WHERE length(CAST(${normalizedOldDescription} AS BLOB)) > 4000
  ) THEN RAISE(ABORT, 'acceptance_criteria.item_too_large') END;
  SELECT CASE WHEN EXISTS (
    SELECT gate_id FROM acceptance_criterion
    GROUP BY gate_id HAVING COUNT(*) > 64
  ) THEN RAISE(ABORT, 'acceptance_criteria.too_many') END;
  SELECT CASE WHEN EXISTS (
    SELECT gate_id FROM acceptance_criterion
    GROUP BY gate_id
    HAVING SUM(length(CAST(${normalizedOldDescription} AS BLOB))) > 65536
  ) THEN RAISE(ABORT, 'acceptance_criteria.total_too_large') END;
END;
INSERT INTO review_bounds_0020_preflight (id) VALUES (1);
DROP TRIGGER review_bounds_0020_preflight_guard;
DROP TABLE review_bounds_0020_preflight;

CREATE TRIGGER acceptance_gate_max_iterations_insert_guard
BEFORE INSERT ON acceptance_gate
WHEN typeof(NEW.max_iterations) <> 'integer'
  OR NEW.max_iterations < 0
  OR NEW.max_iterations > 100
BEGIN
  SELECT RAISE(ABORT, 'review.max_iterations_invalid');
END;

CREATE TRIGGER acceptance_gate_max_iterations_update_guard
BEFORE UPDATE OF max_iterations ON acceptance_gate
WHEN typeof(NEW.max_iterations) <> 'integer'
  OR NEW.max_iterations < 0
  OR NEW.max_iterations > 100
BEGIN
  SELECT RAISE(ABORT, 'review.max_iterations_invalid');
END;

CREATE TRIGGER acceptance_criterion_bounds_insert_guard
BEFORE INSERT ON acceptance_criterion
BEGIN
  SELECT CASE WHEN length(${normalizedNewDescription}) = 0
    THEN RAISE(ABORT, 'acceptance_criteria.empty') END;
  SELECT CASE WHEN length(CAST(${normalizedNewDescription} AS BLOB)) > 4000
    THEN RAISE(ABORT, 'acceptance_criteria.item_too_large') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM acceptance_criterion WHERE gate_id = NEW.gate_id
  ) >= 64 THEN RAISE(ABORT, 'acceptance_criteria.too_many') END;
  SELECT CASE WHEN COALESCE((
    SELECT SUM(length(CAST(${normalizedOldDescription} AS BLOB)))
    FROM acceptance_criterion WHERE gate_id = NEW.gate_id
  ), 0) + length(CAST(${normalizedNewDescription} AS BLOB)) > 65536
    THEN RAISE(ABORT, 'acceptance_criteria.total_too_large') END;
END;

CREATE TRIGGER acceptance_criterion_bounds_update_guard
BEFORE UPDATE ON acceptance_criterion
BEGIN
  SELECT CASE WHEN length(${normalizedNewDescription}) = 0
    THEN RAISE(ABORT, 'acceptance_criteria.empty') END;
  SELECT CASE WHEN length(CAST(${normalizedNewDescription} AS BLOB)) > 4000
    THEN RAISE(ABORT, 'acceptance_criteria.item_too_large') END;
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM acceptance_criterion
    WHERE gate_id = NEW.gate_id
      AND NOT (gate_id = OLD.gate_id AND id = OLD.id)
  ) >= 64 THEN RAISE(ABORT, 'acceptance_criteria.too_many') END;
  SELECT CASE WHEN COALESCE((
    SELECT SUM(length(CAST(${normalizedOldDescription} AS BLOB)))
    FROM acceptance_criterion
    WHERE gate_id = NEW.gate_id
      AND NOT (gate_id = OLD.gate_id AND id = OLD.id)
  ), 0) + length(CAST(${normalizedNewDescription} AS BLOB)) > 65536
    THEN RAISE(ABORT, 'acceptance_criteria.total_too_large') END;
END;
`;
}

function reviewSourceEvidenceIntegrityDdlSql(): string {
  return `
CREATE TRIGGER acceptance_gate_step_source_evidence_insert_guard
BEFORE INSERT ON acceptance_gate_step
WHEN (NEW.derivation = 'initial' AND NEW.source_evidence_id IS NOT NULL)
  OR (NEW.derivation <> 'initial' AND NOT EXISTS (
    SELECT 1
    FROM review_evidence AS source_evidence
    WHERE source_evidence.id = NEW.source_evidence_id
      AND source_evidence.gate_id = NEW.gate_id
      AND source_evidence.run_id = NEW.run_id
      AND source_evidence.verdict = 'reject'
      AND source_evidence.iteration = CASE
        WHEN NEW.derivation = 'reassign' THEN NEW.iteration
        ELSE NEW.iteration - 1
      END
  ))
BEGIN
  SELECT RAISE(ABORT, 'review.source_evidence_mismatch');
END;

CREATE TRIGGER acceptance_gate_step_source_evidence_update_guard
BEFORE UPDATE OF gate_id, run_id, role, iteration, derivation, source_evidence_id
  ON acceptance_gate_step
WHEN (NEW.derivation = 'initial' AND NEW.source_evidence_id IS NOT NULL)
  OR (NEW.derivation <> 'initial' AND NOT EXISTS (
    SELECT 1
    FROM review_evidence AS source_evidence
    WHERE source_evidence.id = NEW.source_evidence_id
      AND source_evidence.gate_id = NEW.gate_id
      AND source_evidence.run_id = NEW.run_id
      AND source_evidence.verdict = 'reject'
      AND source_evidence.iteration = CASE
        WHEN NEW.derivation = 'reassign' THEN NEW.iteration
        ELSE NEW.iteration - 1
      END
  ))
BEGIN
  SELECT RAISE(ABORT, 'review.source_evidence_mismatch');
END;
`;
}

function completeAgentVersionDdlSql(): string {
  return `
ALTER TABLE agent_version
  ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_version
  ADD COLUMN visual_identity_json TEXT NOT NULL DEFAULT '{"icon":"bot","color":"#64748b"}';
ALTER TABLE agent_version
  ADD COLUMN mcp_tool_allowlist_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_version
  ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{"file":[],"command":[],"browser":[],"desktop":[],"network":[]}';
ALTER TABLE agent_version
  ADD COLUMN review_behavior_json TEXT NOT NULL DEFAULT '{"role":"none","maxIterations":0,"onLimitReached":"pause"}';
ALTER TABLE agent_version
  ADD COLUMN artifact_rules_json TEXT NOT NULL DEFAULT '{"retainVersions":true,"requireReview":false,"defaultStatus":"candidate"}';
`;
}

// All table DDL concatenated for migration 0001. Keeps the single source of
// truth at Drizzle; for Phase 0 we accept JSON-encoded arrays (not enforced via FK)
// so triggers/FTS tables can evolve independently.
function allDdlSql(): string {
  // The migration applies CREATE TABLE statements derived from the schema.
  // In Phase 0 we use drizzle-kit generate to produce SQL; here we provide a
  // hand-maintained template that mirrors the Drizzle schema and is verified by
  // a schema-shape test (TypeScript-safe).
  return `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  folder_path TEXT NOT NULL,
  name TEXT NOT NULL,
  policy_id TEXT,
  ui_prefs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_version_id TEXT,
  model_id TEXT,
  credential_ref_id TEXT,
  run_id TEXT,
  step_id TEXT,
  sequence INTEGER NOT NULL,
  blocks_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  step_id TEXT,
  message_id TEXT,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_ws_seq_idx ON event(workspace_id, sequence);
CREATE INDEX IF NOT EXISTS event_run_idx ON event(run_id);
CREATE INDEX IF NOT EXISTS event_task_idx ON event(task_id);
CREATE TABLE IF NOT EXISTS checkpoint (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  last_event_sequence INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkpoint_run_idx ON checkpoint(run_id);
CREATE INDEX IF NOT EXISTS checkpoint_run_seq_idx ON checkpoint(run_id, last_event_sequence);
CREATE TABLE IF NOT EXISTS provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  supports_discovery INTEGER NOT NULL DEFAULT 0,
  imported_from TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_group (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  limits_json TEXT,
  capabilities_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_version (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  developer_instructions TEXT NOT NULL,
  input_contract TEXT NOT NULL,
  output_contract TEXT NOT NULL,
  default_model_id TEXT NOT NULL,
  default_credential_group_id TEXT NOT NULL,
  pinned_credential_ref_id TEXT,
  pause_on_failure INTEGER NOT NULL DEFAULT 1,
  fallback_model_ids_json TEXT NOT NULL DEFAULT '[]',
  memory_scope TEXT NOT NULL DEFAULT 'task',
  skill_version_ids_json TEXT NOT NULL DEFAULT '[]',
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
  policy_id TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'request',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_ref (
  id TEXT PRIMARY KEY,
  credential_group_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  store_handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
`;
}

export interface MigrationPlanResult {
  applied: string[];
  skipped: string[];
  backupPath?: string;
}

function memoryDiagnosticsDdlSql(): string {
  return `
CREATE TABLE IF NOT EXISTS memory_change (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  target_scope TEXT NOT NULL DEFAULT 'task',
  additions_json TEXT NOT NULL DEFAULT '[]',
  modifications_json TEXT NOT NULL DEFAULT '[]',
  deprecations_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  unresolved_ambiguity TEXT,
  approval_state TEXT NOT NULL DEFAULT 'pending',
  proposed_by_run_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS memory_change_ws_idx ON memory_change(workspace_id);
CREATE INDEX IF NOT EXISTS memory_change_task_idx ON memory_change(task_id);
CREATE INDEX IF NOT EXISTS memory_change_state_idx ON memory_change(approval_state);
CREATE TABLE IF NOT EXISTS memory_entry (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  scope TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  entry_value TEXT NOT NULL,
  source_change_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_entry_ws_idx ON memory_entry(workspace_id);
CREATE INDEX IF NOT EXISTS memory_entry_task_idx ON memory_entry(task_id);
CREATE INDEX IF NOT EXISTS memory_entry_key_idx ON memory_entry(workspace_id, entry_key);
CREATE TABLE IF NOT EXISTS diagnostic_record (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  category TEXT NOT NULL,
  failure_class TEXT,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostic_ws_idx ON diagnostic_record(workspace_id);
CREATE INDEX IF NOT EXISTS diagnostic_run_idx ON diagnostic_record(run_id);
CREATE INDEX IF NOT EXISTS diagnostic_created_idx ON diagnostic_record(created_at);
`;
}

function skillVersionDdlSql(): string {
  return `
CREATE TABLE IF NOT EXISTS skill_version (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL,
  source_md TEXT NOT NULL,
  body TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  content_fingerprint TEXT NOT NULL,
  has_scripts INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS skill_version_skill_idx ON skill_version(skill_id);
CREATE INDEX IF NOT EXISTS skill_version_name_idx ON skill_version(name);
CREATE INDEX IF NOT EXISTS skill_version_fp_idx ON skill_version(content_fingerprint);
`;
}

function approvalRequestDdlSql(): string {
  return `
CREATE TABLE IF NOT EXISTS approval_request (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  step_id TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  human_only INTEGER NOT NULL DEFAULT 0,
  human_only_action TEXT,
  mode TEXT NOT NULL DEFAULT 'request',
  gate TEXT NOT NULL DEFAULT 'require-human',
  state TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decision_note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS approval_request_ws_state_idx
  ON approval_request(workspace_id, state, created_at);
CREATE INDEX IF NOT EXISTS approval_request_pending_idx
  ON approval_request(state, human_only, created_at);
`;
}

function mcpServerDdlSql(): string {
  return `
CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'local-stdio',
  endpoint TEXT NOT NULL DEFAULT '',
  tools_json TEXT NOT NULL DEFAULT '[]',
  trusted INTEGER NOT NULL DEFAULT 0,
  max_output_bytes INTEGER NOT NULL DEFAULT 65536,
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_server_name_idx ON mcp_server(name);
`;
}

function providerSurfaceDdlSql(): string {
  // CC Switch-style app surface for hierarchical model picking (claude/codex/gemini/generic).
  return `
ALTER TABLE provider ADD COLUMN surface TEXT NOT NULL DEFAULT 'generic';
`;
}

function providerProtocolDdlSql(): string {
  // Provider default protocol for discovery routing when model catalog is empty (搂7.2).
  // SQLite ALTER ADD COLUMN is idempotent enough when migration_record gates re-run.
  return `
ALTER TABLE provider ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai-chat';
`;
}

function participationPolicyDdlSql(): string {
  return `
ALTER TABLE task ADD COLUMN participation_mode TEXT NOT NULL DEFAULT 'conversation';
CREATE TABLE policy_version (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  approval_mode TEXT NOT NULL DEFAULT 'request',
  rules_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX policy_version_policy_version_uidx
  ON policy_version(policy_id, version);
CREATE INDEX policy_version_scope_idx
  ON policy_version(scope_type, scope_id);
`;
}

function orchestrationCoreDdlSql(): string {
  return `
CREATE TABLE plan (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE RESTRICT
);
CREATE INDEX plan_task_idx ON plan(task_id);

CREATE TABLE plan_revision (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  diff_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  approved_at TEXT,
  CONSTRAINT plan_revision_state_check CHECK (
    state IN ('draft', 'approved', 'superseded')
  ),
  FOREIGN KEY (plan_id) REFERENCES plan(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX plan_revision_plan_revision_uidx
  ON plan_revision(plan_id, revision);
CREATE INDEX plan_revision_plan_state_idx
  ON plan_revision(plan_id, state);

CREATE TABLE run (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  plan_revision_id TEXT NOT NULL,
  workflow_version_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT run_state_check CHECK (
    state IN (
      'conversation', 'planDraft', 'awaitingPlanApproval', 'queued', 'running',
      'awaitingToolApproval', 'reviewing', 'revising', 'completed', 'paused',
      'blocked', 'failed', 'cancelled'
    )
  ),
  FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE RESTRICT,
  FOREIGN KEY (plan_revision_id) REFERENCES plan_revision(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX run_plan_revision_uidx ON run(plan_revision_id);
CREATE INDEX run_task_state_idx ON run(task_id, state);

CREATE TABLE step (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  model_override_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  retries INTEGER NOT NULL DEFAULT 0,
  retry_of_step_id TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT step_state_check CHECK (
    state IN (
      'pending', 'ready', 'running', 'awaitingApproval', 'completed',
      'failed', 'skipped', 'cancelled'
    )
  ),
  PRIMARY KEY (run_id, id),
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX step_run_order_uidx ON step(run_id, plan_order);
CREATE INDEX step_run_state_idx ON step(run_id, state);
CREATE INDEX step_agent_version_idx ON step(agent_version_id);

CREATE TABLE step_dependency (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  depends_on_step_id TEXT NOT NULL,
  PRIMARY KEY (run_id, step_id, depends_on_step_id),
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, step_id) REFERENCES step(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, depends_on_step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT
);
CREATE INDEX step_dependency_run_dependency_idx
  ON step_dependency(run_id, depends_on_step_id);
`;
}

function durableSchedulerDdlSql(): string {
  return `
CREATE UNIQUE INDEX step_idempotency_key_uidx
  ON step(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER step_idempotency_key_insert_guard
BEFORE INSERT ON step
WHEN NEW.idempotency_key IS NOT NULL
  AND (length(trim(NEW.idempotency_key)) = 0 OR length(NEW.idempotency_key) > 256)
BEGIN
  SELECT RAISE(ABORT, 'step.idempotency_key invalid');
END;

CREATE TRIGGER step_idempotency_key_update_guard
BEFORE UPDATE OF idempotency_key ON step
WHEN NEW.idempotency_key IS NOT NULL
  AND (length(trim(NEW.idempotency_key)) = 0 OR length(NEW.idempotency_key) > 256)
BEGIN
  SELECT RAISE(ABORT, 'step.idempotency_key invalid');
END;

CREATE UNIQUE INDEX event_run_terminal_uidx
  ON event(run_id)
  WHERE run_id IS NOT NULL
    AND type IN ('run.completed', 'run.failed', 'run.cancelled');

CREATE UNIQUE INDEX event_step_terminal_uidx
  ON event(run_id, step_id)
  WHERE run_id IS NOT NULL AND step_id IS NOT NULL
    AND type IN ('step.completed', 'step.failed', 'step.cancelled');
`;
}

function schedulerFencingDdlSql(): string {
  return `
ALTER TABLE step ADD COLUMN execution_owner_id TEXT;
ALTER TABLE step ADD COLUMN lease_expires_at TEXT;
ALTER TABLE step ADD COLUMN execution_attempt INTEGER NOT NULL DEFAULT 0;

CREATE INDEX step_execution_lease_idx ON step(state, lease_expires_at);

CREATE TRIGGER step_execution_insert_guard
BEFORE INSERT ON step
WHEN NEW.execution_attempt < 0
  OR (NEW.state = 'running' AND (NEW.execution_owner_id IS NULL OR NEW.lease_expires_at IS NULL))
  OR (NEW.state <> 'running' AND NEW.lease_expires_at IS NOT NULL)
  OR (NEW.state IN ('pending', 'ready', 'awaitingApproval', 'skipped', 'cancelled')
    AND NEW.execution_owner_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'step.execution_fence invalid');
END;

CREATE TRIGGER step_execution_update_guard
BEFORE UPDATE OF state, execution_owner_id, lease_expires_at, execution_attempt ON step
WHEN NEW.execution_attempt < 0
  OR (NEW.state = 'running' AND (NEW.execution_owner_id IS NULL OR NEW.lease_expires_at IS NULL))
  OR (NEW.state <> 'running' AND NEW.lease_expires_at IS NOT NULL)
  OR (NEW.state IN ('pending', 'ready', 'awaitingApproval', 'skipped', 'cancelled')
    AND NEW.execution_owner_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'step.execution_fence invalid');
END;

CREATE TABLE step_output_artifact (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  artifact_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_id, idempotency_key, outcome, artifact_version_id),
  CONSTRAINT step_output_artifact_outcome_check CHECK (outcome IN ('completed', 'failed')),
  FOREIGN KEY (run_id, step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX step_output_artifact_version_uidx
  ON step_output_artifact(artifact_version_id);
CREATE INDEX step_output_artifact_transition_idx
  ON step_output_artifact(run_id, step_id, idempotency_key, outcome);

WITH legacy_terminal_event AS (
  SELECT
    event.run_id,
    event.step_id,
    event.occurred_at,
    event.payload_json,
    json_extract(event.payload_json, '$.idempotencyKey') AS idempotency_key,
    CASE event.type WHEN 'step.completed' THEN 'completed' ELSE 'failed' END AS outcome
  FROM event
  JOIN step ON step.run_id = event.run_id AND step.id = event.step_id
  JOIN run ON run.id = event.run_id
  JOIN task ON task.id = run.task_id
  WHERE event.category = 'step'
    AND (
      (event.type = 'step.completed' AND step.state = 'completed') OR
      (event.type = 'step.failed' AND step.state = 'failed')
    )
    AND event.task_id = run.task_id
    AND event.workspace_id = task.workspace_id
    AND json_valid(event.payload_json)
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_type(event.payload_json, '$.idempotencyKey') ELSE NULL END = 'text'
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_extract(event.payload_json, '$.idempotencyKey') ELSE NULL END = step.idempotency_key
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_type(event.payload_json, '$.artifactVersionIds') ELSE NULL END = 'array'
    AND (
      SELECT COUNT(*)
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      )
    ) = (
      SELECT COUNT(DISTINCT CAST(value AS TEXT))
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      ) AS output
      LEFT JOIN artifact_version ON artifact_version.id = CAST(output.value AS TEXT)
      LEFT JOIN artifact ON artifact.id = artifact_version.artifact_id
      WHERE output.type <> 'text'
        OR artifact_version.id IS NULL
        OR artifact.id IS NULL
        OR artifact_version.source_run_id <> event.run_id
        OR artifact_version.source_step_id <> event.step_id
        OR artifact.run_id <> event.run_id
        OR artifact.task_id <> event.task_id
        OR artifact.workspace_id <> event.workspace_id
    )
)
INSERT INTO step_output_artifact (
  run_id, step_id, idempotency_key, outcome, artifact_version_id, created_at
)
SELECT
  legacy_terminal_event.run_id,
  legacy_terminal_event.step_id,
  legacy_terminal_event.idempotency_key,
  legacy_terminal_event.outcome,
  CAST(output.value AS TEXT),
  legacy_terminal_event.occurred_at
FROM legacy_terminal_event
JOIN json_each(
  legacy_terminal_event.payload_json,
  '$.artifactVersionIds'
) AS output;

WITH legacy_terminal_event AS (
  SELECT event.run_id, event.step_id
  FROM event
  JOIN step ON step.run_id = event.run_id AND step.id = event.step_id
  JOIN run ON run.id = event.run_id
  JOIN task ON task.id = run.task_id
  WHERE event.category = 'step'
    AND (
      (event.type = 'step.completed' AND step.state = 'completed') OR
      (event.type = 'step.failed' AND step.state = 'failed')
    )
    AND event.task_id = run.task_id
    AND event.workspace_id = task.workspace_id
    AND json_valid(event.payload_json)
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_type(event.payload_json, '$.idempotencyKey') ELSE NULL END = 'text'
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_extract(event.payload_json, '$.idempotencyKey') ELSE NULL END = step.idempotency_key
    AND CASE WHEN json_valid(event.payload_json)
      THEN json_type(event.payload_json, '$.artifactVersionIds') ELSE NULL END = 'array'
    AND (
      SELECT COUNT(*)
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      )
    ) = (
      SELECT COUNT(DISTINCT CAST(value AS TEXT))
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
        CASE WHEN json_valid(event.payload_json) THEN event.payload_json ELSE '{}' END,
        '$.artifactVersionIds'
      ) AS output
      LEFT JOIN artifact_version ON artifact_version.id = CAST(output.value AS TEXT)
      LEFT JOIN artifact ON artifact.id = artifact_version.artifact_id
      WHERE output.type <> 'text'
        OR artifact_version.id IS NULL
        OR artifact.id IS NULL
        OR artifact_version.source_run_id <> event.run_id
        OR artifact_version.source_step_id <> event.step_id
        OR artifact.run_id <> event.run_id
        OR artifact.task_id <> event.task_id
        OR artifact.workspace_id <> event.workspace_id
    )
)
UPDATE step
SET execution_owner_id = 'migration:0014:legacy-terminal',
    execution_attempt = 1
WHERE EXISTS (
  SELECT 1
  FROM legacy_terminal_event
  WHERE legacy_terminal_event.run_id = step.run_id
    AND legacy_terminal_event.step_id = step.id
);

CREATE TRIGGER step_execution_owner_reserved_insert
BEFORE INSERT ON step
WHEN NEW.execution_owner_id = 'migration:0014:legacy-terminal'
BEGIN
  SELECT RAISE(ABORT, 'step.execution_owner_reserved');
END;

CREATE TRIGGER step_execution_owner_reserved_update
BEFORE UPDATE OF execution_owner_id ON step
WHEN NEW.execution_owner_id = 'migration:0014:legacy-terminal'
BEGIN
  SELECT RAISE(ABORT, 'step.execution_owner_reserved');
END;

CREATE TRIGGER step_output_artifact_append_only_update
BEFORE UPDATE ON step_output_artifact
BEGIN
  SELECT RAISE(ABORT, 'step output mappings are append-only');
END;
CREATE TRIGGER step_output_artifact_append_only_delete
BEFORE DELETE ON step_output_artifact
BEGIN
  SELECT RAISE(ABORT, 'step output mappings are append-only');
END;
`;
}

function capabilityAuthorizationDdlSql(): string {
  return `
CREATE TABLE authorization_grant_version (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  skill_version_id TEXT,
  mcp_server_id TEXT,
  tools_json TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CONSTRAINT authorization_grant_version_positive_check CHECK (version > 0),
  CONSTRAINT authorization_grant_scope_check CHECK (
    scope_type IN ('user', 'workspace', 'project', 'task', 'run')
  ),
  CONSTRAINT authorization_grant_revoked_check CHECK (revoked IN (0, 1)),
  CONSTRAINT authorization_grant_text_check CHECK (
    length(trim(grant_id)) > 0 AND length(grant_id) <= 256
    AND length(trim(scope_id)) > 0 AND length(scope_id) <= 256
    AND length(trim(agent_version_id)) > 0 AND length(agent_version_id) <= 256
    AND length(trim(created_at)) > 0
  ),
  CONSTRAINT authorization_grant_target_check CHECK (
    (
      target_type = 'skill'
      AND skill_version_id IS NOT NULL
      AND mcp_server_id IS NULL
      AND tools_json IS NULL
    ) OR (
      target_type = 'mcp'
      AND skill_version_id IS NULL
      AND mcp_server_id IS NOT NULL
    )
  ),
  CONSTRAINT authorization_grant_tools_json_check CHECK (
    tools_json IS NULL OR CASE
      WHEN json_valid(tools_json) THEN json_type(tools_json) = 'array'
      ELSE 0
    END
  ),
  FOREIGN KEY (agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (skill_version_id) REFERENCES skill_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_server(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX authorization_grant_version_uidx
  ON authorization_grant_version(grant_id, version);
CREATE INDEX authorization_grant_scope_idx
  ON authorization_grant_version(scope_type, scope_id);
CREATE INDEX authorization_grant_agent_idx
  ON authorization_grant_version(agent_version_id);
CREATE INDEX authorization_grant_skill_idx
  ON authorization_grant_version(skill_version_id);
CREATE INDEX authorization_grant_mcp_server_idx
  ON authorization_grant_version(mcp_server_id);

CREATE TRIGGER authorization_grant_identity_insert_guard
BEFORE INSERT ON authorization_grant_version
WHEN EXISTS (
  SELECT 1 FROM authorization_grant_version AS prior
  WHERE prior.grant_id = NEW.grant_id
    AND (
      prior.scope_type <> NEW.scope_type
      OR prior.scope_id <> NEW.scope_id
      OR prior.agent_version_id <> NEW.agent_version_id
      OR prior.target_type <> NEW.target_type
      OR COALESCE(prior.skill_version_id, '') <> COALESCE(NEW.skill_version_id, '')
      OR COALESCE(prior.mcp_server_id, '') <> COALESCE(NEW.mcp_server_id, '')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'authorization.grant_identity_mismatch');
END;

CREATE TRIGGER authorization_grant_version_insert_guard
BEFORE INSERT ON authorization_grant_version
WHEN NEW.version <> COALESCE(
  (SELECT MAX(version) + 1 FROM authorization_grant_version WHERE grant_id = NEW.grant_id),
  1
)
BEGIN
  SELECT RAISE(ABORT, 'authorization.version_not_next');
END;

CREATE TRIGGER authorization_grant_tools_insert_guard
BEFORE INSERT ON authorization_grant_version
WHEN NEW.tools_json IS NOT NULL AND EXISTS (
  SELECT 1
  FROM json_each(
    CASE
      WHEN json_valid(NEW.tools_json) AND json_type(NEW.tools_json) = 'array'
        THEN NEW.tools_json
      ELSE '[]'
    END
  ) AS tool
  WHERE tool.type <> 'text'
    OR length(trim(CAST(tool.value AS TEXT))) = 0
    OR length(CAST(tool.value AS TEXT)) > 256
)
BEGIN
  SELECT RAISE(ABORT, 'authorization.tools_invalid');
END;

CREATE TRIGGER authorization_grant_append_only_update
BEFORE UPDATE ON authorization_grant_version
BEGIN
  SELECT RAISE(ABORT, 'authorization grants are append-only');
END;

CREATE TRIGGER authorization_grant_append_only_delete
BEFORE DELETE ON authorization_grant_version
BEGIN
  SELECT RAISE(ABORT, 'authorization grants are append-only');
END;
`;
}

function productionExecutionDdlSql(): string {
  return `
CREATE TABLE provider_execution_reservation (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  execution_owner_id TEXT NOT NULL,
  execution_attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CONSTRAINT provider_execution_reservation_attempt_check CHECK (execution_attempt > 0),
  CONSTRAINT provider_execution_reservation_state_check CHECK (state IN ('started', 'released', 'completed')),
  CONSTRAINT provider_execution_reservation_result_check CHECK (
    (state IN ('started', 'released') AND result_json IS NULL AND completed_at IS NULL) OR
    (state = 'completed' AND result_json IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT provider_execution_reservation_result_json_check CHECK (
    result_json IS NULL OR json_valid(result_json)
  ),
  FOREIGN KEY (run_id, step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT
);
CREATE INDEX provider_execution_reservation_step_idx
  ON provider_execution_reservation(run_id, step_id);

CREATE TRIGGER provider_execution_reservation_identity_guard
BEFORE UPDATE ON provider_execution_reservation
WHEN OLD.idempotency_key <> NEW.idempotency_key
  OR OLD.run_id <> NEW.run_id
  OR OLD.step_id <> NEW.step_id
  OR OLD.agent_version_id <> NEW.agent_version_id
  OR (
    (OLD.execution_owner_id <> NEW.execution_owner_id OR OLD.execution_attempt <> NEW.execution_attempt)
    AND NOT (OLD.state = 'released' AND NEW.state = 'started')
  )
  OR OLD.created_at <> NEW.created_at
  OR OLD.state = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'provider.execution_reservation_immutable');
END;
CREATE TRIGGER provider_execution_reservation_delete_guard
BEFORE DELETE ON provider_execution_reservation
BEGIN
  SELECT RAISE(ABORT, 'provider.execution_reservation_immutable');
END;

CREATE TABLE mcp_action_execution_intent (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  execution_owner_id TEXT NOT NULL,
  execution_attempt INTEGER NOT NULL,
  action_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, step_id, action_digest),
  CONSTRAINT mcp_action_execution_attempt_check CHECK (execution_attempt > 0),
  CONSTRAINT mcp_action_execution_digest_check CHECK (
    length(action_digest) = 64 AND action_digest NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT mcp_action_execution_state_check CHECK (state IN ('intent', 'started', 'completed')),
  FOREIGN KEY (run_id, step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT
);
CREATE INDEX mcp_action_execution_intent_state_idx
  ON mcp_action_execution_intent(state, updated_at);

CREATE TRIGGER mcp_action_execution_identity_guard
BEFORE UPDATE ON mcp_action_execution_intent
WHEN OLD.run_id <> NEW.run_id
  OR OLD.step_id <> NEW.step_id
  OR OLD.agent_version_id <> NEW.agent_version_id
  OR OLD.execution_owner_id <> NEW.execution_owner_id
  OR OLD.execution_attempt <> NEW.execution_attempt
  OR OLD.action_digest <> NEW.action_digest
  OR OLD.created_at <> NEW.created_at
  OR OLD.state = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'mcp.action_intent_immutable');
END;
CREATE TRIGGER mcp_action_execution_delete_guard
BEFORE DELETE ON mcp_action_execution_intent
BEGIN
  SELECT RAISE(ABORT, 'mcp.action_intent_immutable');
END;
`;
}

function reviewerReworkDdlSql(): string {
  return `
CREATE TABLE acceptance_gate (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  target_step_id TEXT NOT NULL,
  reviewer_agent_version_id TEXT NOT NULL,
  backup_agent_version_id TEXT,
  max_iterations INTEGER NOT NULL,
  on_limit_reached TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  reassigned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CONSTRAINT acceptance_gate_iteration_check CHECK (max_iterations >= 0),
  CONSTRAINT acceptance_gate_limit_check CHECK (on_limit_reached IN ('pause', 'abort', 'reassign')),
  CONSTRAINT acceptance_gate_state_check CHECK (state IN ('active', 'accepted', 'limit-reached')),
  CONSTRAINT acceptance_gate_reassigned_check CHECK (reassigned IN (0, 1)),
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, target_step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewer_agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (backup_agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT,
  UNIQUE (run_id, target_step_id),
  UNIQUE (id, run_id, target_step_id)
);
CREATE INDEX acceptance_gate_run_state_idx ON acceptance_gate(run_id, state);

CREATE TRIGGER acceptance_gate_identity_guard
BEFORE UPDATE ON acceptance_gate
WHEN OLD.id <> NEW.id
  OR OLD.run_id <> NEW.run_id
  OR OLD.target_step_id <> NEW.target_step_id
  OR OLD.reviewer_agent_version_id <> NEW.reviewer_agent_version_id
  OR COALESCE(OLD.backup_agent_version_id, '') <> COALESCE(NEW.backup_agent_version_id, '')
  OR OLD.max_iterations <> NEW.max_iterations
  OR OLD.on_limit_reached <> NEW.on_limit_reached
  OR OLD.created_at <> NEW.created_at
  OR OLD.reassigned > NEW.reassigned
  OR (OLD.reassigned = 1 AND NEW.reassigned <> 1)
  OR OLD.state = 'accepted'
  OR (OLD.state = 'limit-reached' AND NEW.state NOT IN ('limit-reached', 'accepted'))
  OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'accepted', 'limit-reached'))
BEGIN
  SELECT RAISE(ABORT, 'review.gate_immutable');
END;
CREATE TRIGGER acceptance_gate_delete_guard
BEFORE DELETE ON acceptance_gate
BEGIN
  SELECT RAISE(ABORT, 'review.gate_immutable');
END;

CREATE TABLE acceptance_criterion (
  gate_id TEXT NOT NULL,
  id TEXT NOT NULL,
  description TEXT NOT NULL,
  plan_order INTEGER NOT NULL,
  PRIMARY KEY (gate_id, id),
  UNIQUE (gate_id, plan_order),
  CONSTRAINT acceptance_criterion_id_check CHECK (length(trim(id)) BETWEEN 1 AND 256),
  CONSTRAINT acceptance_criterion_description_check CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  CONSTRAINT acceptance_criterion_order_check CHECK (plan_order >= 0),
  FOREIGN KEY (gate_id) REFERENCES acceptance_gate(id) ON DELETE RESTRICT
);
CREATE TRIGGER acceptance_criterion_update_guard
BEFORE UPDATE ON acceptance_criterion
BEGIN
  SELECT RAISE(ABORT, 'review.criterion_immutable');
END;
CREATE TRIGGER acceptance_criterion_delete_guard
BEFORE DELETE ON acceptance_criterion
BEGIN
  SELECT RAISE(ABORT, 'review.criterion_immutable');
END;

CREATE TABLE review_evidence (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  target_step_id TEXT NOT NULL,
  reviewer_step_id TEXT NOT NULL,
  reviewer_agent_version_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, reviewer_step_id),
  UNIQUE (id, gate_id),
  CONSTRAINT review_evidence_iteration_check CHECK (iteration >= 0),
  CONSTRAINT review_evidence_verdict_check CHECK (verdict IN ('accept', 'reject')),
  CONSTRAINT review_evidence_explanation_check CHECK (length(trim(explanation)) BETWEEN 1 AND 4000),
  FOREIGN KEY (gate_id, run_id, target_step_id)
    REFERENCES acceptance_gate(id, run_id, target_step_id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, reviewer_step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewer_agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT
);
CREATE INDEX review_evidence_gate_iteration_idx ON review_evidence(gate_id, iteration, created_at);
CREATE TRIGGER review_evidence_insert_guard
BEFORE INSERT ON review_evidence
WHEN NOT EXISTS (
  SELECT 1
  FROM acceptance_gate_step AS gate_step
  JOIN step AS reviewer_step
    ON reviewer_step.run_id = gate_step.run_id AND reviewer_step.id = gate_step.step_id
  JOIN acceptance_gate AS gate_row ON gate_row.id = gate_step.gate_id
  WHERE gate_step.gate_id = NEW.gate_id
    AND gate_step.run_id = NEW.run_id
    AND gate_step.step_id = NEW.reviewer_step_id
    AND gate_step.role = 'reviewer'
    AND gate_step.iteration = NEW.iteration
    AND reviewer_step.agent_version_id = NEW.reviewer_agent_version_id
    AND (
      (gate_step.derivation = 'reassign'
        AND gate_row.backup_agent_version_id = NEW.reviewer_agent_version_id)
      OR
      (gate_step.derivation <> 'reassign'
        AND gate_row.reviewer_agent_version_id = NEW.reviewer_agent_version_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_reviewer_mismatch');
END;
CREATE TRIGGER review_evidence_update_guard
BEFORE UPDATE ON review_evidence
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;
CREATE TRIGGER review_evidence_delete_guard
BEFORE DELETE ON review_evidence
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;

CREATE TABLE review_evidence_criterion (
  evidence_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  explanation TEXT NOT NULL,
  PRIMARY KEY (evidence_id, criterion_id),
  CONSTRAINT review_evidence_criterion_verdict_check CHECK (verdict IN ('pass', 'fail')),
  CONSTRAINT review_evidence_criterion_explanation_check CHECK (length(trim(explanation)) BETWEEN 1 AND 4000),
  FOREIGN KEY (evidence_id, gate_id) REFERENCES review_evidence(id, gate_id) ON DELETE RESTRICT,
  FOREIGN KEY (gate_id, criterion_id) REFERENCES acceptance_criterion(gate_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER review_evidence_criterion_update_guard
BEFORE UPDATE ON review_evidence_criterion
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;
CREATE TRIGGER review_evidence_criterion_delete_guard
BEFORE DELETE ON review_evidence_criterion
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;

CREATE TABLE review_evidence_artifact (
  evidence_id TEXT NOT NULL,
  artifact_version_id TEXT NOT NULL,
  PRIMARY KEY (evidence_id, artifact_version_id),
  FOREIGN KEY (evidence_id) REFERENCES review_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE TRIGGER review_evidence_artifact_update_guard
BEFORE UPDATE ON review_evidence_artifact
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;
CREATE TRIGGER review_evidence_artifact_delete_guard
BEFORE DELETE ON review_evidence_artifact
BEGIN
  SELECT RAISE(ABORT, 'review.evidence_immutable');
END;

CREATE TABLE acceptance_gate_step (
  gate_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  role TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  derivation TEXT NOT NULL,
  source_evidence_id TEXT,
  PRIMARY KEY (run_id, step_id),
  UNIQUE (gate_id, run_id, step_id),
  UNIQUE (gate_id, role, iteration, derivation),
  CONSTRAINT acceptance_gate_step_role_check CHECK (role IN ('reviewer', 'rework')),
  CONSTRAINT acceptance_gate_step_iteration_check CHECK (iteration >= 0),
  CONSTRAINT acceptance_gate_step_derivation_check CHECK (derivation IN ('initial', 'rework', 'reassign')),
  CONSTRAINT acceptance_gate_step_shape_check CHECK (
    (role = 'reviewer' AND derivation = 'initial' AND iteration = 0 AND source_evidence_id IS NULL)
    OR (role = 'rework' AND derivation = 'rework' AND iteration > 0 AND source_evidence_id IS NOT NULL)
    OR (role = 'reviewer' AND derivation IN ('rework', 'reassign') AND source_evidence_id IS NOT NULL)
  ),
  FOREIGN KEY (gate_id) REFERENCES acceptance_gate(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (source_evidence_id) REFERENCES review_evidence(id) ON DELETE RESTRICT
);
CREATE TRIGGER acceptance_gate_step_insert_guard
BEFORE INSERT ON acceptance_gate_step
WHEN NOT EXISTS (
  SELECT 1
  FROM acceptance_gate AS gate_row
  JOIN step AS derived_step ON derived_step.run_id = NEW.run_id AND derived_step.id = NEW.step_id
  JOIN step AS target_step
    ON target_step.run_id = gate_row.run_id AND target_step.id = gate_row.target_step_id
  WHERE gate_row.id = NEW.gate_id
    AND gate_row.run_id = NEW.run_id
    AND (
      (NEW.role = 'rework' AND derived_step.agent_version_id = target_step.agent_version_id)
      OR (NEW.role = 'reviewer' AND NEW.derivation <> 'reassign'
        AND derived_step.agent_version_id = gate_row.reviewer_agent_version_id)
      OR (NEW.role = 'reviewer' AND NEW.derivation = 'reassign'
        AND derived_step.agent_version_id = gate_row.backup_agent_version_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review.gate_step_scope_mismatch');
END;
CREATE TRIGGER acceptance_gate_step_update_guard
BEFORE UPDATE ON acceptance_gate_step
BEGIN
  SELECT RAISE(ABORT, 'review.gate_step_immutable');
END;
CREATE TRIGGER acceptance_gate_step_delete_guard
BEFORE DELETE ON acceptance_gate_step
BEGIN
  SELECT RAISE(ABORT, 'review.gate_step_immutable');
END;

CREATE TABLE review_step_artifact (
  gate_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reviewer_step_id TEXT NOT NULL,
  artifact_version_id TEXT NOT NULL,
  PRIMARY KEY (run_id, reviewer_step_id, artifact_version_id),
  FOREIGN KEY (gate_id, run_id, reviewer_step_id)
    REFERENCES acceptance_gate_step(gate_id, run_id, step_id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE TRIGGER review_step_artifact_insert_guard
BEFORE INSERT ON review_step_artifact
WHEN NOT EXISTS (
  SELECT 1
  FROM acceptance_gate_step AS reviewer_mapping
  JOIN acceptance_gate AS gate_row ON gate_row.id = reviewer_mapping.gate_id
  JOIN artifact_version AS version_row ON version_row.id = NEW.artifact_version_id
  WHERE reviewer_mapping.gate_id = NEW.gate_id
    AND reviewer_mapping.run_id = NEW.run_id
    AND reviewer_mapping.step_id = NEW.reviewer_step_id
    AND reviewer_mapping.role = 'reviewer'
    AND version_row.source_run_id = NEW.run_id
    AND (
      version_row.source_step_id = gate_row.target_step_id
      OR EXISTS (
        SELECT 1 FROM acceptance_gate_step AS rework_mapping
        WHERE rework_mapping.gate_id = NEW.gate_id
          AND rework_mapping.run_id = NEW.run_id
          AND rework_mapping.step_id = version_row.source_step_id
          AND rework_mapping.role = 'rework'
          AND rework_mapping.iteration <= reviewer_mapping.iteration
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review.artifact_scope_mismatch');
END;
CREATE TRIGGER review_step_artifact_update_guard
BEFORE UPDATE ON review_step_artifact
BEGIN
  SELECT RAISE(ABORT, 'review.assignment_immutable');
END;
CREATE TRIGGER review_step_artifact_delete_guard
BEFORE DELETE ON review_step_artifact
BEGIN
  SELECT RAISE(ABORT, 'review.assignment_immutable');
END;

CREATE TRIGGER review_evidence_artifact_assignment_guard
BEFORE INSERT ON review_evidence_artifact
WHEN NOT EXISTS (
  SELECT 1
  FROM review_evidence AS evidence_row
  JOIN review_step_artifact AS assignment
    ON assignment.run_id = evidence_row.run_id
   AND assignment.reviewer_step_id = evidence_row.reviewer_step_id
   AND assignment.artifact_version_id = NEW.artifact_version_id
  WHERE evidence_row.id = NEW.evidence_id
)
BEGIN
  SELECT RAISE(ABORT, 'review.artifact_scope_mismatch');
END;

CREATE UNIQUE INDEX event_review_limit_uidx
  ON event(run_id, json_extract(payload_json, '$.gateId'))
  WHERE type = 'review.limit-reached';
`;
}

function artifactVersionsDdlSql(): string {
  return `
CREATE TABLE artifact (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE RESTRICT
);
CREATE INDEX artifact_run_idx ON artifact(run_id);
CREATE INDEX artifact_task_idx ON artifact(task_id);

CREATE TABLE artifact_version (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  source_step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT,
  content_ref TEXT,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  parent_version_ids_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  operation_id TEXT,
  merge_base_version_id TEXT,
  expected_task_version INTEGER,
  resulting_task_version INTEGER,
  created_at TEXT NOT NULL,
  CONSTRAINT artifact_version_status_check CHECK (
    status IN ('candidate', 'selected', 'rejected', 'incomplete', 'merged')
  ),
  CONSTRAINT artifact_version_number_check CHECK (version > 0),
  CONSTRAINT artifact_version_content_check CHECK (
    (content IS NOT NULL AND content_ref IS NULL) OR
    (content IS NULL AND content_ref IS NOT NULL)
  ),
  CONSTRAINT artifact_version_hash_check CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT artifact_version_mime_check CHECK (
    length(mime_type) BETWEEN 3 AND 128 AND instr(mime_type, '/') > 1
  ),
  CONSTRAINT artifact_version_parent_json_check CHECK (json_valid(parent_version_ids_json)),
  CONSTRAINT artifact_version_metadata_json_check CHECK (json_valid(metadata_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_run_id, source_step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merge_base_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX artifact_version_artifact_version_uidx
  ON artifact_version(artifact_id, version);
CREATE UNIQUE INDEX artifact_version_operation_uidx ON artifact_version(operation_id);
CREATE INDEX artifact_version_artifact_idx ON artifact_version(artifact_id);

CREATE TABLE artifact_selection (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL,
  selected_version_id TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  resulting_task_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifact(id) ON DELETE RESTRICT,
  FOREIGN KEY (selected_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE INDEX artifact_selection_artifact_idx ON artifact_selection(artifact_id, created_at);

CREATE TABLE artifact_merge_conflict (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  base_version_id TEXT NOT NULL,
  left_version_id TEXT NOT NULL,
  right_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  summary_json TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  resulting_task_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT artifact_merge_conflict_status_check CHECK (status = 'open'),
  CONSTRAINT artifact_merge_conflict_summary_json_check CHECK (json_valid(summary_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE RESTRICT,
  FOREIGN KEY (base_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (left_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (right_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
CREATE INDEX artifact_merge_conflict_artifact_idx
  ON artifact_merge_conflict(artifact_id, created_at);

CREATE TRIGGER artifact_version_immutable_update
BEFORE UPDATE ON artifact_version
BEGIN
  SELECT RAISE(ABORT, 'artifact versions are immutable');
END;
CREATE TRIGGER artifact_version_immutable_delete
BEFORE DELETE ON artifact_version
BEGIN
  SELECT RAISE(ABORT, 'artifact versions are immutable');
END;
CREATE TRIGGER artifact_selection_append_only_update
BEFORE UPDATE ON artifact_selection
BEGIN
  SELECT RAISE(ABORT, 'artifact selections are append-only');
END;
CREATE TRIGGER artifact_selection_append_only_delete
BEFORE DELETE ON artifact_selection
BEGIN
  SELECT RAISE(ABORT, 'artifact selections are append-only');
END;
CREATE TRIGGER artifact_merge_conflict_append_only_update
BEFORE UPDATE ON artifact_merge_conflict
BEGIN
  SELECT RAISE(ABORT, 'artifact merge conflicts are append-only');
END;
CREATE TRIGGER artifact_merge_conflict_append_only_delete
BEFORE DELETE ON artifact_merge_conflict
BEGIN
  SELECT RAISE(ABORT, 'artifact merge conflicts are append-only');
END;
`;
}

function artifactIntegrityDdlSql(): string {
  return `
ALTER TABLE artifact_merge_conflict RENAME TO artifact_merge_conflict_0011;
CREATE TABLE artifact_merge_conflict (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_step_id TEXT,
  base_version_id TEXT NOT NULL,
  left_version_id TEXT NOT NULL,
  right_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  summary_json TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  resulting_task_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT artifact_merge_conflict_status_check CHECK (status = 'open'),
  CONSTRAINT artifact_merge_conflict_summary_json_check CHECK (json_valid(summary_json)),
  FOREIGN KEY (artifact_id) REFERENCES artifact(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, source_step_id) REFERENCES step(run_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (base_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (left_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT,
  FOREIGN KEY (right_version_id) REFERENCES artifact_version(id) ON DELETE RESTRICT
);
INSERT INTO artifact_merge_conflict (
  id, operation_id, artifact_id, run_id, source_step_id,
  base_version_id, left_version_id, right_version_id, status, summary_json,
  expected_task_version, resulting_task_version, created_at
)
SELECT id, operation_id, artifact_id, run_id, NULL,
  base_version_id, left_version_id, right_version_id, status, summary_json,
  expected_task_version, resulting_task_version, created_at
FROM artifact_merge_conflict_0011;

WITH valid_event_candidate AS (
  SELECT conflict.id AS conflict_id, event.step_id AS source_step_id
  FROM artifact_merge_conflict AS conflict
  JOIN artifact ON artifact.id = conflict.artifact_id
  JOIN event
    ON event.run_id = conflict.run_id
    AND event.workspace_id = artifact.workspace_id
    AND event.task_id = artifact.task_id
    AND event.type = 'artifact.merge-conflicted'
    AND event.category = 'artifact'
  JOIN step
    ON step.run_id = conflict.run_id
    AND step.id = event.step_id
  WHERE CASE
      WHEN json_valid(event.payload_json)
      THEN json_extract(event.payload_json, '$.operationId')
      ELSE NULL
    END = conflict.operation_id
    AND CASE
      WHEN json_valid(event.payload_json)
      THEN json_extract(event.payload_json, '$.conflictId')
      ELSE NULL
    END = conflict.id
),
unambiguous_event_source AS (
  SELECT conflict_id, MIN(source_step_id) AS source_step_id
  FROM valid_event_candidate
  GROUP BY conflict_id
  HAVING COUNT(DISTINCT source_step_id) = 1
)
UPDATE artifact_merge_conflict
SET source_step_id = (
  SELECT source_step_id
  FROM unambiguous_event_source
  WHERE conflict_id = artifact_merge_conflict.id
)
WHERE id IN (SELECT conflict_id FROM unambiguous_event_source);

DROP TABLE artifact_merge_conflict_0011;
CREATE INDEX artifact_merge_conflict_artifact_idx
  ON artifact_merge_conflict(artifact_id, created_at);
CREATE TRIGGER artifact_merge_conflict_append_only_update
BEFORE UPDATE ON artifact_merge_conflict
BEGIN
  SELECT RAISE(ABORT, 'artifact merge conflicts are append-only');
END;
CREATE TRIGGER artifact_merge_conflict_append_only_delete
BEFORE DELETE ON artifact_merge_conflict
BEGIN
  SELECT RAISE(ABORT, 'artifact merge conflicts are append-only');
END;

CREATE TRIGGER artifact_ownership_insert
BEFORE INSERT ON artifact
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM task
    JOIN run ON run.id = NEW.run_id
    WHERE task.id = NEW.task_id
      AND task.workspace_id = NEW.workspace_id
      AND run.task_id = NEW.task_id
  ) THEN RAISE(ABORT, 'artifact ownership mismatch') END;
END;

CREATE TRIGGER artifact_version_ownership_insert
BEFORE INSERT ON artifact_version
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifact
    WHERE id = NEW.artifact_id AND run_id = NEW.source_run_id
  ) THEN RAISE(ABORT, 'artifact version ownership mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM step
    WHERE run_id = NEW.source_run_id AND id = NEW.source_step_id
  ) THEN RAISE(ABORT, 'artifact version source Step ownership mismatch') END;
  SELECT CASE WHEN NEW.merge_base_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM artifact_version
    WHERE id = NEW.merge_base_version_id AND artifact_id = NEW.artifact_id
  ) THEN RAISE(ABORT, 'artifact version merge base ownership mismatch') END;
  SELECT CASE WHEN json_valid(NEW.parent_version_ids_json) = 0
    OR json_type(NEW.parent_version_ids_json) <> 'array'
    THEN RAISE(ABORT, 'artifact version parents must be a JSON array') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.parent_version_ids_json) AS parent
    LEFT JOIN artifact_version AS parent_version ON parent_version.id = parent.value
    WHERE parent.type <> 'text'
      OR parent_version.id IS NULL
      OR parent_version.artifact_id <> NEW.artifact_id
      OR parent_version.version >= NEW.version
  ) THEN RAISE(ABORT, 'artifact version parent ownership mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT parent.value
    FROM json_each(NEW.parent_version_ids_json) AS parent
    GROUP BY parent.value
    HAVING COUNT(*) > 1
  ) THEN RAISE(ABORT, 'artifact version parents must be unique') END;
END;

CREATE TRIGGER artifact_selection_ownership_insert
BEFORE INSERT ON artifact_selection
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifact_version
    WHERE id = NEW.selected_version_id AND artifact_id = NEW.artifact_id
  ) THEN RAISE(ABORT, 'artifact selection ownership mismatch') END;
END;

CREATE TRIGGER artifact_merge_conflict_ownership_insert
BEFORE INSERT ON artifact_merge_conflict
BEGIN
  SELECT CASE WHEN NEW.source_step_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM step
    WHERE run_id = NEW.run_id AND id = NEW.source_step_id
  ) THEN RAISE(ABORT, 'artifact conflict ownership mismatch: source Step') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifact
    WHERE id = NEW.artifact_id AND run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'artifact conflict ownership mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM (
      SELECT NEW.base_version_id AS id
      UNION ALL SELECT NEW.left_version_id
      UNION ALL SELECT NEW.right_version_id
    ) AS merge_version
    LEFT JOIN artifact_version ON artifact_version.id = merge_version.id
    WHERE artifact_version.id IS NULL
      OR artifact_version.artifact_id <> NEW.artifact_id
  ) THEN RAISE(ABORT, 'artifact conflict ownership mismatch: versions') END;
END;
`;
}
// Pure planning function for testability 鈥?does not touch DB. Returns pending
// migrations considering previously-applied names.
export function planMigrations(priorAppliedNames: string[]): MigrationPlanResult {
  const prior = new Set(priorAppliedNames);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of MIGRATIONS) {
    if (prior.has(m.name)) skipped.push(m.name);
    else applied.push(m.name);
  }
  return { applied, skipped };
}

async function listApplied(db: Database): Promise<string[]> {
  const rows = await db.select().from(schema.migrationRecord).all();
  return rows.map((r) => r.name);
}

// Main entry invoked by pnpm db:migrate. Phase 0 dev skips backup for ':memory:'.
export async function runMigrations(dbPath: string): Promise<MigrationPlanResult> {
  const { db, raw } = await openDatabaseAsync({ path: dbPath });
  try {
    // Ensure migration_record table exists before anything else.
    raw.exec(`CREATE TABLE IF NOT EXISTS migration_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );`);

    let backupPath: string | undefined;
    if (dbPath !== ':memory:' && existsSync(dbPath)) {
      const b = backupDatabase(dbPath);
      backupPath = b.backupPath;
    }

    const prior = await listApplied(db);
    const plan = planMigrations(prior);
    for (const name of plan.applied) {
      const m = MIGRATIONS.find((x) => x.name === name);
      if (!m) throw new Error(`migration not found: ${name}`);
      try {
        const applyMigration = raw.transaction(() => {
          raw.exec(m.sql);
          raw
            .prepare('INSERT INTO migration_record (name, applied_at) VALUES (?, ?)')
            .run(name, new Date().toISOString());
        });
        applyMigration.immediate();
      } catch (e) {
        throw new Error(`migration ${name} failed: ${(e as Error).message}`);
      }
    }
    return {
      applied: plan.applied,
      skipped: plan.skipped,
      backupPath,
    };
  } finally {
    raw.close();
  }
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}` && process.argv[1]?.endsWith('migrate.ts')) {
  const path = process.env.SYNC_THINK_DB_PATH ?? ':memory:';
  runMigrations(path)
    .then((r) => {
      console.log('migrations applied', r.applied);
      console.log('migrations skipped', r.skipped);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
