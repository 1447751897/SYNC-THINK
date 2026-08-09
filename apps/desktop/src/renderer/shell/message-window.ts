export type BottomPinIntent = 'toward-bottom' | 'away-from-bottom' | null;

export function inferNativeScrollIntent(input: {
  previousScrollTop: number;
  nextScrollTop: number;
  epsilon?: number;
}): BottomPinIntent {
  const epsilon = Math.max(0, input.epsilon ?? 0.5);
  const delta = input.nextScrollTop - input.previousScrollTop;
  if (delta < -epsilon) return 'away-from-bottom';
  if (delta > epsilon) return 'toward-bottom';
  return null;
}

export function shouldRestorePrependAnchor(input: {
  capturedUserScrollRevision: number;
  currentUserScrollRevision: number;
  hasAnchor: boolean;
}): boolean {
  return (
    input.hasAnchor &&
    input.capturedUserScrollRevision === input.currentUserScrollRevision
  );
}

export function resolveBottomPinState(input: {
  currentlyPinned: boolean;
  distanceFromBottom: number;
  userIntent: BottomPinIntent;
  threshold?: number;
}): boolean {
  const threshold = Math.max(0, input.threshold ?? 80);
  // Even a small explicit upward gesture must release the pin immediately. Without
  // this branch, a wheel tick inside the threshold is pulled straight back down.
  if (input.userIntent === 'away-from-bottom') return false;
  // A growing streaming bubble can increase scrollHeight before the next layout
  // effect writes the new bottom scrollTop. That transient distance is not user
  // intent and must not release an existing pin.
  if (input.currentlyPinned && input.userIntent === null) return true;
  // Once the user has scrolled away, proximity alone must not reactivate
  // pinning; only an explicit gesture toward the bottom may do so.
  return input.userIntent === 'toward-bottom' && input.distanceFromBottom < threshold;
}

export function preservePrependScrollTop(input: {
  previousScrollTop: number;
  previousScrollHeight: number;
  nextScrollHeight: number;
}): number {
  return Math.max(
    0,
    input.previousScrollTop + (input.nextScrollHeight - input.previousScrollHeight),
  );
}

export function visualAnchorScrollAdjustment(input: {
  previousViewportOffset: number;
  nextViewportOffset: number;
}): number {
  return input.nextViewportOffset - input.previousViewportOffset;
}

export const MESSAGE_WINDOW_ESTIMATED_HEIGHT = 220;
export const MESSAGE_WINDOW_OVERSCAN_PX = 900;

export interface MessageWindowRange {
  startIndex: number;
  endIndex: number;
  topSpacer: number;
  bottomSpacer: number;
  totalHeight: number;
}

export function buildMessageOffsets(
  ids: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  estimatedHeight = MESSAGE_WINDOW_ESTIMATED_HEIGHT,
): number[] {
  const fallback = Math.max(1, estimatedHeight);
  const offsets = new Array<number>(ids.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const measured = measuredHeights.get(ids[index]!);
    offsets[index + 1] = offsets[index]! + (measured && measured > 0 ? measured : fallback);
  }
  return offsets;
}

function firstItemEndingAfter(offsets: readonly number[], target: number): number {
  const itemCount = Math.max(0, offsets.length - 1);
  let low = 0;
  let high = itemCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle + 1] ?? 0) <= target) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, itemCount - 1));
}

function firstItemStartingAtOrAfter(offsets: readonly number[], target: number): number {
  const itemCount = Math.max(0, offsets.length - 1);
  let low = 0;
  let high = itemCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return Math.min(itemCount, low);
}

export function calculateMessageWindow(input: {
  ids: readonly string[];
  measuredHeights: ReadonlyMap<string, number>;
  scrollTop: number;
  viewportHeight: number;
  estimatedHeight?: number;
  overscanPx?: number;
}): MessageWindowRange {
  const offsets = buildMessageOffsets(
    input.ids,
    input.measuredHeights,
    input.estimatedHeight,
  );
  const itemCount = input.ids.length;
  const totalHeight = offsets[itemCount] ?? 0;
  if (itemCount === 0) {
    return { startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0, totalHeight: 0 };
  }
  const overscan = Math.max(0, input.overscanPx ?? MESSAGE_WINDOW_OVERSCAN_PX);
  const visibleTop = Math.max(0, input.scrollTop - overscan);
  const visibleBottom = Math.min(
    totalHeight,
    Math.max(0, input.scrollTop) + Math.max(0, input.viewportHeight) + overscan,
  );
  const startIndex = firstItemEndingAfter(offsets, visibleTop);
  const endIndex = Math.max(
    startIndex + 1,
    firstItemStartingAtOrAfter(offsets, visibleBottom),
  );
  return {
    startIndex,
    endIndex: Math.min(itemCount, endIndex),
    topSpacer: offsets[startIndex] ?? 0,
    bottomSpacer: Math.max(0, totalHeight - (offsets[Math.min(itemCount, endIndex)] ?? totalHeight)),
    totalHeight,
  };
}
