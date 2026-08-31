// Payload validation for the mutable global Agent / Team / Conversation
// commands (2026-07-22 model). Same strict style as agent-payloads.ts: reject
// wrong shapes at the IPC boundary before frames reach the Runtime.
import type {
  CreateConversationPayload,
  CreateGlobalAgentPayload,
  CreateTeamPayload,
  DeleteConversationPayload,
  DeleteGlobalAgentPayload,
  DeleteTeamPayload,
  ConversationCompactPayload,
  ListConversationsPayload,
  ConversationListMessagesPayload,
  ConversationGetContextStatusPayload,
  ConversationGetRunProcessPayload,
  SubscribeConversationTransientStreamPayload,
  ListGlobalAgentsPayload,
  RenameConversationPayload,
  SetConversationArchivedPayload,
  SetConversationExecutionModePayload,
  SetConversationInteractionModePayload,
  SetConversationContextWindowOverridePayload,
  ConversationPlanSubmitPayload,
  ConversationPlanGetPayload,
  ConversationPlanApprovePayload,
  ConversationPlanRevisePayload,
  ConversationPlanCancelPayload,
  ConversationAskAnswerPayload,
  ConversationAskCancelPayload,
  ConversationAskPendingPayload,
  CreateScheduledTaskPayload,
  ListScheduledTasksPayload,
  ListScheduledTaskHistoryPayload,
  ActivityListRunsPayload,
  ActivityListExternalEventsPayload,
  ActivityRetryAnchorPayload,
  UpdateScheduledTaskPayload,
  DeleteScheduledTaskPayload,
  TriggerScheduledTaskPayload,
  SkillLocalInspectPayload,
  SkillLocalScanPayload,
  SkillLocalImportPayload,
  InstallSkillMarketPayload,
  SetConversationPinnedPayload,
  SetTeamRunStatusPayload,
  StartTeamRunPayload,
  TeamMemberDraft,
  UpdateGlobalAgentPayload,
  UpdateTeamPayload,
  UpgradeConversationTrackPayload,
  RebindConversationTargetPayload,
  ConversationDecideToolApprovalPayload,
  ConversationSubmitBrowserResultPayload,
} from '@sync-think/protocol';
import type {
  ScheduledTaskTarget,
  TaskRule,
  RunIndexState,
  RunIndexSource,
  ExternalEventState,
} from '@sync-think/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(label);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(label);
  return value.trim();
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(label);
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) throw new Error(label);
    return item.trim();
  });
}

// ─── global agents ──────────────────────────────────────────────────────────

export function parseListGlobalAgentsPayload(value: unknown): ListGlobalAgentsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-global-agents payload');
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean') {
    throw new Error('Invalid list-global-agents payload');
  }
  return { includeArchived: value.includeArchived as boolean | undefined };
}

export function parseCreateGlobalAgentPayload(value: unknown): CreateGlobalAgentPayload {
  const label = 'Invalid create-global-agent payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    name: requiredString(value.name, label),
    defaultModelId: requiredString(
      value.defaultModelId,
      label,
    ) as CreateGlobalAgentPayload['defaultModelId'],
    avatar: optionalString(value.avatar, label),
    persona: optionalString(value.persona, label),
    description: optionalString(value.description, label),
    fallbackModelIds: optionalStringArray(
      value.fallbackModelIds,
      label,
    ) as CreateGlobalAgentPayload['fallbackModelIds'],
    skillIds: optionalStringArray(value.skillIds, label),
    mcpServerIds: optionalStringArray(value.mcpServerIds, label),
    reasoningEffort: optionalString(value.reasoningEffort, label),
  };
}

