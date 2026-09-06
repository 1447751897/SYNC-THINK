import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export const WORKSPACE_TAB_DRAG_THRESHOLD = 5;
export const WORKSPACE_TAB_MORPH_GAP = 3;

type DragSession = {
  id: string;
  pointerId: number;
  originX: number;
  startLeft: number;
  startIndex: number;
  targetIndex: number;
  moved: boolean;
  finishing: boolean;
  startVisible: string[];
  slotLefts: number[];
};

function samePointer(sessionId: number, eventId: number): boolean {
  if (!sessionId || !eventId) return true;
  return sessionId === eventId;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function moveItem(order: readonly string[], from: number, to: number): string[] {
  if (from === to) return order.slice();
  const next = order.slice();
  const [item] = next.splice(from, 1);
  if (!item) return order.slice();
  next.splice(to, 0, item);
  return next;
}

/** beUI Morphing Tabs: siblings slide into the vacancy while a tab is dragged. */
export function visualIndexFor(
  index: number,
  dragStartIndex: number,
  dragTargetIndex: number,
): number {
  if (dragStartIndex < 0 || dragTargetIndex < 0) return index;
  if (index === dragStartIndex) return dragTargetIndex;

  if (
    dragTargetIndex > dragStartIndex &&
    index > dragStartIndex &&
    index <= dragTargetIndex
  ) {
    return index - 1;
  }
  if (
    dragTargetIndex < dragStartIndex &&
    index >= dragTargetIndex &&
    index < dragStartIndex
  ) {
    return index + 1;
  }
  return index;
}

export function slotLefts(count: number, tabWidth: number, gap = WORKSPACE_TAB_MORPH_GAP): number[] {
  return Array.from({ length: count }, (_, index) => index * (tabWidth + gap));
}

export function railWidth(count: number, tabWidth: number, gap = WORKSPACE_TAB_MORPH_GAP): number {
  if (count <= 0) return 0;
  return count * tabWidth + Math.max(0, count - 1) * gap;
}

export function targetIndexForDrag(
  visualLeft: number,
  startIndex: number,
  slots: readonly number[],
  tabWidth: number,
): number {
  let targetIndex = startIndex;
  const startLeft = slots[startIndex] ?? 0;
  if (visualLeft >= startLeft) {
    for (let index = startIndex + 1; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot !== undefined && visualLeft + tabWidth / 2 >= slot) {
        targetIndex = index;
      }
    }
  } else {
    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const slot = slots[index];
      if (slot !== undefined && visualLeft <= slot + tabWidth / 2) {
        targetIndex = index;
      }
    }
  }
  return targetIndex;
}

export function applyVisibleReorder(
  fullOrder: readonly string[],
  visibleIds: readonly string[],
  nextVisibleIds: readonly string[],
): string[] {
  if (visibleIds.length !== nextVisibleIds.length) return fullOrder.slice();
  const visibleSet = new Set(visibleIds);
  const nextQueue = nextVisibleIds.slice();
  return fullOrder.map((id) => (visibleSet.has(id) ? (nextQueue.shift() ?? id) : id));
}

export function tabTranslate(left: number): string {
  return `translate3d(${left}px, 0, 0)`;
}

/** Pointer-slot drag: follow the cursor and pick a target from geometry, not hovered DOM. */
export function pointerDragLeft(
  clientX: number,
  originX: number,
  startIndex: number,
  tabWidth: number,
  count: number,
  gap = WORKSPACE_TAB_MORPH_GAP,
): { dragLeft: number; targetIndex: number } {
  const slots = slotLefts(count, tabWidth, gap);
  const startLeft = slots[startIndex] ?? 0;
  const minLeft = slots[0] ?? 0;
  const maxLeft = slots[slots.length - 1] ?? minLeft;
  const dragLeft = Math.max(minLeft, Math.min(maxLeft, startLeft + (clientX - originX)));
  return {
    dragLeft,
    targetIndex: targetIndexForDrag(dragLeft, startIndex, slots, tabWidth),
  };
}

