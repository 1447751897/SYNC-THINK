import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { formatMessageAbsoluteTime, formatMessageClock } from './execution-process.js';

export interface ConversationNavigationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** User prompt paired with this assistant turn; never rendered as a separate tick. */
  promptText?: string;
  commentaryText?: string;
  processStatus?: string;
  timestamp: string;
}

interface ConversationNavigationLayout {
  id: string;
  contentTop: number;
}

interface ConversationMinimapRailProps {
  items: readonly ConversationNavigationItem[];
  scrollerRef: RefObject<HTMLDivElement>;
  onNavigate(itemId: string, targetScrollTop: number): void;
}

const READING_FOCUS_RATIO = 0.25;
const NAVIGATION_LAYOUT_WARMUP_FRAMES = 2;
const NAVIGATION_CORRECTION_FRAMES = 2;
const MINIMAP_VERTICAL_INSET_PX = 8;
const COMPACT_NAVIGATION_EDGE_PX = 16;
const COMPACT_NAVIGATION_MAX_GAP_PX = 18;
const COMPACT_NAVIGATION_MIN_GAP_PX = 6;
const COMPACT_NAVIGATION_GAP_DECAY_PX = 1.75;
const COMPACT_NAVIGATION_MAX_HIT_HEIGHT_PX = 8;
const COMPACT_NAVIGATION_MIN_HIT_HEIGHT_PX = 3;
const COMPACT_NAVIGATION_MAX_HOVER_DISTANCE_PX = 6;
const MINIMAP_TOOLTIP_SAFE_EDGE_PX = 72;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function summarizeText(value: string | undefined, max = 92): string {
  const text = compactText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function primarySummary(item: ConversationNavigationItem): string {
  return (
    summarizeText(item.text) ||
    summarizeText(item.commentaryText) ||
    summarizeText(item.processStatus) ||
    '空消息'
  );
}

/**
 * Collapse a chronological message list into one navigation item per assistant
 * turn. Consecutive user messages are retained as the prompt preview for the
 * next assistant response rather than consuming separate rail positions.
 */
export function buildAssistantTurnNavigationItems(
  items: readonly ConversationNavigationItem[],
): ConversationNavigationItem[] {
  const result: ConversationNavigationItem[] = [];
  let pendingPrompts: string[] = [];

  for (const item of items) {
    if (item.role === 'user') {
      const prompt = compactText(item.text);
      if (prompt) pendingPrompts.push(prompt);
      continue;
    }
    if (item.role !== 'assistant') continue;

    const pairedPrompt = pendingPrompts.join('\n');
    result.push({
      ...item,
      role: 'assistant',
      ...(pairedPrompt ? { promptText: pairedPrompt } : {}),
    });
    pendingPrompts = [];
  }

  return result;
}

/**
 * Center turn markers independently from reply height. Sparse threads use a
 * relaxed rhythm; each additional turn gradually tightens the gap. If the
 * preferred rhythm no longer fits, the entire group compresses symmetrically
 * inside the safe track edges.
 */
export function buildCompactNavigationTops(itemCount: number, trackHeight: number): number[] {
  if (itemCount <= 0) return [];
  if (trackHeight > 0 && itemCount === 1) return [trackHeight / 2];

  const preferredGap = clamp(
    COMPACT_NAVIGATION_MAX_GAP_PX -
      Math.log2(Math.max(1, itemCount)) * COMPACT_NAVIGATION_GAP_DECAY_PX,
    COMPACT_NAVIGATION_MIN_GAP_PX,
    COMPACT_NAVIGATION_MAX_GAP_PX,
  );
  const usableHeight =
    trackHeight > 0
      ? Math.max(0, trackHeight - COMPACT_NAVIGATION_EDGE_PX * 2)
      : Math.max(0, itemCount - 1) * preferredGap;
  const gap =
    itemCount <= 1 ? 0 : Math.min(preferredGap, usableHeight / Math.max(1, itemCount - 1));
  const groupHeight = Math.max(0, itemCount - 1) * gap;
  const groupTop =
    trackHeight > 0
      ? Math.max(COMPACT_NAVIGATION_EDGE_PX, (trackHeight - groupHeight) / 2)
      : COMPACT_NAVIGATION_EDGE_PX;

  return Array.from({ length: itemCount }, (_unused, index) => groupTop + index * gap);
}

function findMessageNode(scroller: HTMLDivElement, itemId: string): HTMLElement | undefined {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (candidate) => candidate.dataset.messageId === itemId,
  );
}

function messageContentTop(
  scroller: HTMLDivElement,
  node: HTMLElement,
  scrollerRect = scroller.getBoundingClientRect(),
): number {
  return node.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop;
}

/**
 * Codex-style message minimap. The rail is a viewport overlay rather than a
 * second scrollbar: ticks map to message positions, expose a compact preview,
 * and jump without changing the width of the conversation column.
 */
