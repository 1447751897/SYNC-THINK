// Stage conversation tab strip (T1 / O1).
// Opened subset of the current workspace's conversations — close tab ≠ delete.
// Tabs are draggable so users can reorder the open set (order is persisted).
import { useEffect, useRef, useState } from 'react';
import { Bot, Columns2, MessageSquare, PanelRight, Plus, Users, X } from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, ConversationTrack } from '@sync-think/shared';

export interface ConversationTabsProps {
  conversations: readonly Conversation[];
  openIds: readonly string[];
  activeId?: string;
  railOpen?: boolean;
  /** Conversation currently shown in the split (right) pane, if any. */
  splitId?: string;
  onSelect(conversationId: string): void;
  onClose(conversationId: string): void;
  onNew(): void;
  onReorder?(fromId: string, toId: string): void;
  onToggleRail?(): void;
  onRename?(conversationId: string, currentTitle: string): void;
  /** Right-click a tab → open that conversation in the split pane. */
  onOpenInSplit?(conversationId: string): void;
  onCloseSplit?(): void;
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** Tab context menu (right-click) — { id, x, y } anchored at cursor. */
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Split picker dropdown anchored at the strip-right split button. */
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const splitBtnRef = useRef<HTMLButtonElement | null>(null);

  // Any outside click dismisses menus (they're fixed-position overlays).
  useEffect(() => {
    if (!ctxMenu && !splitPickerOpen) return;
    const dismiss = () => {
      setCtxMenu(null);
      setSplitPickerOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [ctxMenu, splitPickerOpen]);

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

  return (
    <div
      data-testid="conversation-tabs"
      className="shell-conversation-tabs flex h-9 shrink-0 items-end px-2"
    >
      {/* Scrollable tab area is isolated from the right-side action group so
          the split / rail buttons stay visible even when many tabs overflow. */}
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
      {tabs.map((conversation) => {
        const id = String(conversation.id);
        const active = id === props.activeId;
        const label = conversation.title?.trim() || '新对话';
        const Icon = TRACK_TAB_ICON[conversation.track] ?? MessageSquare;
        const isDragging = draggingId === id;
        const isDropTarget = dropTargetId === id && draggingId && draggingId !== id;
        return (
          <div
            key={id}
            data-testid={`conversation-tab-${id}`}
            data-active={active ? 'true' : 'false'}
            draggable={Boolean(props.onReorder)}
            onDragStart={(e) => {
              if (!props.onReorder) return;
              setDraggingId(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
              props.onTabDragStateChange?.(id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
              props.onTabDragStateChange?.(null);
            }}
            onDragOver={(e) => {
              if (!props.onReorder || !draggingId || draggingId === id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTargetId(id);
            }}
            onDragLeave={() => {
              setDropTargetId((current) => (current === id ? null : current));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const fromId = e.dataTransfer.getData('text/plain') || draggingId;
              setDraggingId(null);
              setDropTargetId(null);
              if (!fromId || fromId === id) return;
              props.onReorder?.(fromId, id);
            }}
            className={clsx(
              'st-row-motion group relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[12.5px]',
              active
                ? 'shell-conversation-tab-active bg-surface font-medium text-text'
                : 'text-text-secondary hover:bg-hover/70 hover:text-text',
              isDragging && 'opacity-50',
              isDropTarget && 'ring-1 ring-accent/50',
              props.onReorder && 'cursor-grab active:cursor-grabbing',
            )}
            onContextMenu={(e) => {
              // Context menu lives on the whole tab (not just the title button)
              // so right-clicking icon/close-area works too.
              if (!props.onOpenInSplit) return;
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ id, x: e.clientX, y: e.clientY });
            }}
          >
            <Icon
              size={12}
              className={clsx(
                'shrink-0',
                active ? 'text-text-secondary' : 'text-text-faint',
              )}
              aria-hidden
            />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              title={props.onOpenInSplit ? `${label}（右键更多操作）` : label}
              onClick={() => props.onSelect(id)}
              onDoubleClick={() => props.onRename?.(id, label)}
            >
              {label}
            </button>
            {props.splitId === id ? (
              <Columns2 size={11} className="shrink-0 text-accent" aria-label="已在分屏中" />
            ) : null}
            {props.conversationActivity?.get(id)?.running ? (
              <span
                className="shell-activity-dot shell-activity-dot--running"
                data-testid={`conversation-running-${id}`}
                aria-label="正在运行"
              />
            ) : props.conversationActivity?.get(id)?.unread ? (
              <span
                className="shell-activity-dot shell-activity-dot--unread"
                data-testid={`conversation-unread-${id}`}
                aria-label="已完成待查看"
              />
            ) : null}
            <button
              type="button"
              data-testid={`conversation-tab-close-${id}`}
              className={clsx(
                'st-icon-motion flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text',
                active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
              )}
              title="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                props.onClose(id);
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
        className="st-icon-motion mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text"
        title="新建对话"
        onClick={props.onNew}
      >
        <Plus size={14} />
      </button>
      </div>

      <div className="mb-0.5 ml-2 flex shrink-0 items-center gap-0.5">
        {props.onOpenInSplit ? (
          <div className="relative">
            <button
              type="button"
              ref={splitBtnRef}
              data-testid="chat-split-button"
              className={clsx(
                'st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) transition-colors',
                props.splitId
                  ? 'bg-active text-text'
                  : 'text-text-faint hover:bg-hover hover:text-text',
              )}
              title={props.splitId ? '关闭分屏' : '分屏对话'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                // Toggle semantics: already split → close; otherwise pick a
                // conversation for the right pane (single candidate opens直接).
                if (props.splitId && props.onCloseSplit) {
                  props.onCloseSplit();
                  return;
                }
                if (splitCandidates.length === 1) {
                  props.onOpenInSplit?.(String(splitCandidates[0]!.id));
                  return;
                }
                setSplitPickerOpen((v) => !v);
              }}
            >
              <Columns2 size={14} />
            </button>
            {splitPickerOpen ? (
              <div
                className="shell-split-picker"
                data-testid="chat-split-picker"
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
                          setSplitPickerOpen(false);
                          props.onOpenInSplit?.(cid);
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
            disabled={ctxMenu.id === props.activeId}
            onClick={() => {
              const id = ctxMenu.id;
              setCtxMenu(null);
              props.onOpenInSplit?.(id);
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
