import {
  Folder,
  Monitor,
  GitBranch,
  ChevronRight,
  CircleCheck,
  LoaderCircle,
  AlertCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GitChangedSummary } from '../../git-contract.js';
import {
  ComposerGitMenu,
  type ComposerGitMenuKind,
  type ComposerGitNavigation,
} from './ComposerGitMenu.js';
export type { ComposerGitNavigation } from './ComposerGitMenu.js';
import { invalidateGitRepository, subscribeGitRepository } from './git-repository-events.js';
export type GitPanelSection = 'changes' | 'branches' | 'worktrees';
export interface ComposerGitBarProps {
  projectFolder: string;
  workspaceName?: string;
  navigation?: ComposerGitNavigation;
  onOpenGit?(root: string, section: GitPanelSection): void;
}
export function ComposerGitBar({
  projectFolder,
  workspaceName,
  navigation,
  onOpenGit,
}: ComposerGitBarProps) {
  const [menuBusy, setMenuBusy] = useState(false);
  useEffect(() => {
    setMenuBusy(false);
  }, [projectFolder]);
  const [menu, setMenu] = useState<{
    kind: ComposerGitMenuKind;
    root: string;
    anchor: HTMLButtonElement;
  }>();
  const toggleMenu = (kind: ComposerGitMenuKind, anchor: HTMLButtonElement) =>
    setMenu((current) =>
      current?.kind === kind && current.root === projectFolder
        ? undefined
        : { kind, root: projectFolder, anchor },
    );
  const [environment, setEnvironment] = useState<{ root: string; label: string }>();
  useEffect(() => {
    let cancelled = false;
    const api = window.syncThink?.runtime;
    void api
      ?.gitWorktrees?.({ root: projectFolder })
      .then((result) => {
        if (cancelled) return;
        const current = result.worktrees.find((tree) => tree.active);
        setEnvironment({
          root: projectFolder,
          label: current && !current.main ? current.name : 'Local',
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectFolder]);
  const [snapshot, setSnapshot] = useState<{
    root: string;
    summary?: GitChangedSummary;
    error?: string;
  }>();
  useEffect(() => {
    const api = window.syncThink?.runtime;
    let disposed = false,
      running = false,
      again = false;
    const refresh = async () => {
      if (running) {
        again = true;
        return;
      }
      if (!api?.gitChanged) return;
      running = true;
      do {
        again = false;
        try {
          const summary = await api.gitChanged({ root: projectFolder });
          if (!disposed) setSnapshot({ root: projectFolder, summary });
        } catch {
          if (!disposed) setSnapshot({ root: projectFolder, error: 'Git 状态读取失败，点击重试' });
        }
      } while (again && !disposed);
      running = false;
    };
    void refresh();
    const stop = subscribeGitRepository(projectFolder, () => {
      void refresh();
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [projectFolder]);
  const state = snapshot?.root === projectFolder ? snapshot : undefined,
    summary = state?.summary;
  if (!window.syncThink?.runtime?.gitChanged || summary?.isRepo === false) return null;
  const label =
    workspaceName || projectFolder.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '项目';
  const open = (section: GitPanelSection) => {
    if (state?.error) invalidateGitRepository(projectFolder);
    onOpenGit?.(projectFolder, section);
  };
  return (
    <div className="shell-composer-git" data-testid="composer-git-bar" aria-label="当前仓库">
      <button
        type="button"
        className="shell-composer-git__project"
        title={projectFolder}
        aria-haspopup="dialog"
        aria-expanded={menu?.kind === 'workspace' && menu.root === projectFolder}
        onClick={(event) => toggleMenu('workspace', event.currentTarget)}
        disabled={menuBusy || !navigation}
      >
        <Folder size={14} />
        <span>{label}</span>
      </button>
      <button
        type="button"
        className="shell-composer-git__environment"
        title="查看本地工作副本"
        aria-haspopup="dialog"
        aria-expanded={menu?.kind === 'environment' && menu.root === projectFolder}
        onClick={(event) => toggleMenu('environment', event.currentTarget)}
        disabled={menuBusy || !summary}
      >
        <Monitor size={14} />
        <span>{environment?.root === projectFolder ? environment.label : 'Local'}</span>
      </button>
      <button
        type="button"
        className="shell-composer-git__branch"
        title={summary?.branch || (summary?.detached ? '游离 HEAD' : '正在读取分支')}
        aria-haspopup="dialog"
        aria-expanded={menu?.kind === 'branch' && menu.root === projectFolder}
        onClick={(event) => toggleMenu('branch', event.currentTarget)}
        disabled={menuBusy || !summary}
      >
        <GitBranch size={14} />
        <span>
          {summary?.branch ||
            (summary?.detached ? 'HEAD · ' + (summary.detachedSha || '游离') : '读取仓库…')}
        </span>
      </button>
      <button
        type="button"
        className="shell-composer-git__changes"
        data-error={!!state?.error || undefined}
        disabled={menuBusy || !onOpenGit}
        onClick={() => open('changes')}
        title={state?.error || '打开审阅面板'}
      >
        {state?.error ? (
          <AlertCircle size={12} />
        ) : summary ? (
          <CircleCheck size={12} />
        ) : (
          <LoaderCircle size={12} className="shell-process-spin" />
        )}
        <span>
          {state?.error
            ? '重试'
            : summary
              ? summary.changeCount
                ? summary.changeCount + ' 个未提交'
                : '无未提交改动'
              : '读取中'}
        </span>
        <ChevronRight size={12} />
      </button>
      {menu && menu.root === projectFolder ? (
        <ComposerGitMenu
          key={menu.kind + projectFolder}
          kind={menu.kind}
          root={projectFolder}
          label={label}
          currentBranch={summary?.branch ?? null}
          anchor={menu.anchor}
          navigation={navigation}
          onBusyChange={setMenuBusy}
          onDismiss={() => {
            setMenuBusy(false);
            setMenu(undefined);
          }}
          onReview={() => {
            setMenu(undefined);
            open('changes');
          }}
        />
      ) : null}
    </div>
  );
}
