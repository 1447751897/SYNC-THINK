import type {
  ConversationId,
  TaskPlanHistoryRun,
  TaskPlanHistorySelection,
} from '@sync-think/shared';

export interface TaskPlanHistoryReadOptions {
  beforeSequence?: number;
  beforeRunId?: string;
  runId?: string;
  offset: number;
  version?: string;
}

export interface TaskPlanHistoryPayload extends TaskPlanHistoryReadOptions {
  conversationId: ConversationId;
}

export interface TaskPlanHistoryPage {
  runs: TaskPlanHistoryRun[];
  nextBeforeSequence?: number;
  nextBeforeRunId?: string;
  selected?: TaskPlanHistorySelection & { offset: number; nextOffset?: number; version: string };
}

export function parseTaskPlanHistoryPayload(value: unknown): TaskPlanHistoryPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const validId = (entry: unknown): entry is string =>
    typeof entry === 'string' &&
    entry.trim().length > 0 &&
    entry.length <= 128 &&
    !entry.includes('\0');
  if (
    !Object.hasOwn(input, 'conversationId') ||
    !validId(input.conversationId) ||
    Object.keys(input).some(
      (key) =>
        !['conversationId', 'beforeSequence', 'beforeRunId', 'runId', 'offset', 'version'].includes(
          key,
        ),
    )
  )
    return undefined;
  if (input.runId !== undefined && !validId(input.runId)) return undefined;
  if (
    input.beforeRunId !== undefined &&
    (input.beforeSequence === undefined || !validId(input.beforeRunId))
  )
    return undefined;
  if (
    input.beforeSequence !== undefined &&
    (!Number.isSafeInteger(input.beforeSequence) || Number(input.beforeSequence) < 1)
  )
    return undefined;
  const offset = input.offset === undefined ? 0 : input.offset;
  if (
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    (Number(offset) > 0 && (input.runId === undefined || input.version === undefined))
  )
    return undefined;
  if (
    input.version !== undefined &&
    (input.runId === undefined ||
      typeof input.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.version))
  )
    return undefined;
  return {
    conversationId: input.conversationId as ConversationId,
    offset: Number(offset),
    ...(input.runId === undefined ? {} : { runId: input.runId as string }),
    ...(input.beforeRunId === undefined ? {} : { beforeRunId: input.beforeRunId as string }),
    ...(input.beforeSequence === undefined
      ? {}
      : { beforeSequence: input.beforeSequence as number }),
    ...(input.version === undefined ? {} : { version: input.version as string }),
  };
}
