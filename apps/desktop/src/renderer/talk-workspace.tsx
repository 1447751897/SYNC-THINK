import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowUpRight,
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  ListTodo,
  Moon,
  Plus,
  Puzzle,
  Search,
  Server,
  Settings,
  Sun,
  Users,
  Zap,
  Crown,
  Trash2,
  Pencil,
  Save,
  Play,
  Clock3,
  Link2,
  Copy,
  CheckCircle2,
  Activity,
  FolderInput,
  HardDrive,
  Image as ImageIcon,
  MessageSquareText,
  Palette,
  Terminal,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Columns2,
  AlignLeft,
  Archive,
  ArchiveRestore,
  ShieldCheck,
  GitBranch,
  Globe2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  AddGroupMemberPayload,
  CreateGroupPayload,
  CreateGroupTaskPayload,
  RemoveGroupMemberPayload,
  SetGroupLeadPayload,
  UpdateGroupMemberResponsibilityPayload,
  UpdateGroupPayload,
  WorkspaceSummary,
  AutomationRuntimeStatus,
  CreateAutomationPayload,
  UpdateAutomationPayload,
  TaskSummary,
  BrowserIdentitySummary,
} from '@sync-think/protocol';
import type {
  ApprovalMode,
  AutomationDefinition,
  AutomationExecution,
  GroupCollaborationMode,
  GroupDefinition,
  GroupKind,
} from '@sync-think/shared';
import {
  type AppShellProps,
  type AgentBindingPanelProps,
  type AgentBindingMcpOption,
  type AgentBindingSkillOption,
  type Theme,
} from '@sync-think/ui-kit';

export type TalkProductSection =
  'tasks' | 'projects' | 'friends' | 'groups' | 'automation' | 'providers' | 'skills' | 'settings';

const NAV_ITEMS: Array<{
  id: TalkProductSection;
  label: string;
  icon: typeof ListTodo;
}> = [
  { id: 'tasks', label: '对话任务', icon: ListTodo },
  { id: 'projects', label: '项目', icon: FolderOpen },
  { id: 'friends', label: '好友', icon: Bot },
  { id: 'groups', label: '群聊', icon: Users },
  { id: 'automation', label: '自动化', icon: Zap },
  { id: 'providers', label: '模型源', icon: Server },
  { id: 'skills', label: 'Skill & MCP', icon: Puzzle },
];

export function TalkGlobalNav(props: {
  section: TalkProductSection;
  collapsed: boolean;
  theme: Theme;
  runtimeState: string;
  onSectionChange: (section: TalkProductSection) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <div className="st-talk-global" data-collapsed={props.collapsed ? '1' : '0'}>
      <header className="st-talk-global__brand">
        <span className="st-talk-global__mark" aria-hidden="true">
          <Zap size={13} strokeWidth={2.2} />
        </span>
        {props.collapsed ? null : <strong>SYNC-THINK</strong>}
      </header>
      <nav className="st-talk-global__nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = props.section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-active={active ? '1' : '0'}
              aria-current={active ? 'page' : undefined}
              title={props.collapsed ? item.label : undefined}
              onClick={() => props.onSectionChange(item.id)}
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              {props.collapsed ? null : <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <footer className="st-talk-global__footer">
        <button
          type="button"
          data-active={props.section === 'settings' ? '1' : '0'}
          title={props.collapsed ? '设置' : undefined}
          onClick={() => props.onSectionChange('settings')}
        >
          <Settings aria-hidden="true" size={15} strokeWidth={1.8} />
          {props.collapsed ? null : <span>设置</span>}
        </button>
        <button
          type="button"
          title={props.theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
          onClick={() => props.onThemeChange(props.theme === 'dark' ? 'light' : 'dark')}
        >
          {props.theme === 'dark' ? (
            <Sun aria-hidden="true" size={15} strokeWidth={1.8} />
          ) : (
            <Moon aria-hidden="true" size={15} strokeWidth={1.8} />
          )}
          {props.collapsed ? null : <span>{props.theme === 'dark' ? '浅色主题' : '深色主题'}</span>}
        </button>
        <div className="st-talk-global__runtime" data-state={props.runtimeState}>
          <i aria-hidden="true" />
          {props.collapsed ? null : (
            <span>Runtime {props.runtimeState === 'online' ? '在线' : '离线'}</span>
          )}
        </div>
        <button
          type="button"
          title={props.collapsed ? '展开导航' : '收起导航'}
          onClick={() => props.onCollapsedChange(!props.collapsed)}
        >
          {props.collapsed ? (
            <ChevronRight aria-hidden="true" size={15} />
          ) : (
            <ChevronLeft aria-hidden="true" size={15} />
          )}
          {props.collapsed ? null : <span>收起</span>}
        </button>
      </footer>
    </div>
  );
}

const SECTION_LABELS: Record<TalkProductSection, string> = {
  tasks: '对话任务',
  projects: '项目',
  friends: '好友',
  groups: '群聊',
  automation: '自动化',
  providers: '模型源',
  skills: 'Skill & MCP',
  settings: '设置',
};

export function TalkTopBar(props: {
  section: TalkProductSection;
  runtimeState: string;
  workspaceName?: string | null;
  taskTitle?: string | null;
}) {
  const runtimeOnline = props.runtimeState === 'online';

  return (
    <header className="st-talk-topbar" data-testid="talk-topbar">
      <div className="st-talk-topbar__crumbs" aria-label="当前位置">
        <span>SYNC-THINK</span>
        <ChevronRight aria-hidden="true" size={11} />
        <strong>{SECTION_LABELS[props.section]}</strong>
      </div>
      <div
        className="st-talk-topbar__runtime"
        data-state={props.runtimeState}
        title={runtimeOnline ? 'Runtime 已连接' : 'Runtime 当前不可用'}
      >
        <i aria-hidden="true" />
        <span>{runtimeOnline ? 'Runtime 就绪' : 'Runtime 离线'}</span>
      </div>
    </header>
  );
}

export type TalkConversationKind = 'direct' | 'group';
export type TalkTaskDetailTab = 'progress' | 'files' | 'execution';

const TALK_IDENTITY_ICONS: Readonly<Record<string, LucideIcon>> = {
  agent: Bot,
  bot: Bot,
  brain: BrainCircuit,
  code: Terminal,
  executor: Terminal,
  group: Users,
  image: ImageIcon,
  plan: ListTodo,
  planner: ListTodo,
  review: ShieldCheck,
  reviewer: ShieldCheck,
  users: Users,
  workflow: Activity,
};

function TalkIdentityGlyph(props: {
  icon?: string;
  label?: string | null;
  size: number;
  strokeWidth: number;
}) {
  const normalized = props.icon?.trim().toLowerCase() ?? '';
  const Icon = TALK_IDENTITY_ICONS[normalized];
  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        data-agent-glyph={normalized}
        size={props.size}
        strokeWidth={props.strokeWidth}
      />
    );
  }
  const raw = props.icon?.trim() ?? '';
  const label = raw && !/^[a-z0-9_-]+$/i.test(raw) ? raw : props.label?.trim().slice(0, 1) || 'A';
  return (
    <span aria-hidden="true" data-agent-glyph={normalized || 'initial'}>
      {label}
    </span>
  );
}

export interface TalkConversationTaskItem {
  taskId: string;
  workspaceId?: string;
  parentTaskId?: string;
  title: string;
  summary?: string;
  participantLabel?: string;
  participantIcon?: string;
  participantColor?: string;
  participantAvatarUrl?: string;
  workspaceName?: string;
  updatedAt?: string;
  status: string;
  kind: TalkConversationKind;
}

export interface TalkConversationTaskWorkspaceProps extends AppShellProps {
  tasks?: readonly TalkConversationTaskItem[];
  activeTaskId?: string | null;
  activeTaskTitle?: string | null;
  activeWorkspaceName?: string | null;
  participantName?: string | null;
  participantIcon?: string;
  participantKind?: TalkConversationKind;
  participantColor?: string;
  participantAvatarUrl?: string;
  modelLabel?: string | null;
  taskStatusLabel?: string | null;
  detailTab?: TalkTaskDetailTab;
  showArchived?: boolean;
  archivedCount?: number;
  onShowArchivedChange?: (showArchived: boolean) => void;
  onCreateConversation?: () => void;
  onSelectTask?: (taskId: string) => void;
  onCreateChildTask?: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  onUnarchiveTask?: (taskId: string) => void;
  parentTaskTitle?: string | null;
  onOpenParentTask?: () => void;
  utilityLabel?: string;
  utilityCount?: number;
  utilityPanel?: ReactNode;
  onDetailTabChange?: (tab: TalkTaskDetailTab) => void;
  onIntervene?: () => void;
  onPause?: () => void;
  onTerminate?: () => void;
  canPause?: boolean;
  canTerminate?: boolean;
  actionBusy?: boolean;
  conversationLayout?: 'default' | 'single';
  onConversationLayoutChange?: (layout: 'default' | 'single') => void;
}

type TalkConversationFilter = 'all' | TalkConversationKind;

const TALK_DETAIL_TABS: ReadonlyArray<{ id: TalkTaskDetailTab; label: string }> = [
  { id: 'progress', label: '任务进度' },
  { id: 'files', label: '文件与产物' },
  { id: 'execution', label: '执行详情' },
];

function talkTaskStatusLabel(status: string): string {
  if (status === 'active' || status === 'running' || status === 'streaming') return '进行中';
  if (status === 'awaiting_approval' || status === 'waiting_approval') return '待审批';
  if (status === 'completed' || status === 'done') return '已完成';
  if (status === 'failed' || status === 'error') return '失败';
  if (status === 'paused') return '已暂停';
  if (status === 'archived') return '已归档';
  return status || '待开始';
}

function formatConversationActivityTime(value?: string): string {
  if (!value) return '';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  const now = new Date();
  if (timestamp.toDateString() === now.toDateString()) {
    return timestamp.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (timestamp.toDateString() === yesterday.toDateString()) return '昨天';
  const elapsedHours = Math.floor((now.getTime() - timestamp.getTime()) / 3_600_000);
  if (elapsedHours > 0 && elapsedHours < 24) return `${elapsedHours} 小时前`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays > 0 && elapsedDays < 7) return `${elapsedDays} 天前`;
  return formatProjectTime(value);
}

