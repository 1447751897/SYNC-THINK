// team-conversation command payload parsers (extracted from command-validation.ts).
import {
  normalizeSelectedSkillVersionIds,
  type AppendMessagePayload,
  type CreateTeamPayload,
  type UpdateTeamPayload,
  type DeleteTeamPayload,
  type StartTeamRunPayload,
  type SetTeamRunStatusPayload,
  type ListConversationsPayload,
  type ConversationListMessagesPayload,
  type ConversationGetRunProcessPayload,
  type CreateConversationPayload,
  type RenameConversationPayload,
  type SetConversationPinnedPayload,
  type SetConversationArchivedPayload,
  type SetConversationExecutionModePayload,
  type SetConversationInteractionModePayload,
  type SetConversationContextWindowOverridePayload,
  type ConversationPlanSubmitPayload,
  type ConversationPlanGetPayload,
  type ConversationPlanApprovePayload,
  type ConversationPlanRevisePayload,
  type ConversationPlanCancelPayload,
  type ConversationAskAnswerPayload,
  type ConversationAskCancelPayload,
  type ConversationAskPendingPayload,
  type AskQuestion,
  type UpgradeConversationTrackPayload,
  type DeleteConversationPayload,
  type ConversationCompactPayload,
  type ConversationSubmitBrowserResultPayload,
} from '@sync-think/protocol';
import {
  MESSAGE_ROLES,
  hasOnlyKeys,
  isRecord,
  boundedAgentText,
  CONVERSATION_TRACKS,
  CONVERSATION_UPGRADE_TRACKS,
  TEAM_RUN_STATUSES,
  TEAM_KEYS,
  validTeamFields,
} from './shared.js';
import type { ChatPlanSubmission } from '@sync-think/shared';

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
    'kernelId',
  ]) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return undefined;
  }
  if (
    value.kernelId !== undefined &&
    (typeof value.kernelId !== 'string' ||
      value.kernelId.length === 0 ||
      value.kernelId.length > 64)
  ) {
    return undefined;
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
  if (value.planExecuting !== undefined && typeof value.planExecuting !== 'boolean') {
    return undefined;
  }
  if (value.helpMode !== undefined && typeof value.helpMode !== 'boolean') {
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
      if (image.stagingPath !== undefined && typeof image.stagingPath !== 'string')
        return undefined;
    }
  }
  let skillVersionIds: string[] | undefined;
  try {
    skillVersionIds = normalizeSelectedSkillVersionIds(value.skillVersionIds);
  } catch {
    return undefined;
  }
  return {
    ...value,
    ...(skillVersionIds === undefined ? {} : { skillVersionIds }),
  } as unknown as AppendMessagePayload;
}

/** 校验 ask_user_question 工具输入：questions 数组（id/question 必填）。 */
export function parseAskUserQuestionInput(
  value: unknown,
): { questions: AskQuestion[] } | undefined {
  if (!isRecord(value) || !Array.isArray(value.questions) || value.questions.length === 0) {
    return undefined;
  }
  const questions: AskQuestion[] = [];
  for (const raw of value.questions) {
    if (!isRecord(raw)) return undefined;
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 128) {
      return undefined;
    }
    if (
      typeof raw.question !== 'string' ||
      raw.question.length === 0 ||
      raw.question.length > 4_000
    ) {
      return undefined;
    }
    if (raw.header !== undefined && (typeof raw.header !== 'string' || raw.header.length > 200)) {
      return undefined;
    }
    if (
      raw.detail !== undefined &&
      (typeof raw.detail !== 'string' || raw.detail.length > 40_000)
    ) {
      return undefined;
    }
    if (raw.multi_select !== undefined && typeof raw.multi_select !== 'boolean') {
      return undefined;
    }
    let intent: AskQuestion['intent'];
    if (raw.intent !== undefined) {
      if (!isRecord(raw.intent)) return undefined;
      if (raw.intent.kind !== undefined && typeof raw.intent.kind !== 'string') return undefined;
      if (raw.intent.approve !== undefined && typeof raw.intent.approve !== 'string')
        return undefined;
      intent = {
        ...(typeof raw.intent.kind === 'string' ? { kind: raw.intent.kind } : {}),
        ...(typeof raw.intent.approve === 'string' ? { approve: raw.intent.approve } : {}),
      };
    }
    const options: AskQuestion['options'] = [];
    if (raw.options !== undefined) {
      if (!Array.isArray(raw.options) || raw.options.length > 12) return undefined;
      for (const option of raw.options) {
        if (
          !isRecord(option) ||
          typeof option.label !== 'string' ||
          option.label.length === 0 ||
          option.label.length > 200
        ) {
          return undefined;
        }
        if (
          option.description !== undefined &&
          (typeof option.description !== 'string' || option.description.length > 1_000)
        ) {
          return undefined;
        }
        options.push({
          label: option.label,
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        });
      }
    }
    questions.push({
      id: raw.id,
      question: raw.question,
      ...(typeof raw.header === 'string' ? { header: raw.header } : {}),
      ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
      ...(intent ? { intent } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(raw.multi_select === true ? { multiSelect: true } : {}),
    });
  }
  return { questions };
}

