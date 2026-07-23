import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent.js';

describe('MarkdownContent', () => {
  it('renders headings, lists, and inline code from GFM markdown', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '## 标题\n\n- 一项\n- 二项 `inline`\n',
      }),
    );
    expect(html).toContain('shell-md');
    expect(html).toContain('<h2');
    expect(html).toContain('标题');
    expect(html).toContain('<li');
    expect(html).toContain('shell-md-inline-code');
    expect(html).toContain('inline');
  });

  it('renders fenced code blocks with language label and copy control', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```ts\nconst n = 1;\n```',
      }),
    );
    expect(html).toContain('shell-md-code');
    expect(html).toContain('shell-md-code__lang');
    expect(html).toContain('ts');
    expect(html).toContain('复制');
    // highlight.js splits tokens into spans; assert source pieces instead of raw line.
    expect(html).toContain('const');
    expect(html).toContain('hljs');
    expect(html).toMatch(/n\s*=\s*.*1/);
  });

  it('shows streaming caret when streaming is true', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '生成中',
        streaming: true,
      }),
    );
    expect(html).toContain('shell-md-cursor');
    expect(html).toContain('data-streaming="1"');
  });
});