export function parseUpdateGlobalAgentPayload(value: unknown): UpdateGlobalAgentPayload {
  const label = 'Invalid update-global-agent payload';
  if (!isRecord(value)) throw new Error(label);
  if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new Error(label);
  const base =
    isRecord(value) && value.name !== undefined ? { name: requiredString(value.name, label) } : {};
  return {
    agentId: requiredString(value.agentId, label) as UpdateGlobalAgentPayload['agentId'],
    ...base,
    defaultModelId:
      value.defaultModelId === undefined
        ? undefined
        : (requiredString(
            value.defaultModelId,
            label,
          ) as UpdateGlobalAgentPayload['defaultModelId']),
    avatar: optionalString(value.avatar, label),
    persona: optionalString(value.persona, label),
    description: optionalString(value.description, label),
    fallbackModelIds: optionalStringArray(
      value.fallbackModelIds,
      label,
    ) as UpdateGlobalAgentPayload['fallbackModelIds'],
    skillIds: optionalStringArray(value.skillIds, label),
    mcpServerIds: optionalStringArray(value.mcpServerIds, label),
    reasoningEffort: optionalString(value.reasoningEffort, label),
    archived: value.archived as boolean | undefined,
  };
}

export function parseDeleteGlobalAgentPayload(value: unknown): DeleteGlobalAgentPayload {
  const label = 'Invalid delete-global-agent payload';
  if (!isRecord(value)) throw new Error(label);
  return { agentId: requiredString(value.agentId, label) as DeleteGlobalAgentPayload['agentId'] };
}

// ─── teams ──────────────────────────────────────────────────────────────────

const TEAM_STRATEGIES = new Set(['serial', 'parallel']);

function parseTeamMembers(value: unknown, label: string): TeamMemberDraft[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(label);
  return value.map((member) => {
    if (!isRecord(member)) throw new Error(label);
    return {
      agentId: requiredString(member.agentId, label) as TeamMemberDraft['agentId'],
      role: optionalString(member.role, label),
      title: optionalString(member.title, label),
      dependsOn: optionalStringArray(member.dependsOn, label) as TeamMemberDraft['dependsOn'],
    };
  });
}

export function parseCreateTeamPayload(value: unknown): CreateTeamPayload {
  const label = 'Invalid create-team payload';
  if (!isRecord(value)) throw new Error(label);
  if (value.strategy !== undefined && !TEAM_STRATEGIES.has(value.strategy as string)) {
    throw new Error(label);
  }
  return {
    name: requiredString(value.name, label),
    avatar: optionalString(value.avatar, label),
    mission: optionalString(value.mission, label),
    strategy: value.strategy as CreateTeamPayload['strategy'],
    coordinatorAgentId:
      value.coordinatorAgentId === undefined
        ? undefined
        : (requiredString(
            value.coordinatorAgentId,
            label,
          ) as CreateTeamPayload['coordinatorAgentId']),
    members: parseTeamMembers(value.members, label),
  };
}

export function parseUpdateTeamPayload(value: unknown): UpdateTeamPayload {
  const label = 'Invalid update-team payload';
  if (!isRecord(value)) throw new Error(label);
  if (value.strategy !== undefined && !TEAM_STRATEGIES.has(value.strategy as string)) {
    throw new Error(label);
  }
  return {
    teamId: requiredString(value.teamId, label) as UpdateTeamPayload['teamId'],
    name: value.name === undefined ? undefined : requiredString(value.name, label),
    avatar: optionalString(value.avatar, label),
    mission: optionalString(value.mission, label),
    strategy: value.strategy as UpdateTeamPayload['strategy'],
    coordinatorAgentId:
      value.coordinatorAgentId === undefined
        ? undefined
        : (requiredString(
            value.coordinatorAgentId,
            label,
          ) as UpdateTeamPayload['coordinatorAgentId']),
    members: parseTeamMembers(value.members, label),
  };
}

export function parseDeleteTeamPayload(value: unknown): DeleteTeamPayload {
  const label = 'Invalid delete-team payload';
  if (!isRecord(value)) throw new Error(label);
  return { teamId: requiredString(value.teamId, label) as DeleteTeamPayload['teamId'] };
}

export function parseStartTeamRunPayload(value: unknown): StartTeamRunPayload {
  const label = 'Invalid start-team-run payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    teamId: requiredString(value.teamId, label) as StartTeamRunPayload['teamId'],
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as StartTeamRunPayload['conversationId'],
  };
}

const TEAM_RUN_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);

