import type { ChatMessage } from './conversation-types.js';

/** Preserve store order, except legacy terminal backfills that must rejoin their event-time slot. */
export function orderDurableMessagesForDisplay(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const ordered = [...messages];
  if (!ordered.some((message) => message.legacyTerminalBackfill)) {
    return ordered.sort(
      (left, right) =>
        (left.sequence ?? Number.MAX_SAFE_INTEGER) -
        (right.sequence ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return ordered.sort((left, right) => {
    const leftAt = Date.parse(left.timestamp);
    const rightAt = Date.parse(right.timestamp);
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER);
  });
}

/** Hide an optimistic bubble in the same render that its durable id arrives. */
export function filterPendingUserMessagesForDisplay(
  pendingMessages: readonly ChatMessage[],
  durableMessages: readonly ChatMessage[],
): ChatMessage[] {
  if (pendingMessages.length === 0 || durableMessages.length === 0) {
    return [...pendingMessages];
  }
  const durableIds = new Set(durableMessages.map((message) => message.id));
  return pendingMessages.filter((message) => !durableIds.has(message.id));
}

export function mergeConversationMessagesForDisplay(input: {
  durableMessages: readonly ChatMessage[];
  pendingMessages: readonly ChatMessage[];
  streamingMessage?: ChatMessage;
}): ChatMessage[] {
  const maxDurableSequence = input.durableMessages.reduce(
    (maximum, message) =>
      Number.isFinite(message.sequence)
        ? Math.max(maximum, message.sequence as number)
        : maximum,
    Number.MIN_SAFE_INTEGER,
  );
  let nextVirtualSequence =
    maxDurableSequence === Number.MIN_SAFE_INTEGER ? 0 : maxDurableSequence + 1;
  const stamped: Array<{ value: ChatMessage; sequence: number; tie: number }> = [];

  input.durableMessages.forEach((message, index) => {
    stamped.push({
      value: message,
      sequence: message.sequence ?? nextVirtualSequence,
      tie: index,
    });
  });
  input.pendingMessages.forEach((message, index) => {
    stamped.push({ value: message, sequence: nextVirtualSequence++, tie: 10_000 + index });
  });
  if (input.streamingMessage) {
    stamped.push({
      value: input.streamingMessage,
      sequence: nextVirtualSequence,
      tie: 20_000,
    });
  }

  stamped.sort((left, right) =>
    left.sequence !== right.sequence ? left.sequence - right.sequence : left.tie - right.tie,
  );
  return stamped.map((item) => item.value);
}
