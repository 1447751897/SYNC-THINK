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

  it('leaves the production cap wide enough to keep opened tabs alive', () => {
    // NewMax 对「已激活过的会话标签」没有数量上限；SYNC-THINK 的上限只是病态兜底，
    // 必须不低于一个 pane 实际能开出的标签数，否则又会出现「开第 9 个就把第 1 个卸掉」。
    expect(RETAINED_CONVERSATION_LIMIT).toBeGreaterThanOrEqual(24);
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
});
