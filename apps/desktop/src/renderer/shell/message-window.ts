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

/**
 * Follow the live conversation tail whenever the user is still pinned.
 * Think, commentary, and tool rows all count — not only the final answer.
 * `stickToBottom` is enforced by the pin function itself.
 */
export function shouldFollowConversationContentResize(_input?: {
  streaming?: boolean;
  hasAnswerText?: boolean;
}): boolean {
  return true;
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

/** Matches NewMax `STICK_TO_BOTTOM_THRESHOLD_PX`. */
export const CONVERSATION_STICK_THRESHOLD_PX = 100;
/** Matches NewMax `SCROLL_UP_JITTER_PX`. */
export const CONVERSATION_SCROLL_UP_JITTER_PX = 1;

export function isConversationNearBottom(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = CONVERSATION_STICK_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}

/**
 * NewMax only treats an upward wheel as "user left the tail" after the viewport
 * is already away from the bottom. A tick while still glued to the tail must
 * not unpin — html/mermaid layout and nested webview wheels also emit deltaY<0.
 */
export function shouldReleaseStickOnWheel(input: {
  deltaY: number;
  nearBottom: boolean;
}): boolean {
  return input.deltaY < 0 && !input.nearBottom;
}

/**
 * NewMax `StickToBottomTracker.onScrollEvent`:
 * - still at the tail → stick
 * - our own pin/programmatic write → keep current stick
 * - scrollTop dropped while reading history → unstick
 *
 * html/mermaid/content-visibility often clamp scrollTop downward while the
 * reader is still at the tail. That must not be treated as a scrollbar drag.
 */
export function applyConversationStickOnScroll(input: {
  sticky: boolean;
  programmaticPending: boolean;
  previousScrollTop: number | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  threshold?: number;
  jitter?: number;
}): { sticky: boolean; programmaticPending: boolean } {
  const threshold = input.threshold ?? CONVERSATION_STICK_THRESHOLD_PX;
  const jitter = input.jitter ?? CONVERSATION_SCROLL_UP_JITTER_PX;
  if (isConversationNearBottom(input, threshold)) {
    return { sticky: true, programmaticPending: false };
  }
  if (input.programmaticPending) {
    return { sticky: input.sticky, programmaticPending: false };
  }
  if (
    input.previousScrollTop !== null &&
    input.scrollTop < input.previousScrollTop - jitter
  ) {
    return { sticky: false, programmaticPending: false };
  }
  return { sticky: input.sticky, programmaticPending: false };
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
