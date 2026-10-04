import { useDiffContextMenu } from './use-diff-context-menu.js';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileCode2,
  FileDiff,
  FolderOpen,
  GitBranch,
  Globe,
  LoaderCircle,
  SquareTerminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import { highlightCodeLines, languageFromPath } from './code-highlight.js';
import { FileDiffToolbar, FileDiffViewport, formatFilePatch } from './FileDiffSurface.js';
import { CodeBlockSource } from './CodeBlockSource.js';
import { CopyTextButton } from './CopyTextButton.js';
import {
  DeferredFileDiff,
  needsDeferredFileDiff,
  type FileDiffCounts,
} from './DeferredFileDiff.js';
import { WordSegments, wordHighlightMap } from './word-diff.js';
import { useRunProcessPage } from './use-run-process-page.js';
import type {
  ExecutionProcessStep,
  FileChangeItem,
  ProcessToolKind,
  RunProcessView,
} from '@sync-think/protocol';
import { useAutoDisclosure } from './auto-disclosure.js';

function isStatusOnlyPreview(preview?: string): boolean {
  if (!preview) return true;
  if (preview === '已写入' || preview === '已创建') return true;
  return /^已(写入|创建)（\d+ bytes）$/.test(preview);
}

interface ExecutionProcessBlockProps {
  view: RunProcessView;
  nested?: boolean;
  onOpenChange?: (path: string) => void;
}

function StatusIcon({ status }: { status: ExecutionProcessStep['status'] }) {
  if (status === 'running') {
    return <LoaderCircle size={13} className="shell-process-spin text-accent" />;
  }
  if (status === 'error') {
    return <XCircle size={13} className="text-[var(--color-error)]" />;
  }
  if (status === 'done') {
    return <CheckCircle2 size={13} className="text-[var(--color-success)]" />;
  }
  return <CircleDashed size={13} className="text-text-faint" />;
}

function KindIcon({ kind }: { kind: ProcessToolKind }) {
  if (kind === 'read' || kind === 'write') return <FileCode2 size={13} />;
  if (kind === 'list') return <FolderOpen size={13} />;
  if (kind === 'bash') return <SquareTerminal size={13} />;
  if (kind === 'git') return <GitBranch size={13} />;
  if (kind === 'browser' || kind === 'search') return <Globe size={13} />;
  return <Wrench size={13} />;
}

export function formatExecutionStepTitle(step: ExecutionProcessStep): string {
  const base = step.zh || step.verb || step.toolName;
  const focus = step.path || step.command || step.url;
  const conciseFocus = focus
    ? focus.length > 72
      ? `${focus.slice(0, 30)}…${focus.slice(-38)}`
      : focus
    : undefined;
  const title = conciseFocus ? `${base} · ${conciseFocus}` : base;
  if (step.count && step.count > 1) return `${title} ×${step.count}`;
  return title;
}

function hasRichOutput(step: ExecutionProcessStep): boolean {
  if (step.error) return true;
  if (!step.preview) return false;
  return !isStatusOnlyPreview(step.preview);
}

/**
 * NewMax-style tool card:
 * - each step is its own card (no outer "执行过程" shell)
 * - header: status + Chinese title + chevron
 * - body: Path / Command / Output fields
 */
