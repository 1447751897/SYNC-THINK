import { memo } from 'react';

export interface ScrollToBottomButtonProps {
  /** Driven by the scroller's own distance from the tail, never by a timer. */
  visible: boolean;
  /** The assistant produced more output while the reader was away from the tail. */
  unread: boolean;
  onScrollToBottom(): void;
}

/**
 * Floating "jump to latest" control pinned to the bottom of the message
 * viewport. It stays mounted and transitions in and out, so a reader who
 * scrolled up into history always has one obvious way back to the live tail
 * instead of hunting for the scrollbar or a minimap tick.
 *
 * It lives inside `shell-chat-message-stage`, whose `position: relative` keeps
 * the button glued to the message area rather than to the composer row below it.
 */
export const ScrollToBottomButton = memo(function ScrollToBottomButton({
  visible,
  unread,
  onScrollToBottom,
}: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      className="shell-scroll-to-bottom"
      data-testid="scroll-to-bottom"
      data-visible={visible ? 'true' : 'false'}
      data-unread={unread ? 'true' : undefined}
      aria-label={unread ? '回到底部，有新内容' : '回到底部'}
      // Hidden means gone for both the pointer and the tab order; the stylesheet
      // fades it out rather than unmounting it, so the transition can play.
      aria-hidden={visible ? undefined : 'true'}
      tabIndex={visible ? 0 : -1}
      onClick={onScrollToBottom}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M3.5 6 8 10.5 12.5 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unread ? <span className="shell-scroll-to-bottom__dot" aria-hidden="true" /> : null}
    </button>
  );
});
