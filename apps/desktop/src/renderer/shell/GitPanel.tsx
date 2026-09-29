import { invalidateGitRepository, subscribeGitRepository } from './git-repository-events.js';
import type { GitPanelSection } from './ComposerGitBar.js';
/**
 * Git 面板。
 *
 * 结构与文案对齐 NewMax 的 Git 工具（见 docs/newmax-git/SPEC.md 与 i18n.json）：
 * - 顶部横幅：当前分支 / 游离 HEAD / 领先落后 / 未提交计数 / 进行中的操作
 * - 两个 Tab：改动（按路径合并，勾选表示暂存）与历史
 * - 固定提交区：标题 + 描述，仅提交 Git 暂存区中的文件
 * - 同步区：推送 / 拉取 / 获取
 *
 * 配色只用 shell 既有的 `--color-*` 令牌——SYNC-THINK 的令牌本就是从 NewMax
 * 的 `--ds-*` 对齐而来，因此暗色下即等价于 NewMax 的配色，无需另立变量体系。
 */
import {
  Search,
  X,
  Folder,
  Download,
  Circle,
  CircleCheck,
  CircleMinus,
  Check,
  ChevronDown,
  CircleAlert,
  FileDiff,
  GitBranch,
  GitMerge,
  History,
  Trash2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Undo2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  GitActionResult,
  GitBranch as GitBranchInfo,
  GitChangedSummary,
  GitCheckoutResult,
  GitFileChange,
  GitLogEntry,
  GitOperation,
  GitStatus,
  GitWorktree,
} from '../../git-contract.js';
import { LineDiffView } from './ExecutionProcessBlock.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { GitIdentityMenu } from './GitIdentityMenu.js';
import { SlidingTabs } from './SlidingTabs.js';

/** 面板可见文案，集中在一处便于与 NewMax 的 i18n 对照维护。 */
const TEXT = {
  tabChanges: '改动',
  tabHistory: '历史',
  sectionConflicted: '冲突',
  sectionStaged: '已暂存',
  sectionChanges: '变动',
  sectionUntracked: '未跟踪',
  stage: '暂存',
  unstage: '取消暂存',
  stageAll: '全部暂存',
  unstageAll: '全部取消暂存',
  discard: '丢弃',
  discardAll: '全部丢弃',
  discardConfirmTitle: '丢弃改动',
  discardConfirm: '丢弃',
  discardCancel: '取消',
  commit: '提交',
  commitWithCount: (count: number) => `提交 ${count} 个文件`,
  stageAllAndCommit: '全部暂存并提交',
  summaryPlaceholder: '提交标题（必填）',
  descriptionPlaceholder: '描述（可选）',
  commitTo: (branch: string) => `提交到 ${branch}`,
  commitNothingStaged: '没有已暂存的更改',
  push: '推送',
  pull: '拉取',
  fetch: '获取',
  fetching: '正在获取…',
  pulling: '正在拉取…',
  pushing: '正在推送…',
  refresh: '刷新',
  uncommitted: (count: number) => `${count} 个未提交`,
  viewUncommitted: '查看未提交改动',
  detached: '游离 HEAD',
  detachedFrom: (branch: string, sha: string) => `基于 ${branch} 的游离 HEAD · ${sha}`,
  aheadBehind: (ahead: number, behind: number) => `领先远程 ${ahead} 个提交，落后 ${behind} 个提交`,
  operation: {
    merge: '合并中',
    rebase: '变基中',
    'cherry-pick': '拣选中',
    revert: '回退中',
    bisect: '二分查找中',
  } as Record<GitOperation, string>,
  kinds: {
    modified: '已修改',
    added: '新增',
    deleted: '已删除',
    renamed: '重命名',
    untracked: '未跟踪',
    conflicted: '冲突',
  } as Record<GitFileChange['kind'], string>,
  branchTitle: (branch: string) => `当前分支 ${branch}`,
  newBranch: '新建分支…',
  searchBranch: '搜索分支',
  groupDefault: '默认分支',
  groupRecent: '最近分支',
  groupOther: '其他分支',
  branchEmpty: '没有匹配的分支',
  dirtyTitle: '有改动会被目标分支覆盖',
  dirtyDescription: (branch: string, count: number) =>
    `切换到 ${branch} 会覆盖以下 ${count} 个文件的未提交改动。可以先暂存（git stash）再切换，切换完成后自动恢复到新分支上。`,
  dirtyMoreFiles: (count: number) => `…等 ${count} 个文件`,
  stashAndSwitch: '暂存改动并切换',
  cancel: '取消',
  stashPopConflict: (branch: string) =>
    `已切换到 ${branch}，但恢复暂存的改动时发生冲突，改动仍保留在 git stash 里，请在终端执行 git stash pop 处理。`,
  switched: (branch: string) => `已切换到 ${branch}`,
  noHistory: '还没有提交记录',
  loadingDiff: '正在读取差异…',
  emptyTitle: '没有未提交的改动',
  emptyHint: '修改文件后，这里会显示改动清单与行级差异。',
  undoCommit: '撤销上次提交',
  openTerminal: '在终端打开',
  failed: '操作失败',
  // ── 合并（NewMax merge* 分组）──
  mergeConflictsTitle: (branch: string) => `解决冲突后再合并到 ${branch}`,
  mergeConflictsDescription: '合并停在了冲突上，解决下列文件里的冲突后提交合并。',
  conflictCount: (count: number) => `${count} 处冲突`,
  conflictResolved: '已解决',
  conflictManual: '需手动处理',
  commitMerge: '提交合并',
  abortMerge: '放弃合并',
  abortMergeSuccess: '已放弃合并，回到合并前的状态',
  mergeCommitSuccess: (branch: string) => `已合并到 ${branch}`,
  mergeBannerConflicts: (branch: string) => `合并有冲突：解决后提交即可合并到 ${branch}`,
  mergeBannerResolved: (branch: string) => `冲突已解决，提交即可完成合并到 ${branch}`,
  commitMergeConflicts: '还有未解决的冲突，解决后才能提交合并',
  mergeInto: (branch: string) => `选择分支合并到 ${branch}…`,
  // ── worktree（NewMax worktree 分组）──
  worktreeHeader: '工作在',
  worktreeLocal: '本地 worktree',
  worktreeLocalHint: (repo: string) => `直接在 ${repo} 里工作`,
  worktreeCreate: '新建本地 worktree',
  worktreeRemove: '移除这个 worktree…',
  worktreeRemoveTitle: '移除 worktree',
  worktreeRemoveDescription: (path: string) =>
    `会删除目录 ${path} 并从工作区列表移除；主工作区不受影响。`,
  worktreeRemoveDirty: (count: number) => `这棵树里还有 ${count} 个未提交改动，移除后会丢失。`,
  worktreeRemoveDeleteBranch: (branch: string) => `同时删除分支 ${branch}（未合并的提交会丢失）`,
  worktreeRemoveConfirm: '移除',
  worktreeRemoved: (name: string) => `已移除 worktree ${name}`,
  worktreeCreateFailed: '创建 worktree 失败',
  worktreeCreateHint: (name: string) => `已开出新的 worktree：${name}`,
  worktreeRemoveFailed: '移除 worktree 失败',
  worktreeLoadFailed: '读取 worktree 失败',
  // ── 丢弃（NewMax discard* 分组）──
  discardTitle: (count: number) => `丢弃 ${count} 个文件的改动？`,
  discardDescription:
    '已修改的文件会恢复到最近一次提交（已暂存的恢复到暂存内容），未跟踪的文件会被删除。此操作无法撤销。',
} as const;

