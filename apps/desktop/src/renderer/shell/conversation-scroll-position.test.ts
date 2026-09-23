/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureConversationScrollPosition,
  readConversationScrollPosition,
  restoreConversationScrollPosition,
  writeConversationScrollPosition,
} from './conversation-scroll-position.js';

const storageKey = 'sync-think.conversationScrollPositions';

beforeEach(() => {
  window.localStorage.removeItem(storageKey);
  readConversationScrollPosition('reset-cache');
});

function scrollerGeometry(scrollTop = 0): {
  scroller: HTMLDivElement;
  readScrollTop: () => number;
} {
  const scroller = document.createElement('div');
  let currentScrollTop = scrollTop;
  Object.defineProperties(scroller, {
    scrollTop: {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = value;
      },
    },
    scrollHeight: { configurable: true, get: () => 1_000 },
    clientHeight: { configurable: true, get: () => 300 },
  });
  scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  return { scroller, readScrollTop: () => currentScrollTop };
}

describe('conversation scroll position', () => {
  it('persists detached position snapshots', () => {
    const position = { scrollTop: 240, stickToBottom: false, anchorOffset: 12 };
    writeConversationScrollPosition('conversation-a', position);
    position.scrollTop = 999;

    expect(readConversationScrollPosition('conversation-a')).toEqual({
      scrollTop: 240,
      stickToBottom: false,
      anchorOffset: 12,
    });
    expect(window.localStorage.getItem(storageKey)).toContain('conversation-a');
  });

  it('ignores malformed persisted entries', () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ broken: { scrollTop: -1, stickToBottom: 'yes', anchorOffset: 0 } }),
    );
    expect(readConversationScrollPosition('broken')).toBeUndefined();
  });

  it('captures the first visible message as the viewport anchor', () => {
    const { scroller } = scrollerGeometry(320);
    const hidden = document.createElement('div');
    hidden.dataset.messageId = 'hidden';
    hidden.getBoundingClientRect = () => ({ top: 20, bottom: 80 }) as DOMRect;
    const visible = document.createElement('div');
    visible.dataset.messageId = 'visible';
    visible.getBoundingClientRect = () => ({ top: 135, bottom: 180 }) as DOMRect;
    scroller.append(hidden, visible);

    expect(captureConversationScrollPosition(scroller, false)).toEqual({
      scrollTop: 320,
      stickToBottom: false,
      anchorMessageId: 'visible',
      anchorOffset: 35,
    });
  });

  it('restores by anchor, saved offset, or tail according to available state', () => {
    const { scroller, readScrollTop } = scrollerGeometry(300);
    const anchor = document.createElement('div');
    anchor.dataset.messageId = 'anchor';
    anchor.getBoundingClientRect = () => ({ top: 180 }) as DOMRect;
    scroller.append(anchor);

    restoreConversationScrollPosition(scroller, {
      scrollTop: 450,
      stickToBottom: false,
      anchorMessageId: 'anchor',
      anchorOffset: 30,
    });
    expect(readScrollTop()).toBe(350);

    restoreConversationScrollPosition(scroller, {
      scrollTop: 900,
      stickToBottom: false,
      anchorMessageId: 'missing',
      anchorOffset: 0,
    });
    expect(readScrollTop()).toBe(700);

    restoreConversationScrollPosition(scroller, {
      scrollTop: 0,
      stickToBottom: true,
      anchorOffset: 0,
    });
    expect(readScrollTop()).toBe(700);
  });
});
