import { MAX_ARTIFACT_LIST_LIMIT } from '@sync-think/protocol';
import type {
  AppendMessagePayload,
  CancelRunPayload,
  OrchestrationRunMutationPayload,
  PauseRunPayload,
  ResumeRunPayload,
  ContinueEventReplayPayload,
  BindWorkspaceFolderPayload,
  CreateTaskPayload,
  CreateWorkspacePayload,
  ListTasksPayload,
  ListWorkspacesPayload,
  OpenTaskPayload,
  SearchTasksPayload,
  SetParticipationModePayload,
  SavePolicyPayload,
  ListPoliciesPayload,
  SubscribeEventsPayload,
  UnsubscribeEventsPayload,
  CreateProviderPayload,
  UpdateProviderPayload,
  PreviewCcSwitchImportPayload,
  ImportCcSwitchPayload,
  ListProvidersPayload,
  DiscoverModelsPayload,
  AddModelsPayload,
  ProbeCapabilitiesPayload,
  ConfirmCapabilitiesPayload,
  ReorderProvidersPayload,
  AddProviderCredentialPayload,
  RemoveProviderCredentialPayload,
  SetModelPrioritiesPayload,
  RemoveModelPayload,
  GetSettingsPayload,
  SetSettingPayload,
  UsageSummaryPayload,
  GetAgentPayload,
  UpdateAgentBindingPayload,
  ListAgentsPayload,
  CreateAgentPayload,
  ListAgentVersionsPayload,
  CreateAgentVersionPayload,
  ImportSkillPayload,
  ListSkillsPayload,
  RegisterMcpServerPayload,
  ListMcpServersPayload,
  ProbeMcpPolicyPayload,
  RequestMcpToolPayload,
  ProbeMcpSpawnPayload,
  CallMcpToolPayload,
  RefreshMcpToolsPayload,
  ListMemoryPayload,
  ProposeMemoryPayload,
  DecideMemoryPayload,
  RollbackMemoryPayload,
  ListDiagnosticsPayload,
  ListApprovalsPayload,
  EvaluateApprovalPayload,
  EnqueueApprovalPayload,
  DecideApprovalPayload,
  PeekContextPacketPayload,
  AmendContextPacketPayload,
  PlanDraftPayload,
  PlanRevisePayload,
  PlanListRevisionsPayload,
  PlanApprovePayload,
  RunGetGraphPayload,
  ListArtifactsPayload,
  GetArtifactVersionPayload,
  CompareArtifactVersionsPayload,
  SelectArtifactVersionPayload,
  MergeArtifactVersionsPayload,
  ListArtifactMergeConflictsPayload,
  ResolveArtifactMergeConflictPayload,
  ListGlobalAgentsPayload,
  CreateGlobalAgentPayload,
  UpdateGlobalAgentPayload,
  DeleteGlobalAgentPayload,
  CreateTeamPayload,
  UpdateTeamPayload,
  DeleteTeamPayload,
  StartTeamRunPayload,
  SetTeamRunStatusPayload,
  TeamMemberDraft,
  ListConversationsPayload,
  CreateConversationPayload,
  RenameConversationPayload,
  SetConversationPinnedPayload,
  SetConversationArchivedPayload,
  SetConversationExecutionModePayload,
  UpgradeConversationTrackPayload,
  DeleteConversationPayload,
  ConversationDecideToolApprovalPayload,
} from '@sync-think/protocol';
import {
  MAX_INLINE_ARTIFACT_CONTENT_BYTES,
  MAX_REVIEW_ITERATIONS,
  normalizeAcceptanceCriteria,
  ULID_REGEX,
  type EventCategory,
  type PlanStepDraft,
} from '@sync-think/shared';

const MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const PARTICIPATION_MODES = new Set(['conversation', 'collaboration', 'automatic']);
const POLICY_SCOPE_TYPES = new Set([
  'user',
  'workspace',
  'project',
  'task',
  'agent',
  'workflow',
  'run',
]);
const APPROVAL_MODES = new Set(['request', 'delegate', 'custom', 'full']);
const EVENT_CATEGORIES = new Set<EventCategory>([
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

export function parseCreateWorkspacePayload(value: unknown): CreateWorkspacePayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256
  ) {
    return undefined;
  }
  if (
    value.folderPath !== undefined &&
    (typeof value.folderPath !== 'string' ||
      value.folderPath.trim().length === 0 ||
      value.folderPath.length > 4096)
  ) {
    return undefined;
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      return undefined;
    }
  }
  return {
    name: value.name.trim(),
    folderPath: typeof value.folderPath === 'string' ? value.folderPath.trim() : undefined,
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseBindWorkspaceFolderPayload(
  value: unknown,
): BindWorkspaceFolderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.folderPath !== 'string' ||
    value.folderPath.trim().length === 0 ||
    value.folderPath.length > 4096
  ) {
    return undefined;
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      return undefined;
    }
  }
  return {
    workspaceId: value.workspaceId.trim() as BindWorkspaceFolderPayload['workspaceId'],
    folderPath: value.folderPath.trim(),
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseListWorkspacesPayload(value: unknown): ListWorkspacesPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  return value as ListWorkspacesPayload;
}

export function parseCreateTaskPayload(value: unknown): CreateTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 512 ||
    typeof value.goal !== 'string' ||
    value.goal.trim().length === 0 ||
    value.goal.length > 10_000
  ) {
    return undefined;
  }
  if (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string') return undefined;
  let acceptanceCriteria: string[] | undefined;
  if (value.acceptanceCriteria !== undefined) {
    try {
      acceptanceCriteria = normalizeAcceptanceCriteria(value.acceptanceCriteria);
    } catch {
      return undefined;
    }
  }
  return { ...value, acceptanceCriteria } as unknown as CreateTaskPayload;
}

export function parseListTasksPayload(value: unknown): ListTasksPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) return undefined;
  if (
    value.includeArchived !== undefined &&
    typeof value.includeArchived !== 'boolean'
  ) {
    return undefined;
  }
  return value as unknown as ListTasksPayload;
}

export function parseArchiveTaskPayload(value: unknown): import('@sync-think/protocol').ArchiveTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.length === 0 ||
    value.taskId.length > 256 ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    return undefined;
  }
  if (value.cascade !== undefined && typeof value.cascade !== 'boolean') return undefined;
  return value as unknown as import('@sync-think/protocol').ArchiveTaskPayload;
}

export function parseUnarchiveTaskPayload(
  value: unknown,
): import('@sync-think/protocol').UnarchiveTaskPayload | undefined {
  return parseArchiveTaskPayload(value) as
    | import('@sync-think/protocol').UnarchiveTaskPayload
    | undefined;
}

export function parseOpenTaskPayload(value: unknown): OpenTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) return undefined;
  return value as unknown as OpenTaskPayload;
}

export function parseSearchTasksPayload(value: unknown): SearchTasksPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length === 0 ||
    typeof value.query !== 'string' ||
    value.query.length > 512
  ) {
    return undefined;
  }
  return value as unknown as SearchTasksPayload;
}

export function parseSetParticipationModePayload(
  value: unknown,
): SetParticipationModePayload | undefined {
  if (!isRecord(value) || Object.hasOwn(value, 'approvedPlan')) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.length === 0 ||
    value.taskId.length > 256 ||
    typeof value.mode !== 'string' ||
    !PARTICIPATION_MODES.has(value.mode) ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    return undefined;
  }
  return value as unknown as SetParticipationModePayload;
}

