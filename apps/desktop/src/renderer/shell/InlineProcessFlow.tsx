/**
 * DeepSeek Harness-style ordered assistant execution flow.
 * Every provider event stays on its own lightweight row; tool calls are never
 * grouped, and details expand in place without replacing the timeline.
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Atom,
  Check,
  ChevronDown,
  CircleAlert,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  PencilLine,
  Plug,
  RotateCw,
  Search,
  SquareTerminal,
  Users,
  Wrench,
} from 'lucide-react';
import type { CommentaryTimelineSegment, ExecutionProcessStep } from '@sync-think/protocol';
import type { InlineProcessItem } from './ChatView.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { MarkdownContent } from './MarkdownContent.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';
import {
  formatElapsedZh,
  friendlyToolName,
  toolVisualKind,
  toolInputSummary,
  toolStatusOf,
  type ProcessToolVisualKind,
} from './process-activity.js';

function latestLine(text: string): string {
  return (
    text
      .split('\n')
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? ''
  );
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? ''
  );
}

function toolErrorSummary(text: string): string {
  const fallback = firstLine(text);
  const findMessage = (value: unknown, depth: number): string | undefined => {
    if (depth > 3) return undefined;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) return undefined;
      if (normalized.startsWith('{') || normalized.startsWith('[')) {
        try {
          return findMessage(JSON.parse(normalized) as unknown, depth + 1) ?? firstLine(normalized);
        } catch {
          return firstLine(normalized);
        }
      }
      return firstLine(normalized);
    }
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail', 'reason', 'stderr', 'text']) {
      const found = findMessage(record[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };

  try {
    return findMessage(JSON.parse(text) as unknown, 0) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 折叠行是纯文本节点，Markdown 标记不会被渲染，只会原样显示成
 * `**分析字段匹配**` 这种噪声。这里只做**展示用**的标记剥离，不改原文
 * （展开体仍走 MarkdownContent 完整渲染）。
 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** 整行加粗或 ATX 标题 —— Codex 思考块惯用的小标题形态。 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  return /^\*\*[^*]+\*\*$/.test(trimmed) || /^__[^_]+__$/.test(trimmed);
}

/**
 * 把一段思考拆成「折叠行标题」与「展开体正文」。
 *
 * 当首行本身就是小标题时，正文剔除该行——否则折叠行和展开体首行完全重复，
 * 展开后看起来像是同一句被说了两遍。首行不是标题时保留全文，折叠行只作预览。
 */
function splitReasoning(text: string): { title: string; body: string } {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return { title: '', body: '' };
  const head = lines[index] ?? '';
  const title = stripInlineMarkdown(head);
  if (!isHeadingLine(head)) return { title, body: text };
  const body = lines
    .slice(index + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { title, body: body.trim() ? body : '' };
}

function elapsedLabel(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

/**
 * 运行中工具的自增耗时。`elapsedLabel` 要求终态边界，运行中拿不到，
 * 于是「在跑还是卡住」这个最需要时间的阶段反而完全没有时间显示。
 * `now` 来自面板层唯一的那个秒级时钟（不是每行各自的 interval），
 * 这样 running → completed 原位翻转时不会重挂载行（§12.17.17）。
 */
function runningElapsedLabel(startedAt: string | undefined, now: number): string | undefined {
  if (!startedAt) return undefined;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || now < started) return undefined;
  const elapsed = now - started;
  if (elapsed < 1000) return undefined;
  return elapsed < 60_000 ? `${Math.floor(elapsed / 1000)}s` : formatElapsedZh(elapsed);
}

function processDurationLabel(input: {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  now: number;
  streaming?: boolean;
}): string | undefined {
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    return formatElapsedZh(input.durationMs);
  }
  if (!input.startedAt) return undefined;
  const started = Date.parse(input.startedAt);
  const ended = input.completedAt
    ? Date.parse(input.completedAt)
    : input.streaming
      ? input.now
      : Number.NaN;
  const elapsed = ended - started;
  return Number.isFinite(elapsed) && elapsed >= 0 ? formatElapsedZh(elapsed) : undefined;
}

