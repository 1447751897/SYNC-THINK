import {
  memo,
  useCallback,
  useId,
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
import { ConversationNavigationGeometry } from './conversation-navigation-geometry.js';

export interface ConversationNavigationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** User prompt paired with this assistant turn; never rendered as a separate tick. */
  promptText?: string;
  promptId?: string;
  commentaryText?: string;
  processStatus?: string;
  streaming?: boolean;
  terminalState?: 'failed' | 'cancelled' | 'paused';
  timestamp: string;
}

const NavigationTick = memo(function NavigationTick({
  id,
  role,
  label,
  top,
  hitHeight,
  tickWidth,
  active,
  emphasized,
  hovered,
  tooltipId,
  onHover,
  onNavigate,
}: {
  id: string;
  role: ConversationNavigationItem['role'];
  label: string;
  top: number;
  hitHeight: number;
  /** NewMax-style ripple width, widened by distance to the hovered tick. */
  tickWidth: number;
  /** The reader's own turn. Drives `aria-current`, not the hover-following glow. */
  active: boolean;
  /** The one tick drawn at full strength; tracks the pointer while it is on the rail. */
  emphasized: boolean;
  hovered: boolean;
  tooltipId: string;
  onHover(id: string, hovered: boolean): void;
  onNavigate(id: string): void;
}) {
  return (
    <button
      type="button"
      className="shell-conversation-minimap__tick"
      data-testid={`conversation-minimap-${id}`}
      data-role={role}
      data-active={emphasized ? 'true' : undefined}
      data-hovered={hovered ? 'true' : undefined}
      aria-current={active ? 'location' : undefined}
      aria-label={label}
      aria-describedby={hovered ? tooltipId : undefined}
      style={
        {
          '--minimap-tick-top': `${top}px`,
          '--minimap-tick-hit-height': `${hitHeight}px`,
          '--minimap-tick-width': `${tickWidth}px`,
        } as CSSProperties
      }
      onMouseEnter={() => onHover(id, true)}
      onMouseLeave={() => onHover(id, false)}
      onFocus={() => onHover(id, true)}
      onBlur={() => onHover(id, false)}
      onClick={(event) => {
        event.stopPropagation();
        onNavigate(id);
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
});

interface ConversationMinimapRailProps {
  items: readonly ConversationNavigationItem[];
  scrollerRef: RefObject<HTMLDivElement>;
  onNavigate(itemId: string, targetScrollTop: number): void;
  onLoadItem?(itemId: string, isCurrent: () => boolean): Promise<boolean>;
}

const READING_FOCUS_RATIO = 0.25;
const NAVIGATION_LAYOUT_WARMUP_FRAMES = 2;
const NAVIGATION_CORRECTION_FRAMES = 12;
const NAVIGATION_STABLE_FRAMES = 2;
/** Largest inset kept between the first/last tick and the rail edge. */
const COMPACT_NAVIGATION_EDGE_PX = 16;
/** A short rail shrinks its inset rather than letting it eat the whole track. */
const COMPACT_NAVIGATION_MIN_EDGE_PX = 6;
const COMPACT_NAVIGATION_EDGE_RATIO = 0.15;
/** One turn owns a fixed 10px slot, so a longer thread never squeezes the rest. */
const COMPACT_NAVIGATION_MAX_GAP_PX = 10;
const COMPACT_NAVIGATION_MAX_HIT_HEIGHT_PX = 20;
const COMPACT_NAVIGATION_MIN_HIT_HEIGHT_PX = 1;
/** The rail never renders shorter than this, even for a 2-3 turn thread. */
const MINIMAP_TRACK_MIN_PX = 72;
const MINIMAP_TICK_SLOT_PX = 10;
const MINIMAP_TOOLTIP_SAFE_EDGE_PX = 72;

/**
 * NewMax `getOutlineTickWidth`: hovering a tick widens it and its neighbours in
 * a stepped falloff, so the rail reads as a ripple rather than a single blip.
 */
const MINIMAP_TICK_WIDTH_DEFAULT_PX = 6;
const MINIMAP_TICK_WIDTH_STEPS_PX = [26, 18, 12] as const;

function minimapTickWidth(index: number, hoveredIndex: number | null): number {
  if (hoveredIndex === null) return MINIMAP_TICK_WIDTH_DEFAULT_PX;
  const distance = Math.abs(index - hoveredIndex);
  return MINIMAP_TICK_WIDTH_STEPS_PX[distance] ?? MINIMAP_TICK_WIDTH_DEFAULT_PX;
}

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
  if (item.streaming) return summarizeText(item.processStatus, 120) || '正在生成回复…';
  if (compactText(item.text)) return summarizeText(item.text, 220);
  if (item.terminalState === 'failed') return '回复失败';
  if (item.terminalState === 'cancelled') return '本轮已停止';
  if (item.terminalState === 'paused') return '本轮已暂停，可继续';
  return summarizeText(item.processStatus, 120) || '暂无回答摘要';
}

function questionSummary(item: ConversationNavigationItem): string {
  return summarizeText(item.promptText, 160) || (item.promptId ? '本轮提问' : '助手回答');
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
  let pendingPromptId: string | undefined;

  for (const item of items) {
    if (item.role === 'user') {
      pendingPromptId ??= item.id;
      const prompt = compactText(item.text);
      if (prompt) pendingPrompts.push(prompt);
      continue;
    }
    if (item.role !== 'assistant') continue;

    const pairedPrompt = pendingPrompts.join('\n');
    result.push({
      ...item,
      role: 'assistant',
      ...(pendingPromptId ? { promptId: pendingPromptId } : {}),
      ...(pairedPrompt ? { promptText: pairedPrompt } : {}),
    });
    pendingPrompts = [];
    pendingPromptId = undefined;
  }

  return result;
}

/**
 * Center turn markers independently from reply height. Every turn owns the same
 * 10px slot, so one more turn never squeezes the ticks already on the rail — the
 * rail itself grows with the tick count (see `MINIMAP_TRACK_MIN_PX`) and only
 * compresses once a very long thread exceeds the viewport.
 *
 * The edge inset scales with the rail height instead of being a flat 16px: a
 * short rail that always subtracted 32px left almost no room inside, which
 * collapsed 2-3 turn threads onto a single point.
 */
export function buildCompactNavigationTops(itemCount: number, trackHeight: number): number[] {
  if (itemCount <= 0) return [];
  if (trackHeight > 0 && itemCount === 1) return [trackHeight / 2];

  const edge =
    trackHeight > 0
      ? clamp(
          trackHeight * COMPACT_NAVIGATION_EDGE_RATIO,
          COMPACT_NAVIGATION_MIN_EDGE_PX,
          COMPACT_NAVIGATION_EDGE_PX,
        )
      : COMPACT_NAVIGATION_EDGE_PX;
  const usableHeight =
    trackHeight > 0
      ? Math.max(0, trackHeight - edge * 2)
      : Math.max(0, itemCount - 1) * COMPACT_NAVIGATION_MAX_GAP_PX;
  const gap =
    itemCount <= 1
      ? 0
      : Math.min(COMPACT_NAVIGATION_MAX_GAP_PX, usableHeight / Math.max(1, itemCount - 1));
  const groupHeight = Math.max(0, itemCount - 1) * gap;
  const groupTop = trackHeight > 0 ? Math.max(edge, (trackHeight - groupHeight) / 2) : edge;

  return Array.from({ length: itemCount }, (_unused, index) => groupTop + index * gap);
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
  onLoadItem,
}: ConversationMinimapRailProps) {
  const [trackHeight, setTrackHeight] = useState(0);
  const railRef = useRef<HTMLElement>(null);
  const visible = items.length >= 2;
  const [activeId, setActiveId] = useState<string | undefined>(items[0]?.id);
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const tooltipId = useId();
  const geometryRef = useRef<ConversationNavigationGeometry>();
  const itemAnchorsRef = useRef(items);
  itemAnchorsRef.current = items;
  const layoutKey = JSON.stringify(items.map((item) => [item.id, item.promptId]));
  const navigationTargetRef = useRef<HTMLElement>();
  const navigationFrameRef = useRef<number | null>(null);
  const navigationGenerationRef = useRef(0);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const measure = () => {
      const height = rail.getBoundingClientRect().height;
      setTrackHeight((previous) => (Math.abs(previous - height) < 0.5 ? previous : height));
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(rail);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible]);

  const scheduleMeasure = useCallback(() => {
    geometryRef.current?.schedule();
  }, []);
  const cancelNavigation = useCallback(() => {
    navigationGenerationRef.current += 1;
    if (navigationFrameRef.current !== null)
      window.cancelAnimationFrame(navigationFrameRef.current);
    navigationFrameRef.current = null;
    if (navigationTargetRef.current) delete navigationTargetRef.current.dataset.navigationTarget;
    navigationTargetRef.current = undefined;
    const scroller = scrollerRef.current;
    if (scroller) delete scroller.dataset.navigationSettling;
    scheduleMeasure();
  }, [scheduleMeasure, scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const geometry = new ConversationNavigationGeometry(scroller, (snapshot) => {
      if (!snapshot.navigating)
        setActiveId((previous) => (previous === snapshot.activeId ? previous : snapshot.activeId));
    });
    geometryRef.current = geometry;
    geometry.setItems(itemAnchorsRef.current);
    const cancelFromKey = (event: KeyboardEvent) => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', ' '].includes(
          event.key,
        )
      )
        cancelNavigation();
    };
    scroller.addEventListener('wheel', cancelNavigation, { passive: true });
    scroller.addEventListener('touchstart', cancelNavigation, { passive: true });
    scroller.addEventListener('pointerdown', cancelNavigation, { passive: true });
    scroller.addEventListener('keydown', cancelFromKey);
    return () => {
      scroller.removeEventListener('wheel', cancelNavigation);
      scroller.removeEventListener('touchstart', cancelNavigation);
      scroller.removeEventListener('pointerdown', cancelNavigation);
      scroller.removeEventListener('keydown', cancelFromKey);
      geometry.dispose();
      geometryRef.current = undefined;
      navigationGenerationRef.current += 1;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
        navigationFrameRef.current = null;
      }
      if (navigationTargetRef.current) delete navigationTargetRef.current.dataset.navigationTarget;
      navigationTargetRef.current = undefined;
      delete scroller.dataset.navigationSettling;
    };
  }, [cancelNavigation, scrollerRef]);

  useLayoutEffect(() => {
    geometryRef.current?.setItems(itemAnchorsRef.current);
  }, [layoutKey]);

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
      label: `跳转到第 ${index + 1} 轮：${compactText(item.promptText) ? questionSummary(item) : primarySummary(item)}`,
      top: tops[index] ?? COMPACT_NAVIGATION_EDGE_PX,
      hitHeight,
    }));
  }, [items, trackHeight]);
  const hoveredItem = items.find((item) => item.id === hoveredId);
  const hoveredPosition = positionedItems.find(({ item }) => item.id === hoveredId);
  const handleTickHover = useCallback((id: string, hovered: boolean) => {
    setHoveredId((current) => (hovered ? id : current === id ? undefined : current));
  }, []);

  const navigate = useCallback(
    (itemId: string) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      const targetNode = geometryRef.current?.findNode(item);
      if (!targetNode && !onLoadItem) return;

      navigationGenerationRef.current += 1;
      const generation = navigationGenerationRef.current;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
        navigationFrameRef.current = null;
      }

      if (navigationTargetRef.current) delete navigationTargetRef.current.dataset.navigationTarget;
      navigationTargetRef.current = targetNode;
      if (targetNode) targetNode.dataset.navigationTarget = 'true';
      scroller.dataset.navigationSettling = 'true';
      setActiveId(itemId);
      let warmupFrames = NAVIGATION_LAYOUT_WARMUP_FRAMES;
      let correctionFrames = NAVIGATION_CORRECTION_FRAMES;
      let stableFrames = 0;
      let previousContentTop: number | undefined;
      let previousScrollHeight: number | undefined;

      const settleNavigation = () => {
        if (generation !== navigationGenerationRef.current) return;
        const currentScroller = scrollerRef.current;
        if (!currentScroller) return;

        if (warmupFrames > 0) {
          warmupFrames -= 1;
          navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
          return;
        }

        const node = geometryRef.current?.findNode(item);
        if (!node) {
          if (navigationTargetRef.current)
            delete navigationTargetRef.current.dataset.navigationTarget;
          navigationTargetRef.current = undefined;
          delete currentScroller.dataset.navigationSettling;
          navigationFrameRef.current = null;
          return;
        }
        navigationTargetRef.current = node;
        node.dataset.navigationTarget = 'true';
        const contentTop = messageContentTop(currentScroller, node);
        const scrollHeight = currentScroller.scrollHeight;
        const maximum = Math.max(0, scrollHeight - currentScroller.clientHeight);
        stableFrames =
          previousContentTop !== undefined &&
          previousScrollHeight !== undefined &&
          Math.abs(contentTop - previousContentTop) < 0.5 &&
          Math.abs(scrollHeight - previousScrollHeight) < 0.5
            ? stableFrames + 1
            : 0;
        previousContentTop = contentTop;
        previousScrollHeight = scrollHeight;
        const target = clamp(
          Math.round(contentTop - currentScroller.clientHeight * READING_FOCUS_RATIO),
          0,
          maximum,
        );
        setActiveId(itemId);
        onNavigate(itemId, target);

        if (correctionFrames > 0 && stableFrames < NAVIGATION_STABLE_FRAMES) {
          correctionFrames -= 1;
          navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
          return;
        }

        if (navigationTargetRef.current)
          delete navigationTargetRef.current.dataset.navigationTarget;
        navigationTargetRef.current = undefined;
        delete currentScroller.dataset.navigationSettling;
        navigationFrameRef.current = null;
        scheduleMeasure();
      };

      const isCurrent = () =>
        generation === navigationGenerationRef.current && scrollerRef.current === scroller;
      if (targetNode) {
        navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
      } else {
        void onLoadItem!(item.promptId ?? itemId, isCurrent)
          .then((loaded) => {
            if (!isCurrent()) return;
            if (loaded) navigationFrameRef.current = window.requestAnimationFrame(settleNavigation);
            else cancelNavigation();
          })
          .catch(() => {
            if (isCurrent()) cancelNavigation();
          });
      }
    },
    [items, onNavigate, onLoadItem, cancelNavigation, scheduleMeasure, scrollerRef],
  );

  const closestItemAtPointer = useCallback(
    (clientY: number, rail: HTMLElement): ConversationNavigationItem | undefined => {
      const railRect = rail.getBoundingClientRect();
      if (railRect.height <= 0 || positionedItems.length === 0) return undefined;
      const pointerTop = clamp(clientY - railRect.top, 0, railRect.height);
      const firstTop = positionedItems[0]!.top;
      const lastTop = positionedItems.at(-1)!.top;
      if (
        pointerTop < firstTop - COMPACT_NAVIGATION_EDGE_PX ||
        pointerTop > lastTop + COMPACT_NAVIGATION_EDGE_PX
      )
        return undefined;
      const gap = positionedItems.length > 1 ? positionedItems[1]!.top - firstTop : 0;
      const index =
        gap > 0
          ? clamp(Math.ceil((pointerTop - firstTop) / gap - 0.5), 0, positionedItems.length - 1)
          : 0;
      return positionedItems[index]?.item;
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
      cancelNavigation();
      const target = clamp(
        scroller.scrollTop + event.deltaY,
        0,
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      );
      scroller.scrollTop = target;
      onNavigate(activeId ?? items[0]?.id ?? '', target);
      scheduleMeasure();
    },
    [activeId, cancelNavigation, items, onNavigate, scheduleMeasure, scrollerRef],
  );

  if (!visible) return null;

  const hoveredIndexRaw =
    hoveredId === undefined
      ? -1
      : positionedItems.findIndex(({ item }) => item.id === hoveredId);
  const hoveredIndex = hoveredIndexRaw >= 0 ? hoveredIndexRaw : null;
  const overviewTrackMax = Math.max(MINIMAP_TRACK_MIN_PX, items.length * MINIMAP_TICK_SLOT_PX);

  const tooltipSafeEdge = Math.min(MINIMAP_TOOLTIP_SAFE_EDGE_PX, trackHeight / 2);
  const tooltipMaximum = Math.max(tooltipSafeEdge, trackHeight - tooltipSafeEdge);
  const tooltipTop = clamp(
    hoveredPosition?.top ?? MINIMAP_TOOLTIP_SAFE_EDGE_PX,
    tooltipSafeEdge,
    tooltipMaximum,
  );
  const tooltipStyle = { '--minimap-tooltip-top': `${tooltipTop}px` } as CSSProperties;
  const trackTop = Math.max(0, (positionedItems[0]?.top ?? 0) - COMPACT_NAVIGATION_EDGE_PX);
  const trackBottom = Math.min(
    trackHeight,
    (positionedItems.at(-1)?.top ?? 0) + COMPACT_NAVIGATION_EDGE_PX,
  );

  return (
    <nav
      ref={railRef}
      className="shell-conversation-minimap"
      style={{ '--minimap-track-max': `${overviewTrackMax}px` } as CSSProperties}
      aria-label="对话消息导航"
      onMouseMove={handleRailMouseMove}
      onMouseLeave={() => setHoveredId(undefined)}
      onClick={(event) => {
        const closest = closestItemAtPointer(event.clientY, event.currentTarget);
        if (closest) navigate(closest.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setHoveredId(undefined);
      }}
      onWheel={handleRailWheel}
    >
      <div
        className="shell-conversation-minimap__track"
        aria-hidden="true"
        style={{ top: trackTop, height: Math.max(0, trackBottom - trackTop) }}
      />
      {positionedItems.map(({ item, top, hitHeight, label }, index) => (
        <NavigationTick
          key={item.id}
          id={item.id}
          role={item.role}
          label={label}
          top={top}
          hitHeight={hitHeight}
          tickWidth={minimapTickWidth(index, hoveredIndex)}
          active={activeId === item.id}
          emphasized={
            // NewMax `MessageOutlineNav` `isActive`: the one bright tick tracks the
            // pointer while the pointer is on the rail, and marks the reader's own
            // turn otherwise — so a hover can never leave two ticks at full strength.
            hoveredIndex === null ? activeId === item.id : index === hoveredIndex
          }
          hovered={hoveredId === item.id}
          tooltipId={tooltipId}
          onHover={handleTickHover}
          onNavigate={navigate}
        />
      ))}
      {hoveredItem ? (
        <div
          id={tooltipId}
          className="shell-conversation-minimap__tooltip"
          style={tooltipStyle}
          role="tooltip"
          data-role={hoveredItem.role}
        >
          <div className="shell-conversation-minimap__tooltip-head">
            <strong>{questionSummary(hoveredItem)}</strong>
            {formatMessageClock(hoveredItem.timestamp) ? (
              <time title={formatMessageAbsoluteTime(hoveredItem.timestamp)}>
                {formatMessageClock(hoveredItem.timestamp)}
              </time>
            ) : null}
          </div>
          <div className="shell-conversation-minimap__summary">{primarySummary(hoveredItem)}</div>
        </div>
      ) : null}
    </nav>
  );
}
