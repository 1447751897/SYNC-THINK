// NewMax `DsScrollArea` 竖向变体的移植（对应 NewMax 产物里的 `DsSingleScrollArea`，
// 见 out/renderer/assets/DsScrollArea-*.js）。NewMax 的每一个菜单——包括对话框右下角
// 的模型选择——滚动区都走这个组件，所以菜单里看不到原生滚动条。
//
// 为什么必须自绘而不是只调 ::-webkit-scrollbar：
//   Windows 上 Chromium 只要容器声明了 scrollbar-width / scrollbar-color，就整体走
//   标准滚动条渲染路径并忽略 ::-webkit-scrollbar（本仓库 shell.css 里已有同样的实测
//   结论），退回带箭头的经典 ~17px 滚动条，在圆角菜单里非常突兀。这里两条路径一起
//   关掉（scrollbar-width: none + ::-webkit-scrollbar { display: none }），
//   再由本组件自绘 overlay 胶囊，就不受渲染路径影响。
//
// 常量与行为逐条对齐 NewMax：
//   thumb 5px（悬停 / 拖拽 8px）、最短 24px、右边距 2px、轨道命中宽度 12px；
//   滚动即淡入、停 1200ms 后淡出；鼠标移出容器 600ms 淡出；悬停轨道期间常驻；
//   可拖拽，点击轨道按比例跳转（刚拖完的那一次点击被吞掉）；
//   上下 24px 渐隐遮罩提示还有内容；容器 / 子元素尺寸或子节点变化后重算。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/** NewMax `THUMB_W`。 */
export const OVERLAY_SCROLL_THUMB_WIDTH = 5;
/** NewMax `THUMB_W_HOVER`。 */
export const OVERLAY_SCROLL_THUMB_WIDTH_HOVER = 8;
/** NewMax `THUMB_MARGIN`。 */
export const OVERLAY_SCROLL_THUMB_MARGIN = 2;
/** NewMax `TRACK_HIT_W`。 */
export const OVERLAY_SCROLL_TRACK_HIT_WIDTH = 12;
/** NewMax `THUMB_MIN_SIZE`。 */
export const OVERLAY_SCROLL_THUMB_MIN_SIZE = 24;
/** NewMax 用 `scrollSize > clientSize + 4` 判定可滚动，避免亚像素抖动。 */
const SCROLL_EPSILON = 4;
/** NewMax 的滚动后自动隐藏延时。 */
const SCROLL_HIDE_DELAY_MS = 1200;
/** NewMax 的鼠标移出后隐藏延时。 */
const POINTER_HIDE_DELAY_MS = 600;
/** NewMax 的渐隐遮罩判定阈值。 */
const FADE_THRESHOLD = 4;

export interface OverlayScrollAreaProps {
  children: ReactNode;
  /** 外层裁剪容器的附加类名。 */
  className?: string;
  /** 内层真实滚动元素的附加类名（padding / 行高之类挂在它上面）。 */
  innerClassName?: string;
  /** 内层滚动元素的内联样式。 */
  innerStyle?: CSSProperties;
  /** 上下渐隐遮罩的底色，默认取 `--composer-surface`。 */
  fadeColor?: string;
  /** 关掉渐隐遮罩（短列表不需要）。 */
  fadeDisabled?: boolean;
  /** 渐隐遮罩高度，默认 24px。 */
  fadeHeight?: number;
  /** 需要直接操作滚动元素时传入。 */
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
  style?: CSSProperties;
}

interface ThumbMetrics {
  offset: number;
  size: number;
  visible: boolean;
  canScroll: boolean;
}

interface ScrollMetrics {
  scrollPos: number;
  scrollSize: number;
  clientSize: number;
}

const IDLE_THUMB: ThumbMetrics = { offset: 0, size: 0, visible: false, canScroll: false };