export function parseSavePolicyPayload(value: unknown): SavePolicyPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'policyId',
      'scopeType',
      'scopeId',
      'approvalMode',
      'rules',
    ])
  )
    return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.scopeType !== 'string' ||
    !POLICY_SCOPE_TYPES.has(value.scopeType) ||
    typeof value.scopeId !== 'string' ||
    value.scopeId.trim().length === 0 ||
    value.scopeId.length > 256 ||
    typeof value.approvalMode !== 'string' ||
    !APPROVAL_MODES.has(value.approvalMode)
  ) {
    return undefined;
  }
  if (
    value.policyId !== undefined &&
    (typeof value.policyId !== 'string' ||
      value.policyId.trim().length === 0 ||
      value.policyId.length > 256)
  ) {
    return undefined;
  }
  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules) || value.rules.length > 256) return undefined;
    for (const rule of value.rules) {
      if (
        !isRecord(rule) ||
        !hasOnlyKeys(rule, ['action', 'approvalMode', 'delegateAgentVersionId']) ||
        typeof rule.action !== 'string' ||
        rule.action.trim().length === 0 ||
        rule.action.length > 256 ||
        typeof rule.approvalMode !== 'string' ||
        !APPROVAL_MODES.has(rule.approvalMode)
      ) {
        return undefined;
      }
      if (
        rule.delegateAgentVersionId !== undefined &&
        (rule.approvalMode !== 'delegate' ||
          typeof rule.delegateAgentVersionId !== 'string' ||
          rule.delegateAgentVersionId.trim().length === 0 ||
          rule.delegateAgentVersionId.length > 128)
      )
        return undefined;
    }
  }

  return {
    workspaceId: value.workspaceId.trim() as SavePolicyPayload['workspaceId'],
    policyId: typeof value.policyId === 'string' ? value.policyId.trim() : undefined,
    scopeType: value.scopeType as SavePolicyPayload['scopeType'],
    scopeId: value.scopeId.trim(),
    approvalMode: value.approvalMode as SavePolicyPayload['approvalMode'],
    rules: Array.isArray(value.rules)
      ? value.rules.map((rule) => {
          const normalized = rule as Record<string, string | undefined>;
          return {
            action: normalized.action!.trim(),
            approvalMode: normalized.approvalMode as SavePolicyPayload['approvalMode'],
            ...(normalized.delegateAgentVersionId
              ? {
                  delegateAgentVersionId: normalized.delegateAgentVersionId.trim() as NonNullable<
                    SavePolicyPayload['rules']
                  >[number]['delegateAgentVersionId'],
                }
              : {}),
          };
        })
      : undefined,
  };
}

export function parseListPoliciesPayload(value: unknown): ListPoliciesPayload | undefined {
  if (!isRecord(value) || Object.hasOwn(value, 'scopes')) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    return undefined;
  }
  for (const field of ['taskId', 'agentId'] as const) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== 'string' ||
        value[field].trim().length === 0 ||
        value[field].length > 256)
    ) {
      return undefined;
    }
  }
  return {
    workspaceId: value.workspaceId.trim() as ListPoliciesPayload['workspaceId'],
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId.trim() as ListPoliciesPayload['taskId'])
        : undefined,
    agentId:
      typeof value.agentId === 'string'
        ? (value.agentId.trim() as ListPoliciesPayload['agentId'])
        : undefined,
  };
}

export function parseAppendMessagePayload(value: unknown): AppendMessagePayload | undefined {
  if (!isRecord(value)) return undefined;
  const hasImages = Array.isArray(value.images) && value.images.length > 0;
  if (
    typeof value.threadId !== 'string' ||
    value.threadId.length === 0 ||
    value.threadId.length > 256 ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0 ||
    typeof value.role !== 'string' ||
    !MESSAGE_ROLES.has(value.role) ||
    typeof value.text !== 'string' ||
    value.text.length > 100_000 ||
    // Text may be empty when images are attached (vision-only turn).
    (!hasImages && value.text.trim().length === 0)
  ) {
    return undefined;
  }
  for (const field of [
    'agentVersionId',
    'modelId',
    'credentialRefId',
    'runId',
    'stepId',
    'reasoningEffort',
  ]) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return undefined;
  }
  if (
    value.reasoningEffort !== undefined &&
    (typeof value.reasoningEffort !== 'string' ||
      value.reasoningEffort.length === 0 ||
      value.reasoningEffort.length > 64)
  ) {
    return undefined;
  }
  if (value.networkEnabled !== undefined && typeof value.networkEnabled !== 'boolean') {
    return undefined;
  }
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > 8) return undefined;
    for (const image of value.images) {
      if (!isRecord(image)) return undefined;
      if (typeof image.name !== 'string' || image.name.length === 0 || image.name.length > 512) {
        return undefined;
      }
      if (
        typeof image.mimeType !== 'string' ||
        image.mimeType.length === 0 ||
        image.mimeType.length > 128 ||
        !image.mimeType.startsWith('image/')
      ) {
        return undefined;
      }
      const hasDataUrl =
        typeof image.dataUrl === 'string' &&
        image.dataUrl.startsWith('data:image/') &&
        // Keep inline dataUrl small so pipe frames stay under 1 MiB.
        image.dataUrl.length <= 700_000;
      const hasStagingPath =
        typeof image.stagingPath === 'string' &&
        image.stagingPath.length > 0 &&
        image.stagingPath.length <= 1024;
      // Prefer stagingPath for large images; dataUrl is small-image fallback only.
      if (!hasDataUrl && !hasStagingPath) return undefined;
      if (image.dataUrl !== undefined && !hasDataUrl && !hasStagingPath) return undefined;
      if (image.stagingPath !== undefined && typeof image.stagingPath !== 'string') return undefined;
    }
  }
  return value as unknown as AppendMessagePayload;
}

export function parseSubscribeEventsPayload(value: unknown): SubscribeEventsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isInteger(value.afterCursor) || (value.afterCursor as number) < 0) {
    return undefined;
  }
  if (
    value.categories !== undefined &&
    (!Array.isArray(value.categories) ||
      !value.categories.every(
        (category) =>
          typeof category === 'string' && EVENT_CATEGORIES.has(category as EventCategory),
      ))
  ) {
    return undefined;
  }
  return value as unknown as SubscribeEventsPayload;
}

export function parseContinueEventReplayPayload(
  value: unknown,
): ContinueEventReplayPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.streamId !== 'string' ||
    value.streamId.length === 0 ||
    value.streamId.length > 256 ||
    !Number.isInteger(value.afterCursor) ||
    (value.afterCursor as number) < 0
  ) {
    return undefined;
  }
  return value as unknown as ContinueEventReplayPayload;
}

export function parseUnsubscribeEventsPayload(
  value: unknown,
): UnsubscribeEventsPayload | undefined {
  if (!isRecord(value) || typeof value.streamId !== 'string' || value.streamId.length === 0) {
    return undefined;
  }
  return value as unknown as UnsubscribeEventsPayload;
}

export function parseCancelRunPayload(value: unknown): CancelRunPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (hasOnlyKeys(value, ['runId']) && isBoundedText(value.runId, 256)) {
    return { runId: value.runId as CancelRunPayload['runId'] };
  }
  return parseOrchestrationRunMutationPayload(value);
}

