import { describe, expect, it } from 'vitest';
import { splitUserMessageLinks, webLinkLabel, webLinkVisibleLabel } from './user-message-links.js';

describe('splitUserMessageLinks', () => {
  it('keeps plain text as a single text part', () => {
    expect(splitUserMessageLinks('看看这个组件')).toEqual([
      { type: 'text', value: '看看这个组件' },
    ]);
  });

  it('splits a URL glued to Chinese so the address becomes its own link', () => {
    expect(
      splitUserMessageLinks(
        'https://beui.dev/components/agents/message-scroller看一下我现在sync-think的message-scroller和他这个网页的有什么区别',
      ),
    ).toEqual([
      { type: 'url', value: 'https://beui.dev/components/agents/message-scroller' },
      {
        type: 'text',
        value: '看一下我现在sync-think的message-scroller和他这个网页的有什么区别',
      },
    ]);
  });

  it('keeps surrounding copy and strips trailing punctuation from the URL', () => {
    expect(splitUserMessageLinks('参考 https://example.com/docs. 再对比。')).toEqual([
      { type: 'text', value: '参考 ' },
      { type: 'url', value: 'https://example.com/docs' },
      { type: 'text', value: '. 再对比。' },
    ]);
  });

  it('uses the last path segment as a compact web-link label', () => {
    expect(webLinkLabel('https://beui.dev/components/agents/message-scroller')).toBe(
      'message-scroller',
    );
    expect(webLinkLabel('https://example.com/')).toBe('example.com');
    expect(webLinkLabel('https://www.openai.com/docs/index.html')).toBe('docs');
  });

  it('keeps markdown link text and hides a pasted raw URL behind the compact label', () => {
    expect(
      webLinkVisibleLabel('https://developers.openai.com/api/docs/models/gpt-5.6-luna', 'GPT-5.6 Luna 能力说明'),
    ).toBe('GPT-5.6 Luna 能力说明');
    expect(
      webLinkVisibleLabel(
        'https://beui.dev/components/agents/message-scroller',
        'https://beui.dev/components/agents/message-scroller',
      ),
    ).toBe('message-scroller');
  });
});
