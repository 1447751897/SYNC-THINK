import { describe, expect, it } from 'vitest';
import {
  emptyPaneRetainedSurfaces,
  rememberRetainedKey,
  retainPaneSurface,
  RETAINED_CONVERSATION_LIMIT,
  shouldMountRetainedSurface,
} from './surface-keep-alive.js';

describe('surface keep-alive', () => {
  it('keeps an inactive surface mounted after it has been opened', () => {
    expect(shouldMountRetainedSurface('c1', false, [])).toBe(false);
    expect(shouldMountRetainedSurface('c1', true, [])).toBe(true);
    expect(shouldMountRetainedSurface('c1', false, ['c1'])).toBe(true);
    expect(shouldMountRetainedSurface('c2', false, ['c1'])).toBe(false);
  });

  it('keeps no conversation DOM alive (DSH route)', () => {
    // DeepSeek Harness 不保活会话 DOM：切换即卸载，位置由无上限的
    // conversationScrollPositions map 在重挂载时恢复。会话面上限必须是 0
    // ——任何大于 0 的值都会让旧 DOM 常驻，重新引入「隐藏容器 scrollTop 被钳位」
    // 的位置漂移问题。
    expect(RETAINED_CONVERSATION_LIMIT).toBe(0);
  });

  it('bounds retained conversation keys like a small LRU', () => {
    // 用显式 limit：这条测的是 `rememberRetainedKey` 的语义，不该跟着生产上限走
    // （生产上限已经按 NewMax 语义放到「标签能开多少就保活多少」）。
    const limit = 8;
    let retained: string[] = [];
    for (let index = 1; index <= limit + 2; index += 1) {
      retained = rememberRetainedKey(retained, `c${index}`, limit);
    }
    expect(retained).toHaveLength(limit);
    expect(retained[0]).toBe('c3');
    expect(retained.at(-1)).toBe('c10');
    expect(retained.includes('c1')).toBe(false);
  });

  it('moves a revisited key to the newest slot', () => {
    const retained = rememberRetainedKey(['c1', 'c2', 'c3'], 'c1', 8);
    expect(retained).toEqual(['c2', 'c3', 'c1']);
  });

  it('records the active conversation on a pane without dropping other kinds', () => {
    const next = retainPaneSurface(emptyPaneRetainedSurfaces(), 'conversations', 'c1', 8);
    expect(next.conversations).toEqual(['c1']);
    expect(next.files).toEqual([]);
  });

  it('retains nothing when the limit is zero (DSH conversation route)', () => {
    // The conversation limit is 0: rememberRetainedKey never adds a key under
    // a non-positive limit, so the retained set can only stay empty in
    // practice — only the currently active conversation ever mounts.
    expect(rememberRetainedKey([], 'c1', 0)).toEqual([]);
    expect(rememberRetainedKey([], 'c1', RETAINED_CONVERSATION_LIMIT)).toEqual([]);
  });
});