function bridge() {
  return window.syncThink?.runtime;
}

function operationLabel(operation: GitOperation | null): string | null {
  return operation ? (TEXT.operation[operation] ?? null) : null;
}

// ─── 分支菜单 ────────────────────────────────────────────────────────────────

interface BranchMenuProps {
  branches: readonly GitBranchInfo[];
  current: string | null;
  onSelect(branch: string): void;
  onCreate(name: string): void;
  /** 把某分支合并进当前分支（NewMax `mergeInto`）。 */
  onMerge(branch: string): void;
  busy: boolean;
}

function BranchMenu({ branches, current, onSelect, onCreate, onMerge, busy }: BranchMenuProps) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) => branch.name.toLocaleLowerCase().includes(needle));
  }, [branches, query]);

  const groups: Array<[string, GitBranchInfo[]]> = [
    [TEXT.groupDefault, filtered.filter((branch) => branch.group === 'default')],
    [TEXT.groupRecent, filtered.filter((branch) => branch.group === 'recent')],
    [TEXT.groupOther, filtered.filter((branch) => branch.group === 'other')],
  ];

  return (
    <div className="shell-git__branch-menu" role="menu" aria-label="Git 分支">
      <label className="shell-git__branch-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={TEXT.searchBranch}
          aria-label={TEXT.searchBranch}
          autoFocus
        />
      </label>
      <div className="shell-git__branch-list">
        {filtered.length === 0 ? (
          <p className="shell-git__hint">{TEXT.branchEmpty}</p>
        ) : (
          groups.map(([label, items]) =>
            items.length === 0 ? null : (
              <div key={label} className="shell-git__branch-group">
                <p className="shell-git__branch-group-label">{label}</p>
                {items.map((branch) => (
                  <button
                    key={branch.name}
                    type="button"
                    role="menuitem"
                    className={clsx(
                      'shell-git__branch-item',
                      branch.name === current && 'is-active',
                    )}
                    disabled={busy || branch.name === current}
                    onClick={() => onSelect(branch.name)}
                  >
                    <GitBranch size={13} aria-hidden="true" />
                    <span className="shell-git__branch-name">{branch.name}</span>
                    {branch.name === current ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                ))}
                {/* 非当前分支同时提供「合并到当前分支」入口 */}
                {items
                  .filter((branch) => branch.name !== current)
                  .map((branch) => (
                    <button
                      key={`merge:${branch.name}`}
                      type="button"
                      role="menuitem"
                      className="shell-git__branch-item is-merge"
                      disabled={busy}
                      onClick={() => onMerge(branch.name)}
                    >
                      <GitMerge size={13} aria-hidden="true" />
                      <span className="shell-git__branch-name">合并 {branch.name} 到当前分支</span>
                    </button>
                  ))}
              </div>
            ),
          )
        )}
      </div>
      <div className="shell-git__branch-create">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={TEXT.newBranch}
          aria-label={TEXT.newBranch}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) onCreate(draft.trim());
            if (event.key === 'Escape') setDraft('');
          }}
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => draft.trim() && onCreate(draft.trim())}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ─── 文件行 ──────────────────────────────────────────────────────────────────

