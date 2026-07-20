import type {
  AgentArtifactRules,
  AgentId,
  AgentPermissions,
  AgentReviewBehavior,
  AgentVisualIdentity,
  AgentVersionId,
  ApprovalMode,
  CredentialGroupId,
  CredentialRefId,
  MemoryScope,
  ModelId,
} from '@sync-think/shared';
import { MAX_REVIEW_ITERATIONS, ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

/** Stable product agent id for the default one-Agent conversation experience (§5.1). */
export const DEFAULT_CONVERSATION_AGENT_ID = 'agent-default-conversation' as AgentId;

/** Placeholder credential group until the agent is pinned to a real group. */
export const UNASSIGNED_CREDENTIAL_GROUP_ID = 'credential-group-unassigned' as CredentialGroupId;

export const DEFAULT_AGENT_VISUAL_IDENTITY: AgentVisualIdentity = {
  icon: 'bot',
  color: '#64748b',
};

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  file: [],
  command: [],
  browser: [],
  desktop: [],
  network: [],
};

export const DEFAULT_AGENT_REVIEW_BEHAVIOR: AgentReviewBehavior = {
  role: 'none',
  maxIterations: 0,
  onLimitReached: 'pause',
};

export const DEFAULT_AGENT_ARTIFACT_RULES: AgentArtifactRules = {
  retainVersions: true,
  requireReview: false,
  defaultStatus: 'candidate',
};

export interface AgentVersionRecord {
  id: AgentVersionId;
  agentId: AgentId;
  version: number;
  name: string;
  description: string;
  visualIdentity: AgentVisualIdentity;
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  maxConcurrency: number;
  defaultModelId: ModelId;
  defaultCredentialGroupId: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId;
  pauseOnFailure: boolean;
  fallbackModelIds: ModelId[];
  memoryScope: MemoryScope;
  skillVersionIds: string[];
  mcpServerIds: string[];
  mcpToolAllowlist: string[];
  permissions: AgentPermissions;
  policyId?: string;
  approvalMode: ApprovalMode;
  reviewBehavior: AgentReviewBehavior;
  artifactRules: AgentArtifactRules;
  createdAt: string;
}

export interface EnsureConversationAgentInput {
  defaultModelId: ModelId;
  fallbackModelIds?: ModelId[];
  defaultCredentialGroupId?: CredentialGroupId;
  pauseOnFailure?: boolean;
  name?: string;
  now?: string;
}

export interface CreateAgentInput {
  agentId?: AgentId;
  name: string;
  description?: string;
  visualIdentity?: AgentVisualIdentity;
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  maxConcurrency?: number;
  defaultModelId: ModelId;
  defaultCredentialGroupId?: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId;
  pauseOnFailure?: boolean;
  fallbackModelIds?: ModelId[];
  memoryScope?: MemoryScope;
  skillVersionIds?: string[];
  mcpServerIds?: string[];
  mcpToolAllowlist?: string[];
  permissions?: AgentPermissions;
  policyId?: string;
  approvalMode?: ApprovalMode;
  reviewBehavior?: AgentReviewBehavior;
  artifactRules?: AgentArtifactRules;
  now?: string;
}

export interface UpdateAgentDefinitionInput {
  agentId: AgentId;
  name?: string;
  description?: string;
  visualIdentity?: AgentVisualIdentity;
  role?: string;
  developerInstructions?: string;
  inputContract?: string;
  outputContract?: string;
  maxConcurrency?: number;
  defaultModelId?: ModelId;
  defaultCredentialGroupId?: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId | null;
  pauseOnFailure?: boolean;
  fallbackModelIds?: ModelId[];
  memoryScope?: MemoryScope;
  skillVersionIds?: string[];
  mcpServerIds?: string[];
  mcpToolAllowlist?: string[];
  permissions?: AgentPermissions;
  policyId?: string | null;
  approvalMode?: ApprovalMode;
  reviewBehavior?: AgentReviewBehavior;
  artifactRules?: AgentArtifactRules;
  now?: string;
}

