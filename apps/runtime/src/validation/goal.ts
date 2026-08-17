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
  const maxGoalRounds =
    typeof value.maxGoalRounds === 'number' && Number.isInteger(value.maxGoalRounds) &&
    value.maxGoalRounds >= 1
      ? value.maxGoalRounds
      : undefined;
  return {
    conversationId,
    condition,
    ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
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
  return conversationId ? { conversationId } : undefined;
}
