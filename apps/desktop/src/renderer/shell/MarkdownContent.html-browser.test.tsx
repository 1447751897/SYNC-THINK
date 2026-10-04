/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent.js';

afterEach(cleanup);

const html = '<main>海岸骑行</main>';
const sourceReference = '已保存到 `D:\\projects\\demo\\pelican-cycling.html`。';
const fence = '\n\n```html\n' + html + '\n```';

describe('Markdown HTML source handoff', () => {
  it.each(['', '\n\n## 页面预览'])(
    'retains the original file across Markdown sections: %s',
    async (heading) => {
      const open = vi.fn();
      render(
        <MarkdownContent
          text={sourceReference + heading + fence}
          projectFolder="D:/projects/demo"
          onOpenHtmlInBrowser={open}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: '浏览器打开' }));
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(expect.stringContaining(html), {
          sourcePath: 'pelican-cycling.html',
        }),
      );
    },
  );

  it('retains the original file after the reply streams into separate Markdown blocks', async () => {
    const open = vi.fn();
    const view = render(
      <MarkdownContent
        text={sourceReference}
        streaming
        projectFolder="D:/projects/demo"
        onOpenHtmlInBrowser={open}
      />,
    );
    view.rerender(
      <MarkdownContent
        text={sourceReference + fence}
        streaming={false}
        projectFolder="D:/projects/demo"
        onOpenHtmlInBrowser={open}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '浏览器打开' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(expect.stringContaining(html), {
        sourcePath: 'pelican-cycling.html',
      }),
    );
  });

  it('keeps source-less snippets on the generated document path', async () => {
    const open = vi.fn();
    render(
      <MarkdownContent text={fence} projectFolder="D:/projects/demo" onOpenHtmlInBrowser={open} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '浏览器打开' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining(html)));
  });
});
