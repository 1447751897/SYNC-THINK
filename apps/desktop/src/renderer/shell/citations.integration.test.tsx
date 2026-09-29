/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StreamingResponse } from './StreamingResponse.js';
import { MarkdownContent } from './MarkdownContent.js';
import { collectAnswerSources } from './answer-sources.js';
const text =
  '网页结论 [1](https://example.test/docs#api "接口文档")。文件依据 [2](src/app.ts#L8 "入口代码")。重复引用 [1](https://example.test/docs#api)。[推荐链接](https://example.test/help)。';
const folder = 'D:/work';
afterEach(cleanup);
function Reply({
  onOpenFile = vi.fn(),
  onOpenUrl = vi.fn(),
  streaming = false,
  text: body = text,
}: {
  onOpenFile?: ReturnType<typeof vi.fn>;
  onOpenUrl?: ReturnType<typeof vi.fn>;
  streaming?: boolean;
  text?: string;
}) {
  return (
    <StreamingResponse
      status={streaming ? 'streaming' : 'complete'}
      sources={collectAnswerSources(body, [], folder)}
      onOpenFile={onOpenFile}
      onOpenUrl={onOpenUrl}
    >
      <MarkdownContent
        text={body}
        projectFolder={folder}
        streaming={streaming}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
      />
    </StreamingResponse>
  );
}
describe('answer citations', () => {
  it('expands and focuses the mapped row, retaining the original URL anchor and file line', async () => {
    const onOpenFile = vi.fn(),
      onOpenUrl = vi.fn();
    render(<Reply onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} />);
    expect(
      screen.getByRole('button', { name: '查看 3 个来源' }).getAttribute('aria-expanded'),
    ).toBe('false');
    const fileCitation = screen.getByRole('button', { name: '查看引用 2：入口代码' });
    fireEvent.click(fileCitation);
    const fileRow = screen.getByRole('button', { name: '打开来源 入口代码' });
    expect(fileRow.id).toBe(fileCitation.getAttribute('aria-controls'));
    await waitFor(() => expect(document.activeElement).toBe(fileRow));
    expect(fileRow.getAttribute('data-selected')).toBe('true');
    fireEvent.click(fileRow);
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', { line: 8, column: 1 });
    fireEvent.click(screen.getAllByRole('button', { name: '查看引用 1：接口文档' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '打开来源 接口文档' }));
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.test/docs#api');
    expect(screen.getByRole('list', { name: '参考资料' }).textContent).toContain('推荐链接');
    expect(screen.getAllByRole('button', { name: '查看引用 1：接口文档' })).toHaveLength(2);
  });
  it('scopes ids and selection to the correct reply', async () => {
    render(
      <>
        <Reply />
        <Reply />
      </>,
    );
    const replies = screen.getAllByTestId('streaming-response');
    const first = within(replies[0]!),
      second = within(replies[1]!);
    const a = first.getByRole('button', { name: '查看引用 2：入口代码' }),
      b = second.getByRole('button', { name: '查看引用 2：入口代码' });
    expect(a.getAttribute('aria-controls')).not.toBe(b.getAttribute('aria-controls'));
    fireEvent.click(b);
    expect(first.getByRole('button', { name: '查看 3 个来源' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(
      second.getByRole('button', { name: '查看 3 个来源' }).getAttribute('aria-expanded'),
    ).toBe('true');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        second.getByRole('button', { name: '打开来源 入口代码' }),
      ),
    );
  });
  it('activates mapped citations after streaming and recreates their numbering from persisted text', () => {
    const { rerender, unmount } = render(<Reply streaming />);
    expect(screen.queryByRole('button', { name: '查看引用 2：入口代码' })).toBeNull();
    rerender(<Reply />);
    expect(screen.getByRole('button', { name: '查看引用 2：入口代码' }).textContent).toBe('2');
    unmount();
    render(<Reply />);
    expect(screen.getByRole('button', { name: '查看引用 2：入口代码' }).textContent).toBe('2');
  });
  it('keeps unsupported markers and bare numbers as ordinary text', () => {
    render(<Reply text={'未映射 [1]，以及 citeturn0search0。'} />);
    expect(screen.queryByTestId('msg-sources')).toBeNull();
    expect(screen.queryByRole('button', { name: /查看引用/ })).toBeNull();
    expect(screen.getByText(/未映射/)).toBeTruthy();
  });
  it('does not turn a plain recommended link into a numbered inline citation', () => {
    render(<Reply text={'请看 [帮助页面](https://example.test/help)'} />);
    expect(screen.getByRole('link', { name: '打开网页 帮助页面' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /查看引用/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看 1 个来源' }));
    expect(screen.getByRole('list', { name: '参考资料' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: '引用来源' })).toBeNull();
  });
});
