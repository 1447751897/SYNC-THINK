import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  Folder,
  GitBranch,
  GitFork,
  GitMerge,
  LoaderCircle,
  Monitor,
  Plus,
  Search,
} from 'lucide-react';
import type { GitBranch as Branch, GitWorktree } from '../../git-contract.js';
import { invalidateGitRepository, repositoryKey } from './git-repository-events.js';

export interface ComposerGitNavigation {
  workspaces: readonly {
    workspaceId: string;
    name: string;
    folderPath?: string;
    hidden?: boolean;
  }[];
  workspaceId?: string;
  onSelectWorkspace(id: string): void;
  onCreateWorkspace(): Promise<void>;
  onOpenWorktree(path: string, name: string): Promise<void>;
}
export type ComposerGitMenuKind = 'workspace' | 'environment' | 'branch';
interface Props {
  kind: ComposerGitMenuKind;
  root: string;
  label: string;
  currentBranch: string | null;
  anchor: HTMLButtonElement;
  navigation?: ComposerGitNavigation;
  onDismiss(): void;
  onReview(): void;
  onBusyChange?(busy: boolean): void;
}

export function ComposerGitMenu({
  kind,
  root,
  label,
  currentBranch,
  anchor,
  navigation,
  onDismiss,
  onReview,
  onBusyChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(kind !== 'workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<
    'choose' | 'createBranch' | 'merge' | 'mergeConfirm' | 'dirty' | 'createWorktree'
  >('choose');
  const [draft, setDraft] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [pendingBranch, setPendingBranch] = useState('');
  const [createdTree, setCreatedTree] = useState<{ path: string; name: string }>();
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const panel = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const api = window.syncThink?.runtime;
  const title =
    kind === 'workspace' ? '选择工作区' : kind === 'environment' ? '工作在' : '选择分支';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(kind === 'branch' ? 360 : 300, window.innerWidth - 16);
      const above = rect.top >= 210;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        maxHeight: Math.max(
          120,
          Math.min(480, above ? rect.top - 16 : window.innerHeight - rect.bottom - 16),
        ),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, kind]);
  useEffect(() => {
    if (position.visibility === 'hidden' || panel.current?.contains(document.activeElement)) return;
    panel.current
      ?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [position.visibility, mode, loading]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !busy &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchor.contains(event.target)
      )
        dismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [anchor, busy]);
  useEffect(() => {
    let cancelled = false;
    if (kind === 'workspace') return;
    const load = async () => {
      try {
        if (!api) throw new Error('桌面连接尚未就绪');
        if (kind === 'branch') {
          const result = await api.gitBranches({ root });
          if (!cancelled) setBranches(result.branches);
        } else {
          const result = await api.gitWorktrees({ root });
          if (!cancelled) setWorktrees(result.worktrees);
        }
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : '读取失败，请重新打开菜单');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, kind, root]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : '操作失败，请重试');
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };
  const checkout = async (branch: string, strategy: 'check' | 'stash' = 'check') => {
    if (!api) throw new Error('桌面连接尚未就绪');
    const result = await api.gitCheckout({ root, branch, strategy });
    invalidateGitRepository(root);
    if (!alive.current) return;
    if (result.ok) {
      if (result.stashConflict) {
        setNotice('分支已切换，恢复的改动存在冲突，请在审阅中处理。');
        setMode('choose');
      } else onDismiss();
    } else if (result.dirty && strategy === 'check') {
      setPendingBranch(branch);
      setMode('dirty');
    } else throw new Error(result.error || '切换分支失败');
  };
  const beginWorktree = () => {
    const token = Date.now().toString(36);
    const base = worktrees.find((tree) => tree.main)?.path || root;
    const normalized = base.replace(/\\/g, '/').replace(/\/$/, '');
    setDraft('codex/worktree-' + token);
    setTargetPath(normalized + '-worktrees/' + token);
    setMode('createWorktree');
  };
  const back = () => {
    setMode('choose');
    setQuery('');
    setError('');
    setNotice('');
  };
  const needle = query.trim().toLocaleLowerCase();
  const filteredBranches = branches.filter(
    (branch) =>
      branch.name.toLocaleLowerCase().includes(needle) &&
      (mode !== 'merge' || branch.name !== currentBranch),
  );
  const workspaces =
    navigation?.workspaces.filter(
      (workspace) =>
        !workspace.hidden &&
        (workspace.name + ' ' + (workspace.folderPath || '')).toLocaleLowerCase().includes(needle),
    ) ?? [];
  const activeWorkspace =
    navigation?.workspaceId ||
    navigation?.workspaces.find(
      (workspace) =>
        workspace.folderPath && repositoryKey(workspace.folderPath) === repositoryKey(root),
    )?.workspaceId;
  const closeAfter = async (action?: () => void | Promise<void>) => {
    await action?.();
    if (alive.current) onDismiss();
  };
  const keyNavigate = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (
      event.target instanceof HTMLInputElement &&
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp'
    )
      return;
    const items = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>('button[data-menu-item]:not(:disabled)') ||
        [],
    );
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : (index <= 0 ? items.length : index) - 1;
    items[next]?.focus();
  };
  return createPortal(
    <div
      ref={panel}
      className="shell-composer-git-menu"
      role="dialog"
      aria-label={title}
      aria-busy={busy || loading}
      style={position}
      onKeyDown={keyNavigate}
    >
      {(mode === 'choose' || mode === 'merge') && kind !== 'environment' ? (
        <label className="shell-composer-git-menu__search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={kind === 'workspace' ? '搜索工作区' : '搜索 ' + label + ' 的分支'}
            aria-label={kind === 'workspace' ? '搜索工作区' : '搜索分支'}
          />
        </label>
      ) : (
        <div className="shell-composer-git-menu__heading">
          {mode !== 'choose' ? (
            <button type="button" aria-label="返回" disabled={busy} onClick={back}>
              <ArrowLeft size={14} />
            </button>
          ) : null}
          {mode === 'createBranch'
            ? '新建分支'
            : mode === 'createWorktree'
              ? '新建本地 worktree'
              : mode === 'dirty'
                ? '保留改动并切换分支'
                : mode === 'mergeConfirm'
                  ? '合并分支'
                  : title}
        </div>
      )}
      {error ? (
        <div className="shell-composer-git-menu__message" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="shell-composer-git-menu__message" role="status">
          {notice}
          <button type="button" onClick={onReview}>
            查看审阅
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="shell-composer-git-menu__message">
          <LoaderCircle size={14} className="shell-process-spin" />
          读取中…
        </p>
      ) : null}
      {mode === 'choose' && kind === 'workspace' ? (
        <>
          <div className="shell-composer-git-menu__list">
            {workspaces.map((workspace) => (
              <button
                type="button"
                data-menu-item
                key={workspace.workspaceId}
                className="shell-composer-git-menu__item"
                data-active={workspace.workspaceId === activeWorkspace || undefined}
                aria-current={workspace.workspaceId === activeWorkspace ? 'true' : undefined}
                title={workspace.folderPath || workspace.name}
                disabled={busy}
                onClick={() => {
                  navigation?.onSelectWorkspace(workspace.workspaceId);
                  onDismiss();
                }}
              >
                <Folder size={14} />
                <span>{workspace.name}</span>
                {workspace.workspaceId === activeWorkspace ? <Check size={15} /> : null}
              </button>
            ))}
            {!workspaces.length ? (
              <p className="shell-composer-git-menu__message">没有匹配的工作区</p>
            ) : null}
          </div>
          <div className="shell-composer-git-menu__footer">
            <button
              type="button"
              data-menu-item
              className="shell-composer-git-menu__item"
              disabled={busy || !navigation}
              onClick={() => void run(() => closeAfter(navigation?.onCreateWorkspace))}
            >
              <Plus size={15} />
              <span>新建工作区</span>
            </button>
          </div>
        </>
      ) : null}
      {mode === 'choose' && kind === 'environment' ? (
        <>
          <div className="shell-composer-git-menu__list">
            {worktrees.map((tree) => (
              <button
                type="button"
                data-menu-item
                key={tree.path}
                className="shell-composer-git-menu__item"
                data-active={tree.active || undefined}
                aria-current={tree.active ? 'true' : undefined}
                title={tree.path}
                disabled={busy || (!navigation && !tree.active)}
                onClick={() =>
                  void run(() =>
                    closeAfter(
                      tree.active
                        ? undefined
                        : () => navigation?.onOpenWorktree(tree.path, tree.name),
                    ),
                  )
                }
              >
                {tree.main ? <Monitor size={15} /> : <GitFork size={15} />}
                <span>
                  <strong>{tree.main ? 'Local' : tree.name}</strong>
                  <small>
                    {tree.main ? '直接在 ' + tree.name + ' 里工作' : tree.branch || '游离 HEAD'}
                  </small>
                </span>
                {tree.active ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
          <div className="shell-composer-git-menu__footer">
            <button
              type="button"
              data-menu-item
              className="shell-composer-git-menu__item"
              disabled={busy || !navigation || loading || !worktrees.length}
              onClick={beginWorktree}
            >
              <GitFork size={15} />
              <span>
                <strong>新建本地 worktree</strong>
                <small>创建独立目录与分支，并打开对应工作区</small>
              </span>
            </button>
          </div>
        </>
      ) : null}
      {(mode === 'choose' || mode === 'merge') && kind === 'branch' ? (
        <>
          {mode === 'merge' ? (
            <div className="shell-composer-git-menu__heading">
              <button type="button" aria-label="返回" onClick={back}>
                <ArrowLeft size={14} />
              </button>
              选择分支合并到 {currentBranch}
            </div>
          ) : null}
          <div className="shell-composer-git-menu__list">
            {(['default', 'recent', 'other'] as const).map((group) => {
              const items = filteredBranches.filter((branch) => branch.group === group);
              return items.length ? (
                <div key={group}>
                  <p className="shell-composer-git-menu__group">
                    {group === 'default'
                      ? '默认分支'
                      : group === 'recent'
                        ? '最近分支'
                        : '其他分支'}
                  </p>
                  {items.map((branch) => (
                    <button
                      type="button"
                      data-menu-item
                      className="shell-composer-git-menu__item"
                      key={branch.name}
                      title={branch.name}
                      data-active={branch.name === currentBranch || undefined}
                      aria-current={branch.name === currentBranch ? 'true' : undefined}
                      disabled={busy}
                      onClick={() => {
                        if (branch.name === currentBranch) onDismiss();
                        else if (mode === 'merge') {
                          setPendingBranch(branch.name);
                          setMode('mergeConfirm');
                        } else void run(() => checkout(branch.name));
                      }}
                    >
                      {branch.name === currentBranch ? (
                        <Check size={14} className="shell-composer-git-menu__check" />
                      ) : (
                        <GitBranch size={14} />
                      )}
                      <span>{branch.name}</span>
                      {branch.committedAt ? (
                        <time dateTime={new Date(branch.committedAt * 1000).toISOString()}>
                          {new Date(branch.committedAt * 1000).toLocaleDateString('zh-CN')}
                        </time>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null;
            })}
            {!loading && !filteredBranches.length ? (
              <p className="shell-composer-git-menu__message">没有匹配的分支</p>
            ) : null}
          </div>
          {mode === 'choose' ? (
            <div className="shell-composer-git-menu__footer">
              <button
                type="button"
                data-menu-item
                className="shell-composer-git-menu__item"
                disabled={busy || !currentBranch || loading}
                onClick={() => {
                  setMode('merge');
                  setQuery('');
                }}
              >
                <GitMerge size={15} />
                <span>选择分支合并到 {currentBranch}…</span>
              </button>
              <button
                type="button"
                data-menu-item
                className="shell-composer-git-menu__item"
                disabled={busy || loading}
                onClick={() => {
                  setDraft('');
                  setMode('createBranch');
                }}
              >
                <Plus size={15} />
                <span>新建分支…</span>
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {mode === 'createBranch' ? (
        <form
          className="shell-composer-git-menu__form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!api) return;
              const result = await api.gitCreateBranch({ root, branch: draft.trim() });
              if (!result.ok) throw new Error(result.error || '创建分支失败');
              invalidateGitRepository(root);
              if (alive.current) onDismiss();
            });
          }}
        >
          <label>
            分支名称
            <input
              autoFocus
              aria-label="分支名称"
              placeholder="codex/my-change"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button disabled={busy || !draft.trim()} type="submit">
            创建并切换
          </button>
        </form>
      ) : null}
      {mode === 'dirty' ? (
        <div className="shell-composer-git-menu__form">
          <p>
            当前目录还有未提交改动。切换到 <strong>{pendingBranch}</strong> 时，可以先保存到 Git
            stash，切换后恢复。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => checkout(pendingBranch, 'stash'))}
          >
            保留改动并切换
          </button>
          <button type="button" disabled={busy} onClick={back}>
            取消
          </button>
        </div>
      ) : null}
      {mode === 'mergeConfirm' ? (
        <div className="shell-composer-git-menu__form">
          <p>
            将 <strong>{pendingBranch}</strong> 合并到 <strong>{currentBranch}</strong>。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!api) return;
                const result = await api.gitMerge({ root, branch: pendingBranch });
                invalidateGitRepository(root);
                if (!alive.current) return;
                if (result.conflict) {
                  setNotice('合并产生冲突，请在审阅中处理。');
                  setMode('choose');
                } else if (!result.ok) throw new Error(result.error || '合并失败');
                else onDismiss();
              })
            }
          >
            合并到当前分支
          </button>
          <button type="button" disabled={busy} onClick={back}>
            取消
          </button>
        </div>
      ) : null}
      {mode === 'createWorktree' ? (
        <form
          className="shell-composer-git-menu__form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!api || !navigation) return;
              let tree = createdTree;
              if (!tree) {
                const result = await api.gitAddWorktree({
                  root,
                  path: targetPath.trim(),
                  newBranch: draft.trim(),
                });
                if (!result.ok) throw new Error(result.error || '创建 worktree 失败');
                tree = { path: result.path || targetPath.trim(), name: draft.trim() };
                if (alive.current) setCreatedTree(tree);
              }
              invalidateGitRepository(root);
              if (alive.current)
                await closeAfter(() => navigation.onOpenWorktree(tree.path, tree.name));
            });
          }}
        >
          <p>基于当前提交创建独立工作目录。原目录的未提交改动保留在原处。</p>
          <label>
            新分支
            <input
              autoFocus
              aria-label="worktree 分支"
              disabled={!!createdTree}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <label>
            目录
            <input
              aria-label="worktree 目录"
              disabled={!!createdTree}
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </label>
          <button disabled={busy || !draft.trim() || !targetPath.trim()} type="submit">
            {createdTree ? '打开已创建的工作区' : '创建并打开工作区'}
          </button>
        </form>
      ) : null}
      {busy ? (
        <p className="shell-composer-git-menu__message" role="status">
          <LoaderCircle size={14} className="shell-process-spin" />
          正在处理…
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