function parseOrchestrationRunMutationPayload(
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

export function parsePauseRunPayload(value: unknown): PauseRunPayload | undefined {
  return parseOrchestrationRunMutationPayload(value);
}

export function parseResumeRunPayload(value: unknown): ResumeRunPayload | undefined {
  return parseOrchestrationRunMutationPayload(value);
}

const PLAN_ID_MAX_LENGTH = 256;
const PLAN_TITLE_MAX_LENGTH = 512;
const PLAN_STEP_INSTRUCTIONS_MAX_LENGTH = 20_000;
const PLAN_STEPS_MAX_LENGTH = 256;
const PLAN_DEPENDENCIES_MAX_LENGTH = 256;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function parsePlanSteps(value: unknown): PlanStepDraft[] | undefined {
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

export function parsePlanDraftPayload(value: unknown): PlanDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'expectedTaskVersion', 'title', 'steps']) ||
    !isBoundedText(value.taskId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0 ||
    !isBoundedText(value.title, PLAN_TITLE_MAX_LENGTH)
  ) {
    return undefined;
  }
  const steps = parsePlanSteps(value.steps);
  if (!steps) return undefined;
  return {
    taskId: value.taskId as PlanDraftPayload['taskId'],
    expectedTaskVersion: value.expectedTaskVersion as number,
    title: value.title,
    steps,
  };
}

export function parsePlanRevisePayload(value: unknown): PlanRevisePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'expectedRevision', 'title', 'steps']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1 ||
    (value.title !== undefined && !isBoundedText(value.title, PLAN_TITLE_MAX_LENGTH))
  ) {
    return undefined;
  }
  const steps = parsePlanSteps(value.steps);
  if (!steps) return undefined;
  return {
    planId: value.planId as PlanRevisePayload['planId'],
    expectedRevision: value.expectedRevision as number,
    ...(value.title === undefined ? {} : { title: value.title }),
    steps,
  };
}

export function parsePlanListRevisionsPayload(
  value: unknown,
): PlanListRevisionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH)
  ) {
    return undefined;
  }
  return { planId: value.planId as PlanListRevisionsPayload['planId'] };
}

export function parsePlanApprovePayload(value: unknown): PlanApprovePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'revision']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    return undefined;
  }
  return {
    planId: value.planId as PlanApprovePayload['planId'],
    revision: value.revision as number,
  };
}

export function parseRunGetGraphPayload(value: unknown): RunGetGraphPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !isBoundedText(value.workspaceId, PLAN_ID_MAX_LENGTH) ||
    !isBoundedText(value.taskId, PLAN_ID_MAX_LENGTH) ||
    !isBoundedText(value.runId, PLAN_ID_MAX_LENGTH)
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId as RunGetGraphPayload['workspaceId'],
    taskId: value.taskId as RunGetGraphPayload['taskId'],
    runId: value.runId as RunGetGraphPayload['runId'],
  };
}

const ARTIFACT_SCOPE_KEYS = ['workspaceId', 'taskId', 'runId'] as const;

function isArtifactCommandId(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value);
}

function hasArtifactScope(value: Record<string, unknown>): boolean {
  return ARTIFACT_SCOPE_KEYS.every((key) => isArtifactCommandId(value[key]));
}

function hasExpectedTaskVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseListArtifactsPayload(value: unknown): ListArtifactsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'limit', 'cursor']) ||
    !hasArtifactScope(value) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        (value.limit as number) < 1 ||
        (value.limit as number) > MAX_ARTIFACT_LIST_LIMIT)) ||
    (value.cursor !== undefined && !isArtifactCommandId(value.cursor))
  ) {
    return undefined;
  }
  return value as unknown as ListArtifactsPayload;
}

export function parseGetArtifactVersionPayload(
  value: unknown,
): GetArtifactVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'artifactVersionId']) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactVersionId)
  ) {
    return undefined;
  }
  return value as unknown as GetArtifactVersionPayload;
}

export function parseCompareArtifactVersionsPayload(
  value: unknown,
): CompareArtifactVersionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'leftVersionId', 'rightVersionId']) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.leftVersionId) ||
    !isArtifactCommandId(value.rightVersionId) ||
    value.leftVersionId === value.rightVersionId
  ) {
    return undefined;
  }
  return value as unknown as CompareArtifactVersionsPayload;
}

export function parseSelectArtifactVersionPayload(
  value: unknown,
): SelectArtifactVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'artifactId',
      'artifactVersionId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactId) ||
    !isArtifactCommandId(value.artifactVersionId) ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion)
  ) {
    return undefined;
  }
  return value as unknown as SelectArtifactVersionPayload;
}

export function parseMergeArtifactVersionsPayload(
  value: unknown,
): MergeArtifactVersionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'artifactId',
      'baseVersionId',
      'leftVersionId',
      'rightVersionId',
      'sourceStepId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactId) ||
    !isArtifactCommandId(value.baseVersionId) ||
    !isArtifactCommandId(value.leftVersionId) ||
    !isArtifactCommandId(value.rightVersionId) ||
    !isBoundedText(value.sourceStepId, PLAN_ID_MAX_LENGTH) ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion) ||
    new Set([value.baseVersionId, value.leftVersionId, value.rightVersionId]).size !== 3
  ) {
    return undefined;
  }
  return value as unknown as MergeArtifactVersionsPayload;
}

export function parseListArtifactMergeConflictsPayload(
  value: unknown,
): ListArtifactMergeConflictsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ARTIFACT_SCOPE_KEYS) ||
    !hasArtifactScope(value)
  ) {
    return undefined;
  }
  return value as unknown as ListArtifactMergeConflictsPayload;
}

export function parseResolveArtifactMergeConflictPayload(
  value: unknown,
): ResolveArtifactMergeConflictPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'conflictId',
      'strategy',
      'content',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.conflictId) ||
    (value.strategy !== 'left' && value.strategy !== 'right' && value.strategy !== 'manual') ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion) ||
    (value.strategy === 'manual' &&
      (typeof value.content !== 'string' ||
        Buffer.byteLength(value.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES)) ||
    (value.strategy !== 'manual' && value.content !== undefined)
  ) {
    return undefined;
  }
  return value as unknown as ResolveArtifactMergeConflictPayload;
}

const PROTOCOLS = new Set([
  'openai-responses',
  'openai-chat',
  'openai-images',
  'anthropic-messages',
]);

const SURFACES = new Set(['claude', 'codex', 'gemini', 'kiro', 'generic']);

export function parseCreateProviderPayload(value: unknown): CreateProviderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256 ||
    typeof value.baseUrl !== 'string' ||
    value.baseUrl.trim().length === 0 ||
    value.baseUrl.length > 2048 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.trim().length === 0 ||
    value.apiKey.length > 8192
  ) {
    return undefined;
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean') {
    return undefined;
  }
  for (const field of ['credentialGroupName', 'credentialLabel', 'importedFrom'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'string' || (value[field] as string).length > 256)
        return undefined;
    }
  }
  if (value.surface !== undefined) {
    if (typeof value.surface !== 'string' || !SURFACES.has(value.surface)) return undefined;
  }
  return value as unknown as CreateProviderPayload;
}

export function parseUpdateProviderPayload(value: unknown): UpdateProviderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  const hasField =
    value.name !== undefined ||
    value.baseUrl !== undefined ||
    value.protocol !== undefined ||
    value.apiKey !== undefined ||
    value.supportsDiscovery !== undefined ||
    value.credentialLabel !== undefined ||
    value.surface !== undefined ||
    value.enabled !== undefined;
  if (!hasField) return undefined;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return undefined;
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256)
      return undefined;
  }
  if (value.baseUrl !== undefined) {
    if (
      typeof value.baseUrl !== 'string' ||
      value.baseUrl.trim().length === 0 ||
      value.baseUrl.length > 2048
    ) {
      return undefined;
    }
  }
  if (value.protocol !== undefined) {
    if (typeof value.protocol !== 'string' || !PROTOCOLS.has(value.protocol)) return undefined;
  }
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey !== 'string' || value.apiKey.length > 8192) return undefined;
    // empty string means "do not rotate"
  }
  if (value.supportsDiscovery !== undefined && typeof value.supportsDiscovery !== 'boolean')
    return undefined;
  if (value.credentialLabel !== undefined) {
    if (typeof value.credentialLabel !== 'string' || value.credentialLabel.length > 256)
      return undefined;
  }
  if (value.surface !== undefined) {
    if (typeof value.surface !== 'string' || !SURFACES.has(value.surface)) return undefined;
  }
  return value as unknown as UpdateProviderPayload;
}

