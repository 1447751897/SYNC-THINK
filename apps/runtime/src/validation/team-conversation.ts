// team-conversation command payload parsers (extracted from command-validation.ts).
import type { AppendMessagePayload, CreateTeamPayload, UpdateTeamPayload, DeleteTeamPayload, StartTeamRunPayload, SetTeamRunStatusPayload, ListConversationsPayload, ConversationListMessagesPayload, ConversationGetRunProcessPayload, CreateConversationPayload, RenameConversationPayload, SetConversationPinnedPayload, SetConversationArchivedPayload, SetConversationExecutionModePayload, UpgradeConversationTrackPayload, DeleteConversationPayload, ConversationCompactPayload, ConversationSubmitBrowserResultPayload } from '@sync-think/protocol';
import { MESSAGE_ROLES, hasOnlyKeys, isRecord, boundedAgentText, CONVERSATION_TRACKS, CONVERSATION_UPGRADE_TRACKS, TEAM_RUN_STATUSES, TEAM_KEYS, validTeamFields } from './shared.js';

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

export function parseConversationListMessagesPayload(
  value: unknown,
): ConversationListMessagesPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'beforeSequence', 'limit']) ||
    !boundedAgentText(value.conversationId, 128)
  ) {
    return undefined;
  }
  if (
    value.beforeSequence !== undefined &&
    (!Number.isSafeInteger(value.beforeSequence) || (value.beforeSequence as number) < 0)
  ) {
    return undefined;
  }
  if (
    value.limit !== undefined &&
    (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
  ) {
    return undefined;
  }
  return {
    conversationId: value.conversationId as ConversationListMessagesPayload['conversationId'],
    beforeSequence: value.beforeSequence as number | undefined,
    limit: value.limit as number | undefined,
  };
}

export function parseConversationGetRunProcessPayload(
  value: unknown,
): ConversationGetRunProcessPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['runId']) ||
    !boundedAgentText(value.runId, 128)
  ) {
    return undefined;
  }
  return { runId: value.runId as ConversationGetRunProcessPayload['runId'] };
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

export function parseConversationCompactPayload(
  value: unknown,
): ConversationCompactPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'conversationId',
      'mode',
      'contextWindow',
      'usedTokens',
      'keepRecent',
      'onlyIfNeeded',
    ]) ||
    !boundedAgentText(value.conversationId, 128)
  ) {
    return undefined;
  }
  if (value.mode !== undefined && value.mode !== 'manual' && value.mode !== 'auto') {
    return undefined;
  }
  if (value.contextWindow !== undefined) {
    if (
      typeof value.contextWindow !== 'number' ||
      !Number.isFinite(value.contextWindow) ||
      value.contextWindow <= 0
    ) {
      return undefined;
    }
  }
  if (value.usedTokens !== undefined) {
    if (
      typeof value.usedTokens !== 'number' ||
      !Number.isFinite(value.usedTokens) ||
      value.usedTokens < 0
    ) {
      return undefined;
    }
  }
  if (value.keepRecent !== undefined) {
    if (
      typeof value.keepRecent !== 'number' ||
      !Number.isFinite(value.keepRecent) ||
      value.keepRecent < 1 ||
      value.keepRecent > 100
    ) {
      return undefined;
    }
  }
  if (value.onlyIfNeeded !== undefined && typeof value.onlyIfNeeded !== 'boolean') {
    return undefined;
  }
  return {
    conversationId: value.conversationId as ConversationCompactPayload['conversationId'],
    mode: value.mode as ConversationCompactPayload['mode'],
    contextWindow:
      typeof value.contextWindow === 'number' ? Math.round(value.contextWindow) : undefined,
    usedTokens:
      typeof value.usedTokens === 'number' ? Math.round(value.usedTokens) : undefined,
    keepRecent:
      typeof value.keepRecent === 'number' ? Math.round(value.keepRecent) : undefined,
    onlyIfNeeded: value.onlyIfNeeded as boolean | undefined,
  };
}

export function parseConversationSubmitBrowserResultPayload(
  value: unknown,
): ConversationSubmitBrowserResultPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['requestId', 'ok', 'resultJson', 'error']) ||
    !boundedAgentText(value.requestId, 128) ||
    typeof value.ok !== 'boolean'
  ) {
    return undefined;
  }
  // resultJson is renderer-produced page content — cap at 64KB + JSON overhead
  // so a hostile page cannot blow up the pipe frame (1 MiB hard cap).
  if (value.resultJson !== undefined) {
    if (typeof value.resultJson !== 'string' || value.resultJson.length > 96_000) return undefined;
  }
  if (value.error !== undefined) {
    if (typeof value.error !== 'string' || value.error.length > 2_000) return undefined;
  }
  return {
    requestId: value.requestId,
    ok: value.ok,
    resultJson: value.resultJson as string | undefined,
    error: value.error as string | undefined,
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
