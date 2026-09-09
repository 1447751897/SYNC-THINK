import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
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
import { CopyTextButton } from './CopyTextButton.js';
import { DeferredFileDiff, needsDeferredFileDiff } from './DeferredFileDiff.js';
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
  if (action === 'created') return '已创建';
  if (action === 'deleted') return '已删除';
  return '已修改';
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

export function UnifiedDiffPreview({
  text,
  path,
}: {
  text: string;
  path?: string;
}) {
  const rows = useMemo(() => parseUnifiedDiff(text), [text]);
  const language = languageFromPath(path);
  const htmlLines = useMemo(() => {
    const source = rows
      .map((row) => (row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx' ? row.text : ''))
      .join('\n');
    return highlightCodeLines(source, language);
  }, [language, rows]);

  return (
    <div className="shell-changes-card__diff-body">
      <div
        className="shell-changes-card__diff-lines is-wrap"
        data-path={path}
        role="region"
        aria-label="文件差异预览"
      >
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
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : row.kind === 'hunk' ? '@' : ' '}
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
      </div>
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
 * NewMax-like code preview:
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
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightLine, normalized]);

  return (
    <div
      ref={previewRef}
      className={`shell-code-preview ${compact ? 'is-compact' : ''}`}
      role="region"
      aria-label="文件内容预览"
      style={style}
      data-language={language || 'text'}
    >
      <table className="shell-code-preview__table">
        <tbody>
          {display.map((line, i) => (
            <tr
              key={i}
              className={`shell-code-preview__row${highlightLine === i + 1 ? ' is-highlighted' : ''}`}
              data-line={i + 1}
            >
              <td className="shell-code-preview__ln" aria-hidden="true">
                {i + 1}
              </td>
              <td className="shell-code-preview__code">
                {htmlLines ? (
                  <code
                    className={language ? `hljs language-${language}` : 'hljs'}
                    dangerouslySetInnerHTML={{
                      __html: htmlLines[i] && htmlLines[i]!.length ? htmlLines[i]! : ' ',
                    }}
                  />
                ) : (
                  <code className="hljs">{line.length ? line : ' '}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // File changes stay folded by default; the user expands a file to see its diff.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pathTooltip, setPathTooltip] = useState<{
    anchor: HTMLButtonElement;
    itemKey: string;
    path: string;
  } | null>(null);
  const pathTooltipId = useId();

  if (view.fileChanges.length === 0) return null;

  const totals = view.fileChanges.reduce<{
    added: number;
    removed: number;
    countable: boolean;
    unknown: boolean;
  }>(
    (acc, item) => {
      const counts = countLineChanges(item);
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

  const renderChangeItems = (items: readonly FileChangeItem[]) =>
    items.map((item) => {
      const itemKey = `${item.action}:${item.path}`;
      const hasBody = !isStatusOnlyPreview(item.preview);
      const hasDiff = item.previousContent !== undefined && item.content !== undefined;
      const deferred = needsDeferredFileDiff(item);
      const open = expandedPath === item.path;
      const counts = countLineChanges(item);
      const absolutePath = resolveAbsoluteProjectPath(projectFolder, item.path);
      return (
        <li key={itemKey} className={`shell-changes-card__item ${open ? 'is-open' : ''}`}>
          <div className="shell-changes-card__row">
            <button
              type="button"
              className="shell-changes-card__expand"
              disabled={!hasBody && !hasDiff && !deferred}
              onClick={() => {
                setExpandedPath((prev) => (prev === item.path ? null : item.path));
              }}
              title={
                hasBody || hasDiff || deferred
                  ? open
                    ? '收起 diff'
                    : '展开 diff'
                  : '暂无可展开内容'
              }
              aria-label={open ? `收起 ${item.path} diff` : `展开 ${item.path} diff`}
            >
              <ChevronDown
                size={13}
                className={`shell-changes-card__chevron ${open ? 'is-open' : ''}`}
              />
            </button>
            <button
              type="button"
              className="shell-changes-card__file"
              onClick={() => onOpenChange?.(item.path)}
              onMouseEnter={(event) => {
                setPathTooltip({
                  anchor: event.currentTarget,
                  itemKey,
                  path: absolutePath,
                });
              }}
              onMouseLeave={(event) => {
                setPathTooltip((current) =>
                  current?.anchor === event.currentTarget ? null : current,
                );
              }}
              onFocus={(event) => {
                setPathTooltip({
                  anchor: event.currentTarget,
                  itemKey,
                  path: absolutePath,
                });
              }}
              onBlur={(event) => {
                setPathTooltip((current) =>
                  current?.anchor === event.currentTarget ? null : current,
                );
              }}
              aria-describedby={pathTooltip?.itemKey === itemKey ? pathTooltipId : undefined}
              aria-label={`打开文件 ${item.path}`}
            >
              <span
                className={`shell-changes-card__badge is-${item.action}`}
                data-action={item.action}
              >
                {item.action === 'created' ? 'A' : item.action === 'deleted' ? 'D' : 'M'}
              </span>
              <span className="shell-changes-card__name">{fileName(item.path)}</span>
              {fileDir(item.path) ? (
                <span className="shell-changes-card__dir">{fileDir(item.path)}</span>
              ) : null}
              {counts ? (
                <span className="shell-changes-card__file-lines">
                  <span className="is-add">+{counts.added}</span>
                  <span className="is-del">−{counts.removed}</span>
                </span>
              ) : null}
              <span className="shell-changes-card__action-label">
                <span className="shell-changes-card__action-rest">{actionLabel(item.action)}</span>
                <span className="shell-changes-card__action-hint" aria-hidden="true">
                  预览文件
                </span>
              </span>
            </button>
          </div>
          {open && deferred ? (
            <DeferredFileDiff item={item} conversationId={conversationId} />
          ) : open && hasDiff ? (
            <div className="shell-changes-card__diff">
              <LineDiffView
                oldText={item.previousContent}
                newText={item.content}
                path={item.path}
                truncated={item.previousTruncated}
              />
            </div>
          ) : open && hasBody && item.preview ? (
            <div className="shell-changes-card__diff">
              {looksLikeUnifiedDiff(item.preview) ? (
                <UnifiedDiffPreview text={item.preview} path={item.path} />
              ) : (
                <div className="shell-changes-card__preview">
                  <CodePreview text={item.preview} path={item.path} compact maxHeight={220} />
                </div>
              )}
            </div>
          ) : null}
        </li>
      );
    });

  return (
    <div className={`shell-changes-card ${nested ? 'is-nested' : ''}`}>
      {/* NewMax has no standing button: the whole header becomes 查看变动 on hover. */}
      <div className="shell-changes-card__header">
        <button
          type="button"
          className="shell-changes-card__header-action"
          disabled={!onOpenReview}
          onClick={() => onOpenReview?.(conversationId ? { ...view, conversationId } : view)}
          aria-label="查看变动"
          title="审阅本轮文件修改"
        >
          <span className="shell-changes-card__header-rest">
            <span className="shell-changes-card__title">
              编辑了 {view.pages?.fileChanges.total ?? view.fileChanges.length} 个文件
            </span>
            {totals.countable && !totals.unknown ? (
              <span className="shell-changes-card__lines" title="新增 / 删除行数">
                <span className="is-add">+{totals.added}</span>
                <span className="is-del">−{totals.removed}</span>
              </span>
            ) : null}
            {totals.unknown ? <span className="shell-changes-card__lines">行数按需计算</span> : null}
          </span>
          <span className="shell-changes-card__header-hint" aria-hidden="true">
            <FileDiff size={12} />
            查看变动
          </span>
        </button>
      </div>
      {controls}
      <ul className="shell-changes-card__list">{renderChangeItems(previewItems)}</ul>
      {overflowCount > 0 ? (
        <>
          <div
            className={`shell-changes-card__overflow${overflowOpen ? ' is-open' : ''}`}
            data-testid="file-changes-overflow"
          >
            <div className="shell-changes-card__overflow-inner">
              <ul className="shell-changes-card__list is-overflow" aria-hidden={!overflowOpen}>
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
            <span>{overflowOpen ? '收起' : `还有 ${overflowCount} 个文件`}</span>
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
    </div>
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
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    document.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
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
    'action' | 'previousContent' | 'content' | 'contentRef' | 'previousContentRef' | 'contentKind'
  >,
): { added: number; removed: number } | undefined {
  if (needsDeferredFileDiff(item)) return undefined;
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
}) {
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
  return (
    <div className="shell-changes-card__diff-body">
      {showToolbar ? (
        <div className="shell-changes-card__diff-toolbar">
          <span className="shell-changes-card__diff-counts" aria-label="变更统计">
            <span className="is-add">+{lines.filter((line) => line.kind === 'add').length}</span>
            <span className="is-del">−{lines.filter((line) => line.kind === 'del').length}</span>
          </span>
          <label className="shell-changes-card__diff-wrap">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(event) => {
                setInternalWrap(event.target.checked);
                onWrapLinesChange?.(event.target.checked);
              }}
            />
            自动换行
          </label>
          <CopyTextButton text={newText ?? ''} label="复制修改后内容" />
        </div>
      ) : null}
      <div
        className={`shell-changes-card__diff-lines ${wrap ? 'is-wrap' : ''}${
          showLineNumbers ? '' : ' is-no-line-numbers'
        }`}
        data-path={path}
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
      </div>
    </div>
  );
}

export { actionLabel, fileDir, fileName, isStatusOnlyPreview };
