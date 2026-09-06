import { afterEach, expect, it, vi } from 'vitest';
import type { DeferredContent, RunId } from '@sync-think/shared';
import { deferredContentReader } from './deferred-content-reader.js';
import { resolveMessageText } from './message-text-source.js';

vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
const contentRef: DeferredContent = {
  reference: { source: 'timeline', runId: 'run-prose' as RunId, id: 'answer', path: ['text'] },
  utf8Bytes: 100000,
  utf16Length: 100000,
  format: 'text',
};
const parts = [{ text: 'preview', contentRef }, { text: 'suffix' }];
const version = 'a'.repeat(64);
const response = (
  text: string,
  offset: number,
  utf16Length: number,
  nextOffset?: number,
  sourceVersion = version,
) => ({
  content: {
    text,
    offset,
    utf16Length,
    utf8Bytes: utf16Length * 3,
    format: 'text' as const,
    version: sourceVersion,
    ...(nextOffset === undefined ? {} : { nextOffset }),
  },
});
afterEach(() => vi.resetAllMocks());

it('returns ordinary text without any source request', async () => {
  expect(await resolveMessageText([{ text: 'text' }], 'original', '')).toBe('original');
  expect(deferredContentReader.read).not.toHaveBeenCalled();
});
it('joins every exact source chunk and preserves message or timeline separators', async () => {
  vi.mocked(deferredContentReader.read)
    .mockResolvedValueOnce(response('原文🙂', 0, 6, 4))
    .mockResolvedValueOnce(response('结尾', 4, 6));
  expect(await resolveMessageText(parts, 'preview', 'conversation-prose')).toBe(
    '原文🙂结尾\nsuffix',
  );
  expect(vi.mocked(deferredContentReader.read).mock.calls[1][0]).toMatchObject({
    conversationId: 'conversation-prose',
    reference: contentRef.reference,
    offset: 4,
    version,
  });
  vi.mocked(deferredContentReader.read).mockResolvedValueOnce(response('全文', 0, 2));
  expect(await resolveMessageText(parts, 'preview', 'conversation-prose', undefined, '')).toBe(
    '全文suffix',
  );
});
it('rejects missing scope before requesting source content', async () => {
  await expect(resolveMessageText(parts, 'preview', '')).rejects.toThrow('content.unavailable');
  expect(deferredContentReader.read).not.toHaveBeenCalled();
});
it.each([
  ['version', response('tail', 5, 9, undefined, 'b'.repeat(64)), 'version-changed'],
  ['length', response('tail', 5, 10), 'version-changed'],
  ['offset', response('tail', 4, 9), 'version-changed'],
  ['truncation', response('bad', 5, 9), 'incomplete'],
])(
  'rejects inconsistent %s instead of returning preview or partial text',
  async (_name, invalid, reason) => {
    vi.mocked(deferredContentReader.read)
      .mockResolvedValueOnce(response('first', 0, 9, 5))
      .mockResolvedValueOnce(invalid);
    await expect(resolveMessageText(parts, 'preview', 'conversation-prose')).rejects.toThrow(
      reason,
    );
  },
);
it('rejects a non-progressing range', async () => {
  vi.mocked(deferredContentReader.read).mockResolvedValueOnce(response('', 0, 9, 0));
  await expect(resolveMessageText(parts, 'preview', 'conversation-prose')).rejects.toThrow(
    'invalid-range',
  );
});
it('stops before a request or after an ignored cancellation without reading the next chunk', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveMessageText(parts, 'preview', 'conversation-prose', controller.signal),
  ).rejects.toThrow('cancelled');
  expect(deferredContentReader.read).not.toHaveBeenCalled();
  const active = new AbortController();
  vi.mocked(deferredContentReader.read).mockImplementationOnce(async () => {
    active.abort();
    return response('first', 0, 9, 5);
  });
  await expect(
    resolveMessageText(parts, 'preview', 'conversation-prose', active.signal),
  ).rejects.toThrow('cancelled');
  expect(deferredContentReader.read).toHaveBeenCalledTimes(1);
});