// ─── 主面板 ──────────────────────────────────────────────────────────────────

export interface GitPanelProps {
  /** 项目文件夹绝对路径。 */
  projectFolder: string;
  request?: { section: GitPanelSection; revision: number };
  /** 打开某文件的完整 diff（由宿主决定用哪个 surface）。 */
  onOpenReview?: (file: GitFileChange) => void;
}

export function GitPanel(props: GitPanelProps) {
  return <RepositoryReview key={props.projectFolder} {...props} />;
}

function RepositoryReview({ projectFolder, request }: GitPanelProps) {
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [diffGroup, setDiffGroup] = useState<'staged' | 'unstaged'>('unstaged');
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<GitStatus>();
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [message, setMessage] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>();
  const [diff, setDiff] = useState<{ before?: string; after?: string; binary: boolean }>();
  const [diffBusy, setDiffBusy] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<{
    branch: string;
    files: GitFileChange[];
  }>();
  const [pendingDiscard, setPendingDiscard] = useState<GitFileChange[]>();
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [pendingWorktreeRemove, setPendingWorktreeRemove] = useState<GitWorktree>();
  const [deleteBranch, setDeleteBranch] = useState(false);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const api = bridge();
    const root = projectFolder.trim();
    if (!root || !api?.gitStatus) return;
    const generation = (generationRef.current += 1);
    try {
      const next = await api.gitStatus({ root });
      if (generationRef.current !== generation) return;
      setStatus(next);
      setLoading(false);
      setError(undefined);
      if (api.gitBranches) {
        const list = await api.gitBranches({ root });
        if (generationRef.current !== generation) return;
        setBranches(list.branches);
        setCurrentBranch(list.current);
      }
    } catch (caught) {
      if (generationRef.current === generation) {
        setLoading(false);
        setError(caught instanceof Error ? caught.message : TEXT.failed);
      }
    }
  }, [projectFolder]);

  const refreshLog = useCallback(async () => {
    const api = bridge();
    const root = projectFolder.trim();
    if (!root || !api?.gitLog) return;
    try {
      const result = await api.gitLog({ root, limit: 30 });
      setLog(result.entries);
    } catch {
      setLog([]);
    }
  }, [projectFolder]);

  const refreshWorktrees = useCallback(async () => {
    const api = bridge();
    const root = projectFolder.trim();
    if (!root || !api?.gitWorktrees) return;
    try {
      const result = await api.gitWorktrees({ root });
      setWorktrees(result.worktrees);
    } catch {
      setWorktrees([]);
    }
  }, [projectFolder]);

  useEffect(() => {
    void refresh();
    void refreshLog();
    void refreshWorktrees();
  }, [refresh, refreshLog, refreshWorktrees]);

  useEffect(
    () =>
      subscribeGitRepository(projectFolder, () => {
        void refresh();
        void refreshLog();
      }),
    [projectFolder, refresh, refreshLog],
  );
  useEffect(() => {
    if (!request) return;
    if (request.section === 'branches') setMenuOpen(true);
    else if (request.section === 'worktrees') setWorktreesOpen(true);
    else {
      setTab('changes');
      setWorktreesOpen(false);
    }
  }, [request]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.shell-git__branch-anchor'))
        setMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [menuOpen]);

  const run = useCallback(
    async (
      action: () => Promise<GitActionResult | GitCheckoutResult>,
      options: { refreshLog?: boolean } = {},
    ) => {
      setBusy(true);
      setError(undefined);
      try {
        const result = await action();
        if (!result.ok && result.error) setError(result.error);
        invalidateGitRepository(projectFolder);
        await refresh();
        if (options.refreshLog) await refreshLog();
        return result;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : TEXT.failed);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [projectFolder, refresh, refreshLog],
  );

  // 选中文件后按需拉取 diff（避免一次性对全部文件取快照）。
  useEffect(() => {
    const api = bridge();
    const root = projectFolder.trim();
    if (!selectedPath || !root || !api?.gitFileDiff) {
      setDiff(undefined);
      return;
    }
    setDiffBusy(true);
    let cancelled = false;
    void api
      .gitFileDiff({ root, path: selectedPath, staged: diffGroup === 'staged' })
      .then((result) => {
        if (cancelled) return;
        if (result?.binary) setDiff({ binary: true });
        else setDiff({ before: result?.before, after: result?.after, binary: false });
      })
      .catch(() => {
        if (!cancelled) setDiff(undefined);
      })
      .finally(() => {
        if (!cancelled) setDiffBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, projectFolder, status, diffGroup]);

  const rows = useMemo(() => {
    const byPath = new Map<
      string,
      { file: GitFileChange; staged: boolean; unstaged: boolean; conflicted: boolean }
    >();
    for (const file of status?.files ?? []) {
      const row = byPath.get(file.path) ?? {
        file,
        staged: false,
        unstaged: false,
        conflicted: false,
      };
      if (file.group === 'staged') row.staged = true;
      else row.unstaged = true;
      if (file.group === 'conflicted') row.conflicted = true;
      if (file.group !== 'staged') row.file = file;
      byPath.set(file.path, row);
    }
    return [...byPath.values()];
  }, [status]);
  const filteredRows = rows.filter((row) =>
    row.file.path.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const stagedCount = rows.filter((row) => row.staged).length;
  const selectable = filteredRows.filter((row) => !row.conflicted);
  const allChecked =
    selectable.length > 0 && selectable.every((row) => row.staged && !row.unstaged);
  const anyChecked = selectable.some((row) => row.staged);
  const hasConflicts = rows.some((row) => row.conflicted);
  const togglePaths = (paths: string[], unstage: boolean) =>
    void run(async () => {
      const api = bridge();
      return (
        (unstage ? api?.gitUnstage : api?.gitStage)?.({ root: projectFolder, paths }) ?? {
          ok: false,
          error: TEXT.failed,
        }
      );
    });
  const operation = operationLabel(status?.operation ?? null);
  const root = projectFolder.trim();

  const switchBranch = async (branch: string, strategy: 'check' | 'stash') => {
    const api = bridge();
    if (!api?.gitCheckout) return;
    const result = await run(() => api.gitCheckout({ root, branch, strategy }));
    if (!result) return;
    const checkout = result as GitCheckoutResult;
    if (checkout.ok) {
      setMenuOpen(false);
      setPendingCheckout(undefined);
      if (checkout.stashConflict) setNotice(TEXT.stashPopConflict(branch));
      else setNotice(TEXT.switched(branch));
      await refreshLog();
      return;
    }
    if (checkout.dirty && strategy === 'check') {
      setPendingCheckout({ branch, files: checkout.files });
      setMenuOpen(false);
    }
  };

  /** 新建 worktree（NewMax `worktree.create`）：在仓库同级目录派生。 */
  const createWorktree = async () => {
    const api = bridge();
    if (!api?.gitAddWorktree) return;
    const base = worktrees[0]?.path ?? root;
    const parent = base.replace(/[\\/][^\\/]+$/, '');
    const name = `wt-${Date.now().toString(36)}`;
    const target = `${parent}/${name}`.replace(/\//g, base.includes('\\') ? '\\' : '/');
    await run(async () => {
      const result = await api.gitAddWorktree({ root, path: target, newBranch: name });
      if (result.ok) {
        setNotice(TEXT.worktreeCreateHint(name));
        await refreshWorktrees();
      }
      return result;
    });
  };

  /** 把指定分支合并进当前分支（NewMax `mergeInto`）。 */
  const mergeInto = async (branch: string) => {
    const api = bridge();
    if (!api?.gitMerge) return;
    setMenuOpen(false);
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.gitMerge({ root, branch });
      if (result.conflict) {
        // 冲突不回滚，转为冲突横幅（文案见 mergeBannerConflicts），无需额外通知。
        setNotice(undefined);
      } else if (!result.ok && result.error) {
        setError(result.error);
      } else {
        setNotice(TEXT.mergeCommitSuccess(branch));
      }
      await refresh();
      await refreshLog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.failed);
    } finally {
      setBusy(false);
    }
  };

  if (!status)
    return (
      <div className="shell-git shell-git--empty" data-testid="git-panel">
        {loading ? (
          <>
            <LoaderCircle size={18} className="shell-process-spin" />
            <p>正在读取仓库…</p>
          </>
        ) : (
          <>
            <p role="alert">{error || '读取仓库失败'}</p>
            <button
              className="shell-git__text-btn"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
            >
              重试
            </button>
          </>
        )}
      </div>
    );
  if (!status.isRepo) {
    return (
      <div className="shell-git shell-git--empty" data-testid="git-panel">
        <p className="shell-git__empty-title">这个文件夹还不是 Git 仓库</p>
        <p className="shell-git__hint">
          在终端执行 <code>git init</code> 后即可在这里查看改动。
        </p>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="shell-git shell-git--review" data-testid="git-panel">
      <div className="shell-git__review-tools">
        <strong>改动 {rows.length}</strong>
        <span>所有文件</span>
        <div className="shell-git__review-actions">
          <button
            type="button"
            className="shell-git__icon-btn"
            aria-label="搜索改动文件"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              setQuery('');
            }}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className="shell-git__icon-btn"
            aria-label="工作副本"
            aria-expanded={worktreesOpen}
            onClick={() => setWorktreesOpen((v) => !v)}
          >
            <Folder size={14} />
          </button>
          <button
            type="button"
            className="shell-git__icon-btn"
            aria-label={TEXT.push}
            title={TEXT.push}
            disabled={busy || !status.hasRemote}
            onClick={() =>
              void run(
                async () =>
                  (await bridge()?.gitPush?.({ root })) ?? { ok: false, error: TEXT.failed },
              )
            }
          >
            <Upload size={14} />
          </button>
          <button
            type="button"
            className="shell-git__icon-btn"
            aria-label={TEXT.pull}
            title={TEXT.pull}
            disabled={busy || !status.hasRemote}
            onClick={() =>
              void run(
                async () => {
                  const result = await bridge()?.gitPull?.({ root, strategy: 'stash' });
                  if (result?.stashConflict) setNotice('拉取完成，但恢复暂存内容时冲突。');
                  return result ?? { ok: false, error: TEXT.failed };
                },
                { refreshLog: true },
              )
            }
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            className="shell-git__icon-btn"
            aria-label={TEXT.refresh}
            disabled={busy}
            onClick={() => {
              invalidateGitRepository(root);
              void refresh();
              void refreshLog();
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {searchOpen ? (
        <label className="shell-git__filter">
          <Search size={13} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索改动文件"
            aria-label="搜索改动文件"
          />
          <button
            type="button"
            aria-label="关闭文件搜索"
            onClick={() => {
              setSearchOpen(false);
              setQuery('');
            }}
          >
            <X size={13} />
          </button>
        </label>
      ) : null}
      {/* 顶部横幅：NewMax banner */}
      <div className="shell-git__banner">
        <div className="shell-git__branch-anchor">
          <button
            type="button"
            className="shell-git__branch-trigger"
            aria-label={TEXT.branchTitle(status.branch ?? TEXT.detached)}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            title={
              status.detached
                ? status.detachedFrom
                  ? TEXT.detachedFrom(status.detachedFrom, status.detachedSha ?? '')
                  : TEXT.detached
                : TEXT.branchTitle(status.branch ?? '')
            }
          >
            <GitBranch size={14} aria-hidden="true" />
            <span className="shell-git__branch-label">
              <strong>{status.detached ? TEXT.detached : (status.branch ?? TEXT.detached)}</strong>
              <small>当前分支</small>
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <BranchMenu
              branches={branches}
              current={currentBranch}
              busy={busy}
              onSelect={(branch) => void switchBranch(branch, 'check')}
              onMerge={(branch) => void mergeInto(branch)}
              onCreate={(name) =>
                void run(async () => {
                  const api = bridge();
                  if (!api?.gitCreateBranch) return { ok: false, error: TEXT.failed };
                  const created = await api.gitCreateBranch({ root, branch: name });
                  if (created.ok) {
                    setMenuOpen(false);
                    await refreshLog();
                  }
                  return created;
                })
              }
            />
          ) : null}
        </div>
        <button
          type="button"
          className="shell-git__fetch"
          disabled={busy || !status.hasRemote}
          title={status.hasRemote ? '抓取远端分支信息' : '尚未配置远端'}
          onClick={() =>
            void run(
              async () =>
                (await bridge()?.gitFetch?.({ root })) ?? { ok: false, error: TEXT.failed },
            )
          }
        >
          <RefreshCw size={14} className={busy ? 'shell-process-spin' : ''} />
          <span>
            <strong>
              {status.hasRemote ? '抓取 ' + (status.remoteName || 'origin') : '未配置远端'}
            </strong>
            <small>
              {status.fetchedAt
                ? '上次抓取 ' + new Date(status.fetchedAt).toLocaleString()
                : '尚未抓取'}
            </small>
          </span>
        </button>
      </div>
      {operation || status.ahead || status.behind ? (
        <div className="shell-git__repository-state">
          {operation ? <span>{operation}</span> : null}
          {status.ahead || status.behind ? (
            <span>{TEXT.aheadBehind(status.ahead, status.behind)}</span>
          ) : null}
        </div>
      ) : null}

      {/* 两个 Tab：改动 / 历史 */}
      <SlidingTabs className="shell-git__tabs" aria-label="Git 审阅视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'changes'}
          className={clsx('shell-git__tab', tab === 'changes' && 'is-active')}
          onClick={() => setTab('changes')}
        >
          <FileDiff size={13} aria-hidden="true" />
          {TEXT.tabChanges}
          {status.changeCount > 0 ? (
            <span className="shell-git__tab-count">{status.changeCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={clsx('shell-git__tab', tab === 'history' && 'is-active')}
          onClick={() => setTab('history')}
        >
          <History size={13} aria-hidden="true" />
          {TEXT.tabHistory}
        </button>
      </SlidingTabs>

      {error ? (
        <div className="shell-git__alert" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {/* 合并横幅（NewMax mergeBannerConflicts / mergeBannerResolved） */}
      {status.merge?.merging ? (
        <div
          className={clsx(
            'shell-git__merge',
            status.merge.resolved ? 'is-resolved' : 'is-conflict',
          )}
          role="status"
        >
          <div className="shell-git__merge-text">
            <strong>
              {status.merge.resolved
                ? TEXT.mergeBannerResolved(status.merge.targetBranch ?? '')
                : TEXT.mergeBannerConflicts(status.merge.targetBranch ?? '')}
            </strong>
            {status.merge.conflicts.length > 0 ? (
              <span className="shell-git__merge-count">
                {TEXT.conflictCount(status.merge.conflicts.length)}
              </span>
            ) : null}
          </div>
          <div className="shell-git__merge-actions">
            <button
              type="button"
              className="shell-git__text-btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const api = bridge();
                  if (!api?.gitAbortMerge) return { ok: false, error: TEXT.failed };
                  const result = await api.gitAbortMerge({ root });
                  if (result.ok) setNotice(TEXT.abortMergeSuccess);
                  return result;
                })
              }
            >
              {TEXT.abortMerge}
            </button>
            <button
              type="button"
              className="shell-git__primary"
              disabled={busy || !status.merge.resolved}
              title={status.merge.resolved ? TEXT.commitMerge : TEXT.commitMergeConflicts}
              onClick={() =>
                void run(
                  async () => {
                    const api = bridge();
                    if (!api?.gitCommitMerge) return { ok: false, error: TEXT.failed };
                    const result = await api.gitCommitMerge({ root });
                    if (result.ok) {
                      setNotice(TEXT.mergeCommitSuccess(status.merge?.targetBranch ?? ''));
                    }
                    return result;
                  },
                  { refreshLog: true },
                )
              }
            >
              {TEXT.commitMerge}
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="shell-git__notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label={TEXT.cancel}>
            ×
          </button>
        </div>
      ) : null}

      <div key={tab} className={clsx('shell-git__tab-content', `shell-git__tab-content--${tab}`)} role="tabpanel" aria-label={tab === 'changes' ? TEXT.tabChanges : TEXT.tabHistory}>
      {tab === 'changes' ? (
        <>
          <div className="shell-git__selection-bar">
            <button
              type="button"
              role="checkbox"
              aria-label={allChecked ? '全部取消暂存' : '全部暂存'}
              aria-checked={allChecked ? true : anyChecked ? 'mixed' : false}
              disabled={busy || !selectable.length}
              className="shell-git__selection-all"
              onClick={() =>
                togglePaths(
                  selectable.map((row) => row.file.path),
                  allChecked,
                )
              }
            >
              {allChecked ? (
                <CircleCheck size={15} />
              ) : anyChecked ? (
                <CircleMinus size={15} />
              ) : (
                <Circle size={15} />
              )}
              <strong>全部</strong>
              <span>· {filteredRows.length} 个改动文件</span>
            </button>
            <span className="shell-git__staged-count">已选 {stagedCount}</span>
            <button
              type="button"
              className="shell-git__icon-btn"
              aria-label="丢弃未暂存改动"
              title="丢弃未暂存改动"
              disabled={busy || !filteredRows.some((row) => row.unstaged && !row.conflicted)}
              onClick={() =>
                setPendingDiscard(
                  filteredRows
                    .filter((row) => row.unstaged && !row.conflicted)
                    .map((row) => row.file),
                )
              }
            >
              <Undo2 size={13} />
            </button>
          </div>
          <div className="shell-git__body" data-testid="git-change-list">
            {status.changeCount === 0 ? (
              <div className="shell-git__empty">
                <CircleCheck size={24} />
                <p className="shell-git__empty-title">{TEXT.emptyTitle}</p>
                <p className="shell-git__hint">{TEXT.emptyHint}</p>
              </div>
            ) : !filteredRows.length ? (
              <p className="shell-git__hint">没有匹配的改动文件</p>
            ) : (
              filteredRows.map((row) => (
                <div
                  key={row.file.path}
                  className="shell-git__review-file"
                  data-path={row.file.path}
                >
                  <div
                    className={clsx(
                      'shell-git__review-row',
                      selectedPath === row.file.path && 'is-active',
                    )}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      className="shell-git__file-check"
                      aria-label={
                        (row.staged && !row.unstaged ? '取消暂存 ' : '暂存 ') + row.file.path
                      }
                      aria-checked={row.staged ? (row.unstaged ? 'mixed' : true) : false}
                      title={
                        row.conflicted
                          ? '请先解决冲突'
                          : row.staged && row.unstaged
                            ? '已部分暂存；点击暂存该文件其余改动'
                            : row.staged
                              ? '已暂存；点击取消暂存'
                              : '勾选以暂存文件'
                      }
                      disabled={busy || row.conflicted}
                      onClick={() => togglePaths([row.file.path], row.staged && !row.unstaged)}
                    >
                      {row.staged ? (
                        row.unstaged ? (
                          <CircleMinus size={15} />
                        ) : (
                          <CircleCheck size={15} />
                        )
                      ) : (
                        <Circle size={15} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="shell-git__review-path"
                      aria-label={row.file.path}
                      title={row.file.path}
                      aria-expanded={selectedPath === row.file.path}
                      onClick={() => {
                        setSelectedPath((current) =>
                          current === row.file.path ? undefined : row.file.path,
                        );
                        setDiffGroup(row.staged ? 'staged' : 'unstaged');
                      }}
                    >
                      <FileTypeIcon path={row.file.path} size={14} />
                      <span>
                        {row.file.path.includes('/') ? (
                          <em>{row.file.path.slice(0, row.file.path.lastIndexOf('/') + 1)}</em>
                        ) : null}
                        {row.file.path.split('/').at(-1)}
                      </span>
                    </button>
                    <span
                      className="shell-git__status-mark"
                      data-kind={row.file.kind}
                      title={TEXT.kinds[row.file.kind]}
                      aria-label={TEXT.kinds[row.file.kind]}
                    >
                      {row.conflicted
                        ? '!'
                        : row.file.kind === 'deleted'
                          ? '−'
                          : row.file.kind === 'untracked' || row.file.kind === 'added'
                            ? '+'
                            : row.file.kind === 'renamed'
                              ? 'R'
                              : 'M'}
                    </span>
                  </div>
                  {selectedPath === row.file.path ? (
                    <div className="shell-git__diff">
                      <div className="shell-git__diff-head">
                        <span>{row.file.path}</span>
                        <button
                          type="button"
                          aria-label="收起差异"
                          className="shell-git__icon-btn"
                          onClick={() => setSelectedPath(undefined)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {row.staged && row.unstaged ? (
                        <div className="shell-git__diff-switch">
                          <button
                            type="button"
                            aria-pressed={diffGroup === 'staged'}
                            onClick={() => setDiffGroup('staged')}
                          >
                            已暂存（本次提交）
                          </button>
                          <button
                            type="button"
                            aria-pressed={diffGroup === 'unstaged'}
                            onClick={() => setDiffGroup('unstaged')}
                          >
                            未暂存
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => togglePaths([row.file.path], true)}
                          >
                            取消该文件暂存
                          </button>
                        </div>
                      ) : null}
                      {diffBusy ? (
                        <p className="shell-git__hint">{TEXT.loadingDiff}</p>
                      ) : diff?.binary ? (
                        <p className="shell-git__hint">二进制文件，使用文件编辑器查看。</p>
                      ) : diff ? (
                        <LineDiffView
                          oldText={diff.before}
                          newText={diff.after}
                          path={row.file.path}
                          showToolbar={false}
                          showLineNumbers
                        />
                      ) : (
                        <p className="shell-git__hint">未读取到差异，请刷新后重试。</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="shell-git__body">
          {log.length === 0 ? (
            <p className="shell-git__hint">{TEXT.noHistory}</p>
          ) : (
            <ol className="shell-git__log">
              {log.map((entry, index) => (
                <li key={entry.hash} className="shell-git__log-row">
                  <div className="shell-git__log-head">
                    <code className="shell-git__log-hash">{entry.shortHash}</code>
                    <span className="shell-git__log-subject">{entry.subject}</span>
                    {index === 0 ? (
                      <button
                        type="button"
                        className="shell-git__icon-btn"
                        aria-label={TEXT.undoCommit}
                        title={TEXT.undoCommit}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            async () => {
                              const api = bridge();
                              if (!api?.gitUndoCommit) return { ok: false, error: TEXT.failed };
                              return api.gitUndoCommit({ root });
                            },
                            { refreshLog: true },
                          )
                        }
                      >
                        <Undo2 size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <p className="shell-git__log-meta">
                    {entry.author} · {new Date(entry.committedAt * 1000).toLocaleString()}
                    {entry.files.length ? ` · ${entry.files.length} 个文件` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      </div>

      {/* worktree 选择器（NewMax worktree 分组） */}
      {worktreesOpen && worktrees.length > 0 ? (
        <div className="shell-git__worktree">
          <div className="shell-git__worktree-head">
            <span>{TEXT.worktreeHeader}</span>
            <button
              type="button"
              className="shell-git__text-btn"
              disabled={busy}
              onClick={() => void createWorktree()}
            >
              {TEXT.worktreeCreate}
            </button>
          </div>
          <ul className="shell-git__worktree-list">
            {worktrees.map((entry) => (
              <li
                key={entry.path}
                className={clsx('shell-git__worktree-item', entry.active && 'is-active')}
              >
                <span className="shell-git__worktree-name" title={entry.path}>
                  {entry.main ? TEXT.worktreeLocal : entry.name}
                  {entry.branch ? <em> · {entry.branch}</em> : null}
                </span>
                {entry.changeCount > 0 ? (
                  <span className="shell-git__worktree-dirty">
                    {TEXT.uncommitted(entry.changeCount)}
                  </span>
                ) : null}
                {entry.main ? null : (
                  <button
                    type="button"
                    className="shell-git__icon-btn is-danger"
                    aria-label={TEXT.worktreeRemove}
                    title={TEXT.worktreeRemove}
                    disabled={busy}
                    onClick={() => setPendingWorktreeRemove(entry)}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'changes' ? (
        <form
          className="shell-git__commit shell-git__commit--fixed"
          data-testid="git-commit-footer"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !message.trim() || !stagedCount || hasConflicts || status.operation) return;
            void run(
              async () => {
                const result = await bridge()?.gitCommit?.({
                  root,
                  message: message.trim(),
                  ...(description.trim() ? { description: description.trim() } : {}),
                });
                if (result?.ok) {
                  setMessage('');
                  setDescription('');
                  setNotice('已提交到 ' + (status.branch || 'HEAD'));
                }
                return result ?? { ok: false, error: TEXT.failed };
              },
              { refreshLog: true },
            );
          }}
        >
          <div className="shell-git__commit-title-row">
            <GitIdentityMenu key={root} root={root} disabled={busy} />
            <input
              className="shell-git__commit-input"
              value={message}
              placeholder={TEXT.summaryPlaceholder}
              aria-label={TEXT.summaryPlaceholder}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <textarea
            className="shell-git__commit-desc"
            value={description}
            rows={2}
            placeholder={TEXT.descriptionPlaceholder}
            aria-label={TEXT.descriptionPlaceholder}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button
            type="submit"
            className="shell-git__commit-selected"
            disabled={busy || !message.trim() || !stagedCount || hasConflicts || !!status.operation}
            title={
              hasConflicts
                ? '请先解决冲突'
                : status.operation
                  ? '请先完成当前 Git 操作'
                  : !stagedCount
                    ? '勾选文件后提交'
                    : '仅提交已暂存的内容'
            }
          >
            {busy ? <LoaderCircle size={13} className="shell-process-spin" /> : <Check size={13} />}
            <span>
              {stagedCount
                ? '提交 ' + stagedCount + ' 个文件到 ' + (status.branch || 'HEAD')
                : '勾选文件后提交'}
            </span>
          </button>
        </form>
      ) : null}

      {/* 切换分支的脏工作区确认（NewMax dirtyTitle / dirtyDescription） */}
      {pendingCheckout ? (
        <div className="shell-git__confirm" role="dialog" aria-label={TEXT.dirtyTitle}>
          <p className="shell-git__confirm-title">{TEXT.dirtyTitle}</p>
          <p className="shell-git__confirm-body">
            {TEXT.dirtyDescription(pendingCheckout.branch, pendingCheckout.files.length)}
          </p>
          <ul className="shell-git__confirm-files">
            {pendingCheckout.files.slice(0, 5).map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
            {pendingCheckout.files.length > 5 ? (
              <li>{TEXT.dirtyMoreFiles(pendingCheckout.files.length - 5)}</li>
            ) : null}
          </ul>
          <div className="shell-git__confirm-actions">
            <button type="button" onClick={() => setPendingCheckout(undefined)}>
              {TEXT.cancel}
            </button>
            <button
              type="button"
              className="shell-git__primary"
              disabled={busy}
              onClick={() => void switchBranch(pendingCheckout.branch, 'stash')}
            >
              {TEXT.stashAndSwitch}
            </button>
          </div>
        </div>
      ) : null}

      {/* worktree 移除确认（NewMax removeTitle / removeDescription / removeDirty） */}
      {pendingWorktreeRemove ? (
        <div className="shell-git__confirm" role="dialog" aria-label={TEXT.worktreeRemoveTitle}>
          <p className="shell-git__confirm-title">{TEXT.worktreeRemoveTitle}</p>
          <p className="shell-git__confirm-body">
            {TEXT.worktreeRemoveDescription(pendingWorktreeRemove.path)}
          </p>
          {pendingWorktreeRemove.changeCount > 0 ? (
            <p className="shell-git__confirm-warn">
              {TEXT.worktreeRemoveDirty(pendingWorktreeRemove.changeCount)}
            </p>
          ) : null}
          {pendingWorktreeRemove.branch ? (
            <label className="shell-git__confirm-check">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(event) => setDeleteBranch(event.target.checked)}
              />
              <span>{TEXT.worktreeRemoveDeleteBranch(pendingWorktreeRemove.branch)}</span>
            </label>
          ) : null}
          <div className="shell-git__confirm-actions">
            <button type="button" onClick={() => setPendingWorktreeRemove(undefined)}>
              {TEXT.cancel}
            </button>
            <button
              type="button"
              className="shell-git__primary is-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const api = bridge();
                  if (!api?.gitRemoveWorktree) return { ok: false, error: TEXT.failed };
                  const name = pendingWorktreeRemove.name;
                  const result = await api.gitRemoveWorktree({
                    root,
                    path: pendingWorktreeRemove.path,
                    // 有未提交改动时需显式 force（用户已在弹层确认）。
                    force: pendingWorktreeRemove.changeCount > 0,
                    deleteBranch,
                  });
                  if (result.ok) {
                    setPendingWorktreeRemove(undefined);
                    setNotice(TEXT.worktreeRemoved(name));
                    await refreshWorktrees();
                  }
                  return result;
                })
              }
            >
              {TEXT.worktreeRemoveConfirm}
            </button>
          </div>
        </div>
      ) : null}

      {/* 丢弃确认 */}
      {pendingDiscard ? (
        <div className="shell-git__confirm" role="dialog" aria-label={TEXT.discardConfirmTitle}>
          <p className="shell-git__confirm-title">{TEXT.discardConfirmTitle}</p>
          <p className="shell-git__confirm-body">
            将丢弃 {pendingDiscard.length}{' '}
            个文件的未暂存改动；已暂存内容会保留，未跟踪文件将删除。此操作不可撤销。
          </p>
          <div className="shell-git__confirm-actions">
            <button type="button" onClick={() => setPendingDiscard(undefined)}>
              {TEXT.discardCancel}
            </button>
            <button
              type="button"
              className="shell-git__primary is-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const api = bridge();
                  if (!api?.gitDiscard) return { ok: false, error: TEXT.failed };
                  const result = await api.gitDiscard({
                    root,
                    paths: pendingDiscard.map((file) => file.path),
                  });
                  if (result.ok) setPendingDiscard(undefined);
                  return result;
                })
              }
            >
              {TEXT.discardConfirm}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 供宿主渲染轻量标题用。 */
export function gitPanelTitle(summary: GitChangedSummary | undefined): ReactNode {
  if (!summary?.isRepo) return 'Git';
  const branch = summary.detached ? TEXT.detached : summary.branch;
  return `${branch ?? 'Git'} · ${TEXT.uncommitted(summary.changeCount)}`;
}
