import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeferredContent } from '@sync-think/shared';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read } }));
import { readContextToolText } from './context-tool-text.js';
const reference = { reference: { kind: 'tool-result', toolCallId: 'tool-1' } } as unknown as DeferredContent;
beforeEach(() => read.mockReset());
function chunk(text: string, offset: number, length: number, nextOffset?: number, version = 'a') {
  return { content: { text, offset, utf16Length: length, version, format: 'json', ...(nextOffset === undefined ? {} : { nextOffset }) } };
}
describe('context tool output copy', () => {
  it('keeps an in-memory output exactly as received', async () => {
    expect(await readContextToolText('full output', undefined)).toBe('full output');
    expect(read).not.toHaveBeenCalled();
  });
  it('reads every page of JSON output instead of copying the abbreviated preview', async () => {
    const first = '{"count":', second = '5,"ok":true}';
    read.mockResolvedValueOnce(chunk(first, 0, first.length + second.length, first.length))
      .mockResolvedValueOnce(chunk(second, first.length, first.length + second.length));
    expect(await readContextToolText('preview...', reference, 'conv-1')).toBe(first + second);
    expect(read).toHaveBeenLastCalledWith({ conversationId: 'conv-1', reference: reference.reference, offset: first.length, version: 'a' });
  });
  it('fails explicitly when the conversation is missing', async () => {
    await expect(readContextToolText('preview', reference)).rejects.toThrow('缺少对话信息');
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects a version change rather than combining different outputs', async () => {
    read.mockResolvedValueOnce(chunk('a', 0, 2, 1)).mockResolvedValueOnce(chunk('b', 1, 2, undefined, 'b'));
    await expect(readContextToolText('preview', reference, 'conv-1')).rejects.toThrow('执行记录已变化');
  });
  it('rejects truncated final pages and repeated offsets', async () => {
    read.mockResolvedValueOnce(chunk('a', 0, 5));
    await expect(readContextToolText('preview', reference, 'conv-1')).rejects.toThrow('执行记录尚未完整载入');
    read.mockResolvedValueOnce(chunk('a', 0, 5, 0));
    await expect(readContextToolText('preview', reference, 'conv-1')).rejects.toThrow('执行记录分页异常');
  });
});