export function parseListProvidersPayload(value: unknown): ListProvidersPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  return value as ListProvidersPayload;
}

export function parseDiscoverModelsPayload(value: unknown): DiscoverModelsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  if (value.credentialRefId !== undefined && typeof value.credentialRefId !== 'string')
    return undefined;
  return value as unknown as DiscoverModelsPayload;
}

export function parseAddModelsPayload(value: unknown): AddModelsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.protocol !== 'string' ||
    !PROTOCOLS.has(value.protocol) ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    value.models.length > 256
  ) {
    return undefined;
  }
  for (const model of value.models) {
    if (
      !isRecord(model) ||
      typeof model.providerModelId !== 'string' ||
      model.providerModelId.trim().length === 0
    ) {
      return undefined;
    }
    if (model.displayName !== undefined && typeof model.displayName !== 'string') return undefined;
    if (model.contextWindow !== undefined) {
      if (
        typeof model.contextWindow !== 'number' ||
        !Number.isFinite(model.contextWindow) ||
        model.contextWindow <= 0 ||
        model.contextWindow > 100_000_000
      ) {
        return undefined;
      }
    }
    if (model.capabilities !== undefined) {
      if (
        !Array.isArray(model.capabilities) ||
        !model.capabilities.every((c) => typeof c === 'string')
      ) {
        return undefined;
      }
    }
  }
  return value as unknown as AddModelsPayload;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseProbeCapabilitiesPayload(
  value: unknown,
): ProbeCapabilitiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  if (value.modelId !== undefined) {
    if (
      typeof value.modelId !== 'string' ||
      value.modelId.length === 0 ||
      value.modelId.length > 256
    ) {
      return undefined;
    }
  }
  return value as unknown as ProbeCapabilitiesPayload;
}

export function parseConfirmCapabilitiesPayload(
  value: unknown,
): ConfirmCapabilitiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    value.modelId.length > 256 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 16 ||
    !value.capabilities.every((c) => typeof c === 'string')
  ) {
    return undefined;
  }
  if (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') return undefined;
  return value as unknown as ConfirmCapabilitiesPayload;
}

// --- 0026: model-source config parsers ---

export function parseReorderProvidersPayload(value: unknown): ReorderProvidersPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !Array.isArray(value.orderedProviderIds) ||
    value.orderedProviderIds.length === 0 ||
    value.orderedProviderIds.length > 256 ||
    !value.orderedProviderIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 256,
    )
  ) {
    return undefined;
  }
  return value as unknown as ReorderProvidersPayload;
}

export function parseAddProviderCredentialPayload(
  value: unknown,
): AddProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.trim().length === 0 ||
    value.apiKey.length > 8192
  ) {
    return undefined;
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || value.label.length > 256) return undefined;
  }
  return value as unknown as AddProviderCredentialPayload;
}

export function parseRemoveProviderCredentialPayload(
  value: unknown,
): RemoveProviderCredentialPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.credentialRefId !== 'string' ||
    value.credentialRefId.length === 0 ||
    value.credentialRefId.length > 256
  ) {
    return undefined;
  }
  return value as unknown as RemoveProviderCredentialPayload;
}

export function parseSetModelPrioritiesPayload(
  value: unknown,
): SetModelPrioritiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    value.entries.length > 256
  ) {
    return undefined;
  }
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.modelId !== 'string' ||
      entry.modelId.length === 0 ||
      entry.modelId.length > 256
    ) {
      return undefined;
    }
    if (entry.credentialRefId !== undefined && entry.credentialRefId !== null) {
      if (
        typeof entry.credentialRefId !== 'string' ||
        entry.credentialRefId.length === 0 ||
        entry.credentialRefId.length > 256
      ) {
        return undefined;
      }
    }
  }
  return value as unknown as SetModelPrioritiesPayload;
}

export function parseRemoveModelPayload(value: unknown): RemoveModelPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256 ||
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    value.modelId.length > 256
  ) {
    return undefined;
  }
  return value as unknown as RemoveModelPayload;
}

export function parseGetSettingsPayload(value: unknown): GetSettingsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.keys !== undefined) {
    if (
      !Array.isArray(value.keys) ||
      value.keys.length > 64 ||
      !value.keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 128)
    ) {
      return undefined;
    }
  }
  return value as unknown as GetSettingsPayload;
}

export function parseSetSettingPayload(value: unknown): SetSettingPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.key !== 'string' || value.key.trim().length === 0 || value.key.length > 128) {
    return undefined;
  }
  if (!('value' in value)) return undefined;
  // Guard against oversized payloads (settings are small JSON blobs).
  try {
    const encoded = JSON.stringify(value.value ?? null);
    if (encoded.length > 16_384) return undefined;
  } catch {
    return undefined;
  }
  return value as unknown as SetSettingPayload;
}

export function parseUsageSummaryPayload(value: unknown): UsageSummaryPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.sinceDays !== undefined) {
    if (
      typeof value.sinceDays !== 'number' ||
      !Number.isFinite(value.sinceDays) ||
      value.sinceDays <= 0 ||
      value.sinceDays > 3650
    ) {
      return undefined;
    }
  }
  return value as unknown as UsageSummaryPayload;
}

export function parseGetAgentPayload(value: unknown): GetAgentPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.agentId !== undefined) {
    if (
      typeof value.agentId !== 'string' ||
      value.agentId.trim().length === 0 ||
      value.agentId.length > 128
    ) {
      return undefined;
    }
  }
  return value as GetAgentPayload;
}

export function parseUpdateAgentBindingPayload(
  value: unknown,
): UpdateAgentBindingPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.defaultModelId !== 'string' ||
    value.defaultModelId.trim().length === 0 ||
    value.defaultModelId.length > 256
  ) {
    return undefined;
  }
  if (!Array.isArray(value.fallbackModelIds) || value.fallbackModelIds.length > 32) {
    return undefined;
  }
  for (const id of value.fallbackModelIds) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 256) {
      return undefined;
    }
  }
  if (value.agentId !== undefined) {
    if (
      typeof value.agentId !== 'string' ||
      value.agentId.trim().length === 0 ||
      value.agentId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.pauseOnFailure !== undefined && typeof value.pauseOnFailure !== 'boolean') {
    return undefined;
  }
  if (value.defaultCredentialGroupId !== undefined) {
    if (
      typeof value.defaultCredentialGroupId !== 'string' ||
      value.defaultCredentialGroupId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.pinnedCredentialRefId !== undefined && value.pinnedCredentialRefId !== null) {
    if (
      typeof value.pinnedCredentialRefId !== 'string' ||
      value.pinnedCredentialRefId.length > 128
    ) {
      return undefined;
    }
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds) || value.skillVersionIds.length > 64) {
      return undefined;
    }
    const cleaned: string[] = [];
    for (const id of value.skillVersionIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || id.length > 128) return undefined;
      cleaned.push(id.trim());
    }
    skillVersionIds = cleaned;
  }
  let mcpServerIds: string[] | undefined;
  if (value.mcpServerIds !== undefined) {
    if (!Array.isArray(value.mcpServerIds) || value.mcpServerIds.length > 64) {
      return undefined;
    }
    const cleanedMcp: string[] = [];
    for (const id of value.mcpServerIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || id.length > 128) return undefined;
      cleanedMcp.push(id.trim());
    }
    mcpServerIds = cleanedMcp;
  }
  return {
    agentId: value.agentId as UpdateAgentBindingPayload['agentId'],
    defaultModelId: (
      value.defaultModelId as string
    ).trim() as UpdateAgentBindingPayload['defaultModelId'],
    fallbackModelIds: (value.fallbackModelIds as string[]).map(
      (id) => id.trim() as UpdateAgentBindingPayload['fallbackModelIds'][number],
    ),
    pauseOnFailure: value.pauseOnFailure as boolean | undefined,
    defaultCredentialGroupId:
      value.defaultCredentialGroupId as UpdateAgentBindingPayload['defaultCredentialGroupId'],
    pinnedCredentialRefId:
      value.pinnedCredentialRefId as UpdateAgentBindingPayload['pinnedCredentialRefId'],
    skillVersionIds,
    mcpServerIds,
  };
}

