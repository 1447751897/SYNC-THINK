import { useEffect, type RefObject } from 'react';

/** Only acknowledge rendered results at the live end of the active, foreground view. */
export function useVisibleResults({
  viewport,
  active,
  ready,
  runIds,
  onViewed,
}: {
  viewport: RefObject<HTMLElement>;
  active: boolean;
  ready: boolean;
  runIds: readonly string[];
  onViewed?: (runIds: readonly string[]) => void;
}) {
  const key = JSON.stringify(runIds);
  useEffect(() => {
    const el = viewport.current;
    if (!el || !active || !ready || !onViewed) return;
    const acknowledge = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 48) return;
      onViewed?.(JSON.parse(key) as string[]);
    };
    el.addEventListener('scroll', acknowledge, { passive: true });
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(acknowledge);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    acknowledge();
    return () => {
      el.removeEventListener('scroll', acknowledge);
      window.removeEventListener('focus', acknowledge);
      document.removeEventListener('visibilitychange', acknowledge);
      observer?.disconnect();
    };
  }, [viewport, active, ready, key, onViewed]);
}
