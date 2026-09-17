/**
 * Coalesce high-frequency viewport listeners (scroll / resize) into at most one
 * callback per animation frame.
 *
 * Anchored popovers re-measure their trigger with getBoundingClientRect() on
 * every event. A single scroll gesture fires many scroll events per frame, and
 * each one costs a forced synchronous layout read on top of a React commit —
 * enough to blow the frame budget. That is what makes a menu which is merely
 * *open* drag down scrolling for the whole window. Reading once per frame
 * removes the duplicate work with no visible lag, because the popover is
 * repositioned before that frame is painted.
 *
 * Capture phase is used for `scroll` deliberately: scroll events do not bubble,
 * so anchoring to a nested scroller (the message list) requires capture. The
 * same reasoning is why this is bound to the window rather than to each
 * scroller.
 *
 * Returns a disposer which also cancels any frame still pending.
 */
export function listenForFrameCoalescedViewportChange(handler: () => void): () => void {
  let frame: number | null = null;
  const scheduled = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      handler();
    });
  };
  window.addEventListener('resize', scheduled);
  window.addEventListener('scroll', scheduled, true);
  return () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    window.removeEventListener('resize', scheduled);
    window.removeEventListener('scroll', scheduled, true);
  };
}
