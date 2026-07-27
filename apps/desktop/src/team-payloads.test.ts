import { describe, expect, it } from 'vitest';
import {
  parseConversationGetContextStatusPayload,
  parseConversationGetRunProcessPayload,
} from './team-payloads.js';

describe('parseConversationGetRunProcessPayload', () => {
  it('accepts one bounded non-empty run id', () => {
    expect(parseConversationGetRunProcessPayload({ runId: 'run-1' })).toEqual({ runId: 'run-1' });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { runId: '' },
    { runId: '   ' },
    { runId: 1 },
    { runId: 'run-1', extra: true },
    { runId: 'x'.repeat(129) },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseConversationGetRunProcessPayload(payload)).toThrow(
      'Invalid get-conversation-run-process payload',
    );
  });
});


describe('parseConversationGetContextStatusPayload', () => {
  it('accepts one bounded non-empty conversation id', () => {
    expect(parseConversationGetContextStatusPayload({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { conversationId: '' },
    { conversationId: '   ' },
    { conversationId: 1 },
    { conversationId: 'conv-1', extra: true },
    { conversationId: 'x'.repeat(129) },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseConversationGetContextStatusPayload(payload)).toThrow(
      'Invalid get-conversation-context-status payload',
    );
  });
});
