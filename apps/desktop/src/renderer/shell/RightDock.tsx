// 右侧多面板 Dock（NewMax 式）：浏览器 / 文件 / 工作区（git）三个标签页。
// - 浏览器面板始终保持挂载（display 切换），避免切标签丢失 webview 状态；
// - AI 通过 browser_open 工具驱动时，宿主把 URL 下发到这里并自动切到浏览器页；
// - 文件面板：搜索 + 预览项目内文本文件（主进程只读 IPC，防目录穿越）；
// - 工作区面板：当前分支 / 未提交变更 / 最近提交。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { BrowserPanel } from './BrowserPanel.js';

/** Preload bridge accessor (undefined in bare unit-test DOM). */
function dockBridge() {
  return (window as unknown as { syncThink?: { runtime?: any } }).syncThink?.runtime;
}

export type DockTab = 'browser' | 'files' | 'workspace';

interface ProjectFileEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
}

interface GitInfo {
  branch: string | null;
  branches?: string[];
  changes: Array<{ status: string; path: string }>;
  recentCommits: Array<{ hash: string; subject: string }>;
  isRepo: boolean;
}

export function RightDock(props: {
  /** Bound project folder; files/workspace panels need it. */
  projectFolder?: string;
  /** URL pushed by the AI browser_open tool — switches to the browser tab. */
  browserUrl?: string;
  /** Bump this counter to re-navigate even when the URL string is unchanged. */
  browserNavSeq?: number;
  initialTab?: DockTab;
  /**
   * 文件分屏：提供该回调时，文件树点击文件不再内嵌小预览，
   * 而是交给宿主（ChatView）在主区域以分屏面板打开（IDE 式查看）。
   */
  onOpenFileSplit?(path: string): void;
  /** 当前在分屏中打开的文件（用于树/搜索列表高亮）。 */
  splitFilePath?: string | null;
  onClose(): void;
}) {
  const [tab, setTab] = useState<DockTab>(props.initialTab ?? 'browser');

  // AI 下发新 URL → 自动切到浏览器标签。
  useEffect(() => {
    if (props.browserUrl) setTab('browser');
  }, [props.browserUrl, props.browserNavSeq]);

  return (
    <div className="shell-dock flex h-full min-h-0 flex-col" data-testid="right-dock">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <DockTabBtn
          active={tab === 'browser'}
          icon={<Globe size={13} />}
          label="浏览器"
          onClick={() => setTab('browser')}
        />
        <DockTabBtn
          active={tab === 'files'}
          icon={<Folder size={13} />}
          label="文件"
          onClick={() => setTab('files')}
        />
        <DockTabBtn
          active={tab === 'workspace'}
          icon={<GitBranch size={13} />}
          label="工作区"
          onClick={() => setTab('workspace')}
        />
        <button
          type="button"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
          onClick={props.onClose}
          title="关闭右栏"
        >
          <X size={13} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 浏览器常驻挂载：切走时仅隐藏，保住页面状态与登录态。 */}
        <div
          className={clsx('shell-dock-panel absolute inset-0', tab === 'browser' ? 'is-active' : 'is-hidden')}
          aria-hidden={tab !== 'browser'}
        >
          <BrowserPanel
            initialUrl={props.browserUrl}
            navigateUrl={props.browserUrl}
            navigateSeq={props.browserNavSeq}
            onClose={props.onClose}
            embedded
          />
        </div>
        {tab === 'files' ? (
          <div className="shell-dock-panel absolute inset-0 is-active">
            <FilesPanel
              projectFolder={props.projectFolder}
              onOpenFileSplit={props.onOpenFileSplit}
              splitFilePath={props.splitFilePath}
            />
          </div>
        ) : null}
        {tab === 'workspace' ? (
          <div className="shell-dock-panel absolute inset-0 is-active">
            <WorkspacePanel projectFolder={props.projectFolder} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── 文件面板 ─────────────────────────────────────────────────────────────────

interface TreeDirState {
  loaded: boolean;
  loading: boolean;
  entries: ProjectFileEntry[];
}

function FilesPanel({
  projectFolder,
  onOpenFileSplit,
  splitFilePath,
}: {
  projectFolder?: string;
  onOpenFileSplit?(path: string): void;
  splitFilePath?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedInternal, setSelectedInternal] = useState<string | null>(null);
  // 分屏模式下高亮跟随宿主的分屏文件；内嵌预览模式沿用内部选中态。
  const selected = onOpenFileSplit ? (splitFilePath ?? null) : selectedInternal;
  const [preview, setPreview] = useState<{ path: string; content: string | null; error: string | null } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // 树形状态：dir path ('' = root) → children；expanded 记录展开集合。
  const [dirs, setDirs] = useState<Record<string, TreeDirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const searchMode = query.trim().length > 0;

  const loadDir = useCallback(
    (dir: string) => {
      const api = dockBridge();
      if (!projectFolder || !api?.listProjectDir) return;
      setDirs((current) => ({
        ...current,
        [dir]: { loaded: current[dir]?.loaded ?? false, loading: true, entries: current[dir]?.entries ?? [] },
      }));
      void api
        .listProjectDir({ root: projectFolder, dir })
        .then((result: { entries: ProjectFileEntry[] }) => {
          setDirs((current) => ({ ...current, [dir]: { loaded: true, loading: false, entries: result.entries } }));
        })
        .catch(() => {
          setDirs((current) => ({ ...current, [dir]: { loaded: true, loading: false, entries: [] } }));
        });
    },
    [projectFolder],
  );

  // 初始加载根目录。
  useEffect(() => {
    if (!projectFolder) return;
    setDirs({});
    setExpanded(new Set());
    loadDir('');
  }, [projectFolder, loadDir]);

  const toggleDir = useCallback(
    (dir: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(dir)) next.delete(dir);
        else {
          next.add(dir);
          // 懒加载：首次展开时才拉取子目录。
          setDirs((state) => {
            if (!state[dir]?.loaded && !state[dir]?.loading) {
              // Defer to avoid setState-in-setState warnings.
              window.setTimeout(() => loadDir(dir), 0);
            }
            return state;
          });
        }
        return next;
      });
    },
    [loadDir],
  );

  // 搜索模式：沿用平铺模糊搜索。
  useEffect(() => {
    if (!projectFolder || !searchMode) return;
    const api = dockBridge();
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .listProjectFiles({ root: projectFolder, query, maxEntries: 200 })
        .then((result: { files: ProjectFileEntry[] }) => {
          if (!cancelled) setFiles(result.files.filter((f) => f.kind === 'file'));
        })
        .catch(() => {
          if (!cancelled) setFiles([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectFolder, query, searchMode]);

  const openFile = useCallback(
    (path: string) => {
      // 分屏模式：直接交给宿主在主区域打开文件面板（IDE 式）。
      if (onOpenFileSplit) {
        onOpenFileSplit(path);
        return;
      }
      const api = dockBridge();
      if (!projectFolder || !api) return;
      setSelectedInternal(path);
      setPreviewLoading(true);
      void api
        .readProjectFile({ root: projectFolder, path })
        .then(setPreview)
        .catch(() => setPreview({ path, content: null, error: '读取失败' }))
        .finally(() => setPreviewLoading(false));
    },
    [projectFolder, onOpenFileSplit],
  );

  if (!projectFolder) {
    return <DockEmpty icon={<Folder size={22} />} title="未绑定项目文件夹" subtitle="绑定后可在此浏览工作区文件" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <div className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            className="h-7 w-full rounded-md border border-border bg-page pl-6.5 pr-2 text-[11.5px] text-text focus:border-accent focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名…"
            spellCheck={false}
            data-testid="dock-files-search"
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={clsx(
            'shrink-0 overflow-y-auto border-b border-border',
            !onOpenFileSplit && selected ? 'max-h-[38%]' : 'flex-1',
          )}
        >
          {searchMode ? (
            loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-text-faint">
                <Loader2 size={12} className="animate-spin" /> 加载中…
              </div>
            ) : files.length === 0 ? (
              <div className="px-3 py-3 text-[11.5px] text-text-faint">没有匹配的文件</div>
            ) : (
              <ul className="p-1">
                {files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]',
                        selected === file.path ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-hover',
                      )}
                      title={file.path}
                      onClick={() => openFile(file.path)}
                    >
                      <FileCode2 size={12} className="shrink-0 text-text-faint" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-[10.5px] text-text-faint">{file.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="p-1" data-testid="dock-files-tree">
              <FileTreeLevel
                dir=""
                depth={0}
                dirs={dirs}
                expanded={expanded}
                selected={selected}
                onToggleDir={toggleDir}
                onOpenFile={openFile}
              />
            </div>
          )}
        </div>
        {!onOpenFileSplit && selected ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
              <FileText size={12} className="shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-text" title={selected}>
                {selected}
              </span>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
                title="关闭预览"
                onClick={() => {
                  setSelectedInternal(null);
                  setPreview(null);
                }}
              >
                <X size={11} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {previewLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-text-faint">
                  <Loader2 size={12} className="animate-spin" /> 读取中…
                </div>
              ) : preview?.error ? (
                <div className="px-3 py-3 text-[11.5px] text-text-faint">{preview.error}</div>
              ) : (
                <pre className="shell-dock-file-preview">{preview?.content ?? ''}</pre>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 树形层级：一层目录（dirs[dir].entries），目录可展开递归渲染子层。 */
function FileTreeLevel({
  dir,
  depth,
  dirs,
  expanded,
  selected,
  onToggleDir,
  onOpenFile,
}: {
  dir: string;
  depth: number;
  dirs: Record<string, TreeDirState>;
  expanded: Set<string>;
  selected: string | null;
  onToggleDir(dir: string): void;
  onOpenFile(path: string): void;
}) {
  const state = dirs[dir];
  if (!state || (state.loading && !state.loaded)) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-text-faint" style={{ paddingLeft: 8 + depth * 14 }}>
        <Loader2 size={11} className="animate-spin" /> 加载中…
      </div>
    );
  }
  if (state.entries.length === 0) {
    return (
      <div className="px-2 py-1 text-[11px] text-text-faint opacity-70" style={{ paddingLeft: 8 + depth * 14 }}>
        （空目录）
      </div>
    );
  }
  return (
    <ul>
      {state.entries.map((entry) =>
        entry.kind === 'dir' ? (
          <li key={entry.path}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-text hover:bg-hover"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={entry.path}
              onClick={() => onToggleDir(entry.path)}
            >
              {expanded.has(entry.path) ? (
                <ChevronDown size={11} className="shrink-0 text-text-faint" />
              ) : (
                <ChevronRight size={11} className="shrink-0 text-text-faint" />
              )}
              {expanded.has(entry.path) ? (
                <FolderOpen size={12} className="shrink-0 text-accent" />
              ) : (
                <Folder size={12} className="shrink-0 text-text-faint" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            </button>
            {expanded.has(entry.path) ? (
              <FileTreeLevel
                dir={entry.path}
                depth={depth + 1}
                dirs={dirs}
                expanded={expanded}
                selected={selected}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
              />
            ) : null}
          </li>
        ) : (
          <li key={entry.path}>
            <button
              type="button"
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px]',
                selected === entry.path ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-hover',
              )}
              style={{ paddingLeft: 8 + depth * 14 + 15 }}
              title={entry.path}
              onClick={() => onOpenFile(entry.path)}
            >
              <FileCode2 size={12} className="shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

// ─── 工作区（git）面板 ────────────────────────────────────────────────────────

function WorkspacePanel({ projectFolder }: { projectFolder?: string }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // 分支切换：picker 打开态 / 目标分支 / 脏工作区确认弹层 / 进行中 / 错误。
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [dirtyChanges, setDirtyChanges] = useState<Array<{ status: string; path: string }> | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const api = dockBridge();
    if (!projectFolder || !api) return;
    setLoading(true);
    void api
      .getGitInfo({ root: projectFolder })
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [projectFolder]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 发起切换：先 check 探测；脏则弹确认（stash 后切 / 取消）。 */
  const requestCheckout = useCallback(
    (branch: string, strategy: 'check' | 'stash') => {
      const api = dockBridge();
      if (!projectFolder || !api?.gitCheckout) return;
      setSwitching(true);
      setSwitchError(null);
      void api
        .gitCheckout({ root: projectFolder, branch, strategy })
        .then((result: { ok: boolean; dirty: boolean; changes: Array<{ status: string; path: string }>; error: string | null; stashed?: boolean }) => {
          if (result.ok) {
            setPendingBranch(null);
            setDirtyChanges(null);
            refresh();
            return;
          }
          if (result.dirty && strategy === 'check') {
            // 有未提交更改 → 弹确认层，让用户先处理。
            setPendingBranch(branch);
            setDirtyChanges(result.changes);
            return;
          }
          setSwitchError(result.error ?? '切换失败');
        })
        .catch(() => setSwitchError('切换失败'))
        .finally(() => setSwitching(false));
    },
    [projectFolder, refresh],
  );

  const changeStats = useMemo(() => {
    if (!info) return '';
    return info.changes.length > 0 ? `${info.changes.length} 个未提交变更` : '工作区干净';
  }, [info]);

  if (!projectFolder) {
    return <DockEmpty icon={<GitBranch size={22} />} title="未绑定项目文件夹" subtitle="绑定后可查看分支与变更" />;
  }

  const otherBranches = (info?.branches ?? []).filter((b) => b !== info?.branch);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitBranch size={13} className="shrink-0 text-accent" />
        {loading && !info ? (
          <span className="text-[12px] text-text-faint">读取中…</span>
        ) : info?.isRepo ? (
          <>
            <div className="relative min-w-0">
              <button
                type="button"
                className="flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-text hover:bg-hover"
                data-testid="dock-git-branch"
                title="切换分支"
                disabled={switching}
                onClick={() => setBranchMenuOpen((v) => !v)}
              >
                <span className="min-w-0 truncate">{info.branch}</span>
                {switching ? (
                  <Loader2 size={11} className="shrink-0 animate-spin text-text-faint" />
                ) : (
                  <ChevronDown size={11} className="shrink-0 text-text-faint" />
                )}
              </button>
              {branchMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBranchMenuOpen(false)} />
                  <div
                    className="absolute left-0 top-full z-50 mt-1 max-h-[280px] min-w-[200px] max-w-[300px] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
                    data-testid="dock-branch-menu"
                  >
                    <div className="px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-text-faint">
                      切换分支
                    </div>
                    {otherBranches.length === 0 ? (
                      <div className="px-2 py-1.5 text-[11.5px] text-text-faint">没有其他本地分支</div>
                    ) : (
                      otherBranches.map((branch) => (
                        <button
                          key={branch}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-text hover:bg-hover"
                          title={branch}
                          onClick={() => {
                            setBranchMenuOpen(false);
                            requestCheckout(branch, 'check');
                          }}
                        >
                          <GitBranch size={11} className="shrink-0 text-text-faint" />
                          <span className="min-w-0 flex-1 truncate">{branch}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <span className="shrink-0 text-[11px] text-text-faint">{changeStats}</span>
          </>
        ) : (
          <span className="text-[12px] text-text-faint">不是 git 仓库</span>
        )}
        <button
          type="button"
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
          title="刷新"
          onClick={refresh}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {switchError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-border bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] px-3 py-2 text-[11.5px] text-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--color-error)]" />
          <span className="min-w-0 flex-1">{switchError}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-text-faint hover:bg-hover hover:text-text"
            onClick={() => setSwitchError(null)}
            title="关闭"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}

      {/* 脏工作区确认层：未提交更改必须先处理再切换。 */}
      {pendingBranch && dirtyChanges ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-page)_65%,transparent)] p-4"
          data-testid="dock-dirty-confirm"
        >
          <div className="w-full max-w-[340px] rounded-xl border border-border bg-surface p-4 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-[var(--color-warning,#e5a50a)]" />
              <span className="text-[13px] font-semibold text-text">有未提交的更改</span>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-text-secondary">
              当前有 {dirtyChanges.length} 个未提交的更改。切换到{' '}
              <span className="font-medium text-text">{pendingBranch}</span>{' '}
              前需要先保存这些更改，以免丢失。
            </p>
            <ul className="mb-3 max-h-[120px] overflow-y-auto rounded-md border border-border bg-page p-1.5">
              {dirtyChanges.slice(0, 12).map((change) => (
                <li key={change.path} className="flex items-center gap-2 py-0.5 text-[11px]">
                  <span className="w-5 shrink-0 text-center font-mono text-[10px] text-accent">
                    {change.status || 'M'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text" title={change.path}>
                    {change.path}
                  </span>
                </li>
              ))}
              {dirtyChanges.length > 12 ? (
                <li className="pl-7 text-[10.5px] text-text-faint">… 其余 {dirtyChanges.length - 12} 项</li>
              ) : null}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-2.5 py-1.5 text-[11.5px] text-text-secondary hover:bg-hover"
                disabled={switching}
                onClick={() => {
                  setPendingBranch(null);
                  setDirtyChanges(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                disabled={switching}
                data-testid="dock-dirty-stash-switch"
                onClick={() => requestCheckout(pendingBranch, 'stash')}
              >
                {switching ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                保存到 stash 并切换
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-text-faint">
              更改会存入 git stash（含未跟踪文件），切回来后可用 <code>git stash pop</code> 恢复。
            </p>
          </div>
        </div>
      ) : null}

      {info?.isRepo ? (
        <>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-faint">
              未提交变更 · {info.changes.length}
            </div>
            {info.changes.length === 0 ? (
              <div className="py-1 text-[11.5px] text-text-faint">没有未提交的改动</div>
            ) : (
              <ul className="space-y-0.5">
                {info.changes.slice(0, 40).map((change) => (
                  <li key={change.path} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className={clsx(
                        'w-5 shrink-0 text-center font-mono text-[10.5px]',
                        change.status.includes('A') || change.status === '??'
                          ? 'text-[var(--color-success)]'
                          : change.status.includes('D')
                            ? 'text-[var(--color-error)]'
                            : 'text-accent',
                      )}
                    >
                      {change.status || 'M'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text" title={change.path}>
                      {change.path}
                    </span>
                  </li>
                ))}
                {info.changes.length > 40 ? (
                  <li className="pl-7 text-[11px] text-text-faint">… 其余 {info.changes.length - 40} 项</li>
                ) : null}
              </ul>
            )}
          </div>
          <div className="shrink-0 px-3 py-2">
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-faint">最近提交</div>
            <ul className="space-y-1">
              {info.recentCommits.map((commit) => (
                <li key={commit.hash} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="shrink-0 font-mono text-[10.5px] text-text-faint">{commit.hash}</span>
                  <span className="min-w-0 flex-1 truncate text-text" title={commit.subject}>
                    {commit.subject}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── 共用小件 ─────────────────────────────────────────────────────────────────

function DockEmpty({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="text-text-faint opacity-40">{icon}</span>
      <p className="text-[12px] text-text-faint">{title}</p>
      <p className="px-4 text-[11px] text-text-faint opacity-70">{subtitle}</p>
    </div>
  );
}

function DockTabBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors',
        active ? 'bg-accent-soft text-accent-text' : 'text-text-faint hover:bg-hover hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