export function parseConversationAskAnswerPayload(
  value: unknown,
): ConversationAskAnswerPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.askId !== 'string' ||
    value.askId.length === 0 ||
    value.askId.length > 128
  ) {
    return undefined;
  }
  if (!Array.isArray(value.answers) || value.answers.length === 0 || value.answers.length > 12) {
    return undefined;
  }
  const answers: ConversationAskAnswerPayload['answers'] = [];
  for (const raw of value.answers) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      raw.id.length > 128
    ) {
      return undefined;
    }
    if (!Array.isArray(raw.selected) || raw.selected.length > 12) return undefined;
    for (const label of raw.selected) {
      if (typeof label !== 'string' || label.length > 200) return undefined;
    }
    if (raw.custom !== undefined && (typeof raw.custom !== 'string' || raw.custom.length > 4_000)) {
      return undefined;
    }
    answers.push({
      id: raw.id,
      selected: [...raw.selected],
      ...(typeof raw.custom === 'string' ? { custom: raw.custom } : {}),
    });
  }
  return { askId: value.askId, answers };
}

export function parseConversationAskCancelPayload(
  value: unknown,
): ConversationAskCancelPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.askId !== 'string' ||
    value.askId.length === 0 ||
    value.askId.length > 128
  ) {
    return undefined;
  }
  return { askId: value.askId };
}

export function parseConversationAskPendingPayload(
  value: unknown,
): ConversationAskPendingPayload | undefined {
  if (!isRecord(value) || typeof value.threadId !== 'string' || value.threadId.length === 0) {
    return undefined;
  }
  return { threadId: value.threadId };
}

export function parseListTeamsPayload(value: unknown): Record<string, never> | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length !== 0) return undefined;
  return {};
}

export function parseCreateTeamPayload(value: unknown): CreateTeamPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, TEAM_KEYS) || !validTeamFields(value, { full: true }))
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

export function parseSetTeamRunStatusPayload(value: unknown): SetTeamRunStatusPayload | undefined {
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
  if (!isRecord(value) || !hasOnlyKeys(value, ['runId']) || !boundedAgentText(value.runId, 128)) {
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

const INTERACTION_MODES = new Set(['plan', 'execute']);

export function parseSetConversationInteractionModePayload(
  value: unknown,
): SetConversationInteractionModePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'interactionMode']) ||
    !boundedAgentText(value.conversationId, 128) ||
    typeof value.interactionMode !== 'string' ||
    !INTERACTION_MODES.has(value.interactionMode)
  )
    return undefined;
  return {
    conversationId: value.conversationId as SetConversationInteractionModePayload['conversationId'],
    interactionMode:
      value.interactionMode as SetConversationInteractionModePayload['interactionMode'],
  };
}

export function parseSetConversationContextWindowOverridePayload(
  value: unknown,
): SetConversationContextWindowOverridePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'contextWindowOverride']) ||
    !boundedAgentText(value.conversationId, 128)
  ) {
    return undefined;
  }
  if (value.contextWindowOverride !== null) {
    if (
      !Number.isSafeInteger(value.contextWindowOverride) ||
      (value.contextWindowOverride as number) < 1_024 ||
      (value.contextWindowOverride as number) > 10_000_000
    ) {
      return undefined;
    }
  }
  return {
    conversationId:
      value.conversationId as SetConversationContextWindowOverridePayload['conversationId'],
    contextWindowOverride: value.contextWindowOverride as number | null,
  };
}

