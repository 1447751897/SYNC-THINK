import type { ConversationTrack } from '@sync-think/shared';

/** Persisted application setting for model conversation orchestration. */
export const COLLABORATION_SETTINGS_KEY = 'collaboration.orchestration';

export interface CollaborationSettings {
  /** Master switch for dynamic delegation from model conversations. */
  dynamicSubagentsEnabled: boolean;
  /** Maximum model -> child -> ... nesting depth. Root is depth 0. */
  maxNestingDepth: number;
  /** Maximum children a single parent run may create. */
  maxChildrenPerParent: number;
  /** Maximum automatic delegations during one user turn. */
  maxAutoDelegationsPerTurn: number;
  /** Null means unlimited; otherwise a child task token budget. */
  taskTokenBudget: number | null;
  /** Agent conversations may create ordinary persisted tasks when enabled. */
  allowAgentTaskDispatch: boolean;
  /** Reserved for a later explicit peer-message protocol. */
  allowAgentPeerMessaging: boolean;
}

export const DEFAULT_COLLABORATION_SETTINGS: Readonly<CollaborationSettings> = {
  dynamicSubagentsEnabled: false,
  maxNestingDepth: 2,
  maxChildrenPerParent: 4,
  maxAutoDelegationsPerTurn: 3,
  taskTokenBudget: null,
  allowAgentTaskDispatch: false,
  allowAgentPeerMessaging: false,
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Parse persisted settings while keeping malformed/old values harmless. */
export function normalizeCollaborationSettings(value: unknown): CollaborationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_COLLABORATION_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  const budget =
    record.taskTokenBudget === null ||
    record.taskTokenBudget === undefined ||
    (typeof record.taskTokenBudget === 'number' && record.taskTokenBudget <= 0)
      ? null
      : boundedInteger(record.taskTokenBudget, 1, 1, 10_000_000);
  return {
    dynamicSubagentsEnabled:
      typeof record.dynamicSubagentsEnabled === 'boolean'
        ? record.dynamicSubagentsEnabled
        : DEFAULT_COLLABORATION_SETTINGS.dynamicSubagentsEnabled,
    maxNestingDepth: boundedInteger(
      record.maxNestingDepth,
      DEFAULT_COLLABORATION_SETTINGS.maxNestingDepth,
      0,
      8,
    ),
    maxChildrenPerParent: boundedInteger(
      record.maxChildrenPerParent,
      DEFAULT_COLLABORATION_SETTINGS.maxChildrenPerParent,
      0,
      32,
    ),
    maxAutoDelegationsPerTurn: boundedInteger(
      record.maxAutoDelegationsPerTurn,
      DEFAULT_COLLABORATION_SETTINGS.maxAutoDelegationsPerTurn,
      0,
      32,
    ),
    taskTokenBudget: budget,
    allowAgentTaskDispatch:
      typeof record.allowAgentTaskDispatch === 'boolean'
        ? record.allowAgentTaskDispatch
        : DEFAULT_COLLABORATION_SETTINGS.allowAgentTaskDispatch,
    allowAgentPeerMessaging:
      typeof record.allowAgentPeerMessaging === 'boolean'
        ? record.allowAgentPeerMessaging
        : DEFAULT_COLLABORATION_SETTINGS.allowAgentPeerMessaging,
  };
}

export interface ConversationCapabilities {
  canCreateDynamicSubagent: boolean;
  canDispatchOrdinaryTasks: boolean;
  canUseTeamRoster: boolean;
  canMessagePeerAgents: boolean;
}

export interface DelegationBudgetState {
  /** Root model run is depth 0. */
  depth: number;
  /** Children already created directly by this parent. */
  childCount: number;
  /** Automatic delegations already used in this user turn. */
  autoDelegationsThisTurn: number;
}

export interface DelegationDecision {
  allowed: boolean;
  reason?: 'track' | 'disabled' | 'depth' | 'children' | 'turn-limit';
  /** Effective child budget; null means unlimited. */
  taskTokenBudget: number | null;
}

export function evaluateDynamicDelegation(input: {
  track: ConversationTrack;
  settings?: CollaborationSettings;
  state: DelegationBudgetState;
  requestedTokenBudget?: number | null;
}): DelegationDecision {
  const settings = input.settings ?? DEFAULT_COLLABORATION_SETTINGS;
  const capabilities = capabilitiesForConversationTrack(input.track, settings);
  const budget =
    settings.taskTokenBudget === null
      ? input.requestedTokenBudget === undefined || input.requestedTokenBudget === null
        ? null
        : Math.max(1, Math.trunc(input.requestedTokenBudget))
      : input.requestedTokenBudget === undefined || input.requestedTokenBudget === null
        ? settings.taskTokenBudget
        : Math.min(settings.taskTokenBudget, Math.max(1, Math.trunc(input.requestedTokenBudget)));
  if (!capabilities.canCreateDynamicSubagent) {
    return {
      allowed: false,
      reason: input.track === 'model' ? 'disabled' : 'track',
      taskTokenBudget: budget,
    };
  }
  if (input.state.depth >= settings.maxNestingDepth) {
    return { allowed: false, reason: 'depth', taskTokenBudget: budget };
  }
  if (input.state.childCount >= settings.maxChildrenPerParent) {
    return { allowed: false, reason: 'children', taskTokenBudget: budget };
  }
  if (input.state.autoDelegationsThisTurn >= settings.maxAutoDelegationsPerTurn) {
    return { allowed: false, reason: 'turn-limit', taskTokenBudget: budget };
  }
  return { allowed: true, taskTokenBudget: budget };
}

/** Runtime authority for the three conversation tracks. */
export function capabilitiesForConversationTrack(
  track: ConversationTrack,
  settings: CollaborationSettings = DEFAULT_COLLABORATION_SETTINGS,
): ConversationCapabilities {
  if (track === 'model') {
    return {
      canCreateDynamicSubagent: settings.dynamicSubagentsEnabled,
      canDispatchOrdinaryTasks: true,
      canUseTeamRoster: false,
      canMessagePeerAgents: false,
    };
  }
  if (track === 'agent') {
    return {
      canCreateDynamicSubagent: false,
      canDispatchOrdinaryTasks: settings.allowAgentTaskDispatch,
      canUseTeamRoster: false,
      canMessagePeerAgents: settings.allowAgentPeerMessaging,
    };
  }
  return {
    canCreateDynamicSubagent: false,
    canDispatchOrdinaryTasks: false,
    canUseTeamRoster: true,
    canMessagePeerAgents: false,
  };
}
