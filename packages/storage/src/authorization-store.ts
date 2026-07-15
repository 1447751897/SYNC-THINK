import {
  ulid,
  type AgentVersionId,
  type McpServerId,
  type SkillVersionId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type AuthorizationScope = 'user' | 'workspace' | 'project' | 'task' | 'run';

export interface AuthorizationScopeRef {
  scope: AuthorizationScope;
  scopeId: string;
}

interface AuthorizationGrantBase extends AuthorizationScopeRef {
  id: string;
  grantId: string;
  version: number;
  agentVersionId: AgentVersionId;
  revoked: boolean;
  createdAt: string;
}

export interface SkillAuthorizationGrantVersion extends AuthorizationGrantBase {
  target: 'skill';
  skillVersionId: SkillVersionId;
}

export interface McpAuthorizationGrantVersion extends AuthorizationGrantBase {
  target: 'mcp';
  serverId: McpServerId;
  tools?: string[];
}

export type AuthorizationGrantVersionRecord =
  | SkillAuthorizationGrantVersion
  | McpAuthorizationGrantVersion;

interface CreateAuthorizationGrantBase extends AuthorizationScopeRef {
  grantId?: string;
  agentVersionId: AgentVersionId;
  now?: string;
}

export type CreateAuthorizationGrantInput = CreateAuthorizationGrantBase &
  (
    | { target: 'skill'; skillVersionId: SkillVersionId }
    | { target: 'mcp'; serverId: McpServerId; tools?: readonly string[] }
  );

export interface RevokeAuthorizationGrantInput {
  grantId: string;
  now?: string;
}

interface AuthorizationGrantDbRow {
  id: string;
  grant_id: string;
  version: number;
  scope_type: string;
  scope_id: string;
  agent_version_id: string;
  target_type: string;
  skill_version_id: string | null;
  mcp_server_id: string | null;
  tools_json: string | null;
  revoked: number;
  created_at: string;
}

const AUTHORIZATION_COLUMNS = `
  id, grant_id, version, scope_type, scope_id, agent_version_id, target_type,
  skill_version_id, mcp_server_id, tools_json, revoked, created_at
`;

const SCOPE_ORDER: Record<AuthorizationScope, number> = {
  user: 0,
  workspace: 1,
  project: 2,
  task: 3,
  run: 4,
};

function requireText(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`authorization.${field}_invalid`);
  }
  return value.trim();
}

function normalizeScope(value: unknown): AuthorizationScope {
  if (typeof value === 'string' && Object.hasOwn(SCOPE_ORDER, value)) {
    return value as AuthorizationScope;
  }
  throw new Error('authorization.scope_invalid');
}

function normalizeVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('authorization.version_invalid');
  }
  return value as number;
}

function normalizeRevoked(value: unknown): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error('authorization.revoked_invalid');
}

function normalizeTools(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('authorization.tools_invalid');
  }
  const tools = value.map((tool) => requireText(tool, 'tool_name'));
  return [...new Set(tools)].sort();
}

function parseTools(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('authorization.tools_json_invalid');
  }
  if (!Array.isArray(parsed) || !parsed.every((tool) => typeof tool === 'string')) {
    throw new Error('authorization.tools_json_invalid');
  }
  try {
    return normalizeTools(parsed);
  } catch {
    throw new Error('authorization.tools_json_invalid');
  }
}

function mapRow(row: AuthorizationGrantDbRow): AuthorizationGrantVersionRecord {
  const base = {
    id: requireText(row.id, 'id'),
    grantId: requireText(row.grant_id, 'grant_id'),
    version: normalizeVersion(row.version),
    scope: normalizeScope(row.scope_type),
    scopeId: requireText(row.scope_id, 'scope_id'),
    agentVersionId: requireText(row.agent_version_id, 'agent_version_id') as AgentVersionId,
    revoked: normalizeRevoked(row.revoked),
    createdAt: requireText(row.created_at, 'created_at', 1024),
  };
  if (
    row.target_type === 'skill' &&
    row.skill_version_id !== null &&
    row.mcp_server_id === null &&
    row.tools_json === null
  ) {
    return {
      ...base,
      target: 'skill',
      skillVersionId: requireText(
        row.skill_version_id,
        'skill_version_id',
      ) as SkillVersionId,
    };
  }
  if (
    row.target_type === 'mcp' &&
    row.skill_version_id === null &&
    row.mcp_server_id !== null
  ) {
    const tools = parseTools(row.tools_json);
    return {
      ...base,
      target: 'mcp',
      serverId: requireText(row.mcp_server_id, 'mcp_server_id') as McpServerId,
      ...(tools === undefined ? {} : { tools }),
    };
  }
  throw new Error('authorization.target_invalid');
}

