import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  FolderOpen,
  FolderPlus,
  HardDrive,
  MessageSquareText,
  Plus,
  Search,
  LayoutList,
} from 'lucide-react';
import {
  buildWorkspaceNavModel,
  type WorkspaceNavTask,
  type WorkspaceNavTaskNode,
  type WorkspaceNavWorkspace,
} from './workspace-nav-model.js';

export type {
  WorkspaceNavFolder,
  WorkspaceNavModel,
  WorkspaceNavTask,
  WorkspaceNavTaskNode,
  WorkspaceNavWorkspace,
} from './workspace-nav-model.js';

export {
  buildTaskTree,
  buildWorkspaceNavModel,
  filterTasksByQuery,
  pickLastOpenedTaskId,
} from './workspace-nav-model.js';

export type WorkspaceNavConnectionState = 'preview' | 'connecting' | 'online' | 'offline';

export interface WorkspaceNavProps {
  workspaces: readonly WorkspaceNavWorkspace[];
  tasksByWorkspace: ReadonlyMap<string, readonly WorkspaceNavTask[]>;
  activeTaskId?: string | null;
  /** Controlled search query; when omitted, component owns local query state. */
  query?: string;
  onQueryChange?: (query: string) => void;
  onSelectTask?: (task: WorkspaceNavTask) => void;
  onCreateWorkspace?: () => void;
  onCreateTask?: (workspaceId: string) => void;
  /** Explicit nested child under a parent task (§10.1 cross-task edge). */
  onCreateChildTask?: (workspaceId: string, parentTaskId: string) => void;
  connectionState?: WorkspaceNavConnectionState;
  brandTitle?: string;
  brandSubtitle?: string;
  footerLabel?: string;
  footerDetail?: string;
  emptyTitle?: string;
  emptyHint?: string;
  createWorkspaceLabel?: string;
  searchPlaceholder?: string;
  sectionLabel?: string;
  loading?: boolean;
  /** Hide the development IA projection in the end-user workspace. */
  hideReadiness?: boolean;
  /** Let a product composition render its own compact Runtime status row. */
  hideFooter?: boolean;
  /** Let an app shell own the product identity above this task tree. */
  hideBrand?: boolean;
  /** Optional extra footer content (e.g. settings entry later). */
  footerExtra?: ReactNode;
}

function connectionCopy(state: WorkspaceNavConnectionState | undefined): string {
  switch (state) {
    case 'online':
      return '已连接 · 持久事件流';
    case 'connecting':
      return '正在连接';
    case 'offline':
      return '未连接';
    case 'preview':
      return '浏览器预览';
    default:
      return '本地 Runtime';
  }
}

export type WorkspaceNavReadinessLevel = 'empty' | 'partial' | 'ready' | 'filtering';

export interface WorkspaceNavReadiness {
  level: WorkspaceNavReadinessLevel;
  badge: string;
  folderCount: number;
  taskCount: number;
  nestedTaskCount: number;
  hasActiveTask: boolean;
  runtimeOk: boolean;
  connectionState: WorkspaceNavConnectionState | null;
  connectionLabel: string;
  queryActive: boolean;
  note: string;
}

