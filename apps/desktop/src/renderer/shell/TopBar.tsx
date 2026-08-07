// NewMax-style top bar: workspace tabs + full menu from "+"
// Menu portals to body so overflow:hidden stage boards cannot clip it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  FolderOpen,
  FolderPlus,
  PanelLeft,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceSummary } from '@sync-think/protocol';
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
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const WORKSPACE_ICON_PRESETS = ['📁', '💼', '🧠', '🚀', '📦', '🛠', '📚', '🧪', '🏠', '⭐'] as const;

export interface TopBarProps {
  workspaces: readonly WorkspaceSummary[];
  /** Always a workspace id when workspaces exist (no 全部). */
  activeWorkspaceId?: string;
  sidebarCollapsed: boolean;
  onSelectWorkspace(workspaceId: string): void;
  onOpenFolder(): void;
  onCreateWorkspace(input: {
    name: string;
    folderPath: string;
    icon?: string;
  }): Promise<boolean>;
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
  /** Optional pick-folder bridge used by the create/edit dialog. */
  onPickFolder(): Promise<{ canceled: boolean; path?: string }>;
  /**
   * 各工作区任务状态（运行中动效 / 完成未读圆点）。
   * key = workspaceId；缺省即无指示。
   */
  workspaceActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
}

export function TopBar(props: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSummary | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  // Local display order for drag reordering; follows props when not dragging.
  // Hidden workspaces are excluded from the row (they live in the menu only).
  const visibleWorkspaces = props.workspaces.filter((w) => !w.hidden);
  const hiddenWorkspaces = props.workspaces.filter((w) => w.hidden);
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    visibleWorkspaces.map((w) => w.workspaceId),
  );
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (isDraggingRef.current) return;
    setOrderIds(props.workspaces.filter((w) => !w.hidden).map((w) => w.workspaceId));
  }, [props.workspaces]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = () => {
    isDraggingRef.current = true;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    isDraggingRef.current = false;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderIds((current) => {
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = current.indexOf(activeId);
      const newIndex = current.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void props.onReorderWorkspaces?.(next);
      return next;
    });
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuStyle(null);
      return;
    }
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 320;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const maxH = Math.min(360, Math.max(180, spaceBelow));
      setMenuStyle({
        position: 'fixed',
        top: r.bottom + 6,
        left,
        width,
        maxHeight: maxH,
        zIndex: 10050,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
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
  }, [menuOpen]);

  return (
    <header
      data-testid="shell-topbar"
      className="shell-topbar shell-workspace-tabs relative flex h-9 shrink-0 items-end gap-0 px-2"
    >
      {props.sidebarCollapsed ? (
        <button
          data-testid="topbar-open-sidebar"
          className="st-icon-motion mb-0.5 mr-1 flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text"
          title="展开侧栏 (Ctrl+B)"
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={15} />
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            isDraggingRef.current = false;
          }}
        >
          <SortableContext items={orderIds} strategy={horizontalListSortingStrategy}>
            {orderIds.map((workspaceId) => {
              const workspace = props.workspaces.find(
                (w) => w.workspaceId === workspaceId,
              );
              if (!workspace) return null;
              return (
                <SortableProjectTab
                  key={workspace.workspaceId}
                  workspaceId={workspace.workspaceId}
                  label={workspace.name}
                  icon={workspace.icon}
                  title={workspace.folderPath}
                  active={props.activeWorkspaceId === workspace.workspaceId}
                  running={
                    props.workspaceActivity?.get(workspace.workspaceId)?.running ?? false
                  }
                  unread={
                    props.workspaceActivity?.get(workspace.workspaceId)?.unread ?? false
                  }
                  onClick={() => props.onSelectWorkspace(workspace.workspaceId)}
                  onHide={() => props.onSetWorkspaceHidden?.(workspace.workspaceId, true)}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        <div className="relative mb-0.5 shrink-0">
          <button
            ref={triggerRef}
            type="button"
            data-testid="topbar-workspace-menu"
            className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text"
            title="工作区"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <Plus size={14} />
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
                                    未绑定路径
                                  </span>
                                )}
                              </span>
                              {isActive ? (
                                <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                              ) : (
                                <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              )}
                            </button>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
      </div>

      {props.onOpenTerminal ? (
        <button
          type="button"
          data-testid="topbar-open-terminal"
          disabled={props.canOpenTerminal === false}
          className={clsx(
            'st-icon-motion mb-0.5 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text',
            props.canOpenTerminal === false && 'cursor-not-allowed opacity-35',
          )}
          title={props.canOpenTerminal === false ? '先绑定项目文件夹' : '在当前窗格打开终端'}
          aria-label="在当前窗格打开终端"
          onClick={props.onOpenTerminal}
        >
          <SquareTerminal size={14} />
        </button>
      ) : null}

      {createOpen ? (
        <WorkspaceFormDialog
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
        />
      ) : null}

      {editing ? (
        <WorkspaceFormDialog
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
        />
      ) : null}
    </header>
  );
}

function ProjectTab(props: {
  label: string;
  icon?: string;
  title?: string;
  active: boolean;
  /** 该工作区有任务正在运行 → 呼吸圆点动效。 */
  running?: boolean;
  /** 该工作区有已完成但未查看的任务 → 静态未读圆点。 */
  unread?: boolean;
  dragging?: boolean;
  /** Drag transform from dnd-kit; applied as a visual offset while dragging. */
  dragTransform?: string | undefined;
  onClick(): void;
  /** Hide this workspace from the folder row (data untouched). */
  onHide?(): void;
  sortableProps?: {
    ref(node: HTMLButtonElement | null): void;
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
  };
}) {
  return (
    <button
      ref={props.sortableProps?.ref}
      data-testid={`project-tab-${props.label}`}
      title={
        props.running
          ? `${props.title ?? props.label} · 有任务正在运行`
          : props.unread
            ? `${props.title ?? props.label} · 有已完成任务待查看`
            : props.title
      }
      {...props.sortableProps?.attributes}
      {...props.sortableProps?.listeners}
      className={clsx(
        'st-row-motion group relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-(--radius-row) px-2.5 text-[14px]',
        props.active
          ? 'shell-workspace-tab-active font-medium text-text'
          : 'text-text-secondary hover:bg-hover/70 hover:text-text',
        props.dragging && 'z-50 opacity-70',
      )}
      style={{
        ...(props.dragTransform
          ? { transform: props.dragTransform, transition: 'transform 150ms ease' }
          : {}),
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={props.onClick}
      >
        <span
          className={clsx(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[12px] leading-none',
            props.active ? 'text-text-secondary' : 'text-text-faint',
          )}
          aria-hidden
        >
          {props.icon?.trim() || '📁'}
        </span>
        <span className="truncate">{props.label}</span>
        {props.running ? (
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
      </button>
      {props.onHide ? (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-opacity hover:bg-hover hover:text-text group-hover:opacity-100"
          role="button"
          tabIndex={0}
          aria-label={`从文件夹行移除 ${props.label}`}
          title="从文件夹行移除"
          onClick={(e) => {
            e.stopPropagation();
            props.onHide?.();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            props.onHide?.();
          }}
        >
          <X size={11} />
        </span>
      ) : null}
    </button>
  );
}

function SortableProjectTab(props: {
  workspaceId: string;
  label: string;
  icon?: string;
  title?: string;
  active: boolean;
  running?: boolean;
  unread?: boolean;
  onClick(): void;
  onHide?(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: props.workspaceId,
  });
  return (
    <ProjectTab
      label={props.label}
      icon={props.icon}
      title={props.title}
      active={props.active}
      running={props.running}
      unread={props.unread}
      dragging={isDragging}
      dragTransform={
        transform
          ? CSS.Transform.toString({ ...transform, scaleX: 1, scaleY: 1 })
          : undefined
      }
      onClick={props.onClick}
      onHide={props.onHide}
      sortableProps={{
        ref: setNodeRef,
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown>,
      }}
    />
  );
}

function WorkspaceFormDialog(props: {
  mode: 'create' | 'edit';
  initial?: { name: string; folderPath: string; icon?: string };
  onPickFolder(): Promise<{ canceled: boolean; path?: string }>;
  onClose(): void;
  onSubmit(input: { name: string; folderPath: string; icon?: string }): Promise<boolean>;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [path, setPath] = useState(props.initial?.folderPath ?? '');
  const [icon, setIcon] = useState(props.initial?.icon ?? '');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const browse = async () => {
    const picked = await props.onPickFolder();
    if (picked.canceled || !picked.path) return;
    setPath(picked.path);
    if (!name.trim()) {
      const auto =
        picked.path
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop() ?? '';
      if (auto) setName(auto);
    }
  };

  const submit = async () => {
    const n = name.trim();
    const p = path.trim();
    if (!n) {
      setError('请填写工作区名称');
      return;
    }
    if (props.mode === 'create' && !p) {
      setError('必须选择本地文件夹');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    let ok = false;
    try {
      ok = await props.onSubmit({
        name: n,
        folderPath: p,
        icon: icon.trim() || undefined,
      });
    } catch (err) {
      ok = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      props.onClose();
      return;
    }
    setError((prev) => prev ?? (props.mode === 'create' ? '创建工作区失败' : '保存工作区失败'));
  };

  return (
    <div
      className="st-backdrop-in fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      data-testid={props.mode === 'create' ? 'create-workspace-dialog' : 'edit-workspace-dialog'}
      onMouseDown={(e) => {
        if (submitting) return;
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="st-modal-in w-[440px] rounded-(--radius-card) border border-border bg-overlay p-4 shadow-2xl">
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-[14px] font-semibold text-text">
            {props.mode === 'create' ? '新建工作区' : '编辑工作区'}
          </h3>
          <button
            type="button"
            className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text"
            onClick={props.onClose}
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] text-text-secondary">工作区名称</span>
          <input
            data-testid="workspace-form-name"
            className="st-field-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            placeholder="例如 SYNC-THINK"
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] text-text-secondary">路径</span>
          <div className="flex gap-2">
            <input
              data-testid="workspace-form-path"
              className="st-field-input flex-1"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setError(undefined);
              }}
              placeholder="选择本地文件夹"
            />
            <button
              type="button"
              data-testid="workspace-form-browse"
              className="st-row-motion h-[34px] shrink-0 rounded-(--radius-row) border border-border px-3 text-[14px] text-text-secondary hover:bg-hover"
              onClick={() => void browse()}
            >
              浏览
            </button>
          </div>
        </label>

        <div className="mb-3">
          <span className="mb-1 block text-[12px] text-text-secondary">图标</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {WORKSPACE_ICON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-(--radius-row) border text-[15px]',
                  icon === preset
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:bg-hover',
                )}
                onClick={() => setIcon(preset)}
                title={preset}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            data-testid="workspace-form-icon"
            className="st-field-input"
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 8))}
            placeholder="也可直接输入 emoji"
          />
        </div>

        {error ? <div className="mb-3 text-[12px] text-error">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="st-row-motion h-8 rounded-(--radius-row) px-3 text-[14px] text-text-secondary hover:bg-hover"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="workspace-form-submit"
            disabled={submitting}
            className="st-row-motion h-8 rounded-(--radius-row) bg-accent px-3 text-[14px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void submit()}
          >
            {submitting ? '保存中…' : props.mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
