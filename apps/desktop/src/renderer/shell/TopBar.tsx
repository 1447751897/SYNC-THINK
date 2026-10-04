import { ATTENTION_LABELS, type ConversationActivityView } from '../../conversation-attention.js';
import { PROJECTLESS_SCOPE } from './projectless-scope.js';
// NewMax-style top bar: workspace tabs + full menu from "+"
// Menu portals to body so overflow:hidden stage boards cannot clip it.
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Inbox,
  Bot,
  CalendarClock,
  Check,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Globe,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { STAGE_LABELS, type ShellStage } from './shell-state.js';
import { tabTranslate, useMorphingWorkspaceTabs } from './workspace-tab-morph.js';
import { listenForFrameCoalescedViewportChange } from './viewport-frame.js';

const WorkspaceFormDialog = lazy(() => import('./WorkspaceFormDialog.js'));

const WORKSPACE_TAB_HEIGHT = 31;
const WORKSPACE_TAB_BASELINE = 30.5;
const WORKSPACE_TAB_SHOULDER = 13;
const WORKSPACE_TAB_EDGE_OVERLAP = 4;
const WORKSPACE_TAB_EDGE_FADE = 6;
const WORKSPACE_TAB_TOP_RADIUS = 10;
const WORKSPACE_TAB_SHOULDER_CONTROL = WORKSPACE_TAB_SHOULDER * 0.45;
const WORKSPACE_TAB_GAP = 3;
const WORKSPACE_TAB_MIN_WIDTH = 58;
const WORKSPACE_TAB_MAX_WIDTH = 172;
const WORKSPACE_TAB_ROW_RESERVED = 64;
const WORKSPACE_TAB_OVERFLOW_WIDTH = 44;

interface WorkspaceTabLayout {
  visibleIds: string[];
  tabWidth: number;
  overflowCount: number;
}

export function calculateWorkspaceTabLayout(
  containerWidth: number,
  orderedIds: readonly string[],
): WorkspaceTabLayout {
  const count = orderedIds.length;
  if (count === 0) return { visibleIds: [], tabWidth: WORKSPACE_TAB_MAX_WIDTH, overflowCount: 0 };

  // JSDOM and the first browser paint report zero width. Keep every tab visible
  // until ResizeObserver provides the real track width.
  if (containerWidth <= 0) {
    return {
      visibleIds: [...orderedIds],
      tabWidth: WORKSPACE_TAB_MAX_WIDTH,
      overflowCount: 0,
    };
  }

  const allTabsWidth =
    (containerWidth - WORKSPACE_TAB_ROW_RESERVED - (count - 1) * WORKSPACE_TAB_GAP) / count;
  if (allTabsWidth >= WORKSPACE_TAB_MIN_WIDTH) {
    return {
      visibleIds: [...orderedIds],
      tabWidth: Math.min(WORKSPACE_TAB_MAX_WIDTH, allTabsWidth),
      overflowCount: 0,
    };
  }

  const availableWithOverflow =
    containerWidth - WORKSPACE_TAB_ROW_RESERVED - WORKSPACE_TAB_OVERFLOW_WIDTH - WORKSPACE_TAB_GAP;
  const visibleCount = Math.min(
    Math.max(1, count - 1),
    Math.max(
      1,
      Math.floor(
        (availableWithOverflow + WORKSPACE_TAB_GAP) / (WORKSPACE_TAB_MIN_WIDTH + WORKSPACE_TAB_GAP),
      ),
    ),
  );
  const visibleIds = orderedIds.slice(0, visibleCount);

  const tabGaps = (visibleCount - 1) * WORKSPACE_TAB_GAP;
  const reservedWidth =
    WORKSPACE_TAB_ROW_RESERVED + WORKSPACE_TAB_OVERFLOW_WIDTH + WORKSPACE_TAB_GAP + tabGaps;
  return {
    visibleIds,
    tabWidth: Math.max(
      WORKSPACE_TAB_MIN_WIDTH,
      Math.min(WORKSPACE_TAB_MAX_WIDTH, (containerWidth - reservedWidth) / visibleCount),
    ),
    overflowCount: count - visibleCount,
  };
}

function useElementWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const next = element.clientWidth || element.getBoundingClientRect().width;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);

  return width;
}

function coordinate(value: number): string {
  return String(Number(value.toFixed(3)));
}

function workspaceTabCurves(width: number, baseline: number): string {
  const shoulderInner = WORKSPACE_TAB_SHOULDER - WORKSPACE_TAB_SHOULDER_CONTROL;
  return [
    `C ${coordinate(-shoulderInner)} ${coordinate(baseline)}`,
    `0 ${coordinate(baseline - WORKSPACE_TAB_SHOULDER_CONTROL)} 0 18`,
    `L 0 ${WORKSPACE_TAB_TOP_RADIUS}`,
    `Q 0 0 ${WORKSPACE_TAB_TOP_RADIUS} 0`,
    `H ${coordinate(width - WORKSPACE_TAB_TOP_RADIUS)}`,
    `Q ${coordinate(width)} 0 ${coordinate(width)} ${WORKSPACE_TAB_TOP_RADIUS}`,
    `L ${coordinate(width)} 18`,
    `C ${coordinate(width)} ${coordinate(baseline - WORKSPACE_TAB_SHOULDER_CONTROL)}`,
    `${coordinate(width + shoulderInner)} ${coordinate(baseline)}`,
    `${coordinate(width + WORKSPACE_TAB_SHOULDER)} ${coordinate(baseline)}`,
  ].join(' ');
}