const AGENT_DEFINITION_KEYS = [
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

function validAgentIdList(value: unknown, max = 64, itemMax = 256): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => boundedAgentText(item, itemMax))
  );
}

function boundedAgentText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validAgentVisualIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['icon', 'color']) &&
    boundedAgentText(value.icon, 128) &&
    boundedAgentText(value.color, 64)
  );
}

const AGENT_PERMISSION_KEYS = ['file', 'command', 'browser', 'desktop', 'network'] as const;

function validAgentPermissions(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, AGENT_PERMISSION_KEYS) &&
    AGENT_PERMISSION_KEYS.every((key) => validAgentIdList(value[key], 128, 2_048))
  );
}

function validAgentReviewBehavior(value: unknown): boolean {
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

function validAgentArtifactRules(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['retainVersions', 'requireReview', 'defaultStatus']) &&
    typeof value.retainVersions === 'boolean' &&
    typeof value.requireReview === 'boolean' &&
    (value.defaultStatus === 'candidate' || value.defaultStatus === 'final')
  );
}

function validAgentDefinition(value: Record<string, unknown>, options: { full: boolean }): boolean {
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

export function parseListAgentsPayload(value: unknown): ListAgentsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length !== 0) return undefined;
  return {};
}

export function parseCreateAgentPayload(value: unknown): CreateAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, AGENT_DEFINITION_KEYS) ||
    !validAgentDefinition(value, { full: false })
  )
    return undefined;
  return value as unknown as CreateAgentPayload;
}

export function parseListAgentVersionsPayload(
  value: unknown,
): ListAgentVersionsPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['agentId']) || !boundedAgentText(value.agentId, 128))
    return undefined;
  return { agentId: value.agentId as ListAgentVersionsPayload['agentId'] };
}

export function parseCreateAgentVersionPayload(
  value: unknown,
): CreateAgentVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...AGENT_DEFINITION_KEYS, 'expectedVersion']) ||
    !boundedAgentText(value.agentId, 128) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    !validAgentDefinition(value, { full: true })
  )
    return undefined;
  return value as unknown as CreateAgentVersionPayload;
}

// --- mutable global Agent / Team / Conversation payloads (2026-07-22 model) ---

const CONVERSATION_TRACKS = new Set(['model', 'agent', 'team']);
const CONVERSATION_UPGRADE_TRACKS = new Set(['agent', 'team']);
const TEAM_STRATEGIES = new Set(['serial', 'parallel']);
const TEAM_RUN_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);

const GLOBAL_AGENT_KEYS = [
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

function validGlobalAgentFields(
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
  if (value.avatar !== undefined && (typeof value.avatar !== 'string' || value.avatar.length > 512))
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

export function parseListGlobalAgentsPayload(
  value: unknown,
): ListGlobalAgentsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['includeArchived'])) return undefined;
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean')
    return undefined;
  return { includeArchived: value.includeArchived };
}

export function parseCreateGlobalAgentPayload(
  value: unknown,
): CreateGlobalAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, GLOBAL_AGENT_KEYS) ||
    !validGlobalAgentFields(value, { full: true })
  )
    return undefined;
  return value as unknown as CreateGlobalAgentPayload;
}

export function parseUpdateGlobalAgentPayload(
  value: unknown,
): UpdateGlobalAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...GLOBAL_AGENT_KEYS, 'agentId', 'archived']) ||
    !boundedAgentText(value.agentId, 128) ||
    !validGlobalAgentFields(value, { full: false })
  )
    return undefined;
  if (value.archived !== undefined && typeof value.archived !== 'boolean') return undefined;
  return value as unknown as UpdateGlobalAgentPayload;
}

export function parseDeleteGlobalAgentPayload(
  value: unknown,
): DeleteGlobalAgentPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['agentId']) || !boundedAgentText(value.agentId, 128))
    return undefined;
  return { agentId: value.agentId as DeleteGlobalAgentPayload['agentId'] };
}

const TEAM_KEYS = ['name', 'avatar', 'mission', 'strategy', 'coordinatorAgentId', 'members'] as const;

function validTeamMembers(value: unknown): value is TeamMemberDraft[] {
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

function validTeamFields(value: Record<string, unknown>, options: { full: boolean }): boolean {
  if (
    (options.full && !boundedAgentText(value.name, 256)) ||
    (!options.full && value.name !== undefined && !boundedAgentText(value.name, 256))
  )
    return false;
  if (value.avatar !== undefined && (typeof value.avatar !== 'string' || value.avatar.length > 512))
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

export function parseListTeamsPayload(value: unknown): Record<string, never> | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length !== 0) return undefined;
  return {};
}

export function parseCreateTeamPayload(value: unknown): CreateTeamPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, TEAM_KEYS) ||
    !validTeamFields(value, { full: true })
  )
    return undefined;
  return value as unknown as CreateTeamPayload;
}

export function parseUpdateTeamPayload(value: unknown): UpdateTeamPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...TEAM_KEYS, 'teamId']) ||
    !boundedAgentText(value.teamId, 128) ||
    !validTeamFields(value, { full: false })
  )
    return undefined;
  return value as unknown as UpdateTeamPayload;
}

export function parseDeleteTeamPayload(value: unknown): DeleteTeamPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['teamId']) || !boundedAgentText(value.teamId, 128))
    return undefined;
  return { teamId: value.teamId as DeleteTeamPayload['teamId'] };
}

export function parseStartTeamRunPayload(value: unknown): StartTeamRunPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['teamId', 'conversationId']) ||
    !boundedAgentText(value.teamId, 128) ||
    !boundedAgentText(value.conversationId, 128)
  )
    return undefined;
  return {
    teamId: value.teamId as StartTeamRunPayload['teamId'],
    conversationId: value.conversationId as StartTeamRunPayload['conversationId'],
  };
}

export function parseSetTeamRunStatusPayload(
  value: unknown,
): SetTeamRunStatusPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['runId', 'status']) ||
    !boundedAgentText(value.runId, 128) ||
    !TEAM_RUN_STATUSES.has(String(value.status))
  )
    return undefined;
  return {
    runId: value.runId as string,
    status: value.status as SetTeamRunStatusPayload['status'],
  };
}

