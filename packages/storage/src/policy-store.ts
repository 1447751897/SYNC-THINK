import { ulid, type AgentVersionId, type ApprovalMode } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type PolicyScopeType =
  | 'user'
  | 'workspace'
  | 'project'
  | 'task'
  | 'agent'
  | 'workflow'
  | 'run';

export interface PolicyRuleRecord {
  action: string;
  approvalMode: ApprovalMode;
  delegateAgentVersionId?: AgentVersionId;
}

export interface PolicyScopeRef {
  scopeType: PolicyScopeType;
  scopeId: string;
}

export interface SavePolicyInput extends PolicyScopeRef {
  policyId?: string;
  approvalMode: ApprovalMode;
  rules?: readonly PolicyRuleRecord[];
  now?: string;
}

export interface PolicyVersionRecord extends PolicyScopeRef {
  id: string;
  policyId: string;
  version: number;
  approvalMode: ApprovalMode;
  rules: PolicyRuleRecord[];
  createdAt: string;
}

interface PolicyVersionDbRow {
  id: string;
  policy_id: string;
  version: number;
  scope_type: string;
  scope_id: string;
  approval_mode: string;
  rules_json: string;
  created_at: string;
}

const POLICY_COLUMNS = `
  id, policy_id, version, scope_type, scope_id, approval_mode, rules_json, created_at
`;

const POLICY_SCOPE_TYPES = new Set<PolicyScopeType>([
  'user',
  'workspace',
  'project',
  'task',
  'agent',
  'workflow',
  'run',
]);

function requireText(value: string | undefined, field: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function normalizeScopeType(value: PolicyScopeType | string): PolicyScopeType {
  if (POLICY_SCOPE_TYPES.has(value as PolicyScopeType)) {
    return value as PolicyScopeType;
  }
  throw new Error(`Unsupported policy scope type: ${String(value)}`);
}

function normalizeApprovalMode(value: ApprovalMode | string): ApprovalMode {
  if (value === 'request' || value === 'delegate' || value === 'custom' || value === 'full') {
    return value;
  }
  throw new Error(`Unsupported approval mode: ${String(value)}`);
}

function normalizeRules(rules: readonly PolicyRuleRecord[] | undefined): PolicyRuleRecord[] {
  return (rules ?? []).map((rule) => {
    const approvalMode = normalizeApprovalMode(rule.approvalMode);
    const delegateAgentVersionId = rule.delegateAgentVersionId
      ? (requireText(rule.delegateAgentVersionId, 'rule.delegateAgentVersionId') as AgentVersionId)
      : undefined;
    if (delegateAgentVersionId && approvalMode !== 'delegate') {
      throw new Error('rule.delegateAgentVersionId requires delegate mode');
    }
    return {
      action: requireText(rule.action, 'rule.action'),
      approvalMode,
      ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
    };
  });
}

function parseRules(raw: string): PolicyRuleRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid policy rules JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('Invalid policy rules JSON');
  return parsed.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid policy rule');
    const rule = value as Record<string, unknown>;
    const approvalMode = normalizeApprovalMode(String(rule.approvalMode ?? ''));
    const delegateAgentVersionId =
      rule.delegateAgentVersionId === undefined
        ? undefined
        : (requireText(
            typeof rule.delegateAgentVersionId === 'string'
              ? rule.delegateAgentVersionId
              : undefined,
            'rule.delegateAgentVersionId',
          ) as AgentVersionId);
    if (delegateAgentVersionId && approvalMode !== 'delegate') {
      throw new Error('Invalid policy rule');
    }
    return {
      action: requireText(typeof rule.action === 'string' ? rule.action : undefined, 'rule.action'),
      approvalMode,
      ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
    };
  });
}

function mapRow(row: PolicyVersionDbRow): PolicyVersionRecord {
  return {
    id: row.id,
    policyId: row.policy_id,
    version: row.version,
    scopeType: normalizeScopeType(row.scope_type),
    scopeId: row.scope_id,
    approvalMode: normalizeApprovalMode(row.approval_mode),
    rules: parseRules(row.rules_json),
    createdAt: row.created_at,
  };
}

