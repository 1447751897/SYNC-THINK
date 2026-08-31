import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface HighlightGeometry {
  top: number;
  height: number;
  visible: boolean;
}

export function ComposerMenuHighlight({
  containerRef,
  activeIndex,
}: {
  containerRef: RefObject<HTMLElement | null>;
  activeIndex: number;
}) {
  const highlightRef = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<HighlightGeometry>({
    top: 0,
    height: 0,
    visible: false,
  });

  const measure = useCallback(() => {
    const container = containerRef.current ?? highlightRef.current?.parentElement;
    const active = container?.querySelector<HTMLElement>(
      `[data-composer-menu-index="${activeIndex}"]`,
    );
    if (!container || !active) {
      setGeometry((current) => (current.visible ? { ...current, visible: false } : current));
      return;
    }
    const next = { top: active.offsetTop, height: active.offsetHeight, visible: true };
    setGeometry((current) =>
      current.top === next.top && current.height === next.height && current.visible === next.visible
        ? current
        : next,
    );
  }, [activeIndex, containerRef]);

  useLayoutEffect(measure);

  useEffect(() => {
    const container = containerRef.current ?? highlightRef.current?.parentElement;
    if (!container) return;
    const snap = () => measure();
    window.addEventListener('resize', snap);
    container.addEventListener('scroll', snap, { passive: true });
    return () => {
      window.removeEventListener('resize', snap);
      container.removeEventListener('scroll', snap);
    };
  }, [containerRef, measure]);

  return (
    <span
      ref={highlightRef}
      className="shell-composer-menu__highlight"
      data-testid="composer-menu-highlight"
      aria-hidden="true"
      style={{
        height: `${geometry.height}px`,
        opacity: geometry.visible ? 1 : 0,
        transform: `translateY(${geometry.top}px)`,
      }}
    />
  );
}