export function ExecutionProcessStepCard({
  step,
  onOpenChange,
  autoOpen = false,
  conversationId,
}: {
  step: ExecutionProcessStep;
  onOpenChange?: (path: string) => void;
  autoOpen?: boolean;
  conversationId?: string;
}) {
  const { open, toggle } = useAutoDisclosure({ autoOpen, resetKey: step.id });
  const title = formatExecutionStepTitle(step);
  const output = step.error || step.preview;
  const showOutput = hasRichOutput(step);
  const hasBody = Boolean(
    step.path ||
    step.command ||
    step.url ||
    showOutput ||
    step.exitCode !== undefined ||
    step.detailsRef,
  );

  return (
    <div className="shell-tool-card" data-status={step.status} data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="shell-tool-card__header"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="shell-tool-card__kind">
          <KindIcon kind={step.kind} />
        </span>
        <span className="shell-tool-card__title">{title}</span>
        {step.exitCode !== undefined ? (
          <span className="shell-tool-card__badge">exit {step.exitCode}</span>
        ) : null}
        <span className="shell-tool-card__status">
          <StatusIcon status={step.status} />
        </span>
        <ChevronDown size={14} className={`shell-tool-card__chevron ${open ? 'is-open' : ''}`} />
      </button>

      {open && hasBody ? (
        <div className="shell-tool-card__body">
          {step.path ? (
            <div className="shell-tool-card__field">
              <div className="shell-tool-card__field-key">Path</div>
              <button
                type="button"
                className="shell-tool-card__field-path"
                onClick={() => onOpenChange?.(step.path!)}
                title={step.kind === 'write' ? '在 Changes 中查看' : step.path}
              >
                {step.path}
              </button>
            </div>
          ) : null}

          {step.command ? (
            <div className="shell-tool-card__field">
              <div className="shell-tool-card__field-key">Command</div>
              <code className="shell-tool-card__field-code">{step.command}</code>
            </div>
          ) : null}

          {step.url ? (
            <div className="shell-tool-card__field">
              <div className="shell-tool-card__field-key">URL</div>
              <code className="shell-tool-card__field-code">{step.url}</code>
            </div>
          ) : null}

          {step.detailsRef ? (
            <ConversationContentScope.Provider value={conversationId}>
              <DeferredToolContent
                deferred={step.detailsRef}
                preview="包含较大的附加字段；完整事件展示数据按需读取。"
                label="事件详情"
                testId="process-card-event-details"
              />
            </ConversationContentScope.Provider>
          ) : null}
          {showOutput && output ? (
            <div className="shell-tool-card__field">
              <div className="shell-tool-card__field-key">Output</div>
              <pre className={`shell-tool-card__output ${step.error ? 'is-error' : ''}`}>
                {output}
              </pre>
            </div>
          ) : null}

          {!showOutput && step.preview ? (
            <div className="shell-tool-card__field">
              <div className="shell-tool-card__field-key">Result</div>
              <div className="shell-tool-card__result">{step.preview}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ExecutionProcessBlock({
  view: sourceView,
  nested = false,
  onOpenChange,
}: ExecutionProcessBlockProps) {
  const { process, controls } = useRunProcessPage(sourceView, 'steps', sourceView.conversationId, {
    accumulate: true,
  });
  const view = process ?? sourceView;
  if (view.steps.length === 0) return null;

  return (
    <div
      className={`shell-tool-stack ${nested ? 'is-nested' : ''}`}
      data-testid="execution-process"
    >
      {controls}
      {view.steps.map((step) => (
        <ExecutionProcessStepCard
          key={step.id}
          step={step}
          onOpenChange={onOpenChange}
          conversationId={view.conversationId}
        />
      ))}
    </div>
  );
}

function actionLabel(action: 'created' | 'edited' | 'deleted'): string {
  if (action === 'created') return '新增';
  if (action === 'deleted') return '删除';
  return '修改';
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function fileDir(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const separator = normalized.includes('\\') ? '\\' : '/';
  const parts = normalized.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join(separator) : '';
}

function projectRelativeFilePath(projectFolder: string | undefined, path: string): string {
  if (!projectFolder) return path.replace(/^\.[\\/]/, '');
  const normalizedPath = path.replace(/\\/g, '/');
  const root = projectFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  const windowsPath = /^[a-z]:/i.test(root) || root.startsWith('//');
  const prefix = `${root}/`;
  const insideProject = windowsPath
    ? normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())
    : normalizedPath.startsWith(prefix);
  return insideProject ? normalizedPath.slice(prefix.length) : path.replace(/^\.[\\/]/, '');
}

export function looksLikeUnifiedDiff(text: string): boolean {
  return /(?:^|\n)@@\s+-\d/.test(text.replace(/\r\n/g, '\n'));
}

export type UnifiedDiffRowKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';

export interface UnifiedDiffRow {
  kind: UnifiedDiffRowKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** Turn a stored unified diff preview into numbered add/del/context rows. */
export function parseUnifiedDiff(text: string): UnifiedDiffRow[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const lines = raw.length > 1 && raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw;
  const rows: UnifiedDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', text: line });
      continue;
    }
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('\\')
    ) {
      rows.push({ kind: 'meta', text: line });
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), newLine: newLine || undefined });
      if (newLine) newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      rows.push({ kind: 'del', text: line.slice(1), oldLine: oldLine || undefined });
      if (oldLine) oldLine += 1;
      continue;
    }
    const body = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      kind: 'ctx',
      text: body,
      oldLine: oldLine || undefined,
      newLine: newLine || undefined,
    });
    if (oldLine) oldLine += 1;
    if (newLine) newLine += 1;
  }
  return rows;
}

