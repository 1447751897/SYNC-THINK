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

  it('bounds retained conversation keys like a small LRU', () => {
    let retained: string[] = [];
    for (let index = 1; index <= RETAINED_CONVERSATION_LIMIT + 2; index += 1) {
      retained = rememberRetainedKey(retained, `c${index}`, RETAINED_CONVERSATION_LIMIT);
    }
    expect(retained).toHaveLength(RETAINED_CONVERSATION_LIMIT);
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