function sameGrantIdentity(
  current: AuthorizationGrantVersionRecord,
  input: CreateAuthorizationGrantInput,
): boolean {
  if (
    current.scope !== input.scope ||
    current.scopeId !== input.scopeId ||
    current.agentVersionId !== input.agentVersionId ||
    current.target !== input.target
  ) {
    return false;
  }
  return current.target === 'skill'
    ? current.skillVersionId === (input as Extract<CreateAuthorizationGrantInput, { target: 'skill' }>).skillVersionId
    : current.serverId === (input as Extract<CreateAuthorizationGrantInput, { target: 'mcp' }>).serverId;
}

export class SqliteAuthorizationStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  grant(input: CreateAuthorizationGrantInput): AuthorizationGrantVersionRecord {
    const grantId = requireText(input.grantId ?? ulid(), 'grant_id');
    const scope = normalizeScope(input.scope);
    const scopeId = requireText(input.scopeId, 'scope_id');
    const agentVersionId = requireText(
      input.agentVersionId,
      'agent_version_id',
    ) as AgentVersionId;
    const now = input.now ?? new Date().toISOString();
    const normalizedInput: CreateAuthorizationGrantInput =
      input.target === 'skill'
        ? {
            grantId,
            scope,
            scopeId,
            agentVersionId,
            target: 'skill',
            skillVersionId: requireText(
              input.skillVersionId,
              'skill_version_id',
            ) as SkillVersionId,
            now,
          }
        : {
            grantId,
            scope,
            scopeId,
            agentVersionId,
            target: 'mcp',
            serverId: requireText(input.serverId, 'mcp_server_id') as McpServerId,
            ...(input.tools === undefined ? {} : { tools: normalizeTools(input.tools) }),
            now,
          };

    return this.raw.transaction(() => {
      this.assertExactReferences(normalizedInput);
      const latest = this.getLatest(grantId);
      if (latest && !sameGrantIdentity(latest, normalizedInput)) {
        throw new Error('authorization.grant_identity_mismatch');
      }
      const version = (latest?.version ?? 0) + 1;
      const id = ulid();
      const skillVersionId =
        normalizedInput.target === 'skill' ? normalizedInput.skillVersionId : null;
      const mcpServerId =
        normalizedInput.target === 'mcp' ? normalizedInput.serverId : null;
      const toolsJson =
        normalizedInput.target === 'mcp' && normalizedInput.tools !== undefined
          ? JSON.stringify(normalizedInput.tools)
          : null;
      this.raw
        .prepare(
          `INSERT INTO authorization_grant_version (
             id, grant_id, version, scope_type, scope_id, agent_version_id,
             target_type, skill_version_id, mcp_server_id, tools_json, revoked, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          grantId,
          version,
          scope,
          scopeId,
          agentVersionId,
          normalizedInput.target,
          skillVersionId,
          mcpServerId,
          toolsJson,
          now,
        );
      return this.getRequiredVersion(id);
    }).immediate();
  }

  revoke(input: RevokeAuthorizationGrantInput): AuthorizationGrantVersionRecord {
    const grantId = requireText(input.grantId, 'grant_id');
    const now = input.now ?? new Date().toISOString();
    return this.raw.transaction(() => {
      const latest = this.getLatest(grantId);
      if (!latest) throw new Error(`AuthorizationGrant not found: ${grantId}`);
      if (latest.revoked) return latest;
      const id = ulid();
      this.raw
        .prepare(
          `INSERT INTO authorization_grant_version (
             id, grant_id, version, scope_type, scope_id, agent_version_id,
             target_type, skill_version_id, mcp_server_id, tools_json, revoked, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          id,
          latest.grantId,
          latest.version + 1,
          latest.scope,
          latest.scopeId,
          latest.agentVersionId,
          latest.target,
          latest.target === 'skill' ? latest.skillVersionId : null,
          latest.target === 'mcp' ? latest.serverId : null,
          latest.target === 'mcp' && latest.tools !== undefined
            ? JSON.stringify(latest.tools)
            : null,
          now,
        );
      return this.getRequiredVersion(id);
    }).immediate();
  }

