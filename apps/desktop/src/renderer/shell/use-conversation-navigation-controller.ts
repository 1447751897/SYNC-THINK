import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  navigationSlideDuration,
  navigationSlidePosition,
} from './conversation-navigation-slide.js';

interface ConversationNavigationControllerOptions {
  scopeKey: string;
  scrollerRef: RefObject<HTMLDivElement>;
  isMessageLoaded(messageId: string): boolean;
  loadAround(messageId: string, isCurrent: () => boolean): Promise<boolean>;
  onRenderTarget(messageId: string | undefined): void;
  onNavigationStart(): void;
  writeProgrammaticScroll(scroller: HTMLDivElement, scrollTop: number): void;
}

interface NavigationSlide {
  frame: number;
  from: number;
  to: number;
  startedAt: number;
  duration: number;
}

/** Owns minimap target loading, navigation intent invalidation and re-aimable slide motion. */
export function useConversationNavigationController({
  scopeKey,
  scrollerRef,
  isMessageLoaded,
  loadAround,
  onRenderTarget,
  onNavigationStart,
  writeProgrammaticScroll,
}: ConversationNavigationControllerOptions) {
  const [loadingTarget, setLoadingTarget] = useState<{
    scopeKey: string;
    messageId: string;
  }>();
  const targetTokenRef = useRef<object>();
  const intentRef = useRef(0);
  const slideRef = useRef<NavigationSlide>();

  const stop = useCallback(() => {
    const slide = slideRef.current;
    if (slide) {
      window.cancelAnimationFrame(slide.frame);
      slideRef.current = undefined;
    }
    onRenderTarget(undefined);
  }, [onRenderTarget]);

  useEffect(() => {
    intentRef.current += 1;
    targetTokenRef.current = undefined;
    return stop;
  }, [scopeKey, stop]);

  const loadTarget = useCallback(
    async (messageId: string, isCurrent: () => boolean) => {
      onRenderTarget(messageId);
      if (isMessageLoaded(messageId)) return true;
      const token = {};
      targetTokenRef.current = token;
      intentRef.current += 1;
      setLoadingTarget({ scopeKey, messageId });
      onNavigationStart();
      try {
        const loaded = await loadAround(messageId, isCurrent);
        if (!loaded) onRenderTarget(undefined);
        return loaded;
      } finally {
        if (targetTokenRef.current === token) {
          targetTokenRef.current = undefined;
          setLoadingTarget(undefined);
        }
      }
    },
    [isMessageLoaded, loadAround, onNavigationStart, onRenderTarget, scopeKey],
  );

  const navigate = useCallback(
    (_messageId: string, targetScrollTop: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      intentRef.current += 1;
      onNavigationStart();

      const reducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      const distance = targetScrollTop - scroller.scrollTop;
      if (reducedMotion || Math.abs(distance) < 1) {
        stop();
        writeProgrammaticScroll(scroller, targetScrollTop);
        window.requestAnimationFrame(() => onRenderTarget(undefined));
        return;
      }

      const inFlight = slideRef.current;
      if (inFlight) {
        inFlight.to = targetScrollTop;
        inFlight.duration = navigationSlideDuration(targetScrollTop - inFlight.from);
        return;
      }

      const slide: NavigationSlide = {
        frame: 0,
        from: scroller.scrollTop,
        to: targetScrollTop,
        startedAt: -1,
        duration: navigationSlideDuration(distance),
      };
      slideRef.current = slide;
      const step = (now: number) => {
        const currentScroller = scrollerRef.current;
        if (!currentScroller || slideRef.current !== slide) return;
        if (slide.startedAt < 0) slide.startedAt = now;
        const progress = Math.min(1, (now - slide.startedAt) / slide.duration);
        writeProgrammaticScroll(
          currentScroller,
          progress >= 1
            ? slide.to
            : navigationSlidePosition({ from: slide.from, to: slide.to, progress }),
        );
        if (progress >= 1) {
          slideRef.current = undefined;
          onRenderTarget(undefined);
          return;
        }
        slide.frame = window.requestAnimationFrame(step);
      };
      slide.frame = window.requestAnimationFrame(step);
    },
    [onNavigationStart, onRenderTarget, scrollerRef, stop, writeProgrammaticScroll],
  );

  const captureIntent = useCallback(() => intentRef.current, []);
  const isIntentCurrent = useCallback((intent: number) => intentRef.current === intent, []);

  return {
    loadingTarget: loadingTarget?.scopeKey === scopeKey ? loadingTarget.messageId : undefined,
    loadTarget,
    navigate,
    stop,
    captureIntent,
    isIntentCurrent,
  };
}
