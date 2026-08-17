/**
 * DeepSeek Harness-style ordered assistant execution flow.
 * Every provider event stays on its own lightweight row; tool calls are never
 * grouped, and details expand in place without replacing the timeline.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  RotateCw,
  Wrench,
} from 'lucide-react';
import type { CommentaryTimelineSegment, ExecutionProcessStep } from '@sync-think/protocol';
import type { InlineProcessItem } from './ChatView.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { MarkdownContent } from './MarkdownContent.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? ''
  );
}

function latestLine(text: string): string {
  return (
    text
      .split('\n')
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? ''
  );
}

function elapsedLabel(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

function totalElapsedLabel(input: {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  streaming?: boolean;
  now: number;
}): string | undefined {
  const startedAt = Date.parse(input.startedAt ?? '');
  const completedAt = Date.parse(input.completedAt ?? '');
  const elapsedMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
      ? completedAt - startedAt
      : input.streaming && Number.isFinite(startedAt) && input.now >= startedAt
        ? input.now - startedAt
        : typeof input.durationMs === 'number' &&
            Number.isFinite(input.durationMs) &&
            input.durationMs >= 0
          ? input.durationMs
          : undefined;
  if (elapsedMs === undefined) return undefined;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

const TOOL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  read: '读取文件',
  read_file: '读取文件',
  write: '写入文件',
  write_file: '写入文件',
  edit: '编辑文件',
  edit_file: '编辑文件',
  apply_patch: '编辑文件',
  bash: '运行命令',
  execute_command: '运行命令',
  exec_command: '运行命令',
  run_command: '运行命令',
  list_files: '查看目录',
  glob: '查找文件',
  grep: '搜索内容',
  search_query: '搜索网页',
  web_search: '搜索网页',
  web_fetch: '获取网页',
  open: '打开网页',
  view_image: '查看图片',
};

function friendlyToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const exact = TOOL_DISPLAY_NAMES[normalized];
  if (exact) return exact;
  const suffix = normalized.split(/[.:/]/).at(-1) ?? normalized;
  const mapped = TOOL_DISPLAY_NAMES[suffix];
  if (mapped) return mapped;
  return (
    suffix
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || '工具'
  );
}

function compactValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.slice(0, 3).map(compactValue).filter(Boolean).join(', ');
  return undefined;
}

function toolInputSummary(item: Extract<InlineProcessItem, { kind: 'tool' }>): string {
  if (item.inputSummary?.trim()) return item.inputSummary.trim();
  const raw = item.argumentsJson.trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of [
        'path',
        'file_path',
        'cmd',
        'command',
        'query',
        'url',
        'pattern',
        'target',
      ]) {
        const value = compactValue(record[key]);
        if (value) return value.length > 120 ? `${value.slice(0, 117)}…` : value;
      }
      const first = Object.entries(record).find(([, value]) => compactValue(value));
      if (first) {
        const value = compactValue(first[1]) ?? '';
        const summary = `${first[0]}: ${value}`;
        return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary;
      }
    }
  } catch {
    // Raw non-JSON arguments are already the most useful compact summary.
  }
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

function ThinkRow({
  item,
  streaming,
}: {
  item: Extract<InlineProcessItem, { kind: 'reasoning' }>;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isStreaming = item.status === 'streaming' || (item.status === undefined && streaming);
  const summary = (isStreaming ? latestLine(item.text) : firstLine(item.text)) || '正在思考…';
  return (
    <div
      className={`shell-inline-process__think${open ? ' is-open' : ''}`}
      data-testid="inline-process-reasoning"
    >
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Brain size={13} aria-hidden="true" />
        <span className="shell-inline-process__think-label">Think</span>
        <span className="shell-inline-process__think-summary" data-testid="think-row-summary">
          {summary}
        </span>
        {isStreaming ? (
          <LoaderCircle size={12} className="shell-inline-process__spin" aria-hidden="true" />
        ) : (
          <ChevronDown
            size={13}
            className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        )}
      </button>
      {open ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MarkdownContent text={item.text} streaming={false} />
        </div>
      ) : null}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: 'running' | 'completed' | 'failed' }) {
  if (status === 'failed') return <CircleAlert size={13} aria-hidden="true" />;
  if (status === 'running') {
    return <LoaderCircle size={13} className="shell-inline-process__spin" aria-hidden="true" />;
  }
  return <Check size={13} aria-hidden="true" />;
}

function ToolRow({ item }: { item: Extract<InlineProcessItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const status =
    item.status ?? (item.failed ? 'failed' : item.result !== undefined ? 'completed' : 'running');
  const summary = toolInputSummary(item);
  const elapsed = elapsedLabel(item.startedAt, item.completedAt);
  const displayName = item.displayName?.trim() || friendlyToolName(item.name);
  return (
    <div
      className={`shell-inline-process__tool is-${status}`}
      data-testid="inline-process-tool"
      data-failed={status === 'failed' ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-inline-process__tool-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="shell-inline-process__tool-icon" aria-hidden="true">
          <Wrench size={13} />
        </span>
        <span className="shell-inline-process__tool-name">{displayName}</span>
        {summary ? <span className="shell-inline-process__tool-summary">{summary}</span> : null}
        <span className="shell-inline-process__tool-status" data-status={status}>
          <ToolStatusIcon status={status} />
          <span>{status === 'running' ? '运行中' : status === 'failed' ? '失败' : '完成'}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-inline-process__tool-body">
          <div className="shell-inline-process__detail-row">
            <span>原始工具</span>
            <code>{item.name}</code>
          </div>
          {elapsed ? (
            <div className="shell-inline-process__detail-row">
              <span>耗时</span>
              <code>{elapsed}</code>
            </div>
          ) : null}
          {item.argumentsJson ? (
            <div className="shell-inline-process__detail-block">
              <span>参数</span>
              <pre className="shell-inline-process__tool-code">{item.argumentsJson}</pre>
            </div>
          ) : null}
          {item.result !== undefined ? (
            <div className="shell-inline-process__detail-block">
              <span>{status === 'failed' ? '错误' : '输出'}</span>
              <pre
                className={`shell-inline-process__tool-code${status === 'failed' ? ' is-failed' : ''}`}
                data-testid="inline-process-tool-result"
              >
                {item.result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({ item }: { item: Extract<InlineProcessItem, { kind: 'status' }> }) {
  const failed =
    item.statusType === 'connection' &&
    /失败|断开|error|failed/i.test(`${item.label} ${item.detail ?? ''}`);
  return (
    <div
      className={`shell-inline-process__status${failed ? ' is-failed' : ''}`}
      data-testid="inline-process-status"
      role="status"
    >
      {item.statusType === 'retry' || item.statusType === 'model_switch' ? (
        <RotateCw size={12} aria-hidden="true" />
      ) : failed ? (
        <CircleAlert size={12} aria-hidden="true" />
      ) : (
        <Check size={12} aria-hidden="true" />
      )}
      <span>{item.label}</span>
      {item.detail ? (
        <span className="shell-inline-process__status-detail">{item.detail}</span>
      ) : null}
    </div>
  );
}

function ProcessItemView({ item, streaming }: { item: InlineProcessItem; streaming?: boolean }) {
  if (item.kind === 'reasoning') return <ThinkRow item={item} streaming={streaming} />;
  if (item.kind === 'tool') return <ToolRow item={item} />;
  if (item.kind === 'status') return <StatusRow item={item} />;
  return (
    <div
      className="shell-inline-process__markdown"
      data-testid={item.kind === 'commentary' ? 'inline-process-commentary' : 'inline-process-text'}
    >
      <MarkdownContent text={item.text} streaming={false} />
    </div>
  );
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  steps,
  commentarySegments,
  streaming,
  answerStarted = false,
  runId,
  startedAt,
  completedAt,
  durationMs,
  defaultOpen = false,
  supplementalContent,
}: {
  items: readonly InlineProcessItem[];
  steps?: readonly ExecutionProcessStep[];
  commentarySegments?: readonly CommentaryTimelineSegment[];
  streaming?: boolean;
  answerStarted?: boolean;
  runId?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** Deterministic fixture override; production follows the run phase. */
  defaultOpen?: boolean;
  supplementalContent?: ReactNode;
}) {
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    if (items.some((item) => item.kind === 'tool' || item.kind === 'status')) return items;
    if (!steps?.length && !commentarySegments?.length) return items;
    const merged: InlineProcessItem[] = [];
    for (const item of buildExecutionTimeline({ steps, commentarySegments })) {
      if (item.type === 'commentary') {
        if (item.text.trim()) merged.push({ kind: 'commentary', text: item.text });
        continue;
      }
      for (const step of item.steps) {
        merged.push({
          kind: 'tool',
          name: step.toolName ?? step.label ?? '工具',
          argumentsJson: step.command ?? step.url ?? step.path ?? '',
          result: step.preview ?? step.error ?? '',
          status: step.status === 'error' ? 'failed' : step.completedAt ? 'completed' : 'running',
          ...(step.status === 'error' ? { failed: true } : {}),
          ...(step.startedAt ? { startedAt: step.startedAt } : {}),
          ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        });
      }
    }
    return [...items.filter((item) => item.kind !== 'commentary'), ...merged];
  }, [items, steps, commentarySegments]);

  const { open, toggle } = useAutoDisclosure({
    autoOpen: defaultOpen || Boolean(streaming && !answerStarted),
    resetKey: runId,
  });
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming || completedAt || !startedAt) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [completedAt, startedAt, streaming]);
  const totalElapsed = totalElapsedLabel({
    startedAt,
    completedAt,
    durationMs,
    streaming,
    now: clockNow,
  });

  if (orderedItems.length === 0 && !supplementalContent) return null;
  return (
    <section
      className={`shell-process-panel${open ? ' is-open' : ''}`}
      data-testid="process-panel"
      data-streaming={streaming ? '1' : '0'}
    >
      <button
        type="button"
        className="shell-process-panel__toggle"
        data-testid="process-panel-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        {streaming && !answerStarted ? (
          <LoaderCircle size={13} className="shell-inline-process__spin" aria-hidden="true" />
        ) : (
          <Brain size={13} aria-hidden="true" />
        )}
        <span className="shell-process-panel__title">执行过程</span>
        {orderedItems.length > 0 ? (
          <span className="shell-process-panel__meta">{orderedItems.length} 项</span>
        ) : null}
        {totalElapsed ? (
          <span className="shell-process-panel__elapsed">· {totalElapsed}</span>
        ) : null}
        <ChevronDown
          size={14}
          className={`shell-process-panel__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-process-panel__body" data-testid="process-panel-body">
          {orderedItems.length > 0 ? (
            <div className="shell-inline-process" data-testid="inline-process-flow">
              {orderedItems.map((item, index) => (
                <ProcessItemView
                  key={item.id ?? `${item.kind}-${item.sequence ?? index}-${index}`}
                  item={item}
                  streaming={streaming}
                />
              ))}
            </div>
          ) : null}
          {supplementalContent ? (
            <div className="shell-process-panel__supplemental">{supplementalContent}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
