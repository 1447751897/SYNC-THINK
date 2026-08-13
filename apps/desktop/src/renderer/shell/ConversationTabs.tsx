// Stage conversation tab strip (T1 / O1).
// Opened subset of the current workspace's conversations — close tab ≠ delete.
// Tabs are draggable so users can reorder the open set (order is persisted).
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bot,
  Columns2,
  FileDiff,
  Folder,
  Globe,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Rows2,
  SquareTerminal,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, ConversationTrack } from '@sync-think/shared';
import type { PaneResourceRef, PaneSplitDirection } from './pane-layout.js';
import {
  DndContext,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileTypeIcon } from './FileTypeIcon.js';

export interface ConversationTabsProps {
  paneId?: string;
  conversations: readonly Conversation[];
  openIds: readonly string[];
  activeId?: string;
  fileTabs?: readonly { id: string; path: string; dirty?: boolean }[];
  activeFilePath?: string;
  terminalTabs?: readonly { id: string; terminalId: string; cwd: string }[];
  activeTerminalId?: string;
  browserTabs?: readonly { id: string; browserId: string; url: string }[];
  activeBrowserId?: string;
  reviewTabs?: readonly { id: string; runId: string }[];
  activeReviewRunId?: string;
  workspaceFilesActive?: boolean;
  workspaceFilesTab?: boolean;
  workspaceFilesPaneOpen?: boolean;
  /** Conversation currently shown in the split (right) pane, if any. */
  splitId?: string;
  canSplit?: boolean;
  onSelect(conversationId: string): void;
  onClose(conversationId: string): void;
  onSelectFile?(path: string): void;
  onCloseFile?(path: string): void;
  onSelectTerminal?(terminalId: string): void;
  onCloseTerminal?(terminalId: string): void;
  onNewTerminal?(): void;
  onSelectBrowser?(browserId: string): void;
  onCloseBrowser?(browserId: string): void;
  onNewBrowser?(): void;
  onSelectReview?(runId: string): void;
  onCloseReview?(runId: string): void;
  onSelectWorkspaceFiles?(): void;
  onCloseWorkspaceFiles?(): void;
  onToggleWorkspaceFilesPane?(): void;
  canOpenTerminal?: boolean;
  onNew(): void;
  onReorder?(fromId: string, toId: string): void;
  onRename?(conversationId: string, currentTitle: string): void;
  /** Right-click a tab → open that conversation in the split pane. */
  onOpenInSplit?(conversationId: string, direction: PaneSplitDirection): void;
  onCloseSplit?(): void;
  onClosePane?(): void;
  /**
   * 拖拽 tab 的开始/结束通知（携带被拖对话 id 或 null）。宿主用它在聊天区
   * 显示「拖到此处开分屏」的落点。
   */
  onTabDragStateChange?(dragging: PaneResourceRef | null): void;
  /** 各对话任务状态（运行中动效 / 完成未读圆点）。key = conversationId。 */
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
}

const TRACK_TAB_ICON: Record<ConversationTrack, typeof MessageSquare> = {
  model: MessageSquare,
  agent: Bot,
  team: Users,
};

type AnchoredMenuAlign = 'start' | 'end';

interface AnchoredMenuConfig {
  width: number;
  maxHeight: number;
  estimatedHeight: number;
  align: AnchoredMenuAlign;
}

const NEW_RESOURCE_MENU_CONFIG: AnchoredMenuConfig = {
  width: 228,
  maxHeight: 320,
  estimatedHeight: 172,
  align: 'start',
};

const SPLIT_PICKER_CONFIG: AnchoredMenuConfig = {
  width: 300,
  maxHeight: 320,
  estimatedHeight: 160,
  align: 'end',
};

