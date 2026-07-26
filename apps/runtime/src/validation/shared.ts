// Shared validation primitives extracted from command-validation.ts.
// Used by the per-domain parser modules in this directory.
import type { OrchestrationRunMutationPayload, TeamMemberDraft } from '@sync-think/protocol';
import { MAX_REVIEW_ITERATIONS, ULID_REGEX, type EventCategory, type PlanStepDraft } from '@sync-think/shared';
export const MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

export const PARTICIPATION_MODES = new Set(['conversation', 'collaboration', 'automatic']);

export const POLICY_SCOPE_TYPES = new Set([
  'user',
  'workspace',
  'project',
  'task',
  'agent',
  'workflow',
  'run',
]);

export const APPROVAL_MODES = new Set(['request', 'delegate', 'custom', 'full']);

export const EVENT_CATEGORIES = new Set<EventCategory>([
  'message',
  'run',
  'step',
  'tool',
  'approval',
  'context',
  'memory',
  'artifact',
  'credential',
  'provider',
  'system',
]);

export function parseOrchestrationRunMutationPayload(
  value: unknown,
): OrchestrationRunMutationPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'expectedTaskVersion']) ||
    !isBoundedText(value.workspaceId, 256) ||
    !isBoundedText(value.taskId, 256) ||
    !isBoundedText(value.runId, 256) ||
    !Number.isSafeInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId as OrchestrationRunMutationPayload['workspaceId'],
    taskId: value.taskId as OrchestrationRunMutationPayload['taskId'],
    runId: value.runId as OrchestrationRunMutationPayload['runId'],
    expectedTaskVersion: value.expectedTaskVersion as number,
  };
}

export const PLAN_ID_MAX_LENGTH = 256;

export const PLAN_TITLE_MAX_LENGTH = 512;

export const PLAN_STEP_INSTRUCTIONS_MAX_LENGTH = 20_000;

export const PLAN_STEPS_MAX_LENGTH = 256;

export const PLAN_DEPENDENCIES_MAX_LENGTH = 256;

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function parsePlanSteps(value: unknown): PlanStepDraft[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > PLAN_STEPS_MAX_LENGTH) {
    return undefined;
  }
  const steps: PlanStepDraft[] = [];
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
      !isBoundedText(candidate.id, PLAN_ID_MAX_LENGTH) ||
      (candidate.kind !== undefined &&
        candidate.kind !== 'execution' &&
        candidate.kind !== 'merge') ||
      !isBoundedText(candidate.title, PLAN_TITLE_MAX_LENGTH) ||
      !isBoundedText(candidate.instructions, PLAN_STEP_INSTRUCTIONS_MAX_LENGTH) ||
      !isBoundedText(candidate.agentVersionId, PLAN_ID_MAX_LENGTH) ||
      (candidate.modelOverrideId !== undefined &&
        !isBoundedText(candidate.modelOverrideId, PLAN_ID_MAX_LENGTH)) ||
      !Array.isArray(candidate.dependsOn) ||
      candidate.dependsOn.length > PLAN_DEPENDENCIES_MAX_LENGTH ||
      !candidate.dependsOn.every((dependencyId) => isBoundedText(dependencyId, PLAN_ID_MAX_LENGTH))
    ) {
      return undefined;
    }
    steps.push({
      id: candidate.id as PlanStepDraft['id'],
      kind: candidate.kind === 'merge' ? 'merge' : 'execution',
      title: candidate.title,
      instructions: candidate.instructions,
      agentVersionId: candidate.agentVersionId as PlanStepDraft['agentVersionId'],
      ...(candidate.modelOverrideId === undefined
        ? {}
        : { modelOverrideId: candidate.modelOverrideId as PlanStepDraft['modelOverrideId'] }),
      dependsOn: [...candidate.dependsOn] as PlanStepDraft['dependsOn'],
    });
  }
  return steps;
}

export const ARTIFACT_SCOPE_KEYS = ['workspaceId', 'taskId', 'runId'] as const;

export function isArtifactCommandId(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value);
}

export function hasArtifactScope(value: Record<string, unknown>): boolean {
  return ARTIFACT_SCOPE_KEYS.every((key) => isArtifactCommandId(value[key]));
}

export function hasExpectedTaskVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export const PROTOCOLS = new Set([
  'openai-responses',
  'openai-chat',
  'openai-images',
  'anthropic-messages',
]);

export const SURFACES = new Set(['claude', 'codex', 'gemini', 'kiro', 'generic']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const AGENT_DEFINITION_KEYS = [
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

export function validAgentIdList(value: unknown, max = 64, itemMax = 256): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => boundedAgentText(item, itemMax))
  );
}

