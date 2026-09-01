import { describe, expect, it } from 'vitest';
import {
  deriveDesignDraftPath,
  MAX_DESIGN_HTML_BYTES,
  normalizeTaggedDesignHtmlBlocks,
  parseDesignHtml,
} from './design-draft.js';

describe('design draft parsing', () => {
  it('accepts a complete HTML document and derives a stable project path', () => {
    const source = `<!doctype html>
<html>
  <head><title>Aurora Dashboard</title></head>
  <body><main>Ready</main></body>
</html>`;

    expect(parseDesignHtml(source)).toEqual({ ok: true, html: source });
    expect(deriveDesignDraftPath(source)).toBe('designs/aurora-dashboard.html');
  });

  it.each([
    ['', '设计稿内容为空'],
    ['   \n', '设计稿内容为空'],
    ['only prose', '设计稿必须包含 HTML 元素'],
    ['<main><section>unfinished</main>', 'HTML 标签未正确闭合'],
    ['<design-html><main>nested</main></design-html>', '设计稿中不能嵌套 design-html 标记'],
  ])('rejects invalid design output without treating it as HTML: %j', (source, error) => {
    expect(parseDesignHtml(source)).toEqual({ ok: false, error });
  });

  it('ignores angle brackets inside closed style and script raw-text elements', () => {
    const source = `<main id="app"></main>
<style>.card::before { content: "<"; }</style>
<script>if (1 < 2) document.querySelector('#app').innerHTML = '<section>Ready</section>';</script>`;

    expect(parseDesignHtml(source)).toEqual({ ok: true, html: source });
  });

  it('rejects truncated markup and payloads above the project write limit', () => {
    expect(parseDesignHtml('<main><div</main>')).toEqual({
      ok: false,
      error: 'HTML 标签未正确闭合',
    });
    const oversized = `<main>${'a'.repeat(MAX_DESIGN_HTML_BYTES)}</main>`;
    expect(parseDesignHtml(oversized)).toEqual({
      ok: false,
      error: '设计稿超过 1MB，无法预览或保存',
    });
  });

  it('accepts an ASCII HTML payload exactly at the 1MB write limit', () => {
    const envelope = '<main></main>';
    const atLimit = `<main>${'a'.repeat(MAX_DESIGN_HTML_BYTES - envelope.length)}</main>`;
    expect(parseDesignHtml(atLimit)).toEqual({ ok: true, html: atLimit });
  });

  it('normalizes an explicit tagged block without touching the same tag inside a fence', () => {
    const markdown = `Before

<design-html>
<main>Preview</main>
</design-html>

\`\`\`html
<design-html>
<main>ordinary HTML sample</main>
</design-html>
\`\`\``;

    const normalized = normalizeTaggedDesignHtmlBlocks(markdown);
    expect(normalized).toContain('```design-html\n<main>Preview</main>\n```');
    expect(normalized).toContain(
      '```html\n<design-html>\n<main>ordinary HTML sample</main>\n</design-html>\n```',
    );
  });

  it('leaves an unterminated tagged block visible for error recovery', () => {
    const markdown = '<design-html>\n<main>still streaming</main>';
    expect(normalizeTaggedDesignHtmlBlocks(markdown)).toBe(markdown);
  });
});