export interface UpdateAgentBindingInput {
  agentId: AgentId;
  defaultModelId: ModelId;
  fallbackModelIds: ModelId[];
  pauseOnFailure?: boolean;
  defaultCredentialGroupId?: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId | null;
  /** Explicit Skill allowlist for this Agent version (§9.1). */
  skillVersionIds?: string[];
  /** Explicit MCP server allowlist for this Agent version (§9.3). */
  mcpServerIds?: string[];
  now?: string;
}

/** Slim view used by Runtime resolveModelBinding (§5.3). */
export interface AgentModelBindingView {
  agentVersionId: AgentVersionId;
  defaultModelId: ModelId;
  fallbackModelIds: ModelId[];
  pauseOnFailure: boolean;
  defaultCredentialGroupId?: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId;
}

export type AgentDataErrorCode = 'agent.invalid_version';

export class AgentDataError extends Error {
  override readonly name = 'AgentDataError';

  constructor(
    readonly code: AgentDataErrorCode,
    readonly path: string,
    detail?: string,
  ) {
    super(`${code}: ${path}${detail ? ` (${detail})` : ''}`);
  }
}

interface AgentVersionRow {
  id: string;
  agent_id: string;
  version: number;
  name: string;
  description: string;
  visual_identity_json: string;
  role: string;
  developer_instructions: string;
  input_contract: string;
  output_contract: string;
  max_concurrency: number;
  default_model_id: string;
  default_credential_group_id: string;
  pinned_credential_ref_id: string | null;
  pause_on_failure: number;
  fallback_model_ids_json: string;
  memory_scope: string;
  skill_version_ids_json: string;
  mcp_server_ids_json: string;
  mcp_tool_allowlist_json: string;
  permissions_json: string;
  policy_id: string | null;
  approval_mode: string;
  review_behavior_json: string;
  artifact_rules_json: string;
  created_at: string;
}

function invalidStoredVersion(path: string, detail: string): never {
  throw new AgentDataError('agent.invalid_version', path, detail);
}

function parseStoredVersion(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalidStoredVersion(path, 'expected a positive safe integer');
  }
  return value;
}

function parseStoredPauseOnFailure(value: unknown, path: string): boolean {
  if (value !== 0 && value !== 1) {
    return invalidStoredVersion(path, 'expected 0 or 1');
  }
  return value === 1;
}

function parseStoredStringArrayValue(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    return invalidStoredVersion(path, 'expected a JSON array');
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return invalidStoredVersion(`${path}[${index}]`, 'expected a non-empty string');
    }
    result.push(item);
  }
  return result;
}

function parseJsonArray(raw: string, path: string): string[] {
  return parseStoredStringArrayValue(parseJsonValue(raw, path), path);
}

function parseStoredMemoryScope(value: string, path: string): MemoryScope {
  if (value === 'task' || value === 'project' || value === 'global') return value;
  return invalidStoredVersion(path, `unsupported value: ${String(value)}`);
}

function parseStoredApprovalMode(value: string, path: string): ApprovalMode {
  if (value === 'request' || value === 'delegate' || value === 'full' || value === 'custom') {
    return value;
  }
  return invalidStoredVersion(path, `unsupported value: ${String(value)}`);
}

function requireModelId(value: ModelId | string, field: string): ModelId {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error(field + ' must not be empty');
  }
  return trimmed as ModelId;
}

function requireText(value: string, field: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error(field + ' must not be empty');
  }
  return trimmed;
}

function normalizeMemoryScope(value: MemoryScope | undefined): MemoryScope {
  const scope = value ?? 'task';
  if (scope !== 'task' && scope !== 'project' && scope !== 'global') {
    throw new Error(`Unsupported memoryScope: ${String(scope)}`);
  }
  return scope;
}

