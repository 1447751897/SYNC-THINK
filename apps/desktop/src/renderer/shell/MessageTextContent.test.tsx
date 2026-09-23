/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeferredContent, RunId } from '@sync-think/shared';
import { MessageTextContent } from './MessageTextContent.js';
import { ConversationContentScope } from './DeferredToolContent.js';
import { deferredContentReader } from './deferred-content-reader.js';
vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
const contentRef: DeferredContent = {
  reference: { source: 'timeline', runId: 'run-prose' as RunId, id: 'answer', path: ['text'] },
  utf8Bytes: 100000,
  utf16Length: 100000,
  format: 'text',
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('auto-assembles deferred prose and renders it as Markdown, without a read-full control', async () => {
  vi.mocked(deferredContentReader.read).mockResolvedValueOnce({
    content: {
      text: '# 完整原文',
      offset: 0,
      utf16Length: 6,
      utf8Bytes: 14,
      version: 'a'.repeat(64),
      format: 'text',
    },
  });
  render(
    <ConversationContentScope.Provider value="conversation-prose">
      <MessageTextContent text="**预览**" parts={[{ text: '**预览**', contentRef }]} />
    </ConversationContentScope.Provider>,
  );
  expect(screen.getByText('预览', { selector: 'strong' }).tagName).toBe('STRONG');
  expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
  expect(screen.queryByRole('button', { name: '生成中，完成后读取完整内容' })).toBeNull();
  await screen.findByRole('heading', { name: '完整原文' });
  expect(screen.queryByText('预览 ·')).toBeNull();
  expect(vi.mocked(deferredContentReader.read).mock.calls[0][0].conversationId).toBe(
    'conversation-prose',
  );
});
it('keeps the streaming preview and does not fetch until generation finishes', () => {
  render(
    <MessageTextContent
      conversationId="conversation-prose"
      text="生成中"
      parts={[{ text: '生成中', contentRef }]}
      streaming
    />,
  );
  expect(screen.getByText('生成中')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
  expect(screen.queryByRole('button', { name: '生成中，完成后读取完整内容' })).toBeNull();
  expect(deferredContentReader.read).not.toHaveBeenCalled();
});
it('retries a failed assemble without exposing a paged source reader', async () => {
  vi.mocked(deferredContentReader.read)
    .mockRejectedValueOnce(new Error('content.read-failed'))
    .mockResolvedValueOnce({
      content: {
        text: '恢复后的全文',
        offset: 0,
        utf16Length: 6,
        utf8Bytes: 18,
        version: 'a'.repeat(64),
        format: 'text',
      },
    });
  render(
    <ConversationContentScope.Provider value="conversation-prose">
      <MessageTextContent text="**预览**" parts={[{ text: '**预览**', contentRef }]} />
    </ConversationContentScope.Provider>,
  );
  await screen.findByRole('alert');
  expect(screen.getByText('预览', { selector: 'strong' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await waitFor(() => expect(screen.getByText('恢复后的全文')).toBeTruthy());
  expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
});
it('preserves ordinary text and custom user previews without adding a source reader', () => {
  render(
    <MessageTextContent
      text="普通消息"
      renderPreview={(text) => <span data-testid="user-preview">{text}</span>}
    />,
  );
  expect(screen.getByTestId('user-preview').textContent).toBe('普通消息');
  expect(screen.queryByTestId('deferred-message-text')).toBeNull();
});

function fullText(text: string) {
  return {
    content: {
      text,
      offset: 0,
      utf16Length: text.length,
      utf8Bytes: text.length * 3,
      version: 'a'.repeat(64),
      format: 'text' as const,
    },
  };
}

it.each(['conversation', 'reference', 'preview', 'streaming'] as const)(
  'hides the previous full text immediately when %s changes',
  async (change) => {
    let resolve!: (value: ReturnType<typeof fullText>) => void;
    const pending = new Promise<ReturnType<typeof fullText>>((done) => {
      resolve = done;
    });
    vi.mocked(deferredContentReader.read)
      .mockResolvedValueOnce(fullText('旧来源全文'))
      .mockReturnValueOnce(pending);
    const initial = {
      conversationId: 'conversation-prose',
      text: '当前预览',
      parts: [{ text: '当前预览', contentRef }],
    };
    const rendered = render(<MessageTextContent {...initial} />);
    await screen.findByText('旧来源全文');
    const next = {
      ...initial,
      ...(change === 'conversation' ? { conversationId: 'conversation-next' } : {}),
      ...(change === 'reference'
        ? {
            parts: [
              {
                text: initial.text,
                contentRef: {
                  ...contentRef,
                  reference: { ...contentRef.reference, id: 'next-answer' },
                },
              },
            ],
          }
        : {}),
      ...(change === 'preview' ? { text: '新预览', parts: [{ text: '新预览', contentRef }] } : {}),
      ...(change === 'streaming' ? { sourceStreaming: true } : {}),
    };
    rendered.rerender(<MessageTextContent {...next} />);
    expect(screen.queryByText('旧来源全文')).toBeNull();
    expect(screen.getByText(next.text)).toBeTruthy();
    await act(async () => resolve(fullText('新来源全文')));
    if (change === 'streaming') {
      expect(deferredContentReader.read).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('新来源全文')).toBeNull();
    } else {
      await screen.findByText('新来源全文');
    }
  },
);

it('cancels the old source and ignores its late result after a scope change', async () => {
  let resolve!: (value: ReturnType<typeof fullText>) => void;
  const pending = new Promise<ReturnType<typeof fullText>>((done) => {
    resolve = done;
  });
  vi.mocked(deferredContentReader.read)
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(fullText('当前会话全文'));
  const parts = [{ text: '预览', contentRef }];
  const rendered = render(<MessageTextContent conversationId="old" text="预览" parts={parts} />);
  const oldSignal = vi.mocked(deferredContentReader.read).mock.calls[0][1];
  rendered.rerender(<MessageTextContent conversationId="new" text="预览" parts={parts} />);
  expect(oldSignal?.aborted).toBe(true);
  await screen.findByText('当前会话全文');
  await act(async () => resolve(fullText('旧会话私密全文')));
  expect(screen.queryByText('旧会话私密全文')).toBeNull();
  expect(screen.getByText('当前会话全文')).toBeTruthy();
});

it('shows only the new preview if reading the replacement source fails', async () => {
  vi.mocked(deferredContentReader.read)
    .mockResolvedValueOnce(fullText('旧来源全文'))
    .mockRejectedValueOnce(new Error('content.read-failed'));
  const parts = [{ text: '预览', contentRef }];
  const rendered = render(<MessageTextContent conversationId="old" text="预览" parts={parts} />);
  await screen.findByText('旧来源全文');
  rendered.rerender(<MessageTextContent conversationId="new" text="新预览" parts={parts} />);
  await screen.findByRole('alert');
  expect(screen.queryByText('旧来源全文')).toBeNull();
  expect(screen.getByText('新预览')).toBeTruthy();
});
