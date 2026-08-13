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
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import c from 'highlight.js/lib/languages/c';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import swift from 'highlight.js/lib/languages/swift';
import type {
  ExecutionProcessStep,
  FileChangeItem,
  ProcessToolKind,
  RunProcessView,
} from '@sync-think/protocol';

let hljsReady = false;
function ensureHljs(): void {
  if (hljsReady) return;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('c', c);
  hljs.registerLanguage('cmake', cmake);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('dart', dart);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('dos', dos);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('graphql', graphql);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('kotlin', kotlin);
  hljs.registerLanguage('less', less);
  hljs.registerLanguage('lua', lua);
  hljs.registerLanguage('makefile', makefile);
  hljs.registerLanguage('php', php);
  hljs.registerLanguage('powershell', powershell);
  hljs.registerLanguage('protobuf', protobuf);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('scss', scss);
  hljs.registerLanguage('swift', swift);
  hljsReady = true;
}

const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  svg: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  pyw: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
  config: 'ini',
  properties: 'ini',
  sql: 'sql',
  rs: 'rust',
  graphql: 'graphql',
  gql: 'graphql',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  mk: 'makefile',
  cmake: 'cmake',
  proto: 'protobuf',
};

function languageFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base.startsWith('.env')) return 'ini';
  const namedLanguage = LANGUAGE_BY_FILENAME[base];
  if (namedLanguage) return namedLanguage;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return LANGUAGE_BY_EXTENSION[ext];
}

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
}: {
  step: ExecutionProcessStep;
  onOpenChange?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = formatExecutionStepTitle(step);
  const output = step.error || step.preview;
  const showOutput = hasRichOutput(step);
  const hasBody = Boolean(
    step.path || step.command || step.url || showOutput || step.exitCode !== undefined,
  );

  return (
    <div className="shell-tool-card" data-status={step.status} data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="shell-tool-card__header"
        onClick={() => setOpen((v) => !v)}
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
  view,
  nested = false,
  onOpenChange,
}: ExecutionProcessBlockProps) {
  if (view.steps.length === 0) return null;

  return (
    <div
      className={`shell-tool-stack ${nested ? 'is-nested' : ''}`}
      data-testid="execution-process"
    >
      {view.steps.map((step) => (
        <ExecutionProcessStepCard key={step.id} step={step} onOpenChange={onOpenChange} />
      ))}
    </div>
  );
}

