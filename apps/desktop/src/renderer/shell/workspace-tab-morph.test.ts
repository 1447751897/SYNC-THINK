import { describe, expect, it } from 'vitest';
import {
  applyVisibleReorder,
  moveItem,
  pointerDragLeft,
  railWidth,
  slotLefts,
  tabTranslate,
  targetIndexForDrag,
  visualIndexFor,
} from './workspace-tab-morph.js';

describe('workspace tab morph geometry', () => {
  it('slides later tabs backward when a tab is dragged right', () => {
    expect(visualIndexFor(0, 0, 2)).toBe(2);
    expect(visualIndexFor(1, 0, 2)).toBe(0);
    expect(visualIndexFor(2, 0, 2)).toBe(1);
  });

  it('slides earlier tabs forward when a tab is dragged left', () => {
    expect(visualIndexFor(2, 2, 0)).toBe(0);
    expect(visualIndexFor(0, 2, 0)).toBe(1);
    expect(visualIndexFor(1, 2, 0)).toBe(2);
  });

  it('keeps slots and the rail width aligned to the NewMax tab pitch', () => {
    expect(slotLefts(3, 100, 3)).toEqual([0, 103, 206]);
    expect(railWidth(3, 100, 3)).toBe(306);
    expect(tabTranslate(103)).toBe('translate3d(103px, 0, 0)');
  });

  it('crosses the next slot when the dragged tab centre reaches it', () => {
    const slots = slotLefts(3, 100, 0);
    expect(targetIndexForDrag(49, 0, slots, 100)).toBe(0);
    expect(targetIndexForDrag(50, 0, slots, 100)).toBe(1);
    expect(targetIndexForDrag(40, 1, slots, 100)).toBe(0);
  });

  it('keeps the same target slot while the pointer stays in that slot', () => {
    const first = pointerDragLeft(260, 80, 0, 172, 3);
    const still = pointerDragLeft(270, 80, 0, 172, 3);
    expect(first.targetIndex).toBe(1);
    expect(still.targetIndex).toBe(1);
    expect(still.dragLeft).toBeGreaterThan(first.dragLeft);
  });

  it('reorders only the visible strip and leaves overflow ids in place', () => {
    expect(applyVisibleReorder(['a', 'b', 'c', 'd'], ['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
});
