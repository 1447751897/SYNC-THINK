// 工作区文件面板（NewMax 式）：文件 / Git / Review 三个视图，由对话标签行的
// 「工作区文件」标签挂载（右栏已移除，标签是唯一 chrome）。
// - 文件面板：搜索 + 预览项目内文本文件（主进程只读 IPC，防目录穿越）；
// - Git 面板：当前分支 / 未提交变更 / 最近提交；
// - Review 面板：本轮文件变更（A/M/D）+ 行级 diff。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { RunProcessView } from '@sync-think/protocol';
import type {
  ProjectContentMatch,
  ProjectTextLocation,
  SearchProjectContentResult,
} from '../../workspace-tools-contract.js';
import { FileContentPreview } from './FileContentPreview.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { countLineChanges, LineDiffView } from './ExecutionProcessBlock.js';

/** Preload bridge accessor (undefined in bare unit-test DOM). */
function dockBridge() {
  return window.syncThink?.runtime;
}

type WorkspaceFilesSection = 'changes' | 'all';

interface ProjectFileEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
}

interface GitInfo {
  branch: string | null;
  branches?: string[];
  changes: Array<{ status: string; path: string }>;
  recentCommits: Array<{
    hash: string;
    subject: string;
    files: Array<{ status: string; path: string }>;
    truncated: boolean;
  }>;
  isRepo: boolean;
}