export function parseSetTeamRunStatusPayload(value: unknown): SetTeamRunStatusPayload {
  const label = 'Invalid set-team-run-status payload';
  if (!isRecord(value)) throw new Error(label);
  const status = requiredString(value.status, label);
  if (!TEAM_RUN_STATUSES.has(status)) throw new Error(label);
  return {
    runId: requiredString(value.runId, label),
    status: status as SetTeamRunStatusPayload['status'],
  };
}

// ─── conversations ──────────────────────────────────────────────────────────

const CONVERSATION_TRACKS = new Set(['model', 'agent', 'team']);

export function parseListConversationsPayload(value: unknown): ListConversationsPayload {
  if (value === undefined || value === null) return {};
  const label = 'Invalid list-conversations payload';
  if (!isRecord(value)) throw new Error(label);
  if (value.track !== undefined && !CONVERSATION_TRACKS.has(value.track as string)) {
    throw new Error(label);
  }
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean') {
    throw new Error(label);
  }
  return {
    track: value.track as ListConversationsPayload['track'],
    workspaceId:
      value.workspaceId === undefined
        ? undefined
        : (requiredString(value.workspaceId, label) as ListConversationsPayload['workspaceId']),
    includeArchived: value.includeArchived as boolean | undefined,
  };
}

export function parseConversationListMessagesPayload(
  value: unknown,
): ConversationListMessagesPayload {
  const label = 'Invalid list-conversation-messages payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['conversationId', 'beforeSequence', 'limit']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  if (
    value.beforeSequence !== undefined &&
    (!Number.isSafeInteger(value.beforeSequence) || (value.beforeSequence as number) < 0)
  ) {
    throw new Error(label);
  }
  if (
    value.limit !== undefined &&
    (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
  ) {
    throw new Error(label);
  }
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationListMessagesPayload['conversationId'],
    beforeSequence: value.beforeSequence as number | undefined,
    limit: value.limit as number | undefined,
  };
}

export function parseConversationGetContextStatusPayload(
  value: unknown,
): ConversationGetContextStatusPayload {
  const label = 'Invalid get-conversation-context-status payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['conversationId', 'modelId', 'kernelId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  const conversationId = requiredString(value.conversationId, label);
  if (conversationId.length > 128) throw new Error(label);
  const modelId = value.modelId === undefined ? undefined : requiredString(value.modelId, label);
  if (modelId !== undefined && modelId.length > 256) throw new Error(label);
  const kernelId = value.kernelId === undefined ? undefined : requiredString(value.kernelId, label);
  if (kernelId !== undefined && kernelId.length > 64) throw new Error(label);
  return {
    conversationId: conversationId as ConversationGetContextStatusPayload['conversationId'],
    ...(modelId ? { modelId } : {}),
    ...(kernelId ? { kernelId } : {}),
  };
}

export function parseConversationGetRunProcessPayload(
  value: unknown,
): ConversationGetRunProcessPayload {
  const label = 'Invalid get-conversation-run-process payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['runId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  const runId = requiredString(value.runId, label);
  if (runId.length > 128) throw new Error(label);
  return { runId: runId as ConversationGetRunProcessPayload['runId'] };
}

export function parseSubscribeConversationTransientStreamPayload(
  value: unknown,
): SubscribeConversationTransientStreamPayload & { subscriptionId: string } {
  const label = 'Invalid subscribe-conversation-transient-stream payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['threadId', 'afterStreamSequence', 'subscriptionId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  if (
    value.afterStreamSequence !== undefined &&
    (!Number.isSafeInteger(value.afterStreamSequence) || (value.afterStreamSequence as number) < 0)
  ) {
    throw new Error(label);
  }
  return {
    threadId: requiredString(
      value.threadId,
      label,
    ) as SubscribeConversationTransientStreamPayload['threadId'],
    afterStreamSequence: value.afterStreamSequence as number | undefined,
    subscriptionId: requiredString(value.subscriptionId, label),
  };
}

export function parseUnsubscribeConversationTransientStreamPayload(value: unknown): {
  subscriptionId: string;
} {
  const label = 'Invalid unsubscribe-conversation-transient-stream payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['subscriptionId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  return { subscriptionId: requiredString(value.subscriptionId, label) };
}

