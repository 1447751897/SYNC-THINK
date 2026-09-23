import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame } from './framing.js';
import { req, type ListConversationsResponse } from './commands.js';

describe('conversation.list protocol', () => {
  it('builds a typed paged catalog request', () => {
    expect(
      req(
        'conversation.list',
        { includeArchived: true, cursor: 'cursor-1', limit: 100 },
        'request-1',
      ),
    ).toEqual({
      type: 'conversation.list',
      payload: { includeArchived: true, cursor: 'cursor-1', limit: 100 },
      requestId: 'request-1',
    });
  });

  it('round-trips the optional next cursor', () => {
    const payload: ListConversationsResponse = {
      conversations: [],
      nextCursor: 'cursor-2',
    };
    const encoded = encodeFrame({
      id: 'response-1',
      kind: 'response',
      type: 'conversation.list',
      payload,
    });
    expect(decodeFrames(encoded).frames[0]?.payload).toEqual(payload);
  });
});