// ── Conversation plan (chat planning mode) ────────────────────────────────

function isChatPlanStep(value: unknown): value is ChatPlanSubmission['steps'][number] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return false;
  if (typeof value.title !== 'string' || value.title.length > 500) return false;
  if (typeof value.description !== 'string' || value.description.length > 5000) return false;
  if (value.expectedFiles !== undefined && !Array.isArray(value.expectedFiles)) return false;
  if (value.expectedFiles !== undefined) {
    for (const f of value.expectedFiles) {
      if (typeof f !== 'string' || f.length > 1024) return false;
    }
  }
  if (!Array.isArray(value.acceptanceChecks)) return false;
  for (const c of value.acceptanceChecks) {
    if (typeof c !== 'string' || c.length > 2000) return false;
  }
  return true;
}

function isChatPlanRisk(value: unknown): value is ChatPlanSubmission['risks'][number] {
  if (!isRecord(value)) return false;
  if (typeof value.description !== 'string' || value.description.length > 2000) return false;
  if (typeof value.mitigation !== 'string' || value.mitigation.length > 2000) return false;
  return true;
}

function isChatPlanSubmission(value: unknown): value is ChatPlanSubmission {
  if (!isRecord(value)) return false;
  if (typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 200)
    return false;
  if (typeof value.goal !== 'string' || value.goal.length > 5000) return false;
  if (
    !Array.isArray(value.scope) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(value.decisions)
  )
    return false;
  if (!Array.isArray(value.steps) || value.steps.length === 0) return false;
  for (const s of value.steps) if (!isChatPlanStep(s)) return false;
  if (!Array.isArray(value.risks)) return false;
  for (const r of value.risks) if (!isChatPlanRisk(r)) return false;
  if (!Array.isArray(value.finalAcceptanceChecks)) return false;
  for (const c of value.finalAcceptanceChecks) {
    if (typeof c !== 'string' || c.length > 2000) return false;
  }
  return true;
}

export function parseConversationPlanSubmitPayload(
  value: unknown,
): ConversationPlanSubmitPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'plan']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !isChatPlanSubmission(value.plan)
  )
    return undefined;
  return {
    conversationId: value.conversationId as ConversationPlanSubmitPayload['conversationId'],
    plan: value.plan as ConversationPlanSubmitPayload['plan'],
  };
}

export function parseConversationPlanGetPayload(
  value: unknown,
): ConversationPlanGetPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId']) ||
    !boundedAgentText(value.conversationId, 128)
  )
    return undefined;
  return { conversationId: value.conversationId as ConversationPlanGetPayload['conversationId'] };
}

export function parseConversationPlanApprovePayload(
  value: unknown,
): ConversationPlanApprovePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'revision']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1
  )
    return undefined;
  return {
    conversationId: value.conversationId as ConversationPlanApprovePayload['conversationId'],
    revision: value.revision as number,
  };
}

export function parseConversationPlanRevisePayload(
  value: unknown,
): ConversationPlanRevisePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId', 'expectedRevision', 'plan']) ||
    !boundedAgentText(value.conversationId, 128) ||
    !Number.isInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1 ||
    !isChatPlanSubmission(value.plan)
  )
    return undefined;
  return {
    conversationId: value.conversationId as ConversationPlanRevisePayload['conversationId'],
    expectedRevision: value.expectedRevision as number,
    plan: value.plan as ConversationPlanRevisePayload['plan'],
  };
}

export function parseConversationPlanCancelPayload(
  value: unknown,
): ConversationPlanCancelPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['conversationId']) ||
    !boundedAgentText(value.conversationId, 128)
  )
    return undefined;
  return {
    conversationId: value.conversationId as ConversationPlanCancelPayload['conversationId'],
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
    usedTokens: typeof value.usedTokens === 'number' ? Math.round(value.usedTokens) : undefined,
    keepRecent: typeof value.keepRecent === 'number' ? Math.round(value.keepRecent) : undefined,
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
