import type {
  CompareArtifactVersionsPayload,
  GetArtifactVersionPayload,
  ListArtifactMergeConflictsPayload,
  ListArtifactsPayload,
  ListPoliciesPayload,
  MergeArtifactVersionsPayload,
  ResolveArtifactMergeConflictPayload,
  OrchestrationRunMutationPayload,
  PlanApprovePayload,
  PlanDraftPayload,
  PlanListRevisionsPayload,
  PlanRevisePayload,
  RunGetGraphPayload,
  SavePolicyPayload,
  SelectArtifactVersionPayload,
  SetParticipationModePayload,
  SetExecutionModePayload,
  ListAgentsPayload,
  CreateAgentPayload,
  ListAgentVersionsPayload,
  CreateAgentVersionPayload,
} from '@sync-think/protocol';
import { MAX_ARTIFACT_LIST_LIMIT } from '@sync-think/protocol';
import {
  MAX_INLINE_ARTIFACT_CONTENT_BYTES,
  MAX_REVIEW_ITERATIONS,
  type PlanStepDraft,
} from '@sync-think/shared';

const MAX_ID = 256;
const MAX_TITLE = 512;
const MAX_INSTRUCTIONS = 20_000;
const MAX_STEPS = 256;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const PARTICIPATION_MODES = new Set(['conversation', 'collaboration', 'automatic']);
const EXECUTION_MODES = new Set(['read-only', 'workspace', 'full-access']);
const APPROVAL_MODES = new Set(['request', 'delegate', 'full', 'custom']);
const POLICY_SCOPES = new Set(['user', 'workspace', 'project', 'task', 'agent', 'workflow', 'run']);
const AGENT_MEMORY_SCOPES = new Set(['task', 'project', 'global']);
const SECRET_KEY =
  /^(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization|credential(?:value|plaintext))$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(record).every((key) => allowlist.has(key));
}

function boundedText(value: unknown, max = MAX_ID): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function taskVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function artifactId(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value);
}

function invalid(name: string): never {
  throw new Error(`Invalid ${name} payload`);
}

export function assertRendererSafeOrchestrationPayload(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > 10_000 || current.depth > 16) {
      throw new Error('Invalid orchestration payload complexity');
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (SECRET_KEY.test(key)) {
        throw new Error(`Renderer orchestration payload contains secret-like field: ${key}`);
      }
      stack.push({ value: nested, depth: current.depth + 1 });
    }
  }
}

function parseSteps(value: unknown, payloadName: string): PlanStepDraft[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) {
    return invalid(payloadName);
  }
  const steps: PlanStepDraft[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        'id',
        'kind',
        'title',
        'instructions',
        'agentVersionId',
        'modelOverrideId',
        'dependsOn',
      ]) ||
      !boundedText(candidate.id) ||
      ids.has(candidate.id) ||
      (candidate.kind !== undefined &&
        candidate.kind !== 'execution' &&
        candidate.kind !== 'merge') ||
      !boundedText(candidate.title, MAX_TITLE) ||
      !boundedText(candidate.instructions, MAX_INSTRUCTIONS) ||
      !boundedText(candidate.agentVersionId) ||
      (candidate.modelOverrideId !== undefined && !boundedText(candidate.modelOverrideId)) ||
      !Array.isArray(candidate.dependsOn) ||
      candidate.dependsOn.length > MAX_STEPS ||
      !candidate.dependsOn.every((dependency) => boundedText(dependency))
    ) {
      return invalid(payloadName);
    }
    ids.add(candidate.id);
    steps.push({
      id: candidate.id as PlanStepDraft['id'],
      kind: candidate.kind === 'merge' ? 'merge' : 'execution',
      title: candidate.title,
      instructions: candidate.instructions,
      agentVersionId: candidate.agentVersionId as PlanStepDraft['agentVersionId'],
      ...(candidate.modelOverrideId
        ? { modelOverrideId: candidate.modelOverrideId as PlanStepDraft['modelOverrideId'] }
        : {}),
      dependsOn: [...candidate.dependsOn] as PlanStepDraft['dependsOn'],
    });
  }
  if (steps.some((step) => step.dependsOn.some((id) => !ids.has(String(id))))) {
    return invalid(payloadName);
  }
  return steps;
}

export function parseModeSetPayload(value: unknown): SetParticipationModePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'mode', 'expectedTaskVersion']) ||
    !boundedText(value.taskId) ||
    typeof value.mode !== 'string' ||
    !PARTICIPATION_MODES.has(value.mode) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('mode-set');
  }
  return {
    taskId: value.taskId as SetParticipationModePayload['taskId'],
    mode: value.mode as SetParticipationModePayload['mode'],
    expectedTaskVersion: value.expectedTaskVersion,
  };
}

export function parseExecutionModeSetPayload(value: unknown): SetExecutionModePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'mode', 'expectedTaskVersion']) ||
    !boundedText(value.taskId) ||
    typeof value.mode !== 'string' ||
    !EXECUTION_MODES.has(value.mode) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('execution-mode-set');
  }
  return {
    taskId: value.taskId as SetExecutionModePayload['taskId'],
    mode: value.mode as SetExecutionModePayload['mode'],
    expectedTaskVersion: value.expectedTaskVersion,
  };
}

export function parsePlanCreatePayload(value: unknown): PlanDraftPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'expectedTaskVersion', 'title', 'steps']) ||
    !boundedText(value.taskId) ||
    !taskVersion(value.expectedTaskVersion) ||
    !boundedText(value.title, MAX_TITLE)
  ) {
    return invalid('plan-create');
  }
  return {
    taskId: value.taskId as PlanDraftPayload['taskId'],
    expectedTaskVersion: value.expectedTaskVersion,
    title: value.title,
    steps: parseSteps(value.steps, 'plan-create'),
  };
}

