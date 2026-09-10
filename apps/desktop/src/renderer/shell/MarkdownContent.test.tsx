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
    expect(shellCss).toMatch(/\.shell-md-table-scroll\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(shellCss).toMatch(
      /\.shell-md th,\s*\.shell-md td\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*word-break:\s*normal;/s,
    );
  });

  it('renders NewMax-style unframed tables with a copy action', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '| Run | 内核 |\n| --- | --- |\n| Q2N5RF | codex |',
      }),
    );
    expect(html).toContain('shell-md-table-wrap');
    expect(html).toContain('shell-md-table-toolbar');
    expect(html).toContain('aria-label="复制表格"');
    expect(html).toContain('shell-md-table-cell--atomic');
    expect(shellCss).toMatch(/\.shell-md-table-wrap\s*\{[^}]*border:\s*0;/s);
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
    expect(html).toContain('shell-mermaid__canvas');
    expect(html).toContain('正在渲染图表');
  });

  it('renders the mermaid block without card chrome (NewMax parity)', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --> B\n```',
      }),
    );
    expect(html).toContain('data-testid="mermaid-canvas"');
    expect(html).not.toContain('shell-mermaid__bar');
    expect(html).not.toContain('shell-html__collapse');
    expect(html).not.toContain('复制源码');
    expect(html).not.toContain('预览');
  });

  it('renders a streaming mermaid block immediately like NewMax', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```mermaid\nflowchart LR\n  A --',
        streaming: true,
      }),
    );
    expect(html).toContain('shell-mermaid');
    expect(html).toContain('mermaid-canvas');
  });

  it('keeps syntax highlighting and distinguishes writing from settled code', () => {
    const text = '```ts\nconst answer = true;\n```';
    const streamingHtml = renderToStaticMarkup(
      createElement(MarkdownContent, { text, streaming: true }),
    );
    const settledHtml = renderToStaticMarkup(
      createElement(MarkdownContent, { text, streaming: false }),
    );

    expect(streamingHtml).toContain('hljs-keyword');
    expect(streamingHtml).toContain('生成中');
    expect(settledHtml).toContain('已完成');
    expect(settledHtml).toContain('hljs-keyword');
  });

  it('renders a fenced html block inside a fixed-height sanitized iframe', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello</div>\n```',
      }),
    );
    expect(html).toContain('shell-html');
    expect(html).toContain('shell-html__content');
    expect(html).toContain('srcDoc=');
    expect(html).toContain('sandbox="allow-scripts"');
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
    expect(html).toContain('下载');
    expect(html).toContain('复制');
    expect(html).toContain('浏览器打开');
    expect(html).toContain('shell-html__collapse');
  });

  it('renders a streaming html block immediately like NewMax', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello',
        streaming: true,
      }),
    );
    expect(html).toContain('shell-html--fenced');
    expect(html).toContain('shell-html__content');
  });

  it('sanitizes a complete html document before putting it into srcDoc', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body style="background:#222">x</body>\n</html>\n```',
      }),
    );
    expect(html).toContain('shell-html--fenced');
    expect(html).toContain('srcDoc=');
    expect(html).toContain('background:#222');
  });

  it('renders a bare html fragment in srcDoc', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<div id="app">Hello</div>\n```',
      }),
    );
    expect(html).toContain('shell-html--fenced');
    expect(html).toContain('srcDoc=');
    expect(html).toContain('Hello');
  });

  it('previews design drafts as NewMax HtmlPreview html fences', () => {
    const design = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```html\n<main>Design surface</main>\n```',
        projectFolder: 'D:/work/demo',
      }),
    );
    const leftover = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```design-html\n<main>Legacy draft</main>\n```',
        projectFolder: 'D:/work/demo',
      }),
    );
    const jsonKit = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```design-ui\n{"version":1,"type":"ui-design","title":"x","nodes":[]}\n```',
      }),
    );

    expect(design).toContain('shell-html--fenced');
    expect(design).toContain('srcDoc=');
    expect(design).toContain('Design surface');
    expect(design).not.toContain('shell-html--design');
    expect(design).not.toContain('保存到项目');
    expect(design).not.toContain('UI 设计资源格式无效');
    expect(leftover).toContain('shell-html--fenced');
    expect(leftover).toContain('Legacy draft');
    expect(jsonKit).not.toContain('UI 设计资源格式无效');
    expect(jsonKit).not.toContain('shell-html--fenced');
    expect(jsonKit).toContain('shell-md-code');
  });

  it('leaves standalone design-html tags as ordinary markup', () => {
    const tagged = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '<design-html>\n<main>Tagged design</main>\n</design-html>',
      }),
    );

    expect(tagged).not.toContain('shell-html--design');
    expect(tagged).not.toContain('data-testid="html-sandbox"');
    expect(tagged).not.toContain('html-sandbox-content');
  });

  it('renders a file-backed inline visualization between Markdown segments', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '可视化结果：\n\n::newmax-inline-vis{file="overview.html"}\n\n以上为实时预览。',
        projectFolder: 'D:/work/demo',
        conversationId: 'conv-inline-vis',
      }),
    );

    expect(html).toContain('shell-inline-vis');
    expect(html).toContain('data-file="overview.html"');
    expect(html).toContain('可视化结果');
    expect(html).toContain('以上为实时预览');
  });

  it('keeps inline visualization directives passive when interactive embeds are disabled', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '::codex-inline-vis{file="overview.html"}',
        interactiveEmbeds: false,
      }),
    );

    expect(html).toContain('shell-md-code');
    expect(html).toContain('newmax-inline-vis');
    expect(html).not.toContain('shell-inline-vis');
  });

  it('does not execute a visualization directive inside a fenced code block', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '```md\n::newmax-inline-vis{file="overview.html"}\n```',
        projectFolder: 'D:/work/demo',
      }),
    );

    expect(html).toContain('shell-md-code');
    expect(html).toContain('newmax-inline-vis');
    expect(html).not.toContain('shell-inline-vis');
  });

  it('renders generated images with a NewMax model caption and zoom target', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: [
          '图像已生成并保存。',
          '模型：gpt-image-2',
          '',
          '![生成的图片](sync-think-image://generated/a.png)',
        ].join('\n'),
      }),
    );
    expect(html).toContain('data-testid="generated-image-frame"');
    expect(html).toContain('生图模型 · gpt-image-2');
    expect(html).toContain('sync-think-image://generated/a.png');
    expect(html).toContain('aria-label="放大查看"');
    expect(html).toContain('aria-label="复制图片"');
    expect(html).toContain('aria-label="下载原图"');
    expect(shellCss).toMatch(/\.shell-md-image[^{]*\{[^}]*cursor:\s*zoom-in;/s);
    expect(shellCss).toMatch(
      /\.shell-stage-layer\[data-active='false'\]:not\(\[hidden\]\) \*\s*\{[^}]*visibility:\s*inherit;/,
    );
  });

  it('uses NewMax imageModelBySrc when the answer only keeps the image', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '![生成的图片](sync-think-image://generated/a.png)',
        imageModelBySrc: new Map([['sync-think-image://generated/a.png', 'gpt-image-2']]),
      }),
    );
    expect(html).toContain('生图模型 · gpt-image-2');
  });

  it('keeps the model caption when react-markdown decodes a generated-image path', () => {
    const absolute = 'D:\\work\\.sync-think\\generated-images\\card.png';
    const encoded = `sync-think-image://generated/${encodeURIComponent(absolute)}`;
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: ['模型：gpt-image-2', '', `![生成的图片](${encoded})`].join('\n'),
      }),
    );
    expect(html).toContain('生图模型 · gpt-image-2');
  });
});
