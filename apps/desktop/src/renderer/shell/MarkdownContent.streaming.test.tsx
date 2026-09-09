/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent.js';

afterEach(cleanup);

describe('MarkdownContent streaming rich blocks', () => {
  it('keeps the fenced HTML preview when streaming finishes', () => {
    const view = render(
      <MarkdownContent text={'before\n\n```html\n<div>preview</div>\n```'} streaming />,
    );
    expect(view.container.querySelector('iframe')).toBeTruthy();
    view.rerender(
      <MarkdownContent text={'before\n\n```html\n<div>preview</div>\n```'} streaming={false} />,
    );
    expect(view.container.querySelector('iframe')).toBeTruthy();
    expect(view.container.querySelector('.shell-html--fenced')).toBeTruthy();
  });
});