export function UnifiedDiffPreview({ text, path }: { text: string; path?: string }) {
  const diffContextMenu = useDiffContextMenu();
  const rows = useMemo(() => parseUnifiedDiff(text), [text]);
  const language = languageFromPath(path);
  const htmlLines = useMemo(() => {
    const source = rows
      .map((row) =>
        row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx' ? row.text : '',
      )
      .join('\n');
    return highlightCodeLines(source, language);
  }, [language, rows]);

  return (
    <div
      className="shell-changes-card__diff-body shell-beui-diff"
      onContextMenu={(event) => diffContextMenu(event, { path, patch: text })}
    >
      <FileDiffToolbar
        copyText={text}
        additions={rows.filter((row) => row.kind === 'add').length}
        deletions={rows.filter((row) => row.kind === 'del').length}
      />
      <FileDiffViewport path={path} label="文件差异预览">
        {rows.map((row, index) => (
          <div
            key={`${row.kind}:${row.oldLine ?? ''}:${row.newLine ?? ''}:${index}`}
            className={`shell-changes-card__diff-line is-${row.kind}`}
            data-kind={row.kind}
          >
            <span className="shell-changes-card__diff-no" data-old-line aria-hidden="true">
              {row.oldLine ?? ''}
            </span>
            <span className="shell-changes-card__diff-no" data-new-line aria-hidden="true">
              {row.newLine ?? ''}
            </span>
            <span className="shell-changes-card__diff-gutter" aria-hidden="true">
              {row.kind === 'add'
                ? '+'
                : row.kind === 'del'
                  ? '−'
                  : row.kind === 'hunk'
                    ? '@'
                    : ' '}
            </span>
            {htmlLines && (row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx') ? (
              <code
                className="shell-changes-card__diff-text hljs"
                dangerouslySetInnerHTML={{
                  __html: htmlLines[index] && htmlLines[index]!.length ? htmlLines[index]! : ' ',
                }}
              />
            ) : (
              <code className="shell-changes-card__diff-text">{row.text || ' '}</code>
            )}
          </div>
        ))}
      </FileDiffViewport>
    </div>
  );
}

export function resolveAbsoluteProjectPath(projectFolder?: string, filePath?: string): string {
  const path = filePath?.trim();
  if (!path) return '';
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) {
    return path;
  }

  const root = projectFolder?.trim().replace(/[\\/]+$/, '');
  if (!root) return path;
  const separator = root.includes('\\') ? '\\' : '/';
  const relative = path.replace(/^[.][\\/]/, '').replace(/^[\\/]+/, '');
  return `${root}${separator}${relative.replace(/[\\/]/g, separator)}`;
}

/**
 * Be UI line surface for file previews:
 * soft gutter (no hard vertical rule), optional syntax highlight, editor density.
 */
