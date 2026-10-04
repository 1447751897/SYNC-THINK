import { describe, expect, it } from 'vitest';
import { htmlBrowserSourceMatches, isDeferredHtmlPreview, htmlSourcePathFromMarkdown } from './html-browser.js';

const projectFolder = 'D:/projects/demo';

describe('htmlSourcePathFromMarkdown', () => {
  it('preserves a saved filename rather than inventing a preview filename', () => {
    expect(
      htmlSourcePathFromMarkdown(
        '已保存到 `D:\\projects\\demo\\pelican-cycling.html`。',
        projectFolder,
      ),
    ).toBe('pelican-cycling.html');
  });

  it('accepts a project Markdown link, including a filename with spaces', () => {
    expect(
      htmlSourcePathFromMarkdown(
        '[网页](<D:/projects/demo/pages/coastal ride.htm>)',
        projectFolder,
      ),
    ).toBe('pages/coastal ride.htm');
  });

  it('ignores paths embedded in closed or unfinished code blocks', () => {
    const prose = '`pelican-cycling.html`\n\n';
    expect(
      htmlSourcePathFromMarkdown(
        prose + '```html\n<script>const path = `other.html`;</script>\n```',
        projectFolder,
      ),
    ).toBe('pelican-cycling.html');
    expect(
      htmlSourcePathFromMarkdown(
        prose + '```html\n<script>const path = `other.html`;',
        projectFolder,
      ),
    ).toBe('pelican-cycling.html');
  });

  it('does not guess between different referenced files', () => {
    expect(
      htmlSourcePathFromMarkdown('`first.html` 和 `second.html`', projectFolder),
    ).toBeUndefined();
  });

  it('recognizes repeated references to the same Windows file', () => {
    expect(
      htmlSourcePathFromMarkdown(
        '`D:/projects/demo/Pelican.html`，再看 [页面](pelican.html)',
        projectFolder,
      ),
    ).toBe('pelican.html');
  });

  it.each([
    '`D:/other/page.html`',
    '`../page.html`',
    '[页面](https://example.com/page.html)',
    '`notes.txt`',
  ])('ignores non-project HTML references: %s', (markdown) => {
    expect(htmlSourcePathFromMarkdown(markdown, projectFolder)).toBeUndefined();
  });

  it('requires a bound project', () => {
    expect(htmlSourcePathFromMarkdown('`page.html`')).toBeUndefined();
  });
});


describe('deferred HTML browser source', () => {
  const prefix = '<!doctype html><html><head><style>body { background: beige;';
  const full = prefix + ' }</style></head><body><svg></svg></body></html>';
  const partial = prefix + '\n[预览；完整内容按需读取]';

  it('recognizes the history projection marker, including CRLF and fence whitespace', () => {
    expect(isDeferredHtmlPreview(partial + '\r\n')).toBe(true);
    expect(isDeferredHtmlPreview(partial.replace(/\n/g, '\r\n'))).toBe(true);
    expect(isDeferredHtmlPreview('<main>[预览；完整内容按需读取]</main>')).toBe(false);
  });
  it('matches a truncated prefix to a complete original without treating it as a full document', () => {
    expect(htmlBrowserSourceMatches(partial, full)).toBe(true);
    expect(htmlBrowserSourceMatches(partial, full.replace(/\n/g, '\r\n'))).toBe(true);
    expect(htmlBrowserSourceMatches(full + '\n', full)).toBe(true);
  });
  it('rejects unrelated, marker-only or still-truncated disk content', () => {
    expect(htmlBrowserSourceMatches(partial, '<main>another document</main>')).toBe(false);
    expect(htmlBrowserSourceMatches('[预览；完整内容按需读取]', full)).toBe(false);
    expect(htmlBrowserSourceMatches(partial, partial)).toBe(false);
    expect(htmlBrowserSourceMatches(prefix, full)).toBe(false);
  });
});