export function parseCreateConversationPayload(value: unknown): CreateConversationPayload {
  const label = 'Invalid create-conversation payload';
  if (!isRecord(value)) throw new Error(label);
  const track = requiredString(value.track, label);
  if (!CONVERSATION_TRACKS.has(track)) throw new Error(label);
  return {
    track: track as CreateConversationPayload['track'],
    targetRef: requiredString(value.targetRef, label),
    workspaceId:
      value.workspaceId === undefined
        ? undefined
        : (requiredString(value.workspaceId, label) as CreateConversationPayload['workspaceId']),
    title: optionalString(value.title, label),
    executionMode: optionalString(value.executionMode, label),
  };
}

export function parseRenameConversationPayload(value: unknown): RenameConversationPayload {
  const label = 'Invalid rename-conversation payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as RenameConversationPayload['conversationId'],
    title: requiredString(value.title, label),
  };
}

export function parseSetConversationPinnedPayload(value: unknown): SetConversationPinnedPayload {
  const label = 'Invalid set-conversation-pinned payload';
  if (!isRecord(value) || typeof value.pinned !== 'boolean') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as SetConversationPinnedPayload['conversationId'],
    pinned: value.pinned,
  };
}

export function parseSetConversationArchivedPayload(
  value: unknown,
): SetConversationArchivedPayload {
  const label = 'Invalid set-conversation-archived payload';
  if (!isRecord(value) || typeof value.archived !== 'boolean') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as SetConversationArchivedPayload['conversationId'],
    archived: value.archived,
  };
}

export function parseSetConversationExecutionModePayload(
  value: unknown,
): SetConversationExecutionModePayload {
  const label = 'Invalid set-conversation-execution-mode payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as SetConversationExecutionModePayload['conversationId'],
    executionMode: requiredString(value.executionMode, label),
  };
}

export function parseSetConversationInteractionModePayload(
  value: unknown,
): SetConversationInteractionModePayload {
  const label = 'Invalid set-conversation-interaction-mode payload';
  if (!isRecord(value)) throw new Error(label);
  const mode = requiredString(value.interactionMode, label);
  if (mode !== 'plan' && mode !== 'execute') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as SetConversationInteractionModePayload['conversationId'],
    interactionMode: mode,
  };
}

export function parseSetConversationContextWindowOverridePayload(
  value: unknown,
): SetConversationContextWindowOverridePayload {
  const label = 'Invalid set-conversation-context-window-override payload';
  if (!isRecord(value)) throw new Error(label);
  const allowed = new Set(['conversationId', 'contextWindowOverride']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  const conversationId = requiredString(value.conversationId, label);
  if (conversationId.length > 128) throw new Error(label);
  const contextWindowOverride = value.contextWindowOverride;
  if (
    contextWindowOverride !== null &&
    (!Number.isSafeInteger(contextWindowOverride) ||
      (contextWindowOverride as number) < 1_024 ||
      (contextWindowOverride as number) > 10_000_000)
  ) {
    throw new Error(label);
  }
  return {
    conversationId: conversationId as SetConversationContextWindowOverridePayload['conversationId'],
    contextWindowOverride: contextWindowOverride as number | null,
  };
}

function requiredChatPlanSubmission(
  value: unknown,
  label: string,
): ConversationPlanSubmitPayload['plan'] {
  if (!isRecord(value)) throw new Error(label);
  if (typeof value.title !== 'string' || typeof value.goal !== 'string') throw new Error(label);
  if (!Array.isArray(value.steps) || !Array.isArray(value.finalAcceptanceChecks))
    throw new Error(label);
  return value as unknown as ConversationPlanSubmitPayload['plan'];
}

export function parseConversationPlanSubmitPayload(value: unknown): ConversationPlanSubmitPayload {
  const label = 'Invalid conversation-plan-submit payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationPlanSubmitPayload['conversationId'],
    plan: requiredChatPlanSubmission(value.plan, label),
  };
}