export class SqlitePolicyStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  save(input: SavePolicyInput): PolicyVersionRecord {
    const policyId = requireText(input.policyId ?? ulid(), 'policyId');
    const scopeType = normalizeScopeType(input.scopeType);
    const scopeId = requireText(input.scopeId, 'scopeId');
    const approvalMode = normalizeApprovalMode(input.approvalMode);
    const rules = normalizeRules(input.rules);
    const createdAt = input.now ?? new Date().toISOString();

    const saveVersion = this.raw.transaction(() => {
      const latest = this.getLatest(policyId);
      if (
        latest &&
        (latest.scopeType !== scopeType || latest.scopeId !== scopeId)
      ) {
        throw new Error(`Policy scope cannot change: ${policyId}`);
      }

      const maxRow = this.raw
        .prepare(
          'SELECT COALESCE(MAX(version), 0) AS max_version FROM policy_version WHERE policy_id = ?',
        )
        .get(policyId) as { max_version: number };
      const version = maxRow.max_version + 1;
      const id = ulid();

      this.raw
        .prepare(
          `INSERT INTO policy_version (
             id, policy_id, version, scope_type, scope_id, approval_mode, rules_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          policyId,
          version,
          scopeType,
          scopeId,
          approvalMode,
          JSON.stringify(rules),
          createdAt,
        );

      return this.getRequiredVersion(id);
    });

    return saveVersion.immediate();
  }

  getVersion(id: string): PolicyVersionRecord | undefined {
    const row = this.raw
      .prepare(`SELECT ${POLICY_COLUMNS} FROM policy_version WHERE id = ?`)
      .get(id) as PolicyVersionDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getRequiredVersion(id: string): PolicyVersionRecord {
    const version = this.getVersion(id);
    if (!version) throw new Error(`PolicyVersion not found: ${id}`);
    return version;
  }

  getPolicyVersion(policyId: string, version: number): PolicyVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${POLICY_COLUMNS}
         FROM policy_version
         WHERE policy_id = ? AND version = ?`,
      )
      .get(policyId, version) as PolicyVersionDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getLatest(policyId: string): PolicyVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${POLICY_COLUMNS}
         FROM policy_version
         WHERE policy_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(policyId) as PolicyVersionDbRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listVersions(policyId: string): PolicyVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT ${POLICY_COLUMNS}
         FROM policy_version
         WHERE policy_id = ?
         ORDER BY version ASC`,
      )
      .all(policyId) as PolicyVersionDbRow[];
    return rows.map(mapRow);
  }

  listLatest(): PolicyVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT ${POLICY_COLUMNS}
         FROM policy_version AS current
         WHERE current.version = (
           SELECT MAX(candidate.version)
           FROM policy_version AS candidate
           WHERE candidate.policy_id = current.policy_id
         )
         ORDER BY current.created_at ASC, current.policy_id ASC`,
      )
      .all() as PolicyVersionDbRow[];
    return rows.map(mapRow);
  }

  listApplicable(scopes: readonly PolicyScopeRef[]): PolicyVersionRecord[] {
    const scopeOrder = new Map<string, number>();
    for (const [index, scope] of scopes.entries()) {
      const scopeType = normalizeScopeType(scope.scopeType);
      const scopeId = requireText(scope.scopeId, 'scopeId');
      const key = `${scopeType}\u0000${scopeId}`;
      if (!scopeOrder.has(key)) scopeOrder.set(key, index);
    }

    return this.listLatest()
      .filter((policy) => scopeOrder.has(`${policy.scopeType}\u0000${policy.scopeId}`))
      .sort((left, right) => {
        const leftOrder = scopeOrder.get(`${left.scopeType}\u0000${left.scopeId}`) ?? 0;
        const rightOrder = scopeOrder.get(`${right.scopeType}\u0000${right.scopeId}`) ?? 0;
        return leftOrder - rightOrder || left.policyId.localeCompare(right.policyId);
      });
  }
}