export function boundedAgentText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function validAgentVisualIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['icon', 'color']) &&
    boundedAgentText(value.icon, 128) &&
    boundedAgentText(value.color, 64)
  );
}

export const AGENT_PERMISSION_KEYS = ['file', 'command', 'browser', 'desktop', 'network'] as const;

export function validAgentPermissions(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, AGENT_PERMISSION_KEYS) &&
    AGENT_PERMISSION_KEYS.every((key) => validAgentIdList(value[key], 128, 2_048))
  );
}

export function validAgentReviewBehavior(value: unknown): boolean {
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
    (value.backupAgentVersionId === undefined || boundedAgentText(value.backupAgentVersionId, 256))
  );
}

export function validAgentArtifactRules(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['retainVersions', 'requireReview', 'defaultStatus']) &&
    typeof value.retainVersions === 'boolean' &&
    typeof value.requireReview === 'boolean' &&
    (value.defaultStatus === 'candidate' || value.defaultStatus === 'final')
  );
}

export function validAgentDefinition(value: Record<string, unknown>, options: { full: boolean }): boolean {
  if (
    !boundedAgentText(value.name, 256) ||
    !boundedAgentText(value.role, 128) ||
    !boundedAgentText(value.developerInstructions, 50_000) ||
    !boundedAgentText(value.inputContract, 20_000) ||
    !boundedAgentText(value.outputContract, 20_000) ||
    !boundedAgentText(value.defaultModelId, 256)
  ) {
    return false;
  }
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' || value.description.length > 4_000)
  )
    return false;
  if (value.visualIdentity !== undefined && !validAgentVisualIdentity(value.visualIdentity)) {
    return false;
  }
  if (value.agentId !== undefined && !boundedAgentText(value.agentId, 128)) return false;
  if (
    value.defaultCredentialGroupId !== undefined &&
    !boundedAgentText(value.defaultCredentialGroupId, 128)
  )
    return false;
  if (
    value.pinnedCredentialRefId !== undefined &&
    value.pinnedCredentialRefId !== null &&
    !boundedAgentText(value.pinnedCredentialRefId, 128)
  )
    return false;
  if (
    (options.full && typeof value.pauseOnFailure !== 'boolean') ||
    (!options.full &&
      value.pauseOnFailure !== undefined &&
      typeof value.pauseOnFailure !== 'boolean')
  )
    return false;
  if (
    (options.full && !validAgentIdList(value.fallbackModelIds, 32)) ||
    (!options.full &&
      value.fallbackModelIds !== undefined &&
      !validAgentIdList(value.fallbackModelIds, 32))
  )
    return false;
  if (
    (options.full && !validAgentIdList(value.skillVersionIds)) ||
    (!options.full &&
      value.skillVersionIds !== undefined &&
      !validAgentIdList(value.skillVersionIds))
  )
    return false;
  if (
    (options.full && !validAgentIdList(value.mcpServerIds)) ||
    (!options.full && value.mcpServerIds !== undefined && !validAgentIdList(value.mcpServerIds))
  )
    return false;
  if (value.mcpToolAllowlist !== undefined && !validAgentIdList(value.mcpToolAllowlist, 256, 256))
    return false;
  if (value.permissions !== undefined && !validAgentPermissions(value.permissions)) return false;
  if (
    (options.full && !MEMORY_SCOPES.has(String(value.memoryScope))) ||
    (!options.full &&
      value.memoryScope !== undefined &&
      !MEMORY_SCOPES.has(String(value.memoryScope)))
  )
    return false;
  if (
    (options.full && !APPROVAL_MODES.has(String(value.approvalMode))) ||
    (!options.full &&
      value.approvalMode !== undefined &&
      !APPROVAL_MODES.has(String(value.approvalMode)))
  )
    return false;
  if (
    value.policyId !== undefined &&
    value.policyId !== null &&
    !boundedAgentText(value.policyId, 128)
  )
    return false;
  if (value.reviewBehavior !== undefined && !validAgentReviewBehavior(value.reviewBehavior))
    return false;
  if (value.artifactRules !== undefined && !validAgentArtifactRules(value.artifactRules)) {
    return false;
  }
  return true;
}

export const CONVERSATION_TRACKS = new Set(['model', 'agent', 'team']);

export const CONVERSATION_UPGRADE_TRACKS = new Set(['agent', 'team']);

export const TEAM_STRATEGIES = new Set(['serial', 'parallel']);

export const TEAM_RUN_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);