function ThinkRow({
  item,
  streaming,
  open,
  onToggle,
}: {
  item: Extract<InlineProcessItem, { kind: 'reasoning' }>;
  streaming?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const isStreaming = item.status === 'streaming' || (item.status === undefined && streaming);
  const split = useMemo(() => splitReasoning(item.text), [item.text]);
  // 流式期间跟随最新一行（进度感），完成后固定为该段思考的标题。
  const summary =
    (isStreaming ? stripInlineMarkdown(latestLine(item.text)) : split.title) || '正在思考…';
  const body = isStreaming ? item.text : split.body;
  return (
    <div
      className={`shell-inline-process__think${open ? ' is-open' : ''}${isStreaming ? ' is-running' : ''}`}
      data-testid="inline-process-reasoning"
    >
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="shell-inline-process__row-leading" aria-hidden="true">
          <Atom size={14} className="shell-inline-process__row-symbol" />
          <ChevronDown
            size={14}
            className={`shell-inline-process__row-disclosure${open ? ' is-open' : ''}`}
          />
        </span>
        <span className="shell-inline-process__think-label">Think</span>
        <span className="shell-inline-process__separator" aria-hidden="true">
          ·
        </span>
        <span className="shell-inline-process__think-summary" data-testid="think-row-summary">
          {summary}
        </span>
      </button>
      {open && body ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MarkdownContent text={body} streaming={false} />
        </div>
      ) : null}
    </div>
  );
}

function ToolKindIcon({ kind }: { kind: ProcessToolVisualKind }) {
  if (kind === 'read') return <FileCode2 size={13} />;
  if (kind === 'write') return <PencilLine size={13} />;
  if (kind === 'list') return <FolderOpen size={13} />;
  if (kind === 'command') return <SquareTerminal size={13} />;
  if (kind === 'git') return <GitBranch size={13} />;
  if (kind === 'browser') return <Globe size={13} />;
  if (kind === 'search') return <Search size={13} />;
  if (kind === 'mcp') return <Plug size={13} />;
  return <Wrench size={13} />;
}

const TOOL_STATUS_TEXT: Readonly<Record<'running' | 'completed' | 'failed', string>> = {
  running: '运行中',
  completed: '完成',
  failed: '失败',
};

