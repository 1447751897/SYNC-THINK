import type {
  GoalClearPayload,
  GoalGetPayload,
  GoalPausePayload,
  GoalResumePayload,
  GoalSetPayload,
} from '@sync-think/protocol';

function recordPayload(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>;
}

function goalConversationId(value: unknown, label: string): string {
  const record = recordPayload(value, label);
  if (typeof record.conversationId !== 'string' || !record.conversationId.trim()) {
    throw new Error(label);
  }
  return record.conversationId.trim();
}

function optionalRouteId(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= maxLength
    ? value.trim()
    : undefined;
}

export function parseGoalSetPayload(value: unknown): GoalSetPayload {
  const label = 'Invalid goal-set payload';
  const conversationId = goalConversationId(value, label);
  const record = recordPayload(value, label);
  const condition = typeof record.condition === 'string' ? record.condition.trim() : '';
  if (!condition || condition.length > 4000) throw new Error(label);
  if (record.stopCondition !== undefined && typeof record.stopCondition !== 'string') {
    throw new Error(label);
  }
  const stopConditionText =
    typeof record.stopCondition === 'string' ? record.stopCondition.trim() : '';
  if (stopConditionText.length > 4000) throw new Error(label);
  if (
    record.maxGoalRounds !== undefined &&
    (typeof record.maxGoalRounds !== 'number' ||
      !Number.isSafeInteger(record.maxGoalRounds) ||
      record.maxGoalRounds < 1 ||
      record.maxGoalRounds > 50)
  ) {
    throw new Error(label);
  }
  if (
    record.maxGoalTokens !== undefined &&
    (typeof record.maxGoalTokens !== 'number' ||
      !Number.isSafeInteger(record.maxGoalTokens) ||
      record.maxGoalTokens < 10_000)
  ) {
    throw new Error(label);
  }
  const stopCondition = stopConditionText || undefined;
  const maxGoalRounds = typeof record.maxGoalRounds === 'number' ? record.maxGoalRounds : undefined;
  const maxGoalTokens = typeof record.maxGoalTokens === 'number' ? record.maxGoalTokens : undefined;
  const modelId = optionalRouteId(record.modelId, 256);
  const kernelId = optionalRouteId(record.kernelId, 128);
  const reasoningEffort = optionalRouteId(record.reasoningEffort, 64);
  return {
    conversationId,
    condition,
    ...(stopCondition === undefined ? {} : { stopCondition }),
    ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
    ...(maxGoalTokens === undefined ? {} : { maxGoalTokens }),
    ...(modelId === undefined ? {} : { modelId: modelId as GoalSetPayload['modelId'] }),
    ...(kernelId === undefined ? {} : { kernelId: kernelId as GoalSetPayload['kernelId'] }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(typeof record.networkEnabled === 'boolean'
      ? { networkEnabled: record.networkEnabled }
      : {}),
  };
}

export function parseGoalGetPayload(value: unknown): GoalGetPayload {
  return { conversationId: goalConversationId(value, 'Invalid goal-get payload') };
}

export function parseGoalClearPayload(value: unknown): GoalClearPayload {
  return { conversationId: goalConversationId(value, 'Invalid goal-clear payload') };
}

export function parseGoalPausePayload(value: unknown): GoalPausePayload {
  return { conversationId: goalConversationId(value, 'Invalid goal-pause payload') };
}

export function parseGoalResumePayload(value: unknown): GoalResumePayload {
  const label = 'Invalid goal-resume payload';
  const conversationId = goalConversationId(value, label);
  const record = recordPayload(value, label);
  const modelId = optionalRouteId(record.modelId, 256);
  const kernelId = optionalRouteId(record.kernelId, 128);
  const reasoningEffort = optionalRouteId(record.reasoningEffort, 64);
  return {
    conversationId,
    ...(modelId === undefined ? {} : { modelId: modelId as GoalResumePayload['modelId'] }),
    ...(kernelId === undefined ? {} : { kernelId: kernelId as GoalResumePayload['kernelId'] }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(typeof record.networkEnabled === 'boolean'
      ? { networkEnabled: record.networkEnabled }
      : {}),
  };
}
