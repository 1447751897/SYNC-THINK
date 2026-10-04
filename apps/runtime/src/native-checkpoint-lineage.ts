import type { ProviderMessage } from '@sync-think/adapters';
import type { Message } from '@sync-think/shared';
import {
  buildProviderMessagesFromDurableMessages,
  visibleDurableContextMessages,
} from './context-message-history.js';
import type { ConversationCompactBoundary } from './conversation-compact-boundary-cache.js';
export interface NativeCheckpointLineage {
  message: Message;
  providerEnd: number;
}
/** A canonical unit can expand into several provider messages. Never promote a cut in the middle of that unit. */
export function captureNativeCheckpointLineage(input: {
  messages: readonly ProviderMessage[];
  history: readonly Message[];
  compact?: ConversationCompactBoundary;
  currentUserText: string;
}): NativeCheckpointLineage[] {
  const lineage: NativeCheckpointLineage[] = [];
  let offset = 0;
  for (const message of visibleDurableContextMessages(input.history, input.compact)) {
    const unit = buildProviderMessagesFromDurableMessages({
      messages: [message],
      currentUserText: '',
    }).messages;
    if (!unit.length) continue;
    // The active raw user turn stays outside any conversation-level replacement, even during a long tool loop.
    if (
      message.role === 'user' &&
      unit.some((m) => typeof m.content === 'string' && m.content === input.currentUserText)
    )
      break;
    if (
      unit.some((m, index) => JSON.stringify(m) !== JSON.stringify(input.messages[offset + index]))
    )
      break;
    offset += unit.length;
    lineage.push({ message: structuredClone(message), providerEnd: offset });
  }
  return lineage;
}
export function selectNativeCheckpointMessages(
  lineage: readonly NativeCheckpointLineage[],
  count: number,
): Message[] | undefined {
  const end = lineage.findIndex((unit) => unit.providerEnd === count);
  return end < 0
    ? undefined
    : lineage.slice(0, end + 1).map((unit) => structuredClone(unit.message));
}