  getVersion(id: string): AuthorizationGrantVersionRecord | undefined {
    const row = this.raw
      .prepare(`SELECT ${AUTHORIZATION_COLUMNS} FROM authorization_grant_version WHERE id = ?`)
      .get(requireText(id, 'id')) as AuthorizationGrantDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getRequiredVersion(id: string): AuthorizationGrantVersionRecord {
    const result = this.getVersion(id);
    if (!result) throw new Error(`AuthorizationGrantVersion not found: ${id}`);
    return result;
  }

  getLatest(grantId: string): AuthorizationGrantVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${AUTHORIZATION_COLUMNS}
         FROM authorization_grant_version
         WHERE grant_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(requireText(grantId, 'grant_id')) as AuthorizationGrantDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listVersions(grantId: string): AuthorizationGrantVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT ${AUTHORIZATION_COLUMNS}
         FROM authorization_grant_version
         WHERE grant_id = ?
         ORDER BY version ASC`,
      )
      .all(requireText(grantId, 'grant_id')) as AuthorizationGrantDbRow[];
    return rows.map(mapRow);
  }

  listApplicable(scopeChain: readonly AuthorizationScopeRef[]): AuthorizationGrantVersionRecord[] {
    const scopeOrder = new Map<string, number>();
    let previousOrder = -1;
    for (const [index, scopeRef] of scopeChain.entries()) {
      const scope = normalizeScope(scopeRef.scope);
      const scopeId = requireText(scopeRef.scopeId, 'scope_id');
      const order = SCOPE_ORDER[scope];
      if (order <= previousOrder) throw new Error('authorization.scope_chain_invalid');
      previousOrder = order;
      scopeOrder.set(`${scope}\u0000${scopeId}`, index);
    }
    if (scopeOrder.size === 0) return [];

    const rows = this.raw
      .prepare(
        `SELECT ${AUTHORIZATION_COLUMNS}
         FROM authorization_grant_version AS current
         WHERE current.version = (
           SELECT MAX(candidate.version)
           FROM authorization_grant_version AS candidate
           WHERE candidate.grant_id = current.grant_id
         )
         ORDER BY current.grant_id ASC`,
      )
      .all() as AuthorizationGrantDbRow[];
    return rows
      .map(mapRow)
      .filter((grant) => scopeOrder.has(`${grant.scope}\u0000${grant.scopeId}`))
      .sort((left, right) => {
        const leftOrder = scopeOrder.get(`${left.scope}\u0000${left.scopeId}`) ?? 0;
        const rightOrder = scopeOrder.get(`${right.scope}\u0000${right.scopeId}`) ?? 0;
        return leftOrder - rightOrder || left.grantId.localeCompare(right.grantId);
      });
  }

  private assertExactReferences(input: CreateAuthorizationGrantInput): void {
    const agent = this.raw
      .prepare('SELECT id FROM agent_version WHERE id = ?')
      .get(input.agentVersionId);
    if (!agent) throw new Error(`AgentVersion not found: ${input.agentVersionId}`);
    if (input.target === 'skill') {
      const skill = this.raw
        .prepare('SELECT id FROM skill_version WHERE id = ?')
        .get(input.skillVersionId);
      if (!skill) throw new Error(`SkillVersion not found: ${input.skillVersionId}`);
      return;
    }
    const server = this.raw
      .prepare('SELECT id FROM mcp_server WHERE id = ?')
      .get(input.serverId);
    if (!server) throw new Error(`McpServer not found: ${input.serverId}`);
  }
}