export function parseConversationPlanGetPayload(value: unknown): ConversationPlanGetPayload {
  const label = 'Invalid conversation-plan-get payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationPlanGetPayload['conversationId'],
  };
}

export function parseConversationPlanApprovePayload(
  value: unknown,
): ConversationPlanApprovePayload {
  const label = 'Invalid conversation-plan-approve payload';
  if (!isRecord(value) || typeof value.revision !== 'number') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationPlanApprovePayload['conversationId'],
    revision: value.revision,
  };
}

export function parseConversationPlanRevisePayload(value: unknown): ConversationPlanRevisePayload {
  const label = 'Invalid conversation-plan-revise payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationPlanRevisePayload['conversationId'],
    expectedRevision: value.expectedRevision as number,
    plan: requiredChatPlanSubmission(value.plan, label),
  };
}

export function parseConversationPlanCancelPayload(value: unknown): ConversationPlanCancelPayload {
  const label = 'Invalid conversation-plan-cancel payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationPlanCancelPayload['conversationId'],
  };
}

export function parseConversationAskAnswerPayload(value: unknown): ConversationAskAnswerPayload {
  const label = 'Invalid conversation-ask-answer payload';
  if (!isRecord(value)) throw new Error(label);
  const askId = requiredString(value.askId, label);
  if (!Array.isArray(value.answers) || value.answers.length === 0) throw new Error(label);
  const answers = (value.answers as unknown[]).map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.selected)) {
      throw new Error(label);
    }
    const selected = (raw.selected as unknown[]).filter(
      (item): item is string => typeof item === 'string',
    );
    return {
      id: raw.id,
      selected,
      ...(typeof raw.custom === 'string' ? { custom: raw.custom } : {}),
    };
  });
  return { askId, answers };
}

export function parseConversationAskCancelPayload(value: unknown): ConversationAskCancelPayload {
  const label = 'Invalid conversation-ask-cancel payload';
  if (!isRecord(value)) throw new Error(label);
  return { askId: requiredString(value.askId, label) };
}

export function parseConversationAskPendingPayload(value: unknown): ConversationAskPendingPayload {
  const label = 'Invalid conversation-ask-pending payload';
  if (!isRecord(value)) throw new Error(label);
  return { threadId: requiredString(value.threadId, label) };
}

function parseTaskRule(value: unknown, label: string): TaskRule {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error(label);
  switch (value.kind) {
    case 'at':
      if (typeof value.runAt !== 'string') throw new Error(label);
      return { kind: 'at', runAt: value.runAt };
    case 'every': {
      if (typeof value.intervalMinutes !== 'number' || value.intervalMinutes < 5) {
        throw new Error(label);
      }
      return {
        kind: 'every',
        intervalMinutes: Math.floor(value.intervalMinutes),
        ...(typeof value.firstRunAt === 'string' ? { firstRunAt: value.firstRunAt } : {}),
        ...(typeof value.windowStart === 'string' ? { windowStart: value.windowStart } : {}),
        ...(typeof value.windowEnd === 'string' ? { windowEnd: value.windowEnd } : {}),
      };
    }
    case 'random': {
      if (
        typeof value.windowStart !== 'string' ||
        typeof value.windowEnd !== 'string' ||
        typeof value.minTimes !== 'number' ||
        typeof value.maxTimes !== 'number'
      ) {
        throw new Error(label);
      }
      return {
        kind: 'random',
        windowStart: value.windowStart,
        windowEnd: value.windowEnd,
        minTimes: Math.max(1, Math.floor(value.minTimes)),
        maxTimes: Math.max(1, Math.floor(value.maxTimes)),
      };
    }
    case 'cron':
      if (typeof value.expression !== 'string') throw new Error(label);
      return { kind: 'cron', expression: value.expression };
    default:
      throw new Error(label);
  }
}