export function TalkConversationTaskWorkspace(props: TalkConversationTaskWorkspaceProps) {
  const [filter, setFilter] = useState<TalkConversationFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [collapsedParentTaskIds, setCollapsedParentTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [composerHeight, setComposerHeight] = useState(126);
  const composerResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const composerResizeCleanupRef = useRef<(() => void) | null>(null);
  const conversationRef = useRef<HTMLElement | null>(null);
  const [internalDetailCollapsed, setInternalDetailCollapsed] = useState(
    props.traceCollapsedDefault ?? false,
  );
  const detailCollapsed =
    props.traceCollapsed === undefined ? internalDetailCollapsed : props.traceCollapsed;
  const setDetailCollapsed = useCallback(
    (next: boolean) => {
      if (props.traceCollapsed === undefined) setInternalDetailCollapsed(next);
      props.onTraceCollapsedChange?.(next);
    },
    [props.onTraceCollapsedChange, props.traceCollapsed],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && utilityOpen) {
        event.preventDefault();
        setUtilityOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
        event.preventDefault();
        setDetailCollapsed(!detailCollapsed);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailCollapsed, setDetailCollapsed, utilityOpen]);

  useEffect(() => {
    if (!props.activeTaskId) return undefined;
    const scrollToLatest = () => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    };
    const frame = window.requestAnimationFrame(scrollToLatest);
    const first = window.setTimeout(scrollToLatest, 40);
    const settled = window.setTimeout(scrollToLatest, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(first);
      window.clearTimeout(settled);
    };
  }, [props.activeTaskId]);

  useEffect(() => {
    if (!props.activeTaskId) return;
    const activeTask = props.tasks?.find((task) => task.taskId === props.activeTaskId);
    if (!activeTask?.parentTaskId) return;
    setCollapsedParentTaskIds((current) => {
      if (!current.has(activeTask.parentTaskId!)) return current;
      const next = new Set(current);
      next.delete(activeTask.parentTaskId!);
      return next;
    });
  }, [props.activeTaskId, props.tasks]);

  const { visibleTasks, childCountByParent } = useMemo(() => {
    const tasks = (props.tasks ?? []).filter(
      (task) =>
        (props.showArchived || task.status !== 'archived') &&
        (filter === 'all' || task.kind === filter),
    );
    const byParent = new Map<string, TalkConversationTaskItem[]>();
    const byId = new Map(tasks.map((task) => [task.taskId, task] as const));
    for (const task of tasks) {
      if (!task.parentTaskId || !byId.has(task.parentTaskId)) continue;
      const children = byParent.get(task.parentTaskId) ?? [];
      children.push(task);
      byParent.set(task.parentTaskId, children);
    }
    const result: TalkConversationTaskItem[] = [];
    const append = (task: TalkConversationTaskItem) => {
      result.push(task);
      if (collapsedParentTaskIds.has(task.taskId)) return;
      for (const child of byParent.get(task.taskId) ?? []) append(child);
    };
    for (const root of tasks.filter((task) => !task.parentTaskId || !byId.has(task.parentTaskId))) {
      append(root);
    }
    return {
      visibleTasks: result,
      childCountByParent: new Map(
        [...byParent.entries()].map(([parentId, children]) => [parentId, children.length] as const),
      ),
    };
  }, [collapsedParentTaskIds, filter, props.showArchived, props.tasks]);

  const detailTab = props.detailTab ?? 'progress';
  const clampComposerHeight = useCallback((height: number) => {
    const maxHeight = Math.min(420, Math.max(180, window.innerHeight * 0.55));
    return Math.round(Math.max(114, Math.min(maxHeight, height)));
  }, []);
  const resizeComposerByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setComposerHeight((height) =>
      clampComposerHeight(height + (event.key === 'ArrowUp' ? 24 : -24)),
    );
  };
  const startComposerResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    composerResizeCleanupRef.current?.();
    composerResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: composerHeight,
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      composerResizeRef.current = null;
      composerResizeCleanupRef.current = null;
    };
    const move = (pointerEvent: PointerEvent) => {
      const drag = composerResizeRef.current;
      if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
      pointerEvent.preventDefault();
      setComposerHeight(clampComposerHeight(drag.startHeight + drag.startY - pointerEvent.clientY));
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    composerResizeCleanupRef.current = finish;
  };

  useEffect(
    () => () => {
      composerResizeCleanupRef.current?.();
    },
    [],
  );

  return (
    <div
      className="st-talk-conversation-workspace"
      data-testid="talk-conversation-task-workspace"
      data-detail-collapsed={detailCollapsed ? '1' : '0'}
    >
      <aside
        className="st-talk-conversation-directory"
        data-testid="talk-conversation-directory"
        aria-label="对话任务"
      >
        <header className="st-talk-conversation-directory__header">
          <strong>对话任务</strong>
          <div
            className="st-talk-conversation-directory__filters"
            role="tablist"
            aria-label="对话类型"
          >
            {(
              [
                ['all', '全部'],
                ['direct', '单聊'],
                ['group', '群聊'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                data-active={filter === id ? '1' : '0'}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="st-talk-conversation-directory__filter-menu">
            <button
              type="button"
              aria-label="筛选对话"
              title="筛选"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <SlidersHorizontal aria-hidden="true" size={12} strokeWidth={1.8} />
              <span>筛选</span>
            </button>
            {filterOpen ? (
              <div role="menu">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(props.showArchived)}
                    onChange={(event) => props.onShowArchivedChange?.(event.target.checked)}
                  />
                  <span>包含归档{props.archivedCount ? ` (${props.archivedCount})` : ''}</span>
                </label>
              </div>
            ) : null}
          </div>
        </header>

        <button
          type="button"
          className="st-talk-conversation-directory__create"
          onClick={props.onCreateConversation}
        >
          <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
          新建对话
        </button>

        <div className="st-talk-conversation-directory__list">
          {visibleTasks.map((task) => {
            const active = task.taskId === props.activeTaskId;
            const childCount = childCountByParent.get(task.taskId) ?? 0;
            const childrenExpanded = !collapsedParentTaskIds.has(task.taskId);
            return (
              <div
                key={task.taskId}
                className="st-talk-conversation-row-shell"
                data-parent={childCount > 0 ? '1' : '0'}
              >
                {childCount > 0 ? (
                  <button
                    type="button"
                    className="st-talk-conversation-row__disclosure"
                    data-testid={`task-children-toggle-${task.taskId}`}
                    aria-label={`${childrenExpanded ? '收起' : '展开'} ${task.title} 的 ${childCount} 个子任务`}
                    aria-expanded={childrenExpanded}
                    onClick={() =>
                      setCollapsedParentTaskIds((current) => {
                        const next = new Set(current);
                        if (next.has(task.taskId)) next.delete(task.taskId);
                        else next.add(task.taskId);
                        return next;
                      })
                    }
                  >
                    {childrenExpanded ? (
                      <ChevronDown aria-hidden="true" size={12} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={12} />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="st-talk-conversation-row"
                  data-task-id={task.taskId}
                  data-child={task.parentTaskId ? '1' : '0'}
                  data-active={active ? '1' : '0'}
                  data-status={task.status}
                  onClick={() => props.onSelectTask?.(task.taskId)}
                >
                  <span
                    className="st-talk-conversation-row__avatar"
                    data-kind={task.kind}
                    data-icon={task.participantIcon ?? (task.kind === 'group' ? 'users' : 'bot')}
                    data-testid="talk-task-agent-avatar"
                    style={{
                      ['--st-talk-task-agent-color' as string]:
                        task.participantColor ?? (task.kind === 'group' ? '#0d9488' : '#7c3aed'),
                    }}
                  >
                    {task.participantAvatarUrl ? (
                      <img src={task.participantAvatarUrl} alt="" />
                    ) : (
                      <TalkIdentityGlyph
                        icon={task.participantIcon ?? (task.kind === 'group' ? 'users' : 'bot')}
                        label={task.participantLabel}
                        size={14}
                        strokeWidth={1.8}
                      />
                    )}
                  </span>
                  <span className="st-talk-conversation-row__content">
                    <span className="st-talk-conversation-row__title">
                      <strong>{task.title}</strong>
                      <time dateTime={task.updatedAt}>
                        {formatConversationActivityTime(task.updatedAt)}
                      </time>
                    </span>
                    <small>{task.summary || '还没有消息'}</small>
                    <span className="st-talk-conversation-row__meta">
                      {task.parentTaskId ? (
                        <span className="st-talk-conversation-row__child-label">子任务</span>
                      ) : null}
                      {task.participantLabel ? <em>{task.participantLabel}</em> : null}
                      {task.workspaceName ? <span>· {task.workspaceName}</span> : null}
                      {childCount > 0 ? <span>{childCount} 个子任务</span> : null}
                      <b data-status={task.status}>{talkTaskStatusLabel(task.status)}</b>
                    </span>
                  </span>
                </button>
                <span className="st-talk-conversation-row__actions" data-task-actions={task.taskId}>
                  {task.status === 'archived' ? (
                    <button
                      type="button"
                      title="恢复任务"
                      aria-label={`恢复任务：${task.title}`}
                      onClick={() => props.onUnarchiveTask?.(task.taskId)}
                    >
                      <ArchiveRestore aria-hidden="true" size={12} />
                    </button>
                  ) : (
                    <>
                      {!task.parentTaskId ? (
                      <button
                        type="button"
                        title="新建子任务"
                        aria-label={`在 ${task.title} 下新建子任务`}
                        onClick={() => props.onCreateChildTask?.(task.taskId)}
                      >
                        <Plus aria-hidden="true" size={12} />
                      </button>
                      ) : null}
                      <button
                        type="button"
                        title="归档任务"
                        aria-label={`归档任务：${task.title}`}
                        onClick={() => props.onArchiveTask?.(task.taskId)}
                      >
                        <Archive aria-hidden="true" size={12} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
          {visibleTasks.length === 0 ? (
            <div className="st-talk-conversation-directory__empty">
              <MessageSquareText aria-hidden="true" size={20} strokeWidth={1.6} />
              <span>{props.tasks?.length ? '没有符合筛选条件的对话' : '还没有对话任务'}</span>
            </div>
          ) : null}
        </div>
      </aside>

      <main
        className="st-talk-task-main"
        style={{ '--st-talk-composer-height': `${composerHeight}px` } as CSSProperties}
      >
        <header className="st-talk-task-header">
          <span
            className="st-talk-task-header__avatar"
            data-kind={props.participantKind ?? 'direct'}
            data-icon={
              props.participantIcon ?? (props.participantKind === 'group' ? 'users' : 'bot')
            }
            style={{ ['--st-talk-agent-color' as string]: props.participantColor ?? '#8b5cf6' }}
          >
            {props.participantAvatarUrl ? (
              <img src={props.participantAvatarUrl} alt="" />
            ) : (
              <TalkIdentityGlyph
                icon={
                  props.participantIcon ?? (props.participantKind === 'group' ? 'users' : 'bot')
                }
                label={props.participantName}
                size={15}
                strokeWidth={1.9}
              />
            )}
          </span>
          <span className="st-talk-task-header__identity">
            <strong>{props.activeTaskTitle || '选择一个对话任务'}</strong>
            <small>
              {props.participantName ? <em>{props.participantName}</em> : null}
              {props.modelLabel ? <span>{props.modelLabel}</span> : null}
              {props.activeWorkspaceName ? <span>· {props.activeWorkspaceName}</span> : null}
            </small>
          </span>
          <div className="st-talk-task-header__actions">
            {props.parentTaskTitle && props.onOpenParentTask ? (
              <button
                type="button"
                className="st-talk-task-header__parent"
                data-testid="task-parent-breadcrumb"
                title={`返回父任务：${props.parentTaskTitle}`}
                onClick={props.onOpenParentTask}
              >
                <ChevronLeft aria-hidden="true" size={12} />
                返回父任务
              </button>
            ) : null}
            {props.utilityPanel ? (
              <button
                type="button"
                className="st-talk-task-header__utility"
                title={props.utilityLabel ?? '任务工具'}
                aria-label={`${props.utilityLabel ?? '任务工具'}${props.utilityCount ? `，${props.utilityCount} 项待处理` : ''}`}
                onClick={() => setUtilityOpen(true)}
              >
                <ShieldCheck aria-hidden="true" size={12} strokeWidth={1.8} />
                {props.utilityLabel ?? '工具'}
                {props.utilityCount ? <span>{props.utilityCount}</span> : null}
              </button>
            ) : null}
            {props.onConversationLayoutChange ? (
              <button
                type="button"
                className="st-talk-task-header__layout"
                aria-label={
                  props.conversationLayout === 'single' ? '切换为分栏对话' : '切换为单列阅读'
                }
                title={props.conversationLayout === 'single' ? '分栏对话' : '单列阅读'}
                onClick={() =>
                  props.onConversationLayoutChange?.(
                    props.conversationLayout === 'single' ? 'default' : 'single',
                  )
                }
              >
                {props.conversationLayout === 'single' ? (
                  <Columns2 aria-hidden="true" size={13} strokeWidth={1.8} />
                ) : (
                  <AlignLeft aria-hidden="true" size={13} strokeWidth={1.8} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className="st-talk-task-header__detail-toggle"
              aria-label={detailCollapsed ? '展开任务详情' : '折叠任务详情'}
              title={detailCollapsed ? '展开任务详情' : '折叠任务详情'}
              onClick={() => setDetailCollapsed(!detailCollapsed)}
            >
              {detailCollapsed ? (
                <PanelRightOpen aria-hidden="true" size={14} />
              ) : (
                <PanelRightClose aria-hidden="true" size={14} />
              )}
            </button>
          </div>
        </header>

        <section
          ref={conversationRef}
          id="st-main-conversation"
          className="st-talk-task-conversation"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          tabIndex={-1}
        >
          <div className="st-talk-task-notices">{props.contextRail}</div>
          {props.conversation}
        </section>
        <footer className="st-talk-task-composer">
          <div
            className="st-talk-task-composer__resize"
            data-testid="talk-composer-resize-handle"
            role="separator"
            aria-label="调整输入框高度"
            aria-orientation="horizontal"
            aria-valuemin={114}
            aria-valuemax={420}
            aria-valuenow={composerHeight}
            tabIndex={0}
            onKeyDown={resizeComposerByKeyboard}
            onPointerDown={startComposerResize}
          />
          {props.compose}
        </footer>
      </main>

      <aside className="st-talk-task-detail" aria-label="任务详情">
        <header className="st-talk-task-detail__header">
          <strong>任务详情</strong>
          {props.taskStatusLabel ? <span>{props.taskStatusLabel}</span> : null}
          <button
            type="button"
            aria-label={detailCollapsed ? '展开任务详情' : '折叠任务详情'}
            title={detailCollapsed ? '展开任务详情' : '折叠任务详情'}
            onClick={() => setDetailCollapsed(!detailCollapsed)}
          >
            {detailCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>
        </header>
        <nav className="st-talk-task-detail__tabs" role="tablist" aria-label="任务详情视图">
          {TALK_DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={detailTab === tab.id}
              data-active={detailTab === tab.id ? '1' : '0'}
              data-testid={`talk-detail-tab-${tab.id}`}
              onClick={() => props.onDetailTabChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="st-talk-task-detail__body">{props.trace}</div>
      </aside>
      {utilityOpen && props.utilityPanel ? (
        <div
          className="st-talk-task-utility-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setUtilityOpen(false);
          }}
        >
          <section
            className="st-talk-task-utility-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={props.utilityLabel ?? '任务工具'}
          >
            <header>
              <strong>{props.utilityLabel ?? '任务工具'}</strong>
              <button type="button" aria-label="关闭" onClick={() => setUtilityOpen(false)}>
                <X aria-hidden="true" size={15} />
              </button>
            </header>
            <div>{props.utilityPanel}</div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type ProjectTab = 'conversations' | 'settings';

export function TalkProjectsWorkspace(props: {
  workspaces: readonly WorkspaceSummary[];
  tasksByWorkspace: ReadonlyMap<string, readonly TaskSummary[]>;
  activeWorkspaceId?: string | null;
  activeTaskId?: string | null;
  bindingWorkspaceId?: string | null;
  error?: string | null;
  onCreateProject: () => void;
  onCreateProjectFromFolder?: () => void | Promise<void>;
  onBindFolder: (workspaceId: string) => void | Promise<void>;
  onBindGitRepository?: (
    workspaceId: string,
    repositoryUrl: string,
    defaultRef?: string,
  ) => void | Promise<void>;
  onCreateTask: (workspaceId: string) => void | Promise<void>;
  onOpenTask: (task: TaskSummary) => void | Promise<void>;
  onClearTask?: () => void;
  onSelectProject?: (workspaceId: string) => void;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    props.activeWorkspaceId ?? props.workspaces[0]?.workspaceId ?? null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(props.activeTaskId ?? null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () =>
      new Set(
        (props.activeWorkspaceId ?? props.workspaces[0]?.workspaceId)
          ? [String(props.activeWorkspaceId ?? props.workspaces[0]?.workspaceId)]
          : [],
      ),
  );
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ProjectTab>('conversations');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [gitDialogOpen, setGitDialogOpen] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [defaultRef, setDefaultRef] = useState('main');
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) setCreateMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCreateMenuOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [createMenuOpen]);

  useEffect(() => {
    if (
      selectedProjectId &&
      props.workspaces.some((item) => item.workspaceId === selectedProjectId)
    ) {
      return;
    }
    setSelectedProjectId(props.activeWorkspaceId ?? props.workspaces[0]?.workspaceId ?? null);
  }, [props.activeWorkspaceId, props.workspaces, selectedProjectId]);

  useEffect(() => {
    if (props.activeTaskId) setSelectedTaskId(props.activeTaskId);
  }, [props.activeTaskId]);

  const filteredWorkspaces = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return props.workspaces;
    return props.workspaces.filter((workspace) =>
      `${workspace.name} ${workspace.folderPath ?? ''}`.toLocaleLowerCase().includes(normalized),
    );
  }, [props.workspaces, query]);

  const selectedProject = props.workspaces.find(
    (workspace) => workspace.workspaceId === selectedProjectId,
  );
  const projectTasks = selectedProject
    ? (props.tasksByWorkspace.get(String(selectedProject.workspaceId)) ?? []).filter(
        (task) => task.status !== 'archived',
      )
    : [];
  const selectedTask =
    projectTasks.find((task) => String(task.taskId) === selectedTaskId) ?? projectTasks[0];

  const openGitDialog = () => {
    setRepositoryUrl(selectedProject?.repositoryUrl ?? '');
    setDefaultRef(selectedProject?.defaultRef ?? 'main');
    setGitDialogOpen(true);
  };

  useEffect(() => {
    if (selectedTask && selectedTaskId !== String(selectedTask.taskId)) {
      setSelectedTaskId(String(selectedTask.taskId));
    }
  }, [selectedTask, selectedTaskId]);

  const chooseProject = (workspaceId: string) => {
    if (workspaceId === selectedProjectId) {
      props.onSelectProject?.(workspaceId);
      const firstTask = props.tasksByWorkspace
        .get(workspaceId)
        ?.find((task) => task.status !== 'archived');
      if (firstTask) void props.onOpenTask(firstTask);
      else props.onClearTask?.();
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        if (next.has(workspaceId)) next.delete(workspaceId);
        else next.add(workspaceId);
        return next;
      });
      setTab('conversations');
      return;
    }
    setSelectedProjectId(workspaceId);
    setExpandedProjectIds((current) => new Set(current).add(workspaceId));
    props.onSelectProject?.(workspaceId);
    const firstTask = props.tasksByWorkspace
      .get(workspaceId)
      ?.find((task) => task.status !== 'archived');
    setSelectedTaskId(firstTask ? String(firstTask.taskId) : null);
    if (firstTask) void props.onOpenTask(firstTask);
    else props.onClearTask?.();
    setTab('conversations');
  };

  return (
    <div className="st-talk-projects" data-testid="talk-projects-workspace" data-view={tab}>
      <aside className="st-talk-projects__directory" aria-label="项目列表">
        <header>
          <div>
            <strong>项目</strong>
            <small>{props.workspaces.length} 个项目</small>
          </div>
          <div className="st-talk-projects__directory-actions">
            <button
              type="button"
              className="st-talk-icon-button"
              aria-label="项目设置"
              title="项目设置"
              disabled={!selectedProject}
              onClick={() => setTab('settings')}
            >
              <Settings aria-hidden="true" size={14} />
            </button>
            <div className="st-talk-project-create-menu" ref={createMenuRef}>
              <button
                type="button"
                className="st-talk-icon-button st-talk-icon-button--primary"
                aria-label="新建项目"
                title="新建项目"
                aria-haspopup="menu"
                aria-expanded={createMenuOpen}
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                <Plus aria-hidden="true" size={14} />
              </button>
              {createMenuOpen ? (
                <div className="st-talk-project-create-menu__popup" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      props.onCreateProject();
                    }}
                  >
                    <Plus aria-hidden="true" size={14} />
                    <span>
                      <strong>新建空白项目</strong>
                      <small>稍后再绑定工作区</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      void props.onCreateProjectFromFolder?.();
                    }}
                  >
                    <FolderOpen aria-hidden="true" size={14} />
                    <span>
                      <strong>使用现有文件夹</strong>
                      <small>创建并立即绑定工作区</small>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <label className="st-talk-search">
          <Search aria-hidden="true" size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目"
          />
        </label>
        <div className="st-talk-projects__list">
          {filteredWorkspaces.map((workspace) => {
            const tasks = props.tasksByWorkspace.get(String(workspace.workspaceId)) ?? [];
            const visibleTasks = tasks.filter((task) => task.status !== 'archived');
            const activeCount = visibleTasks.filter((task) => task.status === 'active').length;
            const selected = workspace.workspaceId === selectedProjectId;
            const expanded = expandedProjectIds.has(String(workspace.workspaceId));
            return (
              <div
                key={String(workspace.workspaceId)}
                className="st-talk-project-shell"
                data-active={selected ? '1' : '0'}
              >
                <button
                  type="button"
                  className="st-talk-project-row"
                  data-active={selected ? '1' : '0'}
                  aria-expanded={expanded}
                  onClick={() => chooseProject(String(workspace.workspaceId))}
                >
                  <FolderOpen aria-hidden="true" size={14} />
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.folderPath ? workspace.folderPath : '未绑定工作区'}</small>
                    <em>
                      {visibleTasks.length} 个对话
                      {activeCount > 0 ? ` · ${activeCount} 进行中` : ''}
                    </em>
                  </span>
                  {expanded ? (
                    <ChevronDown aria-hidden="true" size={13} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={13} />
                  )}
                </button>
                <div
                  className="st-talk-project-task-tree"
                  data-testid={
                    expanded ? `talk-project-task-tree-${workspace.workspaceId}` : undefined
                  }
                  hidden={!expanded}
                >
                  <div className="st-talk-project-task-tree__head">
                    <span>对话任务</span>
                    <button
                      type="button"
                      className="st-talk-project-task-create"
                      aria-label={`在 ${workspace.name} 中新建对话任务`}
                      title="新建对话任务"
                      onClick={() => props.onCreateTask(String(workspace.workspaceId))}
                    >
                      <Plus aria-hidden="true" size={13} />
                    </button>
                  </div>
                  {visibleTasks.map((task) => {
                    const active = String(task.taskId) === String(selectedTask?.taskId ?? '');
                    return (
                      <button
                        key={String(task.taskId)}
                        type="button"
                        className="st-talk-task-row st-talk-project-task-row"
                        data-testid={`talk-project-task-row-${task.taskId}`}
                        data-active={active ? '1' : '0'}
                        onClick={() => {
                          setSelectedTaskId(String(task.taskId));
                          void props.onOpenTask(task);
                        }}
                      >
                        <i data-status={task.status} aria-hidden="true" />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.goal}</small>
                          <em>{formatProjectTime(task.updatedAt)}</em>
                        </span>
                      </button>
                    );
                  })}
                  {visibleTasks.length === 0 ? (
                    <div className="st-talk-project-task-empty">
                      <MessageSquareText aria-hidden="true" size={16} />
                      <span>这个项目还没有对话</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filteredWorkspaces.length === 0 ? (
            <div className="st-talk-projects__empty-list">
              <FolderOpen aria-hidden="true" size={18} />
              <span>{props.workspaces.length === 0 ? '还没有项目' : '没有匹配的项目'}</span>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="st-talk-projects__main">
        {selectedProject ? (
          <>
            <header className="st-talk-projects__header">
              <div>
                <strong>{selectedProject.name}</strong>
                <small title={selectedProject.folderPath}>
                  <FolderOpen aria-hidden="true" size={10} />
                  {selectedProject.folderPath ?? '未绑定工作区'}
                </small>
                <span className="st-talk-projects__runtime-summary">
                  <GitBranch aria-hidden="true" size={11} />
                  {selectedProject.resourceType === 'git_repository' ? 'Git 仓库' : '本地目录'}
                  {' · '}
                  {selectedProject.executionMode === 'local' ? '原地执行' : '自动隔离工作树'}
                </span>
              </div>
              <div className="st-talk-projects__actions">
                <button
                  type="button"
                  className="st-talk-button"
                  disabled={props.bindingWorkspaceId === selectedProject.workspaceId}
                  onClick={() => props.onBindFolder(String(selectedProject.workspaceId))}
                >
                  <FolderInput aria-hidden="true" size={13} />
                  {selectedProject.folderPath ? '更换工作区' : '绑定工作区'}
                </button>
                <button
                  type="button"
                  className="st-talk-button st-talk-button--primary"
                  onClick={() => props.onCreateTask(String(selectedProject.workspaceId))}
                >
                  <Plus aria-hidden="true" size={13} />
                  新建任务
                </button>
              </div>
            </header>
            <nav className="st-talk-projects__tabs" aria-label="项目页面">
              <button
                type="button"
                data-active={tab === 'conversations' ? '1' : '0'}
                onClick={() => setTab('conversations')}
              >
                对话
                <span>{projectTasks.length}</span>
              </button>
              <button
                type="button"
                data-active={tab === 'settings' ? '1' : '0'}
                onClick={() => setTab('settings')}
              >
                项目设置
              </button>
            </nav>
            {props.error ? (
              <p className="st-talk-projects__error" role="alert">
                {props.error}
              </p>
            ) : null}
            {tab === 'conversations' ? (
              <div className="st-talk-projects__conversations">
                <div className="st-talk-projects__tasks" aria-label="项目对话">
                  {projectTasks.map((task) => {
                    const selected = String(task.taskId) === String(selectedTask?.taskId ?? '');
                    return (
                      <button
                        key={String(task.taskId)}
                        type="button"
                        className="st-talk-task-row"
                        data-active={selected ? '1' : '0'}
                        onClick={() => {
                          setSelectedTaskId(String(task.taskId));
                          void props.onOpenTask(task);
                        }}
                      >
                        <i data-status={task.status} aria-hidden="true" />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.goal}</small>
                          <em>{formatProjectTime(task.updatedAt)}</em>
                        </span>
                        <ChevronRight aria-hidden="true" size={13} />
                      </button>
                    );
                  })}
                  {projectTasks.length === 0 ? (
                    <div className="st-talk-projects__no-task">
                      <MessageSquareText aria-hidden="true" size={22} />
                      <strong>这个项目还没有对话</strong>
                      <button
                        type="button"
                        className="st-talk-button st-talk-button--primary"
                        onClick={() => props.onCreateTask(String(selectedProject.workspaceId))}
                      >
                        <Plus aria-hidden="true" size={13} />
                        创建第一个任务
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="st-talk-projects__task-detail">
                  {selectedTask ? (
                    <>
                      <div className="st-talk-projects__task-head">
                        <div>
                          <span className="st-talk-status" data-status={selectedTask.status}>
                            <i aria-hidden="true" />
                            {projectTaskStatusLabel(selectedTask.status)}
                          </span>
                          <h2>{selectedTask.title}</h2>
                        </div>
                        <button
                          type="button"
                          className="st-talk-button st-talk-button--primary"
                          onClick={() => props.onOpenTask(selectedTask)}
                        >
                          继续对话
                          <ArrowUpRight aria-hidden="true" size={13} />
                        </button>
                      </div>
                      <dl className="st-talk-projects__meta">
                        <div>
                          <dt>任务目标</dt>
                          <dd>{selectedTask.goal || '尚未填写任务目标'}</dd>
                        </div>
                        <div>
                          <dt>工作方式</dt>
                          <dd>
                            {selectedTask.participationMode === 'collaboration'
                              ? '多智能体协作'
                              : '单智能体对话'}
                          </dd>
                        </div>
                        <div>
                          <dt>最近更新</dt>
                          <dd>{formatProjectTime(selectedTask.updatedAt, true)}</dd>
                        </div>
                        <div>
                          <dt>执行位置</dt>
                          <dd>
                            {selectedTask.execution?.mode === 'managed_worktree'
                              ? '隔离工作树'
                              : selectedTask.execution?.mode === 'local_serial'
                                ? '本地目录（串行）'
                                : '仅对话'}
                          </dd>
                        </div>
                        {selectedTask.execution?.baseRef ? (
                          <div>
                            <dt>基准分支</dt>
                            <dd>{selectedTask.execution.baseRef}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <div className="st-talk-projects__task-note">
                        <MessageSquareText aria-hidden="true" size={15} />
                        <span>打开后会继续使用这个任务自身的完整对话上下文。</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="st-talk-projects__settings">
                <h2>项目设置</h2>
                <dl>
                  <div>
                    <dt>项目名称</dt>
                    <dd>{selectedProject.name}</dd>
                  </div>
                  <div>
                    <dt>绑定工作区</dt>
                    <dd>{selectedProject.folderPath ?? '未绑定'}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatProjectTime(selectedProject.createdAt, true)}</dd>
                  </div>
                  <div>
                    <dt>代码来源</dt>
                    <dd>
                      {selectedProject.resourceType === 'git_repository' ? 'Git 仓库' : '本地目录'}
                    </dd>
                  </div>
                  {selectedProject.repositoryUrl ? (
                    <>
                      <div>
                        <dt>仓库地址</dt>
                        <dd className="st-talk-projects__repository-url" title={selectedProject.repositoryUrl}>
                          {selectedProject.repositoryUrl}
                        </dd>
                      </div>
                      <div>
                        <dt>默认分支</dt>
                        <dd>{selectedProject.defaultRef ?? 'HEAD'}</dd>
                      </div>
                    </>
                  ) : null}
                  <div>
                    <dt>运行配置</dt>
                    <dd>{selectedProject.executionProfileName ?? '默认运行配置'}</dd>
                  </div>
                  <div>
                    <dt>默认执行方式</dt>
                    <dd>
                      {selectedProject.executionMode === 'local' ? '原地执行' : '自动创建隔离工作树'}
                    </dd>
                  </div>
                  <div>
                    <dt>浏览器身份</dt>
                    <dd className="st-talk-projects__browser-identity">
                      <Globe2 aria-hidden="true" size={12} />
                      {selectedProject.browserIdentityName ?? '默认浏览器身份'}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="st-talk-button"
                  disabled={props.bindingWorkspaceId === selectedProject.workspaceId}
                  onClick={() => props.onBindFolder(String(selectedProject.workspaceId))}
                >
                  <FolderInput aria-hidden="true" size={13} />
                  {selectedProject.folderPath ? '更换工作区' : '绑定工作区'}
                </button>
                {props.onBindGitRepository ? (
                  <button
                    type="button"
                    className="st-talk-button"
                    onClick={openGitDialog}
                  >
                    <GitBranch aria-hidden="true" size={13} />
                    {selectedProject.repositoryUrl ? '编辑 Git 仓库' : '绑定 Git 仓库'}
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="st-talk-projects__empty">
            <FolderOpen aria-hidden="true" size={28} />
            <strong>创建项目后开始工作</strong>
            <p>项目可以选择绑定本地工作区，也可以只保存对话任务。</p>
            <button
              type="button"
              className="st-talk-button st-talk-button--primary"
              onClick={props.onCreateProject}
            >
              <Plus aria-hidden="true" size={13} />
              新建项目
            </button>
          </div>
        )}
      </section>
      {gitDialogOpen && selectedProject && props.onBindGitRepository ? (
        <div
          className="st-talk-task-utility-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGitDialogOpen(false);
          }}
        >
          <section
            className="st-talk-task-utility-dialog st-talk-project-git-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="绑定 Git 仓库"
          >
            <header>
              <strong>绑定 Git 仓库</strong>
              <button type="button" aria-label="关闭" onClick={() => setGitDialogOpen(false)}>
                <X aria-hidden="true" size={15} />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const url = repositoryUrl.trim();
                if (!url) return;
                void Promise.resolve(
                  props.onBindGitRepository?.(
                    String(selectedProject.workspaceId),
                    url,
                    defaultRef.trim() || undefined,
                  ),
                ).then(() => {
                  setRepositoryUrl('');
                  setGitDialogOpen(false);
                });
              }}
            >
              <label>
                <span>仓库地址</span>
                <input
                  value={repositoryUrl}
                  placeholder="https://github.com/owner/repository.git"
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  autoFocus
                />
              </label>
              <label>
                <span>默认分支</span>
                <input value={defaultRef} onChange={(event) => setDefaultRef(event.target.value)} />
              </label>
              <footer>
                <button type="button" className="st-talk-button" onClick={() => setGitDialogOpen(false)}>
                  取消
                </button>
                <button type="submit" className="st-talk-button st-talk-button--primary" disabled={!repositoryUrl.trim()}>
                  <Link2 aria-hidden="true" size={13} />
                  绑定仓库
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function projectTaskStatusLabel(status: string): string {
  if (status === 'active' || status === 'running') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'paused') return '已暂停';
  if (status === 'blocked') return '已阻断';
  if (status === 'failed') return '失败';
  return '待开始';
}

function formatProjectTime(value: string, detailed = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(detailed ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}),
  }).format(parsed);
}

function approvalModeLabel(mode: ApprovalMode): string {
  if (mode === 'request') return '请求批准';
  if (mode === 'delegate') return '替我审批';
  if (mode === 'full') return '完全访问';
  return '自定义';
}

export interface TalkGroupAgentOption {
  agentVersionId: string;
  name: string;
  role: string;
  color?: string;
}

export function TalkGroupsWorkspace(props: {
  groups: readonly GroupDefinition[];
  agents: readonly TalkGroupAgentOption[];
  workspaces: readonly WorkspaceSummary[];
  defaultWorkspaceId?: string | null;
  loading: boolean;
  busy: boolean;
  error?: string | null;
  onCreate: (payload: CreateGroupPayload) => Promise<void>;
  onUpdate: (payload: UpdateGroupPayload) => Promise<void>;
  onAddMember: (payload: AddGroupMemberPayload) => Promise<void>;
  onRemoveMember: (payload: RemoveGroupMemberPayload) => Promise<void>;
  onUpdateResponsibility: (payload: UpdateGroupMemberResponsibilityPayload) => Promise<void>;
  onSetLead: (payload: SetGroupLeadPayload) => Promise<void>;
  onCreateTask: (payload: CreateGroupTaskPayload) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const selected = props.groups.find((group) => group.id === selectedId) ?? props.groups[0];
  const filtered = props.groups.filter((group) =>
    `${group.name} ${group.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!selectedId && props.groups[0]) setSelectedId(props.groups[0].id);
    if (selectedId && !props.groups.some((group) => group.id === selectedId)) {
      setSelectedId(props.groups[0]?.id ?? null);
    }
  }, [props.groups, selectedId]);

  return (
    <div
      className="st-talk-directory st-talk-resource-page st-talk-groups"
      data-testid="talk-groups-workspace"
    >
      <aside className="st-talk-directory__list">
        <header>
          <div>
            <strong>群聊</strong>
            <small>{props.groups.length} 个协作组</small>
          </div>
          <button type="button" title="新建群聊" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        </header>
        <label className="st-talk-search">
          <Search size={12} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索群聊"
          />
        </label>
        <div className="st-talk-directory__rows">
          {props.loading ? <p className="st-talk-empty">读取群聊…</p> : null}
          {!props.loading && filtered.length === 0 ? (
            <p className="st-talk-empty">暂无群聊</p>
          ) : null}
          {filtered.map((group) => (
            <button
              type="button"
              key={group.id}
              className="st-talk-group-row"
              data-active={selected?.id === group.id && !creating ? '1' : '0'}
              onClick={() => {
                setSelectedId(group.id);
                setCreating(false);
                setEditing(false);
              }}
            >
              <span
                className="st-talk-avatar"
                style={{ '--avatar-color': group.visualIdentity.color } as React.CSSProperties}
              >
                <Users size={13} />
              </span>
              <span>
                <strong>{group.name}</strong>
                <small>
                  {group.members.length} 名智能体 ·{' '}
                  {group.collaborationMode === 'parallel' ? '并行' : '串行'}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main className="st-talk-directory__detail">
        {creating ? (
          <CreateGroupForm
            agents={props.agents}
            busy={props.busy}
            onCancel={() => setCreating(false)}
            onCreate={async (payload) => {
              await props.onCreate(payload);
              setCreating(false);
            }}
          />
        ) : selected ? (
          <GroupDetail
            group={selected}
            agents={props.agents}
            workspaces={props.workspaces}
            defaultWorkspaceId={props.defaultWorkspaceId}
            editing={editing}
            busy={props.busy}
            onEditingChange={setEditing}
            onUpdate={props.onUpdate}
            onAddMember={props.onAddMember}
            onRemoveMember={props.onRemoveMember}
            onUpdateResponsibility={props.onUpdateResponsibility}
            onSetLead={props.onSetLead}
            onCreateTask={props.onCreateTask}
          />
        ) : (
          <div className="st-talk-empty st-talk-empty--center">
            <Users size={24} />
            <strong>选择或新建群聊</strong>
          </div>
        )}
        {props.error ? (
          <p className="st-talk-error" role="alert">
            {props.error}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function CreateGroupForm(props: {
  agents: readonly TalkGroupAgentOption[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (payload: CreateGroupPayload) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leadId, setLeadId] = useState(props.agents[0]?.agentVersionId ?? '');
  const [kind, setKind] = useState<GroupKind>('fixed');
  const [collaborationMode, setCollaborationMode] = useState<GroupCollaborationMode>('parallel');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('full');
  const [maxConcurrency, setMaxConcurrency] = useState(3);
  const [memberIds, setMemberIds] = useState<string[]>(
    props.agents.slice(0, Math.min(3, props.agents.length)).map((agent) => agent.agentVersionId),
  );
  useEffect(() => {
    if (leadId || !props.agents[0]) return;
    setLeadId(props.agents[0].agentVersionId);
    setMemberIds((current) =>
      current.length > 0
        ? current
        : props.agents
            .slice(0, Math.min(3, props.agents.length))
            .map((agent) => agent.agentVersionId),
    );
  }, [leadId, props.agents]);
  useEffect(() => {
    if (leadId && !memberIds.includes(leadId)) setMemberIds((current) => [leadId, ...current]);
  }, [leadId, memberIds]);
  return (
    <section className="st-talk-editor">
      <header>
        <div>
          <strong>新建群聊</strong>
          <small>设置主智能体与成员职责</small>
        </div>
      </header>
      <div className="st-talk-form-grid">
        <label>
          <span>名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="st-talk-form-wide">
          <span>描述</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          <span>主智能体</span>
          <select value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            {props.agents.map((agent) => (
              <option key={agent.agentVersionId} value={agent.agentVersionId}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>群聊类型</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as GroupKind)}>
            <option value="fixed">固定群聊</option>
            <option value="temporary">临时群聊</option>
          </select>
        </label>
        <label>
          <span>协作模式</span>
          <select
            value={collaborationMode}
            onChange={(event) => setCollaborationMode(event.target.value as GroupCollaborationMode)}
          >
            <option value="parallel">并行</option>
            <option value="sequential">串行</option>
          </select>
        </label>
        <label>
          <span>操作权限</span>
          <select
            value={approvalMode}
            onChange={(event) => setApprovalMode(event.target.value as ApprovalMode)}
          >
            <option value="request">请求批准</option>
            <option value="delegate">替我审批</option>
            <option value="full">完全访问</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <label>
          <span>最大并发</span>
          <input
            type="number"
            min={1}
            max={32}
            value={maxConcurrency}
            onChange={(event) =>
              setMaxConcurrency(Math.max(1, Math.min(32, Number(event.target.value) || 1)))
            }
          />
        </label>
      </div>
      <div className="st-talk-member-picker">
        <strong>成员</strong>
        {props.agents.map((agent) => {
          const checked = memberIds.includes(agent.agentVersionId);
          return (
            <label key={agent.agentVersionId}>
              <input
                type="checkbox"
                checked={checked}
                disabled={agent.agentVersionId === leadId}
                onChange={() =>
                  setMemberIds((current) =>
                    checked
                      ? current.filter((id) => id !== agent.agentVersionId)
                      : [...current, agent.agentVersionId],
                  )
                }
              />
              <span
                className="st-talk-avatar"
                style={{ '--avatar-color': agent.color ?? '#0d9488' } as React.CSSProperties}
              >
                <Bot size={12} />
              </span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
            </label>
          );
        })}
      </div>
      <footer>
        <button
          type="button"
          className="st-talk-button st-talk-button--ghost"
          onClick={props.onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="st-talk-button"
          disabled={props.busy || !name.trim() || !leadId}
          onClick={() =>
            void props.onCreate({
              name: name.trim(),
              description: description.trim(),
              kind,
              leadAgentVersionId: leadId as CreateGroupPayload['leadAgentVersionId'],
              approvalMode,
              collaborationMode,
              maxConcurrency,
              members: memberIds.map((id) => {
                const agent = props.agents.find((item) => item.agentVersionId === id);
                return {
                  agentVersionId: id as CreateGroupPayload['leadAgentVersionId'],
                  responsibility:
                    id === leadId ? '统筹、委派与最终总结' : agent?.role || '协作执行',
                };
              }),
            })
          }
        >
          创建群聊
        </button>
      </footer>
    </section>
  );
}

function GroupDetail(props: {
  group: GroupDefinition;
  agents: readonly TalkGroupAgentOption[];
  workspaces: readonly WorkspaceSummary[];
  defaultWorkspaceId?: string | null;
  editing: boolean;
  busy: boolean;
  onEditingChange: (editing: boolean) => void;
  onUpdate: (payload: UpdateGroupPayload) => Promise<void>;
  onAddMember: (payload: AddGroupMemberPayload) => Promise<void>;
  onRemoveMember: (payload: RemoveGroupMemberPayload) => Promise<void>;
  onUpdateResponsibility: (payload: UpdateGroupMemberResponsibilityPayload) => Promise<void>;
  onSetLead: (payload: SetGroupLeadPayload) => Promise<void>;
  onCreateTask: (payload: CreateGroupTaskPayload) => Promise<void>;
}) {
  const [name, setName] = useState(props.group.name);
  const [description, setDescription] = useState(props.group.description);
  const [kind, setKind] = useState<GroupKind>(props.group.kind);
  const [collaborationMode, setCollaborationMode] = useState<GroupCollaborationMode>(
    props.group.collaborationMode,
  );
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(props.group.approvalMode);
  const [maxConcurrency, setMaxConcurrency] = useState(props.group.maxConcurrency);
  const [responsibilities, setResponsibilities] = useState<Record<string, string>>({});
  const [addId, setAddId] = useState('');
  const defaultWorkspaceId =
    props.workspaces.find((workspace) => workspace.workspaceId === props.defaultWorkspaceId)
      ?.workspaceId ??
    props.workspaces[0]?.workspaceId ??
    '';
  useEffect(() => {
    setName(props.group.name);
    setDescription(props.group.description);
    setKind(props.group.kind);
    setCollaborationMode(props.group.collaborationMode);
    setApprovalMode(props.group.approvalMode);
    setMaxConcurrency(props.group.maxConcurrency);
    setResponsibilities(
      Object.fromEntries(
        props.group.members.map((member) => [member.agentVersionId, member.responsibility]),
      ),
    );
  }, [props.group]);
  const availableAgents = props.agents.filter(
    (agent) =>
      !props.group.members.some((member) => member.agentVersionId === agent.agentVersionId),
  );
  return (
    <section className="st-talk-group-detail">
      <header className="st-talk-detail-head">
        <span
          className="st-talk-avatar st-talk-avatar--large"
          style={{ '--avatar-color': props.group.visualIdentity.color } as React.CSSProperties}
        >
          <Users size={18} />
        </span>
        <div>
          <strong>{props.group.name}</strong>
          <small>
            {props.group.kind === 'fixed' ? '固定群聊' : '临时群聊'} · {props.group.members.length}{' '}
            名智能体
          </small>
        </div>
        <button
          type="button"
          className="st-talk-button st-talk-button--ghost"
          onClick={() => props.onEditingChange(!props.editing)}
        >
          {props.editing ? '取消编辑' : '编辑资料'}
        </button>
        <button
          type="button"
          className="st-talk-button"
          disabled={!defaultWorkspaceId || props.busy}
          onClick={() =>
            void props.onCreateTask({
              groupId: props.group.id,
              workspaceId: defaultWorkspaceId as CreateGroupTaskPayload['workspaceId'],
              title: `${props.group.name} 协作任务`,
              goal: props.group.description.trim() || `与 ${props.group.name} 开始协作`,
              acceptanceCriteria: [],
            })
          }
        >
          <Play size={12} /> 新建协作任务
        </button>
      </header>
      {props.editing ? (
        <div className="st-talk-profile-edit">
          <label>
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="st-talk-form-wide">
            <span>描述</span>
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            <span>群聊类型</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as GroupKind)}>
              <option value="fixed">固定群聊</option>
              <option value="temporary">临时群聊</option>
            </select>
          </label>
          <label>
            <span>协作模式</span>
            <select
              value={collaborationMode}
              onChange={(event) =>
                setCollaborationMode(event.target.value as GroupCollaborationMode)
              }
            >
              <option value="parallel">并行</option>
              <option value="sequential">串行</option>
            </select>
          </label>
          <label>
            <span>操作权限</span>
            <select
              value={approvalMode}
              onChange={(event) => setApprovalMode(event.target.value as ApprovalMode)}
            >
              <option value="request">请求批准</option>
              <option value="delegate">替我审批</option>
              <option value="full">完全访问</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            <span>最大并发</span>
            <input
              type="number"
              min={1}
              max={32}
              value={maxConcurrency}
              onChange={(event) =>
                setMaxConcurrency(Math.max(1, Math.min(32, Number(event.target.value) || 1)))
              }
            />
          </label>
          <button
            type="button"
            className="st-talk-button"
            disabled={props.busy || !name.trim()}
            onClick={() =>
              void props.onUpdate({
                groupId: props.group.id,
                expectedVersion: props.group.version,
                name: name.trim(),
                description: description.trim(),
                kind,
                collaborationMode,
                approvalMode,
                maxConcurrency,
              })
            }
          >
            <Save size={12} /> 保存
          </button>
        </div>
      ) : (
        <p className="st-talk-group-description">{props.group.description || '未填写群聊描述'}</p>
      )}
      <div className="st-talk-facts">
        <span>
          <small>协作模式</small>
          <strong>{props.group.collaborationMode === 'parallel' ? '并行' : '串行'}</strong>
        </span>
        <span>
          <small>操作权限</small>
          <strong>{approvalModeLabel(props.group.approvalMode)}</strong>
        </span>
        <span>
          <small>并发数</small>
          <strong>{props.group.maxConcurrency}</strong>
        </span>
      </div>
      <div className="st-talk-members-head">
        <strong>成员与职责</strong>
        {availableAgents.length > 0 ? (
          <span>
            <select value={addId} onChange={(event) => setAddId(event.target.value)}>
              <option value="">选择智能体</option>
              {availableAgents.map((agent) => (
                <option key={agent.agentVersionId} value={agent.agentVersionId}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="添加成员"
              disabled={!addId || props.busy}
              onClick={() =>
                void props.onAddMember({
                  groupId: props.group.id,
                  expectedVersion: props.group.version,
                  member: {
                    agentVersionId: addId as AddGroupMemberPayload['member']['agentVersionId'],
                    responsibility:
                      props.agents.find((agent) => agent.agentVersionId === addId)?.role ||
                      '协作执行',
                  },
                })
              }
            >
              <Plus size={13} />
            </button>
          </span>
        ) : null}
      </div>
      <div className="st-talk-members">
        {props.group.members.map((member) => {
          const agent = props.agents.find(
            (option) => option.agentVersionId === member.agentVersionId,
          );
          const isLead = member.agentVersionId === props.group.leadAgentVersionId;
          return (
            <article key={member.agentVersionId}>
              <span
                className="st-talk-avatar"
                style={{ '--avatar-color': agent?.color ?? '#0d9488' } as React.CSSProperties}
              >
                <Bot size={13} />
              </span>
              <div className="st-talk-member-main">
                <div>
                  <strong>{agent?.name ?? member.agentVersionId}</strong>
                  {isLead ? (
                    <em>
                      <Crown size={10} /> 主智能体
                    </em>
                  ) : null}
                  <small>{agent?.role ?? '智能体'}</small>
                </div>
                <input
                  value={responsibilities[member.agentVersionId] ?? member.responsibility}
                  onChange={(event) =>
                    setResponsibilities((current) => ({
                      ...current,
                      [member.agentVersionId]: event.target.value,
                    }))
                  }
                  onBlur={(event) => {
                    const responsibility = event.target.value.trim();
                    if (responsibility && responsibility !== member.responsibility)
                      void props.onUpdateResponsibility({
                        groupId: props.group.id,
                        expectedVersion: props.group.version,
                        agentVersionId: member.agentVersionId,
                        responsibility,
                      });
                  }}
                />
              </div>
              <div className="st-talk-member-actions">
                {isLead ? null : (
                  <button
                    type="button"
                    title="设为主智能体"
                    disabled={props.busy}
                    onClick={() =>
                      void props.onSetLead({
                        groupId: props.group.id,
                        expectedVersion: props.group.version,
                        agentVersionId: member.agentVersionId,
                      })
                    }
                  >
                    <Crown size={13} />
                  </button>
                )}
                {isLead ? null : (
                  <button
                    type="button"
                    title="移除成员"
                    disabled={props.busy}
                    onClick={() =>
                      void props.onRemoveMember({
                        groupId: props.group.id,
                        expectedVersion: props.group.version,
                        agentVersionId: member.agentVersionId,
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function TalkSkillsWorkspace(props: {
  skills: readonly AgentBindingSkillOption[];
  mcpServers: readonly AgentBindingMcpOption[];
  skillBusy?: boolean;
  mcpBusy?: boolean;
  error?: string | null;
  onImportSkill?: AgentBindingPanelProps['onImportSkill'];
  onRegisterMcp?: AgentBindingPanelProps['onRegisterMcp'];
}) {
  const [tab, setTab] = useState<'skills' | 'mcp'>('skills');
  const [creating, setCreating] = useState(false);
  const [skillMd, setSkillMd] = useState('');
  const [mcpName, setMcpName] = useState('');
  const [mcpTransport, setMcpTransport] = useState('local-stdio');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [mcpTools, setMcpTools] = useState('');
  const [mcpTrusted, setMcpTrusted] = useState(false);
  const items = tab === 'skills' ? props.skills : props.mcpServers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    items.find(
      (item) =>
        (tab === 'skills'
          ? (item as AgentBindingSkillOption).skillVersionId
          : (item as AgentBindingMcpOption).mcpServerId) === selectedId,
    ) ?? items[0];
  useEffect(() => setSelectedId(null), [tab]);
  return (
    <div className="st-talk-directory st-talk-resource-page" data-testid="talk-skills-workspace">
      <aside className="st-talk-directory__list">
        <header>
          <div>
            <strong>Skill & MCP</strong>
            <small>
              {props.skills.length} Skills · {props.mcpServers.length} MCP
            </small>
          </div>
          <button
            type="button"
            title={tab === 'skills' ? '导入 Skill' : '注册 MCP'}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} />
          </button>
        </header>
        <div className="st-talk-tabs">
          <button
            type="button"
            data-active={tab === 'skills' ? '1' : '0'}
            onClick={() => {
              setTab('skills');
              setCreating(false);
            }}
          >
            Skills
          </button>
          <button
            type="button"
            data-active={tab === 'mcp' ? '1' : '0'}
            onClick={() => {
              setTab('mcp');
              setCreating(false);
            }}
          >
            MCP
          </button>
        </div>
        <div className="st-talk-directory__rows">
          {items.map((item) => {
            const id =
              tab === 'skills'
                ? (item as AgentBindingSkillOption).skillVersionId
                : (item as AgentBindingMcpOption).mcpServerId;
            return (
              <button
                type="button"
                key={id}
                className="st-talk-simple-row"
                data-active={selected === item ? '1' : '0'}
                onClick={() => setSelectedId(id)}
              >
                {tab === 'skills' ? <Puzzle size={13} /> : <Server size={13} />}
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {tab === 'skills'
                      ? (item as AgentBindingSkillOption).version
                      : `${(item as AgentBindingMcpOption).toolCount ?? 0} tools`}
                  </small>
                </span>
              </button>
            );
          })}
          {items.length === 0 ? <p className="st-talk-empty">暂无记录</p> : null}
        </div>
      </aside>
      <main className="st-talk-directory__detail">
        {creating ? (
          <section className="st-talk-editor st-talk-resource-editor">
            <header>
              <div>
                <strong>{tab === 'skills' ? '导入 Skill' : '注册 MCP Server'}</strong>
                <small>{tab === 'skills' ? 'SKILL.md' : '本地 stdio 或远程 HTTP'}</small>
              </div>
            </header>
            {tab === 'skills' ? (
              <div className="st-talk-form-grid">
                <label className="st-talk-form-wide">
                  <span>SKILL.md</span>
                  <textarea
                    rows={16}
                    value={skillMd}
                    onChange={(event) => setSkillMd(event.target.value)}
                    placeholder="---\nname: repository-review\ndescription: ...\n---"
                  />
                </label>
              </div>
            ) : (
              <div className="st-talk-form-grid">
                <label>
                  <span>名称</span>
                  <input value={mcpName} onChange={(event) => setMcpName(event.target.value)} />
                </label>
                <label>
                  <span>传输</span>
                  <select
                    value={mcpTransport}
                    onChange={(event) => setMcpTransport(event.target.value)}
                  >
                    <option value="local-stdio">Local stdio</option>
                    <option value="remote-http">Remote HTTP</option>
                  </select>
                </label>
                <label className="st-talk-form-wide">
                  <span>端点 / 命令</span>
                  <input
                    value={mcpEndpoint}
                    onChange={(event) => setMcpEndpoint(event.target.value)}
                  />
                </label>
                <label className="st-talk-form-wide">
                  <span>工具（JSON 或逗号分隔）</span>
                  <textarea
                    rows={5}
                    value={mcpTools}
                    onChange={(event) => setMcpTools(event.target.value)}
                  />
                </label>
                <label className="st-talk-check">
                  <input
                    type="checkbox"
                    checked={mcpTrusted}
                    onChange={(event) => setMcpTrusted(event.target.checked)}
                  />
                  <span>信任此 Server</span>
                </label>
              </div>
            )}
            <footer>
              <button
                type="button"
                className="st-talk-button st-talk-button--ghost"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              {tab === 'skills' ? (
                <button
                  type="button"
                  className="st-talk-button"
                  disabled={props.skillBusy || !skillMd.trim() || !props.onImportSkill}
                  onClick={async () => {
                    await props.onImportSkill?.(skillMd.trim());
                    setSkillMd('');
                    setCreating(false);
                  }}
                >
                  导入
                </button>
              ) : (
                <button
                  type="button"
                  className="st-talk-button"
                  disabled={props.mcpBusy || !mcpName.trim() || !props.onRegisterMcp}
                  onClick={async () => {
                    await props.onRegisterMcp?.({
                      name: mcpName.trim(),
                      transport: mcpTransport,
                      endpoint: mcpEndpoint.trim(),
                      toolsJson: mcpTools.trim() || undefined,
                      trusted: mcpTrusted,
                    });
                    setMcpName('');
                    setMcpEndpoint('');
                    setMcpTools('');
                    setCreating(false);
                  }}
                >
                  注册
                </button>
              )}
            </footer>
          </section>
        ) : selected ? (
          tab === 'skills' ? (
            <SkillResourceDetail skill={selected as AgentBindingSkillOption} />
          ) : (
            <McpResourceDetail server={selected as AgentBindingMcpOption} />
          )
        ) : (
          <div className="st-talk-empty st-talk-empty--center">
            <Puzzle size={24} />
            <strong>选择一项资源</strong>
          </div>
        )}
        {props.error ? (
          <p className="st-talk-error" role="alert">
            {props.error}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function SkillResourceDetail(props: { skill: AgentBindingSkillOption }) {
  const tools = props.skill.allowedTools ?? [];
  return (
    <section className="st-talk-resource-detail">
      <header>
        <Puzzle size={18} />
        <div>
          <strong>{props.skill.name}</strong>
          <small>{props.skill.version}</small>
        </div>
      </header>
      <p>{props.skill.description || '无描述'}</p>
      <div className="st-talk-resource-facts">
        <span>
          <small>版本</small>
          <strong>{props.skill.version}</strong>
        </span>
        <span>
          <small>允许工具</small>
          <strong>{tools.length}</strong>
        </span>
        <span>
          <small>脚本</small>
          <strong>{props.skill.hasScripts ? '包含' : '无'}</strong>
        </span>
      </div>
      {props.skill.permissionNote ? (
        <p className="st-talk-resource-note">{props.skill.permissionNote}</p>
      ) : null}
      <ResourceNameList title="允许工具" items={tools} emptyLabel="未声明工具" />
    </section>
  );
}

function McpResourceDetail(props: { server: AgentBindingMcpOption }) {
  const tools = props.server.toolNames ?? [];
  return (
    <section className="st-talk-resource-detail">
      <header>
        <Server size={18} />
        <div>
          <strong>{props.server.name}</strong>
          <small>{props.server.transport || '未设置传输方式'}</small>
        </div>
      </header>
      <div className="st-talk-resource-facts">
        <span>
          <small>连接</small>
          <strong>{props.server.transport || '未设置'}</strong>
        </span>
        <span>
          <small>工具</small>
          <strong>{props.server.toolCount ?? tools.length}</strong>
        </span>
        <span>
          <small>信任</small>
          <strong>{props.server.trusted ? '已信任' : '受限'}</strong>
        </span>
      </div>
      <div className="st-talk-resource-endpoint">
        <small>端点</small>
        <code>{props.server.endpoint || '未设置端点'}</code>
      </div>
      {props.server.policyLabel ? (
        <p className="st-talk-resource-note">{props.server.policyLabel}</p>
      ) : null}
      <ResourceNameList title="可用工具" items={tools} emptyLabel="尚未发现工具" />
    </section>
  );
}

function ResourceNameList(props: { title: string; items: readonly string[]; emptyLabel: string }) {
  return (
    <section className="st-talk-resource-list">
      <h3>{props.title}</h3>
      {props.items.length > 0 ? (
        <ul>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{props.emptyLabel}</p>
      )}
    </section>
  );
}

export function TalkAutomationWorkspace(props: {
  automations: readonly AutomationDefinition[];
  executions: readonly AutomationExecution[];
  runtime: AutomationRuntimeStatus;
  workspaces: readonly WorkspaceSummary[];
  agents: readonly TalkGroupAgentOption[];
  groups: readonly GroupDefinition[];
  loading: boolean;
  busy: boolean;
  error?: string | null;
  revealedSecret: { automationId: string; url?: string; secret: string } | null;
  onCreate: (payload: CreateAutomationPayload) => Promise<void>;
  onUpdate: (payload: UpdateAutomationPayload) => Promise<void>;
  onDelete: (automationId: string, expectedVersion: number) => Promise<void>;
  onTrigger: (automationId: string, input?: string) => Promise<void>;
  onOpenTask: (taskId: string) => Promise<void>;
  onDismissSecret: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'cron' | 'webhook'>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const selected =
    props.automations.find((automation) => automation.id === selectedId) ?? props.automations[0];
  const visible = props.automations.filter(
    (automation) => filter === 'all' || automation.trigger.type === filter,
  );

  useEffect(() => {
    if (!selectedId && props.automations[0]) setSelectedId(props.automations[0].id);
    if (selectedId && !props.automations.some((automation) => automation.id === selectedId)) {
      setSelectedId(props.automations[0]?.id ?? null);
    }
  }, [props.automations, selectedId]);

  return (
    <div
      className="st-talk-directory st-talk-resource-page st-talk-automation"
      data-testid="talk-automation-workspace"
    >
      <aside className="st-talk-directory__list">
        <header>
          <div>
            <strong>自动化</strong>
            <small>{props.automations.length} 个任务</small>
          </div>
          <button
            type="button"
            title="新建自动化"
            disabled={!props.runtime.schedulerAvailable}
            onClick={() => {
              setCreating(true);
              setEditing(false);
            }}
          >
            <Plus size={14} />
          </button>
        </header>
        <div className="st-talk-tabs">
          {(['all', 'cron', 'webhook'] as const).map((item) => (
            <button
              type="button"
              key={item}
              data-active={filter === item ? '1' : '0'}
              onClick={() => setFilter(item)}
            >
              {item === 'all' ? '全部' : item === 'cron' ? '定时' : 'Webhook'}
            </button>
          ))}
        </div>
        <div className="st-talk-directory__rows">
          {props.loading ? <p className="st-talk-empty">读取自动化…</p> : null}
          {!props.loading && visible.length === 0 ? (
            <p className="st-talk-empty">暂无自动化</p>
          ) : null}
          {visible.map((automation) => (
            <button
              type="button"
              key={automation.id}
              className="st-talk-automation-row"
              data-active={selected?.id === automation.id && !creating ? '1' : '0'}
              onClick={() => {
                setSelectedId(automation.id);
                setCreating(false);
                setEditing(false);
              }}
            >
              <span
                className="st-talk-automation-row__icon"
                data-enabled={automation.enabled ? '1' : '0'}
              >
                {automation.trigger.type === 'cron' ? <Clock3 size={13} /> : <Link2 size={13} />}
              </span>
              <span>
                <strong>{automation.name}</strong>
                <small>{automation.enabled ? automationNextLabel(automation) : '已暂停'}</small>
              </span>
            </button>
          ))}
        </div>
        <footer
          className="st-talk-automation-runtime"
          data-online={props.runtime.schedulerAvailable ? '1' : '0'}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{props.runtime.schedulerAvailable ? '调度器在线' : '调度器离线'}</strong>
            <small>Webhook {props.runtime.webhookAvailable ? '可用' : '不可用'}</small>
          </span>
        </footer>
      </aside>
      <main className="st-talk-directory__detail">
        {creating ? (
          <AutomationEditor
            key="new"
            workspaces={props.workspaces}
            agents={props.agents}
            groups={props.groups}
            busy={props.busy}
            onCancel={() => setCreating(false)}
            onSave={async (payload) => {
              await props.onCreate(payload);
              setCreating(false);
            }}
          />
        ) : selected && editing ? (
          <AutomationEditor
            key={`${selected.id}:${selected.version}`}
            automation={selected}
            workspaces={props.workspaces}
            agents={props.agents}
            groups={props.groups}
            busy={props.busy}
            onCancel={() => setEditing(false)}
            onSave={async (payload) => {
              await props.onUpdate({
                ...payload,
                automationId: selected.id,
                expectedVersion: selected.version,
              });
              setEditing(false);
            }}
          />
        ) : selected ? (
          <AutomationDetail
            automation={selected}
            executions={props.executions.filter(
              (execution) => execution.automationId === selected.id,
            )}
            runtime={props.runtime}
            busy={props.busy}
            secret={
              props.revealedSecret?.automationId === selected.id ? props.revealedSecret : null
            }
            onEdit={() => setEditing(true)}
            onDelete={() => props.onDelete(selected.id, selected.version)}
            onTrigger={(input) => props.onTrigger(selected.id, input)}
            onOpenTask={props.onOpenTask}
            onDismissSecret={props.onDismissSecret}
          />
        ) : (
          <div className="st-talk-empty st-talk-empty--center">
            <Zap size={24} />
            <strong>新建一个自动化</strong>
          </div>
        )}
        {props.error ? (
          <p className="st-talk-error" role="alert">
            {props.error}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function AutomationEditor(props: {
  automation?: AutomationDefinition;
  workspaces: readonly WorkspaceSummary[];
  agents: readonly TalkGroupAgentOption[];
  groups: readonly GroupDefinition[];
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: CreateAutomationPayload) => Promise<void>;
}) {
  const initialTarget = props.automation?.target;
  const [name, setName] = useState(props.automation?.name ?? '');
  const [workspaceId, setWorkspaceId] = useState<string>(
    String(props.automation?.workspaceId ?? props.workspaces[0]?.workspaceId ?? ''),
  );
  const [targetType, setTargetType] = useState<'agent' | 'group'>(initialTarget?.type ?? 'agent');
  const [agentVersionId, setAgentVersionId] = useState<string>(
    String(
      initialTarget?.type === 'agent'
        ? initialTarget.agentVersionId
        : (props.agents[0]?.agentVersionId ?? ''),
    ),
  );
  const [groupId, setGroupId] = useState<string>(
    String(initialTarget?.type === 'group' ? initialTarget.groupId : (props.groups[0]?.id ?? '')),
  );
  const [instruction, setInstruction] = useState(props.automation?.instruction ?? '');
  const [triggerType, setTriggerType] = useState<'cron' | 'webhook'>(
    props.automation?.trigger.type ?? 'cron',
  );
  const [cron, setCron] = useState(
    props.automation?.trigger.type === 'cron' ? props.automation.trigger.expression : '0 9 * * 1-5',
  );
  const [timezone, setTimezone] = useState(props.automation?.timezone ?? 'Asia/Shanghai');
  const [approvalMode, setApprovalMode] = useState(props.automation?.approvalMode ?? 'full');
  const [concurrencyPolicy, setConcurrencyPolicy] = useState(
    props.automation?.concurrencyPolicy ?? 'skip',
  );
  const [maxConcurrency, setMaxConcurrency] = useState(props.automation?.maxConcurrency ?? 1);
  const [maxRetries, setMaxRetries] = useState(props.automation?.maxRetries ?? 0);
  const [enabled, setEnabled] = useState(props.automation?.enabled ?? true);
  const validTarget = targetType === 'agent' ? Boolean(agentVersionId) : Boolean(groupId);

  const save = () =>
    props.onSave({
      name: name.trim(),
      workspaceId: workspaceId as CreateAutomationPayload['workspaceId'],
      target:
        targetType === 'agent'
          ? { type: 'agent', agentVersionId: agentVersionId as never }
          : { type: 'group', groupId: groupId as never },
      instruction: instruction.trim(),
      trigger:
        triggerType === 'cron' ? { type: 'cron', expression: cron.trim() } : { type: 'webhook' },
      timezone,
      approvalMode,
      concurrencyPolicy,
      maxConcurrency,
      maxRetries,
      enabled,
    });

  return (
    <section className="st-talk-editor st-talk-automation-editor">
      <header>
        <div>
          <strong>{props.automation ? '编辑自动化' : '新建自动化'}</strong>
          <small>每次触发都会创建一个新任务</small>
        </div>
      </header>
      <div className="st-talk-form-grid">
        <label>
          <span>名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>项目</span>
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {props.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>执行目标</span>
          <div className="st-talk-segmented">
            <button
              type="button"
              data-active={targetType === 'agent' ? '1' : '0'}
              onClick={() => setTargetType('agent')}
            >
              好友
            </button>
            <button
              type="button"
              data-active={targetType === 'group' ? '1' : '0'}
              onClick={() => setTargetType('group')}
            >
              群聊
            </button>
          </div>
        </label>
        <label>
          <span>{targetType === 'agent' ? '智能体' : '群聊'}</span>
          {targetType === 'agent' ? (
            <select
              value={agentVersionId}
              onChange={(event) => setAgentVersionId(event.target.value)}
            >
              {props.agents.map((agent) => (
                <option key={agent.agentVersionId} value={agent.agentVersionId}>
                  {agent.name}
                </option>
              ))}
            </select>
          ) : (
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {props.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="st-talk-form-wide">
          <span>初始指令</span>
          <textarea
            rows={4}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <label>
          <span>触发方式</span>
          <div className="st-talk-segmented">
            <button
              type="button"
              data-active={triggerType === 'cron' ? '1' : '0'}
              onClick={() => setTriggerType('cron')}
            >
              定时
            </button>
            <button
              type="button"
              data-active={triggerType === 'webhook' ? '1' : '0'}
              onClick={() => setTriggerType('webhook')}
            >
              Webhook
            </button>
          </div>
        </label>
        {triggerType === 'cron' ? (
          <label>
            <span>Cron</span>
            <input
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 9 * * 1-5"
            />
          </label>
        ) : (
          <div className="st-talk-automation-hint">
            <Link2 size={13} />
            <span>保存后生成本地地址与一次性密钥</span>
          </div>
        )}
        <label>
          <span>时区</span>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="UTC">UTC</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
          </select>
        </label>
        <label>
          <span>操作权限</span>
          <select
            value={approvalMode}
            onChange={(event) => setApprovalMode(event.target.value as typeof approvalMode)}
          >
            <option value="full">完全访问</option>
            <option value="request">请求批准</option>
            <option value="delegate">替我审批</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <label>
          <span>并发策略</span>
          <select
            value={concurrencyPolicy}
            onChange={(event) =>
              setConcurrencyPolicy(event.target.value as typeof concurrencyPolicy)
            }
          >
            <option value="skip">忙时跳过</option>
            <option value="queue">排队</option>
            <option value="parallel">并行</option>
          </select>
        </label>
        <label>
          <span>最大并发</span>
          <input
            type="number"
            min={1}
            max={8}
            value={maxConcurrency}
            onChange={(event) => setMaxConcurrency(Number(event.target.value))}
          />
        </label>
        <label>
          <span>失败重试</span>
          <select
            value={maxRetries}
            onChange={(event) => setMaxRetries(Number(event.target.value))}
          >
            <option value={0}>不重试</option>
            <option value={1}>1 次</option>
            <option value={2}>2 次</option>
          </select>
        </label>
        <label className="st-talk-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>启用自动化</span>
        </label>
      </div>
      <footer>
        <button
          type="button"
          className="st-talk-button st-talk-button--ghost"
          onClick={props.onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="st-talk-button"
          disabled={
            props.busy ||
            !name.trim() ||
            !workspaceId ||
            !validTarget ||
            !instruction.trim() ||
            (triggerType === 'cron' && !cron.trim())
          }
          onClick={() => void save()}
        >
          <Save size={12} /> 保存
        </button>
      </footer>
    </section>
  );
}

function AutomationDetail(props: {
  automation: AutomationDefinition;
  executions: readonly AutomationExecution[];
  runtime: AutomationRuntimeStatus;
  busy: boolean;
  secret: { automationId: string; url?: string; secret: string } | null;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onTrigger: (input?: string) => Promise<void>;
  onOpenTask: (taskId: string) => Promise<void>;
  onDismissSecret: () => void;
}) {
  const [manualInput, setManualInput] = useState('');
  const webhookUrl =
    props.secret?.url ??
    (props.automation.trigger.type === 'webhook' && props.runtime.webhookBaseUrl
      ? `${props.runtime.webhookBaseUrl}/webhooks/${props.automation.trigger.path}`
      : undefined);
  const targetLabel =
    props.automation.target.type === 'agent'
      ? `智能体 · ${props.automation.target.agentVersionId}`
      : `群聊 · ${props.automation.target.groupId}`;
  return (
    <section className="st-talk-automation-detail">
      <header className="st-talk-detail-head">
        <span className="st-talk-automation-hero-icon">
          {props.automation.trigger.type === 'cron' ? <Clock3 size={18} /> : <Link2 size={18} />}
        </span>
        <div>
          <strong>{props.automation.name}</strong>
          <small>
            {props.automation.enabled ? '已启用' : '已暂停'} · v{props.automation.version}
          </small>
        </div>
        <button
          type="button"
          className="st-talk-button st-talk-button--ghost"
          onClick={props.onEdit}
        >
          编辑
        </button>
        <button
          type="button"
          className="st-talk-icon-danger"
          title="删除自动化"
          disabled={props.busy}
          onClick={() => void props.onDelete()}
        >
          <Trash2 size={13} />
        </button>
      </header>
      <p className="st-talk-group-description">{props.automation.instruction}</p>
      <div className="st-talk-facts">
        <span>
          <small>目标</small>
          <strong>{targetLabel}</strong>
        </span>
        <span>
          <small>触发</small>
          <strong>
            {props.automation.trigger.type === 'cron'
              ? props.automation.trigger.expression
              : 'Webhook'}
          </strong>
        </span>
        <span>
          <small>并发</small>
          <strong>{automationConcurrencyLabel(props.automation)}</strong>
        </span>
        <span>
          <small>重试</small>
          <strong>{props.automation.maxRetries} 次</strong>
        </span>
      </div>
      {props.automation.trigger.type === 'webhook' ? (
        <section className="st-talk-webhook-box">
          <header>
            <div>
              <strong>Webhook</strong>
              <small>{props.runtime.webhookAvailable ? '本地端点已监听' : '端点暂不可用'}</small>
            </div>
          </header>
          <code>{webhookUrl ?? 'Runtime 启动后显示地址'}</code>
          {props.secret ? (
            <div className="st-talk-secret-reveal">
              <CheckCircle2 size={14} />
              <span>
                <small>密钥仅显示这一次</small>
                <code>{props.secret.secret}</code>
              </span>
              <button
                type="button"
                title="复制地址和密钥"
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    `${webhookUrl ?? ''}\n${props.secret?.secret ?? ''}`,
                  )
                }
              >
                <Copy size={13} />
              </button>
              <button type="button" onClick={props.onDismissSecret}>
                我已保存
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="st-talk-automation-run">
        <header>
          <div>
            <strong>立即运行</strong>
            <small>同样会创建一个新任务</small>
          </div>
          <button
            type="button"
            className="st-talk-button"
            disabled={props.busy || !props.runtime.schedulerAvailable}
            onClick={() => void props.onTrigger(manualInput)}
          >
            <Play size={12} /> 运行
          </button>
        </header>
        <input
          value={manualInput}
          onChange={(event) => setManualInput(event.target.value)}
          placeholder="可选：补充本次运行要求"
        />
      </section>
      <section className="st-talk-automation-history">
        <header>
          <strong>运行历史</strong>
          <small>{props.executions.length} 次</small>
        </header>
        {props.executions.length === 0 ? (
          <p>尚未运行</p>
        ) : (
          <ul>
            {props.executions.map((execution) => (
              <li key={execution.id}>
                <i data-status={execution.status} />
                <span>
                  <strong>{automationExecutionLabel(execution)}</strong>
                  <small>
                    {formatAutomationTime(execution.createdAt)} · 第 {execution.attempt + 1} 次尝试
                  </small>
                </span>
                {execution.taskId ? (
                  <button type="button" onClick={() => void props.onOpenTask(execution.taskId!)}>
                    打开任务
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function automationNextLabel(automation: AutomationDefinition): string {
  if (automation.trigger.type === 'webhook') return '等待 Webhook';
  return automation.nextTriggerAt
    ? `下次 ${formatAutomationTime(automation.nextTriggerAt)}`
    : '等待调度';
}

function automationConcurrencyLabel(automation: AutomationDefinition): string {
  const policy =
    automation.concurrencyPolicy === 'skip'
      ? '跳过'
      : automation.concurrencyPolicy === 'queue'
        ? '排队'
        : '并行';
  return `${policy} · ${automation.maxConcurrency}`;
}

function automationExecutionLabel(execution: AutomationExecution): string {
  return execution.status === 'completed'
    ? '已完成'
    : execution.status === 'running'
      ? '运行中'
      : execution.status === 'queued'
        ? '排队中'
        : execution.status === 'skipped'
          ? '已跳过'
          : '失败';
}

function formatAutomationTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export type TalkSettingsTab = 'runtime' | 'browser' | 'data' | 'appearance' | 'diagnostics';

export function TalkSettingsWorkspace(props: {
  defaultTab?: TalkSettingsTab;
  theme: Theme;
  fontSize: number;
  runtimeState: string;
  runtime?: AutomationRuntimeStatus | null;
  workspaceCount: number;
  agentCount: number;
  providerCount: number;
  groupCount: number;
  browserIdentities?: readonly BrowserIdentitySummary[];
  browserIdentityBusy?: boolean;
  browserIdentityError?: string | null;
  onCreateBrowserIdentity?: (input: { name: string; makeDefault?: boolean }) => void | Promise<void>;
  onUpdateBrowserIdentity?: (
    input: { id: string; name?: string; makeDefault?: boolean },
  ) => void | Promise<void>;
  onDeleteBrowserIdentity?: (id: string) => void | Promise<void>;
  onThemeChange: (theme: Theme) => void;
  onFontSizeChange: (size: number) => void;
}) {
  const [tab, setTab] = useState<TalkSettingsTab>(props.defaultTab ?? 'runtime');
  const [browserEditor, setBrowserEditor] = useState<{
    id?: string;
    name: string;
    makeDefault: boolean;
  } | null>(null);
  const tabs = [
    { id: 'runtime' as const, label: 'Runtime', icon: Activity },
    { id: 'browser' as const, label: '浏览器身份', icon: Globe2 },
    { id: 'data' as const, label: '数据与存储', icon: HardDrive },
    { id: 'appearance' as const, label: '外观', icon: Palette },
    { id: 'diagnostics' as const, label: '诊断', icon: Terminal },
  ];
  useEffect(() => {
    if (props.defaultTab) setTab(props.defaultTab);
  }, [props.defaultTab]);
  const online = props.runtimeState === 'online';
  return (
    <div className="st-talk-settings" data-testid="talk-settings-workspace">
      <aside className="st-talk-settings__nav">
        <header>
          <Settings size={15} />
          <div>
            <strong>设置</strong>
            <small>SYNC-THINK</small>
          </div>
        </header>
        <nav aria-label="设置页面">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-active={tab === item.id ? '1' : '0'}
                onClick={() => setTab(item.id)}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="st-talk-settings__content">
        {tab === 'runtime' ? (
          <section className="st-talk-settings__section">
            <header>
              <h2>Runtime</h2>
              <p>本地运行组件</p>
            </header>
            <div className="st-talk-runtime-list">
              <SettingsStatusRow
                label="SYNC-THINK Runtime"
                detail="命令网关与持久事件流"
                ready={online}
              />
              <SettingsStatusRow
                label="任务调度器"
                detail="Cron 与手动触发"
                ready={Boolean(props.runtime?.schedulerAvailable)}
              />
              <SettingsStatusRow
                label="Webhook"
                detail={props.runtime?.webhookBaseUrl ?? '本地接收端点'}
                ready={Boolean(props.runtime?.webhookAvailable)}
                mono={Boolean(props.runtime?.webhookBaseUrl)}
              />
              <SettingsStatusRow label="数据持久化" detail="SQLite · local-first" ready={online} />
            </div>
          </section>
        ) : null}
        {tab === 'data' ? (
          <section className="st-talk-settings__section">
            <header>
              <h2>数据与存储</h2>
              <p>当前 Runtime 记录</p>
            </header>
            <dl className="st-talk-settings__data">
              <div>
                <dt>项目</dt>
                <dd>{props.workspaceCount}</dd>
              </div>
              <div>
                <dt>智能体</dt>
                <dd>{props.agentCount}</dd>
              </div>
              <div>
                <dt>供应商</dt>
                <dd>{props.providerCount}</dd>
              </div>
              <div>
                <dt>群聊</dt>
                <dd>{props.groupCount}</dd>
              </div>
              <div>
                <dt>存储方式</dt>
                <dd>本地 SQLite</dd>
              </div>
            </dl>
          </section>
        ) : null}
        {tab === 'browser' ? (
          <section className="st-talk-settings__section">
            <header className="st-talk-settings__section-heading">
              <span>
                <h2>浏览器身份</h2>
                <p>每个身份会隔离 Cookie、登录状态和网站数据</p>
                <p>新任务继承默认身份；单个任务可在任务右侧栏切换。</p>
              </span>
              <button
                type="button"
                className="st-talk-button st-talk-button--primary"
                disabled={props.browserIdentityBusy}
                onClick={() => setBrowserEditor({ name: '', makeDefault: false })}
              >
                <Plus aria-hidden="true" size={13} />
                新建身份
              </button>
            </header>
            {props.browserIdentityError ? <p role="alert">{props.browserIdentityError}</p> : null}
            <ul className="st-talk-browser-identities">
              {(props.browserIdentities ?? []).map((identity) => (
                <li key={identity.id}>
                  <Globe2 aria-hidden="true" size={16} />
                  <span>
                    <strong>{identity.name}</strong>
                    <small>
                      {identity.isDefault
                        ? '默认 · 新任务继承 · 独立登录数据'
                        : '可供任务单独选择 · 独立登录数据'}
                    </small>
                  </span>
                  {!identity.isDefault ? (
                    <button
                      type="button"
                      disabled={props.browserIdentityBusy}
                      onClick={() =>
                        void props.onUpdateBrowserIdentity?.({ id: identity.id, makeDefault: true })
                      }
                    >
                      设为默认
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`编辑 ${identity.name}`}
                    title="编辑"
                    disabled={props.browserIdentityBusy}
                    onClick={() =>
                      setBrowserEditor({ id: identity.id, name: identity.name, makeDefault: false })
                    }
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${identity.name}`}
                    title={identity.isDefault ? '默认身份不能删除' : '删除'}
                    disabled={identity.isDefault || props.browserIdentityBusy}
                    onClick={() => {
                      if (window.confirm(`删除浏览器身份“${identity.name}”？`)) {
                        void props.onDeleteBrowserIdentity?.(identity.id);
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tab === 'appearance' ? (
          <section className="st-talk-settings__section">
            <header>
              <h2>外观</h2>
              <p>应用主题</p>
            </header>
            <div className="st-talk-setting-row">
              <span>
                <strong>主题</strong>
                <small>应用于全部页面</small>
              </span>
              <div className="st-talk-segmented">
                {(['light', 'dark', 'system'] as Theme[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    data-active={props.theme === theme ? '1' : '0'}
                    onClick={() => props.onThemeChange(theme)}
                  >
                    {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}
                  </button>
                ))}
              </div>
            </div>
            <div className="st-talk-setting-row">
              <span>
                <strong>字体大小</strong>
                <small>调整主要界面文字与对话正文</small>
              </span>
              <label className="st-talk-font-size-control">
                <span>小</span>
                <input
                  type="range"
                  min="13"
                  max="18"
                  step="1"
                  value={props.fontSize}
                  aria-label="字体大小"
                  aria-valuetext={`${props.fontSize} 像素`}
                  onChange={(event) => props.onFontSizeChange(Number(event.target.value))}
                />
                <span>大</span>
                <output>{props.fontSize} px</output>
              </label>
            </div>
          </section>
        ) : null}
        {tab === 'diagnostics' ? (
          <section className="st-talk-settings__section">
            <header>
              <h2>诊断</h2>
              <p>运行边界</p>
            </header>
            <dl className="st-talk-settings__data">
              <div>
                <dt>Runtime 连接</dt>
                <dd>{online ? '已连接' : '未连接'}</dd>
              </div>
              <div>
                <dt>传输</dt>
                <dd>本机命名管道</dd>
              </div>
              <div>
                <dt>Renderer</dt>
                <dd>受限渲染进程 + 上下文隔离</dd>
              </div>
              <div>
                <dt>密钥</dt>
                <dd>安全存储引用</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </main>
      {browserEditor ? (
        <div className="st-talk-task-utility-backdrop">
          <section className="st-talk-task-utility-dialog" role="dialog" aria-modal="true" aria-label={browserEditor.id ? '编辑浏览器身份' : '新建浏览器身份'}>
            <header>
              <strong>{browserEditor.id ? '编辑浏览器身份' : '新建浏览器身份'}</strong>
              <button type="button" aria-label="关闭" onClick={() => setBrowserEditor(null)}>
                <X aria-hidden="true" size={15} />
              </button>
            </header>
            <form
              className="st-talk-browser-identity-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = browserEditor.name.trim();
                if (!name) return;
                const save = browserEditor.id
                  ? props.onUpdateBrowserIdentity?.({
                      id: browserEditor.id,
                      name,
                      ...(browserEditor.makeDefault ? { makeDefault: true } : {}),
                    })
                  : props.onCreateBrowserIdentity?.({
                      name,
                      ...(browserEditor.makeDefault ? { makeDefault: true } : {}),
                    });
                void Promise.resolve(save).then(() => setBrowserEditor(null));
              }}
            >
              <label>
                <span>名称</span>
                <input
                  value={browserEditor.name}
                  maxLength={128}
                  autoFocus
                  onChange={(event) =>
                    setBrowserEditor((current) => current ? { ...current, name: event.target.value } : current)
                  }
                />
              </label>
              <label className="st-talk-check">
                <input
                  type="checkbox"
                  checked={browserEditor.makeDefault}
                  onChange={(event) =>
                    setBrowserEditor((current) => current ? { ...current, makeDefault: event.target.checked } : current)
                  }
                />
                <span>设为默认身份</span>
              </label>
              <footer>
                <button type="button" className="st-talk-button" onClick={() => setBrowserEditor(null)}>取消</button>
                <button type="submit" className="st-talk-button st-talk-button--primary" disabled={!browserEditor.name.trim() || props.browserIdentityBusy}>保存</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SettingsStatusRow(props: {
  label: string;
  detail: string;
  ready: boolean;
  mono?: boolean;
}) {
  return (
    <div className="st-talk-runtime-row" data-ready={props.ready ? '1' : '0'}>
      <i aria-hidden="true" />
      <span>
        <strong>{props.label}</strong>
        <small className={props.mono ? 'mono' : undefined}>{props.detail}</small>
      </span>
      <em>{props.ready ? '运行中' : '不可用'}</em>
    </div>
  );
}
