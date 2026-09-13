/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock.js';
import { highlightCodeLines } from './code-highlight.js';
import { MarkdownContent } from './MarkdownContent.js';
import { resetToolOutputWrapForTests } from './tool-output-wrap.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetToolOutputWrapForTests();
});

describe('CodeBlock', () => {
  it.each(['', '\n\n## 实现说明\n\n'])(
    'preserves expanded code reading state across completion with prefix %j',
    async (prefix) => {
      const source = Array.from(
        { length: 30 },
        (_, index) => `const value${index} = ${index};`,
      ).join('\n');
      const text = `${prefix}\`\`\`ts\n${source}\n\`\`\``;
      const { container, rerender } = render(<MarkdownContent text={text} streaming />);
      fireEvent.click(screen.getByRole('button', { name: '展开全部 30 行代码' }));
      const viewport = container.querySelector<HTMLElement>('[data-code-viewport]')!;
      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 900 },
        scrollTop: { configurable: true, writable: true, value: 120 },
        scrollLeft: { configurable: true, writable: true, value: 42 },
      });
      fireEvent.scroll(viewport);
      rerender(<MarkdownContent text={`${text}\n\n解释一\n\n解释二\n\n解释三`} streaming />);
      await waitFor(() =>
        expect(container.querySelector<HTMLElement>('[data-code-viewport]')!.scrollTop).toBe(120),
      );
      rerender(<MarkdownContent text={`${text}\n\n解释一\n\n解释二\n\n解释三`} />);
      const completed = container.querySelector<HTMLElement>('[data-code-viewport]')!;
      expect(completed.scrollTop).toBe(120);
      expect(completed.scrollLeft).toBe(42);
      expect(container.querySelector('.shell-md-code.is-expanded')).toBeTruthy();
      expect(container.querySelector('[data-writing="true"]')).toBeNull();
      if (prefix) expect(screen.getByRole('heading', { name: '实现说明' })).toBeTruthy();
    },
  );

  it('keeps identical blocks independent and resets reading state for replaced messages', () => {
    const source = Array.from({ length: 14 }, (_, index) => `line ${index}`).join('\n');
    const fence = `\`\`\`text\n${source}\n\`\`\``;
    const text = `${fence}\n\n## 第二份\n\n${fence}`;
    const { container, rerender } = render(<MarkdownContent text={text} streaming />);
    fireEvent.click(screen.getAllByRole('button', { name: '展开全部 14 行代码' })[1]!);
    rerender(<MarkdownContent text={text} />);
    const blocks = container.querySelectorAll('.shell-md-code');
    expect(blocks[0]!.classList.contains('is-expanded')).toBe(false);
    expect(blocks[1]!.classList.contains('is-expanded')).toBe(true);
    rerender(<MarkdownContent text={`${fence}\n\n## 另一条消息\n\n${fence}`} />);
    expect(container.querySelectorAll('.shell-md-code.is-expanded')).toHaveLength(0);
  });

  it('keeps the Markdown code viewport mounted during token updates', async () => {
    const text = '```ts\nconst first = 1;\n';
    const { container, rerender } = render(<MarkdownContent text={text} streaming />);
    const viewport = container.querySelector<HTMLElement>('[data-code-viewport]')!;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 80 },
    });
    fireEvent.scroll(viewport);
    rerender(<MarkdownContent text={`${text}const second = 2;\n`} streaming />);
    await waitFor(() => expect(container.querySelectorAll('[data-code-line]')).toHaveLength(2));
    expect(container.querySelector('[data-code-viewport]')).toBe(viewport);
    expect(viewport.scrollTop).toBe(80);
  });
  it('shows real file metadata, line numbers and highlighted source', () => {
    const { container } = render(
      <CodeBlock
        code={'const ready = true;\nreturn ready;'}
        filename="src/check.ts"
        highlightLines={[2]}
      />,
    );
    expect(screen.getByText('src/check.ts')).toBeTruthy();
    expect(container.querySelectorAll('[data-code-line]')).toHaveLength(2);
    expect(container.querySelector('[data-code-line="2"]')?.getAttribute('data-highlighted')).toBe(
      'true',
    );
    expect(container.querySelector('.hljs-keyword')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('copies exact source without displayed line numbers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const source = 'const ready = true;\r\n\treturn ready;\n';
    render(<CodeBlock code={source} language="ts" />);
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    expect(await screen.findByText('已复制')).toBeTruthy();
  });

  it('reports a clipboard failure without a false success state', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CodeBlock code="echo ok" language="bash" />);
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
    expect(await screen.findByText('复制失败')).toBeTruthy();
    expect(screen.queryByText('已复制')).toBeNull();
  });

  it('pauses stream following after scrolling up and resumes once the reader returns to the bottom', async () => {
    const { container, rerender } = render(<CodeBlock code="first" streaming />);
    const viewport = container.querySelector<HTMLElement>('[data-code-viewport]')!;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 120 },
    });
    fireEvent.scroll(viewport);
    rerender(<CodeBlock code={'first\nsecond'} streaming />);
    await waitFor(() => expect(container.querySelectorAll('[data-code-line]')).toHaveLength(2));
    expect(viewport.scrollTop).toBe(120);
    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 600 });
    rerender(<CodeBlock code={'first\nsecond\nlast'} />);
    await waitFor(() => expect(viewport.scrollTop).toBe(600));
  });

  it('bounds large previews while keeping all source available to copy', () => {
    const { container } = render(
      <CodeBlock code={Array.from({ length: 2100 }, (_, index) => `line ${index}`).join('\n')} />,
    );
    expect(container.querySelectorAll('[data-code-line]')).toHaveLength(2000);
    expect(screen.getByText(/仅预览前 2000 行/)).toBeTruthy();
  });

  it('balances syntax spans across multiline comments and escapes HTML', () => {
    const lines = highlightCodeLines(
      '/* first\nsecond */\nconst text = "<img src=x>";',
      'typescript',
    )!;
    expect(lines[1]).toMatch(/^<span class="hljs-comment">/);
    expect(lines[1]).toMatch(/<\/span>$/);
    expect(lines.join('\n')).not.toContain('<img');
    expect(lines.join('\n')).toContain('&lt;img');
  });
});

