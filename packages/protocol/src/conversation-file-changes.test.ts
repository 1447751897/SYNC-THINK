import { describe, expect, it } from 'vitest';
import { parseConversationListFileChangesPayload } from './conversation-file-changes.js';

describe('conversation file directory requests', () => {
  it('requires an explicit scope and a bounded, versioned page', () => {
    expect(parseConversationListFileChangesPayload({ conversationId: 'chat', offset: 0 })).toEqual({
      conversationId: 'chat',
      offset: 0,
    });
    for (const payload of [
      null,
      [],
      {},
      { conversationId: '', offset: 0 },
      { conversationId: 'chat', offset: -1 },
      { conversationId: 'chat', offset: 0, limit: 41 },
      { conversationId: 'chat', offset: 0, version: 'bad' },
      { conversationId: 'chat', offset: 0, runId: 'last-run' },
    ]) {
      expect(parseConversationListFileChangesPayload(payload)).toBeUndefined();
    }
    expect(
      parseConversationListFileChangesPayload({
        conversationId: 'chat',
        offset: 40,
        limit: 20,
        version: 'a'.repeat(64),
      }),
    ).toMatchObject({ offset: 40, limit: 20 });
  });
});
