import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_CHUNK_LENGTH } from '@sync-think/shared';
import { parseConversationReadContentPayload } from './conversation-content.js';
import { encodeFrame, MAX_FRAME_BYTES, HEADER_BYTES } from './framing.js';

const payload = {
  conversationId: 'conversation-a',
  reference: { source: 'event', id: 'event-a', path: ['result'] },
};
describe('bounded conversation content protocol', () => {
  it('validates scopes, references, versions and strictly bounded ranges', () => {
    expect(parseConversationReadContentPayload(payload)).toEqual(payload);
    expect(
      parseConversationReadContentPayload({
        ...payload,
        offset: 32768,
        limit: 256,
        version: 'a'.repeat(64),
      }),
    ).toBeDefined();
    for (const extra of [
      { offset: -1 },
      { limit: MAX_CONTENT_CHUNK_LENGTH + 1 },
      { limit: 1 },
      { offset: Infinity },
      { version: '' },
      { file: 'private' },
      { conversationId: '' },
    ]) {
      expect(parseConversationReadContentPayload({ ...payload, ...extra })).toBeUndefined();
    }
    expect(
      parseConversationReadContentPayload({
        ...payload,
        reference: { ...payload.reference, path: ['run'] },
      }),
    ).toBeUndefined();
  });

  it('keeps the largest escaped content chunk below the wire frame budget', () => {
    const encoded = encodeFrame({
      id: 'read-content',
      kind: 'response',
      type: 'conversation.readContent',
      payload: {
        content: {
          text: '\u0001'.repeat(MAX_CONTENT_CHUNK_LENGTH),
          offset: 0,
          nextOffset: MAX_CONTENT_CHUNK_LENGTH,
          utf8Bytes: 5000000,
          utf16Length: 5000000,
          version: 'a'.repeat(64),
          format: 'text',
        },
      },
    });
    expect(encoded.length - HEADER_BYTES).toBeLessThan(MAX_FRAME_BYTES / 4);
  });
});
