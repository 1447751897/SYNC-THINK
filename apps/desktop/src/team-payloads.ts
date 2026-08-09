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
  const base = isRecord(value) && value.name !== undefined
    ? { name: requiredString(value.name, label) }
    : {};
  return {
    agentId: requiredString(value.agentId, label) as UpdateGlobalAgentPayload['agentId'],
    ...base,
    defaultModelId:
      value.defaultModelId === undefined
        ? undefined
        : (requiredString(value.defaultModelId, label) as UpdateGlobalAgentPayload['defaultModelId']),
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
        : (requiredString(value.coordinatorAgentId, label) as CreateTeamPayload['coordinatorAgentId']),
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
        : (requiredString(value.coordinatorAgentId, label) as UpdateTeamPayload['coordinatorAgentId']),
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
  const allowed = new Set(['conversationId', 'modelId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(label);
  const conversationId = requiredString(value.conversationId, label);
  if (conversationId.length > 128) throw new Error(label);
  const modelId =
    value.modelId === undefined ? undefined : requiredString(value.modelId, label);
  if (modelId !== undefined && modelId.length > 256) throw new Error(label);
  return {
    conversationId: conversationId as ConversationGetContextStatusPayload['conversationId'],
    ...(modelId ? { modelId } : {}),
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
    (!Number.isSafeInteger(value.afterStreamSequence) ||
      (value.afterStreamSequence as number) < 0)
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

export function parseUnsubscribeConversationTransientStreamPayload(
  value: unknown,
): { subscriptionId: string } {
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

export function parseSetConversationArchivedPayload(value: unknown): SetConversationArchivedPayload {
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

export function parseConversationDecideToolApprovalPayload(
  value: unknown,
): ConversationDecideToolApprovalPayload {
  const label = 'Invalid conversation-decide-tool-approval payload';
  if (!isRecord(value)) throw new Error(label);
  const decision = requiredString(value.decision, label);
  if (decision !== 'approve' && decision !== 'deny') throw new Error(label);
  return {
    approvalId: requiredString(value.approvalId, label),
    decision,
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
