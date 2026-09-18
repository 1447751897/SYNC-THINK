import type { AgentId, AgentWritePolicy, CredentialGroupId, ModelId } from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

/**
 * Mutable global Agent store (2026-07-22 model). Editing is a plain UPDATE —
 * no version chain. The legacy SqliteAgentStore/agent_version remains only for
 * historical step references.
 *
 * Agents carry capability (persona / model / skills / MCP). Permission gates stay
 * on the conversation; `writePolicy` is the one capability-shaped exception,
 * because a delegated child runs headless (docs/adr/0001).
 */

export interface GlobalAgentRecord {
  id: AgentId;
  name: string;
  avatar: string;
  persona: string;
  description: string;
  defaultModelId: ModelId;
  defaultCredentialGroupId?: CredentialGroupId;
  fallbackModelIds: ModelId[];
  skillIds: string[];
  mcpServerIds: string[];
  reasoningEffort: string;
  enabled: boolean;
  source: 'builtin' | 'user';
  availabilityScope: 'global' | 'workspace';
  writePolicy: AgentWritePolicy;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGlobalAgentInput {
  name: string;
  defaultModelId: ModelId;
  avatar?: string;
  persona?: string;
  description?: string;
  defaultCredentialGroupId?: CredentialGroupId;
  fallbackModelIds?: ModelId[];
  skillIds?: string[];
  mcpServerIds?: string[];
  reasoningEffort?: string;
  enabled?: boolean;
  source?: 'builtin' | 'user';
  availabilityScope?: 'global' | 'workspace';
  writePolicy?: AgentWritePolicy;
  id?: AgentId;
  now?: string;
}

export interface UpdateGlobalAgentInput {
  agentId: AgentId;
  name?: string;
  avatar?: string;
  persona?: string;
  description?: string;
  defaultModelId?: ModelId;
  defaultCredentialGroupId?: CredentialGroupId | null;
  fallbackModelIds?: ModelId[];
  skillIds?: string[];
  mcpServerIds?: string[];
  reasoningEffort?: string;
  enabled?: boolean;
  source?: 'builtin' | 'user';
  availabilityScope?: 'global' | 'workspace';
  writePolicy?: AgentWritePolicy;
  archived?: boolean;
  now?: string;
}

interface AgentDbRow {
  id: string;
  name: string;
  avatar: string;
  persona: string;
  description: string;
  default_model_id: string;
  default_credential_group_id: string | null;
  fallback_model_ids_json: string;
  skill_ids_json: string;
  mcp_server_ids_json: string;
  reasoning_effort: string;
  enabled: number;
  source: string;
  availability_scope: string;
  write_policy: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(row: AgentDbRow): GlobalAgentRecord {
  return {
    id: row.id as AgentId,
    name: row.name,
    avatar: row.avatar,
    persona: row.persona,
    description: row.description,
    defaultModelId: row.default_model_id as ModelId,
    defaultCredentialGroupId: row.default_credential_group_id
      ? (row.default_credential_group_id as CredentialGroupId)
      : undefined,
    fallbackModelIds: parseStringArray(row.fallback_model_ids_json) as ModelId[],
    skillIds: parseStringArray(row.skill_ids_json),
    mcpServerIds: parseStringArray(row.mcp_server_ids_json),
    reasoningEffort: row.reasoning_effort,
    enabled: row.enabled === 1,
    source: row.source === 'builtin' ? 'builtin' : 'user',
    availabilityScope: row.availability_scope === 'global' ? 'global' : 'workspace',
    writePolicy: row.write_policy === 'inherit' ? 'inherit' : 'read-only',
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, name, avatar, persona, description, default_model_id,
  default_credential_group_id, fallback_model_ids_json, skill_ids_json,
  mcp_server_ids_json, reasoning_effort, enabled, source, availability_scope,
  write_policy, archived, created_at, updated_at`;

export class SqliteGlobalAgentStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: CreateGlobalAgentInput): GlobalAgentRecord {
    const name = input.name.trim();
    if (!name) throw new Error('agent name must not be empty');
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? (`agent-${ulid()}` as AgentId)) as AgentId;
    this.raw
      .prepare(
        `INSERT INTO agent (
           id, name, avatar, persona, description, default_model_id,
           default_credential_group_id, fallback_model_ids_json, skill_ids_json,
           mcp_server_ids_json, reasoning_effort, enabled, source, availability_scope,
           write_policy, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        name,
        input.avatar ?? '',
        input.persona ?? '',
        input.description ?? '',
        input.defaultModelId,
        input.defaultCredentialGroupId ?? null,
        JSON.stringify(input.fallbackModelIds ?? []),
        JSON.stringify(input.skillIds ?? []),
        JSON.stringify(input.mcpServerIds ?? []),
        input.reasoningEffort ?? 'auto',
        input.enabled === false ? 0 : 1,
        input.source ?? 'user',
        input.availabilityScope ?? 'global',
        input.writePolicy ?? 'inherit',
        now,
        now,
      );
    const created = this.get(id);
    if (!created) throw new Error('agent insert failed');
    return created;
  }

  get(agentId: AgentId | string): GlobalAgentRecord | undefined {
    const row = this.raw
      .prepare(`SELECT ${SELECT_COLUMNS} FROM agent WHERE id = ?`)
      .get(agentId) as AgentDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(options?: { includeArchived?: boolean }): GlobalAgentRecord[] {
    const where = options?.includeArchived ? '' : 'WHERE archived = 0';
    const rows = this.raw
      .prepare(`SELECT ${SELECT_COLUMNS} FROM agent ${where} ORDER BY name COLLATE NOCASE`)
      .all() as AgentDbRow[];
    return rows.map(mapRow);
  }

  update(input: UpdateGlobalAgentInput): GlobalAgentRecord {
    const current = this.get(input.agentId);
    if (!current) throw new Error(`agent not found: ${input.agentId}`);
    const now = input.now ?? new Date().toISOString();
    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name) throw new Error('agent name must not be empty');
    const credentialGroup =
      input.defaultCredentialGroupId === undefined
        ? (current.defaultCredentialGroupId ?? null)
        : input.defaultCredentialGroupId;
    this.raw
      .prepare(
        `UPDATE agent SET
           name = ?, avatar = ?, persona = ?, description = ?, default_model_id = ?,
           default_credential_group_id = ?, fallback_model_ids_json = ?,
           skill_ids_json = ?, mcp_server_ids_json = ?, reasoning_effort = ?,
           enabled = ?, source = ?, availability_scope = ?, write_policy = ?,
           archived = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name,
        input.avatar ?? current.avatar,
        input.persona ?? current.persona,
        input.description ?? current.description,
        input.defaultModelId ?? current.defaultModelId,
        credentialGroup,
        JSON.stringify(input.fallbackModelIds ?? current.fallbackModelIds),
        JSON.stringify(input.skillIds ?? current.skillIds),
        JSON.stringify(input.mcpServerIds ?? current.mcpServerIds),
        input.reasoningEffort ?? current.reasoningEffort,
        input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
        input.source ?? current.source,
        input.availabilityScope ?? current.availabilityScope,
        input.writePolicy ?? current.writePolicy ?? 'inherit',
        (input.archived ?? current.archived) ? 1 : 0,
        now,
        input.agentId,
      );
    const updated = this.get(input.agentId);
    if (!updated) throw new Error('agent update failed');
    return updated;
  }

  listEffective(workspaceId: string): GlobalAgentRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT ${SELECT_COLUMNS}
         FROM agent
         WHERE archived = 0 AND enabled = 1
           AND (availability_scope = 'global' OR EXISTS (
             SELECT 1 FROM agent_workspace_activation activation
             WHERE activation.agent_id = agent.id
               AND activation.workspace_id = ?
               AND activation.active = 1
           ))
         ORDER BY name COLLATE NOCASE`,
      )
      .all(workspaceId) as AgentDbRow[];
    return rows.map(mapRow);
  }

  isEffective(agentId: AgentId | string, workspaceId: string): boolean {
    return this.listEffective(workspaceId).some((agent) => agent.id === agentId);
  }

  setWorkspaceActivation(input: {
    agentId: AgentId;
    workspaceId: string;
    active: boolean;
    now?: string;
  }): void {
    if (!this.get(input.agentId)) throw new Error(`agent not found: ${input.agentId}`);
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO agent_workspace_activation
           (agent_id, workspace_id, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, workspace_id) DO UPDATE SET
           active = excluded.active, updated_at = excluded.updated_at`,
      )
      .run(input.agentId, input.workspaceId, input.active ? 1 : 0, now, now);
  }

  listWorkspaceActivations(workspaceId: string): Array<{
    agentId: AgentId;
    workspaceId: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.raw
      .prepare(
        `SELECT agent_id, workspace_id, active, created_at, updated_at
         FROM agent_workspace_activation WHERE workspace_id = ?
         ORDER BY agent_id`,
      )
      .all(workspaceId) as Array<{
      agent_id: string;
      workspace_id: string;
      active: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      agentId: row.agent_id as AgentId,
      workspaceId: row.workspace_id,
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Hard delete; refuses when the agent is still on any team roster. */
  delete(agentId: AgentId): void {
    const member = this.raw
      .prepare('SELECT team_id FROM team_member WHERE agent_id = ? LIMIT 1')
      .get(agentId) as { team_id: string } | undefined;
    if (member) {
      throw new Error(`agent is a member of team ${member.team_id}; remove from teams first`);
    }
    this.raw.prepare('DELETE FROM agent WHERE id = ?').run(agentId);
  }
}
