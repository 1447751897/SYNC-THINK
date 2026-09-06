import type { ConversationId, RunId } from '@sync-think/shared';
import type { FileChangeItem } from './commands.js';
import { parseRunProcessPageRequest } from './run-process-page.js';

export interface ConversationListFileChangesPayload {
  conversationId: ConversationId;
  offset: number;
  limit?: number;
  version?: string;
}

export type ConversationFileChangesOptions = Omit<
  ConversationListFileChangesPayload,
  'conversationId'
>;

export interface ConversationFileChangeItem extends FileChangeItem {
  runId: RunId;
  sequence: number;
}

export interface ConversationFileChangesPage {
  items: ConversationFileChangeItem[];
  offset: number;
  total: number;
  nextOffset?: number;
  version: string;
}

export function parseConversationListFileChangesPayload(
  value: unknown,
): ConversationListFileChangesPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !Object.hasOwn(input, 'conversationId') ||
    !Object.hasOwn(input, 'offset') ||
    typeof input.conversationId !== 'string' ||
    !input.conversationId.trim() ||
    input.conversationId.length > 128 ||
    input.conversationId.includes('\0') ||
    Object.keys(input).some(
      (key) => !['conversationId', 'offset', 'limit', 'version'].includes(key),
    )
  )
    return undefined;
  const page = parseRunProcessPageRequest({
    section: 'fileChanges',
    offset: input.offset,
    limit: input.limit,
    version: input.version,
  });
  if (!page) return undefined;
  return {
    conversationId: input.conversationId as ConversationId,
    offset: page.offset,
    ...(page.limit === undefined ? {} : { limit: page.limit }),
    ...(page.version === undefined ? {} : { version: page.version }),
  };
}
