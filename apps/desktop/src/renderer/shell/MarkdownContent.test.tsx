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
    expect(html).toContain('shell-md-section__toggle');
    expect(html).toContain('aria-expanded="true"');
  });

  it('keeps level-two markers inside fenced code as code instead of sections', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```md\n## 只是代码\n```',
      }),
    );
    expect(html).toContain('只是代码');
    expect(html).not.toContain('shell-md-section__toggle');
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

  it('shows inline expand controls for long fenced code without a fullscreen action', () => {
    const lines = Array.from({ length: 14 }, (_, index) => `const line${index} = ${index};`).join('\n');
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: `\`\`\`ts\n${lines}\n\`\`\``,
      }),
    );
    expect(html).toContain('shell-md-code__collapse');
    expect(html).toContain('展开全部 14 行');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('放大查看代码');
    expect(html).not.toContain('shell-md-code-lightbox');
  });

  it('keeps short fenced code compact without unnecessary expand controls', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```json\n{"ok":true}\n```',
      }),
    );
    expect(html).not.toContain('放大查看代码');
    expect(html).not.toContain('展开全部');
    expect(html).not.toContain('shell-md-code__collapse');
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
