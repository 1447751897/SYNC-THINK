/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeferredContent } from '@sync-think/shared';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { deferredContentReader } from './deferred-content-reader.js';

vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
const deferred: DeferredContent = {
  reference: { source: 'event', id: 'event-a', path: ['result'] },
  utf8Bytes: 100000,
  utf16Length: 100000,
  format: 'text',
};
const version = 'a'.repeat(64);
const chunk = (text: string, offset: number, total = 10, nextOffset?: number) => ({
  content: {
    text,
    offset,
    utf16Length: total,
    utf8Bytes: total,
    version,
    format: 'text' as const,
    ...(nextOffset === undefined ? {} : { nextOffset }),
  },
});
const view = (conversationId = 'conversation-a') => (
  <ConversationContentScope.Provider value={conversationId}>
    <DeferredToolContent deferred={deferred} preview="预览内容" label="输出" />
  </ConversationContentScope.Provider>
);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('NewMax-style assembled tool content', () => {
  it('loads every chunk on mount and shows the assembled result without paging controls', async () => {
    vi.mocked(deferredContentReader.read)
      .mockResolvedValueOnce(chunk('first', 0, 10, 5))
      .mockResolvedValueOnce(chunk('final', 5));
    render(view());
    await waitFor(() => expect(screen.getByTestId('deferred-content-text').textContent).toBe('firstfinal'));
    expect(vi.mocked(deferredContentReader.read).mock.calls[1][0]).toMatchObject({
      offset: 5,
      version,
    });
    expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一段' })).toBeNull();
    expect(screen.queryByRole('button', { name: '上一段' })).toBeNull();
    expect(screen.getByRole('button', { name: '复制全文' })).toBeTruthy();
  });

  it('keeps the preview after a failed assemble and retries from the start', async () => {
    vi.mocked(deferredContentReader.read)
      .mockRejectedValueOnce(new Error('content.read-failed'))
      .mockResolvedValueOnce(chunk('fresh', 0, 5));
    render(view());
    await screen.findByRole('alert');
    expect(screen.getByText('预览内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await waitFor(() => expect(screen.getByTestId('deferred-content-text').textContent).toBe('fresh'));
  });

  it('cancels a stale conversation read and never displays its late result in the new scope', async () => {
    let finish!: (value: ReturnType<typeof chunk>) => void;
    vi.mocked(deferredContentReader.read)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(chunk('new-scope', 0, 9));
    const rendered = render(view());
    await waitFor(() => expect(deferredContentReader.read).toHaveBeenCalled());
    const signal = vi.mocked(deferredContentReader.read).mock.calls[0][1]!;
    rendered.rerender(view('conversation-b'));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(chunk('OLD PRIVATE CONTENT', 0, 19)));
    expect(screen.queryByText('OLD PRIVATE CONTENT')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('deferred-content-text').textContent).toBe('new-scope'),
    );
  });

  it('renders a long single-line result as one text node', async () => {
    const text = 'x'.repeat(16000);
    vi.mocked(deferredContentReader.read).mockResolvedValueOnce(chunk(text, 0, text.length));
    const rendered = render(view());
    await waitFor(() => expect(screen.getByTestId('deferred-content-text').textContent).toBe(text));
    expect(rendered.container.querySelectorAll('*').length).toBeLessThan(70);
  });
});