/** Pure projector for tests + UI — §15.2 folder/task IA observability. */
export function projectWorkspaceNavReadiness(input: {
  folderCount?: number;
  taskCount?: number;
  nestedTaskCount?: number;
  hasActiveTask?: boolean;
  connectionState?: WorkspaceNavConnectionState | null;
  query?: string | null;
}): WorkspaceNavReadiness {
  const folderCount = Math.max(0, Number(input.folderCount ?? 0) || 0);
  const taskCount = Math.max(0, Number(input.taskCount ?? 0) || 0);
  const nestedTaskCount = Math.max(0, Number(input.nestedTaskCount ?? 0) || 0);
  const hasActiveTask = Boolean(input.hasActiveTask);
  const connectionState = input.connectionState ?? null;
  const queryActive = Boolean(input.query && String(input.query).trim());
  const runtimeOk = connectionState === 'online' || connectionState === 'preview';
  const connectionLabel = connectionCopy(connectionState ?? undefined);

  let level: WorkspaceNavReadinessLevel = 'empty';
  if (folderCount === 0) level = 'empty';
  else if (queryActive && taskCount === 0) level = 'filtering';
  else if (taskCount === 0 || !hasActiveTask) level = 'partial';
  else if (queryActive) level = 'filtering';
  else level = 'ready';

  let badge = '等待文件夹';
  if (level === 'ready') badge = '任务已打开';
  else if (level === 'filtering') badge = taskCount === 0 ? '无匹配' : '筛选中';
  else if (level === 'partial') {
    if (folderCount > 0 && taskCount === 0) badge = '仅有文件夹';
    else if (!hasActiveTask) badge = '待选任务';
    else badge = '布局不全';
  }

  const notes: string[] = [];
  if (level === 'empty') {
    notes.push('左侧从本地文件夹开始 · 任务嵌套在文件夹下 · 添加目录后可建任务并打开会话');
  } else if (level === 'filtering') {
    notes.push(
      taskCount === 0
        ? '筛选无匹配任务 · Esc 清空搜索 · 不改变已打开任务'
        : `筛选中 · 可见任务 ${taskCount} · 嵌套 ${nestedTaskCount} · 当前${hasActiveTask ? '已选' : '未选'}`,
    );
  } else if (level === 'partial') {
    if (folderCount > 0 && taskCount === 0) {
      notes.push('已有本地文件夹 · 在文件夹下新建任务后即可打开会话');
    } else {
      notes.push(
        `文件夹 ${folderCount} · 任务 ${taskCount} · 点选任务打开会话 · Runtime ${connectionLabel}`,
      );
    }
  } else {
    notes.push(
      nestedTaskCount > 0
        ? `会话就绪 · 嵌套子任务 ${nestedTaskCount}（显式跨任务引用）· Runtime ${connectionLabel}`
        : `会话就绪 · 折叠右侧运行轨迹不暂停 Run · Runtime ${connectionLabel}`,
    );
  }

  return {
    level,
    badge,
    folderCount,
    taskCount,
    nestedTaskCount,
    hasActiveTask,
    runtimeOk,
    connectionState,
    connectionLabel,
    queryActive,
    note: notes.join(' · '),
  };
}