export function CodePreview({
  text,
  path,
  maxHeight,
  compact = false,
  highlightLine,
}: {
  text: string;
  path?: string;
  maxHeight?: number | string;
  compact?: boolean;
  highlightLine?: number;
}) {
  const language = languageFromPath(path);
  const previewRef = useRef<HTMLDivElement>(null);
  const normalized = text.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const display =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

  const htmlLines = useMemo(
    () => highlightCodeLines(normalized.replace(/\n$/, ''), language),
    [language, normalized],
  );

  const style =
    maxHeight !== undefined
      ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }
      : undefined;

  useEffect(() => {
    if (!highlightLine || highlightLine < 1) return;
    const frame = window.requestAnimationFrame(() => {
      const target = previewRef.current?.querySelector<HTMLElement>(
        `[data-line="${Math.floor(highlightLine)}"]`,
      );
      const viewport = previewRef.current;
      if (viewport && target) {
        // Focus the line inside this document without moving the surrounding chat.
        const lineTop =
          target.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop;
        viewport.scrollTop = Math.max(
          0,
          lineTop - (viewport.clientHeight - target.offsetHeight) / 2,
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightLine, normalized]);

  return (
    <div
      ref={previewRef}
      className={`shell-code-preview shell-agent-code shell-beui-code is-document ${compact ? 'is-compact' : ''}`}
      role="region"
      aria-label="文件内容预览"
      tabIndex={0}
      data-wrap="true"
      style={style}
      data-language={language || 'text'}
    >
      <CodeBlockSource
        lines={display}
        highlighted={htmlLines}
        language={language || 'text'}
        focusedLines={highlightLine ? new Set([highlightLine]) : undefined}
      />
    </div>
  );
}

export function FileChangeDiff({
  item,
  conversationId,
  streaming = false,
  onCountsChange,
}: {
  item: FileChangeItem;
  conversationId?: string;
  streaming?: boolean;
  onCountsChange?: (counts: FileDiffCounts) => void;
}) {
  if (needsDeferredFileDiff(item))
    return (
      <DeferredFileDiff
        item={item}
        conversationId={conversationId}
        onCountsChange={onCountsChange}
      />
    );
  const before = item.previousContent ?? (item.action === 'created' ? '' : undefined);
  const after = item.content ?? (item.action === 'deleted' ? '' : undefined);
  if (before !== undefined && after !== undefined)
    return (
      <LineDiffView
        oldText={before}
        newText={after}
        path={item.path}
        truncated={item.previousTruncated}
        streaming={streaming}
      />
    );
  if (item.preview && looksLikeUnifiedDiff(item.preview))
    return <UnifiedDiffPreview text={item.preview} path={item.path} />;
  return (
    <div className="shell-beui-diff shell-beui-diff__fallback">
      <p className="shell-deferred-content__notice">缺少完整前后快照，以下为已记录的内容预览。</p>
      {item.preview && !isStatusOnlyPreview(item.preview) ? (
        <CodePreview text={item.preview} path={item.path} compact maxHeight={220} />
      ) : null}
    </div>
  );
}

const FILE_CHANGES_CARD_PREVIEW_LIMIT = 4;

export function FileChangesCard({
  view: sourceView,
  nested = false,
  onOpenChange,
  onOpenReview,
  projectFolder,
  conversationId = sourceView.conversationId,
}: {
  view: RunProcessView;
  nested?: boolean;
  /** Opens the file in a neighboring file pane. */
  onOpenChange?: (path: string) => void;
  onOpenReview?: (view: RunProcessView) => void;
  projectFolder?: string;
  conversationId?: string;
}) {
  const { process, controls } = useRunProcessPage(sourceView, 'fileChanges', conversationId);
  const view = process ?? sourceView;
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [visitedPaths, setVisitedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [loadedCounts, setLoadedCounts] = useState<
    ReadonlyMap<string, { item: FileChangeItem; counts: FileDiffCounts }>
  >(() => new Map());
  const disclosureId = useId();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pathTooltip, setPathTooltip] = useState<{
    anchor: HTMLButtonElement;
    itemKey: string;
    path: string;
  } | null>(null);
  const pathTooltipId = useId();

  if (view.fileChanges.length === 0) return null;

  const itemKeyFor = (item: FileChangeItem) =>
    `${view.runId}:${item.toolCallId ?? ''}:${item.action}:${item.path}`;
  const countsFor = (item: FileChangeItem) => {
    const cached = loadedCounts.get(itemKeyFor(item));
    return countLineChanges(item) ?? (cached?.item === item ? cached.counts : undefined);
  };
  const totals = view.fileChanges.reduce(
    (acc, item) => {
      const counts = countsFor(item);
      if (!counts) return { ...acc, unknown: true };
      return {
        added: acc.added + counts.added,
        removed: acc.removed + counts.removed,
        countable: true,
        unknown: acc.unknown,
      };
    },
    {
      added: 0,
      removed: 0,
      countable: false,
      unknown: (view.pages?.fileChanges.total ?? view.fileChanges.length) > view.fileChanges.length,
    },
  );
  const previewItems = view.fileChanges.slice(0, FILE_CHANGES_CARD_PREVIEW_LIMIT);
  const overflowItems = view.fileChanges.slice(FILE_CHANGES_CARD_PREVIEW_LIMIT);
  const overflowCount = overflowItems.length;
  const fileCount = view.pages?.fileChanges.total ?? view.fileChanges.length;

  const revealFile = (itemKey: string, toggle: boolean) => {
    setVisitedPaths((previous) => new Set(previous).add(itemKey));
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (toggle && next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  const renderChangeItems = (items: readonly FileChangeItem[]) =>
    items.map((item) => {
      const itemKey = itemKeyFor(item);
      const canExpand =
        !isStatusOnlyPreview(item.preview) ||
        ((item.previousContent !== undefined || item.action === 'created') &&
          (item.content !== undefined || item.action === 'deleted')) ||
        needsDeferredFileDiff(item);
      const open = expandedPaths.has(itemKey);
      const mounted = visitedPaths.has(itemKey);
      const contentId = `${disclosureId}-${encodeURIComponent(itemKey)}`;
      const counts = countsFor(item);
      const absolutePath = resolveAbsoluteProjectPath(projectFolder, item.path);
      const relativePath = projectRelativeFilePath(projectFolder, item.path);
      const name = fileName(relativePath);
      const extensionIndex = name.lastIndexOf('.');
      const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
      const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
      const deleted = item.action === 'deleted';
      return (
        <li key={itemKey} className={`shell-changes-card__item ${open ? 'is-open' : ''}`}>
          <div className="shell-changes-card__row">
            <button
              type="button"
              className="shell-changes-card__file"
              aria-expanded={open}
              aria-controls={contentId}
              aria-disabled={!canExpand}
              onClick={() => {
                if (canExpand) revealFile(itemKey, true);
              }}
              onMouseEnter={(event) => {
                setPathTooltip({ anchor: event.currentTarget, itemKey, path: absolutePath });
              }}
              onMouseLeave={(event) => {
                setPathTooltip((current) =>
                  current?.anchor === event.currentTarget ? null : current,
                );
              }}
              onFocus={(event) => {
                setPathTooltip({ anchor: event.currentTarget, itemKey, path: absolutePath });
              }}
              onBlur={(event) => {
                setPathTooltip((current) =>
                  current?.anchor === event.currentTarget ? null : current,
                );
              }}
              aria-describedby={pathTooltip?.itemKey === itemKey ? pathTooltipId : undefined}
              aria-label={open ? `收起 ${item.path} diff` : `展开 ${item.path} diff`}
            >
              <ChevronDown
                size={13}
                className={`shell-changes-card__chevron ${open ? 'is-open' : ''}`}
                aria-hidden="true"
              />
              <span className="shell-changes-card__file-type" aria-hidden="true">
                <FileCode2 size={16} />
              </span>
              <span className="shell-changes-card__identity">
                <span className="shell-changes-card__name">
                  <span className="shell-changes-card__name-stem">{stem}</span>
                  {extension ? (
                    <span className="shell-changes-card__name-extension">{extension}</span>
                  ) : null}
                </span>
                <span className="shell-changes-card__dir">
                  {fileDir(relativePath) || '项目根目录'}
                </span>
              </span>
              <span className="shell-changes-card__file-meta">
                <span className="shell-changes-card__action-label" data-action={item.action}>
                  {actionLabel(item.action)}
                </span>
                {counts && (counts.added > 0 || counts.removed > 0) ? (
                  <span
                    className="shell-changes-card__file-lines"
                    aria-label={`新增 ${counts.added} 行，删除 ${counts.removed} 行`}
                  >
                    {counts.added > 0 ? <span className="is-add">+{counts.added}</span> : null}
                    {counts.removed > 0 ? <span className="is-del">−{counts.removed}</span> : null}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              className="shell-changes-card__open-file"
              disabled={deleted ? !canExpand : !onOpenChange}
              onClick={() => (deleted ? revealFile(itemKey, false) : onOpenChange?.(item.path))}
              aria-label={deleted ? `查看旧版本 ${item.path}` : `打开文件 ${item.path}`}
              title={deleted ? '查看已删除文件的旧内容' : '在相邻窗格打开文件'}
            >
              <span className="shell-changes-card__open-label">
                {deleted ? '查看旧版本' : '打开文件'}
              </span>
              {deleted ? (
                <FileDiff size={13} aria-hidden="true" />
              ) : (
                <ArrowUpRight size={13} aria-hidden="true" />
              )}
            </button>
          </div>
          <div id={contentId} className="shell-beui-diff-disclosure" hidden={!open}>
            {mounted ? (
              <FileChangeDiff
                item={item}
                conversationId={conversationId}
                onCountsChange={(nextCounts) => {
                  setLoadedCounts((previous) => {
                    const current = previous.get(itemKey);
                    if (
                      current?.item === item &&
                      current.counts.added === nextCounts.added &&
                      current.counts.removed === nextCounts.removed
                    )
                      return previous;
                    return new Map(previous).set(itemKey, { item, counts: nextCounts });
                  });
                }}
              />
            ) : null}
          </div>
        </li>
      );
    });

  return (
    <section
      className={`shell-changes-card shell-beui-changes ${nested ? 'is-nested' : ''}`}
      aria-label="文件变更"
    >
      <div className="shell-changes-card__header">
        <div className="shell-changes-card__summary">
          <span className="shell-changes-card__title">文件变更</span>
          <span className="shell-changes-card__count" aria-label={`${fileCount} 个文件`}>
            {fileCount}
          </span>
          {totals.countable && !totals.unknown && (totals.added > 0 || totals.removed > 0) ? (
            <span
              className="shell-changes-card__lines"
              aria-label={`总计新增 ${totals.added} 行，删除 ${totals.removed} 行`}
            >
              {totals.added > 0 ? <span className="is-add">+{totals.added}</span> : null}
              {totals.removed > 0 ? <span className="is-del">−{totals.removed}</span> : null}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="shell-changes-card__review"
          disabled={!onOpenReview}
          onClick={() => onOpenReview?.(conversationId ? { ...view, conversationId } : view)}
          title="审阅本轮文件修改"
        >
          查看全部变更 <ArrowUpRight size={12} aria-hidden="true" />
        </button>
      </div>
      {controls}
      <ul className="shell-changes-card__list">{renderChangeItems(previewItems)}</ul>
      {overflowCount > 0 ? (
        <>
          <div
            className={`shell-changes-card__overflow${overflowOpen ? ' is-open' : ''}`}
            data-testid="file-changes-overflow"
            hidden={!overflowOpen}
          >
            <div className="shell-changes-card__overflow-inner">
              <ul className="shell-changes-card__list is-overflow">
                {renderChangeItems(overflowItems)}
              </ul>
            </div>
          </div>
          <button
            type="button"
            className="shell-changes-card__more"
            data-testid="file-changes-overflow-toggle"
            aria-expanded={overflowOpen}
            aria-label={overflowOpen ? '收起其余文件' : `展开其余 ${overflowCount} 个文件`}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <ChevronDown
              size={13}
              className={`shell-changes-card__more-chevron${overflowOpen ? ' is-open' : ''}`}
              aria-hidden="true"
            />
            <span>{overflowOpen ? '收起其余文件' : `显示其余 ${overflowCount} 个文件`}</span>
          </button>
        </>
      ) : null}
      {pathTooltip ? (
        <FilePathTooltip
          id={pathTooltipId}
          anchor={pathTooltip.anchor}
          absolutePath={pathTooltip.path}
        />
      ) : null}
    </section>
  );
}

function FilePathTooltip({
  id,
  anchor,
  absolutePath,
}: {
  id: string;
  anchor: HTMLButtonElement;
  absolutePath: string;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !anchor.isConnected) return;

      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 7;
      const maximumLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
      const left = Math.min(Math.max(margin, anchorRect.left + 7), maximumLeft);
      const fitsAbove = anchorRect.top - gap - tooltipRect.height >= margin;
      const overflowsBelow = anchorRect.bottom + gap + tooltipRect.height > viewportHeight - margin;
      const preferredTop =
        overflowsBelow && fitsAbove
          ? anchorRect.top - gap - tooltipRect.height
          : anchorRect.bottom + gap;
      const maximumTop = Math.max(margin, viewportHeight - tooltipRect.height - margin);
      const top = Math.min(Math.max(margin, preferredTop), maximumTop);

      setPosition({ left, top });
    };

    updatePosition();
    // Coalesced to one measurement per frame: this tooltip anchors to a path
    // inside the streaming tool output, so it re-measures while the message list
    // scrolls. Binding visualViewport as well means zoom/on-screen-keyboard
    // changes go through the same single scheduled read.
    let frame: number | null = null;
    const scheduledUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updatePosition();
      });
    };
    window.addEventListener('resize', scheduledUpdate);
    window.visualViewport?.addEventListener('resize', scheduledUpdate);
    window.visualViewport?.addEventListener('scroll', scheduledUpdate);
    document.addEventListener('scroll', scheduledUpdate, true);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      window.removeEventListener('resize', scheduledUpdate);
      window.visualViewport?.removeEventListener('resize', scheduledUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduledUpdate);
      document.removeEventListener('scroll', scheduledUpdate, true);
    };
  }, [absolutePath, anchor]);

  return createPortal(
    <span
      ref={tooltipRef}
      id={id}
      className="shell-changes-card__path-tip"
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      {absolutePath}
    </span>,
    document.body,
  );
}

interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  oldLine?: number;
  newLine?: number;
  text: string;
}

const LINE_DIFF_MAX_ROWS = 400;

/**
 * Compute a line-level LCS diff between two texts. Returns undefined when a
 * snapshot is missing or the file is too large to diff (UI degrades).
 */
export function computeLineDiff(
  oldText: string | undefined,
  newText: string | undefined,
): DiffLine[] | undefined {
  if (oldText === undefined || newText === undefined) return undefined;
  const splitLines = (text: string) => {
    if (!text) return [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length > LINE_DIFF_MAX_ROWS || newLines.length > LINE_DIFF_MAX_ROWS) {
    return undefined;
  }
  const n = oldLines.length;
  const m = newLines.length;
  const width = m + 1;
  const matrix = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      matrix[i * width + j] =
        oldLines[i] === newLines[j]
          ? matrix[(i + 1) * width + j + 1] + 1
          : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ kind: 'ctx', oldLine: i + 1, newLine: j + 1, text: oldLines[i]! });
      i++;
      j++;
    } else if (matrix[(i + 1) * width + j] >= matrix[i * width + j + 1]) {
      lines.push({ kind: 'del', oldLine: i + 1, text: oldLines[i]! });
      i++;
    } else {
      lines.push({ kind: 'add', newLine: j + 1, text: newLines[j]! });
      j++;
    }
  }
  while (i < n) {
    lines.push({ kind: 'del', oldLine: i + 1, text: oldLines[i]! });
    i++;
  }
  while (j < m) {
    lines.push({ kind: 'add', newLine: j + 1, text: newLines[j]! });
    j++;
  }
  return lines;
}

