// Stage conversation tab strip (T1 / O1).
// Opened subset of the current workspace's conversations — close tab ≠ delete.
// Tabs are draggable so users can reorder the open set (order is persisted).
import { useEffect, useState } from 'react';
import {
  Bot,
  Columns2,
  FileCode2,
  MessageSquare,
  PanelRight,
  Plus,
  Rows2,
  SquareTerminal,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, ConversationTrack } from '@sync-think/shared';
import type { PaneSplitDirection } from './pane-layout.js';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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

export interface ConversationTabsProps {
  paneId?: string;
  conversations: readonly Conversation[];
  openIds: readonly string[];
  activeId?: string;
  fileTabs?: readonly { id: string; path: string; dirty?: boolean }[];
  activeFilePath?: string;
  terminalTabs?: readonly { id: string; terminalId: string; cwd: string }[];
  activeTerminalId?: string;
  railOpen?: boolean;
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
  canOpenTerminal?: boolean;
  onNew(): void;
  onReorder?(fromId: string, toId: string): void;
  onToggleRail?(): void;
  onRename?(conversationId: string, currentTitle: string): void;
  /** Right-click a tab → open that conversation in the split pane. */
  onOpenInSplit?(conversationId: string, direction: PaneSplitDirection): void;
  onCloseSplit?(): void;
  onClosePane?(): void;
  /**
   * 拖拽 tab 的开始/结束通知（携带被拖对话 id 或 null）。宿主用它在聊天区
   * 显示「拖到此处开分屏」的落点。
   */
  onTabDragStateChange?(draggingId: string | null): void;
  /** 各对话任务状态（运行中动效 / 完成未读圆点）。key = conversationId。 */
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
}

const TRACK_TAB_ICON: Record<ConversationTrack, typeof MessageSquare> = {
  model: MessageSquare,
  agent: Bot,
  team: Users,
};

export function ConversationTabs(props: ConversationTabsProps) {
  const byId = new Map(props.conversations.map((c) => [String(c.id), c] as const));
  const tabs = props.openIds
    .map((id) => byId.get(id))
    .filter((c): c is Conversation => Boolean(c));
  /** Tab context menu (right-click) — { id, x, y } anchored at cursor. */
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Split picker dropdown anchored at the strip-right split button. */
  const [splitPickerDirection, setSplitPickerDirection] = useState<PaneSplitDirection | null>(null);

  // Any outside click dismisses menus (they're fixed-position overlays).
  useEffect(() => {
    if (!ctxMenu && !splitPickerDirection) return;
    const dismiss = () => {
      setCtxMenu(null);
      setSplitPickerDirection(null);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [ctxMenu, splitPickerDirection]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    props.onTabDragStateChange?.(null);
    if (!over || active.id === over.id) return;
    props.onReorder?.(String(active.id), String(over.id));
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
      className="shell-conversation-tabs flex h-9 shrink-0 items-start px-2 pt-1"
    >
      {/* Scrollable tab area is isolated from the right-side action group so
          the split / rail buttons stay visible even when many tabs overflow. */}
      <div className="flex min-w-0 flex-1 items-start gap-0.5 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => props.onTabDragStateChange?.(String(event.active.id))}
          onDragEnd={handleTabDragEnd}
          onDragCancel={() => props.onTabDragStateChange?.(null)}
        >
          <SortableContext items={tabs.map((c) => String(c.id))} strategy={horizontalListSortingStrategy}>
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
                />
              );
            })}
          </SortableContext>
        </DndContext>

      {(props.fileTabs ?? []).map((file) => {
        const active = file.path === props.activeFilePath;
        const label = file.path.split(/[\\/]/).at(-1) || file.path;
        return (
          <div
            key={file.id}
            data-testid={`file-tab-${file.path}`}
            data-active={active ? 'true' : 'false'}
            className={clsx(
              'st-row-motion group relative flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
              active
                ? 'shell-conversation-tab-active font-medium text-text'
                : 'text-text-secondary hover:bg-hover/70 hover:text-text',
            )}
          >
            <FileCode2
              size={12}
              className={clsx('shrink-0', active ? 'text-accent' : 'text-text-faint')}
              aria-hidden
            />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              aria-label={`打开文件 ${file.path}`}
              title={file.path}
              onClick={() => props.onSelectFile?.(file.path)}
            >
              {label}
            </button>
            <span className="flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden={!file.dirty}>
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
        return (
          <div
            key={terminal.id}
            data-testid={`terminal-tab-${terminal.terminalId}`}
            data-active={active ? 'true' : 'false'}
            className={clsx(
              'st-row-motion group relative flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
              active
                ? 'shell-conversation-tab-active font-medium text-text'
                : 'text-text-secondary hover:bg-hover/70 hover:text-text',
            )}
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

      <button
        type="button"
        data-testid="conversation-tab-new"
        className="st-icon-motion mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text"
        title="新建对话"
        onClick={props.onNew}
      >
        <Plus size={14} />
      </button>
      </div>

      <div className="mt-0.5 ml-2 flex shrink-0 items-center gap-0.5">
        {props.onNewTerminal ? (
          <button
            type="button"
            data-testid={`pane-new-terminal${paneSuffix}`}
            disabled={props.canOpenTerminal === false}
            className={clsx(
              'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text',
              props.canOpenTerminal === false && 'cursor-not-allowed opacity-35',
            )}
            title={props.canOpenTerminal === false ? '先绑定项目文件夹' : '打开终端'}
            aria-label="打开终端"
            onClick={props.onNewTerminal}
          >
            <SquareTerminal size={14} />
          </button>
        ) : null}
        {props.onOpenInSplit ? (
          <div className="relative flex items-center gap-0.5">
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
            {splitPickerDirection ? (
              <div
                className="shell-split-picker shell-split-picker--pane"
                data-testid={`chat-split-picker${paneSuffix}`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="shell-split-picker__title">选择分屏对话</div>
                {splitCandidates.length === 0 ? (
                  <div className="shell-split-picker__empty">
                    打开另一个对话标签后即可分屏
                  </div>
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
              </div>
            ) : null}
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
        {props.onToggleRail ? (
          <button
            type="button"
            data-testid="chat-toggle-rail"
            className={clsx(
              'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) transition-colors',
              props.railOpen
                ? 'bg-active text-text'
                : 'text-text-faint hover:bg-hover hover:text-text',
            )}
            title={props.railOpen ? '收起右栏' : '打开右栏'}
            onClick={props.onToggleRail}
          >
            <PanelRight size={14} />
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
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: props.conversationId,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`conversation-tab-${props.conversationId}`}
      data-active={props.active ? 'true' : 'false'}
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
    >
      <span
        className={clsx('flex h-3.5 w-3.5 shrink-0 items-center justify-center', props.activeIconClass)}
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