export function WorkspaceFilesPanel(props: {
  projectFolder?: string;
  onOpenFile?(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab?(path: string, location?: ProjectTextLocation): void;
  onOpenReview?(view: RunProcessView): void;
  activeFilePath?: string | null;
  /** Latest run's file changes for the Review tab (NewMax-style per-run review). */
  reviewView?: RunProcessView | null;
}) {
  // NewMax's compact browser always starts on all files. Conversation changes
  // are a scope inside the browser, not a separate Git/review surface.
  const [section, setSection] = useState<WorkspaceFilesSection>('all');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const conversationChanges = props.reviewView?.fileChanges ?? [];

  return (
    <div
      className="shell-workspace-files-panel flex h-full min-h-0 flex-col"
      data-testid="workspace-files-panel"
      data-workspace-compact-file-browser="true"
    >
      <div className="shell-workspace-files-switcher shrink-0">
        <div
          className="shell-workspace-files-switcher__views"
          role="tablist"
          aria-label="工作区文件视图"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === 'changes'}
            className={clsx(
              'shell-workspace-files-switcher__tab',
              section === 'changes' && 'is-active',
            )}
            onClick={() => setSection('changes')}
          >
            对话文件 <span>{conversationChanges.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'all'}
            className={clsx(
              'shell-workspace-files-switcher__tab',
              section === 'all' && 'is-active',
            )}
            onClick={() => setSection('all')}
          >
            所有文件
          </button>
        </div>
        <div className="shell-workspace-files-switcher__actions">
          <button
            type="button"
            aria-label="搜索文件"
            aria-pressed={searchExpanded}
            onClick={() => {
              setSection('all');
              setSearchExpanded((open) => !open);
            }}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            aria-label="刷新"
            onClick={() => setRefreshRevision((revision) => revision + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {section === 'changes' ? (
          <div className="shell-dock-panel absolute inset-0 is-active">
            <ConversationFilesPanel
              changes={conversationChanges}
              projectFolder={props.projectFolder}
              activeFilePath={props.activeFilePath}
              onOpenFile={props.onOpenFile}
              onOpenFileInNewTab={props.onOpenFileInNewTab}
            />
          </div>
        ) : (
          <div className="shell-dock-panel absolute inset-0 is-active">
            <FilesPanel
              projectFolder={props.projectFolder}
              onOpenFile={props.onOpenFile}
              onOpenFileInNewTab={props.onOpenFileInNewTab}
              activeFilePath={props.activeFilePath}
              searchExpanded={searchExpanded}
              refreshRevision={refreshRevision}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationFilesPanel({
  changes,
  projectFolder,
  activeFilePath,
  onOpenFile,
  onOpenFileInNewTab,
}: {
  changes: NonNullable<RunProcessView['fileChanges']>;
  projectFolder?: string;
  activeFilePath?: string | null;
  onOpenFile?(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab?(path: string, location?: ProjectTextLocation): void;
}) {
  const groups = useMemo(() => {
    const next = new Map<string, typeof changes>();
    for (const change of changes) {
      const directory = reviewDirectory(change.path);
      const current = next.get(directory);
      if (current) current.push(change);
      else next.set(directory, [change]);
    }
    return [...next.entries()];
  }, [changes]);

  if (changes.length === 0) {
    return (
      <DockEmpty
        icon={<Folder size={22} />}
        title="暂无对话文件"
        subtitle="当前对话修改过的文件会显示在这里"
      />
    );
  }

  return (
    <div className="shell-conversation-files" role="list" aria-label="对话文件">
      {groups.map(([directory, items]) => (
        <div className="shell-conversation-files__group" key={directory}>
          <div className="shell-conversation-files__directory" title={directory}>
            <ChevronDown size={12} />
            <FolderOpen size={14} />
            <span>{directory}</span>
            <small>{items.length}</small>
          </div>
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              role="listitem"
              className={clsx(
                'shell-conversation-files__item',
                activeFilePath === item.path && 'is-active',
              )}
              title={reviewAbsolutePath(projectFolder, item.path)}
              onClick={() => (onOpenFile ?? onOpenFileInNewTab)?.(item.path)}
            >
              <FileTypeIcon path={item.path} size={14} />
              <span>{reviewFileName(item.path)}</span>
              <small>
                {item.action === 'created' ? 'A' : item.action === 'deleted' ? 'D' : 'M'}
              </small>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Review 面板（本轮文件变更 + 行级 diff） ──────────────────────────────────

function reviewDirectory(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '项目根目录';
}

function reviewFileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

function reviewAbsolutePath(projectFolder: string | undefined, path: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) {
    return path;
  }
  const root = projectFolder?.trim().replace(/[\\/]+$/, '');
  if (!root) return path;
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root}${separator}${path.replace(/^[.][\\/]/, '').replace(/[\\/]/g, separator)}`;
}

const DEFAULT_REVIEW_LIST_WIDTH = 288;
const MIN_REVIEW_LIST_WIDTH = 221;
const MAX_REVIEW_LIST_WIDTH = 600;
const MIN_REVIEW_DETAIL_WIDTH = 360;
const REVIEW_DIVIDER_WIDTH = 1;
const REVIEW_KEYBOARD_RESIZE_STEP = 16;

interface ReviewResizeDrag {
  startClientX: number;
  startWidth: number;
  pointerId: number;
  target: HTMLDivElement;
  previousCursor: string;
  previousUserSelect: string;
}

function reviewListWidthBounds(panelWidth: number): { min: number; max: number } {
  if (panelWidth <= 0) {
    return { min: MIN_REVIEW_LIST_WIDTH, max: MAX_REVIEW_LIST_WIDTH };
  }
  const availableWidth = Math.max(0, panelWidth - MIN_REVIEW_DETAIL_WIDTH - REVIEW_DIVIDER_WIDTH);
  const max = Math.min(MAX_REVIEW_LIST_WIDTH, availableWidth);
  return {
    min: Math.min(MIN_REVIEW_LIST_WIDTH, max),
    max,
  };
}

export function ReviewPanel({
  view,
  onOpenFile,
  onOpenFileInNewTab,
  projectFolder,
  standalone = false,
}: {
  view: RunProcessView | null;
  onOpenFile?(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab?(path: string, location?: ProjectTextLocation): void;
  projectFolder?: string;
  standalone?: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [reviewOptionsOpen, setReviewOptionsOpen] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [reviewListWidth, setReviewListWidth] = useState(DEFAULT_REVIEW_LIST_WIDTH);
  const [resizeBounds, setResizeBounds] = useState({
    min: MIN_REVIEW_LIST_WIDTH,
    max: MAX_REVIEW_LIST_WIDTH,
  });
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reviewListRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef<ReviewResizeDrag | null>(null);
  const desiredReviewListWidthRef = useRef(DEFAULT_REVIEW_LIST_WIDTH);
  const changes = useMemo(() => view?.fileChanges ?? [], [view]);
  const selected = changes.find((item) => item.path === selectedPath) ?? changes[0];
  const groupedChanges = useMemo(() => {
    const groups = new Map<string, typeof changes>();
    for (const item of changes) {
      const directory = reviewDirectory(item.path);
      const entries = groups.get(directory);
      if (entries) entries.push(item);
      else groups.set(directory, [item]);
    }
    return [...groups.entries()];
  }, [changes]);
  const changeStats = useMemo(() => {
    const stats = new Map<string, { added: number; removed: number }>();
    for (const change of changes) {
      const count = countLineChanges(change);
      if (count) stats.set(change.path, count);
    }
    return stats;
  }, [changes]);
  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const count of changeStats.values()) {
      added += count.added;
      removed += count.removed;
    }
    return { added, removed };
  }, [changeStats]);
  const selectedStats = selected ? changeStats.get(selected.path) : undefined;

  const currentPanelWidth = useCallback(() => {
    return panelRef.current?.getBoundingClientRect().width ?? 0;
  }, []);

  const applyReviewListWidth = useCallback(
    (value: number, panelWidth = currentPanelWidth()) => {
      const nextBounds = reviewListWidthBounds(panelWidth);
      desiredReviewListWidthRef.current = value;
      setResizeBounds(nextBounds);
      setReviewListWidth(Math.min(nextBounds.max, Math.max(nextBounds.min, value)));
    },
    [currentPanelWidth],
  );

  const finishResize = useCallback(() => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    if (drag.target.hasPointerCapture?.(drag.pointerId)) {
      drag.target.releasePointerCapture?.(drag.pointerId);
    }
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('blur', finishResize);
      finishResize();
    };
  }, [finishResize]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!standalone || !panel || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? panel.getBoundingClientRect().width;
      if (resizeDragRef.current) finishResize();
      const nextBounds = reviewListWidthBounds(width);
      setResizeBounds(nextBounds);
      setReviewListWidth(
        Math.min(nextBounds.max, Math.max(nextBounds.min, desiredReviewListWidthRef.current)),
      );
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [finishResize, standalone]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    const panelWidth = currentPanelWidth();
    const startWidth = reviewListRef.current?.getBoundingClientRect().width ?? reviewListWidth;
    if (
      !standalone ||
      !Number.isFinite(event.clientX) ||
      panelWidth <= 0 ||
      startWidth <= 0 ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeDragRef.current = {
      startClientX: event.clientX,
      startWidth,
      pointerId: event.pointerId,
      target: event.currentTarget,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    setResizeBounds(reviewListWidthBounds(panelWidth));
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const resizeWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !Number.isFinite(event.clientX)) return;
    const panelWidth = currentPanelWidth();
    const nextWidth = drag.startWidth - (event.clientX - drag.startClientX);
    applyReviewListWidth(nextWidth, panelWidth);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const panelWidth = currentPanelWidth();
    const bounds = reviewListWidthBounds(panelWidth);
    let next: number | undefined;
    if (event.key === 'Home') next = bounds.min;
    else if (event.key === 'End') next = bounds.max;
    else if (event.key === 'ArrowLeft') next = reviewListWidth + REVIEW_KEYBOARD_RESIZE_STEP;
    else if (event.key === 'ArrowRight') next = reviewListWidth - REVIEW_KEYBOARD_RESIZE_STEP;
    if (next === undefined) return;
    event.preventDefault();
    applyReviewListWidth(next, panelWidth);
  };

  const panelStyle = standalone
    ? ({
        '--shell-review-list-width': `${reviewListWidth}px`,
      } as CSSProperties)
    : undefined;

  if (!view || changes.length === 0) {
    return (
      <div
        ref={panelRef}
        className={clsx('shell-review-panel', standalone && 'is-standalone')}
        data-testid="review-panel"
        style={panelStyle}
      >
        <div className="shell-review-empty">
          <FileDiff size={22} />
          <div className="shell-review-empty__title">暂无本轮变更</div>
          <div className="shell-review-empty__hint">
            让 AI 修改文件后，这里会显示本轮的文件清单与行级 diff。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={clsx('shell-review-panel', standalone && 'is-standalone')}
      data-testid="review-panel"
      data-turn-review-workspace={standalone ? 'true' : undefined}
      data-resizing={isResizing ? 'true' : 'false'}
      style={panelStyle}
    >
      <div ref={reviewListRef} className="shell-review-list" role="list" aria-label="本轮变动文件">
        <div className="shell-review-list__title">
          <strong>本轮变动</strong>
          <span>{changes.length}</span>
        </div>
        {groupedChanges.map(([directory, items]) => (
          <div className="shell-review-list__group" key={directory}>
            <div className="shell-review-list__directory" title={directory}>
              <ChevronDown size={12} aria-hidden="true" />
              <FolderOpen size={13} aria-hidden="true" />
              <span>{directory}</span>
              <small>{items.length}</small>
            </div>
            {items.map((item) => {
              const stats = changeStats.get(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  role="listitem"
                  className={clsx(
                    'shell-review-list__item',
                    selected?.path === item.path && 'is-active',
                  )}
                  onClick={() => setSelectedPath(item.path)}
                  title={reviewAbsolutePath(projectFolder, item.path)}
                >
                  <FileTypeIcon path={item.path} size={13} className="shrink-0" />
                  <span className="shell-review-list__path">{reviewFileName(item.path)}</span>
                  {stats ? (
                    <span className="shell-review-list__stats">
                      <span>+{stats.added}</span>
                      <span>-{stats.removed}</span>
                    </span>
                  ) : (
                    <span
                      className={`shell-changes-card__badge is-${item.action}`}
                      data-action={item.action}
                    >
                      {item.action === 'created' ? 'A' : item.action === 'deleted' ? 'D' : 'M'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {standalone ? (
        <div
          role="separator"
          tabIndex={0}
          aria-label="调整本轮变动宽度"
          aria-orientation="vertical"
          aria-valuemin={Math.round(resizeBounds.min)}
          aria-valuemax={Math.round(resizeBounds.max)}
          aria-valuenow={Math.round(reviewListWidth)}
          className="shell-review-resizer"
          data-testid="review-list-resizer"
          onPointerDown={beginResize}
          onPointerMove={resizeWithPointer}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onDoubleClick={() => applyReviewListWidth(DEFAULT_REVIEW_LIST_WIDTH, currentPanelWidth())}
          onKeyDown={adjustWithKeyboard}
        />
      ) : null}
      <div className="shell-review-detail">
        {selected ? (
          <>
            <div className="shell-review-summary" data-review-header="true">
              <div className="shell-review-summary__stats">
                <strong data-review-scope="turn">上一轮</strong>
                <span className="is-added" data-review-total-additions="true">
                  +{totals.added}
                </span>
                <span className="is-removed" data-review-total-deletions="true">
                  -{totals.removed}
                </span>
              </div>
              <div className="shell-review-options">
                <button
                  type="button"
                  className="shell-review-options__trigger"
                  aria-label="审阅更多选项"
                  aria-expanded={reviewOptionsOpen}
                  onClick={() => setReviewOptionsOpen((open) => !open)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {reviewOptionsOpen ? (
                  <div className="shell-review-options__menu" role="menu">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={wrapLines}
                      onClick={() => setWrapLines((value) => !value)}
                    >
                      <span>自动换行</span>
                      {wrapLines ? <Check size={13} /> : null}
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={showWhitespace}
                      onClick={() => setShowWhitespace((value) => !value)}
                    >
                      <span>显示空白字符</span>
                      {showWhitespace ? <Check size={13} /> : null}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shell-review-detail__divider" />
            <div className="shell-review-detail__header" data-review-file-header="true">
              <FileTypeIcon path={selected.path} size={14} className="shrink-0" />
              <span
                className="shell-review-detail__path"
                data-review-selected-file="true"
                title={reviewAbsolutePath(projectFolder, selected.path)}
              >
                {selected.path}
              </span>
              {selectedStats ? (
                <span className="shell-review-detail__stats" data-review-selected-stats="true">
                  <span>+{selectedStats.added}</span>
                  <span>-{selectedStats.removed}</span>
                </span>
              ) : null}
              {onOpenFile || onOpenFileInNewTab ? (
                <button
                  type="button"
                  className="shell-review-detail__btn"
                  aria-label="打开"
                  title="打开文件"
                  onClick={() => (onOpenFileInNewTab ?? onOpenFile)?.(selected.path)}
                >
                  <ExternalLink size={13} />
                </button>
              ) : null}
            </div>
            <div className="shell-changes-card__diff">
              <LineDiffView
                oldText={selected.previousContent}
                newText={selected.content}
                path={selected.path}
                truncated={selected.previousTruncated}
                wrapLines={wrapLines}
                onWrapLinesChange={setWrapLines}
                showToolbar={false}
                showWhitespace={showWhitespace}
              />
            </div>
          </>
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
  onOpenFile,
  onOpenFileInNewTab,
  activeFilePath,
  searchExpanded = false,
  refreshRevision = 0,
}: {
  projectFolder?: string;
  onOpenFile?(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab?(path: string, location?: ProjectTextLocation): void;
  activeFilePath?: string | null;
  searchExpanded?: boolean;
  refreshRevision?: number;
}) {
  const [query, setQuery] = useState('');
  const [searchKind, setSearchKind] = useState<'filename' | 'content'>('filename');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [contentSearch, setContentSearch] = useState<SearchProjectContentResult>();
  const [contentError, setContentError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [selectedInternal, setSelectedInternal] = useState<string | null>(null);
  // 分屏模式下高亮跟随宿主的分屏文件；内嵌预览模式沿用内部选中态。
  const selected = onOpenFile ? (activeFilePath ?? null) : selectedInternal;
  const [preview, setPreview] = useState<{
    path: string;
    content: string | null;
    error: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // 树形状态：dir path ('' = root) → children；expanded 记录展开集合。
  const [dirs, setDirs] = useState<Record<string, TreeDirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const contentRequestRef = useRef(0);
  const searchMode = query.trim().length > 0;

  const loadDir = useCallback(
    (dir: string) => {
      const api = dockBridge();
      if (!projectFolder || !api?.listProjectDir) return;
      setDirs((current) => ({
        ...current,
        [dir]: {
          loaded: current[dir]?.loaded ?? false,
          loading: true,
          entries: current[dir]?.entries ?? [],
        },
      }));
      void api
        .listProjectDir({ root: projectFolder, dir })
        .then((result: { entries: ProjectFileEntry[] }) => {
          setDirs((current) => ({
            ...current,
            [dir]: { loaded: true, loading: false, entries: result.entries },
          }));
        })
        .catch(() => {
          setDirs((current) => ({
            ...current,
            [dir]: { loaded: true, loading: false, entries: [] },
          }));
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
  }, [projectFolder, loadDir, refreshRevision]);

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
    if (!projectFolder || !searchMode || searchKind !== 'filename') return;
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
  }, [projectFolder, query, searchKind, searchMode]);

  useEffect(() => {
    contentRequestRef.current += 1;
    const requestId = contentRequestRef.current;
    if (!projectFolder || !searchMode || searchKind !== 'content') {
      setContentSearch(undefined);
      setContentError(undefined);
      return;
    }
    const api = dockBridge();
    if (!api?.searchProjectContent) return;
    let cancelled = false;
    setLoading(true);
    setContentError(undefined);
    const timer = window.setTimeout(() => {
      void api
        .searchProjectContent({ root: projectFolder, query: query.trim(), maxResults: 200 })
        .then((result) => {
          if (!cancelled && requestId === contentRequestRef.current) setContentSearch(result);
        })
        .catch((error: unknown) => {
          if (cancelled || requestId !== contentRequestRef.current) return;
          setContentSearch(undefined);
          setContentError(error instanceof Error ? error.message : '内容搜索失败');
        })
        .finally(() => {
          if (!cancelled && requestId === contentRequestRef.current) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectFolder, query, searchKind, searchMode]);

  const openFile = useCallback(
    (
      path: string,
      location?: ProjectTextLocation,
      disposition: 'current' | 'new-tab' = 'current',
    ) => {
      if (disposition === 'new-tab' && onOpenFileInNewTab) {
        onOpenFileInNewTab(path, location);
        return;
      }
      // 分屏模式：直接交给宿主在主区域打开文件面板（IDE 式）。
      if (onOpenFile) {
        onOpenFile(path, location);
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
    [projectFolder, onOpenFile, onOpenFileInNewTab],
  );

  if (!projectFolder) {
    return (
      <DockEmpty
        icon={<Folder size={22} />}
        title="未绑定项目文件夹"
        subtitle="绑定后可在此浏览工作区文件"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {searchExpanded ? (
        <div className="shell-workspace-files-search shrink-0">
          <div className="shell-workspace-files-search__modes" role="group" aria-label="搜索范围">
            {(['filename', 'content'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-label={kind === 'filename' ? '文件名' : '内容'}
                aria-pressed={searchKind === kind}
                className={clsx(
                  'shell-workspace-files-search__mode',
                  searchKind === kind && 'is-active',
                )}
                onClick={() => setSearchKind(kind)}
              >
                {kind === 'filename' ? '文件名' : '内容'}
              </button>
            ))}
          </div>
          <div className="shell-workspace-files-search__field">
            <Search size={11} className="shell-workspace-files-search__icon" />
            <input
              className="shell-workspace-files-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchKind === 'filename' ? '搜索文件名…' : '搜索文件内容…'}
              spellCheck={false}
              data-testid="dock-files-search"
            />
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={clsx(
            'shrink-0 overflow-y-auto border-b border-border',
            !onOpenFile && selected ? 'max-h-[38%]' : 'flex-1',
          )}
        >
          {searchMode ? (
            loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-text-faint">
                <Loader2 size={12} className="animate-spin" /> 加载中…
              </div>
            ) : searchKind === 'content' ? (
              contentError ? (
                <div
                  className="flex items-start gap-2 px-3 py-3 text-[11.5px] text-error"
                  role="alert"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{contentError}</span>
                </div>
              ) : !contentSearch || contentSearch.results.length === 0 ? (
                <div className="px-3 py-3 text-[11.5px] text-text-faint">没有匹配的内容</div>
              ) : (
                <ContentSearchResults
                  result={contentSearch}
                  selected={selected}
                  onOpen={(match) =>
                    openFile(match.path, { line: match.line, column: match.column })
                  }
                  onOpenInNewTab={
                    onOpenFileInNewTab
                      ? (match) =>
                          openFile(
                            match.path,
                            { line: match.line, column: match.column },
                            'new-tab',
                          )
                      : undefined
                  }
                />
              )
            ) : files.length === 0 ? (
              <div className="px-3 py-3 text-[11.5px] text-text-faint">没有匹配的文件</div>
            ) : (
              <ul className="p-1">
                {files.map((file) => (
                  <li key={file.path}>
                    <div
                      className={clsx(
                        'shell-workspace-file-row',
                        selected === file.path ? 'is-active' : undefined,
                      )}
                      title={file.path}
                    >
                      <button
                        type="button"
                        className="shell-workspace-file-row__primary"
                        aria-label={
                          onOpenFileInNewTab
                            ? `在当前文件标签打开 ${file.path}`
                            : `打开文件 ${file.path}`
                        }
                        onClick={() => openFile(file.path)}
                      >
                        <FileTypeIcon path={file.path} size={12} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="max-w-[45%] shrink-0 truncate text-[10.5px] text-text-faint">
                          {file.path}
                        </span>
                      </button>
                      {onOpenFileInNewTab ? (
                        <button
                          type="button"
                          className="shell-workspace-file-row__new-tab"
                          aria-label={`在新文件标签打开 ${file.path}`}
                          title="在新文件标签打开"
                          onClick={() => openFile(file.path, undefined, 'new-tab')}
                        >
                          <ExternalLink size={11} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : searchKind === 'content' ? (
            <div className="px-3 py-3 text-[11.5px] text-text-faint">输入关键词搜索文件内容</div>
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
                onOpenFileInNewTab={
                  onOpenFileInNewTab ? (path) => openFile(path, undefined, 'new-tab') : undefined
                }
              />
            </div>
          )}
        </div>
        {!onOpenFile && selected ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
              <FileTypeIcon path={selected} size={12} className="shrink-0" />
              <span
                className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-text"
                title={selected}
              >
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
                <FileContentPreview text={preview?.content ?? ''} path={selected} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContentSearchResults({
  result: searchResult,
  selected,
  onOpen,
  onOpenInNewTab,
}: {
  result: SearchProjectContentResult;
  selected: string | null;
  onOpen(match: ProjectContentMatch): void;
  onOpenInNewTab?(match: ProjectContentMatch): void;
}) {
  return (
    <div>
      <ul className="p-1">
        {searchResult.results.map((result, index) => (
          <li key={`${result.path}:${result.line}:${result.column}:${index}`}>
            <div
              className={clsx(
                'shell-workspace-file-row shell-workspace-file-row--search',
                selected === result.path ? 'is-active' : undefined,
              )}
            >
              <button
                type="button"
                className="shell-workspace-file-row__primary shell-workspace-file-row__primary--search"
                aria-label={
                  onOpenInNewTab
                    ? `在当前文件标签打开 ${result.path} 第 ${result.line} 行第 ${result.column} 列`
                    : `打开 ${result.path} 第 ${result.line} 行第 ${result.column} 列`
                }
                onClick={() => onOpen(result)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileTypeIcon path={result.path} size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px]" title={result.path}>
                    {result.path}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-text-faint">
                    {result.line}:{result.column}
                  </span>
                </span>
                <span className="mt-0.5 block truncate pl-5 font-mono text-[10.5px] text-text-faint">
                  {result.preview}
                </span>
              </button>
              {onOpenInNewTab ? (
                <button
                  type="button"
                  className="shell-workspace-file-row__new-tab"
                  aria-label={`在新文件标签打开 ${result.path} 第 ${result.line} 行第 ${result.column} 列`}
                  title="在新文件标签打开"
                  onClick={() => onOpenInNewTab(result)}
                >
                  <ExternalLink size={11} />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {searchResult.truncated || searchResult.timedOut ? (
        <div className="border-t border-border px-3 py-2 text-[10px] text-text-faint">
          {searchResult.timedOut ? '搜索达到 5 秒上限，仅显示已找到的结果' : '仅显示前 200 条结果'}
        </div>
      ) : null}
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
  onOpenFileInNewTab,
}: {
  dir: string;
  depth: number;
  dirs: Record<string, TreeDirState>;
  expanded: Set<string>;
  selected: string | null;
  onToggleDir(dir: string): void;
  onOpenFile(path: string): void;
  onOpenFileInNewTab?(path: string): void;
}) {
  const state = dirs[dir];
  if (!state || (state.loading && !state.loaded)) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-text-faint"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <Loader2 size={11} className="animate-spin" /> 加载中…
      </div>
    );
  }
  if (state.entries.length === 0) {
    return (
      <div
        className="px-2 py-1 text-[11px] text-text-faint opacity-70"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
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
              className="shell-workspace-file-directory"
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
                onOpenFileInNewTab={onOpenFileInNewTab}
              />
            ) : null}
          </li>
        ) : (
          <li key={entry.path}>
            <div
              className={clsx(
                'shell-workspace-file-row',
                selected === entry.path ? 'is-active' : undefined,
              )}
              style={{ paddingLeft: 8 + depth * 14 + 15 }}
              title={entry.path}
            >
              <button
                type="button"
                className="shell-workspace-file-row__primary"
                aria-label={
                  onOpenFileInNewTab ? `在当前文件标签打开 ${entry.path}` : `打开文件 ${entry.path}`
                }
                onClick={() => onOpenFile(entry.path)}
              >
                <FileTypeIcon path={entry.path} size={12} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
              {onOpenFileInNewTab ? (
                <button
                  type="button"
                  className="shell-workspace-file-row__new-tab"
                  aria-label={`在新文件标签打开 ${entry.path}`}
                  title="在新文件标签打开"
                  onClick={() => onOpenFileInNewTab(entry.path)}
                >
                  <ExternalLink size={11} />
                </button>
              ) : null}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

// ─── 工作区（git）面板 ────────────────────────────────────────────────────────

export function WorkspacePanel({
  projectFolder,
  onOpenFile,
  onOpenFileInNewTab,
}: {
  projectFolder?: string;
  onOpenFile?(path: string): void;
  onOpenFileInNewTab?(path: string): void;
}) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // 提交展开状态：数据加载后默认展开最新一条。
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // 提交内文件树的目录展开状态。
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // 分支切换：picker 打开态 / 目标分支 / 脏工作区确认弹层 / 进行中 / 错误。
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [dirtyChanges, setDirtyChanges] = useState<Array<{ status: string; path: string }> | null>(
    null,
  );
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

  // 数据首次加载完成后，默认展开最新一条提交。
  useEffect(() => {
    if (!info || expandedCommits.size > 0) return;
    const latest = info.recentCommits[0];
    if (latest) setExpandedCommits(new Set([latest.hash]));
  }, [info, expandedCommits.size]);

  const toggleCommit = useCallback((hash: string) => {
    setExpandedCommits((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  /** 发起切换：先 check 探测；脏则弹确认（stash 后切 / 取消）。 */
  const requestCheckout = useCallback(
    (branch: string, strategy: 'check' | 'stash') => {
      const api = dockBridge();
      if (!projectFolder || !api?.gitCheckout) return;
      setSwitching(true);
      setSwitchError(null);
      void api
        .gitCheckout({ root: projectFolder, branch, strategy })
        .then(
          (result: {
            ok: boolean;
            dirty: boolean;
            changes: Array<{ status: string; path: string }>;
            error: string | null;
            stashed?: boolean;
          }) => {
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
          },
        )
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
    return (
      <DockEmpty
        icon={<GitBranch size={22} />}
        title="未绑定项目文件夹"
        subtitle="绑定后可查看分支与变更"
      />
    );
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
                      <div className="px-2 py-1.5 text-[11.5px] text-text-faint">
                        没有其他本地分支
                      </div>
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
              <AlertTriangle size={14} className="shrink-0 text-[var(--color-warning)]" />
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
                <li className="pl-7 text-[10.5px] text-text-faint">
                  … 其余 {dirtyChanges.length - 12} 项
                </li>
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
                className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-60"
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
                  <li className="pl-7 text-[11px] text-text-faint">
                    … 其余 {info.changes.length - 40} 项
                  </li>
                ) : null}
              </ul>
            )}
          </div>
          <div className="shrink-0 px-3 py-2">
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-faint">
              最近提交
            </div>
            <ul className="space-y-0.5">
              {info.recentCommits.map((commit) => {
                const commitExpanded = expandedCommits.has(commit.hash);
                return (
                  <li key={commit.hash} className="rounded-md">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11.5px] hover:bg-hover"
                      title={commit.subject}
                      onClick={() => toggleCommit(commit.hash)}
                    >
                      {commitExpanded ? (
                        <ChevronDown size={11} className="shrink-0 text-text-faint" />
                      ) : (
                        <ChevronRight size={11} className="shrink-0 text-text-faint" />
                      )}
                      <GitCommitHorizontal size={11} className="shrink-0 text-accent" />
                      <span className="shrink-0 font-mono text-[10.5px] text-text-faint">
                        {commit.hash}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-text" title={commit.subject}>
                        {commit.subject}
                      </span>
                    </button>
                    {commitExpanded ? (
                      <div className="mt-0.5 border-l border-border pl-1.5">
                        {commit.files.length === 0 ? (
                          <div className="px-2 py-1 text-[11px] text-text-faint opacity-70">
                            合并提交（无文件变更列表）
                          </div>
                        ) : (
                          <>
                            <CommitFileTree
                              nodes={buildCommitFileTree(commit.files)}
                              depth={0}
                              expandedDirs={expandedDirs}
                              onToggleDir={toggleDir}
                              onOpenFile={onOpenFile}
                              onOpenFileInNewTab={onOpenFileInNewTab}
                            />
                            {commit.truncated ? (
                              <div className="px-2 py-1 text-[10.5px] text-text-faint">
                                … 其余文件已省略
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── 提交文件树 ────────────────────────────────────────────────────────────────

/** 递归文件树节点（目录 / 文件）。 */
type CommitTreeNode = {
  name: string;
  full: string;
  kind: 'dir' | 'file';
  status?: string;
  children?: CommitTreeNode[];
};

/** 把提交变更的扁平路径列表构建为目录树。 */
function buildCommitFileTree(files: Array<{ status: string; path: string }>): CommitTreeNode[] {
  const root: CommitTreeNode[] = [];
  const dirMap = new Map<string, CommitTreeNode[]>();
  dirMap.set('', root);
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    let dir = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      const child = dir ? `${dir}/${segments[i]}` : segments[i]!;
      let children = dirMap.get(child);
      if (!children) {
        const node: CommitTreeNode = { name: segments[i]!, full: child, kind: 'dir', children: [] };
        dirMap.get(dir)!.push(node);
        children = node.children!;
        dirMap.set(child, children);
      }
      dir = child;
    }
    const leaf: CommitTreeNode = {
      name: segments[segments.length - 1]!,
      full: file.path,
      kind: 'file',
      status: file.status,
    };
    dirMap.get(dir)!.push(leaf);
  }
  return root;
}

/** 状态码 → 颜色 class（与「未提交变更」区块一致）。 */
function commitFileStatusClass(status: string): string {
  if (status.startsWith('A') || status.startsWith('?')) return 'text-[var(--color-success)]';
  if (status.startsWith('D') || status.startsWith('R')) return 'text-[var(--color-error)]';
  return 'text-accent';
}

function CommitFileTree({
  nodes,
  depth,
  expandedDirs,
  onToggleDir,
  onOpenFile,
  onOpenFileInNewTab,
}: {
  nodes: CommitTreeNode[];
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir(dir: string): void;
  onOpenFile?(path: string): void;
  onOpenFileInNewTab?(path: string): void;
}) {
  return (
    <ul>
      {nodes.map((node) =>
        node.kind === 'dir' && node.children ? (
          <li key={node.full}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11.5px] hover:bg-hover"
              style={{ paddingLeft: 4 + depth * 14 }}
              title={node.full}
              onClick={() => onToggleDir(node.full)}
            >
              {expandedDirs.has(node.full) ? (
                <ChevronDown size={10} className="shrink-0 text-text-faint" />
              ) : (
                <ChevronRight size={10} className="shrink-0 text-text-faint" />
              )}
              {expandedDirs.has(node.full) ? (
                <FolderOpen size={11} className="shrink-0 text-accent" />
              ) : (
                <Folder size={11} className="shrink-0 text-text-faint" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
            {expandedDirs.has(node.full) ? (
              <CommitFileTree
                nodes={node.children ?? []}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onOpenFileInNewTab={onOpenFileInNewTab}
              />
            ) : null}
          </li>
        ) : (
          <li key={node.full}>
            <div
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] hover:bg-hover"
              style={{ paddingLeft: 4 + depth * 14 + 13 }}
              title={node.full}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                aria-label={`打开文件 ${node.full}`}
                onClick={() => {
                  if (onOpenFile) onOpenFile(node.full);
                }}
              >
                <FileTypeIcon path={node.full} size={11} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-text">{node.name}</span>
              </button>
              {node.status ? (
                <span
                  className={clsx(
                    'shrink-0 font-mono text-[10px]',
                    commitFileStatusClass(node.status),
                  )}
                  title={node.status}
                >
                  {node.status}
                </span>
              ) : null}
              {onOpenFileInNewTab ? (
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-text-faint hover:bg-hover hover:text-text"
                  aria-label={`在新文件标签打开 ${node.full}`}
                  title="在新文件标签打开"
                  onClick={() => onOpenFileInNewTab(node.full)}
                >
                  <ExternalLink size={10} />
                </button>
              ) : null}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

// ─── 共用小件 ─────────────────────────────────────────────────────────────────

function DockEmpty({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="text-text-faint opacity-40">{icon}</span>
      <p className="text-[12px] text-text-faint">{title}</p>
      <p className="px-4 text-[11px] text-text-faint opacity-70">{subtitle}</p>
    </div>
  );
}