function TaskRows(props: {
  nodes: readonly WorkspaceNavTaskNode[];
  activeTaskId: string | null | undefined;
  lastOpenedTaskId: string | null;
  onSelectTask?: (task: WorkspaceNavTask) => void;
  onCreateChildTask?: (workspaceId: string, parentTaskId: string) => void;
}) {
  return (
    <>
      {props.nodes.map((node) => {
        const isActive = props.activeTaskId === node.task.taskId;
        const isResume = props.lastOpenedTaskId === node.task.taskId && !isActive;
        return (
          <div key={node.task.taskId} className="st-workspace-nav__task-branch">
            <div className="st-workspace-nav__task-row">
              <button
                type="button"
                className="st-workspace-nav__task"
                data-active={isActive ? 'true' : 'false'}
                data-resume={isResume ? 'true' : 'false'}
                data-depth={node.depth}
                style={{ ['--st-task-depth' as string]: String(node.depth) }}
                onClick={() => props.onSelectTask?.(node.task)}
                title={node.task.goal || node.task.title}
                role="treeitem"
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="st-workspace-nav__spine" aria-hidden="true" />
                <MessageSquareText aria-hidden="true" size={15} strokeWidth={1.7} />
                <span className="st-workspace-nav__task-title">{node.task.title}</span>
                {isActive ? (
                  <CircleDot
                    className="st-workspace-nav__task-marker"
                    aria-hidden="true"
                    size={12}
                    strokeWidth={2}
                  />
                ) : isResume ? (
                  <span className="st-workspace-nav__resume-pulse" aria-label="上次打开" />
                ) : (
                  <span className="st-workspace-nav__task-spacer" aria-hidden="true" />
                )}
              </button>
              {props.onCreateChildTask ? (
                <button
                  type="button"
                  className="st-workspace-nav__icon-btn st-workspace-nav__child-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCreateChildTask?.(node.task.workspaceId, node.task.taskId);
                  }}
                  aria-label={`在「${node.task.title}」下新建子任务`}
                  title="新建子任务（显式跨任务引用）"
                  data-testid={`workspace-nav-add-child-${node.task.taskId}`}
                >
                  <Plus aria-hidden="true" size={12} strokeWidth={1.9} />
                </button>
              ) : null}
            </div>
            {node.children.length > 0 ? (
              <TaskRows
                nodes={node.children}
                activeTaskId={props.activeTaskId}
                lastOpenedTaskId={props.lastOpenedTaskId}
                onSelectTask={props.onSelectTask}
                onCreateChildTask={props.onCreateChildTask}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * Signature left nav: local folders → nested tasks, inline search, last-open
 * resume pulse, continuum spine under the active folder. Token-driven only.
 */
export function WorkspaceNav(props: WorkspaceNavProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const query = props.query ?? internalQuery;
  const setQuery = props.onQueryChange ?? setInternalQuery;

  const model = useMemo(
    () => buildWorkspaceNavModel(props.workspaces, props.tasksByWorkspace, query),
    [props.workspaces, props.tasksByWorkspace, query],
  );

  const isEmpty = props.workspaces.length === 0;
  const folderCount = model.folders.length;
  const taskCount = model.folders.reduce((sum, f) => sum + f.flatTasks.length, 0);
  const nestedTaskCount = model.folders.reduce(
    (sum, f) => sum + f.flatTasks.filter((task) => Boolean(task.parentTaskId)).length,
    0,
  );
  const readiness = useMemo(
    () =>
      projectWorkspaceNavReadiness({
        folderCount,
        taskCount,
        nestedTaskCount,
        hasActiveTask: Boolean(props.activeTaskId),
        connectionState: props.connectionState ?? null,
        query,
      }),
    [folderCount, taskCount, nestedTaskCount, props.activeTaskId, props.connectionState, query],
  );
  const brandTitle = props.brandTitle ?? 'SYNC-THINK';
  const brandSubtitle = props.brandSubtitle ?? '连续工作台';
  const sectionLabel = props.sectionLabel ?? '本地工作区';
  const searchPlaceholder = props.searchPlaceholder ?? '筛选任务…';
  const emptyTitle = props.emptyTitle ?? '还没有本地文件夹';
  const emptyHint = props.emptyHint ?? '添加一个项目目录，任务会嵌套在文件夹下。';
  const createWorkspaceLabel = props.createWorkspaceLabel ?? '添加本地文件夹';

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  };

  return (
    <div className="st-workspace-nav" data-testid="workspace-nav" data-level={readiness.level}>
      <a className="st-skip-link" href="#st-main-conversation" data-testid="workspace-nav-skip">
        跳到对话
      </a>
      {props.hideBrand ? null : (
        <header className="st-workspace-nav__brand">
          <span className="st-workspace-nav__mark" aria-hidden="true">
            ST
          </span>
          <span className="st-workspace-nav__brand-text">
            <strong>{brandTitle}</strong>
            <small>{brandSubtitle}</small>
          </span>
        </header>
      )}

      <div className="st-workspace-nav__section-heading">
        <span>{sectionLabel}</span>
        <HardDrive aria-hidden="true" size={14} strokeWidth={1.7} />
      </div>

      {!isEmpty ? (
        <label className="st-workspace-nav__search">
          <Search aria-hidden="true" size={14} strokeWidth={1.8} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            data-testid="workspace-nav-search"
          />
        </label>
      ) : null}

      <div className="st-workspace-nav__tree" role="tree" aria-label={sectionLabel}>
        {props.loading ? (
          <div className="st-workspace-nav__status" role="status">
            正在加载工作区…
          </div>
        ) : null}

        {isEmpty && !props.loading ? (
          <div className="st-workspace-nav__empty" data-testid="workspace-nav-empty">
            <div className="st-workspace-nav__empty-icon" aria-hidden="true">
              <FolderPlus size={18} strokeWidth={1.6} />
            </div>
            <p className="st-workspace-nav__empty-title">{emptyTitle}</p>
            <p className="st-workspace-nav__empty-hint">{emptyHint}</p>
            {props.onCreateWorkspace ? (
              <button
                type="button"
                className="st-workspace-nav__primary-cta"
                onClick={props.onCreateWorkspace}
                data-testid="workspace-nav-add-folder"
              >
                <FolderPlus aria-hidden="true" size={15} strokeWidth={1.8} />
                {createWorkspaceLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {model.folders.map((folder) => {
          const workspaceId = folder.workspace.workspaceId;
          const isCollapsed = collapsed[workspaceId] === true;
          const hasActiveChild =
            props.activeTaskId != null &&
            folder.flatTasks.some((task) => task.taskId === props.activeTaskId);
          return (
            <section
              key={workspaceId}
              className="st-workspace-nav__folder"
              data-active={hasActiveChild ? 'true' : 'false'}
              data-collapsed={isCollapsed ? 'true' : 'false'}
              role="treeitem"
              aria-expanded={!isCollapsed}
            >
              <div className="st-workspace-nav__folder-row">
                <button
                  type="button"
                  className="st-workspace-nav__folder-toggle"
                  onClick={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [workspaceId]: !isCollapsed,
                    }))
                  }
                  aria-label={isCollapsed ? '展开文件夹' : '折叠文件夹'}
                  title={folder.workspace.folderPath}
                >
                  {isCollapsed ? (
                    <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
                  ) : (
                    <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
                  )}
                  <FolderOpen aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span className="st-workspace-nav__folder-name">{folder.workspace.name}</span>
                  <span className="st-workspace-nav__folder-count">{folder.flatTasks.length}</span>
                </button>
                {props.onCreateTask ? (
                  <button
                    type="button"
                    className="st-workspace-nav__icon-btn"
                    onClick={() => props.onCreateTask?.(workspaceId)}
                    aria-label={`在 ${folder.workspace.name} 新建任务`}
                    title="新建任务"
                    data-testid={`workspace-nav-add-task-${workspaceId}`}
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={1.9} />
                  </button>
                ) : null}
              </div>

              {!isCollapsed ? (
                <div className="st-workspace-nav__tasks" role="group">
                  {folder.tasks.length === 0 ? (
                    <p className="st-workspace-nav__folder-empty">
                      {query.trim() ? '无匹配任务' : '暂无任务'}
                    </p>
                  ) : (
                    <TaskRows
                      nodes={folder.tasks}
                      activeTaskId={props.activeTaskId}
                      lastOpenedTaskId={model.lastOpenedTaskId}
                      onSelectTask={props.onSelectTask}
                      onCreateChildTask={props.onCreateChildTask}
                    />
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="st-workspace-nav__actions">
        {!isEmpty && props.onCreateWorkspace ? (
          <button
            type="button"
            className="st-workspace-nav__ghost-cta"
            onClick={props.onCreateWorkspace}
            data-testid="workspace-nav-add-folder-secondary"
          >
            <FolderPlus aria-hidden="true" size={14} strokeWidth={1.8} />
            {createWorkspaceLabel}
          </button>
        ) : null}
      </div>

      {props.hideReadiness ? null : (
        <div
          className="st-workspace-nav__ia st-workspace-nav__readiness"
          data-testid="workspace-nav-ia-strip"
          data-level={readiness.level}
          data-query={readiness.queryActive ? '1' : '0'}
          aria-label="工作区导航就绪"
        >
          <div className="st-workspace-nav__ia-head">
            <LayoutList size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>工作区导航</span>
            <small>§15.2 · 文件夹 / 任务</small>
            <strong data-testid="workspace-nav-ia-badge">{readiness.badge}</strong>
          </div>
          <ul className="st-workspace-nav__ia-list">
            <li
              data-ok={readiness.folderCount > 0 ? '1' : '0'}
              data-testid="workspace-nav-ia-folders"
            >
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              文件夹 {readiness.folderCount}
              {readiness.folderCount > 0 ? ' · 已打开' : ' · 请添加本地目录'}
            </li>
            <li data-ok={readiness.taskCount > 0 ? '1' : '0'} data-testid="workspace-nav-ia-tasks">
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              任务 {readiness.taskCount}
              {readiness.taskCount > 0 ? ' · 可切换' : ' · 可在文件夹下新建'}
            </li>
            <li
              data-ok={readiness.nestedTaskCount > 0 ? '1' : '0'}
              data-testid="workspace-nav-ia-nested"
            >
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              嵌套子任务 {readiness.nestedTaskCount}
              {readiness.nestedTaskCount > 0 ? ' · 显式跨任务' : ' · 可选'}
            </li>
            <li data-ok={readiness.hasActiveTask ? '1' : '0'} data-testid="workspace-nav-ia-active">
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              当前任务 {readiness.hasActiveTask ? '已选' : '未选'}
            </li>
            <li data-ok={readiness.runtimeOk ? '1' : '0'} data-testid="workspace-nav-ia-runtime">
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              Runtime {readiness.connectionLabel}
            </li>
            <li data-ok={readiness.queryActive ? '1' : '0'} data-testid="workspace-nav-ia-filter">
              <span className="st-workspace-nav__ia-dot" aria-hidden="true" />
              筛选 {readiness.queryActive ? '进行中' : '未用'}
            </li>
          </ul>
          <p className="st-workspace-nav__ia-note" data-testid="workspace-nav-ia-note">
            {readiness.note}
          </p>
        </div>
      )}

      {props.hideFooter ? null : (
        <footer className="st-workspace-nav__footer" data-testid="workspace-nav-footer">
          <span
            className="st-workspace-nav__runtime-dot"
            data-state={props.connectionState ?? 'preview'}
            aria-hidden="true"
          />
          <span className="st-workspace-nav__footer-text">
            <strong data-testid="workspace-nav-footer-label">
              {props.footerLabel ?? '本地 Runtime'}
            </strong>
            <small data-testid="workspace-nav-footer-detail">
              {props.footerDetail ?? connectionCopy(props.connectionState)}
            </small>
          </span>
          {props.footerExtra}
        </footer>
      )}
    </div>
  );
}