export function parsePlanRevisePayload(value: unknown): PlanRevisePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'expectedRevision', 'title', 'steps']) ||
    !boundedText(value.planId) ||
    !revision(value.expectedRevision) ||
    (value.title !== undefined && !boundedText(value.title, MAX_TITLE))
  ) {
    return invalid('plan-revise');
  }
  return {
    planId: value.planId as PlanRevisePayload['planId'],
    expectedRevision: value.expectedRevision,
    ...(value.title === undefined ? {} : { title: value.title }),
    steps: parseSteps(value.steps, 'plan-revise'),
  };
}

export function parsePlanListPayload(value: unknown): PlanListRevisionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (!isRecord(value) || !hasOnlyKeys(value, ['planId']) || !boundedText(value.planId)) {
    return invalid('plan-list');
  }
  return { planId: value.planId as PlanListRevisionsPayload['planId'] };
}

export function parsePlanApprovePayload(value: unknown): PlanApprovePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'revision']) ||
    !boundedText(value.planId) ||
    !revision(value.revision)
  ) {
    return invalid('plan-approve');
  }
  return {
    planId: value.planId as PlanApprovePayload['planId'],
    revision: value.revision,
  };
}

export function parseRunGraphPayload(value: unknown): RunGetGraphPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !boundedText(value.workspaceId) ||
    !boundedText(value.taskId) ||
    !boundedText(value.runId)
  ) {
    return invalid('run-graph');
  }
  return value as unknown as RunGetGraphPayload;
}

export function parseRunMutationPayload(value: unknown): OrchestrationRunMutationPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'expectedTaskVersion']) ||
    !boundedText(value.workspaceId) ||
    !boundedText(value.taskId) ||
    !boundedText(value.runId) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('run-mutation');
  }
  return value as unknown as OrchestrationRunMutationPayload;
}

function artifactScope(value: Record<string, unknown>): boolean {
  return artifactId(value.workspaceId) && artifactId(value.taskId) && artifactId(value.runId);
}

export function parseArtifactListPayload(value: unknown): ListArtifactsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'limit', 'cursor']) ||
    !artifactScope(value) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        Number(value.limit) < 1 ||
        Number(value.limit) > MAX_ARTIFACT_LIST_LIMIT)) ||
    (value.cursor !== undefined && !artifactId(value.cursor))
  ) {
    return invalid('artifact-list');
  }
  return value as unknown as ListArtifactsPayload;
}

export function parseArtifactGetVersionPayload(value: unknown): GetArtifactVersionPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'artifactVersionId']) ||
    !artifactScope(value) ||
    !artifactId(value.artifactVersionId)
  ) {
    return invalid('artifact-get-version');
  }
  return value as unknown as GetArtifactVersionPayload;
}

export function parseArtifactComparePayload(value: unknown): CompareArtifactVersionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'leftVersionId', 'rightVersionId']) ||
    !artifactScope(value) ||
    !artifactId(value.leftVersionId) ||
    !artifactId(value.rightVersionId) ||
    value.leftVersionId === value.rightVersionId
  ) {
    return invalid('artifact-compare');
  }
  return value as unknown as CompareArtifactVersionsPayload;
}

export function parseArtifactSelectPayload(value: unknown): SelectArtifactVersionPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'artifactId',
      'artifactVersionId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.artifactId) ||
    !artifactId(value.artifactVersionId) ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('artifact-select');
  }
  return value as unknown as SelectArtifactVersionPayload;
}

export function parseArtifactMergePayload(value: unknown): MergeArtifactVersionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'artifactId',
      'baseVersionId',
      'leftVersionId',
      'rightVersionId',
      'sourceStepId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.artifactId) ||
    !artifactId(value.baseVersionId) ||
    !artifactId(value.leftVersionId) ||
    !artifactId(value.rightVersionId) ||
    !boundedText(value.sourceStepId) ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion) ||
    new Set([value.baseVersionId, value.leftVersionId, value.rightVersionId]).size !== 3
  ) {
    return invalid('artifact-merge');
  }
  return value as unknown as MergeArtifactVersionsPayload;
}

export function parseArtifactConflictListPayload(
  value: unknown,
): ListArtifactMergeConflictsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !artifactScope(value)
  ) {
    return invalid('artifact-conflict-list');
  }
  return value as unknown as ListArtifactMergeConflictsPayload;
}

export function parseArtifactConflictResolutionPayload(
  value: unknown,
): ResolveArtifactMergeConflictPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'conflictId',
      'strategy',
      'content',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.conflictId) ||
    (value.strategy !== 'left' && value.strategy !== 'right' && value.strategy !== 'manual') ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion) ||
    (value.strategy === 'manual' &&
      (typeof value.content !== 'string' ||
        Buffer.byteLength(value.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES)) ||
    (value.strategy !== 'manual' && value.content !== undefined)
  ) {
    return invalid('artifact-conflict-resolution');
  }
  return value as unknown as ResolveArtifactMergeConflictPayload;
}

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
  'maxConcurrency',
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
    hasOnlyKeys(value, ['icon', 'color', 'avatarPath']) &&
    boundedText(value.icon, 128) &&
    boundedText(value.color, 64) &&
    (value.avatarPath === undefined || boundedText(value.avatarPath, 4_096))
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
  const validMaxConcurrency =
    Number.isSafeInteger(value.maxConcurrency) &&
    Number(value.maxConcurrency) >= 1 &&
    Number(value.maxConcurrency) <= 16;
  if ((full && !validMaxConcurrency) || (!full && value.maxConcurrency !== undefined && !validMaxConcurrency)) {
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
