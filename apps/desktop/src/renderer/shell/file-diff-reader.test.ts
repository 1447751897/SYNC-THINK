import type {
  ConversationReadFileDiffPayload,
  ConversationReadFileDiffResponse,
} from '@sync-think/protocol';
import { describe, expect, it } from 'vitest';
import { validateFileDiffResponse } from './file-diff-reader.js';

const version = 'a'.repeat(64);
const payload = {
  conversationId: 'conversation',
  before: { text: '' },
  after: { text: 'after' },
} as ConversationReadFileDiffPayload;
const response: ConversationReadFileDiffResponse = {
  diff: {
    rows: [{ kind: 'add', text: 'after', newLine: 1, newOffset: 0 }],
    offset: 0,
    totalRows: 1,
    added: 1,
    removed: 0,
    version,
    beforeVersion: version,
    afterVersion: version,
    mode: 'exact',
    formatChanged: false,
  },
};
describe('file difference response validation', () => {
  it('accepts bounded versioned rows and rejects oversized text or malformed coordinates', () => {
    expect(() => validateFileDiffResponse(payload, response)).not.toThrow();
    for (const row of [
      { ...response.diff.rows[0], text: 'x'.repeat(513) },
      { ...response.diff.rows[0], newLine: 0 },
      { ...response.diff.rows[0], newOffset: -1 },
      { ...response.diff.rows[0], newOffset: undefined },
    ])
      expect(() =>
        validateFileDiffResponse(payload, { diff: { ...response.diff, rows: [row] } }),
      ).toThrow('content.invalid-response');
  });
  it('checks page continuation and both snapshot versions before displaying rows', () => {
    for (const extra of [
      { totalRows: 2 },
      { nextOffset: 1 },
      { beforeVersion: undefined },
      { mode: 'invented' },
      { added: -1 },
    ])
      expect(() =>
        validateFileDiffResponse(payload, {
          diff: { ...response.diff, ...extra },
        } as ConversationReadFileDiffResponse),
      ).toThrow('content.invalid-response');
    expect(() =>
      validateFileDiffResponse({ ...payload, version: 'b'.repeat(64) }, response),
    ).toThrow('content.version-changed');
  });
});