export function parseListConversationsPayload(
  value: unknown,
): ListConversationsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['track', 'workspaceId', 'includeArchived'])) {
    return undefined;
  }
  if (value.track !== undefined && !CONVERSATION_TRACKS.has(String(value.track))) return undefined;
  if (value.workspaceId !== undefined && !boundedAgentText(value.workspaceId, 128))
    return undefined;
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean')
    return undefined;
  return value as unknown as ListConversationsPayload;
}

export function parseCreateConversationPayload(
  value: unknown,
): CreateConversationPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['track', 'targetRef', 'workspaceId', 'title', 'executionMode']) ||
    !CONVERSATION_TRACKS.has(String(value.track)) ||
    !boundedAgentText(value.targetRef, 256)
  )
    return undefined;
  if (value.workspaceId !== undefined && !boundedAgentText(value.workspaceId, 128))
    return undefined;
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 512))
    return undefined;
  if (value.executionMode !== undefined && !boundedAgentText(value.executionMode, 64))
    return undefined;
  return value as unknown as CreateConversationPayload;
}

export function parseRenameConversationPayload(
  value: unknown,
): RenameConversationPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'title']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !boundedAgentText(value.title, 512)
  )
    return undefined;
  return {
    conversationId: value.conversationId as RenameConversationPayload['conversationId'],
    title: value.title,
  };
}

export function parseSetConversationPinnedPayload(
  value: unknown,
): SetConversationPinnedPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'pinned']) ||
    !boundedAgentText(value.conversationId, 128) ||
    typeof value.pinned !== 'boolean'
  )
    return undefined;
  return {
    conversationId: value.conversationId as SetConversationPinnedPayload['conversationId'],
    pinned: value.pinned,
  };
}

export function parseSetConversationArchivedPayload(
  value: unknown,
): SetConversationArchivedPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'archived']) ||
    !boundedAgentText(value.conversationId, 128) ||
    typeof value.archived !== 'boolean'
  )
    return undefined;
  return {
    conversationId: value.conversationId as SetConversationArchivedPayload['conversationId'],
    archived: value.archived,
  };
}

export function parseSetConversationExecutionModePayload(
  value: unknown,
): SetConversationExecutionModePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'executionMode']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !boundedAgentText(value.executionMode, 64)
  )
    return undefined;
  return {
    conversationId: value.conversationId as SetConversationExecutionModePayload['conversationId'],
    executionMode: value.executionMode,
  };
}

export function parseConversationDecideToolApprovalPayload(
  value: unknown,
): ConversationDecideToolApprovalPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['approvalId', 'decision']) ||
    !boundedAgentText(value.approvalId, 128) ||
    (value.decision !== 'approve' && value.decision !== 'deny')
  ) {
    return undefined;
  }
  return {
    approvalId: value.approvalId,
    decision: value.decision,
  };
}

export function parseUpgradeConversationTrackPayload(
  value: unknown,
): UpgradeConversationTrackPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'track', 'targetRef']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !CONVERSATION_UPGRADE_TRACKS.has(String(value.track)) ||
    !boundedAgentText(value.targetRef, 256)
  )
    return undefined;
  return {
    conversationId: value.conversationId as UpgradeConversationTrackPayload['conversationId'],
    track: value.track as UpgradeConversationTrackPayload['track'],
    targetRef: value.targetRef,
  };
}

export function parseDeleteConversationPayload(
  value: unknown,
): DeleteConversationPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId']) ||
    !boundedAgentText(value.conversationId, 128)
  )
    return undefined;
  return {
    conversationId: value.conversationId as DeleteConversationPayload['conversationId'],
  };
}

const MEMORY_SCOPES = new Set(['task', 'project', 'global']);
const MEMORY_STATES = new Set(['pending', 'approved', 'rejected', 'rolled_back']);

function parseMemoryEntries(value: unknown): boolean {
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

export function parseListMemoryPayload(value: unknown): ListMemoryPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' || value.taskId.length > 128)
  ) {
    return undefined;
  }
  if (value.approvalState !== undefined && !MEMORY_STATES.has(String(value.approvalState))) {
    return undefined;
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== 'number' || !Number.isFinite(value.limit))
  ) {
    return undefined;
  }
  return value as ListMemoryPayload;
}

export function parseProposeMemoryPayload(value: unknown): ProposeMemoryPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.trim().length === 0 ||
    value.taskId.length > 128
  ) {
    return undefined;
  }
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (value.targetScope !== undefined && !MEMORY_SCOPES.has(String(value.targetScope)))
    return undefined;
  if (!parseMemoryEntries(value.additions) || !parseMemoryEntries(value.modifications))
    return undefined;
  if (value.deprecations !== undefined) {
    if (!Array.isArray(value.deprecations) || value.deprecations.length > 64) return undefined;
    if (!value.deprecations.every((d) => typeof d === 'string' && d.length > 0 && d.length <= 128))
      return undefined;
  }
  if (value.evidenceRefs !== undefined) {
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 32) return undefined;
    if (!value.evidenceRefs.every((d) => typeof d === 'string')) return undefined;
  }
  if (
    value.confidence !== undefined &&
    (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence))
  ) {
    return undefined;
  }
  if (value.unresolvedAmbiguity !== undefined && typeof value.unresolvedAmbiguity !== 'string')
    return undefined;
  if (value.proposedByRunId !== undefined && typeof value.proposedByRunId !== 'string')
    return undefined;
  if (value.autoApprove !== undefined && typeof value.autoApprove !== 'boolean') return undefined;
  return value as unknown as ProposeMemoryPayload;
}

export function parseDecideMemoryPayload(value: unknown): DecideMemoryPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.changeId !== 'string' ||
    value.changeId.trim().length === 0 ||
    value.changeId.length > 128
  ) {
    return undefined;
  }
  if (value.decision !== 'approved' && value.decision !== 'rejected') return undefined;
  return value as unknown as DecideMemoryPayload;
}

export function parseRollbackMemoryPayload(value: unknown): RollbackMemoryPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const changeId = (value as { changeId?: unknown }).changeId;
  if (typeof changeId !== 'string' || changeId.trim().length === 0) return undefined;
  return { changeId: changeId.trim() as RollbackMemoryPayload['changeId'] };
}

export function parseListDiagnosticsPayload(value: unknown): ListDiagnosticsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' || value.taskId.length > 128)
  ) {
    return undefined;
  }
  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.length > 128)) {
    return undefined;
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== 'number' || !Number.isFinite(value.limit))
  ) {
    return undefined;
  }
  return value as ListDiagnosticsPayload;
}

export function parsePeekContextPacketPayload(
  value: unknown,
): PeekContextPacketPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.threadId !== 'string' ||
    value.threadId.length === 0 ||
    value.threadId.length > 256
  ) {
    return undefined;
  }
  for (const field of ['modelId', 'credentialRefId', 'agentVersionId', 'userText'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return undefined;
  }
  if (typeof value.userText === 'string' && value.userText.length > 100_000) return undefined;
  return value as unknown as PeekContextPacketPayload;
}

export function parseAmendContextPacketPayload(
  value: unknown,
): AmendContextPacketPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.threadId !== 'string' ||
    value.threadId.length === 0 ||
    value.threadId.length > 256
  ) {
    return undefined;
  }
  if (value.clearAll !== undefined && typeof value.clearAll !== 'boolean') return undefined;
  if (value.excludeSourceIds !== undefined) {
    if (!Array.isArray(value.excludeSourceIds)) return undefined;
    if (value.excludeSourceIds.length > 256) return undefined;
    for (const id of value.excludeSourceIds) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 256) return undefined;
    }
  }
  return {
    threadId: value.threadId as AmendContextPacketPayload['threadId'],
    excludeSourceIds: Array.isArray(value.excludeSourceIds)
      ? (value.excludeSourceIds as string[])
      : undefined,
    clearAll: typeof value.clearAll === 'boolean' ? value.clearAll : undefined,
  };
}