describe('CodeBlock wrap control', () => {
  it('wraps by default and shows a pressed toggle', () => {
    const { container } = render(<CodeBlock code={'x'.repeat(400)} wrapControl />);
    expect(container.querySelector('.shell-md-code')?.getAttribute('data-wrap')).toBe('true');
    expect(screen.getByRole('button', { name: '切换为不换行' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('switches to single-line when the toggle is clicked', () => {
    const { container } = render(<CodeBlock code={'x'.repeat(400)} wrapControl />);
    fireEvent.click(screen.getByRole('button', { name: '切换为不换行' }));
    expect(container.querySelector('.shell-md-code')?.getAttribute('data-wrap')).toBe('false');
    const toggle = screen.getByRole('button', { name: '切换为自动换行' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('applies one shared preference to every block in the window', () => {
    const { container } = render(
      <>
        <CodeBlock code={'x'.repeat(400)} wrapControl />
        <CodeBlock code={'y'.repeat(400)} wrapControl />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: '切换为不换行' })[0]!);
    const blocks = container.querySelectorAll('.shell-md-code');
    expect(blocks[0]!.getAttribute('data-wrap')).toBe('false');
    expect(blocks[1]!.getAttribute('data-wrap')).toBe('false');
  });

  it('keeps markdown code blocks unwrapped unless the control is requested', () => {
    const { container } = render(<MarkdownContent text={'```ts\nconst a = 1;\n```'} />);
    expect(container.querySelector('.shell-md-code')?.getAttribute('data-wrap')).toBe('false');
    expect(screen.queryByRole('button', { name: /换行/ })).toBeNull();
  });
});
