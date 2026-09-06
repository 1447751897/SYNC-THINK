/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileChangeItem, RunProcessView } from '@sync-think/protocol';
import type { FileDiffPage } from '@sync-think/shared';
import { DeferredFileDiff } from './DeferredFileDiff.js';
import { FileChangesCard } from './ExecutionProcessBlock.js';
import { ReviewPanel } from './RightDock.js';
import { fileDiffReader } from './file-diff-reader.js';
import { deferredContentReader } from './deferred-content-reader.js';

vi.mock('./file-diff-reader.js', () => ({ fileDiffReader: { read: vi.fn() } }));
vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
const version = 'a'.repeat(64);
const sourceVersion = 'b'.repeat(64);
const item: FileChangeItem = {
  path: 'fixture.txt',
  action: 'edited',
  previousContent: 'old\n',
  contentRef: {
    reference: { source: 'event', id: 'event-new', path: ['argumentsJson', 'content'] },
    utf16Length: 1200000,
    utf8Bytes: 1200000,
    format: 'text',
  },
  preview: 'short preview',
};
const view = {
  runId: 'run',
  conversationId: 'conversation-a',
  steps: [],
  fileChanges: [item],
  running: false,
  doneCount: 1,
  errorCount: 0,
} as unknown as RunProcessView;
const first: FileDiffPage = {
  rows: [{ kind: 'del', text: 'old row', oldLine: 1, oldOffset: 0 }],
  offset: 0,
  nextOffset: 1,
  totalRows: 2,
  added: 1,
  removed: 1,
  version,
  beforeVersion: sourceVersion,
  afterVersion: sourceVersion,
  mode: 'exact',
  formatChanged: false,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deferred file differences', () => {
  it('routes line-dense inline snapshots through bounded pages in chat and Review', async () => {
    const dense = {
      ...item,
      contentRef: undefined,
      previousContent: Array.from({ length: 600 }, (_, index) => `old-${index}`).join('\n'),
      content: Array.from({ length: 600 }, (_, index) => `new-${index}`).join('\n'),
    };
    const denseView = { ...view, fileChanges: [dense] };
    vi.mocked(fileDiffReader.read).mockResolvedValue({ diff: first });
    const card = render(<FileChangesCard view={denseView} />);
    fireEvent.click(screen.getByRole('button', { name: '展开 fixture.txt diff' }));
    fireEvent.click(screen.getByRole('button', { name: '读取差异' }));
    await screen.findByText('old row');
    expect(vi.mocked(fileDiffReader.read).mock.calls[0][0]).toMatchObject({
      before: { text: dense.previousContent },
      after: { text: dense.content },
    });
    card.unmount();
    render(<ReviewPanel view={denseView} />);
    expect(screen.getByRole('button', { name: '读取差异' })).toBeTruthy();
  });

  it('does not fetch on card expansion, passes scope to Review, and loads only after explicit intent', async () => {
    const openReview = vi.fn();
    vi.mocked(fileDiffReader.read).mockResolvedValue({ diff: first });
    render(<FileChangesCard view={view} onOpenReview={openReview} />);
    fireEvent.click(screen.getByRole('button', { name: '展开 fixture.txt diff' }));
    expect(fileDiffReader.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '读取差异' }));
    await screen.findByText('old row');
    expect(vi.mocked(fileDiffReader.read).mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation-a',
      before: { text: 'old\n' },
      after: { reference: item.contentRef!.reference },
    });
    fireEvent.click(screen.getByTitle('审阅本轮文件修改'));
    expect(openReview.mock.calls[0][0].conversationId).toBe('conversation-a');
  });

  it('keeps an old page on version mismatch and requires a fresh comparison', async () => {
    vi.mocked(fileDiffReader.read)
      .mockResolvedValueOnce({ diff: first })
      .mockRejectedValueOnce(new Error('content.version-changed'))
      .mockResolvedValueOnce({ diff: { ...first, version: sourceVersion } });
    render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    fireEvent.click(screen.getByRole('button', { name: '读取差异' }));
    await screen.findByText('old row');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByRole('alert');
    expect(screen.getByText('old row')).toBeTruthy();
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(vi.mocked(fileDiffReader.read).mock.calls[1][0]).toMatchObject({ offset: 1, version });
    fireEvent.click(screen.getByRole('button', { name: '重新读取差异' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(vi.mocked(fileDiffReader.read).mock.calls[2][0].version).toBeUndefined();
  });

  it('jumps from a shortened line to the corresponding source offset and version without automatic prefetch', async () => {
    vi.mocked(fileDiffReader.read).mockResolvedValueOnce({
      diff: {
        ...first,
        nextOffset: undefined,
        totalRows: 1,
        rows: [{ kind: 'add', text: 'long line', truncated: true, newLine: 20, newOffset: 12000 }],
      },
    });
    vi.mocked(deferredContentReader.read).mockResolvedValueOnce({
      content: {
        text: 'full fragment',
        offset: 12000,
        nextOffset: 12013,
        utf16Length: 1200000,
        utf8Bytes: 1200000,
        format: 'text',
        version: sourceVersion,
      },
    });
    render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    fireEvent.click(screen.getByRole('button', { name: '读取差异' }));
    fireEvent.click(await screen.findByRole('button', { name: '本行已缩略 · 读取完整行内容' }));
    expect(deferredContentReader.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '读取完整内容' }));
    await screen.findByText('full fragment');
    expect(vi.mocked(deferredContentReader.read).mock.calls[0][0]).toMatchObject({
      reference: item.contentRef!.reference,
      offset: 12000,
      version: sourceVersion,
    });
  });

  it('aborts stale reads on scope changes and never paints their late page', async () => {
    let finish!: (value: { diff: FileDiffPage }) => void;
    vi.mocked(fileDiffReader.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const rendered = render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    fireEvent.click(screen.getByRole('button', { name: '读取差异' }));
    const signal = vi.mocked(fileDiffReader.read).mock.calls[0][1]!;
    rendered.rerender(<DeferredFileDiff item={item} conversationId="conversation-b" />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ diff: first }));
    expect(screen.queryByText('old row')).toBeNull();
  });

  it('uses the same scoped path in Review and does not call a replacement fragment a complete file', () => {
    const rendered = render(<ReviewPanel view={view} standalone />);
    expect(screen.getByRole('button', { name: '读取差异' })).toBeTruthy();
    expect(fileDiffReader.read).not.toHaveBeenCalled();
    rendered.rerender(
      <DeferredFileDiff
        item={{ ...item, contentKind: 'replacement-fragment' }}
        conversationId="conversation-a"
      />,
    );
    expect((screen.getByRole('button', { name: '读取差异' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/只记录了替换片段/)).toBeTruthy();
  });
});
