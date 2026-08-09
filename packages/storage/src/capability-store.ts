import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type CapabilityType = 'skill' | 'mcp';
export type CapabilityUsageOutcome = 'success' | 'failed' | 'cancelled';

export interface CapabilityWorkspaceActivationRecord {
  capabilityType: CapabilityType;
  capabilityId: string;
  workspaceId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCapabilityWorkspaceActivationInput {
  capabilityType: CapabilityType;
  capabilityId: string;
  workspaceId: string;
  active: boolean;
  now?: string;
}

export interface AppendCapabilityUsageEventInput {
  id?: string;
  capabilityType: CapabilityType;
  capabilityId: string;
  workspaceId: string;
  agentId?: string;
  agentVersionId?: string;
  runId?: string;
  outcome: CapabilityUsageOutcome;
  contextTokens?: number;
  occurredAt?: string;
}

export interface CapabilityUsageEventRecord {
  id: string;
  capabilityType: CapabilityType;
  capabilityId: string;
  workspaceId: string;
  agentId?: string;
  agentVersionId?: string;
  runId?: string;
  outcome: CapabilityUsageOutcome;
  contextTokens: number;
  occurredAt: string;
}

export interface CapabilityUsageSummary {
  capabilityType: CapabilityType;
  capabilityId: string;
  callCount: number;
  successCount: number;
  failedCount: number;
  cancelledCount: number;
  problemCount: number;
  contextTokens: number;
  lastUsedAt?: string;
}

export interface SummarizeCapabilityUsageInput {
  capabilityType: CapabilityType;
  capabilityIds: readonly string[];
  workspaceId: string;
  now?: string;
  windowDays?: number;
}

export interface SkillPublishAttachment {
  name: string;
  size: number;
  [key: string]: unknown;
}

export interface SkillPublishDraftRecord {
  id: string;
  skillVersionId: string;
  skillId: string;
  displayName: string;
  description: string;
  skillMd: string;
  category: string;
  version: string;
  icon: string;
  attachments: SkillPublishAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveSkillPublishDraftInput
  extends Omit<SkillPublishDraftRecord, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
  createdAt?: string;
  now?: string;
}

export interface CapabilityOrganizeCategories {
  unused: string[];
  inactive: string[];
  problematic: string[];
  contextWarning: string[];
  highContext: string[];
}

export interface CapabilityOrganizeReportRecord {
  id: string;
  workspaceId: string;
  contextBudgetTokens: number;
  categories: CapabilityOrganizeCategories;
  summary: {
    capabilityCount: number;
    unusedCount: number;
    inactiveCount: number;
    problematicCount: number;
    contextWarningCount: number;
    highContextCount: number;
  };
  createdAt: string;
}

interface ActivationRow {
  capability_type: string;
  capability_id: string;
  workspace_id: string;
  active: number;
  created_at: string;
  updated_at: string;
}

interface UsageRow {
  id: string;
  capability_type: string;
  capability_id: string;
  workspace_id: string;
  agent_id: string | null;
  agent_version_id: string | null;
  run_id: string | null;
  outcome: string;
  context_tokens: number;
  occurred_at: string;
}

interface UsageSummaryRow {
  capability_id: string;
  call_count: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  context_tokens: number;
  last_used_at: string | null;
}

interface PublishDraftRow {
  id: string;
  skill_version_id: string;
  skill_id: string;
  display_name: string;
  description: string;
  skill_md: string;
  category: string;
  version: string;
  icon: string;
  attachments_json: string;
  created_at: string;
  updated_at: string;
}

interface OrganizeReportRow {
  id: string;
  workspace_id: string;
  context_budget_tokens: number;
  categories_json: string;
  summary_json: string;
  created_at: string;
}

function normalizeCapabilityType(value: unknown): CapabilityType {
  if (value === 'skill' || value === 'mcp') return value;
  throw new Error(`Unsupported capability type: ${String(value)}`);
}

function normalizeOutcome(value: unknown): CapabilityUsageOutcome {
  if (value === 'success' || value === 'failed' || value === 'cancelled') return value;
  throw new Error(`Unsupported capability outcome: ${String(value)}`);
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function safeJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function safeJsonObject<T extends object>(raw: string, fallback: T): T {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function mapActivation(row: ActivationRow): CapabilityWorkspaceActivationRecord {
  return {
    capabilityType: normalizeCapabilityType(row.capability_type),
    capabilityId: row.capability_id,
    workspaceId: row.workspace_id,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUsageEvent(row: UsageRow): CapabilityUsageEventRecord {
  return {
    id: row.id,
    capabilityType: normalizeCapabilityType(row.capability_type),
    capabilityId: row.capability_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id ?? undefined,
    agentVersionId: row.agent_version_id ?? undefined,
    runId: row.run_id ?? undefined,
    outcome: normalizeOutcome(row.outcome),
    contextTokens: row.context_tokens,
    occurredAt: row.occurred_at,
  };
}

function mapPublishDraft(row: PublishDraftRow): SkillPublishDraftRecord {
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    skillId: row.skill_id,
    displayName: row.display_name,
    description: row.description,
    skillMd: row.skill_md,
    category: row.category,
    version: row.version,
    icon: row.icon,
    attachments: safeJsonArray<SkillPublishAttachment>(row.attachments_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emptyCategories(): CapabilityOrganizeCategories {
  return {
    unused: [],
    inactive: [],
    problematic: [],
    contextWarning: [],
    highContext: [],
  };
}

function mapOrganizeReport(row: OrganizeReportRow): CapabilityOrganizeReportRecord {
  const categories = safeJsonObject(row.categories_json, emptyCategories());
  const summary = safeJsonObject(row.summary_json, {
    capabilityCount: 0,
    unusedCount: 0,
    inactiveCount: 0,
    problematicCount: 0,
    contextWarningCount: 0,
    highContextCount: 0,
  });
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    contextBudgetTokens: row.context_budget_tokens,
    categories,
    summary,
    createdAt: row.created_at,
  };
}

function normalizeIdList(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = String(value ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === 500) break;
  }
  return out;
}

export class SqliteCapabilityStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  setWorkspaceActivation(
    input: SetCapabilityWorkspaceActivationInput,
  ): CapabilityWorkspaceActivationRecord {
    const capabilityType = normalizeCapabilityType(input.capabilityType);
    const capabilityId = requiredText(input.capabilityId, 'capabilityId');
    const workspaceId = requiredText(input.workspaceId, 'workspaceId');
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO capability_workspace_activation (
           capability_type, capability_id, workspace_id, active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(capability_type, capability_id, workspace_id) DO UPDATE SET
           active = excluded.active,
           updated_at = excluded.updated_at`,
      )
      .run(capabilityType, capabilityId, workspaceId, input.active ? 1 : 0, now, now);
    const activation = this.getWorkspaceActivation(capabilityType, capabilityId, workspaceId);
    if (!activation) throw new Error('Failed to persist capability workspace activation');
    return activation;
  }

  getWorkspaceActivation(
    capabilityType: CapabilityType,
    capabilityId: string,
    workspaceId: string,
  ): CapabilityWorkspaceActivationRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT capability_type, capability_id, workspace_id, active, created_at, updated_at
         FROM capability_workspace_activation
         WHERE capability_type = ? AND capability_id = ? AND workspace_id = ?`,
      )
      .get(
        normalizeCapabilityType(capabilityType),
        requiredText(capabilityId, 'capabilityId'),
        requiredText(workspaceId, 'workspaceId'),
      ) as ActivationRow | undefined;
    return row ? mapActivation(row) : undefined;
  }

  listWorkspaceActivations(
    workspaceId: string,
    capabilityType?: CapabilityType,
  ): CapabilityWorkspaceActivationRecord[] {
    const workspace = requiredText(workspaceId, 'workspaceId');
    const rows = capabilityType
      ? (this.raw
          .prepare(
            `SELECT capability_type, capability_id, workspace_id, active, created_at, updated_at
             FROM capability_workspace_activation
             WHERE workspace_id = ? AND capability_type = ?
             ORDER BY updated_at DESC, capability_id`,
          )
          .all(workspace, normalizeCapabilityType(capabilityType)) as ActivationRow[])
      : (this.raw
          .prepare(
            `SELECT capability_type, capability_id, workspace_id, active, created_at, updated_at
             FROM capability_workspace_activation
             WHERE workspace_id = ?
             ORDER BY capability_type, updated_at DESC, capability_id`,
          )
          .all(workspace) as ActivationRow[]);
    return rows.map(mapActivation);
  }

  resolveEffectiveSkillVersionIds(
    workspaceId: string,
    selectedSkillVersionIds: readonly string[],
  ): string[] {
    return this.resolveComposeSkillVersionIds(workspaceId, selectedSkillVersionIds);
  }

  resolveComposeSkillVersionIds(
    workspaceId: string,
    selectedSkillVersionIds: readonly string[],
  ): string[] {
    return this.resolveWorkspaceEffectiveIds('skill', workspaceId, selectedSkillVersionIds);
  }

  resolveAgentSkillVersionIds(agentBoundSkillVersionIds: readonly string[]): string[] {
    return this.resolveGloballyEffectiveIds('skill', agentBoundSkillVersionIds);
  }

  resolveEffectiveMcpServerIds(
    workspaceId: string,
    agentBoundMcpServerIds: readonly string[],
  ): string[] {
    return this.resolveWorkspaceEffectiveIds('mcp', workspaceId, agentBoundMcpServerIds);
  }

  listActiveCapabilityIds(
    workspaceId: string,
    capabilityType: CapabilityType,
    limit = 500,
  ): string[] {
    const normalizedType = normalizeCapabilityType(capabilityType);
    const table = normalizedType === 'skill' ? 'skill_version' : 'mcp_server';
    const archiveClause = normalizedType === 'skill' ? 'AND capability.archived_at IS NULL' : '';
    const rows = this.raw
      .prepare(
        `SELECT capability.id
         FROM ${table} AS capability
         JOIN capability_workspace_activation AS activation
           ON activation.capability_type = ?
          AND activation.capability_id = capability.id
          AND activation.workspace_id = ?
          AND activation.active = 1
         WHERE capability.enabled = 1
           ${archiveClause}
         ORDER BY capability.created_at DESC
         LIMIT ?`,
      )
      .all(
        normalizedType,
        requiredText(workspaceId, 'workspaceId'),
        Math.max(1, Math.min(500, Math.trunc(limit))),
      ) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private resolveWorkspaceEffectiveIds(
    capabilityType: CapabilityType,
    workspaceId: string,
    candidateIds: readonly string[],
  ): string[] {
    const orderedIds = normalizeIdList(candidateIds);
    if (orderedIds.length === 0) return [];
    const placeholders = orderedIds.map(() => '?').join(', ');
    const table = capabilityType === 'skill' ? 'skill_version' : 'mcp_server';
    const archiveClause = capabilityType === 'skill' ? 'AND capability.archived_at IS NULL' : '';
    const rows = this.raw
      .prepare(
        `SELECT capability.id
         FROM ${table} AS capability
         JOIN capability_workspace_activation AS activation
           ON activation.capability_type = ?
          AND activation.capability_id = capability.id
          AND activation.workspace_id = ?
          AND activation.active = 1
         WHERE capability.enabled = 1
           ${archiveClause}
           AND capability.id IN (${placeholders})`,
      )
      .all(
        capabilityType,
        requiredText(workspaceId, 'workspaceId'),
        ...orderedIds,
      ) as Array<{ id: string }>;
    const effective = new Set(rows.map((row) => row.id));
    return orderedIds.filter((id) => effective.has(id));
  }

  private resolveGloballyEffectiveIds(
    capabilityType: CapabilityType,
    candidateIds: readonly string[],
  ): string[] {
    const orderedIds = normalizeIdList(candidateIds);
    if (orderedIds.length === 0) return [];
    const placeholders = orderedIds.map(() => '?').join(', ');
    const table = capabilityType === 'skill' ? 'skill_version' : 'mcp_server';
    const archiveClause = capabilityType === 'skill' ? 'AND archived_at IS NULL' : '';
    const rows = this.raw
      .prepare(
        `SELECT id
         FROM ${table}
         WHERE enabled = 1
           ${archiveClause}
           AND id IN (${placeholders})`,
      )
      .all(...orderedIds) as Array<{ id: string }>;
    const effective = new Set(rows.map((row) => row.id));
    return orderedIds.filter((id) => effective.has(id));
  }

  appendUsageEvent(input: AppendCapabilityUsageEventInput): CapabilityUsageEventRecord {
    const id = String(input.id ?? ulid()).trim();
    const capabilityType = normalizeCapabilityType(input.capabilityType);
    const capabilityId = requiredText(input.capabilityId, 'capabilityId');
    const workspaceId = requiredText(input.workspaceId, 'workspaceId');
    const outcome = normalizeOutcome(input.outcome);
    const contextTokens = Math.max(0, Math.trunc(Number(input.contextTokens) || 0));
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO capability_usage_event (
           id, capability_type, capability_id, workspace_id,
           agent_id, agent_version_id, run_id, outcome, context_tokens, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        capabilityType,
        capabilityId,
        workspaceId,
        String(input.agentId ?? '').trim() || null,
        String(input.agentVersionId ?? '').trim() || null,
        String(input.runId ?? '').trim() || null,
        outcome,
        contextTokens,
        occurredAt,
      );
    const row = this.raw
      .prepare(
        `SELECT id, capability_type, capability_id, workspace_id,
                agent_id, agent_version_id, run_id, outcome, context_tokens, occurred_at
         FROM capability_usage_event WHERE id = ?`,
      )
      .get(id) as UsageRow | undefined;
    if (!row) throw new Error('Failed to append capability usage event');
    return mapUsageEvent(row);
  }

  summarizeUsage(input: SummarizeCapabilityUsageInput): CapabilityUsageSummary[] {
    const capabilityType = normalizeCapabilityType(input.capabilityType);
    const capabilityIds = normalizeIdList(input.capabilityIds);
    if (capabilityIds.length === 0) return [];
    const now = new Date(input.now ?? new Date().toISOString());
    if (Number.isNaN(now.getTime())) throw new Error('now must be a valid ISO date');
    const windowDays = Math.max(1, Math.min(3650, Math.trunc(input.windowDays ?? 45)));
    const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    const placeholders = capabilityIds.map(() => '?').join(', ');
    const rows = this.raw
      .prepare(
        `SELECT
           capability_id,
           COUNT(*) AS call_count,
           SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_count,
           SUM(CASE WHEN outcome = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
           SUM(context_tokens) AS context_tokens,
           MAX(occurred_at) AS last_used_at
         FROM capability_usage_event
         WHERE capability_type = ?
           AND workspace_id = ?
           AND occurred_at >= ?
           AND occurred_at <= ?
           AND capability_id IN (${placeholders})
         GROUP BY capability_id`,
      )
      .all(
        capabilityType,
        requiredText(input.workspaceId, 'workspaceId'),
        since,
        now.toISOString(),
        ...capabilityIds,
      ) as UsageSummaryRow[];
    const byId = new Map(rows.map((row) => [row.capability_id, row] as const));
    return capabilityIds.map((capabilityId) => {
      const row = byId.get(capabilityId);
      const failedCount = Number(row?.failed_count ?? 0);
      return {
        capabilityType,
        capabilityId,
        callCount: Number(row?.call_count ?? 0),
        successCount: Number(row?.success_count ?? 0),
        failedCount,
        cancelledCount: Number(row?.cancelled_count ?? 0),
        problemCount: failedCount,
        contextTokens: Number(row?.context_tokens ?? 0),
        lastUsedAt: row?.last_used_at ?? undefined,
      };
    });
  }

  saveSkillPublishDraft(input: SaveSkillPublishDraftInput): SkillPublishDraftRecord {
    const id = String(input.id ?? ulid()).trim();
    const current = this.getSkillPublishDraft(id);
    const now = input.now ?? new Date().toISOString();
    const createdAt = current?.createdAt ?? input.createdAt ?? now;
    const attachments = Array.isArray(input.attachments)
      ? input.attachments
          .map((attachment) => ({
            ...attachment,
            name: String(attachment.name ?? '').trim(),
            size: Math.max(0, Math.trunc(Number(attachment.size) || 0)),
          }))
          .filter((attachment) => attachment.name.length > 0)
      : [];
    this.raw
      .prepare(
        `INSERT INTO skill_publish_draft (
           id, skill_version_id, skill_id, display_name, description, skill_md,
           category, version, icon, attachments_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           skill_version_id = excluded.skill_version_id,
           skill_id = excluded.skill_id,
           display_name = excluded.display_name,
           description = excluded.description,
           skill_md = excluded.skill_md,
           category = excluded.category,
           version = excluded.version,
           icon = excluded.icon,
           attachments_json = excluded.attachments_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        requiredText(input.skillVersionId, 'skillVersionId'),
        requiredText(input.skillId, 'skillId'),
        requiredText(input.displayName, 'displayName'),
        String(input.description ?? '').trim(),
        String(input.skillMd ?? ''),
        String(input.category ?? '').trim(),
        requiredText(input.version, 'version'),
        String(input.icon ?? '').trim(),
        JSON.stringify(attachments),
        createdAt,
        now,
      );
    const saved = this.getSkillPublishDraft(id);
    if (!saved) throw new Error('Failed to save Skill publish draft');
    return saved;
  }

  getSkillPublishDraft(id: string): SkillPublishDraftRecord | undefined {
    const draftId = requiredText(id, 'draftId');
    const row = this.raw
      .prepare(
        `SELECT id, skill_version_id, skill_id, display_name, description, skill_md,
                category, version, icon, attachments_json, created_at, updated_at
         FROM skill_publish_draft WHERE id = ?`,
      )
      .get(draftId) as PublishDraftRow | undefined;
    return row ? mapPublishDraft(row) : undefined;
  }

  listSkillPublishDrafts(skillId?: string, limit = 100): SkillPublishDraftRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const normalizedSkillId = String(skillId ?? '').trim();
    const rows = normalizedSkillId
      ? (this.raw
          .prepare(
            `SELECT id, skill_version_id, skill_id, display_name, description, skill_md,
                    category, version, icon, attachments_json, created_at, updated_at
             FROM skill_publish_draft
             WHERE skill_id = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(normalizedSkillId, safeLimit) as PublishDraftRow[])
      : (this.raw
          .prepare(
            `SELECT id, skill_version_id, skill_id, display_name, description, skill_md,
                    category, version, icon, attachments_json, created_at, updated_at
             FROM skill_publish_draft
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(safeLimit) as PublishDraftRow[]);
    return rows.map(mapPublishDraft);
  }

  submitSkillPublishDraft(id: string): {
    submitted: false;
    reason: 'channel-unavailable';
    message: string;
  } {
    if (!this.getSkillPublishDraft(id)) throw new Error('Skill publish draft not found');
    return {
      submitted: false,
      reason: 'channel-unavailable',
      message: '市场发布渠道暂未开放',
    };
  }

  generateOrganizeReport(input: {
    workspaceId: string;
    contextBudgetTokens: number;
    now?: string;
  }): CapabilityOrganizeReportRecord {
    const workspaceId = requiredText(input.workspaceId, 'workspaceId');
    const contextBudgetTokens = Math.trunc(Number(input.contextBudgetTokens));
    if (!Number.isSafeInteger(contextBudgetTokens) || contextBudgetTokens <= 0) {
      throw new Error('contextBudgetTokens must be a positive safe integer');
    }
    const now = new Date(input.now ?? new Date().toISOString());
    if (Number.isNaN(now.getTime())) throw new Error('now must be a valid ISO date');
    const since = new Date(now.getTime() - 45 * 86_400_000).toISOString();
    const capabilities = this.raw
      .prepare(
        `SELECT 'skill' AS capability_type, id AS capability_id
         FROM skill_version WHERE archived_at IS NULL
         UNION ALL
         SELECT 'mcp' AS capability_type, id AS capability_id
         FROM mcp_server
         ORDER BY capability_type, capability_id`,
      )
      .all() as Array<{ capability_type: CapabilityType; capability_id: string }>;
    const activations = new Set<string>(
      (
        this.raw
          .prepare(
            `SELECT capability_type, capability_id
             FROM capability_workspace_activation
             WHERE workspace_id = ? AND active = 1`,
          )
          .all(workspaceId) as Array<{
          capability_type: CapabilityType;
          capability_id: string;
        }>
      ).map((row) => `${row.capability_type}:${row.capability_id}`),
    );
    const usageRows = this.raw
      .prepare(
        `SELECT capability_type, capability_id,
                COUNT(*) AS call_count,
                SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                SUM(context_tokens) AS context_tokens
         FROM capability_usage_event
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at <= ?
         GROUP BY capability_type, capability_id`,
      )
      .all(workspaceId, since, now.toISOString()) as Array<{
      capability_type: CapabilityType;
      capability_id: string;
      call_count: number;
      failed_count: number;
      context_tokens: number;
    }>;
    const usageByCapability = new Map<
      string,
      {
        capability_type: CapabilityType;
        capability_id: string;
        call_count: number;
        failed_count: number;
        context_tokens: number;
      }
    >(
      usageRows.map((row) => [`${row.capability_type}:${row.capability_id}`, row] as const),
    );
    const categories = emptyCategories();
    const warningThreshold = contextBudgetTokens * 0.7;
    const highThreshold = contextBudgetTokens * 0.9;
    for (const capability of capabilities) {
      const key = `${capability.capability_type}:${capability.capability_id}`;
      const usage = usageByCapability.get(key);
      if (!usage || usage.call_count === 0) categories.unused.push(capability.capability_id);
      if (!activations.has(key)) categories.inactive.push(capability.capability_id);
      if ((usage?.failed_count ?? 0) > 0) categories.problematic.push(capability.capability_id);
      const contextTokens = usage?.context_tokens ?? 0;
      if (contextTokens >= warningThreshold) {
        categories.contextWarning.push(capability.capability_id);
      }
      if (contextTokens >= highThreshold) categories.highContext.push(capability.capability_id);
    }
    const summary = {
      capabilityCount: capabilities.length,
      unusedCount: categories.unused.length,
      inactiveCount: categories.inactive.length,
      problematicCount: categories.problematic.length,
      contextWarningCount: categories.contextWarning.length,
      highContextCount: categories.highContext.length,
    };
    const id = ulid();
    this.raw
      .prepare(
        `INSERT INTO capability_organize_report (
           id, workspace_id, context_budget_tokens, categories_json, summary_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspaceId,
        contextBudgetTokens,
        JSON.stringify(categories),
        JSON.stringify(summary),
        now.toISOString(),
      );
    const report = this.getOrganizeReport(id);
    if (!report) throw new Error('Failed to generate capability organize report');
    return report;
  }

  getOrganizeReport(id: string): CapabilityOrganizeReportRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, context_budget_tokens, categories_json, summary_json, created_at
         FROM capability_organize_report WHERE id = ?`,
      )
      .get(requiredText(id, 'reportId')) as OrganizeReportRow | undefined;
    return row ? mapOrganizeReport(row) : undefined;
  }

  getLatestOrganizeReport(workspaceId: string): CapabilityOrganizeReportRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, context_budget_tokens, categories_json, summary_json, created_at
         FROM capability_organize_report
         WHERE workspace_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(requiredText(workspaceId, 'workspaceId')) as OrganizeReportRow | undefined;
    return row ? mapOrganizeReport(row) : undefined;
  }
}