export function OverlayScrollArea(props: OverlayScrollAreaProps) {
  const {
    children,
    className,
    innerClassName,
    innerStyle,
    fadeColor,
    fadeDisabled = false,
    fadeHeight = 24,
    scrollRef,
    style,
  } = props;

  const localScrollRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInsideRef = useRef(false);
  const draggingRef = useRef(false);
  const justDraggedRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const [thumb, setThumb] = useState<ThumbMetrics>(IDLE_THUMB);
  const [trackHovered, setTrackHovered] = useState(false);
  const [fade, setFade] = useState({ start: false, end: false });

  const assignScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      localScrollRef.current = node;
      if (scrollRef) scrollRef.current = node;
    },
    [scrollRef],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const measure = useCallback((): ScrollMetrics | null => {
    const el = localScrollRef.current;
    if (!el) return null;
    return {
      scrollPos: el.scrollTop,
      scrollSize: el.scrollHeight,
      clientSize: el.clientHeight,
    };
  }, []);

  const updateThumb = useCallback(() => {
    const metrics = measure();
    if (!metrics) return;
    const { scrollPos, scrollSize, clientSize } = metrics;
    if (clientSize <= 0 || !(scrollSize > clientSize + SCROLL_EPSILON)) {
      setThumb(IDLE_THUMB);
      return;
    }
    const size = Math.max((clientSize / scrollSize) * clientSize, OVERLAY_SCROLL_THUMB_MIN_SIZE);
    const maxOffset = clientSize - size;
    const maxScroll = scrollSize - clientSize;
    const offset = maxScroll > 0 ? (scrollPos / maxScroll) * maxOffset : 0;
    setThumb((prev) => ({
      offset,
      size,
      canScroll: true,
      // 与 NewMax 一致：这里只保留可见性，由 showThumb / 悬停去点亮它。
      visible: prev.visible || pointerInsideRef.current,
    }));
  }, [measure]);

  const checkFade = useCallback(() => {
    const metrics = measure();
    if (!metrics) return;
    const { scrollPos, scrollSize, clientSize } = metrics;
    setFade({
      start: scrollPos > FADE_THRESHOLD,
      end: scrollSize - scrollPos - clientSize > FADE_THRESHOLD,
    });
    updateThumb();
  }, [measure, updateThumb]);

  const hideSoon = useCallback(
    (delay: number) => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setThumb((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }, delay);
    },
    [clearHideTimer],
  );

  /** NewMax `showThumb`：滚动时点亮，指针不在容器内就排一次自动隐藏。 */
  const showThumb = useCallback(() => {
    clearHideTimer();
    updateThumb();
    setThumb((prev) => (prev.canScroll ? { ...prev, visible: true } : prev));
    if (!pointerInsideRef.current) hideSoon(SCROLL_HIDE_DELAY_MS);
  }, [clearHideTimer, hideSoon, updateThumb]);

  const handleScroll = useCallback(() => {
    checkFade();
    showThumb();
  }, [checkFade, showThumb]);

  // 内容变化后重算一次（NewMax 同样在 children 变化时排一个 rAF）。
  useEffect(() => {
    const frame = requestAnimationFrame(checkFade);
    return () => cancelAnimationFrame(frame);
  }, [children, checkFade]);

  // 容器 / 子元素尺寸变化，以及子节点增删，都要重算：模型列表是异步填充的，
  // 只靠 children 引用变化会漏掉「同一个数组被就地改写」的情况。
  useEffect(() => {
    const el = localScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(() => checkFade());
    resizeObserver.observe(el);
    for (const child of el.children) resizeObserver.observe(child);

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            requestAnimationFrame(checkFade);
          });
    mutationObserver?.observe(el, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [children, checkFade]);

  useEffect(
    () => () => {
      clearHideTimer();
      dragCleanupRef.current?.();
    },
    [clearHideTimer],
  );

  const handlePointerEnter = useCallback(() => {
    pointerInsideRef.current = true;
    clearHideTimer();
    const metrics = measure();
    if (!metrics) return;
    updateThumb();
    if (metrics.scrollSize > metrics.clientSize + SCROLL_EPSILON) {
      setThumb((prev) => (prev.canScroll ? { ...prev, visible: true } : prev));
    }
  }, [clearHideTimer, measure, updateThumb]);

  const handlePointerLeave = useCallback(() => {
    pointerInsideRef.current = false;
    if (draggingRef.current) return;
    hideSoon(POINTER_HIDE_DELAY_MS);
  }, [hideSoon]);

  const handleTrackEnter = useCallback(() => {
    clearHideTimer();
    setTrackHovered(true);
    setThumb((prev) => (prev.canScroll ? { ...prev, visible: true } : prev));
  }, [clearHideTimer]);

  const handleTrackLeave = useCallback(() => {
    setTrackHovered(false);
    if (draggingRef.current || pointerInsideRef.current) return;
    hideSoon(POINTER_HIDE_DELAY_MS);
  }, [hideSoon]);

  const handleThumbPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const metrics = measure();
      if (!metrics) return;
      const { scrollPos, scrollSize, clientSize } = metrics;
      const maxScroll = scrollSize - clientSize;
      if (maxScroll <= 0) return;

      const startPos = event.clientY;
      const startScroll = scrollPos;
      const thumbSize = Math.max(
        (clientSize / scrollSize) * clientSize,
        OVERLAY_SCROLL_THUMB_MIN_SIZE,
      );
      const maxThumbOffset = clientSize - thumbSize;

      draggingRef.current = true;

      const onMove = (moveEvent: PointerEvent) => {
        const scrollEl = localScrollRef.current;
        if (!scrollEl || maxThumbOffset <= 0) return;
        const delta = moveEvent.clientY - startPos;
        scrollEl.scrollTop = startScroll + (delta / maxThumbOffset) * maxScroll;
      };
      const onUp = () => {
        draggingRef.current = false;
        justDraggedRef.current = true;
        dragCleanupRef.current?.();
        if (!pointerInsideRef.current) hideSoon(SCROLL_HIDE_DELAY_MS);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      dragCleanupRef.current = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        dragCleanupRef.current = null;
      };
    },
    [hideSoon, measure],
  );

  const handleTrackClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (justDraggedRef.current) {
        justDraggedRef.current = false;
        return;
      }
      const el = localScrollRef.current;
      const metrics = measure();
      if (!el || !metrics) return;
      const { scrollSize, clientSize } = metrics;
      const maxScroll = scrollSize - clientSize;
      if (maxScroll <= 0 || clientSize <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / clientSize;
      el.scrollTop = Math.max(0, Math.min(maxScroll, ratio * maxScroll));
    },
    [measure],
  );

  const thumbActive = trackHovered || draggingRef.current;

  const mergedStyle: CSSProperties = { ...style };
  if (fadeColor) {
    (mergedStyle as Record<string, string>)['--shell-overlay-scroll-fade'] = fadeColor;
  }

  return (
    <div
      className={className ? `shell-overlay-scroll ${className}` : 'shell-overlay-scroll'}
      style={mergedStyle}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
    >
      <div
        ref={assignScrollRef}
        data-testid="overlay-scroll-inner"
        className={
          innerClassName
            ? `shell-overlay-scroll__inner ${innerClassName}`
            : 'shell-overlay-scroll__inner'
        }
        style={innerStyle}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {fadeDisabled ? null : (
        <>
          <div
            aria-hidden="true"
            data-testid="overlay-scroll-fade-start"
            className={`shell-overlay-scroll__fade is-start${fade.start ? ' is-visible' : ''}`}
            style={{ height: fadeHeight }}
          />
          <div
            aria-hidden="true"
            data-testid="overlay-scroll-fade-end"
            className={`shell-overlay-scroll__fade is-end${fade.end ? ' is-visible' : ''}`}
            style={{ height: fadeHeight }}
          />
        </>
      )}
      {thumb.canScroll ? (
        <div
          aria-hidden="true"
          data-testid="overlay-scroll-track"
          className="shell-overlay-scroll__track"
          style={{ width: OVERLAY_SCROLL_TRACK_HIT_WIDTH }}
          onClick={handleTrackClick}
          onMouseEnter={handleTrackEnter}
          onMouseLeave={handleTrackLeave}
        >
          <div
            data-testid="overlay-scroll-thumb"
            className={`shell-overlay-scroll__thumb${thumbActive ? ' is-active' : ''}`}
            style={{
              top: thumb.offset,
              right: OVERLAY_SCROLL_THUMB_MARGIN,
              height: thumb.size,
              width: thumbActive ? OVERLAY_SCROLL_THUMB_WIDTH_HOVER : OVERLAY_SCROLL_THUMB_WIDTH,
              opacity: thumb.visible ? 1 : 0,
            }}
            onPointerDown={handleThumbPointerDown}
          />
        </div>
      ) : null}
    </div>
  );
}