export const GLOBAL_AGENT_KEYS = [
  'name',
  'defaultModelId',
  'avatar',
  'persona',
  'description',
  'fallbackModelIds',
  'skillIds',
  'mcpServerIds',
  'reasoningEffort',
] as const;

export function validGlobalAgentFields(
  value: Record<string, unknown>,
  options: { full: boolean },
): boolean {
  if (
    (options.full && !boundedAgentText(value.name, 256)) ||
    (!options.full && value.name !== undefined && !boundedAgentText(value.name, 256))
  )
    return false;
  if (
    (options.full && !boundedAgentText(value.defaultModelId, 256)) ||
    (!options.full &&
      value.defaultModelId !== undefined &&
      !boundedAgentText(value.defaultModelId, 256))
  )
    return false;
  // Avatar accepts an emoji/short label or an imported image as a compact
  // data URL (96×96 webp/jpeg ≈ a few KB); cap far below persona limits.
  if (
    value.avatar !== undefined &&
    (typeof value.avatar !== 'string' || value.avatar.length > 65_536)
  )
    return false;
  if (
    value.persona !== undefined &&
    (typeof value.persona !== 'string' || value.persona.length > 50_000)
  )
    return false;
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' || value.description.length > 4_000)
  )
    return false;
  if (value.fallbackModelIds !== undefined && !validAgentIdList(value.fallbackModelIds, 32))
    return false;
  if (value.skillIds !== undefined && !validAgentIdList(value.skillIds)) return false;
  if (value.mcpServerIds !== undefined && !validAgentIdList(value.mcpServerIds)) return false;
  if (value.reasoningEffort !== undefined && !boundedAgentText(value.reasoningEffort, 64))
    return false;
  return true;
}

export const TEAM_KEYS = ['name', 'avatar', 'mission', 'strategy', 'coordinatorAgentId', 'members'] as const;

export function validTeamMembers(value: unknown): value is TeamMemberDraft[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  return value.every((member) => {
    if (!isRecord(member) || !hasOnlyKeys(member, ['agentId', 'role', 'title', 'dependsOn'])) {
      return false;
    }
    if (!boundedAgentText(member.agentId, 128)) return false;
    if (member.role !== undefined && !boundedAgentText(member.role, 128)) return false;
    if (
      member.title !== undefined &&
      (typeof member.title !== 'string' || member.title.length > 256)
    )
      return false;
    if (member.dependsOn !== undefined && !validAgentIdList(member.dependsOn, 64, 128)) {
      return false;
    }
    return true;
  });
}

export function validTeamFields(value: Record<string, unknown>, options: { full: boolean }): boolean {
  if (
    (options.full && !boundedAgentText(value.name, 256)) ||
    (!options.full && value.name !== undefined && !boundedAgentText(value.name, 256))
  )
    return false;
  // Team avatar also accepts a compact image data URL (same policy as agents).
  if (
    value.avatar !== undefined &&
    (typeof value.avatar !== 'string' || value.avatar.length > 65_536)
  )
    return false;
  if (
    value.mission !== undefined &&
    (typeof value.mission !== 'string' || value.mission.length > 20_000)
  )
    return false;
  if (value.strategy !== undefined && !TEAM_STRATEGIES.has(String(value.strategy))) return false;
  if (value.coordinatorAgentId !== undefined && !boundedAgentText(value.coordinatorAgentId, 128))
    return false;
  if (value.members !== undefined && !validTeamMembers(value.members)) return false;
  return true;
}

export const MEMORY_SCOPES = new Set(['task', 'project', 'global']);

export const MEMORY_STATES = new Set(['pending', 'approved', 'rejected', 'rolled_back']);

export function parseMemoryEntries(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 64) return false;
  for (const entry of value) {
    if (!isRecord(entry)) return false;
    if (typeof entry.key !== 'string' || entry.key.trim().length === 0 || entry.key.length > 128) {
      return false;
    }
    if (
      typeof entry.value !== 'string' ||
      entry.value.trim().length === 0 ||
      entry.value.length > 4000
    ) {
      return false;
    }
    if (entry.targetScope !== undefined && !MEMORY_SCOPES.has(String(entry.targetScope)))
      return false;
    if (entry.id !== undefined && typeof entry.id !== 'string') return false;
  }
  return true;
}

export const APPROVAL_STATES = new Set(['pending', 'approved', 'rejected']);

export const APPROVAL_KINDS = new Set([
  'plan',
  'tool',
  'memory',
  'export',
  'skill-permission',
  'mcp-permission',
  'human-only',
  'other',
]);