function useAnchoredMenuStyle(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement>,
  config: AnchoredMenuConfig,
): React.CSSProperties | null {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor || typeof window === 'undefined') return;

      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const viewportWidth = Math.max(0, window.innerWidth);
      const viewportHeight = Math.max(0, window.innerHeight);
      const width = Math.min(config.width, Math.max(0, viewportWidth - viewportPadding * 2));
      const spaceBelow = viewportHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const openAbove = spaceBelow < config.estimatedHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(48, openAbove ? spaceAbove : spaceBelow);
      const left = Math.min(
        Math.max(config.align === 'end' ? rect.right - width : rect.left, viewportPadding),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
      );

      setStyle({
        position: 'fixed',
        left,
        right: 'auto',
        width,
        maxHeight: Math.min(config.maxHeight, availableHeight),
        overflowY: 'auto',
        zIndex: 10050,
        ...(openAbove
          ? { top: 'auto', bottom: viewportHeight - rect.top + gap }
          : { top: rect.bottom + gap, bottom: 'auto' }),
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, config, open]);

  return style;
}

function beginResourceDrag(
  event: React.DragEvent<HTMLDivElement>,
  resource: PaneResourceRef,
  onChange?: (dragging: PaneResourceRef | null) => void,
): void {
  event.dataTransfer.effectAllowed = 'move';
  const serialized = JSON.stringify(resource);
  event.dataTransfer.setData('application/x-sync-think-pane-resource', serialized);
  event.dataTransfer.setData('text/plain', serialized);
  onChange?.(resource);
}

