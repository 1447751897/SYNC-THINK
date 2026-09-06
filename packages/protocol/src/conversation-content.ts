import {
  MAX_CONTENT_CHUNK_LENGTH,
  parseContentReference,
  type ContentChunk,
  type ContentReference,
  type ConversationId,
} from '@sync-think/shared';

export interface ConversationReadContentPayload {
  conversationId: ConversationId;
  reference: ContentReference;
  offset?: number;
  limit?: number;
  version?: string;
}

export interface ConversationReadContentResponse {
  content: ContentChunk;
}

export function parseConversationReadContentPayload(
  value: unknown,
): ConversationReadContentPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['conversationId', 'reference', 'offset', 'limit', 'version'].includes(key),
    ) ||
    !Object.hasOwn(input, 'conversationId') ||
    typeof input.conversationId !== 'string' ||
    !input.conversationId.trim() ||
    input.conversationId.length > 128 ||
    !Object.hasOwn(input, 'reference')
  )
    return undefined;
  const reference = parseContentReference(input.reference);
  if (
    !reference ||
    (input.offset !== undefined &&
      (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0)) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) ||
        (input.limit as number) < 256 ||
        (input.limit as number) > MAX_CONTENT_CHUNK_LENGTH)) ||
    (input.version !== undefined &&
      (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)))
  )
    return undefined;
  return {
    conversationId: input.conversationId as ConversationId,
    reference,
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(typeof input.version === 'string' ? { version: input.version } : {}),
  };
}