/** Added/removed line counts for a change item. Undefined when not countable. */
export function countLineChanges(
  item: Pick<
    FileChangeItem,
    | 'action'
    | 'previousContent'
    | 'content'
    | 'contentRef'
    | 'previousContentRef'
    | 'contentKind'
    | 'previousTruncated'
  >,
): { added: number; removed: number } | undefined {
  if (item.previousTruncated || needsDeferredFileDiff(item)) return undefined;
  if (item.action === 'created') {
    if (item.content === undefined) return undefined;
    const lines = item.content.replace(/\r\n/g, '\n').split('\n');
    const count =
      lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    return { added: count, removed: 0 };
  }
  if (item.action === 'deleted') {
    if (item.previousContent === undefined) return undefined;
    const lines = item.previousContent.replace(/\r\n/g, '\n').split('\n');
    const count =
      lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    return { added: 0, removed: count };
  }
  const diff = computeLineDiff(item.previousContent, item.content);
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'add') added++;
    else if (line.kind === 'del') removed++;
  }
  return { added, removed };
}

/**
 * Lightweight line-level diff view (NewMax-style Review body).
 * Purely presentational: LCS diff computed once, rendered with +/- gutters.
 */
export function LineDiffView({
  oldText,
  newText,
  path,
  truncated = false,
  wrapLines,
  onWrapLinesChange,
  showToolbar = true,
  showWhitespace = false,
  wordLevel = false,
  showLineNumbers = true,
  streaming = false,
}: {
  oldText: string | undefined;
  newText: string | undefined;
  path?: string;
  truncated?: boolean;
  wrapLines?: boolean;
  onWrapLinesChange?(wrap: boolean): void;
  showToolbar?: boolean;
  showWhitespace?: boolean;
  wordLevel?: boolean;
  showLineNumbers?: boolean;
  streaming?: boolean;
}) {
  const diffContextMenu = useDiffContextMenu();
  const lines = useMemo(
    () => (truncated ? undefined : computeLineDiff(oldText, newText)),
    [oldText, newText, truncated],
  );
  const wordHighlights = useMemo(
    () => (wordLevel && lines ? wordHighlightMap(lines) : undefined),
    [wordLevel, lines],
  );
  const language = languageFromPath(path);
  const oldHighlight = useMemo(
    () => (lines ? highlightCodeLines(oldText ?? '', language) : undefined),
    [lines, oldText, language],
  );
  const newHighlight = useMemo(
    () => (lines ? highlightCodeLines(newText ?? '', language) : undefined),
    [lines, newText, language],
  );
  const [internalWrap, setInternalWrap] = useState(true);
  const wrap = wrapLines ?? internalWrap;
  if (!lines) {
    return (
      <div className="shell-changes-card__diff-empty">
        {truncated
          ? '文件过大，已截断快照，无法显示行级 diff'
          : oldText === undefined
            ? '无写前快照，无法显示行级 diff'
            : '文件过大，无法显示行级 diff'}
      </div>
    );
  }
  const formatChanged = oldText !== newText && lines.every((line) => line.kind === 'ctx');
  const patch =
    !formatChanged && oldText !== undefined && newText !== undefined
      ? formatFilePatch(path ?? 'file', oldText, newText, lines)
      : undefined;
  return (
    <div
      className="shell-changes-card__diff-body shell-beui-diff"
      onContextMenu={(event) => diffContextMenu(event, { path, patch, newText })}
      data-state={streaming ? 'streaming' : 'complete'}
    >
      {showToolbar ? (
        <FileDiffToolbar
          additions={lines.filter((line) => line.kind === 'add').length}
          deletions={lines.filter((line) => line.kind === 'del').length}
          wrap={wrap}
          onWrapChange={(value) => {
            setInternalWrap(value);
            onWrapLinesChange?.(value);
          }}
          copyText={patch}
        >
          <CopyTextButton text={newText ?? ''} label="复制修改后内容" compact />
        </FileDiffToolbar>
      ) : null}
      {formatChanged ? (
        <p className="shell-deferred-content__notice">文本行相同，但换行符或末尾换行发生变化。</p>
      ) : null}
      <FileDiffViewport
        path={path}
        wrap={wrap}
        showLineNumbers={showLineNumbers}
        streaming={streaming}
        revision={lines}
      >
        {lines.map((line, index) => {
          const segments = wordHighlights?.get(index);
          return (
            <div
              key={index}
              className={`shell-changes-card__diff-line is-${line.kind}`}
              data-kind={line.kind}
            >
              {showLineNumbers ? (
                <>
                  <span className="shell-changes-card__diff-no" data-old-line aria-hidden="true">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="shell-changes-card__diff-no" data-new-line aria-hidden="true">
                    {line.newLine ?? ''}
                  </span>
                </>
              ) : null}
              <span className="shell-changes-card__diff-gutter" aria-hidden="true">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
              </span>
              {segments ? (
                <code className="shell-changes-card__diff-text">
                  <WordSegments segments={segments} />
                </code>
              ) : !showWhitespace && (line.kind === 'del' ? oldHighlight : newHighlight) ? (
                <code
                  className="shell-changes-card__diff-text hljs"
                  dangerouslySetInnerHTML={{
                    __html:
                      (line.kind === 'del'
                        ? oldHighlight?.[(line.oldLine ?? 1) - 1]
                        : newHighlight?.[(line.newLine ?? 1) - 1]) || ' ',
                  }}
                />
              ) : (
                <code className="shell-changes-card__diff-text">
                  {showWhitespace
                    ? (line.text || ' ').replace(/\t/g, '→\t').replace(/ /g, '·')
                    : line.text || ' '}
                </code>
              )}
            </div>
          );
        })}
      </FileDiffViewport>
    </div>
  );
}

export { actionLabel, fileDir, fileName, isStatusOnlyPreview };
