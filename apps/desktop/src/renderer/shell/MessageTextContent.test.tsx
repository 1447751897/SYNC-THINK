/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