function normalizeApprovalMode(value: ApprovalMode | undefined): ApprovalMode {
  const mode = value ?? 'request';
  if (mode !== 'request' && mode !== 'delegate' && mode !== 'full' && mode !== 'custom') {
    throw new Error(`Unsupported approvalMode: ${String(mode)}`);
  }
  return mode;
}

function sanitizeIdList(ids: readonly string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = String(id ?? '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sanitizeFallbackIds(
  ids: readonly ModelId[] | undefined,
  defaultModelId: ModelId,
): ModelId[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: ModelId[] = [];
  for (const id of ids) {
    const trimmed = String(id ?? '').trim();
    if (!trimmed || trimmed === defaultModelId || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed as ModelId);
  }
  return out;
}

function normalizeMaxConcurrency(value: unknown): number {
  const normalized = value ?? 3;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 1 || Number(normalized) > 16) {
    throw new Error('maxConcurrency must be an integer between 1 and 16');
  }
  return Number(normalized);
}

function mapRow(row: AgentVersionRow): AgentVersionRecord {
  const path = `agent_version[${row.id}]`;
  return {
    id: row.id as AgentVersionId,
    agentId: row.agent_id as AgentId,
    version: parseStoredVersion(row.version, `${path}.version`),
    name: row.name,
    description: row.description,
    visualIdentity: parseVisualIdentity(row.visual_identity_json, `${path}.visual_identity_json`),
    role: row.role,
    developerInstructions: row.developer_instructions,
    inputContract: row.input_contract,
    outputContract: row.output_contract,
    maxConcurrency: normalizeMaxConcurrency(row.max_concurrency),
    defaultModelId: row.default_model_id as ModelId,
    defaultCredentialGroupId: row.default_credential_group_id as CredentialGroupId,
    pinnedCredentialRefId: row.pinned_credential_ref_id
      ? (row.pinned_credential_ref_id as CredentialRefId)
      : undefined,
    pauseOnFailure: parseStoredPauseOnFailure(
      row.pause_on_failure,
      `${path}.pause_on_failure`,
    ),
    fallbackModelIds: parseJsonArray(
      row.fallback_model_ids_json,
      `${path}.fallback_model_ids_json`,
    ) as ModelId[],
    memoryScope: parseStoredMemoryScope(row.memory_scope, `${path}.memory_scope`),
    skillVersionIds: parseJsonArray(row.skill_version_ids_json, `${path}.skill_version_ids_json`),
    mcpServerIds: parseJsonArray(row.mcp_server_ids_json, `${path}.mcp_server_ids_json`),
    mcpToolAllowlist: parseJsonArray(
      row.mcp_tool_allowlist_json,
      `${path}.mcp_tool_allowlist_json`,
    ),
    permissions: parsePermissions(row.permissions_json, `${path}.permissions_json`),
    policyId: row.policy_id ?? undefined,
    approvalMode: parseStoredApprovalMode(row.approval_mode, `${path}.approval_mode`),
    reviewBehavior: parseReviewBehavior(row.review_behavior_json, `${path}.review_behavior_json`),
    artifactRules: parseArtifactRules(row.artifact_rules_json, `${path}.artifact_rules_json`),
    createdAt: row.created_at,
  };
}

export function toModelBinding(record: AgentVersionRecord): AgentModelBindingView {
  return {
    agentVersionId: record.id,
    defaultModelId: record.defaultModelId,
    fallbackModelIds: [...record.fallbackModelIds],
    pauseOnFailure: record.pauseOnFailure,
    defaultCredentialGroupId: record.defaultCredentialGroupId,
    pinnedCredentialRefId: record.pinnedCredentialRefId,
  };
}

