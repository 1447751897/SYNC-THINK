/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
it('renders a bounded Markdown preview without fetching, then reads raw source in prose mode', async () => {
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
  expect(deferredContentReader.read).not.toHaveBeenCalled();
  expect(screen.getByTestId('deferred-message-text').getAttribute('data-presentation')).toBe(
    'prose',
  );
  fireEvent.click(screen.getByRole('button', { name: '读取完整内容' }));
  await screen.findByText('# 完整原文');
  expect(screen.getByText('原文分段 · 第 1 段')).toBeTruthy();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(vi.mocked(deferredContentReader.read).mock.calls[0][0].conversationId).toBe(
    'conversation-prose',
  );
});
it('keeps explicit source reading disabled while prose is streaming', () => {
  render(
    <MessageTextContent
      conversationId="conversation-prose"
      text="生成中"
      parts={[{ text: '生成中', contentRef }]}
      streaming
    />,
  );
  const read = screen.getByRole('button', {
    name: '生成中，完成后读取完整内容',
  }) as HTMLButtonElement;
  expect(read.disabled).toBe(true);
  fireEvent.click(read);
  expect(deferredContentReader.read).not.toHaveBeenCalled();
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