function parseTaskTarget(value: unknown, label: string): ScheduledTaskTarget {
  if (!isRecord(value)) throw new Error(label);
  if (value.kind === 'agent' && typeof value.agentId === 'string') {
    return { kind: 'agent', agentId: value.agentId };
  }
  if (value.kind === 'model' && typeof value.modelId === 'string') {
    return { kind: 'model', modelId: value.modelId };
  }
  if (value.kind === 'team' && typeof value.teamId === 'string') {
    return { kind: 'team', teamId: value.teamId };
  }
  throw new Error(label);
}

/** workspaceId: undefined = 不修改；null = 解绑为全局；string = 绑定工作区。 */
function parseOptionalWorkspaceId(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new Error(label);
}

/** skillVersionIds: undefined = 不修改；null = 清空；string[] = 注入列表。 */
function parseOptionalSkillVersionIds(value: unknown, label: string): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  throw new Error(label);
}

export function parseCreateScheduledTaskPayload(value: unknown): CreateScheduledTaskPayload {
  const label = 'Invalid scheduled-task-create payload';
  if (!isRecord(value)) throw new Error(label);
  const name = requiredString(value.name, label);
  const instruction = requiredString(value.instruction, label);
  const target = parseTaskTarget(value.target, label);
  const rule = parseTaskRule(value.rule, label);
  // 新建语义：缺省 workspaceId = 全局任务，缺省 skillVersionIds = 不注入（无需 null）。
  const workspaceId = typeof value.workspaceId === 'string' ? value.workspaceId : undefined;
  const skillVersionIds =
    Array.isArray(value.skillVersionIds) &&
    value.skillVersionIds.every((item) => typeof item === 'string')
      ? value.skillVersionIds
      : undefined;
  return {
    name,
    instruction,
    target,
    rule,
    ...(typeof value.timeZone === 'string' ? { timeZone: value.timeZone } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.nextRunAt === 'string' ? { nextRunAt: value.nextRunAt } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(skillVersionIds !== undefined ? { skillVersionIds } : {}),
  };
}

export function parseListScheduledTasksPayload(value: unknown): ListScheduledTasksPayload {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.includeDisabled === 'boolean'
      ? { includeDisabled: value.includeDisabled }
      : {}),
  };
}

export function parseUpdateScheduledTaskPayload(value: unknown): UpdateScheduledTaskPayload {
  const label = 'Invalid scheduled-task-update payload';
  if (!isRecord(value)) throw new Error(label);
  const taskId = requiredString(value.taskId, label);
  const patch = isRecord(value.patch) ? value.patch : {};
  const out: UpdateScheduledTaskPayload['patch'] = {};
  if (typeof patch.name === 'string') out.name = patch.name;
  if (typeof patch.instruction === 'string') out.instruction = patch.instruction;
  if (patch.target !== undefined) out.target = parseTaskTarget(patch.target, label);
  if (patch.rule !== undefined) out.rule = parseTaskRule(patch.rule, label);
  if (typeof patch.timeZone === 'string') out.timeZone = patch.timeZone;
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (patch.nextRunAt !== undefined) {
    if (patch.nextRunAt === null) out.nextRunAt = null;
    else if (typeof patch.nextRunAt === 'string') out.nextRunAt = patch.nextRunAt;
  }
  const workspaceId = parseOptionalWorkspaceId(patch.workspaceId, label);
  if (workspaceId !== undefined) out.workspaceId = workspaceId;
  const skillVersionIds = parseOptionalSkillVersionIds(patch.skillVersionIds, label);
  if (skillVersionIds !== undefined) out.skillVersionIds = skillVersionIds;
  return { taskId, patch: out };
}

export function parseDeleteScheduledTaskPayload(value: unknown): DeleteScheduledTaskPayload {
  const label = 'Invalid scheduled-task-delete payload';
  if (!isRecord(value)) throw new Error(label);
  return { taskId: requiredString(value.taskId, label) };
}

export function parseTriggerScheduledTaskPayload(value: unknown): TriggerScheduledTaskPayload {
  const label = 'Invalid scheduled-task-trigger payload';
  if (!isRecord(value)) throw new Error(label);
  return { taskId: requiredString(value.taskId, label) };
}

