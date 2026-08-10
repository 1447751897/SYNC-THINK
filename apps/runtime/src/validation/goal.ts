import type { GoalClearPayload, GoalGetPayload, GoalSetPayload } from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const GOAL_CONDITION_MAX_LENGTH = 4_000;

export function parseGoalSetPayload(value: unknown): GoalSetPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.conversationId !== 'string' ||
    value.conversationId.trim().length === 0 ||
    value.conversationId.length > 256
  ) {
    return undefined;
  }
  const condition = typeof value.condition === 'string' ? value.condition.trim() : '';
  if (condition.length === 0 || condition.length > GOAL_CONDITION_MAX_LENGTH) {
    return undefined;
  }
  return { conversationId: value.conversationId.trim(), condition };
}

export function parseGoalGetPayload(value: unknown): GoalGetPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.conversationId !== 'string' ||
    value.conversationId.trim().length === 0 ||
    value.conversationId.length > 256
  ) {
    return undefined;
  }
  return { conversationId: value.conversationId.trim() };
}

export function parseGoalClearPayload(value: unknown): GoalClearPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.conversationId !== 'string' ||
    value.conversationId.trim().length === 0 ||
    value.conversationId.length > 256
  ) {
    return undefined;
  }
  return { conversationId: value.conversationId.trim() };
}
