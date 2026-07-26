import type { RebindConversationTargetPayload } from '@sync-think/protocol';

// conversation.rebindTarget payload is validated inline (same strict style as
// command-validation.ts parsers): exact keys, bounded non-empty strings,
// track limited to the three conversation tracks.
const CONVERSATION_REBIND_TRACKS = new Set(['model', 'agent', 'team']);

export function parseRebindConversationTargetPayload(
  value: unknown,
): RebindConversationTargetPayload | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(['conversationId', 'track', 'targetRef']);
  if (!Object.keys(record).every((key) => allowed.has(key))) return undefined;
  const bounded = (input: unknown, max: number): input is string =>
    typeof input === 'string' && input.trim().length > 0 && input.length <= max;
  if (
    !bounded(record.conversationId, 128) ||
    !CONVERSATION_REBIND_TRACKS.has(String(record.track)) ||
    !bounded(record.targetRef, 256)
  ) {
    return undefined;
  }
  return {
    conversationId: record.conversationId as RebindConversationTargetPayload['conversationId'],
    track: record.track as RebindConversationTargetPayload['track'],
    targetRef: record.targetRef,
  };
}