export function ConversationMinimapRail({
  items,
  scrollerRef,
  onNavigate,
}: ConversationMinimapRailProps) {
  const [trackHeight, setTrackHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | undefined>(items[0]?.id);
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const animationFrameRef = useRef<number | null>(null);
  const navigationFrameRef = useRef<number | null>(null);
  const navigationGenerationRef = useRef(0);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || items.length === 0) {
      setTrackHeight(0);
      setActiveId(undefined);
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const measuredTrackHeight = Math.max(0, scroller.clientHeight - MINIMAP_VERTICAL_INSET_PX * 2);
    setTrackHeight((previous) =>
      Math.abs(previous - measuredTrackHeight) < 0.5 ? previous : measuredTrackHeight,
    );
    if (scroller.dataset.navigationSettling === 'true') return;

    const measured = items.flatMap((item): ConversationNavigationLayout[] => {
      const node = findMessageNode(scroller, item.id);
      if (!node) return [];
      const contentTop = messageContentTop(scroller, node, scrollerRect);
      return [
        {
          id: item.id,
          contentTop,
        },
      ];
    });

    const maximumScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    let closest: ConversationNavigationLayout | undefined;
    if (scroller.scrollTop <= 1) {
      closest = measured[0];
    } else if (maximumScrollTop - scroller.scrollTop <= 1) {
      closest = measured.at(-1);
    } else {
      const readingFocus = scroller.scrollTop + scroller.clientHeight * READING_FOCUS_RATIO;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of measured) {
        const distance = Math.abs(candidate.contentTop - readingFocus);
        if (distance >= closestDistance) continue;
        closest = candidate;
        closestDistance = distance;
      }
    }
    setActiveId((previous) => (previous === closest?.id ? previous : closest?.id));
  }, [items, scrollerRef]);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    scroller.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);
    observer?.observe(scroller);
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      observer?.observe(node);
    }
    scheduleMeasure();

    return () => {
      scroller.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      observer?.disconnect();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      navigationGenerationRef.current += 1;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
        navigationFrameRef.current = null;
      }
      delete scroller.dataset.navigationSettling;
    };
  }, [items, scheduleMeasure, scrollerRef]);

  const positionedItems = useMemo(() => {
    const tops = buildCompactNavigationTops(items.length, trackHeight);
    const visualGap =
      tops.length > 1
        ? Math.max(0, (tops[1] ?? COMPACT_NAVIGATION_MAX_HIT_HEIGHT_PX) - (tops[0] ?? 0))
        : COMPACT_NAVIGATION_MAX_HIT_HEIGHT_PX;
    const hitHeight = clamp(
      visualGap,
      COMPACT_NAVIGATION_MIN_HIT_HEIGHT_PX,
      COMPACT_NAVIGATION_MAX_HIT_HEIGHT_PX,
    );
    return items.map((item, index) => ({
      item,
      top: tops[index] ?? COMPACT_NAVIGATION_EDGE_PX,
      hitHeight,
    }));
  }, [items, trackHeight]);
  const hoveredItem = items.find((item) => item.id === hoveredId);
  const hoveredPosition = positionedItems.find(({ item }) => item.id === hoveredId);

  const navigate = useCallback(
    (itemId: string) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      if (!findMessageNode(scroller, itemId)) return;

      navigationGenerationRef.current += 1;
      const generation = navigationGenerationRef.current;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
        navigationFrameRef.current = null;
      }

      // Offscreen message rows use content-visibility for long-thread performance.
      // Their intrinsic estimates can differ substantially from the real height
      // (large HTML/Mermaid/tool results are common), so measuring and scrolling in
      // the same frame can leave the requested message thousands of pixels away.
      // Briefly warm the loaded rows, then correct the anchor over two frames.
      scroller.dataset.navigationSettling = 'true';
      setActiveId(itemId);
      let warmupFrames = NAVIGATION_LAYOUT_WARMUP_FRAMES;
      let correctionFrames = NAVIGATION_CORRECTION_FRAMES;

      const settleNavigation = () => {
        if (generation !== navigationGenerationRef.current) return;
        const currentScroller = scrollerRef.current;
        if (!currentScroller) return;

        if (warmupFrames > 0) {
          warmupFrames -= 1;
          navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
          return;
        }

        const node = findMessageNode(currentScroller, itemId);
        if (!node) {
          delete currentScroller.dataset.navigationSettling;
          navigationFrameRef.current = null;
          return;
        }
        const contentTop = messageContentTop(currentScroller, node);
        const maximum = Math.max(0, currentScroller.scrollHeight - currentScroller.clientHeight);
        const target = clamp(
          Math.round(contentTop - currentScroller.clientHeight * READING_FOCUS_RATIO),
          0,
          maximum,
        );
        setActiveId(itemId);
        onNavigate(itemId, target);

        if (correctionFrames > 0) {
          correctionFrames -= 1;
          navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
          return;
        }

        delete currentScroller.dataset.navigationSettling;
        navigationFrameRef.current = null;
        scheduleMeasure();
      };

      navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
    },
    [onNavigate, scheduleMeasure, scrollerRef],
  );

  const closestItemAtPointer = useCallback(
    (clientY: number, rail: HTMLElement): ConversationNavigationItem | undefined => {
      const railRect = rail.getBoundingClientRect();
      if (railRect.height <= 0 || positionedItems.length === 0) return undefined;
      const pointerTop = clamp(clientY - railRect.top, 0, railRect.height);
      let closest = positionedItems[0];
      let closestDistance = Math.abs((closest?.top ?? 0) - pointerTop);
      for (const candidate of positionedItems.slice(1)) {
        const distance = Math.abs(candidate.top - pointerTop);
        if (distance >= closestDistance) continue;
        closest = candidate;
        closestDistance = distance;
      }
      const hoverDistance = Math.min(
        COMPACT_NAVIGATION_MAX_HOVER_DISTANCE_PX,
        Math.max(COMPACT_NAVIGATION_MIN_HIT_HEIGHT_PX, (closest?.hitHeight ?? 0) / 2),
      );
      if (closestDistance > hoverDistance) return undefined;
      return closest?.item;
    },
    [positionedItems],
  );

  const handleRailMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const closest = closestItemAtPointer(event.clientY, event.currentTarget);
      setHoveredId((current) => (current === closest?.id ? current : closest?.id));
    },
    [closestItemAtPointer],
  );

  const handleRailWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      const scroller = scrollerRef.current;
      if (!scroller || event.deltaY === 0) return;
      event.preventDefault();
      scroller.scrollTop += event.deltaY;
      scheduleMeasure();
    },
    [scheduleMeasure, scrollerRef],
  );

  if (items.length < 2) return null;

  const tooltipMaximum = Math.max(
    MINIMAP_TOOLTIP_SAFE_EDGE_PX,
    trackHeight - MINIMAP_TOOLTIP_SAFE_EDGE_PX,
  );
  const tooltipTop = clamp(
    hoveredPosition?.top ?? MINIMAP_TOOLTIP_SAFE_EDGE_PX,
    MINIMAP_TOOLTIP_SAFE_EDGE_PX,
    tooltipMaximum,
  );
  const tooltipStyle = { '--minimap-tooltip-top': `${tooltipTop}px` } as CSSProperties;

  return (
    <nav
      className="shell-conversation-minimap"
      aria-label="对话消息导航"
      onMouseMove={handleRailMouseMove}
      onMouseLeave={() => setHoveredId(undefined)}
      onWheel={handleRailWheel}
    >
      <div className="shell-conversation-minimap__track" aria-hidden="true" />
      {positionedItems.map(({ item, top, hitHeight }) => {
        const summary = primarySummary(item);
        return (
          <button
            key={item.id}
            type="button"
            className="shell-conversation-minimap__tick"
            data-testid={`conversation-minimap-${item.id}`}
            data-role={item.role}
            data-active={activeId === item.id ? 'true' : undefined}
            data-hovered={hoveredId === item.id ? 'true' : undefined}
            aria-current={activeId === item.id ? 'location' : undefined}
            aria-label={`跳转到助手回答：${summary}`}
            style={
              {
                '--minimap-tick-top': `${top}px`,
                '--minimap-tick-hit-height': `${hitHeight}px`,
              } as CSSProperties
            }
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() =>
              setHoveredId((current) => (current === item.id ? undefined : current))
            }
            onFocus={() => setHoveredId(item.id)}
            onBlur={() => setHoveredId((current) => (current === item.id ? undefined : current))}
            onClick={() => navigate(item.id)}
          >
            <span aria-hidden="true" />
          </button>
        );
      })}
      {hoveredItem ? (
        <div
          className="shell-conversation-minimap__tooltip"
          style={tooltipStyle}
          role="tooltip"
          data-role={hoveredItem.role}
        >
          <div className="shell-conversation-minimap__tooltip-head">
            <strong>
              {compactText(hoveredItem.promptText)
                ? summarizeText(hoveredItem.promptText, 48)
                : '助手回答'}
            </strong>
            {formatMessageClock(hoveredItem.timestamp) ? (
              <time title={formatMessageAbsoluteTime(hoveredItem.timestamp)}>
                {formatMessageClock(hoveredItem.timestamp)}
              </time>
            ) : null}
          </div>
          <div className="shell-conversation-minimap__summary">{primarySummary(hoveredItem)}</div>
          {compactText(hoveredItem.commentaryText) &&
          compactText(hoveredItem.commentaryText) !== compactText(hoveredItem.text) ? (
            <div className="shell-conversation-minimap__detail">
              {summarizeText(hoveredItem.commentaryText, 126)}
            </div>
          ) : null}
          {compactText(hoveredItem.processStatus) ? (
            <div className="shell-conversation-minimap__status">
              {summarizeText(hoveredItem.processStatus, 126)}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
