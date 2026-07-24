import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileCode2,
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
import type { Event } from '@sync-think/shared';
import {
  projectExecutionProcess,
  type ExecutionProcessStep,
  type ProcessToolKind,
} from './execution-process.js';

// Register a compact set of languages for NewMax-like file previews.
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
  hljsReady = true;
}

function languageFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'bash';
  if (base === 'makefile' || base === 'cmakelists.txt') return 'bash';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'htm':
    case 'svg':
    case 'vue':
    case 'svelte':
      return 'html';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
      return 'bash';
    case 'sql':
      return 'sql';
    case 'xml':
      return 'xml';
    default:
      return undefined;
  }
}

function isStatusOnlyPreview(preview?: string): boolean {
  if (!preview) return true;
  if (preview === '已写入' || preview === '已创建') return true;
  return /^已(写入|创建)（\d+ bytes）$/.test(preview);
}

interface ExecutionProcessBlockProps {
  events: readonly Event[];
  threadId?: string;
  runId?: string;
  forceExpanded?: boolean;
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
function StepCard({
  step,
  defaultOpen,
  onOpenChange,
}: {
  step: ExecutionProcessStep;
  defaultOpen?: boolean;
  onOpenChange?: (path: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const title = formatExecutionStepTitle(step);
  const output = step.error || step.preview;
  const showOutput = hasRichOutput(step);
  const hasBody = Boolean(step.path || step.command || step.url || showOutput || step.exitCode !== undefined);

  return (
    <div className="shell-tool-card" data-status={step.status} data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="shell-tool-card__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <StatusIcon status={step.status} />
        <span className="shell-tool-card__kind">
          <KindIcon kind={step.kind} />
        </span>
        <span className="shell-tool-card__title">{title}</span>
        {step.exitCode !== undefined ? (
          <span className="shell-tool-card__badge">exit {step.exitCode}</span>
        ) : null}
        <ChevronDown
          size={14}
          className={`shell-tool-card__chevron ${open ? 'is-open' : ''}`}
        />
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
              <pre
                className={`shell-tool-card__output ${step.error ? 'is-error' : ''}`}
              >
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
  events,
  threadId,
  runId,
  forceExpanded = false,
  nested = false,
  onOpenChange,
}: ExecutionProcessBlockProps) {
  const view = useMemo(
    () => projectExecutionProcess(events, { threadId, runId }),
    [events, runId, threadId],
  );

  if (view.steps.length === 0) return null;

  return (
    <div
      className={`shell-tool-stack ${nested ? 'is-nested' : ''}`}
      data-testid="execution-process"
    >
      {view.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          // The outer process group owns density; only the live step opens automatically.
          defaultOpen={forceExpanded && step.status === 'running'}
          onOpenChange={onOpenChange}
        />
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

/**
 * NewMax-like code preview:
 * soft gutter (no hard vertical rule), optional syntax highlight, editor density.
 */
export function CodePreview({
  text,
  path,
  maxHeight,
  compact = false,
}: {
  text: string;
  path?: string;
  maxHeight?: number | string;
  compact?: boolean;
}) {
  ensureHljs();
  const language = languageFromPath(path);
  const normalized = text.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const display =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === ''
      ? rawLines.slice(0, -1)
      : rawLines;

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

  return (
    <div
      className={`shell-code-preview ${compact ? 'is-compact' : ''}`}
      role="region"
      aria-label="文件内容预览"
      style={style}
      data-language={language || 'text'}
    >
      <table className="shell-code-preview__table">
        <tbody>
          {display.map((line, i) => (
            <tr key={i} className="shell-code-preview__row">
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
  events,
  threadId,
  runId,
  nested = false,
  onOpenChange,
  onExpandRail,
}: {
  events: readonly Event[];
  threadId?: string;
  runId?: string;
  nested?: boolean;
  onOpenChange?: (path: string) => void;
  onExpandRail?: () => void;
}) {
  const view = useMemo(
    () => projectExecutionProcess(events, { threadId, runId }),
    [events, runId, threadId],
  );
  // Single-file runs expand body by default (NewMax glance); multi-file stays list-first.
  const [expandedPath, setExpandedPath] = useState<string | null>(
    view.fileChanges.length === 1 ? view.fileChanges[0]?.path ?? null : null,
  );

  if (view.fileChanges.length === 0) return null;

  return (
    <div className={`shell-changes-card ${nested ? 'is-nested' : ''}`}>
      <div className="shell-changes-card__header">
        <span className="shell-changes-card__title">
          已更改 {view.fileChanges.length} 个文件
        </span>
        <button
          type="button"
          className="shell-changes-card__action"
          onClick={() => {
            onExpandRail?.();
            const first = view.fileChanges[0]?.path;
            if (first) onOpenChange?.(first);
          }}
        >
          侧栏查看
        </button>
      </div>
      <ul className="shell-changes-card__list">
        {view.fileChanges.map((item) => {
          const hasBody = !isStatusOnlyPreview(item.preview);
          const open = expandedPath === item.path;
          return (
            <li
              key={`${item.action}:${item.path}`}
              className={`shell-changes-card__item ${open ? 'is-open' : ''}`}
            >
              <div className="shell-changes-card__row">
                <button
                  type="button"
                  className="shell-changes-card__toggle"
                  onClick={() => {
                    if (!hasBody) {
                      onExpandRail?.();
                      onOpenChange?.(item.path);
                      return;
                    }
                    setExpandedPath((prev) => (prev === item.path ? null : item.path));
                  }}
                  title={open ? '收起预览' : '展开预览'}
                >
                  <ChevronDown
                    size={13}
                    className={`shell-changes-card__chevron ${open ? 'is-open' : ''}`}
                  />
                  <span
                    className={`shell-changes-card__badge is-${item.action}`}
                    data-action={item.action}
                  >
                    {item.action === 'created' ? 'A' : item.action === 'deleted' ? 'D' : 'M'}
                  </span>
                  <span className="shell-changes-card__path" title={item.path}>
                    {item.path}
                  </span>
                  <span className="shell-changes-card__action-label">
                    {actionLabel(item.action)}
                  </span>
                </button>
                <button
                  type="button"
                  className="shell-changes-card__open"
                  onClick={() => {
                    onExpandRail?.();
                    onOpenChange?.(item.path);
                  }}
                  title="在侧栏打开"
                >
                  打开
                </button>
              </div>
              {open && hasBody && item.preview ? (
                <div className="shell-changes-card__preview">
                  <CodePreview text={item.preview} path={item.path} compact maxHeight={220} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { actionLabel, fileName, isStatusOnlyPreview };
