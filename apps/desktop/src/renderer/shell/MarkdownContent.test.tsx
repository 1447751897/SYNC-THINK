import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent.js';

const shellCss = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

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

  it('keeps short table tokens intact while wide tables remain scrollable', () => {
    expect(shellCss).toMatch(/\.shell-md-table-wrap\s*\{[^}]*overflow:\s*auto;/s);
    expect(shellCss).toMatch(
      /\.shell-md th,\s*\.shell-md td\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*word-break:\s*normal;/s,
    );
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
    const lines = Array.from({ length: 14 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: `\`\`\`ts\n${lines}\n\`\`\``,
      }),
    );
    expect(html).toContain('shell-md-code is-expandable is-collapsed');
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
    expect(html).toContain('shell-md-code is-collapsed');
    expect(html).not.toContain('is-expandable');
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

  it('renders a fenced mermaid block as a chart (loading state under SSR)', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B\n```',
      }),
    );
    expect(html).toContain('shell-mermaid');
    expect(html).toContain('shell-mermaid__bar');
    expect(html).toContain('正在渲染图表');
  });

  it('offers collapse + preview/source views on the mermaid card', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B\n```',
      }),
    );
    expect(html).toContain('shell-html__collapse');
    expect(html).toContain('预览');
    expect(html).toContain('源码');
    expect(html).toContain('复制源码');
    expect(html).toContain('aria-label="放大查看图表"');
  });

  it('keeps a streaming mermaid block as code until the block completes', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --',
        streaming: true,
      }),
    );
    expect(html).not.toContain('shell-mermaid');
    expect(html).toContain('shell-md-code');
  });

  it('defers syntax highlighting until the streaming response settles', () => {
    const text = '```ts\nconst answer = true;\n```';
    const streamingHtml = renderToStaticMarkup(
      createElement(MarkdownContent, { text, streaming: true }),
    );
    const settledHtml = renderToStaticMarkup(
      createElement(MarkdownContent, { text, streaming: false }),
    );

    expect(streamingHtml).not.toContain('hljs-keyword');
    expect(settledHtml).toContain('hljs-keyword');
  });

  it('renders a fenced html block inside the sandbox webview', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello</div>\n```',
      }),
    );
    expect(html).toContain('shell-html');
    expect(html).toContain('data:text/html');
    expect(html).toContain('html-sandbox');
    const src = html.match(/src="([^"]*)"/)?.[1] ?? '';
    const decoded = decodeURIComponent(src);
    expect(decoded).toContain('html,body{margin:0}');
    expect(decoded).toContain('background-color:');
    expect(decoded).not.toContain('body{min-height:100vh}');
  });

  it('keeps fenced html passive when embedded in a local file preview', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<script>fetch("https://example.test/beacon")</script>\n```',
        interactiveEmbeds: false,
      }),
    );
    expect(html).toContain('shell-md-code');
    expect(html).toContain('fetch');
    expect(html).not.toContain('html-sandbox');
    expect(html).not.toContain('data:text/html');
  });

  it('offers a preview/source view switcher on the html sandbox', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<p>hi</p>\n```',
      }),
    );
    expect(html).toContain('shell-html__bar');
    expect(html).toContain('预览');
    expect(html).toContain('源码');
    expect(html).toContain('刷新');
    expect(html).toContain('复制');
    expect(html).toContain('浏览器打开');
    expect(html).toContain('shell-html__collapse');
  });

  it('keeps a streaming html block as code until the block completes', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello',
        streaming: true,
      }),
    );
    expect(html).not.toContain('shell-html');
    expect(html).toContain('shell-md-code');
  });

  it('injects the viewport and canvas style into the head of a complete html document', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body style="background:#222">x</body>\n</html>\n```',
      }),
    );
    // The webview src is a percent-encoded data: URL — decode before asserting
    // on the guest document structure.
    const src = html.match(/src="([^"]*)"/)?.[1] ?? '';
    const decoded = decodeURIComponent(src);
    const headPos = decoded.indexOf('</head>');
    const fillPos = decoded.indexOf('<style>html,body{margin:0}');
    expect(headPos).toBeGreaterThan(-1);
    expect(fillPos).toBeGreaterThan(-1);
    expect(fillPos).toBeLessThan(headPos);
    // The viewport meta keeps the guest layout width tied to the webview
    // element so the preview layout matches a real browser tab.
    expect(decoded).toContain('name="viewport"');
    expect(decoded.indexOf('name="viewport"')).toBeLessThan(headPos);
  });

  it('wraps a bare html fragment with viewport and canvas styles in the head', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello</div>\n```',
      }),
    );
    const src = html.match(/src="([^"]*)"/)?.[1] ?? '';
    const decoded = decodeURIComponent(src);
    const headPos = decoded.indexOf('<head>');
    const fillPos = decoded.indexOf('<style>html,body{margin:0}');
    expect(headPos).toBeGreaterThan(-1);
    expect(fillPos).toBeGreaterThan(-1);
    expect(fillPos).toBeGreaterThan(headPos);
    expect(fillPos).toBeLessThan(decoded.indexOf('<body>'));
    expect(decoded).toContain('name="viewport"');
    expect(decoded).not.toContain('body{min-height:100vh}');
  });
});
