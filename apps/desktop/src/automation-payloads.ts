import type {
  CreateAutomationPayload,
  DeleteAutomationPayload,
  GetAutomationPayload,
  ListAutomationExecutionsPayload,
  ListAutomationsPayload,
  TriggerAutomationPayload,
  UpdateAutomationPayload,
} from '@sync-think/protocol';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const CREATE_KEYS = new Set([
  'name',
  'workspaceId',
  'target',
  'instruction',
  'approvalMode',
  'trigger',
  'timezone',
  'concurrencyPolicy',
  'maxConcurrency',
  'maxRetries',
  'enabled',
]);
const APPROVAL_MODES = new Set(['request', 'delegate', 'full', 'custom']);
const CONCURRENCY_POLICIES = new Set(['skip', 'queue', 'parallel']);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function create(value: unknown, update = false): CreateAutomationPayload {
  if (!record(value) || !record(value.target) || !record(value.trigger)) {
    throw new Error('Invalid automation payload');
  }
  if (
    Object.keys(value).some(
      (key) =>
        !CREATE_KEYS.has(key) &&
        !(update && (key === 'automationId' || key === 'expectedVersion')),
    )
  ) {
    throw new Error('Invalid automation payload');
  }
  const target =
    value.target.type === 'agent' &&
    Object.keys(value.target).every((key) => key === 'type' || key === 'agentVersionId') &&
    typeof value.target.agentVersionId === 'string' &&
    value.target.agentVersionId.trim().length > 0 &&
    value.target.agentVersionId.length <= 256
      ? { type: 'agent' as const, agentVersionId: value.target.agentVersionId.trim() as never }
      : value.target.type === 'group' &&
          Object.keys(value.target).every((key) => key === 'type' || key === 'groupId') &&
          typeof value.target.groupId === 'string' &&
          value.target.groupId.trim().length > 0 &&
          value.target.groupId.length <= 256
        ? { type: 'group' as const, groupId: value.target.groupId.trim() as never }
        : undefined;
  const trigger =
    value.trigger.type === 'cron' &&
    Object.keys(value.trigger).every((key) => key === 'type' || key === 'expression') &&
    typeof value.trigger.expression === 'string' &&
    value.trigger.expression.trim().length > 0 &&
    value.trigger.expression.length <= 256
      ? { type: 'cron' as const, expression: value.trigger.expression.trim() }
      : value.trigger.type === 'webhook' && Object.keys(value.trigger).length === 1
        ? { type: 'webhook' as const }
        : undefined;
  if (
    !target ||
    !trigger ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 256 ||
    typeof value.workspaceId !== 'string' ||
    !value.workspaceId.trim() ||
    value.workspaceId.length > 256 ||
    typeof value.instruction !== 'string' ||
    !value.instruction.trim() ||
    value.instruction.length > 32_000 ||
    (value.maxConcurrency !== undefined &&
      (!Number.isInteger(value.maxConcurrency) || Number(value.maxConcurrency) < 1 || Number(value.maxConcurrency) > 8)) ||
    (value.maxRetries !== undefined &&
      (!Number.isInteger(value.maxRetries) ||
        Number(value.maxRetries) < 0 ||
        Number(value.maxRetries) > 2)) ||
    (value.approvalMode !== undefined &&
      (typeof value.approvalMode !== 'string' || !APPROVAL_MODES.has(value.approvalMode))) ||
    (value.concurrencyPolicy !== undefined &&
      (typeof value.concurrencyPolicy !== 'string' ||
        !CONCURRENCY_POLICIES.has(value.concurrencyPolicy))) ||
    (value.timezone !== undefined &&
      (typeof value.timezone !== 'string' ||
        value.timezone.trim().length === 0 ||
        value.timezone.length > 128)) ||
    (value.enabled !== undefined && typeof value.enabled !== 'boolean')
  ) {
    throw new Error('Invalid automation payload');
  }
  return {
    name: value.name.trim(),
    workspaceId: value.workspaceId.trim() as never,
    target,
    instruction: value.instruction.trim(),
    trigger,
    ...(typeof value.approvalMode === 'string' ? { approvalMode: value.approvalMode as never } : {}),
    ...(typeof value.timezone === 'string' ? { timezone: value.timezone.trim() } : {}),
    ...(typeof value.concurrencyPolicy === 'string'
      ? { concurrencyPolicy: value.concurrencyPolicy as never }
      : {}),
    ...(value.maxConcurrency !== undefined ? { maxConcurrency: Number(value.maxConcurrency) } : {}),
    ...(value.maxRetries !== undefined ? { maxRetries: Number(value.maxRetries) } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
  };
}

export function parseCreateAutomationPayload(value: unknown): CreateAutomationPayload {
  return create(value);
}

export function parseUpdateAutomationPayload(value: unknown): UpdateAutomationPayload {
  const base = create(value, true);
  if (
    !record(value) ||
    typeof value.automationId !== 'string' ||
    !value.automationId.trim() ||
    !Number.isInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1
  ) {
    throw new Error('Invalid automation update payload');
  }
  return {
    ...base,
    automationId: value.automationId.trim() as never,
    expectedVersion: Number(value.expectedVersion),
  };
}

export function parseDeleteAutomationPayload(value: unknown): DeleteAutomationPayload {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ['automationId', 'expectedVersion']) ||
    typeof value.automationId !== 'string' ||
    !value.automationId.trim() ||
    !Number.isInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1
  ) {
    throw new Error('Invalid automation delete payload');
  }
  return {
    automationId: value.automationId.trim() as never,
    expectedVersion: Number(value.expectedVersion),
  };
}