function actionLabel(action: 'created' | 'edited' | 'deleted'): string {
  if (action === 'created') return 'Created';
  if (action === 'deleted') return 'Deleted';
  return 'Edited';
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
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
  ensureHljs();
  const language = languageFromPath(path);
  const previewRef = useRef<HTMLDivElement>(null);
  const normalized = text.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const display =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

  const highlightedHtml = useMemo(() => {
    if (!language || !hljs.getLanguage(language)) return undefined;
    try {
      return hljs.highlight(normalized.replace(/\n$/, ''), {
        language,
        ignoreIllegals: true,
      }).value;
    } catch {
      return undefined;
    }
  }, [language, normalized]);

  const htmlLines = useMemo(() => {
    if (!highlightedHtml) return undefined;
    const parts = highlightedHtml.split('\n');
    // hljs may drop a trailing empty line after we stripped it from source.
    if (parts.length === display.length + 1 && parts[parts.length - 1] === '') {
      return parts.slice(0, -1);
    }
    while (parts.length < display.length) parts.push('');
    return parts.slice(0, display.length);
  }, [highlightedHtml, display.length]);

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

export function FileChangesCard({
  view,
  nested = false,
  onOpenChange,
  onOpenReview,
  projectFolder,
}: {
  view: RunProcessView;
  nested?: boolean;
  /** Opens the file in a neighboring file pane. */
  onOpenChange?: (path: string) => void;
  onOpenReview?: (view: RunProcessView) => void;
  projectFolder?: string;
}) {
  // File changes stay folded by default; the user expands a file to see its diff.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [pathTooltip, setPathTooltip] = useState<{
    anchor: HTMLButtonElement;
    itemKey: string;
    path: string;
  } | null>(null);
  const pathTooltipId = useId();

  if (view.fileChanges.length === 0) return null;

  const totals = view.fileChanges.reduce<{ added: number; removed: number; countable: boolean }>(
    (acc, item) => {
      const counts = countLineChanges(item);
      if (!counts) return acc;
      return {
        added: acc.added + counts.added,
        removed: acc.removed + counts.removed,
        countable: true,
      };
    },
    { added: 0, removed: 0, countable: false },
  );

  return (
    <div className={`shell-changes-card ${nested ? 'is-nested' : ''}`}>
      <div className="shell-changes-card__header">
        <span className="shell-changes-card__title">已更改 {view.fileChanges.length} 个文件</span>
        {totals.countable ? (
          <span className="shell-changes-card__lines" title="新增 / 删除行数">
            <span className="is-add">+{totals.added}</span>
            <span className="is-del">−{totals.removed}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="shell-changes-card__action"
          onClick={() => onOpenReview?.(view)}
          title="审阅本轮文件修改"
        >
          <FileDiff size={12} aria-hidden="true" />
          审阅文件
        </button>
      </div>
      <ul className="shell-changes-card__list">
        {view.fileChanges.map((item) => {
          const itemKey = `${item.action}:${item.path}`;
          const hasBody = !isStatusOnlyPreview(item.preview);
          const hasDiff = item.previousContent !== undefined && item.content !== undefined;
          const open = expandedPath === item.path;
          const counts = countLineChanges(item);
          const absolutePath = resolveAbsoluteProjectPath(projectFolder, item.path);
          return (
            <li
              key={itemKey}
              className={`shell-changes-card__item ${open ? 'is-open' : ''}`}
            >
              <div className="shell-changes-card__row">
                <button
                  type="button"
                  className="shell-changes-card__expand"
                  disabled={!hasBody && !hasDiff}
                  onClick={() => {
                    setExpandedPath((prev) => (prev === item.path ? null : item.path));
                  }}
                  title={
                    hasBody || hasDiff ? (open ? '收起 diff' : '展开 diff') : '暂无可展开内容'
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
                  <span className="shell-changes-card__path">{item.path}</span>
                  {counts ? (
                    <span className="shell-changes-card__file-lines">
                      <span className="is-add">+{counts.added}</span>
                      <span className="is-del">−{counts.removed}</span>
                    </span>
                  ) : null}
                  <span className="shell-changes-card__action-label">
                    {actionLabel(item.action)}
                  </span>
                </button>
              </div>
              {open && hasDiff ? (
                <div className="shell-changes-card__diff">
                  <LineDiffView
                    oldText={item.previousContent}
                    newText={item.content}
                    path={item.path}
                    truncated={item.previousTruncated}
                  />
                </div>
              ) : open && hasBody && item.preview ? (
                <div className="shell-changes-card__preview">
                  <CodePreview text={item.preview} path={item.path} compact maxHeight={220} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
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
      const overflowsBelow =
        anchorRect.bottom + gap + tooltipRect.height > viewportHeight - margin;
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
  item: Pick<FileChangeItem, 'action' | 'previousContent' | 'content'>,
): { added: number; removed: number } | undefined {
  if (item.action === 'created') {
    if (item.content === undefined) return undefined;
    const lines = item.content.replace(/\r\n/g, '\n').split('\n');
    const count = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    return { added: count, removed: 0 };
  }
  if (item.action === 'deleted') {
    if (item.previousContent === undefined) return undefined;
    const lines = item.previousContent.replace(/\r\n/g, '\n').split('\n');
    const count = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
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
}: {
  oldText: string | undefined;
  newText: string | undefined;
  path?: string;
  truncated?: boolean;
}) {
  const lines = computeLineDiff(oldText, newText);
  const [wrap, setWrap] = useState(true);
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
      <div className="shell-changes-card__diff-toolbar">
        <label className="shell-changes-card__diff-wrap">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          自动换行
        </label>
      </div>
      <div className={`shell-changes-card__diff-lines ${wrap ? 'is-wrap' : ''}`} data-path={path}>
        {lines.map((line, index) => (
          <div
            key={index}
            className={`shell-changes-card__diff-line is-${line.kind}`}
            data-kind={line.kind}
          >
            <span className="shell-changes-card__diff-gutter" aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            <span className="shell-changes-card__diff-no" aria-hidden="true">
              {line.kind === 'add' ? line.newLine : ''}
            </span>
            <span className="shell-changes-card__diff-no" aria-hidden="true">
              {line.kind === 'del' ? line.oldLine : ''}
            </span>
            <code className="shell-changes-card__diff-text">{line.text || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export { actionLabel, fileName, isStatusOnlyPreview };