export function parseListScheduledTaskHistoryPayload(
  value: unknown,
): ListScheduledTaskHistoryPayload {
  const label = 'Invalid scheduled-task-history payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    taskId: requiredString(value.taskId, label),
    ...(typeof value.limit === 'number' && Number.isInteger(value.limit)
      ? { limit: value.limit }
      : {}),
  };
}

const ACTIVITY_RUN_STATES: readonly RunIndexState[] = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
];
const ACTIVITY_RUN_SOURCES: readonly RunIndexSource[] = [
  'chat',
  'scheduled',
  'external',
  'orchestration',
];
const ACTIVITY_EXTERNAL_EVENT_STATES: readonly ExternalEventState[] = [
  'pending',
  'leased',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Enum members are filtered against the vocabulary rather than forwarded, so a
 * renderer bug cannot push an unknown value into a Runtime SQL filter.
 */
function parseEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const picked = value.filter(
    (entry): entry is T =>
      typeof entry === 'string' && (allowed as readonly string[]).includes(entry),
  );
  return picked.length > 0 ? picked : undefined;
}

export function parseActivityListRunsPayload(value: unknown): ActivityListRunsPayload {
  if (!isRecord(value)) return {};
  const states = parseEnumList(value.states, ACTIVITY_RUN_STATES);
  const sources = parseEnumList(value.sources, ACTIVITY_RUN_SOURCES);
  return {
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
    ...(states ? { states } : {}),
    ...(sources ? { sources } : {}),
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === 'number' && Number.isInteger(value.limit)
      ? { limit: value.limit }
      : {}),
  };
}

export function parseActivityListExternalEventsPayload(
  value: unknown,
): ActivityListExternalEventsPayload {
  if (!isRecord(value)) return {};
  const states = parseEnumList(value.states, ACTIVITY_EXTERNAL_EVENT_STATES);
  return {
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(states ? { states } : {}),
    ...(typeof value.limit === 'number' && Number.isInteger(value.limit)
      ? { limit: value.limit }
      : {}),
  };
}

export function parseActivityRetryAnchorPayload(value: unknown): ActivityRetryAnchorPayload {
  const label = 'Invalid activity-retry-anchor payload';
  if (!isRecord(value)) throw new Error(label);
  return { runId: requiredString(value.runId, label) };
}

export function parseSkillLocalScanPayload(value: unknown): SkillLocalScanPayload {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.refresh === 'boolean' ? { refresh: value.refresh } : {}),
  };
}

export function parseSkillLocalInspectPayload(value: unknown): SkillLocalInspectPayload {
  const label = 'Invalid skill-local-inspect payload';
  if (!isRecord(value)) throw new Error(label);
  return { path: requiredString(value.path, label) };
}

export function parseSkillLocalImportPayload(value: unknown): SkillLocalImportPayload {
  const label = 'Invalid skill-local-import payload';
  if (!isRecord(value)) throw new Error(label);
  let scope: SkillLocalImportPayload['scope'];
  if (isRecord(value.scope)) {
    if (value.scope.type === 'global') {
      scope = { type: 'global' };
    } else if (value.scope.type === 'workspace') {
      scope = {
        type: 'workspace',
        workspaceId: requiredString(value.scope.workspaceId, label),
      };
    } else {
      throw new Error(label);
    }
  }
  return {
    path: requiredString(value.path, label),
    ...(scope ? { scope } : {}),
    ...(typeof value.overwrite === 'boolean' ? { overwrite: value.overwrite } : {}),
  };
}

export function parseInstallSkillMarketPayload(value: unknown): InstallSkillMarketPayload {
  const label = 'Invalid skill-market-install payload';
  if (!isRecord(value)) throw new Error(label);
  return { marketSkillId: requiredString(value.marketSkillId, label) };
}

export function parseConversationDecideToolApprovalPayload(
  value: unknown,
): ConversationDecideToolApprovalPayload {
  const label = 'Invalid conversation-decide-tool-approval payload';
  if (!isRecord(value)) throw new Error(label);
  const decision = requiredString(value.decision, label);
  if (decision !== 'approve' && decision !== 'deny') throw new Error(label);
  const scope = value.scope === undefined ? 'once' : requiredString(value.scope, label);
  if (scope !== 'once' && scope !== 'session' && scope !== 'always-app') throw new Error(label);
  if (decision === 'deny' && scope !== 'once') throw new Error(label);
  return {
    approvalId: requiredString(value.approvalId, label),
    decision,
    scope,
  };
}