export function parseGetAutomationPayload(value: unknown): GetAutomationPayload {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ['automationId']) ||
    typeof value.automationId !== 'string' ||
    !value.automationId.trim() ||
    value.automationId.length > 256
  ) {
    throw new Error('Invalid automation id');
  }
  return { automationId: value.automationId.trim() as never };
}

export function parseListAutomationsPayload(value: unknown): ListAutomationsPayload {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'includeDisabled', 'limit']) ||
    (value.workspaceId !== undefined &&
      (typeof value.workspaceId !== 'string' ||
        value.workspaceId.trim().length === 0 ||
        value.workspaceId.length > 256)) ||
    (value.includeDisabled !== undefined && typeof value.includeDisabled !== 'boolean') ||
    (value.limit !== undefined &&
      (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 500))
  ) {
    throw new Error('Invalid automation list payload');
  }
  return {
    ...(typeof value.workspaceId === 'string' && value.workspaceId.trim()
      ? { workspaceId: value.workspaceId.trim() as never }
      : {}),
    ...(typeof value.includeDisabled === 'boolean'
      ? { includeDisabled: value.includeDisabled }
      : {}),
    ...(Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 500
      ? { limit: Number(value.limit) }
      : {}),
  };
}

export function parseTriggerAutomationPayload(value: unknown): TriggerAutomationPayload {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ['automationId', 'input']) ||
    typeof value.automationId !== 'string' ||
    value.automationId.trim().length === 0 ||
    value.automationId.length > 256 ||
    (value.input !== undefined &&
      (typeof value.input !== 'string' || value.input.length > 32_000))
  ) {
    throw new Error('Invalid automation trigger input');
  }
  return {
    automationId: value.automationId.trim() as never,
    ...(typeof value.input === 'string' && value.input.trim()
      ? { input: value.input.trim() }
      : {}),
  };
}

export function parseListAutomationExecutionsPayload(
  value: unknown,
): ListAutomationExecutionsPayload {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ['automationId', 'limit']) ||
    (value.automationId !== undefined &&
      (typeof value.automationId !== 'string' ||
        value.automationId.trim().length === 0 ||
        value.automationId.length > 256)) ||
    (value.limit !== undefined &&
      (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 500))
  ) {
    throw new Error('Invalid automation execution list payload');
  }
  return {
    ...(typeof value.automationId === 'string' && value.automationId.trim()
      ? { automationId: value.automationId.trim() as never }
      : {}),
    ...(Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 500
      ? { limit: Number(value.limit) }
      : {}),
  };
}
