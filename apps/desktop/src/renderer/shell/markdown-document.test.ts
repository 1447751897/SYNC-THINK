/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from './markdown-document.js';

describe('markdown document conversion', () => {
  it('round-trips headings, lists, emphasis and tables', () => {
    const source = [
      '# Preview title',
      '',
      'Hello **world** and *now*',
      '',
      '- First item',
      '- Second item',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| Cache | 42 |',
    ].join('\n');

    const html = markdownToHtml(source);
    expect(html).toContain('<h1>Preview title</h1>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<li>');
    expect(html).toContain('<table>');
    expect(html).toContain('Cache');

    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain('# Preview title');
    expect(markdown).toContain('**world**');
    expect(markdown).toContain('- First item');
    expect(markdown).toContain('| Cache | 42 |');
  });

  it('keeps an empty document as a blank paragraph', () => {
    expect(markdownToHtml('')).toBe('<p><br></p>');
    expect(htmlToMarkdown('<p><br></p>')).toBe('');
  });
});
