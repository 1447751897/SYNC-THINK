import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDashed,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  ListTodo,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Search,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type { GoalStatus, RunProcessView } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import type {
  ProjectGitChange,
  ProjectGitCheckoutResult,
  ProjectGitInfo,
} from '../../project-git-contract.js';
import type { TodoProjection } from './todo-projection.js';

function statusBridge() {
  return window.syncThink?.runtime;
}

function formatElapsed(startedAt: string): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return '0m';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function StatusDialog({
  title,
  closeLabel,
  onClose,
  children,
  footer,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="shell-task-status-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="shell-task-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="shell-task-status-dialog__header">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <X size={15} />
          </button>
        </header>
        <div className="shell-task-status-dialog__body">{children}</div>
        {footer ? <footer className="shell-task-status-dialog__footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

function StatusSection({
  id,
  title,
  trailing,
  open,
  onToggle,
  children,
}: {
  id: 'git' | 'goal' | 'progress';
  title: string;
  trailing?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="shell-task-status__section"
      data-section={id}
      data-testid="task-status-section"
    >
      <div className="shell-task-status__section-header">
        <button
          type="button"
          className="shell-task-status__section-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`task-status-${id}`}
        >
          <span>{title}</span>
          <ChevronDown size={14} className={open ? 'is-open' : undefined} aria-hidden="true" />
        </button>
        {trailing ? <div className="shell-task-status__section-trailing">{trailing}</div> : null}
      </div>
      {open ? (
        <div id={`task-status-${id}`} className="shell-task-status__section-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function DirtyCheckoutDialog({
  branch,
  changes,
  busy,
  onCancel,
  onConfirm,
}: {
  branch: string;
  changes: readonly ProjectGitChange[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <StatusDialog
      title="切换分支"
      closeLabel="关闭切换分支"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="is-quiet" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="is-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle size={14} className="shell-process-spin" /> : null}
            Stash 并切换
          </button>
        </>
      }
    >
      <p className="shell-task-status-dialog__message">
        当前有 {changes.length} 个未提交变更。保存到 stash 后切换到 <strong>{branch}</strong>。
      </p>
    </StatusDialog>
  );
}

function CommitDialog({
  info,
  busy,
  error,
  onClose,
  onCommit,
  onPush,
}: {
  info: ProjectGitInfo;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onCommit: (input: { message: string; includeUnstaged: boolean; push: boolean }) => void;
  onPush: () => void;
}) {
  const [message, setMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  return (
    <StatusDialog
      title="提交更改"
      closeLabel="关闭提交更改"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="is-quiet"
            onClick={onPush}
            disabled={busy || !info.hasRemote}
          >
            推送
          </button>
          <button
            type="button"
            onClick={() => onCommit({ message, includeUnstaged, push: false })}
            disabled={busy || !message.trim()}
          >
            提交
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => onCommit({ message, includeUnstaged, push: true })}
            disabled={busy || !message.trim() || !info.hasRemote}
          >
            提交并推送
          </button>
        </>
      }
    >
      <div className="shell-task-status-dialog__branch-summary">
        <GitBranch size={14} />
        <span>{info.branch}</span>
        <span className="shell-task-status__git-stats">
          <strong>+{info.additions}</strong>
          <strong>-{info.deletions}</strong>
        </span>
      </div>
      <label className="shell-task-status-dialog__field">
        <span>提交信息</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          autoFocus
        />
      </label>
      <label className="shell-task-status-dialog__checkbox">
        <input
          type="checkbox"
          checked={includeUnstaged}
          onChange={(event) => setIncludeUnstaged(event.target.checked)}
        />
        <span>包含未暂存更改</span>
      </label>
      {error ? <div className="shell-task-status__error">{error}</div> : null}
    </StatusDialog>
  );
}

function GitToolsSection({
  projectFolder,
  info,
  refresh,
  onOpenReview,
}: {
  projectFolder: string;
  info: ProjectGitInfo;
  refresh: () => Promise<void>;
  onOpenReview?: (view: RunProcessView) => void;
}) {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [pendingCheckout, setPendingCheckout] = useState<{
    branch: string;
    changes: ProjectGitChange[];
  }>();
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState<string>();
  const branchButtonRef = useRef<HTMLButtonElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const [branchMenuStyle, setBranchMenuStyle] = useState<CSSProperties>();

  const positionBranchMenu = useCallback(() => {
    const anchor = branchButtonRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(288, Math.max(0, window.innerWidth - 16));
    const gap = 8;
    const padding = 8;
    const left =
      rect.left - gap - width >= padding
        ? rect.left - gap - width
        : Math.min(window.innerWidth - width - padding, rect.right + gap);
    setBranchMenuStyle({
      left: Math.max(padding, left),
      top: Math.max(padding, Math.min(rect.top, window.innerHeight - 456 - padding)),
      width,
      maxHeight: Math.max(220, window.innerHeight - padding * 2),
    });
  }, []);

  useLayoutEffect(() => {
    if (!branchMenuOpen) return;
    positionBranchMenu();
    window.addEventListener('resize', positionBranchMenu);
    window.addEventListener('scroll', positionBranchMenu, true);
    return () => {
      window.removeEventListener('resize', positionBranchMenu);
      window.removeEventListener('scroll', positionBranchMenu, true);
    };
  }, [branchMenuOpen, positionBranchMenu]);

  useEffect(() => {
    if (!branchMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (branchButtonRef.current?.contains(target) || branchMenuRef.current?.contains(target))
        return;
      setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [branchMenuOpen]);

  const openReview = useCallback(async () => {
    const api = statusBridge();
    if (!api?.getGitReview || !onOpenReview || reviewBusy) return;
    setReviewBusy(true);
    setError(undefined);
    try {
      const review = await api.getGitReview({ root: projectFolder });
      onOpenReview({
        runId: `git-worktree:${projectFolder}` as RunId,
        steps: [],
        fileChanges: review.files,
        running: false,
        doneCount: 0,
        errorCount: 0,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取工作区更改失败');
    } finally {
      setReviewBusy(false);
    }
  }, [onOpenReview, projectFolder, reviewBusy]);

  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLocaleLowerCase();
    return query
      ? info.branches.filter((branch) => branch.toLocaleLowerCase().includes(query))
      : info.branches;
  }, [branchSearch, info.branches]);

  const checkout = useCallback(
    async (branch: string, strategy: 'check' | 'stash') => {
      const api = statusBridge();
      if (!api?.gitCheckout) return;
      setBusy(true);
      setError(undefined);
      try {
        const result: ProjectGitCheckoutResult = await api.gitCheckout({
          root: projectFolder,
          branch,
          strategy,
        });
        if (result.ok) {
          setPendingCheckout(undefined);
          setBranchMenuOpen(false);
          await refresh();
        } else if (result.dirty && strategy === 'check') {
          setPendingCheckout({ branch, changes: result.changes });
          setBranchMenuOpen(false);
        } else {
          setError(result.error ?? '切换失败');
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '切换失败');
      } finally {
        setBusy(false);
      }
    },
    [projectFolder, refresh],
  );

  const createBranch = useCallback(async () => {
    const api = statusBridge();
    const branch = newBranch.trim();
    if (!api?.gitCreateBranch || !branch) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.gitCreateBranch({ root: projectFolder, branch });
      if (!result.ok) setError(result.error ?? '创建分支失败');
      else {
        setNewBranch('');
        setBranchMenuOpen(false);
        await refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建分支失败');
    } finally {
      setBusy(false);
    }
  }, [newBranch, projectFolder, refresh]);

  const commit = useCallback(
    async (input: { message: string; includeUnstaged: boolean; push: boolean }) => {
      const api = statusBridge();
      if (!api?.gitCommit) return;
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.gitCommit({ root: projectFolder, ...input });
        if (!result.ok) setError(result.error ?? '提交失败');
        else {
          setCommitOpen(false);
          await refresh();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '提交失败');
      } finally {
        setBusy(false);
      }
    },
    [projectFolder, refresh],
  );

  const push = useCallback(async () => {
    const api = statusBridge();
    if (!api?.gitPush) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.gitPush({ root: projectFolder });
      if (!result.ok) setError(result.error ?? '推送失败');
      else {
        setCommitOpen(false);
        await refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '推送失败');
    } finally {
      setBusy(false);
    }
  }, [projectFolder, refresh]);

  return (
    <>
      <div className="shell-task-status__git-rows">
        <button
          type="button"
          className="shell-task-status__row"
          onClick={() => void openReview()}
          disabled={!onOpenReview || info.changes.length === 0 || reviewBusy}
          aria-label={`更改 +${info.additions} -${info.deletions}`}
        >
          {reviewBusy ? (
            <LoaderCircle size={15} className="shell-process-spin" />
          ) : (
            <FileDiff size={15} />
          )}
          <span>更改</span>
          <span className="shell-task-status__git-stats shell-task-status__row-tail">
            <strong>+{info.additions}</strong>
            <strong>-{info.deletions}</strong>
          </span>
        </button>
        <div className="shell-task-status__branch-anchor">
          <button
            ref={branchButtonRef}
            type="button"
            className="shell-task-status__row"
            onClick={() => setBranchMenuOpen((open) => !open)}
            aria-expanded={branchMenuOpen}
          >
            <GitBranch size={15} />
            <span>{info.branch ?? 'Detached HEAD'}</span>
            <ChevronDown size={13} className="shell-task-status__row-chevron" />
          </button>
          {branchMenuOpen && branchMenuStyle && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={branchMenuRef}
                  className="shell-task-status__branch-menu"
                  style={branchMenuStyle}
                  role="menu"
                  aria-label="Git 分支"
                >
                  <label className="shell-task-status__branch-search">
                    <Search size={13} />
                    <input
                      value={branchSearch}
                      onChange={(event) => setBranchSearch(event.target.value)}
                      placeholder="搜索分支"
                      aria-label="搜索分支"
                    />
                  </label>
                  <div className="shell-task-status__branch-list">
                    {filteredBranches.map((branch) => (
                      <button
                        key={branch}
                        type="button"
                        role="menuitem"
                        className={branch === info.branch ? 'is-active' : undefined}
                        onClick={() => void checkout(branch, 'check')}
                        disabled={busy || branch === info.branch}
                      >
                        <GitBranch size={13} />
                        <span>{branch}</span>
                        {branch === info.branch ? <Check size={13} /> : null}
                      </button>
                    ))}
                  </div>
                  <div className="shell-task-status__branch-create">
                    <input
                      value={newBranch}
                      onChange={(event) => setNewBranch(event.target.value)}
                      placeholder="新建分支"
                      aria-label="新建分支"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void createBranch();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void createBranch()}
                      disabled={busy || !newBranch.trim()}
                    >
                      创建
                    </button>
                  </div>
                  <div className="shell-task-status__git-graph">
                    <div className="shell-task-status__git-graph-title">
                      <GitPullRequestArrow size={13} /> Git 图谱
                    </div>
                    {info.recentCommits.slice(0, 4).map((commit) => (
                      <div key={commit.hash} className="shell-task-status__commit-row">
                        <code>{commit.hash}</code>
                        <span>{commit.subject}</span>
                      </div>
                    ))}
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>
        <button
          type="button"
          className="shell-task-status__row"
          onClick={() => setCommitOpen(true)}
        >
          <GitCommitHorizontal size={15} />
          <span>提交 / 推送</span>
          {info.ahead > 0 ? (
            <span className="shell-task-status__row-tail">↑{info.ahead}</span>
          ) : (
            <MoreHorizontal size={14} className="shell-task-status__row-tail" />
          )}
        </button>
      </div>
      {error && !commitOpen ? <div className="shell-task-status__error">{error}</div> : null}
      {commitOpen ? (
        <CommitDialog
          info={info}
          busy={busy}
          error={error}
          onClose={() => {
            setCommitOpen(false);
            setError(undefined);
          }}
          onCommit={(input) => void commit(input)}
          onPush={() => void push()}
        />
      ) : null}
      {pendingCheckout ? (
        <DirtyCheckoutDialog
          branch={pendingCheckout.branch}
          changes={pendingCheckout.changes}
          busy={busy}
          onCancel={() => setPendingCheckout(undefined)}
          onConfirm={() => void checkout(pendingCheckout.branch, 'stash')}
        />
      ) : null}
    </>
  );
}

function GoalSection({
  goal,
  evaluatorConfigured,
  todo,
  onPause,
  onResume,
  onEdit,
  onClear,
}: {
  goal: GoalStatus;
  evaluatorConfigured: boolean;
  todo?: TodoProjection | null;
  onPause?: () => void;
  onResume?: () => void;
  onEdit?: () => void;
  onClear?: () => void;
}) {
  const roundsStarted = goal.roundsStarted ?? 0;
  const maxRounds = goal.maxGoalRounds ?? 5;
  const complete = goal.status === 'achieved';
  return (
    <div className="shell-task-status__goal">
      <div className="shell-task-status__goal-row">
        <span
          className="shell-task-status__goal-index"
          data-complete={complete ? 'true' : undefined}
        >
          {complete ? <Check size={13} /> : Math.max(1, roundsStarted || 1)}
        </span>
        <div className="shell-task-status__goal-copy">
          <strong>{goal.condition}</strong>
          <span>
            {roundsStarted}/{maxRounds} · {formatElapsed(goal.startedAt)}
            {todo ? ` · ${todo.completed}/${todo.total}` : ''}
          </span>
        </div>
      </div>
      {!evaluatorConfigured ? (
        <div className="shell-task-status__goal-note">评估模型未配置</div>
      ) : null}
      {goal.blockedReason || goal.lastReason ? (
        <div className="shell-task-status__goal-reason">
          {goal.blockedReason ?? goal.lastReason}
        </div>
      ) : null}
      <div className="shell-task-status__goal-actions">
        {goal.status === 'active' && onPause ? (
          <button type="button" onClick={onPause} title="暂停目标" aria-label="暂停目标">
            <Pause size={13} />
          </button>
        ) : (goal.status === 'paused' || goal.status === 'blocked') && onResume ? (
          <button type="button" onClick={onResume} title="继续目标" aria-label="继续目标">
            <Play size={13} />
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" onClick={onEdit} title="编辑目标" aria-label="编辑目标">
            <Pencil size={13} />
          </button>
        ) : null}
        {onClear ? (
          <button type="button" onClick={onClear} title="清空目标" aria-label="清空目标">
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProgressFold({
  side,
  items,
}: {
  side: 'before' | 'after';
  items: TodoProjection['items'];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const label =
    side === 'before'
      ? items.every((item) => item.status === 'completed')
        ? `已完成 ${items.length} 项`
        : `前面 ${items.length} 项`
      : items.every((item) => item.status === 'pending')
        ? `待处理 ${items.length} 项`
        : `后面 ${items.length} 项`;
  return (
    <div
      className="shell-task-status__progress-fold"
      data-testid={`task-progress-fold-${side}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button type="button" aria-label={label}>
        <ListTodo size={14} />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="shell-task-status__progress-popover" role="tooltip">
          {items.map((item) => (
            <div key={item.title}>{item.title}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function progressWindow(todo: TodoProjection): {
  before: TodoProjection['items'];
  visible: TodoProjection['items'];
  after: TodoProjection['items'];
} {
  if (todo.items.length <= 6) return { before: [], visible: todo.items, after: [] };
  let focus = todo.items.findIndex((item) => item.status === 'in_progress');
  if (focus < 0) focus = todo.items.findIndex((item) => item.status !== 'completed');
  if (focus < 0) focus = todo.items.length - 1;
  const start = Math.min(todo.items.length - 3, Math.max(0, focus - 1));
  return {
    before: todo.items.slice(0, start),
    visible: todo.items.slice(start, start + 3),
    after: todo.items.slice(start + 3),
  };
}

function ProgressSection({ todo }: { todo: TodoProjection }) {
  const windowed = useMemo(() => progressWindow(todo), [todo]);
  return (
    <div className="shell-task-status__progress">
      <ProgressFold side="before" items={windowed.before} />
      {windowed.visible.map((item) => (
        <div
          key={item.title}
          className="shell-task-status__progress-row"
          data-status={item.status}
          data-testid="task-progress-item"
        >
          <span className="shell-task-status__progress-icon">
            {item.status === 'completed' ? (
              <CircleCheck size={14} />
            ) : item.status === 'in_progress' ? (
              <CircleDashed size={14} className="shell-process-spin" />
            ) : (
              <Circle size={13} />
            )}
          </span>
          <span className={item.status === 'completed' ? 'is-completed' : undefined}>
            {item.title}
          </span>
        </div>
      ))}
      <ProgressFold side="after" items={windowed.after} />
    </div>
  );
}

function goalStateLabel(goal: GoalStatus): string {
  if (goal.status === 'achieved') return '已完成';
  if (goal.status === 'paused') return '已暂停';
  if (goal.status === 'blocked') return '已阻塞';
  return formatElapsed(goal.startedAt);
}

export function TaskStatusPanel({
  projectFolder,
  goal,
  evaluatorConfigured = false,
  todo,
  onGoalPause,
  onGoalResume,
  onGoalEdit,
  onGoalClear,
  onOpenReview,
}: {
  projectFolder?: string;
  goal?: GoalStatus;
  evaluatorConfigured?: boolean;
  todo?: TodoProjection | null;
  onGoalPause?: () => void;
  onGoalResume?: () => void;
  onGoalEdit?: () => void;
  onGoalClear?: () => void;
  onOpenReview?: (view: RunProcessView) => void;
}) {
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo>();
  const [manualOpen, setManualOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ git: true, goal: true, progress: true });
  const gitLoadGenerationRef = useRef(0);

  const refreshGit = useCallback(async () => {
    const api = statusBridge();
    const root = projectFolder?.trim();
    const generation = (gitLoadGenerationRef.current += 1);
    if (!root || !api?.getGitInfo) {
      setGitInfo(undefined);
      return;
    }
    try {
      const next = await api.getGitInfo({ root });
      if (gitLoadGenerationRef.current === generation) setGitInfo(next);
    } catch {
      if (gitLoadGenerationRef.current === generation) setGitInfo(undefined);
    }
  }, [projectFolder]);

  useEffect(() => {
    void refreshGit();
    const interval = window.setInterval(() => void refreshGit(), 5_000);
    const onFocus = () => void refreshGit();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshGit]);

  const visibleGoal =
    goal && ['active', 'paused', 'blocked', 'achieved'].includes(goal.status) ? goal : undefined;
  const visibleTodo = todo && todo.items.length > 0 ? todo : undefined;
  const visibleGit = projectFolder && gitInfo?.isRepo ? gitInfo : undefined;
  if (!visibleGit && !visibleGoal && !visibleTodo) return null;

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const miniLabel = visibleTodo
    ? `${visibleTodo.completed}/${visibleTodo.total}`
    : visibleGoal
      ? goalStateLabel(visibleGoal)
      : `${visibleGit?.changes.length ?? 0}`;
  const currentTodo = visibleTodo?.items.find((item) => item.status === 'in_progress');
  const activeGoal =
    visibleGoal && ['active', 'paused', 'blocked'].includes(visibleGoal.status)
      ? visibleGoal
      : undefined;
  const miniKind = currentTodo
    ? 'progress'
    : activeGoal
      ? 'goal'
      : visibleGit && visibleGit.changes.length > 0
        ? 'changes'
        : visibleGoal
          ? 'goal'
          : 'progress';

  return (
    <div className="shell-task-status-host" data-testid="task-status-host">
      <button
        type="button"
        className="shell-task-status-mini"
        onClick={() => setManualOpen(true)}
        aria-label="打开任务状态"
        title="任务状态"
      >
        {miniKind === 'changes' ? (
          <FileDiff size={15} />
        ) : miniKind === 'goal' ? (
          <Target size={15} />
        ) : currentTodo ? (
          <CircleDashed size={15} className="shell-process-spin" />
        ) : (
          <ListTodo size={15} />
        )}
        <span className="shell-task-status-mini__label">
          {miniKind === 'changes'
            ? '更改'
            : currentTodo?.title || activeGoal?.condition || miniLabel}
        </span>
        {miniKind === 'changes' && visibleGit ? (
          <span className="shell-task-status__git-stats">
            <strong>+{visibleGit.additions}</strong>
            <strong>-{visibleGit.deletions}</strong>
          </span>
        ) : null}
      </button>
      <aside
        className="shell-task-status-panel"
        data-manual-open={manualOpen ? 'true' : undefined}
        data-testid="task-status-panel"
        data-theme-surface="semantic"
        aria-label="任务状态"
      >
        <button
          type="button"
          className="shell-task-status-panel__close"
          onClick={() => setManualOpen(false)}
          aria-label="关闭任务状态"
          title="关闭"
        >
          <X size={14} />
        </button>
        {visibleGit ? (
          <StatusSection
            id="git"
            title="Git 工具"
            open={openSections.git}
            onToggle={() => toggleSection('git')}
            trailing={
              <span className="shell-task-status__git-stats">
                <strong>+{visibleGit.additions}</strong>
                <strong>-{visibleGit.deletions}</strong>
              </span>
            }
          >
            <GitToolsSection
              projectFolder={projectFolder!}
              info={visibleGit}
              refresh={refreshGit}
              onOpenReview={onOpenReview}
            />
          </StatusSection>
        ) : null}
        {visibleGoal ? (
          <StatusSection
            id="goal"
            title="目标"
            open={openSections.goal}
            onToggle={() => toggleSection('goal')}
            trailing={
              <span className="shell-task-status__goal-state" data-status={visibleGoal.status}>
                {visibleGoal.status === 'blocked' ? <AlertCircle size={12} /> : null}
                {goalStateLabel(visibleGoal)}
              </span>
            }
          >
            <GoalSection
              goal={visibleGoal}
              evaluatorConfigured={evaluatorConfigured}
              todo={visibleTodo}
              onPause={onGoalPause}
              onResume={onGoalResume}
              onEdit={onGoalEdit}
              onClear={onGoalClear}
            />
          </StatusSection>
        ) : null}
        {visibleTodo ? (
          <StatusSection
            id="progress"
            title="进程"
            open={openSections.progress}
            onToggle={() => toggleSection('progress')}
            trailing={
              <span className="shell-task-status__progress-count">
                {visibleTodo.completed}/{visibleTodo.total}
              </span>
            }
          >
            <ProgressSection todo={visibleTodo} />
          </StatusSection>
        ) : null}
      </aside>
    </div>
  );
}