export function parseImportSkillPayload(value: unknown): ImportSkillPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.skillMd !== 'string' || value.skillMd.trim().length === 0) return undefined;
  if (value.skillMd.length > 512_000) return undefined;
  return { skillMd: value.skillMd };
}

export function parseListSkillsPayload(value: unknown): ListSkillsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  return {
    limit: value.limit as number | undefined,
  };
}

export function parseRegisterMcpServerPayload(
  value: unknown,
): RegisterMcpServerPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 128) {
    return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== 'string' || value.notes.length > 2000) return undefined;
  }
  let tools: RegisterMcpServerPayload['tools'] | undefined;
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > 64) return undefined;
    const cleaned: NonNullable<RegisterMcpServerPayload['tools']> = [];
    for (const t of value.tools) {
      if (!isRecord(t)) return undefined;
      if (typeof t.name !== 'string' || t.name.trim().length === 0 || t.name.length > 128)
        return undefined;
      if (
        t.description !== undefined &&
        (typeof t.description !== 'string' || t.description.length > 1000)
      ) {
        return undefined;
      }
      if (
        t.inputSchemaJson !== undefined &&
        (typeof t.inputSchemaJson !== 'string' || t.inputSchemaJson.length > 16_000)
      ) {
        return undefined;
      }
      cleaned.push({
        name: t.name.trim(),
        description: typeof t.description === 'string' ? t.description : '',
        inputSchemaJson: typeof t.inputSchemaJson === 'string' ? t.inputSchemaJson : undefined,
      });
    }
    tools = cleaned;
  }
  return {
    name: value.name.trim(),
    transport: typeof value.transport === 'string' ? value.transport : undefined,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
    tools,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

export function parseListMcpServersPayload(value: unknown): ListMcpServersPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  return {
    limit: value.limit as number | undefined,
  };
}

export function parseProbeMcpPolicyPayload(value: unknown): ProbeMcpPolicyPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.toolName !== undefined) {
    if (typeof value.toolName !== 'string' || value.toolName.length > 128) return undefined;
  }
  if (value.simulatedOutput !== undefined) {
    if (typeof value.simulatedOutput !== 'string' || value.simulatedOutput.length > 200000)
      return undefined;
  }
  if (value.simulatedElapsedMs !== undefined) {
    if (typeof value.simulatedElapsedMs !== 'number' || !Number.isFinite(value.simulatedElapsedMs))
      return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  return {
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
    simulatedOutput: typeof value.simulatedOutput === 'string' ? value.simulatedOutput : undefined,
    simulatedElapsedMs:
      typeof value.simulatedElapsedMs === 'number' ? value.simulatedElapsedMs : undefined,
    transport: typeof value.transport === 'string' ? value.transport : undefined,
  };
}

const APPROVAL_STATES = new Set(['pending', 'approved', 'rejected']);
const APPROVAL_KINDS = new Set([
  'plan',
  'tool',
  'memory',
  'export',
  'skill-permission',
  'mcp-permission',
  'human-only',
  'other',
]);

export function parseRequestMcpToolPayload(value: unknown): RequestMcpToolPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'mcpServerId',
      'toolName',
      'argumentsJson',
      'mode',
      'forceSensitive',
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'forceEnqueue',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.toolName !== 'string' ||
    value.toolName.trim().length === 0 ||
    value.toolName.length > 128
  ) {
    return undefined;
  }
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.argumentsJson !== undefined) {
    if (typeof value.argumentsJson !== 'string' || value.argumentsJson.length > 32_000)
      return undefined;
  }
  if (value.mode !== undefined && typeof value.mode !== 'string') return undefined;
  if (value.forceSensitive !== undefined && typeof value.forceSensitive !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.workspaceId !== undefined && typeof value.workspaceId !== 'string') return undefined;
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined;
  const orchestrationScope = [value.runId, value.stepId, value.agentVersionId];
  const orchestrationFieldCount = orchestrationScope.filter((entry) => entry !== undefined).length;
  if (
    orchestrationFieldCount !== 0 &&
    (orchestrationFieldCount !== orchestrationScope.length ||
      value.workspaceId === undefined ||
      value.taskId === undefined)
  ) {
    return undefined;
  }
  if (
    orchestrationScope.some(
      (entry) =>
        entry !== undefined &&
        (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 128),
    )
  ) {
    return undefined;
  }
  return {
    toolName: value.toolName.trim(),
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    argumentsJson: typeof value.argumentsJson === 'string' ? value.argumentsJson : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    forceSensitive: typeof value.forceSensitive === 'boolean' ? value.forceSensitive : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as RequestMcpToolPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as RequestMcpToolPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId.trim() as RequestMcpToolPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId.trim() as RequestMcpToolPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as RequestMcpToolPayload['agentVersionId'])
        : undefined,
  };
}

export function parseProbeMcpSpawnPayload(value: unknown): ProbeMcpSpawnPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.stdinText !== undefined) {
    if (typeof value.stdinText !== 'string' || value.stdinText.length > 32_000) return undefined;
  }
  return {
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
    transport: typeof value.transport === 'string' ? value.transport : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    stdinText: typeof value.stdinText === 'string' ? value.stdinText : undefined,
  };
}

export function parseCallMcpToolPayload(value: unknown): CallMcpToolPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'mcpServerId',
      'toolName',
      'argumentsJson',
      'mode',
      'forceSensitive',
      'forceEnqueue',
      'priorApprovalId',
      'executeIfAutoApproved',
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'maxOutputBytes',
      'timeoutMs',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    value.mcpServerId.length > 128
  ) {
    return undefined;
  }
  if (
    typeof value.toolName !== 'string' ||
    value.toolName.trim().length === 0 ||
    value.toolName.length > 256
  ) {
    return undefined;
  }
  if (value.argumentsJson !== undefined) {
    if (typeof value.argumentsJson !== 'string' || value.argumentsJson.length > 32_000)
      return undefined;
  }
  if (value.mode !== undefined && typeof value.mode !== 'string') return undefined;
  if (value.forceSensitive !== undefined && typeof value.forceSensitive !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.executeIfAutoApproved !== undefined && typeof value.executeIfAutoApproved !== 'boolean')
    return undefined;
  if (value.priorApprovalId !== undefined) {
    if (
      typeof value.priorApprovalId !== 'string' ||
      value.priorApprovalId.trim().length === 0 ||
      value.priorApprovalId.length > 128
    ) {
      return undefined;
    }
  }
  const exactScope = [
    value.workspaceId,
    value.taskId,
    value.runId,
    value.stepId,
    value.agentVersionId,
  ];
  if (
    exactScope.some(
      (entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 128,
    )
  )
    return undefined;
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  return {
    mcpServerId: value.mcpServerId.trim(),
    toolName: value.toolName.trim(),
    argumentsJson: typeof value.argumentsJson === 'string' ? value.argumentsJson : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    forceSensitive: typeof value.forceSensitive === 'boolean' ? value.forceSensitive : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    executeIfAutoApproved:
      typeof value.executeIfAutoApproved === 'boolean' ? value.executeIfAutoApproved : undefined,
    priorApprovalId:
      typeof value.priorApprovalId === 'string' ? value.priorApprovalId.trim() : undefined,
    workspaceId: (value.workspaceId as string).trim() as CallMcpToolPayload['workspaceId'],
    taskId: (value.taskId as string).trim() as CallMcpToolPayload['taskId'],
    runId: (value.runId as string).trim() as CallMcpToolPayload['runId'],
    stepId: (value.stepId as string).trim() as CallMcpToolPayload['stepId'],
    agentVersionId: (value.agentVersionId as string).trim() as CallMcpToolPayload['agentVersionId'],
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
  };
}

