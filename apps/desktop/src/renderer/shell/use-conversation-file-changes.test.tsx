// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewPanel, WorkspaceFilesPanel } from './RightDock.js';
import { conversationFilesReader } from './use-conversation-file-changes.js';
import { conversationReviewFromKey, reviewViewKey } from './review-view.js';
import { runProcessPageReader } from './use-run-process-page.js';

const target = { reviewScope: 'conversation' as const, conversationId: 'chat' };
const first = {
  items: [
    {
      path: 'old.txt',
      action: 'created' as const,
      runId: 'old' as never,
      sequence: 1,
      content: 'old',
    },
  ],
  offset: 0,
  total: 2,
  nextOffset: 1,
  version: 'a'.repeat(64),
};
const second = {
  ...first,
  items: [{ ...first.items[0]!, path: 'new.txt', runId: 'new' as never, sequence: 2 }],
  offset: 1,
  nextOffset: undefined,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('conversation scoped file pages', () => {
  it('validates real bridge responses rather than accepting another scope cursor', async () => {
    const listConversationFileChanges = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, total: 0 })
      .mockResolvedValueOnce({ ...first, version: 'b'.repeat(64) });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { listConversationFileChanges } },
    });
    try {
      expect(
        await conversationFilesReader.read({ conversationId: 'chat' as never, offset: 0 }),
      ).toEqual(first);
      await expect(
        conversationFilesReader.read({ conversationId: 'chat' as never, offset: 0 }),
      ).rejects.toThrow('invalid-response');
      await expect(
        conversationFilesReader.read({
          conversationId: 'chat' as never,
          offset: 0,
          version: first.version,
        }),
      ).rejects.toThrow('version-changed');
    } finally {
      Reflect.deleteProperty(window, 'syncThink');
    }
  });
  it('assembles every conversation file in Review without page controls', async () => {
    const read = vi
      .spyOn(conversationFilesReader, 'read')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const runRead = vi.spyOn(runProcessPageReader, 'read');
    render(<ReviewPanel view={target} standalone />);
    await screen.findAllByText('old.txt');
    await screen.findAllByText('new.txt');
    expect(screen.queryByText(/文件 \d/)).toBeNull();
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
    expect(screen.getByText('最近一次变动').getAttribute('data-review-scope')).toBe('conversation');
    expect(read.mock.calls[1][0]).toEqual({
      conversationId: 'chat',
      offset: 1,
      version: first.version,
    });
    expect(runRead).not.toHaveBeenCalled();
    expect(conversationReviewFromKey(reviewViewKey(target))).toEqual(target);
  });
  it('keeps loaded conversation files after a version change and restarts explicitly', async () => {
    const read = vi
      .spyOn(conversationFilesReader, 'read')
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('history.version-changed'))
      .mockResolvedValue({ ...first, total: 1, nextOffset: undefined });
    render(<ReviewPanel view={target} standalone />);
    await screen.findAllByText('old.txt');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(read.mock.calls[2][0]).toEqual({ conversationId: 'chat', offset: 0 });
    expect(screen.getAllByText('old.txt').length).toBeGreaterThan(0);
  });
  it('loads workspace conversation files only when their tab is visible and keeps a retry on failure', async () => {
    const read = vi
      .spyOn(conversationFilesReader, 'read')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...first, total: 1, nextOffset: undefined });
    render(<WorkspaceFilesPanel reviewView={target} />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: /对话文件/ }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
    await screen.findAllByText('old.txt');
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
  });
  it('uses NewMax empty copy for conversation files', async () => {
    vi.spyOn(conversationFilesReader, 'read').mockResolvedValue({
      items: [],
      offset: 0,
      total: 0,
      version: 'a'.repeat(64),
    });
    render(<WorkspaceFilesPanel reviewView={target} />);
    fireEvent.click(screen.getByRole('tab', { name: /对话文件/ }));
    expect(await screen.findByText('当前对话暂无文件变动')).toBeTruthy();
    expect(screen.queryByText('暂无对话文件')).toBeNull();
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
  });
  it('aborts and ignores a response from the previous conversation', async () => {
    let resolveFirst!: (value: typeof first) => void;
    const read = vi
      .spyOn(conversationFilesReader, 'read')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(second);
    const rendered = render(<ReviewPanel view={target} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    rendered.rerender(<ReviewPanel view={{ ...target, conversationId: 'other' }} />);
    await screen.findAllByText('new.txt');
    expect(read.mock.calls[0][1]?.aborted).toBe(true);
    resolveFirst(first);
    await waitFor(() => expect(screen.queryByText('old.txt')).toBeNull());
  });
});