export function useMorphingWorkspaceTabs(input: {
  visibleIds: readonly string[];
  fullOrder: readonly string[];
  tabWidth: number;
  activeId?: string;
  onSelect(id: string): void;
  onReorder(ids: string[]): void;
}) {
  const visibleRef = useRef(input.visibleIds);
  const fullOrderRef = useRef(input.fullOrder);
  const tabWidthRef = useRef(input.tabWidth);
  const activeIdRef = useRef(input.activeId);
  const onSelectRef = useRef(input.onSelect);
  const onReorderRef = useRef(input.onReorder);
  visibleRef.current = input.visibleIds;
  fullOrderRef.current = input.fullOrder;
  tabWidthRef.current = input.tabWidth;
  activeIdRef.current = input.activeId;
  onSelectRef.current = input.onSelect;
  onReorderRef.current = input.onReorder;

  const dragRef = useRef<DragSession | null>(null);
  const ignoreClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState(-1);
  const [dragLeft, setDragLeft] = useState(0);

  const slots = slotLefts(input.visibleIds.length, input.tabWidth);
  const dragStartIndex = draggingId ? input.visibleIds.indexOf(draggingId) : -1;

  const leftFor = useCallback(
    (id: string) => {
      const index = input.visibleIds.indexOf(id);
      if (index < 0) return 0;
      if (id === draggingId) return dragLeft;
      return slots[visualIndexFor(index, dragStartIndex, dragTargetIndex)] ?? 0;
    },
    [dragLeft, dragStartIndex, dragTargetIndex, draggingId, input.visibleIds, slots],
  );

  const activeIndex = input.activeId ? input.visibleIds.indexOf(input.activeId) : -1;
  const surfaceSlot =
    activeIndex < 0 ? -1 : visualIndexFor(activeIndex, dragStartIndex, dragTargetIndex);
  const surfaceLeft =
    input.activeId && input.activeId === draggingId
      ? dragLeft
      : (slots[surfaceSlot] ?? 0);

  const startDrag = useCallback((id: string, event: ReactPointerEvent) => {
    if (event.button !== 0 || dragRef.current) return;
    const visible = visibleRef.current;
    const startIndex = visible.indexOf(id);
    if (startIndex < 0) return;
    const capturedSlots = slotLefts(visible.length, tabWidthRef.current);
    const startLeft = capturedSlots[startIndex] ?? 0;
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      originX: event.clientX,
      startLeft,
      startIndex,
      targetIndex: startIndex,
      moved: false,
      finishing: false,
      startVisible: visible.slice(),
      slotLefts: capturedSlots,
    };
  }, []);

  const moveDrag = useCallback((event: { pointerId: number; clientX: number; preventDefault(): void }) => {
    const drag = dragRef.current;
    if (!drag || drag.finishing || !samePointer(drag.pointerId, event.pointerId)) return;
    const delta = event.clientX - drag.originX;
    if (!drag.moved && Math.abs(delta) < WORKSPACE_TAB_DRAG_THRESHOLD) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      setDraggingId(drag.id);
      setDragTargetIndex(drag.startIndex);
    }
    const minLeft = drag.slotLefts[0] ?? 0;
    const maxLeft = drag.slotLefts[drag.slotLefts.length - 1] ?? minLeft;
    const visualLeft = Math.max(minLeft, Math.min(maxLeft, drag.startLeft + delta));
    const nextTarget = targetIndexForDrag(
      visualLeft,
      drag.startIndex,
      drag.slotLefts,
      tabWidthRef.current,
    );
    setDragLeft(visualLeft);
    if (nextTarget !== drag.targetIndex) {
      drag.targetIndex = nextTarget;
      setDragTargetIndex(nextTarget);
    }
  }, []);

  const finishDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.finishing || !samePointer(drag.pointerId, pointerId)) return;
    if (!drag.moved) {
      dragRef.current = null;
      return;
    }
    drag.finishing = true;
    ignoreClickRef.current = true;
    const nextVisible = moveItem(drag.startVisible, drag.startIndex, drag.targetIndex);
    const nextFull = applyVisibleReorder(fullOrderRef.current, drag.startVisible, nextVisible);
    dragRef.current = null;
    setDraggingId(null);
    setDragTargetIndex(-1);
    if (!sameOrder(fullOrderRef.current, nextFull)) {
      onReorderRef.current(nextFull);
    }
  }, []);

  useEffect(() => {
    const moveFromWindow = (event: PointerEvent) => {
      moveDrag(event);
    };
    const finishFromWindow = (event: PointerEvent) => {
      finishDrag(event.pointerId);
    };
    window.addEventListener('pointermove', moveFromWindow, true);
    window.addEventListener('pointerup', finishFromWindow, true);
    window.addEventListener('pointercancel', finishFromWindow, true);
    return () => {
      window.removeEventListener('pointermove', moveFromWindow, true);
      window.removeEventListener('pointerup', finishFromWindow, true);
      window.removeEventListener('pointercancel', finishFromWindow, true);
    };
  }, [finishDrag, moveDrag]);

  const moveBy = useCallback((id: string, direction: -1 | 1) => {
    const visible = visibleRef.current;
    const index = visible.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= visible.length) return;
    const nextVisible = moveItem(visible, index, nextIndex);
    const nextFull = applyVisibleReorder(fullOrderRef.current, visible, nextVisible);
    if (!sameOrder(fullOrderRef.current, nextFull)) {
      onReorderRef.current(nextFull);
    }
  }, []);

  const handleKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent) => {
      const visible = visibleRef.current;
      const index = visible.indexOf(id);
      if (index < 0) return;
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        moveBy(id, event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const nextId = visible[(index + direction + visible.length) % visible.length];
      if (nextId) onSelectRef.current(nextId);
    },
    [moveBy],
  );

  return {
    draggingId,
    leftFor,
    surfaceLeft,
    surfaceSlot,
    railWidth: railWidth(input.visibleIds.length, input.tabWidth),
    startDrag,
    moveDrag,
    finishDrag,
    handleKeyDown,
    consumeClick() {
      if (!ignoreClickRef.current) return false;
      ignoreClickRef.current = false;
      return true;
    },
  };
}
