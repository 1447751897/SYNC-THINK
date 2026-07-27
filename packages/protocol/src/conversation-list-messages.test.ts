import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame } from './framing.js';
import { req, type ConversationListMessagesResponse } from './commands.js';
import { DEFAULT_FEATURES } from './version.js';

describe('conversation.listMessages protocol', () => {
  it('registers the command and builds its typed request', () => {
    expect(DEFAULT_FEATURES).toContain('conversation.listMessages');
    expect(
      req(
        'conversation.listMessages',
        { conversationId: 'conv-1', beforeSequence: 50, limit: 25 },
        'request-1',
      ),
    ).toEqual({
      type: 'conversation.listMessages',
      payload: { conversationId: 'conv-1', beforeSequence: 50, limit: 25 },
      requestId: 'request-1',
    });
  });

  it('round-trips serializable shared message wire data', () => {
    const payload: ConversationListMessagesResponse = {
      messages: [
        {
          id: 'message-1' as never,
          threadId: 'thread-1' as never,
          role: 'assistant',
          sequence: 7,
          blocks: [
            { type: 'text', text: 'done' },
            { type: 'image', payload: { storageRef: 'conversation-images/example.png' } },
          ],
          createdAt: '2026-07-27T00:00:00.000Z',
        },
      ],
      hasMore: true,
      nextCursor: 7,
    };
    const encoded = encodeFrame({
      id: 'response-1',
      kind: 'response',
      type: 'conversation.listMessages',
      payload,
    });
    expect(decodeFrames(encoded).frames[0]?.payload).toEqual(payload);
  });
});
