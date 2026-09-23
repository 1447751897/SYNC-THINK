import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './conversation-types.js';
import {
  filterPendingUserMessagesForDisplay,
  mergeConversationMessagesForDisplay,
  orderDurableMessagesForDisplay,
} from './conversation-message-merge.js';

function message(id: string, role: ChatMessage['role'], sequence?: number): ChatMessage {
  return {
    id,
    role,
    text: id,
    timestamp: `2026-09-20T00:00:0${sequence ?? 0}.000Z`,
    ...(sequence === undefined ? {} : { sequence }),
  };
}

describe('conversation message merge', () => {
  it('orders ordinary durable rows by canonical sequence', () => {
    expect(orderDurableMessagesForDisplay([message('later', 'assistant', 3), message('first', 'user', 1)]).map((item) => item.id)).toEqual(['first', 'later']);
  });

  it('uses event time only when a legacy terminal backfill is present', () => {
    const first = { ...message('first', 'user', 10), timestamp: '2026-09-20T00:00:01.000Z' };
    const backfill = {
      ...message('backfill', 'assistant', 2),
      timestamp: '2026-09-20T00:00:02.000Z',
      legacyTerminalBackfill: true,
    };
    expect(orderDurableMessagesForDisplay([backfill, first]).map((item) => item.id)).toEqual([
      'first',
      'backfill',
    ]);
  });

  it('removes only optimistic rows whose durable identity has arrived', () => {
    const pending = [message('persisted', 'user'), message('still-pending', 'user')];
    expect(filterPendingUserMessagesForDisplay(pending, [message('persisted', 'user', 4)]).map((item) => item.id)).toEqual(['still-pending']);
  });

  it('places optimistic users before the streaming assistant after the durable tail', () => {
    expect(
      mergeConversationMessagesForDisplay({
        durableMessages: [message('answer-1', 'assistant', 2), message('prompt-1', 'user', 1)],
        pendingMessages: [message('prompt-2', 'user')],
        streamingMessage: message('answer-2', 'assistant'),
      }).map((item) => item.id),
    ).toEqual(['prompt-1', 'answer-1', 'prompt-2', 'answer-2']);
  });
});