export function parseConversationSubmitBrowserResultPayload(
  value: unknown,
): ConversationSubmitBrowserResultPayload {
  const label = 'Invalid conversation-submit-browser-result payload';
  if (!isRecord(value)) throw new Error(label);
  if (typeof value.ok !== 'boolean') throw new Error(label);
  const resultJson = optionalString(value.resultJson, label);
  const error = optionalString(value.error, label);
  // Renderer-produced page content — hard cap before it reaches the pipe.
  if (resultJson !== undefined && resultJson.length > 96_000) throw new Error(label);
  if (error !== undefined && error.length > 2_000) throw new Error(label);
  return {
    requestId: requiredString(value.requestId, label),
    ok: value.ok,
    resultJson,
    error,
  };
}

export function parseUpgradeConversationTrackPayload(
  value: unknown,
): UpgradeConversationTrackPayload {
  const label = 'Invalid upgrade-conversation-track payload';
  if (!isRecord(value)) throw new Error(label);
  const track = requiredString(value.track, label);
  if (track !== 'agent' && track !== 'team') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as UpgradeConversationTrackPayload['conversationId'],
    track,
    targetRef: requiredString(value.targetRef, label),
  };
}

export function parseRebindConversationTargetPayload(
  value: unknown,
): RebindConversationTargetPayload {
  const label = 'Invalid rebind-conversation-target payload';
  if (!isRecord(value)) throw new Error(label);
  const track = requiredString(value.track, label);
  if (track !== 'model' && track !== 'agent' && track !== 'team') throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as RebindConversationTargetPayload['conversationId'],
    track,
    targetRef: requiredString(value.targetRef, label),
  };
}

export function parseDeleteConversationPayload(value: unknown): DeleteConversationPayload {
  const label = 'Invalid delete-conversation payload';
  if (!isRecord(value)) throw new Error(label);
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as DeleteConversationPayload['conversationId'],
  };
}

export function parseConversationCompactPayload(value: unknown): ConversationCompactPayload {
  const label = 'Invalid conversation-compact payload';
  if (!isRecord(value)) throw new Error(label);
  const mode = value.mode === undefined ? undefined : requiredString(value.mode, label);
  if (mode !== undefined && mode !== 'manual' && mode !== 'auto') throw new Error(label);
  if (value.contextWindow !== undefined) {
    if (
      typeof value.contextWindow !== 'number' ||
      !Number.isFinite(value.contextWindow) ||
      value.contextWindow <= 0
    ) {
      throw new Error(label);
    }
  }
  if (value.usedTokens !== undefined) {
    if (
      typeof value.usedTokens !== 'number' ||
      !Number.isFinite(value.usedTokens) ||
      value.usedTokens < 0
    ) {
      throw new Error(label);
    }
  }
  if (value.keepRecent !== undefined) {
    if (
      typeof value.keepRecent !== 'number' ||
      !Number.isFinite(value.keepRecent) ||
      value.keepRecent < 1 ||
      value.keepRecent > 100
    ) {
      throw new Error(label);
    }
  }
  if (value.onlyIfNeeded !== undefined && typeof value.onlyIfNeeded !== 'boolean') {
    throw new Error(label);
  }
  return {
    conversationId: requiredString(
      value.conversationId,
      label,
    ) as ConversationCompactPayload['conversationId'],
    mode: mode as ConversationCompactPayload['mode'],
    contextWindow:
      typeof value.contextWindow === 'number' ? Math.round(value.contextWindow) : undefined,
    usedTokens: typeof value.usedTokens === 'number' ? Math.round(value.usedTokens) : undefined,
    keepRecent: typeof value.keepRecent === 'number' ? Math.round(value.keepRecent) : undefined,
    onlyIfNeeded: value.onlyIfNeeded as boolean | undefined,
  };
}