export class SqliteAgentStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  private assertReviewBehaviorBackup(reviewBehavior: AgentReviewBehavior): void {
    if (!reviewBehavior.backupAgentVersionId) return;
    const backup = this.getVersion(reviewBehavior.backupAgentVersionId);
    if (!backup) {
      throw new Error(`AgentVersion not found: ${reviewBehavior.backupAgentVersionId}`);
    }
    if (
      backup.reviewBehavior.role !== 'reviewer' &&
      backup.reviewBehavior.role !== 'executor-reviewer'
    ) {
      throw new Error('reviewBehavior.backup_reviewer_invalid');
    }
  }

  getLatestVersion(agentId: AgentId | string): AgentVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, agent_id, version, name, description, visual_identity_json,
                role, developer_instructions, input_contract,
                output_contract, max_concurrency, default_model_id, default_credential_group_id,
                pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
                memory_scope, skill_version_ids_json, mcp_server_ids_json,
                mcp_tool_allowlist_json, permissions_json, policy_id,
                approval_mode, review_behavior_json, artifact_rules_json, created_at
         FROM agent_version
         WHERE agent_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(String(agentId)) as AgentVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getVersion(agentVersionId: AgentVersionId | string): AgentVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, agent_id, version, name, description, visual_identity_json,
                role, developer_instructions, input_contract,
                output_contract, max_concurrency, default_model_id, default_credential_group_id,
                pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
                memory_scope, skill_version_ids_json, mcp_server_ids_json,
                mcp_tool_allowlist_json, permissions_json, policy_id,
                approval_mode, review_behavior_json, artifact_rules_json, created_at
         FROM agent_version
         WHERE id = ?`,
      )
      .get(String(agentVersionId)) as AgentVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getRequiredAgentVersion(agentVersionId: AgentVersionId | string): AgentVersionRecord {
    const version = this.getVersion(agentVersionId);
    if (!version) {
      throw new Error(`AgentVersion not found: ${String(agentVersionId)}`);
    }
    return version;
  }

  listVersions(agentId: AgentId | string): AgentVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, agent_id, version, name, description, visual_identity_json,
                role, developer_instructions, input_contract,
                output_contract, max_concurrency, default_model_id, default_credential_group_id,
                pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
                memory_scope, skill_version_ids_json, mcp_server_ids_json,
                mcp_tool_allowlist_json, permissions_json, policy_id,
                approval_mode, review_behavior_json, artifact_rules_json, created_at
         FROM agent_version
         WHERE agent_id = ?
         ORDER BY version ASC`,
      )
      .all(String(agentId)) as AgentVersionRow[];
    return rows.map(mapRow);
  }

  listAgentVersions(agentId: AgentId | string): AgentVersionRecord[] {
    return this.listVersions(agentId);
  }

  listLatestVersions(): AgentVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, agent_id, version, name, description, visual_identity_json,
                role, developer_instructions, input_contract,
                output_contract, max_concurrency, default_model_id, default_credential_group_id,
                pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
                memory_scope, skill_version_ids_json, mcp_server_ids_json,
                mcp_tool_allowlist_json, permissions_json, policy_id,
                approval_mode, review_behavior_json, artifact_rules_json, created_at
         FROM agent_version AS current
         WHERE current.version = (
           SELECT MAX(candidate.version)
           FROM agent_version AS candidate
           WHERE candidate.agent_id = current.agent_id
         )
         ORDER BY current.agent_id ASC`,
      )
      .all() as AgentVersionRow[];
    return rows.map(mapRow);
  }

  createAgent(input: CreateAgentInput): AgentVersionRecord {
    const agentId = requireText(String(input.agentId ?? ulid()), 'agentId') as AgentId;
    const defaultModelId = requireModelId(input.defaultModelId, 'defaultModelId');
    const fallbackModelIds = sanitizeFallbackIds(input.fallbackModelIds, defaultModelId);
    const defaultCredentialGroupId = input.defaultCredentialGroupId
      ? (requireText(
          String(input.defaultCredentialGroupId),
          'defaultCredentialGroupId',
        ) as CredentialGroupId)
      : UNASSIGNED_CREDENTIAL_GROUP_ID;
    const pinnedCredentialRefId = input.pinnedCredentialRefId
      ? (requireText(
          String(input.pinnedCredentialRefId),
          'pinnedCredentialRefId',
        ) as CredentialRefId)
      : undefined;
    const policyId = input.policyId?.trim() || undefined;
    const reviewBehavior = normalizeReviewBehavior(input.reviewBehavior);
    const now = input.now ?? new Date().toISOString();

    const create = this.raw.transaction(() => {
      if (this.getLatestVersion(agentId)) {
        throw new Error(`Agent already exists: ${agentId}`);
      }
      this.assertReviewBehaviorBackup(reviewBehavior);

      const id = ulid() as AgentVersionId;
      this.raw
        .prepare(
          `INSERT INTO agent_version (
             id, agent_id, version, name, description, visual_identity_json,
             role, developer_instructions, input_contract,
             output_contract, max_concurrency, default_model_id, default_credential_group_id,
             pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
             memory_scope, skill_version_ids_json, mcp_server_ids_json,
             mcp_tool_allowlist_json, permissions_json, policy_id, approval_mode,
             review_behavior_json, artifact_rules_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          agentId,
          1,
          requireText(input.name, 'name'),
          (input.description ?? '').trim(),
          JSON.stringify(normalizeVisualIdentity(input.visualIdentity)),
          requireText(input.role, 'role'),
          requireText(input.developerInstructions, 'developerInstructions'),
          requireText(input.inputContract, 'inputContract'),
          requireText(input.outputContract, 'outputContract'),
          normalizeMaxConcurrency(input.maxConcurrency),
          defaultModelId,
          defaultCredentialGroupId,
          pinnedCredentialRefId ?? null,
          (input.pauseOnFailure ?? true) ? 1 : 0,
          JSON.stringify(fallbackModelIds),
          normalizeMemoryScope(input.memoryScope),
          JSON.stringify(sanitizeIdList(input.skillVersionIds)),
          JSON.stringify(sanitizeIdList(input.mcpServerIds)),
          JSON.stringify(sanitizeIdList(input.mcpToolAllowlist)),
          JSON.stringify(normalizePermissions(input.permissions)),
          policyId ?? null,
          normalizeApprovalMode(input.approvalMode),
          JSON.stringify(reviewBehavior),
          JSON.stringify(normalizeArtifactRules(input.artifactRules)),
          now,
        );
      return this.getRequiredAgentVersion(id);
    });

    return create.immediate();
  }

  updateDefinition(input: UpdateAgentDefinitionInput): AgentVersionRecord {
    const agentId = requireText(String(input.agentId ?? ''), 'agentId') as AgentId;
    const update = this.raw.transaction(() => {
      const previous = this.getLatestVersion(agentId);
      if (!previous) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      const maxRow = this.raw
        .prepare(
          'SELECT COALESCE(MAX(version), 0) AS max_version FROM agent_version WHERE agent_id = ?',
        )
        .get(agentId) as { max_version: number };
      const nextVersion = maxRow.max_version + 1;
      const defaultModelId = requireModelId(
        input.defaultModelId ?? previous.defaultModelId,
        'defaultModelId',
      );
      const fallbackModelIds = sanitizeFallbackIds(
        input.fallbackModelIds ?? previous.fallbackModelIds,
        defaultModelId,
      );
      const defaultCredentialGroupId = requireText(
        String(input.defaultCredentialGroupId ?? previous.defaultCredentialGroupId),
        'defaultCredentialGroupId',
      ) as CredentialGroupId;
      const pinnedCredentialRefId =
        input.pinnedCredentialRefId === null
          ? undefined
          : input.pinnedCredentialRefId !== undefined
            ? (requireText(
                String(input.pinnedCredentialRefId),
                'pinnedCredentialRefId',
              ) as CredentialRefId)
            : previous.pinnedCredentialRefId;
      const policyId =
        input.policyId === null
          ? undefined
          : input.policyId !== undefined
            ? input.policyId.trim() || undefined
            : previous.policyId;
      const reviewBehavior =
        input.reviewBehavior === undefined
          ? previous.reviewBehavior
          : normalizeReviewBehavior(input.reviewBehavior);
      this.assertReviewBehaviorBackup(reviewBehavior);
      const id = ulid() as AgentVersionId;

      this.raw
        .prepare(
          `INSERT INTO agent_version (
             id, agent_id, version, name, description, visual_identity_json,
             role, developer_instructions, input_contract,
             output_contract, max_concurrency, default_model_id, default_credential_group_id,
             pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
             memory_scope, skill_version_ids_json, mcp_server_ids_json,
             mcp_tool_allowlist_json, permissions_json, policy_id, approval_mode,
             review_behavior_json, artifact_rules_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          agentId,
          nextVersion,
          requireText(input.name ?? previous.name, 'name'),
          input.description === undefined ? previous.description : input.description.trim(),
          JSON.stringify(
            input.visualIdentity === undefined
              ? previous.visualIdentity
              : normalizeVisualIdentity(input.visualIdentity),
          ),
          requireText(input.role ?? previous.role, 'role'),
          requireText(
            input.developerInstructions ?? previous.developerInstructions,
            'developerInstructions',
          ),
          requireText(input.inputContract ?? previous.inputContract, 'inputContract'),
          requireText(input.outputContract ?? previous.outputContract, 'outputContract'),
          normalizeMaxConcurrency(input.maxConcurrency ?? previous.maxConcurrency),
          defaultModelId,
          defaultCredentialGroupId,
          pinnedCredentialRefId ?? null,
          (input.pauseOnFailure ?? previous.pauseOnFailure) ? 1 : 0,
          JSON.stringify(fallbackModelIds),
          normalizeMemoryScope(input.memoryScope ?? previous.memoryScope),
          JSON.stringify(
            input.skillVersionIds !== undefined
              ? sanitizeIdList(input.skillVersionIds)
              : previous.skillVersionIds,
          ),
          JSON.stringify(
            input.mcpServerIds !== undefined
              ? sanitizeIdList(input.mcpServerIds)
              : previous.mcpServerIds,
          ),
          JSON.stringify(
            input.mcpToolAllowlist !== undefined
              ? sanitizeIdList(input.mcpToolAllowlist)
              : previous.mcpToolAllowlist,
          ),
          JSON.stringify(
            input.permissions === undefined
              ? previous.permissions
              : normalizePermissions(input.permissions),
          ),
          policyId ?? null,
          normalizeApprovalMode(input.approvalMode ?? previous.approvalMode),
          JSON.stringify(reviewBehavior),
          JSON.stringify(
            input.artifactRules === undefined
              ? previous.artifactRules
              : normalizeArtifactRules(input.artifactRules),
          ),
          input.now ?? new Date().toISOString(),
        );

      return this.getRequiredAgentVersion(id);
    });

    return update.immediate();
  }

  /**
   * Ensure the default conversation agent has at least one version.
   * Idempotent: returns the latest version when already present.
   */
  ensureConversationAgent(input: EnsureConversationAgentInput): AgentVersionRecord {
    const existing = this.getLatestVersion(DEFAULT_CONVERSATION_AGENT_ID);
    if (existing) return existing;

    return this.createAgent({
      agentId: DEFAULT_CONVERSATION_AGENT_ID,
      name: (input.name ?? 'Conversation').trim() || 'Conversation',
      description: 'General conversation agent.',
      role: 'generalist',
      developerInstructions: 'You are the default conversation agent for SYNC-THINK.',
      inputContract: 'user message + task context',
      outputContract: 'assistant message with inspectable trace',
      defaultModelId: input.defaultModelId,
      defaultCredentialGroupId: input.defaultCredentialGroupId,
      pauseOnFailure: input.pauseOnFailure,
      fallbackModelIds: input.fallbackModelIds,
      now: input.now,
    });
  }

  /**
   * Update binding by inserting a new immutable AgentVersion row (§8).
   * Prior versions remain for historical runs.
   */
  updateBinding(input: UpdateAgentBindingInput): AgentVersionRecord {
    const defaultModelId = requireModelId(input.defaultModelId, 'defaultModelId');
    const agentId = requireText(String(input.agentId ?? ''), 'agentId') as AgentId;
    const previous = this.getLatestVersion(agentId);
    if (!previous) {
      return this.createAgent({
        agentId,
        name: 'Conversation',
        role: 'generalist',
        developerInstructions: 'You are the default conversation agent for SYNC-THINK.',
        inputContract: 'user message + task context',
        outputContract: 'assistant message with inspectable trace',
        defaultModelId,
        defaultCredentialGroupId: input.defaultCredentialGroupId,
        pinnedCredentialRefId: input.pinnedCredentialRefId ?? undefined,
        pauseOnFailure: input.pauseOnFailure,
        fallbackModelIds: input.fallbackModelIds,
        skillVersionIds: input.skillVersionIds,
        mcpServerIds: input.mcpServerIds,
        now: input.now,
      });
    }

    return this.updateDefinition({
      agentId,
      defaultModelId,
      fallbackModelIds: input.fallbackModelIds,
      pauseOnFailure: input.pauseOnFailure,
      defaultCredentialGroupId: input.defaultCredentialGroupId,
      pinnedCredentialRefId: input.pinnedCredentialRefId,
      skillVersionIds: input.skillVersionIds,
      mcpServerIds: input.mcpServerIds,
      now: input.now,
    });
  }
}

function parseJsonValue(raw: string, path: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    return invalidStoredVersion(path, error instanceof Error ? error.message : 'invalid JSON');
  }
}

function normalizeVisualIdentity(value?: AgentVisualIdentity): AgentVisualIdentity {
  if (!value) return { ...DEFAULT_AGENT_VISUAL_IDENTITY };
  if (typeof value.icon !== 'string' || typeof value.color !== 'string') {
    throw new Error('visualIdentity must contain string icon and color');
  }
  const avatarPath = value.avatarPath?.trim();
  if (avatarPath && !/^avatars\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(avatarPath)) {
    throw new Error('visualIdentity.avatarPath is not a managed avatar path');
  }
  return {
    icon: requireText(value.icon, 'visualIdentity.icon'),
    color: requireText(value.color, 'visualIdentity.color'),
    ...(avatarPath ? { avatarPath } : {}),
  };
}

function normalizePermissions(value?: AgentPermissions): AgentPermissions {
  if (!value) {
    return {
      file: [],
      command: [],
      browser: [],
      desktop: [],
      network: [],
    };
  }
  if (
    !Array.isArray(value.file) ||
    !Array.isArray(value.command) ||
    !Array.isArray(value.browser) ||
    !Array.isArray(value.desktop) ||
    !Array.isArray(value.network)
  ) {
    throw new Error('permissions must contain all capability arrays');
  }
  return {
    file: sanitizeIdList(value.file),
    command: sanitizeIdList(value.command),
    browser: sanitizeIdList(value.browser),
    desktop: sanitizeIdList(value.desktop),
    network: sanitizeIdList(value.network),
  };
}

function normalizeReviewBehavior(value?: AgentReviewBehavior): AgentReviewBehavior {
  if (!value) return { ...DEFAULT_AGENT_REVIEW_BEHAVIOR };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('reviewBehavior must be an object');
  }
  const keys = Object.keys(value);
  const allowedKeys = new Set(['role', 'maxIterations', 'onLimitReached', 'backupAgentVersionId']);
  if (
    !keys.includes('role') ||
    !keys.includes('maxIterations') ||
    !keys.includes('onLimitReached') ||
    keys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error('reviewBehavior fields are invalid');
  }
  if (value.role !== 'none' && value.role !== 'reviewer' && value.role !== 'executor-reviewer') {
    throw new Error(`Unsupported reviewBehavior.role: ${String(value.role)}`);
  }
  if (!Number.isInteger(value.maxIterations) || value.maxIterations < 0) {
    throw new Error('reviewBehavior.maxIterations must be a non-negative integer');
  }
  if (value.maxIterations > MAX_REVIEW_ITERATIONS) {
    throw new Error(`reviewBehavior.maxIterations exceeds ${MAX_REVIEW_ITERATIONS}`);
  }
  if (
    value.onLimitReached !== 'pause' &&
    value.onLimitReached !== 'abort' &&
    value.onLimitReached !== 'reassign'
  ) {
    throw new Error(`Unsupported reviewBehavior.onLimitReached: ${String(value.onLimitReached)}`);
  }
  const backupAgentVersionId = value.backupAgentVersionId
    ? (requireText(
        String(value.backupAgentVersionId),
        'reviewBehavior.backupAgentVersionId',
      ) as AgentVersionId)
    : undefined;
  if (backupAgentVersionId && value.role === 'none') {
    throw new Error('reviewBehavior.backup_requires_reviewer');
  }
  return {
    role: value.role,
    maxIterations: value.maxIterations,
    onLimitReached: value.onLimitReached,
    ...(backupAgentVersionId ? { backupAgentVersionId } : {}),
  };
}

function normalizeArtifactRules(value?: AgentArtifactRules): AgentArtifactRules {
  if (!value) return { ...DEFAULT_AGENT_ARTIFACT_RULES };
  if (typeof value.retainVersions !== 'boolean' || typeof value.requireReview !== 'boolean') {
    throw new Error('artifactRules flags must be boolean');
  }
  if (value.defaultStatus !== 'candidate' && value.defaultStatus !== 'final') {
    throw new Error(`Unsupported artifactRules.defaultStatus: ${String(value.defaultStatus)}`);
  }
  return { ...value };
}

function parseVisualIdentity(raw: string, path: string): AgentVisualIdentity {
  const value = parseJsonValue(raw, path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidStoredVersion(path, 'expected an object');
  }
  try {
    return normalizeVisualIdentity(value as AgentVisualIdentity);
  } catch (error) {
    return invalidStoredVersion(
      path,
      error instanceof Error ? error.message : 'invalid visual identity',
    );
  }
}

function parsePermissions(raw: string, path: string): AgentPermissions {
  const value = parseJsonValue(raw, path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidStoredVersion(path, 'expected an object');
  }
  const record = value as Record<string, unknown>;
  return {
    file: parseStoredStringArrayValue(record.file, `${path}.file`),
    command: parseStoredStringArrayValue(record.command, `${path}.command`),
    browser: parseStoredStringArrayValue(record.browser, `${path}.browser`),
    desktop: parseStoredStringArrayValue(record.desktop, `${path}.desktop`),
    network: parseStoredStringArrayValue(record.network, `${path}.network`),
  };
}

function parseReviewBehavior(raw: string, path: string): AgentReviewBehavior {
  const value = parseJsonValue(raw, path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidStoredVersion(path, 'expected an object');
  }
  try {
    return normalizeReviewBehavior(value as AgentReviewBehavior);
  } catch (error) {
    return invalidStoredVersion(
      path,
      error instanceof Error ? error.message : 'invalid review behavior',
    );
  }
}

function parseArtifactRules(raw: string, path: string): AgentArtifactRules {
  const value = parseJsonValue(raw, path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidStoredVersion(path, 'expected an object');
  }
  try {
    return normalizeArtifactRules(value as AgentArtifactRules);
  } catch (error) {
    return invalidStoredVersion(
      path,
      error instanceof Error ? error.message : 'invalid artifact rules',
    );
  }
}