export function WorkspaceTabShape({ width }: { width: number }) {
  const id = useId().replace(/:/g, '');
  const boundaryStart = -WORKSPACE_TAB_SHOULDER - WORKSPACE_TAB_EDGE_OVERLAP;
  const boundaryEnd = width + WORKSPACE_TAB_SHOULDER + WORKSPACE_TAB_EDGE_OVERLAP;
  const surfaceBoundary = `M ${-WORKSPACE_TAB_SHOULDER} ${WORKSPACE_TAB_HEIGHT} ${workspaceTabCurves(
    width,
    WORKSPACE_TAB_HEIGHT,
  )}`;
  const fillPath = `${surfaceBoundary} L ${-WORKSPACE_TAB_SHOULDER} ${WORKSPACE_TAB_HEIGHT} Z`;
  const boundaryPath = `M ${boundaryStart} ${WORKSPACE_TAB_BASELINE} H ${-WORKSPACE_TAB_SHOULDER} ${workspaceTabCurves(
    width,
    WORKSPACE_TAB_BASELINE,
  )} H ${coordinate(boundaryEnd)}`;
  const totalWidth = width + (WORKSPACE_TAB_SHOULDER + WORKSPACE_TAB_EDGE_OVERLAP) * 2;
  const fadeOffset = (x: number) => `${coordinate(((x - boundaryStart) / totalWidth) * 100)}%`;
  const fadeStops = (color: string) => (
    <>
      <stop offset="0%" stopColor={color} stopOpacity="0" />
      <stop offset={fadeOffset(-WORKSPACE_TAB_SHOULDER)} stopColor={color} stopOpacity="0" />
      <stop
        offset={fadeOffset(-WORKSPACE_TAB_SHOULDER + WORKSPACE_TAB_EDGE_FADE)}
        stopColor={color}
      />
      <stop
        offset={fadeOffset(width + WORKSPACE_TAB_SHOULDER - WORKSPACE_TAB_EDGE_FADE)}
        stopColor={color}
      />
      <stop offset={fadeOffset(width + WORKSPACE_TAB_SHOULDER)} stopColor={color} stopOpacity="0" />
      <stop offset="100%" stopColor={color} stopOpacity="0" />
    </>
  );

  return (
    <svg
      data-testid="workspace-tab-shape"
      className="shell-workspace-tab-shape"
      width={totalWidth}
      height={WORKSPACE_TAB_HEIGHT}
      viewBox={`${boundaryStart} 0 ${coordinate(totalWidth)} ${WORKSPACE_TAB_HEIGHT}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-outline-fade`}
          x1={boundaryStart}
          y1="0"
          x2={boundaryEnd}
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          {fadeStops('var(--shell-tab-outline)')}
        </linearGradient>
        <linearGradient
          id={`${id}-highlight-fade`}
          x1={boundaryStart}
          y1="0"
          x2={boundaryEnd}
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          {fadeStops('var(--shell-tab-highlight)')}
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={fillPath} />
        </clipPath>
      </defs>
      <path d={fillPath} fill="var(--color-chat)" />
      <path
        d={boundaryPath}
        fill="none"
        stroke={`url(#${id}-outline-fade)`}
        className="shell-workspace-tab-shape__outline"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={boundaryPath}
        fill="none"
        stroke={`url(#${id}-highlight-fade)`}
        strokeWidth="1.2"
        clipPath={`url(#${id}-clip)`}
        className="shell-workspace-tab-shape__highlight"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export interface TopBarProps {
  workspaces: readonly WorkspaceSummary[];
  /** Always a workspace id when workspaces exist (no 全部). */
  activeWorkspaceId?: string;
  sidebarCollapsed: boolean;
  /** Main chat uses a project/conversation breadcrumb instead of another tab rail. */
  chatLayout?: boolean;
  chatTitle?: string;
  onSelectWorkspace(workspaceId: string): void;
  onOpenFolder(): void;
  onCreateWorkspace(input: { name: string; folderPath: string; icon?: string }): Promise<boolean>;
  onUpdateWorkspace(input: {
    workspaceId: string;
    name?: string;
    folderPath?: string;
    icon?: string | null;
  }): Promise<boolean>;
  /**
   * Persist a custom folder-tab order after drag reordering.
   * orderedIds = workspace ids in their new display order.
   */
  onReorderWorkspaces?(orderedIds: string[]): Promise<boolean> | void;
  /**
   * Hide/unhide a workspace in the folder tab row (data untouched).
   * true = remove from the row; false = show again.
   */
  onSetWorkspaceHidden?(workspaceId: string, hidden: boolean): Promise<boolean> | void;
  onDeleteWorkspace(workspaceId: string): Promise<boolean>;
  onToggleSidebar(): void;
  onOpenTerminal?(): void;
  canOpenTerminal?: boolean;
  bottomWorkbenchOpen?: boolean;
  rightWorkbenchOpen?: boolean;
  onToggleBottomWorkbench?(): void;
  onToggleRightWorkbench?(): void;
  /** Optional pick-folder bridge used by the create/edit dialog. */
  onPickFolder(): Promise<{ canceled: boolean; path?: string }>;
  /**
   * 各工作区任务状态（运行中动效 / 完成未读圆点）。
   * key = workspaceId；缺省即无指示。
   */
  workspaceActivity?: ReadonlyMap<string, ConversationActivityView>;
  attentionCenter?: React.ReactNode;
  /** Non-conversation pages occupy one contextual tab instead of workspace tabs. */
  contextStage?: Exclude<ShellStage, 'talk' | 'settings'>;
}

function ContextStageIcon({ stage }: { stage: NonNullable<TopBarProps['contextStage']> }) {
  const Icon =
    stage === 'tasks'
      ? CalendarClock
      : stage === 'activity'
        ? Inbox
        : stage === 'browser'
          ? Globe
          : stage === 'agents'
            ? Bot
            : stage === 'teams'
              ? Users
              : Wrench;
  // NewMax `TabLeadingVisual` renders workspace/context tab leading icons at 16px.
  return <Icon size={16} aria-hidden="true" />;
}

export function TopBar(props: TopBarProps) {
  const currentWorkspace = props.workspaces.find((workspace) => workspace.workspaceId === props.activeWorkspaceId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSummary | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceTrackRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  // Local display order for drag reordering; follows props when not dragging.
  // Hidden workspaces are excluded from the row (they live in the menu only).
  const visibleWorkspaces = props.workspaces.filter((w) => !w.hidden);
  const hiddenWorkspaces = props.workspaces.filter((w) => w.hidden);
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    visibleWorkspaces.map((w) => w.workspaceId),
  );
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setOrderIds(props.workspaces.filter((w) => !w.hidden).map((w) => w.workspaceId));
  }, [props.workspaces]);
  const workspaceTrackWidth = useElementWidth(workspaceTrackRef);
  const workspaceLayout = calculateWorkspaceTabLayout(workspaceTrackWidth, orderIds);
  const overflowSelection = visibleWorkspaces.find(
    (workspace) =>
      workspace.workspaceId === props.activeWorkspaceId &&
      !workspaceLayout.visibleIds.includes(workspace.workspaceId),
  );
  const onReorderWorkspaces = props.onReorderWorkspaces;
  const commitWorkspaceOrder = useCallback(
    (next: string[]) => {
      setOrderIds(next);
      void onReorderWorkspaces?.(next);
    },
    [onReorderWorkspaces],
  );
  const morph = useMorphingWorkspaceTabs({
    visibleIds: workspaceLayout.visibleIds,
    fullOrder: orderIds,
    tabWidth: workspaceLayout.tabWidth,
    activeId: props.activeWorkspaceId,
    onSelect: props.onSelectWorkspace,
    onReorder: commitWorkspaceOrder,
  });
  draggingRef.current = Boolean(morph.draggingId);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuStyle(null);
      return;
    }
    const update = () => {
      const el = menuAnchor;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 320;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 6;
      const viewportPadding = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - viewportPadding;
      const spaceAbove = r.top - gap - viewportPadding;
      const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(96, openAbove ? spaceAbove : spaceBelow);
      setMenuStyle({
        position: 'fixed',
        top: openAbove ? 'auto' : r.bottom + gap,
        bottom: openAbove ? window.innerHeight - r.top + gap : 'auto',
        left,
        width,
        maxHeight: Math.min(360, availableHeight),
        overflowY: 'auto',
        zIndex: 10050,
      });
    };
    update();
    return listenForFrameCoalescedViewportChange(update);
  }, [menuAnchor, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (menuAnchor?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    // Defer so the opening click itself does not immediately close the menu.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuAnchor, menuOpen]);

  const toggleWorkspaceMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextAnchor = event.currentTarget;
    const sameAnchor = menuAnchor === nextAnchor;
    setMenuAnchor(nextAnchor);
    setMenuOpen((open) => (sameAnchor ? !open : true));
  };

  return (
    <header
      data-testid="shell-topbar"
      className={clsx(
        'shell-topbar shell-workspace-tabs relative z-[3] mt-0.5 flex h-8 shrink-0 items-start gap-[3px] pr-[3px] pt-px',
        props.sidebarCollapsed ? 'pl-[3px]' : 'pl-[26px]',
        props.chatLayout && 'shell-topbar--chat',
      )}
    >
      {props.sidebarCollapsed ? (
        <button
          data-testid="topbar-open-sidebar"
          className="st-icon-motion flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-text-secondary hover:bg-hover hover:text-text"
          title="展开侧栏 (Ctrl+B)"
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={15} />
        </button>
      ) : null}

      {props.contextStage ? (
        <div
          className="shell-context-tab shell-workspace-tab shell-workspace-tab-active relative h-[31px] w-[184px] shrink-0 pb-[3px]"
          data-testid="topbar-context-tab"
        >
          <WorkspaceTabShape width={184} />
          <div className="shell-workspace-tab__body relative z-[1] flex h-7 w-full items-center gap-1.5 rounded-t-[10px] px-2.5 text-[13px] font-medium text-text">
            <ContextStageIcon stage={props.contextStage} />
            <span className="truncate">{STAGE_LABELS[props.contextStage]}</span>
          </div>
        </div>
      ) : null}

      <div
        ref={workspaceTrackRef}
        data-testid="topbar-workspace-scroller"
        className={clsx(
          'shell-workspace-tabs__scroller flex min-w-0 flex-1 items-start gap-[3px]',
          props.contextStage && 'hidden',
        )}
        aria-hidden={props.contextStage ? 'true' : undefined}
      >
        <div
          className="shell-workspace-tabs__rail"
          role="tablist"
          aria-label="工作区"
          aria-hidden={props.chatLayout ? true : undefined}
          style={{ width: morph.railWidth }}
        >
          {props.activeWorkspaceId &&
          workspaceLayout.visibleIds.includes(props.activeWorkspaceId) ? (
            <div
              data-testid="workspace-tab-surface"
              data-workspace-id={props.activeWorkspaceId}
              data-slot={String(Math.max(0, morph.surfaceSlot))}
              className={clsx(
                'shell-workspace-tabs__surface',
                morph.draggingId !== props.activeWorkspaceId && 'is-gliding',
              )}
              style={{
                width: workspaceLayout.tabWidth,
                transform: tabTranslate(morph.surfaceLeft),
              }}
            >
              <WorkspaceTabShape width={workspaceLayout.tabWidth} />
            </div>
          ) : null}
          {workspaceLayout.visibleIds.map((workspaceId) => {
            const workspace = props.workspaces.find((w) => w.workspaceId === workspaceId);
            if (!workspace) return null;
            return (
              <ProjectTab
                key={workspace.workspaceId}
                workspaceId={workspace.workspaceId}
                label={workspace.name}
                icon={workspace.icon}
                title={workspace.folderPath}
                active={props.activeWorkspaceId === workspace.workspaceId}
                running={props.workspaceActivity?.get(workspace.workspaceId)?.running ?? false}
                unread={props.workspaceActivity?.get(workspace.workspaceId)?.unread ?? false}
                attention={props.workspaceActivity?.get(workspace.workspaceId)?.attention}
                width={workspaceLayout.tabWidth}
                left={morph.leftFor(workspace.workspaceId)}
                dragging={morph.draggingId === workspace.workspaceId}
                onHide={
                  props.onSetWorkspaceHidden && workspace.workspaceId !== PROJECTLESS_SCOPE
                    ? () => props.onSetWorkspaceHidden?.(workspace.workspaceId, true)
                    : undefined
                }
                onPointerDown={(event) => morph.startDrag(workspace.workspaceId, event)}
                onPointerMove={morph.moveDrag}
                onPointerUp={(event) => morph.finishDrag(event.pointerId)}
                onPointerCancel={(event) => morph.finishDrag(event.pointerId)}
                onLostPointerCapture={(event) => {
                  if (event.target !== event.currentTarget || event.buttons !== 0) return;
                  morph.finishDrag(event.pointerId);
                }}
                onKeyDown={(event) => morph.handleKeyDown(workspace.workspaceId, event)}
                onActivate={() => {
                  if (morph.consumeClick() || morph.draggingId === workspace.workspaceId) return;
                  props.onSelectWorkspace(workspace.workspaceId);
                }}
              />
            );
          })}
        </div>

        {!props.chatLayout && workspaceLayout.overflowCount > 0 ? (
          <div className="flex h-[31px] shrink-0 items-start pb-[3px]">
            <button
              type="button"
              data-testid="topbar-workspace-overflow"
              className={clsx(
                'st-icon-motion flex h-7 w-11 items-center justify-center rounded-[10px] text-[12px] font-medium',
                overflowSelection
                  ? 'bg-accent-soft text-accent-text'
                  : 'text-text-secondary hover:bg-hover hover:text-text',
              )}
              title={
                overflowSelection
                  ? `当前选择：${overflowSelection.name}`
                  : `还有 ${workspaceLayout.overflowCount} 个工作区`
              }
              aria-label={`显示其余 ${workspaceLayout.overflowCount} 个工作区${overflowSelection ? `，当前选择：${overflowSelection.name}` : ''}`}
              aria-expanded={menuOpen && menuAnchor?.dataset.testid === 'topbar-workspace-overflow'}
              onClick={toggleWorkspaceMenu}
            >
              +{workspaceLayout.overflowCount}
            </button>
          </div>
        ) : null}

        <div className="relative flex h-[31px] shrink-0 items-start pb-[3px]">
          <button
            type="button"
            data-testid="topbar-workspace-menu"
            className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-[10px] text-text-secondary hover:bg-hover hover:text-text"
            title="工作区"
            aria-expanded={menuOpen && menuAnchor?.dataset.testid === 'topbar-workspace-menu'}
            onClick={toggleWorkspaceMenu}
          >
            {props.chatLayout ? <>
              <FolderOpen size={14} aria-hidden="true" />
              <span className="shell-chat-breadcrumb__project">{currentWorkspace?.name || '选择工作区'}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </> : <Plus size={14} />}
          </button>
          {menuOpen && menuStyle && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={menuRef}
                  data-testid="workspace-menu"
                  className="st-popover-in rounded-(--radius-card) border border-border bg-overlay p-1.5 shadow-xl"
                  style={menuStyle}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="max-h-[280px] overflow-y-auto">
                    {visibleWorkspaces.length === 0 ? (
                      <div className="px-2.5 py-3 text-[12px] text-text-faint">暂无工作区</div>
                    ) : (
                      visibleWorkspaces.map((workspace) => {
                        const isActive = workspace.workspaceId === props.activeWorkspaceId;
                        return (
                          <div
                            key={workspace.workspaceId}
                            data-testid={`workspace-menu-item-${workspace.workspaceId}`}
                            className={clsx(
                              'st-row-motion group flex w-full items-start gap-2 rounded-(--radius-row) px-2 py-1.5',
                              isActive ? 'bg-active' : 'hover:bg-hover',
                            )}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-start gap-2 text-left"
                              onClick={() => {
                                props.onSelectWorkspace(workspace.workspaceId);
                                setMenuOpen(false);
                              }}
                            >
                              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none">
                                {workspace.icon?.trim() || '📁'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] text-text">
                                  {workspace.name}
                                </span>
                                {workspace.folderPath ? (
                                  <span
                                    className="block truncate text-[10.5px] text-text-faint"
                                    title={workspace.folderPath}
                                  >
                                    {workspace.folderPath}
                                  </span>
                                ) : (
                                  <span className="block text-[10.5px] text-text-faint">
                                    {workspace.workspaceId === PROJECTLESS_SCOPE ? '独立对话与全局任务' : '未绑定路径'}
                                  </span>
                                )}
                              </span>
                              {isActive ? (
                                <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                              ) : (
                                <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              )}
                            </button>
                            <div style={workspace.workspaceId === PROJECTLESS_SCOPE ? { display: 'none' } : undefined} className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                data-testid={`workspace-edit-${workspace.workspaceId}`}
                                className="st-icon-motion flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-surface hover:text-text"
                                title="编辑工作区"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuOpen(false);
                                  setEditing(workspace);
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                data-testid={`workspace-delete-${workspace.workspaceId}`}
                                className="st-icon-motion flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-surface hover:text-error"
                                title="删除工作区"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuOpen(false);
                                  void props.onDeleteWorkspace(workspace.workspaceId);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {hiddenWorkspaces.length > 0 ? (
                    <>
                      <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-faint">
                        已隐藏
                      </div>
                      <div className="max-h-[160px] overflow-y-auto">
                        {hiddenWorkspaces.map((workspace) => (
                          <div
                            key={workspace.workspaceId}
                            data-testid={`workspace-hidden-item-${workspace.workspaceId}`}
                            className="st-row-motion group flex w-full items-start gap-2 rounded-(--radius-row) px-2 py-1.5"
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-start gap-2 text-left"
                              title={`重新显示 ${workspace.name}`}
                              onClick={() => {
                                setMenuOpen(false);
                                props.onSetWorkspaceHidden?.(workspace.workspaceId, false);
                              }}
                            >
                              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none opacity-50">
                                {workspace.icon?.trim() || '📁'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] text-text-secondary">
                                  {workspace.name}
                                </span>
                                {workspace.folderPath ? (
                                  <span
                                    className="block truncate text-[10.5px] text-text-faint"
                                    title={workspace.folderPath}
                                  >
                                    {workspace.folderPath}
                                  </span>
                                ) : (
                                  <span className="block text-[10.5px] text-text-faint">
                                    未绑定路径
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <span className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-surface hover:text-text">
                                  <X size={12} />
                                </span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}

                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    data-testid="workspace-new"
                    className="st-row-motion flex w-full items-center gap-2 rounded-(--radius-row) px-2.5 py-1.5 text-[14px] text-text-secondary hover:bg-hover hover:text-text"
                    onClick={() => {
                      setMenuOpen(false);
                      setCreateOpen(true);
                    }}
                  >
                    <FolderPlus size={14} />
                    创建新的工作区
                  </button>
                  <button
                    type="button"
                    data-testid="workspace-open-folder"
                    className="st-row-motion flex w-full items-center gap-2 rounded-(--radius-row) px-2.5 py-1.5 text-[14px] text-text-secondary hover:bg-hover hover:text-text"
                    onClick={() => {
                      setMenuOpen(false);
                      props.onOpenFolder();
                    }}
                  >
                    <FolderOpen size={14} />
                    打开现有的文件夹
                  </button>
                </div>,
                document.body,
              )
            : null}
        </div>
        {props.chatLayout ? (
          <div className="shell-chat-breadcrumb__conversation" data-testid="chat-breadcrumb" title={props.chatTitle || '新对话'}>
            <ChevronRight size={12} aria-hidden="true" />
            <span>{props.chatTitle || '新对话'}</span>
          </div>
        ) : null}
      </div>

      {!props.contextStage && (props.onToggleBottomWorkbench || props.onToggleRightWorkbench) ? (
        <div
          className="shell-workspace-workbench-toggles flex h-7 shrink-0 items-center gap-[3px]"
          data-workspace-workbench-toggles="true"
        >
          {props.onToggleBottomWorkbench ? (
            <button
              type="button"
              data-testid="topbar-toggle-bottom-workbench"
              data-workspace-bottom-toggle="true"
              aria-label={props.bottomWorkbenchOpen ? '隐藏底部工作台' : '打开底部工作台'}
              aria-pressed={Boolean(props.bottomWorkbenchOpen)}
              className={clsx(
                'st-icon-motion flex h-7 w-[38px] items-center justify-center rounded-[10px] text-text-secondary hover:bg-hover hover:text-text',
                props.bottomWorkbenchOpen && 'bg-active text-text',
              )}
              onClick={props.onToggleBottomWorkbench}
            >
              <PanelBottom size={15} />
            </button>
          ) : null}
          {props.onToggleRightWorkbench ? (
            <button
              type="button"
              data-testid="topbar-toggle-right-workbench"
              data-workspace-right-toggle="true"
              aria-label={props.rightWorkbenchOpen ? '隐藏右侧工作台' : '打开右侧工作台'}
              aria-pressed={Boolean(props.rightWorkbenchOpen)}
              className={clsx(
                'st-icon-motion flex h-7 w-[38px] items-center justify-center rounded-[10px] text-text-secondary hover:bg-hover hover:text-text',
                props.rightWorkbenchOpen && 'bg-active text-text',
              )}
              onClick={props.onToggleRightWorkbench}
            >
              <PanelRight size={15} />
            </button>
          ) : null}
        </div>
      ) : !props.contextStage && props.onOpenTerminal ? (
        <button
          type="button"
          data-testid="topbar-open-terminal"
          className="st-icon-motion flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-text-secondary hover:bg-hover hover:text-text"
          title="在当前窗格打开终端"
          aria-label="在当前窗格打开终端"
          onClick={props.onOpenTerminal}
        >
          <SquareTerminal size={14} />
        </button>
      ) : null}

      {props.attentionCenter}

      {createOpen ? (
        <Suspense fallback={<span role="status">正在载入工作区设置…</span>}><WorkspaceFormDialog
          mode="create"
          onPickFolder={props.onPickFolder}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (input) =>
            props.onCreateWorkspace({
              name: input.name,
              folderPath: input.folderPath,
              icon: input.icon,
            })
          }
        /></Suspense>
      ) : null}

      {editing ? (
        <Suspense fallback={<span role="status">正在载入工作区设置…</span>}><WorkspaceFormDialog
          mode="edit"
          initial={{
            name: editing.name,
            folderPath: editing.folderPath ?? '',
            icon: editing.icon,
          }}
          onPickFolder={props.onPickFolder}
          onClose={() => setEditing(null)}
          onSubmit={async (input) =>
            props.onUpdateWorkspace({
              workspaceId: editing.workspaceId,
              name: input.name,
              folderPath: input.folderPath || undefined,
              icon: input.icon ? input.icon : null,
            })
          }
        /></Suspense>
      ) : null}
    </header>
  );
}

function ProjectTab(props: {
  workspaceId: string;
  label: string;
  icon?: string;
  title?: string;
  active: boolean;
  width: number;
  left: number;
  /** 该工作区有任务正在运行 → 呼吸圆点动效。 */
  running?: boolean;
  /** 该工作区有已完成但未查看的任务 → 静态未读圆点。 */
  unread?: boolean;
  attention?: ConversationActivityView['attention'];
  dragging?: boolean;
  onHide?(): void;
  onPointerDown(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerCancel(event: React.PointerEvent<HTMLDivElement>): void;
  onLostPointerCapture(event: React.PointerEvent<HTMLDivElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void;
  onActivate(): void;
}) {
  return (
    <div
      role="tab"
      tabIndex={props.active ? 0 : -1}
      aria-label={props.label}
      aria-selected={props.active}
      data-testid={`project-tab-${props.label}`}
      data-workspace-id={props.workspaceId}
      data-active={props.active ? 'true' : 'false'}
      title={
        props.attention ? `${props.title ?? props.label} · ${ATTENTION_LABELS[props.attention]}` : props.running
          ? `${props.title ?? props.label} · 有任务正在运行`
          : props.unread
            ? `${props.title ?? props.label} · 有已完成任务待查看`
            : props.title
      }
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onLostPointerCapture={props.onLostPointerCapture}
      onKeyDown={props.onKeyDown}
      onClick={() => {
        props.onActivate();
      }}
      className={clsx(
        'shell-workspace-tab group h-[31px] pb-[3px]',
        props.active && 'shell-workspace-tab-active',
        props.dragging ? 'is-dragging' : 'is-gliding',
      )}
      style={{
        width: props.width,
        transform: tabTranslate(props.left),
      }}
    >
      <div
        className={clsx(
          'shell-workspace-tab__body st-row-motion relative z-[1] flex h-7 w-full items-center gap-1.5 rounded-[10px] pl-2.5 pr-1 text-[13px] font-medium',
          props.active ? 'text-text' : 'text-text-secondary hover:bg-hover hover:text-text',
        )}
      >
        <span
          className={clsx(
            'flex h-4 w-4 shrink-0 items-center justify-center leading-none',
            props.active ? 'text-text-secondary' : 'text-text-faint',
          )}
          aria-hidden
        >
          {props.icon?.trim() ? (
            <span className="text-[13px]">{props.icon}</span>
          ) : (
            <FolderOpen size={14} strokeWidth={1.7} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
        {props.attention ? (
          <span className="shell-activity-dot shell-activity-dot--attention" title={ATTENTION_LABELS[props.attention]} aria-label={ATTENTION_LABELS[props.attention]} />
        ) : props.running ? (
          <span
            className="shell-activity-dot shell-activity-dot--running"
            data-testid={`workspace-running-${props.label}`}
            aria-label="有任务正在运行"
          />
        ) : props.unread ? (
          <span
            className="shell-activity-dot shell-activity-dot--unread"
            data-testid={`workspace-unread-${props.label}`}
            aria-label="有已完成任务待查看"
          />
        ) : null}
        {props.onHide ? (
          <span
            className="shell-workspace-tab__close flex h-5 shrink-0 items-center justify-center overflow-hidden rounded text-text-faint hover:bg-hover hover:text-text"
            role="button"
            tabIndex={-1}
            aria-label={`从文件夹行移除 ${props.label}`}
            title="从文件夹行移除"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onHide?.();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              props.onHide?.();
            }}
          >
            <X size={11} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