export function parseRefreshMcpToolsPayload(value: unknown): RefreshMcpToolsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    value.mcpServerId.length > 128
  ) {
    return undefined;
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.maxTools !== undefined) {
    if (
      typeof value.maxTools !== 'number' ||
      !Number.isFinite(value.maxTools) ||
      value.maxTools < 1 ||
      value.maxTools > 200
    ) {
      return undefined;
    }
  }
  return {
    mcpServerId: value.mcpServerId.trim(),
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    maxTools: typeof value.maxTools === 'number' ? value.maxTools : undefined,
  };
}

export function parseListApprovalsPayload(value: unknown): ListApprovalsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.workspaceId !== undefined) {
    if (
      typeof value.workspaceId !== 'string' ||
      value.workspaceId.trim().length === 0 ||
      value.workspaceId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.taskId !== undefined) {
    if (
      typeof value.taskId !== 'string' ||
      value.taskId.trim().length === 0 ||
      value.taskId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.state !== undefined) {
    if (typeof value.state !== 'string' || !APPROVAL_STATES.has(value.state)) return undefined;
  }
  if (value.humanOnly !== undefined && typeof value.humanOnly !== 'boolean') return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  return {
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as ListApprovalsPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as ListApprovalsPayload['taskId'])
        : undefined,
    state: value.state as ListApprovalsPayload['state'],
    humanOnly: typeof value.humanOnly === 'boolean' ? value.humanOnly : undefined,
    limit: typeof value.limit === 'number' ? value.limit : undefined,
  };
}

export function parseEvaluateApprovalPayload(value: unknown): EvaluateApprovalPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'mode',
      'action',
      'kind',
      'insideExplicitPolicy',
      'delegateAvailable',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.action !== 'string' ||
    value.action.trim().length === 0 ||
    value.action.length > 256
  ) {
    return undefined;
  }
  if (value.mode !== undefined && (typeof value.mode !== 'string' || value.mode.length > 32))
    return undefined;
  if (value.kind !== undefined) {
    if (typeof value.kind !== 'string' || value.kind.length > 64) return undefined;
    // allow unknown kinds through for forward-compat; known set is documented
    void APPROVAL_KINDS;
  }
  if (value.insideExplicitPolicy !== undefined && typeof value.insideExplicitPolicy !== 'boolean')
    return undefined;
  if (value.delegateAvailable !== undefined && typeof value.delegateAvailable !== 'boolean')
    return undefined;
  for (const key of ['workspaceId', 'taskId', 'runId', 'stepId', 'agentVersionId'] as const) {
    const candidate = value[key];
    if (
      candidate !== undefined &&
      (typeof candidate !== 'string' || candidate.trim().length === 0 || candidate.length > 128)
    ) {
      return undefined;
    }
  }
  return {
    action: value.action.trim(),
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId.trim() as EvaluateApprovalPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId.trim() as EvaluateApprovalPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId.trim() as EvaluateApprovalPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId.trim() as EvaluateApprovalPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as EvaluateApprovalPayload['agentVersionId'])
        : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
  };
}

export function parseEnqueueApprovalPayload(value: unknown): EnqueueApprovalPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'kind',
      'action',
      'summary',
      'mode',
      'insideExplicitPolicy',
      'delegateAvailable',
      'forceEnqueue',
      'metadata',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.action !== 'string' ||
    value.action.trim().length === 0 ||
    value.action.length > 256
  ) {
    return undefined;
  }
  if (value.workspaceId !== undefined) {
    if (
      typeof value.workspaceId !== 'string' ||
      value.workspaceId.trim().length === 0 ||
      value.workspaceId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.taskId !== undefined) {
    if (typeof value.taskId !== 'string' || value.taskId.length > 128) return undefined;
  }
  if (value.runId !== undefined) {
    if (typeof value.runId !== 'string' || value.runId.length > 128) return undefined;
  }
  if (value.stepId !== undefined) {
    if (typeof value.stepId !== 'string' || value.stepId.length > 128) return undefined;
  }
  if (value.agentVersionId !== undefined) {
    if (
      typeof value.agentVersionId !== 'string' ||
      value.agentVersionId.trim().length === 0 ||
      value.agentVersionId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.kind !== undefined && (typeof value.kind !== 'string' || value.kind.length > 64))
    return undefined;
  if (
    value.summary !== undefined &&
    (typeof value.summary !== 'string' || value.summary.length > 1000)
  )
    return undefined;
  if (value.mode !== undefined && (typeof value.mode !== 'string' || value.mode.length > 32))
    return undefined;
  if (value.insideExplicitPolicy !== undefined && typeof value.insideExplicitPolicy !== 'boolean')
    return undefined;
  if (value.delegateAvailable !== undefined && typeof value.delegateAvailable !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) return undefined;
  }
  return {
    action: value.action.trim(),
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as EnqueueApprovalPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as EnqueueApprovalPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId as EnqueueApprovalPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId as EnqueueApprovalPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as EnqueueApprovalPayload['agentVersionId'])
        : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

export function parseDecideApprovalPayload(value: unknown): DecideApprovalPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'decision', 'decidedBy', 'delegateAgentVersionId', 'decisionNote'])
  )
    return undefined;
  if (typeof value.id !== 'string' || value.id.trim().length === 0 || value.id.length > 128)
    return undefined;
  if (value.decision !== 'approved' && value.decision !== 'rejected') return undefined;
  if (
    value.decisionNote !== undefined &&
    (typeof value.decisionNote !== 'string' || value.decisionNote.length > 1000)
  ) {
    return undefined;
  }
  if (
    value.decidedBy !== undefined &&
    value.decidedBy !== 'human' &&
    value.decidedBy !== 'delegate'
  ) {
    return undefined;
  }
  if (
    value.decidedBy === 'delegate' &&
    (typeof value.delegateAgentVersionId !== 'string' ||
      value.delegateAgentVersionId.trim().length === 0 ||
      value.delegateAgentVersionId.length > 128)
  )
    return undefined;
  if (value.decidedBy !== 'delegate' && value.delegateAgentVersionId !== undefined) {
    return undefined;
  }
  return {
    id: value.id.trim() as DecideApprovalPayload['id'],
    decision: value.decision,
    decidedBy: value.decidedBy,
    delegateAgentVersionId:
      typeof value.delegateAgentVersionId === 'string'
        ? (value.delegateAgentVersionId.trim() as DecideApprovalPayload['delegateAgentVersionId'])
        : undefined,
    decisionNote: typeof value.decisionNote === 'string' ? value.decisionNote : undefined,
  };
}

export function parsePreviewCcSwitchImportPayload(
  value: unknown,
): PreviewCcSwitchImportPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.dbPath !== undefined) {
    if (typeof value.dbPath !== 'string' || value.dbPath.length > 4096) return undefined;
  }
  return value as unknown as PreviewCcSwitchImportPayload;
}

export function parseImportCcSwitchPayload(value: unknown): ImportCcSwitchPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length === 0 ||
    value.sourceIds.length > 64
  ) {
    return undefined;
  }
  if (!value.sourceIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
    return undefined;
  }
  if (value.dbPath !== undefined) {
    if (typeof value.dbPath !== 'string' || value.dbPath.length > 4096) return undefined;
  }
  return value as unknown as ImportCcSwitchPayload;
}
