export interface ConversationScrollPosition {
  scrollTop: number;
  stickToBottom: boolean;
  anchorMessageId?: string;
  anchorOffset: number;
}

const STORAGE_KEY = 'sync-think.conversationScrollPositions';

/**
 * Conversation DOM is not kept alive across navigation. Keep every known position so a later
 * remount can restore it; intentionally do not add an eviction policy here.
 */
const positions = new Map<string, ConversationScrollPosition>();

function loadPositions(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Partial<ConversationScrollPosition>;
      if (
        typeof item.scrollTop !== 'number' ||
        !Number.isFinite(item.scrollTop) ||
        item.scrollTop < 0 ||
        typeof item.stickToBottom !== 'boolean' ||
        typeof item.anchorOffset !== 'number' ||
        !Number.isFinite(item.anchorOffset)
      ) {
        continue;
      }
      positions.set(key, {
        scrollTop: item.scrollTop,
        stickToBottom: item.stickToBottom,
        anchorOffset: item.anchorOffset,
        ...(typeof item.anchorMessageId === 'string' && item.anchorMessageId
          ? { anchorMessageId: item.anchorMessageId }
          : {}),
      });
    }
  } catch {
    // A malformed or inaccessible local snapshot must not block conversation rendering.
  }
}

export function readConversationScrollPosition(
  key: string,
): ConversationScrollPosition | undefined {
  if (typeof window !== 'undefined') {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) positions.clear();
    } catch {
      // Storage can be unavailable in private or restricted renderer contexts.
    }
  }
  if (positions.size === 0) loadPositions();
  const value = positions.get(key);
  return value ? { ...value } : undefined;
}

export function writeConversationScrollPosition(
  key: string,
  value: ConversationScrollPosition,
): void {
  positions.delete(key);
  positions.set(key, { ...value });
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Storage can be unavailable in private or restricted renderer contexts.
  }
}

export function captureConversationScrollPosition(
  scroller: HTMLDivElement,
  stickToBottom: boolean,
): ConversationScrollPosition {
  const viewportTop = scroller.getBoundingClientRect().top;
  let anchorMessageId: string | undefined;
  let anchorOffset = 0;
  for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= viewportTop) continue;
    anchorMessageId = node.dataset.messageId;
    anchorOffset = rect.top - viewportTop;
    break;
  }
  return {
    scrollTop: Math.max(0, scroller.scrollTop),
    stickToBottom,
    anchorOffset,
    ...(anchorMessageId ? { anchorMessageId } : {}),
  };
}

export function restoreConversationScrollPosition(
  scroller: HTMLDivElement,
  position: ConversationScrollPosition,
): void {
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (position.stickToBottom) {
    scroller.scrollTop = maxScrollTop;
    return;
  }
  const anchor = position.anchorMessageId
    ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (node) => node.dataset.messageId === position.anchorMessageId,
      )
    : undefined;
  if (anchor) {
    const viewportTop = scroller.getBoundingClientRect().top;
    const currentOffset = anchor.getBoundingClientRect().top - viewportTop;
    scroller.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scroller.scrollTop + currentOffset - position.anchorOffset),
    );
    return;
  }
  scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, position.scrollTop));
}
