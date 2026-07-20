import {
  ulid,
  type ApprovalMode,
  type AgentVersionId,
  type AutomationConcurrencyPolicy,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationExecutionId,
  type AutomationExecutionStatus,
  type AutomationId,
  type AutomationTarget,
  type AutomationTrigger,
  type AutomationTriggerSource,
  type GroupId,
  type TaskId,
  type WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export interface CreateAutomationInput {
  id?: AutomationId;
  name: string;
  workspaceId: WorkspaceId;
  target: AutomationTarget;
  instruction: string;
  approvalMode?: ApprovalMode;
  trigger: AutomationTrigger;
  timezone?: string;
  concurrencyPolicy?: AutomationConcurrencyPolicy;
  maxConcurrency?: number;
  maxRetries?: number;
  enabled?: boolean;
  webhookSecretHandle?: string;
  nextTriggerAt?: string;
  now?: string;
}

export interface ReplaceAutomationInput extends Omit<CreateAutomationInput, 'id' | 'now'> {
  automationId: AutomationId;
  expectedVersion: number;
  now?: string;
}

export interface CreateAutomationExecutionInput {
  id?: AutomationExecutionId;
  automationId: AutomationId;
  triggerId: string;
  source: AutomationTriggerSource;
  status: AutomationExecutionStatus;
  attempt: number;
  taskId?: TaskId;
  inputDigest: string;
  errorSummary?: string;
  startedAt?: string;
  completedAt?: string;
  now?: string;
}

interface AutomationRow {
  id: string;
  name: string;
  workspace_id: string;
  target_type: string;
  agent_version_id: string | null;
  group_id: string | null;
  instruction: string;
  approval_mode: string;
  trigger_type: string;
  cron_expression: string | null;
  timezone: string;
  webhook_path: string | null;
  webhook_secret_handle: string | null;
  concurrency_policy: string;
  max_concurrency: number;
  max_retries: number;
  enabled: number;
  version: number;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  id: string;
  automation_id: string;
  trigger_id: string;
  source: string;
  status: string;
  attempt: number;
  task_id: string | null;
  input_digest: string;
  error_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const APPROVAL_MODES = new Set<ApprovalMode>(['request', 'delegate', 'full', 'custom']);
const CONCURRENCY_POLICIES = new Set<AutomationConcurrencyPolicy>(['skip', 'queue', 'parallel']);
const EXECUTION_STATUSES = new Set<AutomationExecutionStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'skipped',
]);
const TRIGGER_SOURCES = new Set<AutomationTriggerSource>(['schedule', 'webhook', 'manual']);
const WEBHOOK_PATH = /^[a-z0-9][a-z0-9_-]{7,63}$/;

function text(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`automation.${label}_invalid`);
  return normalized;
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`automation.${label}_invalid`);
  }
  return value;
}

function normalizeTarget(target: AutomationTarget): AutomationTarget {
  if (target.type === 'agent') {
    return {
      type: 'agent',
      agentVersionId: text(String(target.agentVersionId), 'agent', 256) as AgentVersionId,
    };
  }
  if (target.type === 'group') {
    return {
      type: 'group',
      groupId: text(String(target.groupId), 'group', 256) as GroupId,
    };
  }
  throw new Error('automation.target_invalid');
}

function normalizeTrigger(trigger: AutomationTrigger): AutomationTrigger {
  if (trigger.type === 'cron') {
    return { type: 'cron', expression: text(trigger.expression, 'cron_expression', 256) };
  }
  if (trigger.type === 'webhook' && WEBHOOK_PATH.test(trigger.path)) {
    return { type: 'webhook', path: trigger.path };
  }
  throw new Error('automation.trigger_invalid');
}

function targetColumns(target: AutomationTarget): [string, string | null, string | null] {
  return target.type === 'agent'
    ? ['agent', String(target.agentVersionId), null]
    : ['group', null, String(target.groupId)];
}

function triggerColumns(
  trigger: AutomationTrigger,
  webhookSecretHandle?: string,
): [string, string | null, string | null, string | null] {
  if (trigger.type === 'cron') return ['cron', trigger.expression, null, null];
  const handle = text(webhookSecretHandle ?? '', 'webhook_secret_handle', 512);
  return ['webhook', null, trigger.path, handle];
}

