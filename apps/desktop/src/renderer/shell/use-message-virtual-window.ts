import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from 'react';
import { buildMessageOffsets, calculateMessageWindow } from './message-window.js';

/** Small histories stay fully mounted; windowing starts where DOM growth becomes material. */
export const MESSAGE_VIRTUALIZATION_THRESHOLD = 80;

interface MessageVirtualWindowOptions {
  ids: readonly string[];
  scrollerRef: RefObject<HTMLDivElement>;
  forcedTargetId?: string;
}

interface MessageVirtualWindow {
  startIndex: number;
  endIndex: number;
  topSpacer: number;
  bottomSpacer: number;
  virtualized: boolean;
  rowRef(id: string): RefCallback<HTMLDivElement>;
  syncViewport(): void;
}

interface ViewportSnapshot {
  scrollTop: number;
  height: number;
}

/**
 * Keeps variable-height conversation history to a bounded DOM window.
 * Business state remains in ChatView; this hook owns only viewport geometry.
 */
export function useMessageVirtualWindow({
  ids,
  scrollerRef,
  forcedTargetId,
}: MessageVirtualWindowOptions): MessageVirtualWindow {
  const measuredHeightsRef = useRef(new Map<string, number>());
  const rowNodesRef = useRef(new Map<string, HTMLDivElement>());
  const rowCallbacksRef = useRef(new Map<string, RefCallback<HTMLDivElement>>());
  const resizeObserverRef = useRef<ResizeObserver>();
  const frameRef = useRef<number | null>(null);
  const [, setMeasurementRevision] = useState(0);
  const [viewport, setViewport] = useState<ViewportSnapshot>({ scrollTop: 0, height: 0 });

  const recordRowHeight = useCallback((id: string, node: HTMLDivElement) => {
    const height = node.getBoundingClientRect().height;
    if (height <= 0 || Math.abs((measuredHeightsRef.current.get(id) ?? 0) - height) < 0.5) return;
    measuredHeightsRef.current.set(id, height);
    setMeasurementRevision((revision) => revision + 1);
  }, []);

  const rowRef = useCallback(
    (id: string): RefCallback<HTMLDivElement> => {
      const cached = rowCallbacksRef.current.get(id);
      if (cached) return cached;
      const callback: RefCallback<HTMLDivElement> = (node) => {
        const previous = rowNodesRef.current.get(id);
        if (previous && previous !== node) resizeObserverRef.current?.unobserve(previous);
        if (!node) {
          rowNodesRef.current.delete(id);
          return;
        }
        rowNodesRef.current.set(id, node);
        recordRowHeight(id, node);
        resizeObserverRef.current?.observe(node);
      };
      rowCallbacksRef.current.set(id, callback);
      return callback;
    },
    [recordRowHeight],
  );

  const readViewport = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = { scrollTop: scroller.scrollTop, height: scroller.clientHeight };
    setViewport((previous) =>
      Math.abs(previous.scrollTop - next.scrollTop) < 0.5 &&
      Math.abs(previous.height - next.height) < 0.5
        ? previous
        : next,
    );
  }, [scrollerRef]);

  const scheduleViewportRead = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      readViewport();
    });
  }, [readViewport]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    readViewport();
    scroller.addEventListener('scroll', scheduleViewportRead, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              if (entry.target === scroller) continue;
              const node = entry.target as HTMLDivElement;
              const id = node.dataset.virtualMessageId;
              if (id) recordRowHeight(id, node);
            }
            scheduleViewportRead();
          });
    resizeObserverRef.current = observer;
    observer?.observe(scroller);
    for (const node of rowNodesRef.current.values()) observer?.observe(node);
    return () => {
      scroller.removeEventListener('scroll', scheduleViewportRead);
      observer?.disconnect();
      if (resizeObserverRef.current === observer) resizeObserverRef.current = undefined;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [readViewport, recordRowHeight, scheduleViewportRead, scrollerRef]);

  useLayoutEffect(() => {
    const currentIds = new Set(ids);
    let changed = false;
    for (const id of measuredHeightsRef.current.keys()) {
      if (currentIds.has(id)) continue;
      measuredHeightsRef.current.delete(id);
      rowCallbacksRef.current.delete(id);
      changed = true;
    }
    if (changed) setMeasurementRevision((revision) => revision + 1);
    readViewport();
  }, [ids, readViewport]);

  if (ids.length <= MESSAGE_VIRTUALIZATION_THRESHOLD) {
    return {
      startIndex: 0,
      endIndex: ids.length,
      topSpacer: 0,
      bottomSpacer: 0,
      virtualized: false,
      rowRef,
      syncViewport: readViewport,
    };
  }

  const targetIndex = forcedTargetId ? ids.indexOf(forcedTargetId) : -1;
  let scrollTop = viewport.scrollTop;
  if (targetIndex >= 0) {
    const offsets = buildMessageOffsets(ids, measuredHeightsRef.current);
    const targetTop = offsets[targetIndex] ?? 0;
    const targetBottom = offsets[targetIndex + 1] ?? targetTop;
    scrollTop = Math.max(0, (targetTop + targetBottom - viewport.height) / 2);
  }
  const range = calculateMessageWindow({
    ids,
    measuredHeights: measuredHeightsRef.current,
    scrollTop,
    viewportHeight: viewport.height,
  });
  return { ...range, virtualized: true, rowRef, syncViewport: readViewport };
}