export function ConversationTabs(props: ConversationTabsProps) {
  const byId = new Map(props.conversations.map((c) => [String(c.id), c] as const));
  const tabs = props.openIds.map((id) => byId.get(id)).filter((c): c is Conversation => Boolean(c));
  /** Tab context menu (right-click) — { id, x, y } anchored at cursor. */
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Split picker dropdown anchored at the strip-right split button. */
  const [splitPickerDirection, setSplitPickerDirection] = useState<PaneSplitDirection | null>(null);
  /** New-resource menu anchored at the plus button. */
  const [newResourceMenuOpen, setNewResourceMenuOpen] = useState(false);
  const newResourceAnchorRef = useRef<HTMLDivElement>(null);
  const newResourceMenuRef = useRef<HTMLDivElement>(null);
  const splitPickerAnchorRef = useRef<HTMLDivElement>(null);
  const splitPickerRef = useRef<HTMLDivElement>(null);
  const newResourceMenuStyle = useAnchoredMenuStyle(
    newResourceMenuOpen,
    newResourceAnchorRef,
    NEW_RESOURCE_MENU_CONFIG,
  );
  const splitPickerStyle = useAnchoredMenuStyle(
    Boolean(splitPickerDirection),
    splitPickerAnchorRef,
    SPLIT_PICKER_CONFIG,
  );

  // Any outside click dismisses menus (they're fixed-position overlays).
  useEffect(() => {
    if (!ctxMenu && !splitPickerDirection && !newResourceMenuOpen) return;
    const dismiss = () => {
      setCtxMenu(null);
      setSplitPickerDirection(null);
      setNewResourceMenuOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [ctxMenu, newResourceMenuOpen, splitPickerDirection]);

  /**
   * Conversations eligible for the split pane: any other than the active one.
   * Open tabs come first (most likely targets), then the rest of the workspace.
   */
  const openSet = new Set(props.openIds);
  const splitCandidates = [
    ...tabs.filter((c) => String(c.id) !== props.activeId),
    ...props.conversations.filter(
      (c) => !openSet.has(String(c.id)) && String(c.id) !== props.activeId,
    ),
  ];
  const paneSuffix = props.paneId ? `-${props.paneId}` : '';
  const canSplit = props.canSplit !== false;
  const hasWorkspaceFilesTab = props.workspaceFilesTab ?? props.workspaceFilesActive ?? false;

  const sensors = useSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nativeConversationDragIdRef = useRef<string | null>(null);

  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    props.onTabDragStateChange?.(null);
    if (!over || active.id === over.id) return;
    props.onReorder?.(String(active.id), String(over.id));
  };

  const beginConversationDrag = (
    event: React.DragEvent<HTMLDivElement>,
    conversationId: string,
  ) => {
    nativeConversationDragIdRef.current = conversationId;
    beginResourceDrag(
      event,
      { type: 'conversation', id: conversationId },
      props.onTabDragStateChange,
    );
  };

  const handleConversationDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!nativeConversationDragIdRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleConversationDrop = (
    event: React.DragEvent<HTMLDivElement>,
    targetConversationId: string,
  ) => {
    const sourceConversationId = nativeConversationDragIdRef.current;
    if (!sourceConversationId) return;
    event.preventDefault();
    event.stopPropagation();
    nativeConversationDragIdRef.current = null;
    props.onTabDragStateChange?.(null);
    if (sourceConversationId !== targetConversationId) {
      props.onReorder?.(sourceConversationId, targetConversationId);
    }
  };

  const requestSplit = (direction: PaneSplitDirection) => {
    if (!canSplit) return;
    if (splitCandidates.length === 1) {
      props.onOpenInSplit?.(String(splitCandidates[0]!.id), direction);
      return;
    }
    setSplitPickerDirection((current) => (current === direction ? null : direction));
  };

  return (
    <div
      data-testid="conversation-tabs"
      className="shell-conversation-tabs flex h-9 shrink-0 items-center px-2"
    >
      {/* Scrollable tab area is isolated from the right-side action group so
          pane actions stay visible even when many tabs overflow. */}
      <div className="shell-conversation-tabs__scroller flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) =>
            props.onTabDragStateChange?.({
              type: 'conversation',
              id: String(event.active.id),
            })
          }
          onDragEnd={handleTabDragEnd}
          onDragCancel={() => props.onTabDragStateChange?.(null)}
        >
          <SortableContext
            items={tabs.map((c) => String(c.id))}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((conversation) => {
              const id = String(conversation.id);
              const active = id === props.activeId;
              const label = conversation.title?.trim() || '新对话';
              const Icon = TRACK_TAB_ICON[conversation.track] ?? MessageSquare;
              return (
                <SortableConversationTab
                  key={id}
                  conversationId={id}
                  label={label}
                  icon={<Icon size={12} aria-hidden />}
                  active={active}
                  activeIconClass={active ? 'text-text-secondary' : 'text-text-faint'}
                  splitId={props.splitId}
                  running={props.conversationActivity?.get(id)?.running ?? false}
                  unread={props.conversationActivity?.get(id)?.unread ?? false}
                  onSelect={() => props.onSelect(id)}
                  onClose={() => props.onClose(id)}
                  onRename={() => props.onRename?.(id, label)}
                  onContextMenu={(e) => {
                    // Context menu lives on the whole tab (not just the title button)
                    // so right-clicking icon/close-area works too.
                    if (!props.onOpenInSplit) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ id, x: e.clientX, y: e.clientY });
                  }}
                  hasSplitAction={Boolean(props.onOpenInSplit)}
                  onNativeDragStart={(event) => beginConversationDrag(event, id)}
                  onNativeDragOver={handleConversationDragOver}
                  onNativeDrop={(event) => handleConversationDrop(event, id)}
                  onNativeDragEnd={() => {
                    nativeConversationDragIdRef.current = null;
                    props.onTabDragStateChange?.(null);
                  }}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        {(props.fileTabs ?? []).map((file) => {
          const active = file.path === props.activeFilePath;
          const label = file.path.split(/[\\/]/).at(-1) || file.path;
          const resource: PaneResourceRef = { type: 'file', id: file.path };
          return (
            <div
              key={file.id}
              data-testid={`file-tab-${file.path}`}
              data-active={active ? 'true' : 'false'}
              data-pane-resource-type="file"
              draggable
              className={clsx(
                'st-row-motion group relative flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
                active
                  ? 'shell-conversation-tab-active font-medium text-text'
                  : 'text-text-secondary hover:bg-hover/70 hover:text-text',
              )}
              onDragStart={(event) =>
                beginResourceDrag(event, resource, props.onTabDragStateChange)
              }
              onDragEnd={() => props.onTabDragStateChange?.(null)}
            >
              <FileTypeIcon path={file.path} size={12} className="shrink-0" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                aria-label={`打开文件 ${file.path}`}
                title={file.path}
                onClick={() => props.onSelectFile?.(file.path)}
              >
                {label}
              </button>
              <span
                className="flex h-3 w-3 shrink-0 items-center justify-center"
                aria-hidden={!file.dirty}
              >
                {file.dirty ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-warning"
                    data-testid={`file-tab-dirty-${file.path}`}
                    aria-label="未保存"
                  />
                ) : null}
              </span>
              <button
                type="button"
                className={clsx(
                  'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={`关闭文件 ${file.path}`}
                title="关闭文件标签"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseFile?.(file.path);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {(props.terminalTabs ?? []).map((terminal) => {
          const active = terminal.terminalId === props.activeTerminalId;
          const label = terminal.cwd ? `终端 · ${terminal.cwd}` : '终端';
          const resource: PaneResourceRef = { type: 'terminal', id: terminal.terminalId };
          return (
            <div
              key={terminal.id}
              data-testid={`terminal-tab-${terminal.terminalId}`}
              data-active={active ? 'true' : 'false'}
              data-pane-resource-type="terminal"
              draggable
              className={clsx(
                'st-row-motion group relative flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
                active
                  ? 'shell-conversation-tab-active font-medium text-text'
                  : 'text-text-secondary hover:bg-hover/70 hover:text-text',
              )}
              onDragStart={(event) =>
                beginResourceDrag(event, resource, props.onTabDragStateChange)
              }
              onDragEnd={() => props.onTabDragStateChange?.(null)}
            >
              <SquareTerminal
                size={12}
                className={clsx('shrink-0', active ? 'text-accent' : 'text-text-faint')}
                aria-hidden="true"
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                aria-label={`打开终端 ${terminal.terminalId}`}
                title={terminal.cwd || '项目根目录'}
                onClick={() => props.onSelectTerminal?.(terminal.terminalId)}
              >
                {label}
              </button>
              <button
                type="button"
                className={clsx(
                  'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={`关闭终端 ${terminal.terminalId}`}
                title="关闭终端标签"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseTerminal?.(terminal.terminalId);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {(props.browserTabs ?? []).map((browser) => {
          const active = browser.browserId === props.activeBrowserId;
          const resource: PaneResourceRef = { type: 'browser', id: browser.browserId };
          return (
            <div
              key={browser.id}
              data-testid={`browser-tab-${browser.browserId}`}
              data-active={active ? 'true' : 'false'}
              data-pane-resource-type="browser"
              draggable
              className={clsx(
                'st-row-motion group relative flex h-7 max-w-[240px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
                active
                  ? 'shell-conversation-tab-active font-medium text-text'
                  : 'text-text-secondary hover:bg-hover/70 hover:text-text',
              )}
              onDragStart={(event) =>
                beginResourceDrag(event, resource, props.onTabDragStateChange)
              }
              onDragEnd={() => props.onTabDragStateChange?.(null)}
            >
              <Globe
                size={12}
                className={clsx('shrink-0', active ? 'text-accent' : 'text-text-faint')}
                aria-hidden="true"
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                aria-label={`打开网页 ${browser.browserId}`}
                title={browser.url}
                onClick={() => props.onSelectBrowser?.(browser.browserId)}
              >
                {browser.url.replace(/^https?:\/\//i, '').replace(/\/$/, '') || '网页浏览'}
              </button>
              <button
                type="button"
                className={clsx(
                  'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={`关闭网页 ${browser.browserId}`}
                title="关闭网页标签"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseBrowser?.(browser.browserId);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {(props.reviewTabs ?? []).map((review) => {
          const active = review.runId === props.activeReviewRunId;
          const resource: PaneResourceRef = { type: 'review', id: review.runId };
          return (
            <div
              key={review.id}
              data-testid={`review-tab-${review.runId}`}
              data-active={active ? 'true' : 'false'}
              data-pane-resource-type="review"
              draggable
              className={clsx(
                'st-row-motion group relative flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
                active
                  ? 'shell-conversation-tab-active font-medium text-text'
                  : 'text-text-secondary hover:bg-hover/70 hover:text-text',
              )}
              onDragStart={(event) =>
                beginResourceDrag(event, resource, props.onTabDragStateChange)
              }
              onDragEnd={() => props.onTabDragStateChange?.(null)}
            >
              <FileDiff
                size={12}
                className={clsx('shrink-0', active ? 'text-accent' : 'text-text-faint')}
                aria-hidden="true"
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                aria-label={`打开审阅 ${review.runId}`}
                title="审阅本轮修改"
                onClick={() => props.onSelectReview?.(review.runId)}
              >
                审阅
              </button>
              <button
                type="button"
                className={clsx(
                  'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={`关闭审阅 ${review.runId}`}
                title="关闭审阅标签"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseReview?.(review.runId);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {hasWorkspaceFilesTab ? (
          <div
            data-testid={`workspace-files-tab${paneSuffix}`}
            data-active={props.workspaceFilesActive ? 'true' : 'false'}
            data-pane-resource-type="workspace-files"
            draggable
            className={clsx(
              'st-row-motion group relative flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
              props.workspaceFilesActive
                ? 'shell-conversation-tab-active font-medium text-text'
                : 'text-text-secondary hover:bg-hover/70 hover:text-text',
            )}
            onDragStart={(event) =>
              beginResourceDrag(
                event,
                { type: 'workspace-files', id: 'workspace-files' },
                props.onTabDragStateChange,
              )
            }
            onDragEnd={() => props.onTabDragStateChange?.(null)}
          >
            <Folder
              size={12}
              className={clsx(
                'shrink-0',
                props.workspaceFilesActive ? 'text-accent' : 'text-text-faint',
              )}
              aria-hidden="true"
            />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              aria-label="打开工作区文件"
              title="工作区文件"
              onClick={() => props.onSelectWorkspaceFiles?.()}
            >
              工作区文件
            </button>
            <button
              type="button"
              className={clsx(
                'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                props.workspaceFilesActive ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label="关闭工作区文件"
              title="关闭工作区文件标签"
              onClick={(event) => {
                event.stopPropagation();
                props.onCloseWorkspaceFiles?.();
              }}
            >
              <X size={11} />
            </button>
          </div>
        ) : null}

        <div ref={newResourceAnchorRef} className="relative shrink-0">
          <button
            type="button"
            data-testid="conversation-tab-new"
            className={clsx(
              'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row)',
              newResourceMenuOpen
                ? 'bg-active text-text'
                : 'text-text-secondary hover:bg-hover hover:text-text',
            )}
            title="新建资源"
            aria-label="新建资源"
            aria-expanded={newResourceMenuOpen}
            aria-haspopup="menu"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setNewResourceMenuOpen((open) => !open)}
          >
            <Plus size={14} />
          </button>
          {newResourceMenuOpen && newResourceMenuStyle && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={newResourceMenuRef}
                  className="shell-new-resource-menu"
                  role="menu"
                  data-testid="new-resource-menu"
                  style={newResourceMenuStyle}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="shell-new-resource-menu__title">新建资源</div>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-resource-conversation"
                    className="shell-new-resource-menu__item"
                    onClick={() => {
                      setNewResourceMenuOpen(false);
                      props.onNew();
                    }}
                  >
                    <MessageSquarePlus size={14} />
                    <span>
                      <strong>新建对话</strong>
                      <small>在当前窗格打开新的对话草稿</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-resource-terminal"
                    className="shell-new-resource-menu__item"
                    disabled={props.canOpenTerminal === false}
                    title={props.canOpenTerminal === false ? '先绑定项目文件夹' : undefined}
                    onClick={() => {
                      setNewResourceMenuOpen(false);
                      props.onNewTerminal?.();
                    }}
                  >
                    <SquareTerminal size={14} />
                    <span>
                      <strong>新建终端</strong>
                      <small>在当前窗格启动一个终端</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-resource-browser"
                    className="shell-new-resource-menu__item"
                    onClick={() => {
                      setNewResourceMenuOpen(false);
                      props.onNewBrowser?.();
                    }}
                  >
                    <Globe size={14} />
                    <span>
                      <strong>网页浏览</strong>
                      <small>在当前窗格打开网页浏览器</small>
                    </span>
                  </button>
                </div>,
                document.body,
              )
            : null}
        </div>
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-0.5">
        {props.onToggleWorkspaceFilesPane ? (
          <button
            type="button"
            data-testid={`workspace-files-toggle${paneSuffix}`}
            className={clsx(
              'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) transition-colors',
              props.workspaceFilesPaneOpen
                ? 'bg-active text-text'
                : 'text-text-faint hover:bg-hover hover:text-text',
            )}
            title={props.workspaceFilesPaneOpen ? '隐藏工作区文件' : '打开工作区文件'}
            aria-label={props.workspaceFilesPaneOpen ? '隐藏工作区文件' : '打开工作区文件'}
            onClick={props.onToggleWorkspaceFilesPane}
          >
            <Folder size={14} />
          </button>
        ) : null}
        {props.onOpenInSplit ? (
          <div ref={splitPickerAnchorRef} className="relative flex items-center gap-0.5">
            <button
              type="button"
              data-testid={`chat-split-horizontal${paneSuffix}`}
              disabled={!canSplit}
              className={clsx(
                'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) transition-colors',
                splitPickerDirection === 'horizontal'
                  ? 'bg-active text-text'
                  : 'text-text-faint hover:bg-hover hover:text-text',
                !canSplit && 'cursor-not-allowed opacity-35',
              )}
              title={canSplit ? '向右分屏' : '当前对话窗格已达性能上限'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => requestSplit('horizontal')}
            >
              <Columns2 size={14} />
            </button>
            <button
              type="button"
              data-testid={`chat-split-vertical${paneSuffix}`}
              disabled={!canSplit}
              className={clsx(
                'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) transition-colors',
                splitPickerDirection === 'vertical'
                  ? 'bg-active text-text'
                  : 'text-text-faint hover:bg-hover hover:text-text',
                !canSplit && 'cursor-not-allowed opacity-35',
              )}
              title={canSplit ? '向下分屏' : '当前对话窗格已达性能上限'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => requestSplit('vertical')}
            >
              <Rows2 size={14} />
            </button>
            {splitPickerDirection && splitPickerStyle && typeof document !== 'undefined'
              ? createPortal(
                  <div
                    ref={splitPickerRef}
                    className="shell-split-picker shell-split-picker--pane"
                    data-testid={`chat-split-picker${paneSuffix}`}
                    style={splitPickerStyle}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="shell-split-picker__title">选择分屏对话</div>
                    {splitCandidates.length === 0 ? (
                      <div className="shell-split-picker__empty">打开另一个对话标签后即可分屏</div>
                    ) : (
                      splitCandidates.map((c) => {
                        const cid = String(c.id);
                        const CandidateIcon = TRACK_TAB_ICON[c.track] ?? MessageSquare;
                        return (
                          <button
                            key={cid}
                            type="button"
                            className="shell-split-picker__item"
                            onClick={() => {
                              const direction = splitPickerDirection;
                              setSplitPickerDirection(null);
                              props.onOpenInSplit?.(cid, direction);
                            }}
                          >
                            <CandidateIcon size={12} className="shrink-0 text-text-faint" />
                            <span className="min-w-0 flex-1 truncate">
                              {c.title?.trim() || '新对话'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}
        {props.onClosePane ? (
          <button
            type="button"
            data-testid={`chat-close-pane${paneSuffix}`}
            className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text"
            title="关闭窗格"
            onClick={props.onClosePane}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {ctxMenu ? (
        <div
          className="shell-tab-ctx-menu"
          data-testid="conversation-tab-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="shell-tab-ctx-menu__item"
            data-testid="tab-ctx-open-split"
            disabled={!canSplit || ctxMenu.id === props.activeId}
            onClick={() => {
              const id = ctxMenu.id;
              setCtxMenu(null);
              props.onOpenInSplit?.(id, 'horizontal');
            }}
          >
            <Columns2 size={12} />
            在分屏中打开
          </button>
          <button
            type="button"
            className="shell-tab-ctx-menu__item"
            onClick={() => {
              const target = byId.get(ctxMenu.id);
              const id = ctxMenu.id;
              setCtxMenu(null);
              props.onRename?.(id, target?.title?.trim() || '新对话');
            }}
          >
            <MessageSquare size={12} />
            重命名
          </button>
          <button
            type="button"
            className="shell-tab-ctx-menu__item is-danger"
            onClick={() => {
              const id = ctxMenu.id;
              setCtxMenu(null);
              props.onClose(id);
            }}
          >
            <X size={12} />
            关闭标签
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SortableConversationTab(props: {
  conversationId: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  activeIconClass: string;
  splitId?: string;
  running: boolean;
  unread: boolean;
  hasSplitAction: boolean;
  onSelect(): void;
  onClose(): void;
  onRename(): void;
  onContextMenu(e: React.MouseEvent): void;
  onNativeDragStart(e: React.DragEvent<HTMLDivElement>): void;
  onNativeDragOver(e: React.DragEvent<HTMLDivElement>): void;
  onNativeDrop(e: React.DragEvent<HTMLDivElement>): void;
  onNativeDragEnd(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: props.conversationId,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`conversation-tab-${props.conversationId}`}
      data-active={props.active ? 'true' : 'false'}
      draggable
      className={clsx(
        'st-row-motion group relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
        props.active
          ? 'shell-conversation-tab-active font-medium text-text'
          : 'text-text-secondary hover:bg-hover/70 hover:text-text',
        isDragging && 'z-50 opacity-70',
        'cursor-grab active:cursor-grabbing',
      )}
      style={{
        ...(transform
          ? {
              transform: CSS.Transform.toString({ ...transform, scaleX: 1, scaleY: 1 }),
              transition: 'transform 150ms ease',
            }
          : {}),
      }}
      {...attributes}
      {...listeners}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onNativeDragStart}
      onDragOver={props.onNativeDragOver}
      onDrop={props.onNativeDrop}
      onDragEnd={props.onNativeDragEnd}
    >
      {/* Status marker sits at the left of each conversation tab: a pulsing
          dot while running/thinking, a static dot when finished-but-unread.
          Visual-only — no text — so the tab row stays compact. */}
      {props.running ? (
        <span
          className="shell-activity-dot shell-activity-dot--running"
          data-testid={`conversation-running-${props.conversationId}`}
          aria-label="正在运行"
        />
      ) : props.unread ? (
        <span
          className="shell-activity-dot shell-activity-dot--unread"
          data-testid={`conversation-unread-${props.conversationId}`}
          aria-label="已完成待查看"
        />
      ) : null}
      <span
        className={clsx(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center',
          props.activeIconClass,
        )}
        aria-hidden
      >
        {props.icon}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        title={props.hasSplitAction ? `${props.label}（右键更多操作）` : props.label}
        onClick={props.onSelect}
        onDoubleClick={props.onRename}
      >
        {props.label}
      </button>
      {props.splitId === props.conversationId ? (
        <Columns2 size={11} className="shrink-0 text-accent" aria-label="已在分屏中" />
      ) : null}
      <button
        type="button"
        data-testid={`conversation-tab-close-${props.conversationId}`}
        className={clsx(
          'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
          props.active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
        )}
        title="关闭标签"
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}
