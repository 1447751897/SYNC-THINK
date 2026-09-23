import { describe, expect, it } from 'vitest';
import {
  parseListConversationsPayload,
  parseConversationListMessagesPayload,
  parseConversationListNavigationPayload,
} from './team-conversation.js';

describe('conversation history cursors', () => {
  it('accepts bounded conversation catalog pages', () => {
    expect(
      parseListConversationsPayload({
        workspaceId: 'workspace-a',
        includeArchived: true,
        cursor: 'cursor-a',
        limit: 200,
      }),
    ).toEqual({
      workspaceId: 'workspace-a',
      includeArchived: true,
      cursor: 'cursor-a',
      limit: 200,
    });
  });

  it.each([
    { cursor: '' },
    { cursor: 'x'.repeat(2_049) },
    { limit: 0 },
    { limit: 201 },
    { limit: 1.5 },
    { unexpected: true },
  ])('rejects an invalid conversation catalog page: %j', (values) => {
    expect(parseListConversationsPayload(values)).toBeUndefined();
  });

  it('accepts a scoped anchor and bounded directory cursors', () => {
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
  ])('rejects an invalid anchor: %j', (values) => {
    expect(
      parseConversationListMessagesPayload({ conversationId: 'chat', ...values }),
    ).toBeUndefined();
  });
  it.each([
    { limit: 501 },
    { limit: 0 },
    { beforeSequence: -1 },
    { beforeSequence: 1.5 },
    { unexpected: true },
  ])('rejects an invalid directory cursor: %j', (values) =>
    expect(
      parseConversationListNavigationPayload({ conversationId: 'chat', ...values }),
    ).toBeUndefined(),
  );
});
