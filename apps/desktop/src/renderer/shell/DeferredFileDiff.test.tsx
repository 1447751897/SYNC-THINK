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

/** jsdom has no layout, so drive the scroll container to its bottom by hand. */
function scrollToBottom(container: HTMLElement) {
  Object.defineProperty(container, 'scrollHeight', { value: 400, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
  container.scrollTop = 200;
  fireEvent.scroll(container);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deferred file differences', () => {
  it('renders the first page without a read gate, in chat and in Review', async () => {
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
    await screen.findByText('old row');
    expect(vi.mocked(fileDiffReader.read).mock.calls[0][0]).toMatchObject({
      before: { text: dense.previousContent },
      after: { text: dense.content },
    });
    card.unmount();
    render(<ReviewPanel view={denseView} />);
    await screen.findByText('old row');
    expect(screen.queryByRole('button', { name: '读取差异' })).toBeNull();
  });

  it('passes the conversation scope through and continues reading at the bottom', async () => {
    const second: FileDiffPage = {
      ...first,
      rows: [{ kind: 'add', text: 'new row', newLine: 2, newOffset: 0 }],
      offset: 1,
      nextOffset: undefined,
    };
    vi.mocked(fileDiffReader.read)
      .mockResolvedValueOnce({ diff: first })
      .mockResolvedValueOnce({ diff: second });
    render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    await screen.findByText('old row');
    expect(vi.mocked(fileDiffReader.read).mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation-a',
      before: { text: 'old\n' },
      after: { reference: item.contentRef!.reference },
    });
    scrollToBottom(screen.getByLabelText('文件差异内容'));
    await screen.findByText('new row');
    expect(vi.mocked(fileDiffReader.read).mock.calls[1][0]).toMatchObject({ offset: 1, version });
  });

  it('keeps the loaded rows on a version mismatch and requires a fresh comparison', async () => {
    vi.mocked(fileDiffReader.read)
      .mockResolvedValueOnce({ diff: first })
      .mockRejectedValueOnce(new Error('content.version-changed'))
      .mockResolvedValueOnce({ diff: { ...first, version: sourceVersion } });
    render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    await screen.findByText('old row');
    scrollToBottom(screen.getByLabelText('文件差异内容'));
    await screen.findByRole('alert');
    expect(screen.getByText('old row')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新读取差异' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(vi.mocked(fileDiffReader.read).mock.calls[2][0].version).toBeUndefined();
  });

  it('reads a shortened line on demand instead of showing a read-full control', async () => {
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
        utf16Length: 12013,
        utf8Bytes: 12013,
        format: 'text',
        version: sourceVersion,
      },
    });
    render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    fireEvent.click(await screen.findByRole('button', { name: '本行已缩略 · 读取完整行内容' }));
    await screen.findByText('full fragment');
    expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
    expect(vi.mocked(deferredContentReader.read).mock.calls[0][0]).toMatchObject({
      reference: item.contentRef!.reference,
      offset: 12000,
      version: sourceVersion,
    });
  });

  it('aborts the in-flight read when the scope changes and never paints its late page', async () => {
    let finish!: (value: { diff: FileDiffPage }) => void;
    vi.mocked(fileDiffReader.read)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(() => new Promise(() => {}));
    const rendered = render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    const signal = vi.mocked(fileDiffReader.read).mock.calls[0][1]!;
    rendered.rerender(<DeferredFileDiff item={item} conversationId="conversation-b" />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ diff: first }));
    expect(screen.queryByText('old row')).toBeNull();
  });

  it('does not call a replacement fragment a complete file', () => {
    render(
      <DeferredFileDiff
        item={{ ...item, contentKind: 'replacement-fragment' }}
        conversationId="conversation-a"
      />,
    );
    expect(screen.getByText(/只记录了替换片段/)).toBeTruthy();
    expect(fileDiffReader.read).not.toHaveBeenCalled();
  });

  it('keeps the line-number gutter by default and drops it on request', async () => {
    vi.mocked(fileDiffReader.read).mockResolvedValue({ diff: first });
    const rendered = render(<DeferredFileDiff item={item} conversationId="conversation-a" />);
    await screen.findByText('old row');
    expect(rendered.container.querySelector('[data-old-line]')).toBeTruthy();
    rendered.rerender(
      <DeferredFileDiff item={item} conversationId="conversation-a" showLineNumbers={false} />,
    );
    expect(rendered.container.querySelector('[data-old-line]')).toBeNull();
  });

  it('marks only the changed tokens when word-level diff is on', async () => {
    vi.mocked(fileDiffReader.read).mockResolvedValue({
      diff: {
        ...first,
        nextOffset: undefined,
        totalRows: 2,
        rows: [
          { kind: 'del', text: 'const value = 1;', oldLine: 1, oldOffset: 0 },
          { kind: 'add', text: 'const value = 2;', newLine: 1, newOffset: 0 },
        ],
      },
    });
    const rendered = render(
      <DeferredFileDiff item={item} conversationId="conversation-a" wordLevel />,
    );
    await screen.findAllByText(/const value/);
    const marks = rendered.container.querySelectorAll('.shell-diff-word');
    expect([...marks].map((mark) => mark.textContent)).toEqual(['1', '2']);
  });
});
