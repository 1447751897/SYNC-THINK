import {
  parseFileDiffReadOptions,
  type ConversationId,
  type FileDiffReadOptions,
  type FileDiffPage,
} from '@sync-think/shared';

export interface ConversationReadFileDiffPayload extends FileDiffReadOptions {
  conversationId: ConversationId;
}
export interface ConversationReadFileDiffResponse {
  diff: FileDiffPage;
}

export function parseConversationReadFileDiffPayload(
  value: unknown,
): ConversationReadFileDiffPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !Object.hasOwn(input, 'conversationId') ||
    typeof input.conversationId !== 'string' ||
    !input.conversationId.trim() ||
    input.conversationId.length > 128 ||
    input.conversationId.includes('\0')
  )
    return undefined;
  const { conversationId, ...remaining } = input;
  const options = parseFileDiffReadOptions(remaining);
  return options ? { ...options, conversationId: conversationId as ConversationId } : undefined;
}
