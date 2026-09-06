import type { ConversationGetRunProcessPayload } from './commands.js';
export type RunProcessSection = 'steps' | 'fileChanges' | 'taskPlan';

export interface RunProcessPageRequest {
  section: RunProcessSection;
  offset: number;
  limit?: number;
  version?: string;
}

export interface RunProcessCollectionPage {
  offset: number;
  total: number;
  nextOffset?: number;
}

export interface RunProcessPages {
  version: string;
  steps: RunProcessCollectionPage;
  fileChanges: RunProcessCollectionPage;
  taskPlan: RunProcessCollectionPage;
}

export function parseRunProcessPageRequest(value: unknown): RunProcessPageRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !Object.hasOwn(input, 'section') ||
    !Object.hasOwn(input, 'offset') ||
    Object.keys(input).some((key) => !['section', 'offset', 'limit', 'version'].includes(key)) ||
    typeof input.section !== 'string' ||
    !['steps', 'fileChanges', 'taskPlan'].includes(input.section) ||
    !Number.isSafeInteger(input.offset) ||
    Number(input.offset) < 0 ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) ||
        Number(input.limit) < 1 ||
        Number(input.limit) > 40)) ||
    (input.version !== undefined &&
      (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)))
  )
    return undefined;
  return {
    section: input.section as RunProcessSection,
    offset: input.offset as number,
    ...(input.limit === undefined ? {} : { limit: input.limit as number }),
    ...(input.version === undefined ? {} : { version: input.version as string }),
  };
}

export function parseRunProcessPayload(
  value: unknown,
): ConversationGetRunProcessPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const identifier = (entry: unknown) =>
    typeof entry === 'string' &&
    entry.trim().length > 0 &&
    entry.length <= 128 &&
    !entry.includes('\0');
  if (
    !Object.hasOwn(input, 'runId') ||
    !identifier(input.runId) ||
    Object.keys(input).some((key) => !['runId', 'conversationId', 'page'].includes(key)) ||
    (input.conversationId !== undefined && !identifier(input.conversationId))
  )
    return undefined;
  const page = input.page === undefined ? undefined : parseRunProcessPageRequest(input.page);
  if (
    input.page !== undefined &&
    (!page || !Object.hasOwn(input, 'conversationId') || !identifier(input.conversationId))
  )
    return undefined;
  return {
    runId: input.runId as ConversationGetRunProcessPayload['runId'],
    ...(input.conversationId === undefined
      ? {}
      : {
          conversationId:
            input.conversationId as ConversationGetRunProcessPayload['conversationId'],
        }),
    ...(page ? { page } : {}),
  };
}
