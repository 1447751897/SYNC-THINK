import type {
  ListPoliciesPayload,
  SavePolicyPayload,
  ListAgentsPayload,
  CreateAgentPayload,
  ListAgentVersionsPayload,
  CreateAgentVersionPayload,
} from '@sync-think/protocol';
import { MAX_REVIEW_ITERATIONS } from '@sync-think/shared';
import {
  assertRendererSafeOrchestrationPayload,
  boundedText,
  hasOnlyKeys,
  invalid,
  isRecord,
} from './orchestration-payload-validation.js';
export { assertRendererSafeOrchestrationPayload } from './orchestration-payload-validation.js';

const MAX_ID = 256;
const APPROVAL_MODES = new Set(['request', 'delegate', 'full', 'custom']);
const POLICY_SCOPES = new Set(['user', 'workspace', 'project', 'task', 'agent', 'workflow', 'run']);
const AGENT_MEMORY_SCOPES = new Set(['task', 'project', 'global']);
export function parsePolicySavePayload(value: unknown): SavePolicyPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'policyId',
      'scopeType',
      'scopeId',
      'approvalMode',
      'rules',
    ]) ||
    !boundedText(value.workspaceId) ||
    (value.policyId !== undefined && !boundedText(value.policyId)) ||
    typeof value.scopeType !== 'string' ||
    !POLICY_SCOPES.has(value.scopeType) ||
    !boundedText(value.scopeId) ||
    typeof value.approvalMode !== 'string' ||
    !APPROVAL_MODES.has(value.approvalMode) ||
    (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.length > 256))
  ) {
    return invalid('policy-save');
  }
  if (Array.isArray(value.rules)) {
    for (const rule of value.rules) {
      if (
        !isRecord(rule) ||
        !hasOnlyKeys(rule, ['action', 'approvalMode', 'delegateAgentVersionId']) ||
        !boundedText(rule.action) ||
        typeof rule.approvalMode !== 'string' ||
        !APPROVAL_MODES.has(rule.approvalMode) ||
        (rule.delegateAgentVersionId !== undefined && !boundedText(rule.delegateAgentVersionId))
      ) {
        return invalid('policy-save');
      }
    }
  }
  return value as unknown as SavePolicyPayload;
}

export function parsePolicyListPayload(value: unknown): ListPoliciesPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'agentId']) ||
    !boundedText(value.workspaceId) ||
    (value.taskId !== undefined && !boundedText(value.taskId)) ||
    (value.agentId !== undefined && !boundedText(value.agentId))
  ) {
    return invalid('policy-list');
  }
  return value as unknown as ListPoliciesPayload;
}

const AGENT_KEYS = [
  'agentId',
  'name',
  'description',
  'visualIdentity',
  'role',
  'developerInstructions',
  'inputContract',
  'outputContract',
  'defaultModelId',
  'defaultCredentialGroupId',
  'pinnedCredentialRefId',
  'pauseOnFailure',
  'fallbackModelIds',
  'memoryScope',
  'skillVersionIds',
  'mcpServerIds',
  'mcpToolAllowlist',
  'permissions',
  'policyId',
  'approvalMode',
  'reviewBehavior',
  'artifactRules',
] as const;

function agentIdList(value: unknown, max = 64, itemMax = MAX_ID): value is string[] {
  return (
    Array.isArray(value) && value.length <= max && value.every((item) => boundedText(item, itemMax))
  );
}

function agentVisualIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['icon', 'color']) &&
    boundedText(value.icon, 128) &&
    boundedText(value.color, 64)
  );
}

const AGENT_PERMISSION_KEYS = ['file', 'command', 'browser', 'desktop', 'network'] as const;

function agentPermissions(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, AGENT_PERMISSION_KEYS) &&
    AGENT_PERMISSION_KEYS.every((key) => agentIdList(value[key], 128, 2_048))
  );
}

function agentReviewBehavior(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['role', 'maxIterations', 'onLimitReached', 'backupAgentVersionId']) &&
    (value.role === 'none' || value.role === 'reviewer' || value.role === 'executor-reviewer') &&
    Number.isSafeInteger(value.maxIterations) &&
    Number(value.maxIterations) >= 0 &&
    Number(value.maxIterations) <= MAX_REVIEW_ITERATIONS &&
    (value.onLimitReached === 'pause' ||
      value.onLimitReached === 'abort' ||
      value.onLimitReached === 'reassign') &&
    (value.backupAgentVersionId === undefined || boundedText(value.backupAgentVersionId))
  );
}