function structuredFields(text: string): ReadonlyArray<readonly [string, unknown]> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function structuredValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolPayload({
  text,
  testId,
  failed = false,
}: {
  text: string;
  testId: string;
  failed?: boolean;
}) {
  const fields = structuredFields(text);
  if (!fields) {
    return (
      <pre
        className={`shell-inline-process__tool-code${failed ? ' is-failed' : ''}`}
        data-testid={testId}
      >
        {text}
      </pre>
    );
  }
  return (
    <dl
      className={`shell-inline-process__structured${failed ? ' is-failed' : ''}`}
      data-testid={testId}
    >
      {fields.map(([key, value]) => {
        const nested = value !== null && typeof value === 'object';
        return (
          <div className="shell-inline-process__structured-row" key={key}>
            <dt>{key}</dt>
            <dd className={nested ? 'is-nested' : undefined}>{structuredValueText(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ToolRow({
  item,
  now,
  open,
  onToggle,
  onOpenChange,
}: {
  item: Extract<InlineProcessItem, { kind: 'tool' }>;
  /** 面板层的秒级时钟；仅运行中的行会用到。 */
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenChange?: (path: string) => void;
}) {
  const status = toolStatusOf(item);
  const summary = toolInputSummary(item);
  const elapsed = elapsedLabel(item.startedAt, item.completedAt);
  const liveElapsed = status === 'running' ? runningElapsedLabel(item.startedAt, now) : undefined;
  const displayName = item.displayName?.trim() || friendlyToolName(item.name);
  const visualKind = toolVisualKind(item.name);
  const statusText = TOOL_STATUS_TEXT[status];
  const progressLine = status === 'running' ? item.progressLine?.trim() : undefined;
  const errorSummary =
    status === 'failed' ? toolErrorSummary(item.result ?? '') || '工具执行失败' : '';
  const detailResult =
    status === 'failed' && !(item.result ?? '').trim() ? '工具未返回错误详情' : item.result;
  const visibleSummary = errorSummary || summary;
  const resourcePath =
    summary && (visualKind === 'read' || visualKind === 'write' || visualKind === 'list')
      ? summary
      : undefined;
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
        onClick={onToggle}
      >
        <span className="shell-inline-process__row-leading" aria-hidden="true">
          {status === 'failed' ? (
            <span className="shell-inline-process__state-dot" />
          ) : (
            <span
              className="shell-inline-process__tool-icon shell-inline-process__row-symbol"
              data-testid="process-tool-kind"
              data-kind={visualKind}
            >
              <ToolKindIcon kind={visualKind} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`shell-inline-process__row-disclosure${open ? ' is-open' : ''}`}
          />
        </span>
        <span className="shell-inline-process__tool-name">{displayName}</span>
        {visibleSummary ? (
          <span className="shell-inline-process__separator" aria-hidden="true">
            ·
          </span>
        ) : null}
        {visibleSummary ? (
          <span
            className={`shell-inline-process__tool-summary${status === 'failed' ? ' is-failed' : ''}${resourcePath ? ' is-resource' : ''}`}
            data-testid={status === 'failed' ? 'inline-process-tool-error-summary' : undefined}
            {...(resourcePath && onOpenChange
              ? {
                  role: 'link',
                  tabIndex: 0,
                  onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
                    event.stopPropagation();
                    onOpenChange(resourcePath);
                  },
                  onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenChange(resourcePath);
                  },
                }
              : {})}
          >
            {visibleSummary}
          </span>
        ) : null}
        <span
          className="shell-inline-process__tool-status"
          data-testid="inline-process-tool-status"
          data-status={status}
          title={statusText}
          aria-label={statusText}
        />
      </button>
      {progressLine ? (
        <div
          className="shell-inline-process__tool-progress"
          data-testid="inline-process-tool-progress"
        >
          {progressLine}
        </div>
      ) : null}
      {open ? (
        <div
          className="shell-inline-process__tool-body"
          data-testid="inline-process-tool-details"
          tabIndex={0}
          aria-label={`${displayName}详情`}
        >
          <div className="shell-inline-process__detail-row">
            <span>原始工具</span>
            <code>{item.name}</code>
          </div>
          {(elapsed ?? liveElapsed) ? (
            <div className="shell-inline-process__detail-row">
              <span>耗时</span>
              <code>{elapsed ?? liveElapsed}</code>
            </div>
          ) : null}
          {item.argumentsJson ? (
            <div className="shell-inline-process__detail-block">
              <span>参数</span>
              <ToolPayload text={item.argumentsJson} testId="inline-process-tool-arguments" />
            </div>
          ) : null}
          {detailResult !== undefined ? (
            <div className="shell-inline-process__detail-block">
              <span>{status === 'failed' ? '错误' : '输出'}</span>
              <ToolPayload
                text={detailResult}
                testId="inline-process-tool-result"
                failed={status === 'failed'}
              />
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
      <span className="shell-inline-process__status-label">{item.label}</span>
      {item.detail ? (
        <>
          <span className="shell-inline-process__separator" aria-hidden="true">
            ·
          </span>
          <span className="shell-inline-process__status-detail">{item.detail}</span>
        </>
      ) : null}
    </div>
  );
}

function WaitingRow() {
  return (
    <div
      className="shell-inline-process__waiting is-running"
      data-testid="inline-process-waiting"
      role="status"
    >
      <span className="shell-inline-process__row-leading" aria-hidden="true">
        <Atom size={14} className="shell-inline-process__row-symbol" />
      </span>
      <span className="shell-inline-process__think-label">Think</span>
      <span className="shell-inline-process__separator" aria-hidden="true">
        ·
      </span>
      <span className="shell-inline-process__think-summary">等待模型响应</span>
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
  now,
  open,
  onToggle,
  onOpenChange,
}: {
  item: InlineProcessItem;
  streaming?: boolean;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenChange?: (path: string) => void;
}) {
  if (item.kind === 'reasoning') {
    return <ThinkRow item={item} streaming={streaming} open={open} onToggle={onToggle} />;
  }
  if (item.kind === 'tool') {
    return (
      <ToolRow item={item} now={now} open={open} onToggle={onToggle} onOpenChange={onOpenChange} />
    );
  }
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

function ProcessEntry({
  item,
  index,
  streaming,
  now,
  expandedItemKeys,
  toggleItem,
  onOpenChange,
}: {
  item: InlineProcessItem;
  index: number;
  streaming?: boolean;
  now: number;
  expandedItemKeys: ReadonlySet<string>;
  toggleItem(itemKey: string): void;
  onOpenChange?: (path: string) => void;
}) {
  // Stable key first (toolCallId / id / sequence) so status updates reuse the
  // row instead of remounting it.
  const itemKey = processItemKey(item, index);
  return (
    <div className="shell-inline-process__entry" data-testid="process-entry" key={itemKey}>
      <div className="shell-inline-process__entry-content">
        <ProcessItemView
          item={item}
          streaming={streaming}
          now={now}
          open={expandedItemKeys.has(itemKey)}
          onToggle={() => toggleItem(itemKey)}
          onOpenChange={onOpenChange}
        />
      </div>
    </div>
  );
}

function processItemKey(item: InlineProcessItem, index: number): string {
  if (item.kind === 'tool' && item.toolCallId) return `tool-${item.toolCallId}`;
  if (item.id) return item.id;
  if (item.sequence !== undefined) return `${item.kind}-${item.sequence}`;
  return `${item.kind}-${index}`;
}

function enrichToolBoundaries(
  items: readonly InlineProcessItem[],
  steps: readonly ExecutionProcessStep[] | undefined,
): InlineProcessItem[] {
  if (!steps?.length) return [...items];
  const usedSteps = new Set<number>();
  let nextStepIndex = 0;

  return items.map((item) => {
    if (item.kind !== 'tool') return item;
    let matchedIndex = steps.findIndex(
      (step, index) =>
        !usedSteps.has(index) &&
        ((item.toolCallId && step.id === item.toolCallId) || (item.id && step.id === item.id)),
    );
    if (matchedIndex < 0) {
      matchedIndex = steps.findIndex(
        (step, index) =>
          index >= nextStepIndex && !usedSteps.has(index) && step.toolName === item.name,
      );
    }
    if (matchedIndex < 0) {
      matchedIndex = steps.findIndex((_, index) => index >= nextStepIndex && !usedSteps.has(index));
    }
    if (matchedIndex < 0) return item;

    usedSteps.add(matchedIndex);
    nextStepIndex = Math.max(nextStepIndex, matchedIndex + 1);
    const step = steps[matchedIndex];
    if (!step) return item;
    return {
      ...item,
      ...(item.sequence === undefined && step.sequence !== undefined
        ? { sequence: step.sequence }
        : {}),
      ...(!item.startedAt && (step.startedAt ?? step.occurredAt)
        ? { startedAt: step.startedAt ?? step.occurredAt }
        : {}),
      ...(!item.completedAt && step.completedAt ? { completedAt: step.completedAt } : {}),
    };
  });
}

function mergeMissingCommentary(
  items: readonly InlineProcessItem[],
  steps: readonly ExecutionProcessStep[] | undefined,
  commentarySegments: readonly CommentaryTimelineSegment[] | undefined,
): readonly InlineProcessItem[] {
  if (!commentarySegments?.length) return items;
  const ordered = enrichToolBoundaries(items, steps);
  const existingIds = new Set<string>();
  const existingTextCounts = new Map<string, number>();
  for (const item of ordered) {
    if (item.kind !== 'text' && item.kind !== 'commentary') continue;
    if (item.id) existingIds.add(item.id);
    const text = item.text.trim();
    if (text) existingTextCounts.set(text, (existingTextCounts.get(text) ?? 0) + 1);
  }
  const consumeExistingText = (text: string): boolean => {
    const count = existingTextCounts.get(text) ?? 0;
    if (count <= 0) return false;
    if (count === 1) existingTextCounts.delete(text);
    else existingTextCounts.set(text, count - 1);
    return true;
  };

  const missing = commentarySegments.flatMap((segment, originalIndex) => {
    const text = segment.text.trim();
    if (!text) return [];
    if (existingIds.has(segment.id)) {
      consumeExistingText(text);
      return [];
    }
    if (consumeExistingText(text)) return [];
    return [{ segment, originalIndex }];
  });
  if (missing.length === 0) return ordered;
  missing.sort((left, right) => {
    if (left.segment.afterSequence !== undefined && right.segment.afterSequence !== undefined) {
      return (
        left.segment.afterSequence - right.segment.afterSequence ||
        left.originalIndex - right.originalIndex
      );
    }
    const leftTime = Date.parse(left.segment.startedAt);
    const rightTime = Date.parse(right.segment.startedAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.originalIndex - right.originalIndex;
  });

  for (const { segment } of missing) {
    const sequence = segment.afterSequence === undefined ? undefined : segment.afterSequence + 0.5;
    const item: InlineProcessItem = {
      kind: 'commentary',
      id: segment.id,
      text: segment.text,
      status: segment.completedAt ? 'completed' : 'streaming',
      ...(sequence === undefined ? {} : { sequence }),
    };
    let insertionIndex = -1;
    if (sequence !== undefined) {
      insertionIndex = ordered.findIndex(
        (candidate) => candidate.sequence !== undefined && candidate.sequence > sequence,
      );
      if (insertionIndex < 0) {
        for (let index = ordered.length - 1; index >= 0; index -= 1) {
          const candidate = ordered[index];
          if (candidate?.sequence !== undefined && candidate.sequence <= sequence) {
            insertionIndex = index + 1;
            break;
          }
        }
      }
    }
    if (insertionIndex < 0) {
      const segmentTime = Date.parse(segment.startedAt);
      if (Number.isFinite(segmentTime)) {
        insertionIndex = ordered.findIndex((candidate) => {
          if (candidate.kind !== 'tool' || !candidate.startedAt) return false;
          const candidateTime = Date.parse(candidate.startedAt);
          return Number.isFinite(candidateTime) && candidateTime > segmentTime;
        });
      }
    }
    if (insertionIndex < 0) {
      const firstBoundary = ordered.findIndex(
        (candidate) => candidate.kind === 'tool' || candidate.kind === 'status',
      );
      insertionIndex = firstBoundary < 0 ? ordered.length : firstBoundary;
    }
    ordered.splice(insertionIndex, 0, item);
  }
  return ordered;
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
  defaultOpen,
  agentTaskContent,
  supplementalContent,
  onOpenChange,
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
  /** Reserved for real delegated task projections; omitted when no tasks exist. */
  agentTaskContent?: ReactNode;
  supplementalContent?: ReactNode;
  onOpenChange?: (path: string) => void;
}) {
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    if (items.some((item) => item.kind === 'tool' || item.kind === 'status')) {
      return mergeMissingCommentary(items, steps, commentarySegments);
    }
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

  const [expandedItemKeys, setExpandedItemKeys] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setExpandedItemKeys(new Set());
  }, [runId]);
  const toggleItem = useCallback((itemKey: string) => {
    setExpandedItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }, []);
  const [clockNow, setClockNow] = useState(() => Date.now());
  // 面板层唯一的秒级时钟，驱动总耗时、每行运行耗时和停滞分级。运行中就必须
  // 走（不能再要求 startedAt）——工具行的耗时只依赖各自的 startedAt。
  const ticking = Boolean(streaming) && !completedAt;
  useEffect(() => {
    if (!ticking) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // A completed turn only folds when it has a real final answer beside the
  // trace. Commentary-only and terminal-only turns stay open so the entire
  // assistant response never collapses into an empty-looking header.
  const automaticPanelOpen = defaultOpen ?? Boolean(streaming || !answerStarted);
  const { open: panelOpen, toggle: togglePanel } = useAutoDisclosure({
    autoOpen: automaticPanelOpen,
    resetKey: runId,
  });
  const durationLabel = processDurationLabel({
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    now: clockNow,
    streaming,
  });
  const hasActiveRow = orderedItems.some(
    (item) =>
      (item.kind === 'reasoning' && item.status === 'streaming') ||
      (item.kind === 'tool' && toolStatusOf(item) === 'running'),
  );
  const showWaiting = Boolean(streaming && !answerStarted && !hasActiveRow);
  const failedToolCount = orderedItems.reduce(
    (count, item) => count + (item.kind === 'tool' && toolStatusOf(item) === 'failed' ? 1 : 0),
    0,
  );
  if (orderedItems.length === 0 && !showWaiting && !agentTaskContent && !supplementalContent) {
    return null;
  }
  return (
    <section
      className="shell-process-panel shell-harness-trace"
      data-testid="process-panel"
      data-streaming={streaming ? '1' : '0'}
      data-failed={failedToolCount > 0 ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-process-panel__toggle"
        data-testid="process-panel-toggle"
        aria-expanded={panelOpen}
        onClick={togglePanel}
      >
        <span className="shell-process-panel__title">执行过程</span>
        {failedToolCount > 0 ? (
          <>
            <span className="shell-process-panel__separator" aria-hidden="true">
              ·
            </span>
            <span className="shell-process-panel__failure">{failedToolCount} 项失败</span>
          </>
        ) : null}
        {durationLabel ? (
          <>
            <span className="shell-process-panel__separator" aria-hidden="true">
              ·
            </span>
            <span className="shell-process-panel__elapsed">{durationLabel}</span>
          </>
        ) : null}
        <ChevronDown
          size={13}
          className={`shell-process-panel__chevron${panelOpen ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {panelOpen ? (
        <div className="shell-process-panel__body" data-testid="process-panel-body">
          {agentTaskContent ? (
            <section className="shell-process-agent-tasks" data-testid="process-agent-tasks">
              <div className="shell-process-agent-tasks__header">
                <Users size={13} aria-hidden="true" />
                <span>智能体任务</span>
              </div>
              <div className="shell-process-agent-tasks__body">{agentTaskContent}</div>
            </section>
          ) : null}
          {orderedItems.length > 0 || showWaiting ? (
            <div className="shell-inline-process" data-testid="inline-process-flow">
              {orderedItems.map((item, index) => (
                <ProcessEntry
                  key={processItemKey(item, index)}
                  item={item}
                  index={index}
                  streaming={streaming}
                  now={clockNow}
                  expandedItemKeys={expandedItemKeys}
                  toggleItem={toggleItem}
                  onOpenChange={onOpenChange}
                />
              ))}
              {showWaiting ? <WaitingRow /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {supplementalContent ? (
        <div className="shell-process-panel__supplemental">{supplementalContent}</div>
      ) : null}
    </section>
  );
});
