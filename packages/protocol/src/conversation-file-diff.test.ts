import { parseConversationReadFileDiffPayload } from './conversation-file-diff.js';
import { describe, expect, it } from 'vitest';
import { encodeFrame, MAX_FRAME_BYTES } from './framing.js';

describe('scoped file difference protocol', () => {
  it('validates scoped bounded inputs before forwarding', () => {
    const input = {
      conversationId: 'conversation-a',
      before: { text: '' },
      after: { reference: { source: 'event', id: 'event', path: ['argumentsJson', 'content'] } },
    };
    expect(parseConversationReadFileDiffPayload(input)).toEqual(input);
    for (const value of [
      { ...input, conversationId: '' },
      { ...input, limit: 161 },
      { ...input, after: { text: 'x'.repeat(8193) } },
      { ...input, workspacePath: 'private' },
    ])
      expect(parseConversationReadFileDiffPayload(value)).toBeUndefined();
  });
  it('keeps worst-case escaped row pages well within one frame', () => {
    const rows = Array.from({ length: 160 }, (_, index) => ({
      kind: 'add',
      text: '\u0001'.repeat(512),
      newLine: index + 1,
      newOffset: index * 513,
      truncated: true,
    }));
    expect(
      encodeFrame({
        id: 'diff',
        kind: 'response',
        type: 'conversation.readFileDiff',
        payload: {
          diff: {
            rows,
            version: 'a'.repeat(64),
            beforeVersion: 'b'.repeat(64),
            afterVersion: 'c'.repeat(64),
            offset: 0,
            totalRows: 160,
            added: 160,
            removed: 0,
            mode: 'exact',
            formatChanged: false,
          },
        },
      }).length,
    ).toBeLessThan(MAX_FRAME_BYTES / 2);
  });
});