function agentArtifactRules(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['retainVersions', 'requireReview', 'defaultStatus']) &&
    typeof value.retainVersions === 'boolean' &&
    typeof value.requireReview === 'boolean' &&
    (value.defaultStatus === 'candidate' || value.defaultStatus === 'final')
  );
}

function validAgentPayload(value: Record<string, unknown>, full: boolean): boolean {
  if (
    !boundedText(value.name, 256) ||
    !boundedText(value.role, 128) ||
    !boundedText(value.developerInstructions, 50_000) ||
    !boundedText(value.inputContract, 20_000) ||
    !boundedText(value.outputContract, 20_000) ||
    !boundedText(value.defaultModelId)
  )
    return false;
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' || value.description.length > 4_000)
  )
    return false;
  if (value.visualIdentity !== undefined && !agentVisualIdentity(value.visualIdentity)) {
    return false;
  }
  if (value.agentId !== undefined && !boundedText(value.agentId, 128)) return false;
  if (
    value.defaultCredentialGroupId !== undefined &&
    !boundedText(value.defaultCredentialGroupId, 128)
  )
    return false;
  if (
    value.pinnedCredentialRefId !== undefined &&
    value.pinnedCredentialRefId !== null &&
    !boundedText(value.pinnedCredentialRefId, 128)
  )
    return false;
  if (
    full
      ? typeof value.pauseOnFailure !== 'boolean'
      : value.pauseOnFailure !== undefined && typeof value.pauseOnFailure !== 'boolean'
  )
    return false;
  if (
    full
      ? !agentIdList(value.fallbackModelIds, 32)
      : value.fallbackModelIds !== undefined && !agentIdList(value.fallbackModelIds, 32)
  )
    return false;
  if (
    full
      ? !agentIdList(value.skillVersionIds)
      : value.skillVersionIds !== undefined && !agentIdList(value.skillVersionIds)
  )
    return false;
  if (
    full
      ? !agentIdList(value.mcpServerIds)
      : value.mcpServerIds !== undefined && !agentIdList(value.mcpServerIds)
  )
    return false;
  if (value.mcpToolAllowlist !== undefined && !agentIdList(value.mcpToolAllowlist, 256, 256))
    return false;
  if (value.permissions !== undefined && !agentPermissions(value.permissions)) return false;
  if (
    full
      ? !AGENT_MEMORY_SCOPES.has(String(value.memoryScope))
      : value.memoryScope !== undefined && !AGENT_MEMORY_SCOPES.has(String(value.memoryScope))
  )
    return false;
  if (
    full
      ? !APPROVAL_MODES.has(String(value.approvalMode))
      : value.approvalMode !== undefined && !APPROVAL_MODES.has(String(value.approvalMode))
  )
    return false;
  if (value.policyId !== undefined && value.policyId !== null && !boundedText(value.policyId, 128))
    return false;
  if (value.reviewBehavior !== undefined && !agentReviewBehavior(value.reviewBehavior))
    return false;
  if (value.artifactRules !== undefined && !agentArtifactRules(value.artifactRules)) return false;
  return true;
}

export function parseAgentListPayload(value: unknown): ListAgentsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length !== 0) return invalid('agent-list');
  return {};
}

export function parseAgentCreatePayload(value: unknown): CreateAgentPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (!isRecord(value) || !hasOnlyKeys(value, AGENT_KEYS) || !validAgentPayload(value, false))
    return invalid('agent-create');
  return value as unknown as CreateAgentPayload;
}

export function parseAgentVersionsPayload(value: unknown): ListAgentVersionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (!isRecord(value) || !hasOnlyKeys(value, ['agentId']) || !boundedText(value.agentId, 128))
    return invalid('agent-versions');
  return { agentId: value.agentId as ListAgentVersionsPayload['agentId'] };
}

export function parseAgentCreateVersionPayload(value: unknown): CreateAgentVersionPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...AGENT_KEYS, 'expectedVersion']) ||
    !boundedText(value.agentId, 128) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    !validAgentPayload(value, true)
  )
    return invalid('agent-create-version');
  return value as unknown as CreateAgentVersionPayload;
}
