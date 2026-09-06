import { describe, expect, it } from 'vitest';
import {
  parseConversationListMessagesPayload,
  parseConversationListNavigationPayload,
} from './team-payloads.js';

describe('desktop navigation IPC payloads', () => {
  it('forwards only validated conversation-scoped cursors', () => {
    expect(
      parseConversationListMessagesPayload({
        conversationId: 'chat',
        aroundMessageId: 'message',
        limit: 1,
      }),
    ).toMatchObject({ aroundMessageId: 'message' });
    expect(
      parseConversationListNavigationPayload({
        conversationId: 'chat',
        beforeSequence: 0,
        limit: 500,
      }),
    ).toMatchObject({ beforeSequence: 0, limit: 500 });
  });
  it.each([
    { aroundMessageId: '' },
    { aroundMessageId: 'x'.repeat(129) },
    { aroundMessageId: 'message', beforeSequence: 2 },
    { aroundMessageId: 12 },
  ])('rejects an invalid anchor: %j', (values) =>
    expect(() =>
      parseConversationListMessagesPayload({ conversationId: 'chat', ...values }),
    ).toThrow(),
  );
  it.each([
    { limit: 501 },
    { limit: 0 },
    { beforeSequence: -1 },
    { beforeSequence: 1.5 },
    { unexpected: true },
  ])('rejects an invalid directory cursor: %j', (values) =>
    expect(() =>
      parseConversationListNavigationPayload({ conversationId: 'chat', ...values }),
    ).toThrow(),
  );
});