export class SqliteAutomationStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: CreateAutomationInput): AutomationDefinition {
    const id = input.id ?? (`automation-${ulid().toLowerCase()}` as AutomationId);
    const target = normalizeTarget(input.target);
    const trigger = normalizeTrigger(input.trigger);
    const [targetType, agentVersionId, groupId] = targetColumns(target);
    const [triggerType, cronExpression, webhookPath, webhookSecretHandle] = triggerColumns(
      trigger,
      input.webhookSecretHandle,
    );
    const approvalMode = input.approvalMode ?? 'full';
    const concurrencyPolicy = input.concurrencyPolicy ?? 'skip';
    if (!APPROVAL_MODES.has(approvalMode)) throw new Error('automation.approval_mode_invalid');
    if (!CONCURRENCY_POLICIES.has(concurrencyPolicy)) {
      throw new Error('automation.concurrency_policy_invalid');
    }
    const maxConcurrency = boundedInteger(input.maxConcurrency ?? 1, 1, 8, 'max_concurrency');
    const maxRetries = boundedInteger(input.maxRetries ?? 0, 0, 2, 'max_retries');
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO automation (
          id, name, workspace_id, target_type, agent_version_id, group_id, instruction,
          approval_mode, trigger_type, cron_expression, timezone, webhook_path,
          webhook_secret_handle, concurrency_policy, max_concurrency, max_retries,
          enabled, version, last_triggered_at, next_trigger_at, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        text(input.name, 'name', 256),
        input.workspaceId,
        targetType,
        agentVersionId,
        groupId,
        text(input.instruction, 'instruction', 32_000),
        approvalMode,
        triggerType,
        cronExpression,
        text(input.timezone ?? 'Asia/Shanghai', 'timezone', 128),
        webhookPath,
        webhookSecretHandle,
        concurrencyPolicy,
        maxConcurrency,
        maxRetries,
        input.enabled === false ? 0 : 1,
        input.nextTriggerAt ?? null,
        now,
        now,
      );
    return this.getRequired(id);
  }

  replace(input: ReplaceAutomationInput): AutomationDefinition {
    const current = this.getRequired(input.automationId);
    if (current.version !== input.expectedVersion) {
      throw new Error(`automation.version_conflict:${input.expectedVersion}:${current.version}`);
    }
    const target = normalizeTarget(input.target);
    const trigger = normalizeTrigger(input.trigger);
    const [targetType, agentVersionId, groupId] = targetColumns(target);
    const [triggerType, cronExpression, webhookPath, webhookSecretHandle] = triggerColumns(
      trigger,
      input.webhookSecretHandle,
    );
    const approvalMode = input.approvalMode ?? 'full';
    const concurrencyPolicy = input.concurrencyPolicy ?? 'skip';
    if (!APPROVAL_MODES.has(approvalMode)) throw new Error('automation.approval_mode_invalid');
    if (!CONCURRENCY_POLICIES.has(concurrencyPolicy)) {
      throw new Error('automation.concurrency_policy_invalid');
    }
    const updatedAt = input.now ?? new Date().toISOString();
    const nextVersion = current.version + 1;
    const result = this.raw
      .prepare(
        `UPDATE automation SET
          name = ?, workspace_id = ?, target_type = ?, agent_version_id = ?, group_id = ?,
          instruction = ?, approval_mode = ?, trigger_type = ?, cron_expression = ?, timezone = ?,
          webhook_path = ?, webhook_secret_handle = ?, concurrency_policy = ?, max_concurrency = ?,
          max_retries = ?, enabled = ?, version = ?, next_trigger_at = ?, updated_at = ?
         WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .run(
        text(input.name, 'name', 256),
        input.workspaceId,
        targetType,
        agentVersionId,
        groupId,
        text(input.instruction, 'instruction', 32_000),
        approvalMode,
        triggerType,
        cronExpression,
        text(input.timezone ?? 'Asia/Shanghai', 'timezone', 128),
        webhookPath,
        webhookSecretHandle,
        concurrencyPolicy,
        boundedInteger(input.maxConcurrency ?? 1, 1, 8, 'max_concurrency'),
        boundedInteger(input.maxRetries ?? 0, 0, 2, 'max_retries'),
        input.enabled === false ? 0 : 1,
        nextVersion,
        input.nextTriggerAt ?? null,
        updatedAt,
        input.automationId,
        input.expectedVersion,
      );
    if (result.changes !== 1) throw new Error('automation.version_conflict');
    return this.getRequired(input.automationId);
  }

  softDelete(automationId: AutomationId, expectedVersion: number, now = new Date().toISOString()): AutomationDefinition {
    const current = this.getRequired(automationId);
    if (current.version !== expectedVersion) throw new Error('automation.version_conflict');
    const result = this.raw
      .prepare(
        `UPDATE automation SET enabled = 0, deleted_at = ?, next_trigger_at = NULL,
          version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .run(now, now, automationId, expectedVersion);
    if (result.changes !== 1) throw new Error('automation.version_conflict');
    return { ...current, enabled: false, version: current.version + 1, nextTriggerAt: undefined, updatedAt: now };
  }

  get(automationId: AutomationId | string): AutomationDefinition | undefined {
    const row = this.raw
      .prepare('SELECT * FROM automation WHERE id = ? AND deleted_at IS NULL')
      .get(String(automationId)) as AutomationRow | undefined;
    return row ? mapAutomation(row) : undefined;
  }

  getRequired(automationId: AutomationId | string): AutomationDefinition {
    const automation = this.get(automationId);
    if (!automation) throw new Error(`automation.not_found:${String(automationId)}`);
    return automation;
  }

  getWebhookSecretHandle(automationId: AutomationId | string): string | undefined {
    const row = this.raw
      .prepare('SELECT webhook_secret_handle FROM automation WHERE id = ? AND deleted_at IS NULL')
      .get(String(automationId)) as { webhook_secret_handle: string | null } | undefined;
    return row?.webhook_secret_handle ?? undefined;
  }

  getByWebhookPath(path: string): AutomationDefinition | undefined {
    const row = this.raw
      .prepare('SELECT * FROM automation WHERE webhook_path = ? AND deleted_at IS NULL')
      .get(path) as AutomationRow | undefined;
    return row ? mapAutomation(row) : undefined;
  }

  list(input: { workspaceId?: WorkspaceId; includeDisabled?: boolean; limit?: number } = {}): AutomationDefinition[] {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const rows = input.workspaceId
      ? (this.raw
          .prepare(
            `SELECT * FROM automation WHERE workspace_id = ? AND deleted_at IS NULL
             ${input.includeDisabled ? '' : 'AND enabled = 1'} ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(input.workspaceId, limit) as AutomationRow[])
      : (this.raw
          .prepare(
            `SELECT * FROM automation WHERE deleted_at IS NULL
             ${input.includeDisabled ? '' : 'AND enabled = 1'} ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(limit) as AutomationRow[]);
    return rows.map(mapAutomation);
  }

  listDue(now: string): AutomationDefinition[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM automation WHERE deleted_at IS NULL AND enabled = 1
         AND trigger_type = 'cron' AND next_trigger_at IS NOT NULL AND next_trigger_at <= ?
         ORDER BY next_trigger_at ASC`,
      )
      .all(now) as AutomationRow[];
    return rows.map(mapAutomation);
  }

  updateTriggerTimes(automationId: AutomationId, lastTriggeredAt: string | undefined, nextTriggerAt: string | undefined, now: string): void {
    this.raw
      .prepare(
        'UPDATE automation SET last_triggered_at = ?, next_trigger_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      )
      .run(lastTriggeredAt ?? null, nextTriggerAt ?? null, now, automationId);
  }

  createExecution(input: CreateAutomationExecutionInput): AutomationExecution {
    if (!TRIGGER_SOURCES.has(input.source)) throw new Error('automation.execution_source_invalid');
    if (!EXECUTION_STATUSES.has(input.status)) throw new Error('automation.execution_status_invalid');
    const attempt = boundedInteger(input.attempt, 0, 2, 'execution_attempt');
    const id = input.id ?? (`automation-execution-${ulid().toLowerCase()}` as AutomationExecutionId);
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO automation_execution (
          id, automation_id, trigger_id, source, status, attempt, task_id, input_digest,
          error_summary, started_at, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.automationId,
        text(input.triggerId, 'trigger_id', 256),
        input.source,
        input.status,
        attempt,
        input.taskId ?? null,
        text(input.inputDigest, 'input_digest', 128),
        input.errorSummary ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        now,
      );
    return this.getExecution(id)!;
  }

  getExecution(id: AutomationExecutionId | string): AutomationExecution | undefined {
    const row = this.raw.prepare('SELECT * FROM automation_execution WHERE id = ?').get(String(id)) as ExecutionRow | undefined;
    return row ? mapExecution(row) : undefined;
  }

  transitionExecution(
    id: AutomationExecutionId,
    status: AutomationExecutionStatus,
    input: { errorSummary?: string; startedAt?: string; completedAt?: string } = {},
  ): AutomationExecution {
    if (!EXECUTION_STATUSES.has(status)) throw new Error('automation.execution_status_invalid');
    const current = this.getExecution(id);
    if (!current) throw new Error(`automation.execution_not_found:${id}`);
    this.raw
      .prepare(
        `UPDATE automation_execution SET status = ?, error_summary = ?, started_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        input.errorSummary ?? current.errorSummary ?? null,
        input.startedAt ?? current.startedAt ?? null,
        input.completedAt ?? current.completedAt ?? null,
        id,
      );
    return this.getExecution(id)!;
  }

  listExecutions(input: { automationId?: AutomationId; status?: AutomationExecutionStatus; limit?: number } = {}): AutomationExecution[] {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.automationId) {
      clauses.push('automation_id = ?');
      params.push(input.automationId);
    }
    if (input.status) {
      clauses.push('status = ?');
      params.push(input.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.raw
      .prepare(`SELECT * FROM automation_execution ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...params, limit) as ExecutionRow[];
    return rows.map(mapExecution);
  }

  countActive(automationId: AutomationId): number {
    const row = this.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM automation_execution WHERE automation_id = ? AND status = 'running'",
      )
      .get(automationId) as { count: number };
    return row.count;
  }
}

function mapAutomation(row: AutomationRow): AutomationDefinition {
  const target: AutomationTarget =
    row.target_type === 'agent' && row.agent_version_id
      ? { type: 'agent', agentVersionId: row.agent_version_id as AgentVersionId }
      : { type: 'group', groupId: row.group_id as GroupId };
  const trigger: AutomationTrigger =
    row.trigger_type === 'cron' && row.cron_expression
      ? { type: 'cron', expression: row.cron_expression }
      : { type: 'webhook', path: row.webhook_path! };
  return {
    id: row.id as AutomationId,
    name: row.name,
    workspaceId: row.workspace_id as WorkspaceId,
    target,
    instruction: row.instruction,
    approvalMode: row.approval_mode as ApprovalMode,
    trigger,
    timezone: row.timezone,
    concurrencyPolicy: row.concurrency_policy as AutomationConcurrencyPolicy,
    maxConcurrency: row.max_concurrency,
    maxRetries: row.max_retries,
    enabled: row.enabled === 1,
    webhookSecretConfigured: Boolean(row.webhook_secret_handle),
    version: row.version,
    ...(row.last_triggered_at ? { lastTriggeredAt: row.last_triggered_at } : {}),
    ...(row.next_trigger_at ? { nextTriggerAt: row.next_trigger_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExecution(row: ExecutionRow): AutomationExecution {
  return {
    id: row.id as AutomationExecutionId,
    automationId: row.automation_id as AutomationId,
    triggerId: row.trigger_id,
    source: row.source as AutomationTriggerSource,
    status: row.status as AutomationExecutionStatus,
    attempt: row.attempt,
    ...(row.task_id ? { taskId: row.task_id as TaskId } : {}),
    inputDigest: row.input_digest,
    ...(row.error_summary ? { errorSummary: row.error_summary } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
  };
}
