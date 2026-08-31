import type {
  GoalClearPayload,
  GoalGetPayload,
  GoalPausePayload,
  GoalResumePayload,
  GoalSetPayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const GOAL_CONDITION_MAX_LENGTH = 4_000;

function parseConversationId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.conversationId !== 'string' ||
    value.conversationId.trim().length === 0 ||
    value.conversationId.length > 256
  ) {
    return undefined;
  }
  return value.conversationId.trim();
}

export function parseGoalSetPayload(value: unknown): GoalSetPayload | undefined {
  const conversationId = parseConversationId(value);
  if (!conversationId) return undefined;
  if (!isRecord(value)) return undefined;
  const condition = typeof value.condition === 'string' ? value.condition.trim() : '';
  if (condition.length === 0 || condition.length > GOAL_CONDITION_MAX_LENGTH) {
    return undefined;
  }
  if (value.stopCondition !== undefined && typeof value.stopCondition !== 'string') {
    return undefined;
  }
  const stopConditionText =
    typeof value.stopCondition === 'string' ? value.stopCondition.trim() : '';
  if (stopConditionText.length > GOAL_CONDITION_MAX_LENGTH) return undefined;
  const stopCondition = stopConditionText || undefined;
  if (
    value.maxGoalRounds !== undefined &&
    (typeof value.maxGoalRounds !== 'number' ||
      !Number.isSafeInteger(value.maxGoalRounds) ||
      value.maxGoalRounds < 1 ||
      value.maxGoalRounds > 50)
  ) {
    return undefined;
  }
  const maxGoalRounds =
    typeof value.maxGoalRounds === 'number' ? value.maxGoalRounds : undefined;
  if (
    value.maxGoalTokens !== undefined &&
    (typeof value.maxGoalTokens !== 'number' ||
      !Number.isSafeInteger(value.maxGoalTokens) ||
      value.maxGoalTokens < 10_000)
  ) {
    return undefined;
  }
  const maxGoalTokens =
    typeof value.maxGoalTokens === 'number' ? value.maxGoalTokens : undefined;
  const modelId =
    typeof value.modelId === 'string' && value.modelId.trim() && value.modelId.length <= 256
      ? value.modelId.trim()
      : undefined;
  const kernelId =
    typeof value.kernelId === 'string' && value.kernelId.trim() && value.kernelId.length <= 128
      ? value.kernelId.trim()
      : undefined;
  const reasoningEffort =
    typeof value.reasoningEffort === 'string' &&
    value.reasoningEffort.trim() &&
    value.reasoningEffort.length <= 64
      ? value.reasoningEffort.trim()
      : undefined;
  return {
    conversationId,
    condition,
    ...(stopCondition === undefined ? {} : { stopCondition }),
    ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
    ...(maxGoalTokens === undefined ? {} : { maxGoalTokens }),
    ...(modelId === undefined ? {} : { modelId: modelId as GoalSetPayload['modelId'] }),
    ...(kernelId === undefined ? {} : { kernelId: kernelId as GoalSetPayload['kernelId'] }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(typeof value.networkEnabled === 'boolean' ? { networkEnabled: value.networkEnabled } : {}),
  };
}

export function parseGoalGetPayload(value: unknown): GoalGetPayload | undefined {
  const conversationId = parseConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

export function parseGoalClearPayload(value: unknown): GoalClearPayload | undefined {
  const conversationId = parseConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

export function parseGoalPausePayload(value: unknown): GoalPausePayload | undefined {
  const conversationId = parseConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

export function parseGoalResumePayload(value: unknown): GoalResumePayload | undefined {
  const conversationId = parseConversationId(value);
  if (!conversationId || !isRecord(value)) return undefined;
  const modelId =
    typeof value.modelId === 'string' && value.modelId.trim() && value.modelId.length <= 256
      ? value.modelId.trim()
      : undefined;
  const kernelId =
    typeof value.kernelId === 'string' && value.kernelId.trim() && value.kernelId.length <= 128
      ? value.kernelId.trim()
      : undefined;
  const reasoningEffort =
    typeof value.reasoningEffort === 'string' &&
    value.reasoningEffort.trim() &&
    value.reasoningEffort.length <= 64
      ? value.reasoningEffort.trim()
      : undefined;
  return {
    conversationId,
    ...(modelId === undefined ? {} : { modelId: modelId as GoalResumePayload['modelId'] }),
    ...(kernelId === undefined ? {} : { kernelId: kernelId as GoalResumePayload['kernelId'] }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(typeof value.networkEnabled === 'boolean' ? { networkEnabled: value.networkEnabled } : {}),
  };
}
