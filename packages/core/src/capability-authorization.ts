import type {
  AgentVersionId,
  McpServerId,
  SkillVersionId,
} from '@sync-think/shared';

export type CapabilityScope = 'user' | 'workspace' | 'project' | 'task' | 'run';

export interface CapabilityScopeRef {
  scope: CapabilityScope;
  scopeId: string;
}

interface CapabilityGrantBase extends CapabilityScopeRef {
  grantId: string;
  version: number;
  agentVersionId: AgentVersionId;
  revoked: boolean;
}

export interface SkillCapabilityGrant extends CapabilityGrantBase {
  target: 'skill';
  skillVersionId: SkillVersionId;
}

export interface McpCapabilityGrant extends CapabilityGrantBase {
  target: 'mcp';
  serverId: McpServerId;
  /** Absence grants the whole server; an explicit list grants only those tools. */
  tools?: readonly string[];
}

export type CapabilityGrant = SkillCapabilityGrant | McpCapabilityGrant;

interface CapabilityAccessRequestBase {
  agentVersionId: AgentVersionId;
  scopeChain: readonly CapabilityScopeRef[];
  grants: readonly CapabilityGrant[];
}

export interface SkillCapabilityAccessRequest extends CapabilityAccessRequestBase {
  skillVersionId: SkillVersionId;
}

export interface McpCapabilityAccessRequest extends CapabilityAccessRequestBase {
  serverId: McpServerId;
  toolName?: string;
}

export type CapabilityAccessRequest =
  | SkillCapabilityAccessRequest
  | McpCapabilityAccessRequest;

export type CapabilityAccessDeniedReason =
  | 'not-authorized'
  | 'scope-not-authorized'
  | 'agent-not-authorized'
  | 'skill-not-authorized'
  | 'server-not-authorized'
  | 'tool-not-authorized'
  | 'revoked';

export type CapabilityAccessResult =
  | { allowed: true }
  | { allowed: false; reason: CapabilityAccessDeniedReason };

const SCOPE_ORDER: Record<CapabilityScope, number> = {
  user: 0,
  workspace: 1,
  project: 2,
  task: 3,
  run: 4,
};

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCapabilityScope(value: unknown): value is CapabilityScope {
  return typeof value === 'string' && Object.hasOwn(SCOPE_ORDER, value);
}

function isValidScopeChain(scopeChain: readonly CapabilityScopeRef[]): boolean {
  let previousOrder = -1;
  for (const scope of scopeChain) {
    if (!isCapabilityScope(scope.scope) || !isNonEmptyText(scope.scopeId)) return false;
    const order = SCOPE_ORDER[scope.scope];
    if (order <= previousOrder) return false;
    previousOrder = order;
  }
  return true;
}

function isValidGrant(grant: CapabilityGrant): boolean {
  if (
    !isNonEmptyText(grant.grantId) ||
    !Number.isSafeInteger(grant.version) ||
    grant.version < 1 ||
    !isCapabilityScope(grant.scope) ||
    !isNonEmptyText(grant.scopeId) ||
    !isNonEmptyText(grant.agentVersionId) ||
    typeof grant.revoked !== 'boolean'
  ) {
    return false;
  }
  if (grant.target === 'skill') return isNonEmptyText(grant.skillVersionId);
  if (grant.target !== 'mcp' || !isNonEmptyText(grant.serverId)) return false;
  return (
    grant.tools === undefined ||
    (Array.isArray(grant.tools) && grant.tools.every((tool) => isNonEmptyText(tool)))
  );
}

function latestGrantVersions(grants: readonly CapabilityGrant[]): CapabilityGrant[] {
  const latest = new Map<
    string,
    { version: number; grant: CapabilityGrant | undefined }
  >();
  for (const grant of grants) {
    if (!isValidGrant(grant)) continue;
    const current = latest.get(grant.grantId);
    if (!current || grant.version > current.version) {
      latest.set(grant.grantId, { version: grant.version, grant });
    } else if (grant.version === current.version) {
      latest.set(grant.grantId, { version: grant.version, grant: undefined });
    }
  }
  return [...latest.values()]
    .map(({ grant }) => grant)
    .filter((grant): grant is CapabilityGrant => grant !== undefined);
}

function denied(reason: CapabilityAccessDeniedReason): CapabilityAccessResult {
  return { allowed: false, reason };
}

export function resolveCapabilityAccess(
  input: CapabilityAccessRequest,
): CapabilityAccessResult {
  const latest = latestGrantVersions(input.grants);
  if (latest.length === 0) return denied('not-authorized');
  if (!isValidScopeChain(input.scopeChain)) return denied('scope-not-authorized');

  const scopeKeys = new Set(
    input.scopeChain.map(({ scope, scopeId }) => `${scope}\u0000${scopeId}`),
  );
  const scoped = latest.filter((grant) =>
    scopeKeys.has(`${grant.scope}\u0000${grant.scopeId}`),
  );
  if (scoped.length === 0) return denied('scope-not-authorized');

  const agentGrants = scoped.filter(
    (grant) => grant.agentVersionId === input.agentVersionId,
  );
  if (agentGrants.length === 0) return denied('agent-not-authorized');

  if ('skillVersionId' in input) {
    const matching = agentGrants.filter(
      (grant): grant is SkillCapabilityGrant =>
        grant.target === 'skill' && grant.skillVersionId === input.skillVersionId,
    );
    if (matching.length === 0) return denied('skill-not-authorized');
    return matching.some((grant) => !grant.revoked) ? { allowed: true } : denied('revoked');
  }

  const serverGrants = agentGrants.filter(
    (grant): grant is McpCapabilityGrant =>
      grant.target === 'mcp' && grant.serverId === input.serverId,
  );
  if (serverGrants.length === 0) return denied('server-not-authorized');

  const requestedTool = input.toolName?.trim();
  const matching = serverGrants.filter((grant) => {
    if (grant.tools === undefined) return true;
    if (!requestedTool) return false;
    return grant.tools.some((tool) => tool.trim() === requestedTool);
  });
  if (matching.length === 0) return denied('tool-not-authorized');
  return matching.some((grant) => !grant.revoked) ? { allowed: true } : denied('revoked');
}
