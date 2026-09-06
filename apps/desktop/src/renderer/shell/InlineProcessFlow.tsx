/**
 * DeepSeek Harness-style ordered assistant execution flow.
 * Think, commentary and status stay on their own rows in document order.
 * Consecutive tool calls fold into a local action summary that expands in place.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Shield,
  SquareTerminal,
  Users,
  Wrench,
} from 'lucide-react';
import type { CommentaryTimelineSegment, ExecutionProcessStep } from '@sync-think/protocol';
import type { InlineProcessItem } from './ChatView.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { MessageTextContent } from './MessageTextContent.js';
import { CodeBlock } from './CodeBlock.js';
import { CopyTextButton } from './CopyTextButton.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';
import {
  activityFingerprint,
  deriveCurrentActivity,
  deriveStallState,
  formatElapsedZh,
  friendlyToolName,
  groupConsecutiveProcessTools,
  toolVisualKind,
  toolInputSummary,
  toolStatusOf,
  type ConsecutiveProcessBlock,
  type ProcessActivity,
  type ProcessStallState,
  type ProcessToolVisualKind,
} from './process-activity.js';
import { LoadingPixelGrid } from './LoadingPixelGrid.js';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { parseDeferredContent } from '@sync-think/shared';

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
        data-highlight-band={isStreaming ? 'true' : undefined}
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
        <span
          className={`shell-inline-process__think-label${isStreaming ? ' shell-text-shimmer' : ''}`}
          data-label={isStreaming ? 'Think' : undefined}
        >
          Think
        </span>
        <span className="shell-inline-process__separator" aria-hidden="true">
          ·
        </span>
        <span
          className={`shell-inline-process__think-summary${isStreaming ? ' shell-text-shimmer' : ''}`}
          data-testid="think-row-summary"
          data-label={isStreaming ? summary : undefined}
        >
          {summary}
        </span>
      </button>
      {open && body ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MessageTextContent
            text={body}
            parts={item.contentRef ? [{ text: body, contentRef: item.contentRef }] : undefined}
            sourceStreaming={isStreaming}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToolKindIcon({ kind }: { kind: ProcessToolVisualKind }) {
  if (kind === 'read') return <FileCode2 size={14} />;
  if (kind === 'write') return <PencilLine size={14} />;
  if (kind === 'list') return <FolderOpen size={14} />;
  if (kind === 'command') return <SquareTerminal size={14} />;
  if (kind === 'git') return <GitBranch size={14} />;
  if (kind === 'browser') return <Globe size={14} />;
  if (kind === 'search') return <Search size={14} />;
  if (kind === 'mcp') return <Plug size={14} />;
  return <Wrench size={14} />;
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
  streaming = false,
  label = '输出',
  deferred,
}: {
  text: string;
  testId: string;
  failed?: boolean;
  streaming?: boolean;
  label?: string;
  deferred?: import('@sync-think/shared').DeferredContent;
}) {
  const contentReference = parseDeferredContent(deferred);
  if (contentReference)
    return (
      <DeferredToolContent
        deferred={contentReference}
        preview={text}
        label={label}
        streaming={streaming}
        failed={failed}
        testId={testId}
      />
    );
  const fields = structuredFields(text);
  if (!fields) {
    return (
      <div className={`shell-tool-result${failed ? ' is-failed' : ''}`} data-testid={testId}>
        <CodeBlock
          code={text}
          language={['{', '['].includes(text.trimStart().charAt(0)) ? 'json' : 'text'}
          streaming={streaming}
          copyLabel={`复制${label}`}
          collapsible={false}
          maxHeight={240}
          showStatus={false}
        />
      </div>
    );
  }
  return (
    <div className={`shell-tool-result${failed ? ' is-failed' : ''}`} data-testid={testId}>
      <div className="shell-tool-result__bar">
        <span>JSON</span>
        <CopyTextButton text={text} label={`复制${label}`} />
      </div>
      <dl className={`shell-inline-process__structured${failed ? ' is-failed' : ''}`}>
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
    </div>
  );
}

function ToolRow({
  item,
  liveClock,
  now,
  open,
  onToggle,
  onOpenChange,
}: {
  item: Extract<InlineProcessItem, { kind: 'tool' }>;
  /** 面板本次挂载中活过才展示实时计时；历史消息里残留的 running 行不走时钟。 */
  liveClock?: boolean;
  /** 面板层的秒级时钟；仅运行中的行会用到。 */
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenChange?: (path: string) => void;
}) {
  const status = toolStatusOf(item);
  const summary = toolInputSummary(item);
  const elapsed = elapsedLabel(item.startedAt, item.completedAt);
  const liveElapsed =
    status === 'running' && liveClock ? runningElapsedLabel(item.startedAt, now) : undefined;
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
        data-highlight-band={status === 'running' ? 'true' : undefined}
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
        {(status === 'running' ? liveElapsed : elapsed) ? (
          <span
            className="shell-inline-process__tool-elapsed"
            data-testid="inline-process-tool-elapsed"
          >
            {status === 'running' ? liveElapsed : elapsed}
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
              <ToolPayload
                text={item.argumentsJson}
                testId="inline-process-tool-arguments"
                label="参数"
                deferred={item.argumentsRef}
              />
            </div>
          ) : null}
          {item.detailsRef ? (
            <DeferredToolContent
              deferred={item.detailsRef}
              preview="包含较大的附加字段；完整事件展示数据按需读取。"
              label="事件详情"
              testId="inline-process-event-details"
            />
          ) : null}
          {detailResult !== undefined ? (
            <div className="shell-inline-process__detail-block">
              <span>{status === 'failed' ? '错误' : '输出'}</span>
              <ToolPayload
                text={detailResult}
                testId="inline-process-tool-result"
                failed={status === 'failed'}
                streaming={status === 'running'}
                label={status === 'failed' ? '错误' : '输出'}
                deferred={item.resultRef}
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

function ProcessActivityRow({
  activity,
  stall,
  elapsed,
}: {
  activity: ProcessActivity;
  stall?: ProcessStallState;
  elapsed?: string;
}) {
  return (
    <div
      className="shell-process-panel__activity"
      data-testid="process-panel-activity"
      data-kind={activity.kind}
      data-stall={stall?.level ?? 'active'}
      role="status"
      aria-live="polite"
    >
      {activity.kind === 'approval' ? <Shield size={16} aria-hidden="true" /> : <LoadingPixelGrid />}
      <span
        className="shell-process-panel__activity-label"
        data-label={activity.label}
        data-testid="process-activity-label"
      >
        {activity.label}
      </span>
      {elapsed ? <span className="shell-process-panel__activity-elapsed">{elapsed}</span> : null}
      {stall && stall.level !== 'active' ? (
        <span className="shell-process-panel__activity-idle">
          {stall.hint ?? `${Math.floor(stall.idleMs / 1000)}s 无输出`}
        </span>
      ) : null}
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
  liveClock,
  now,
  open,
  onToggle,
  onOpenChange,
}: {
  item: InlineProcessItem;
  streaming?: boolean;
  liveClock?: boolean;
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
      <ToolRow
        item={item}
        liveClock={liveClock}
        now={now}
        open={open}
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />
    );
  }
  if (item.kind === 'status') return <StatusRow item={item} />;
  return (
    <div
      className="shell-inline-process__markdown"
      data-testid={item.kind === 'commentary' ? 'inline-process-commentary' : 'inline-process-text'}
    >
      <MessageTextContent
        text={item.text}
        parts={item.contentRef ? [{ text: item.text, contentRef: item.contentRef }] : undefined}
        sourceStreaming={item.status === 'streaming'}
      />
    </div>
  );
}

function ProcessEntry({
  item,
  index,
  streaming,
  liveClock,
  now,
  expandedItemKeys,
  toggleItem,
  onOpenChange,
}: {
  item: InlineProcessItem;
  index: number;
  streaming?: boolean;
  liveClock?: boolean;
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
          liveClock={liveClock}
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

function ProcessActionSummary({
  summary,
  open,
  onToggle,
  children,
}: {
  summary: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="shell-process-actions" data-testid="process-action-summary">
      <button
        type="button"
        className="shell-process-actions__toggle"
        data-testid="process-action-summary-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronDown
          size={13}
          className={`shell-process-actions__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
        <span className="shell-process-actions__label">{summary}</span>
      </button>
      {open ? <div className="shell-process-actions__body">{children}</div> : null}
    </div>
  );
}

function consecutiveToolRunShouldOpen(
  block: Extract<ConsecutiveProcessBlock, { kind: 'tools' }>,
  input: {
    defaultOpen?: boolean;
    userToggled: ReadonlySet<string>;
    currentlyOpen: ReadonlySet<string>;
  },
): boolean {
  if (input.userToggled.has(block.key)) return input.currentlyOpen.has(block.key);
  if (input.defaultOpen === true) return true;
  return block.entries.some((entry) => toolStatusOf(entry.item) === 'running');
}

function nextOpenToolRuns(
  blocks: readonly ConsecutiveProcessBlock[],
  input: {
    defaultOpen?: boolean;
    userToggled: ReadonlySet<string>;
    currentlyOpen: ReadonlySet<string>;
  },
): Set<string> {
  const next = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== 'tools') continue;
    if (consecutiveToolRunShouldOpen(block, input)) next.add(block.key);
  }
  return next;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function ThinkVisibilitySwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="显示 Think"
      aria-checked={checked}
      data-testid="process-think-switch"
      className={`shell-process-panel__think-switch${checked ? ' is-checked' : ''}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange?.(!checked);
      }}
    >
      <span className="shell-process-panel__think-switch-label">Think</span>
      <span className="shell-process-panel__think-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  steps,
  totalFailedTools,
  pageControls,
  commentarySegments,
  streaming,
  waitingForApproval = false,
  answerStarted = false,
  runId,
  conversationId,
  startedAt,
  completedAt,
  durationMs,
  defaultOpen,
  collapseExecutionProcess = true,
  showToolUse = true,
  showThinking = true,
  onShowThinkingChange,
  toolCallExpandedByDefault = false,
  agentTaskContent,
  supplementalContent,
  onOpenChange,
  onPanelOpen,
  timelineLoadState = 'idle',
  timelineLoadedCount,
  timelineTotalSegments,
  timelineHasMore = false,
  onLoadMoreTimeline,
  onRetryTimelineLoad,
}: {
  items: readonly InlineProcessItem[];
  steps?: readonly ExecutionProcessStep[];
  totalFailedTools?: number;
  pageControls?: ReactNode;
  commentarySegments?: readonly CommentaryTimelineSegment[];
  streaming?: boolean;
  waitingForApproval?: boolean;
  answerStarted?: boolean;
  runId?: string;
  conversationId?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** Deterministic fixture override; production follows the run phase. */
  defaultOpen?: boolean;
  /** Merge the completed trace behind an execution summary row. */
  collapseExecutionProcess?: boolean;
  /** Keep tool rows in the conversation trace. */
  showToolUse?: boolean;
  /** Keep Think rows in the conversation trace. */
  showThinking?: boolean;
  onShowThinkingChange?: (value: boolean) => void;
  /** Open each newly observed tool's input/output until the user toggles it. */
  toolCallExpandedByDefault?: boolean;
  /** Reserved for real delegated task projections; omitted when no tasks exist. */
  agentTaskContent?: ReactNode;
  supplementalContent?: ReactNode;
  onOpenChange?: (path: string) => void;
  /** Lazy detail seam: invoked once when this run's folded panel first opens. */
  onPanelOpen?: () => void;
  timelineLoadState?: 'idle' | 'loading' | 'loaded' | 'error';
  timelineLoadedCount?: number;
  timelineTotalSegments?: number;
  timelineHasMore?: boolean;
  onLoadMoreTimeline?: () => void;
  onRetryTimelineLoad?: () => void;
}) {
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    const stepsById = new Map(steps?.map((step) => [step.id, step]));
    const visibleItems = items
      .filter((item) => {
        if (!showToolUse && item.kind === 'tool') return false;
        if (!showThinking && item.kind === 'reasoning') return false;
        return true;
      })
      .map((item) => {
        if (item.kind !== 'tool') return item;
        const step =
          (item.toolCallId ? stepsById.get(item.toolCallId) : undefined) ??
          (item.id ? stepsById.get(item.id) : undefined);
        if (!step?.outputRef && !step?.argumentsRef && !step?.detailsRef) return item;
        return {
          ...item,
          detailsRef: step.detailsRef ?? item.detailsRef,
          resultRef:
            !item.resultRef || item.resultRef.reference.source === 'message'
              ? (step.outputRef ?? item.resultRef)
              : item.resultRef,
          argumentsRef:
            !item.argumentsRef || item.argumentsRef.reference.source === 'message'
              ? (step.argumentsRef ?? item.argumentsRef)
              : item.argumentsRef,
        };
      });
    const visibleSteps = showToolUse ? steps : undefined;
    if (visibleItems.some((item) => item.kind === 'tool' || item.kind === 'status')) {
      return mergeMissingCommentary(visibleItems, visibleSteps, commentarySegments);
    }
    if (!visibleSteps?.length && !commentarySegments?.length) return visibleItems;
    const merged: InlineProcessItem[] = [];
    for (const item of buildExecutionTimeline({ steps: visibleSteps, commentarySegments })) {
      if (item.type === 'commentary') {
        if (item.text.trim()) merged.push({ kind: 'commentary', text: item.text });
        continue;
      }
      for (const step of item.steps) {
        merged.push({
          kind: 'tool',
          toolCallId: step.id,
          name: step.toolName ?? step.label ?? '工具',
          argumentsJson: step.command ?? step.url ?? step.path ?? '',
          result: step.preview ?? step.error ?? '',
          ...(step.outputRef ? { resultRef: step.outputRef } : {}),
          ...(step.detailsRef ? { detailsRef: step.detailsRef } : {}),
          ...(step.argumentsRef ? { argumentsRef: step.argumentsRef } : {}),
          status: step.status === 'error' ? 'failed' : step.completedAt ? 'completed' : 'running',
          ...(step.status === 'error' ? { failed: true } : {}),
          ...(step.startedAt ? { startedAt: step.startedAt } : {}),
          ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        });
      }
    }
    return [...visibleItems.filter((item) => item.kind !== 'commentary'), ...merged];
  }, [commentarySegments, items, showThinking, showToolUse, steps]);
  const timelineBlocks = useMemo(() => groupConsecutiveProcessTools(orderedItems), [orderedItems]);

  const [expandedItemKeys, setExpandedItemKeys] = useState<ReadonlySet<string>>(() => new Set());
  const userToggledItemKeysRef = useRef<Set<string>>(new Set());
  const expandedRunIdRef = useRef(runId);
  useEffect(() => {
    const runChanged = expandedRunIdRef.current !== runId;
    if (runChanged) {
      expandedRunIdRef.current = runId;
      userToggledItemKeysRef.current.clear();
    }
    setExpandedItemKeys((current) => {
      const next = runChanged ? new Set<string>() : new Set(current);
      for (const [index, item] of orderedItems.entries()) {
        if (item.kind !== 'tool') continue;
        const itemKey = processItemKey(item, index);
        if (userToggledItemKeysRef.current.has(itemKey)) continue;
        if (
          toolCallExpandedByDefault ||
          (toolStatusOf(item) === 'running' && Boolean(item.result))
        )
          next.add(itemKey);
        else next.delete(itemKey);
      }
      return next;
    });
  }, [orderedItems, runId, toolCallExpandedByDefault]);
  const toggleItem = useCallback((itemKey: string) => {
    userToggledItemKeysRef.current.add(itemKey);
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
  // 本次挂载中面板是否活过：活过再 settle 时冻结显示最后的计时；而挂载时
  // 就已 settle 的历史消息里若残留 status=running 的工具行，绝不能拿当前
  // 时间对着几天前的 startedAt 计时（会显示几百小时）。
  const everStreamedRef = useRef(Boolean(streaming));
  if (streaming) everStreamedRef.current = true;
  const liveClock = everStreamedRef.current;
  useEffect(() => {
    if (!ticking) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // A completed turn only folds when it has a real final answer beside the
  // trace. Commentary-only and terminal-only turns stay open so the entire
  // assistant response never collapses into an empty-looking header.
  const automaticPanelOpen =
    defaultOpen ??
    Boolean(streaming || !answerStarted);
  const { open: disclosedPanelOpen, toggle: togglePanel } = useAutoDisclosure({
    autoOpen: automaticPanelOpen,
    resetKey: runId,
  });
  const panelOpen = collapseExecutionProcess ? disclosedPanelOpen : true;
  const userToggledToolRunsRef = useRef(new Set<string>());
  const toolRunResetKeyRef = useRef(runId);
  const [openToolRuns, setOpenToolRuns] = useState<ReadonlySet<string>>(() =>
    nextOpenToolRuns(timelineBlocks, {
      defaultOpen,
      userToggled: new Set(),
      currentlyOpen: new Set(),
    }),
  );
  if (toolRunResetKeyRef.current !== runId) {
    toolRunResetKeyRef.current = runId;
    userToggledToolRunsRef.current.clear();
  }
  useEffect(() => {
    setOpenToolRuns((current) => {
      const next = nextOpenToolRuns(timelineBlocks, {
        defaultOpen,
        userToggled: userToggledToolRunsRef.current,
        currentlyOpen: current,
      });
      return sameStringSet(next, current) ? current : next;
    });
  }, [defaultOpen, runId, timelineBlocks]);
  const toggleToolRun = useCallback((key: string) => {
    userToggledToolRunsRef.current.add(key);
    setOpenToolRuns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const notifiedOpenRunRef = useRef<string>();
  useEffect(() => {
    if (!panelOpen || !onPanelOpen) return;
    const key = runId ?? 'anonymous-run';
    if (notifiedOpenRunRef.current === key) return;
    notifiedOpenRunRef.current = key;
    onPanelOpen();
  }, [onPanelOpen, panelOpen, runId]);
  useEffect(() => {
    if (!panelOpen || timelineLoadState !== 'loaded' || !timelineHasMore || !onLoadMoreTimeline)
      return;
    onLoadMoreTimeline();
  }, [onLoadMoreTimeline, panelOpen, timelineHasMore, timelineLoadState]);
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
  // 活动摘要始终落在执行流最下方，作为这一轮的实时落点。像素格与 shimmer
  // 是进程活着的视觉证据；停滞分级只在长时间无输出时追加中性提示。
  // Activity still reads hidden Think rows so the bottom status can show the
  // latest reasoning line after the user turns the Think switch off.
  const activity = deriveCurrentActivity(items, {
    streaming: Boolean(streaming),
    waitingForApproval,
  });
  const fingerprint = useMemo(() => activityFingerprint(orderedItems), [orderedItems]);
  const [lastProgressAt, setLastProgressAt] = useState(() => Date.now());
  useEffect(() => {
    setLastProgressAt(Date.now());
  }, [fingerprint, waitingForApproval]);
  const stall = activity
    ? deriveStallState({ activity, lastProgressAt, now: clockNow })
    : undefined;
  const showWaiting = Boolean(streaming && !answerStarted && !hasActiveRow);
  const failedToolCount =
    totalFailedTools ??
    orderedItems.reduce(
      (count, item) => count + (item.kind === 'tool' && toolStatusOf(item) === 'failed' ? 1 : 0),
      0,
    );
  const hasHiddenThinking = !showThinking && items.some((item) => item.kind === 'reasoning');
  if (
    orderedItems.length === 0 &&
    !waitingForApproval &&
    !showWaiting &&
    !agentTaskContent &&
    !supplementalContent &&
    !hasHiddenThinking
  ) {
    return null;
  }
  const processMeta =
    failedToolCount > 0 || durationLabel ? (
      <>
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
      </>
    ) : null;
  const renderProcessEntry = (item: InlineProcessItem, index: number) => (
    <ProcessEntry
      key={processItemKey(item, index)}
      item={item}
      index={index}
      streaming={streaming}
      liveClock={liveClock}
      now={clockNow}
      expandedItemKeys={expandedItemKeys}
      toggleItem={toggleItem}
      onOpenChange={onOpenChange}
    />
  );
  return (
    <ConversationContentScope.Provider value={conversationId}>
      <section
        className="shell-process-panel shell-harness-trace"
        data-testid="process-panel"
        data-streaming={streaming ? '1' : '0'}
        data-failed={failedToolCount > 0 ? 'true' : 'false'}
      >
        <div className="shell-process-panel__header">
          {collapseExecutionProcess ? (
            <button
              type="button"
              className="shell-process-panel__toggle"
              data-testid="process-panel-toggle"
              aria-expanded={panelOpen}
              onClick={togglePanel}
            >
              <span className="shell-process-panel__title">执行过程</span>
              {processMeta}
              <ChevronDown
                size={13}
                className={`shell-process-panel__chevron${panelOpen ? ' is-open' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="shell-process-panel__heading">
              <span className="shell-process-panel__title">执行过程</span>
              {processMeta}
            </div>
          )}
          <ThinkVisibilitySwitch checked={showThinking} onChange={onShowThinkingChange} />
        </div>
        {panelOpen ? (
          <div className="shell-process-panel__body" data-testid="process-panel-body">
            {pageControls}
            {agentTaskContent ? (
              <section className="shell-process-agent-tasks" data-testid="process-agent-tasks">
                <div className="shell-process-agent-tasks__header">
                  <Users size={13} aria-hidden="true" />
                  <span>智能体任务</span>
                </div>
                <div className="shell-process-agent-tasks__body">{agentTaskContent}</div>
              </section>
            ) : null}
            {orderedItems.length > 0 ? (
              <div className="shell-inline-process" data-testid="inline-process-flow">
                {timelineBlocks.map((block) => {
                  if (block.kind === 'item') return renderProcessEntry(block.item, block.index);
                  const open = openToolRuns.has(block.key);
                  return (
                    <ProcessActionSummary
                      key={block.key}
                      summary={block.summary}
                      open={open}
                      onToggle={() => toggleToolRun(block.key)}
                    >
                      {open
                        ? block.entries.map((entry) => renderProcessEntry(entry.item, entry.index))
                        : null}
                    </ProcessActionSummary>
                  );
                })}
              </div>
            ) : null}
            {timelineLoadState === 'loading' ? (
              <div className="shell-process-panel__lazy-state" role="status">
                <RotateCw size={12} className="shell-process-spin" aria-hidden="true" />
                <span>
                  {timelineLoadedCount
                    ? timelineTotalSegments
                      ? `继续加载执行过程…（${timelineLoadedCount}/${timelineTotalSegments}）`
                      : '继续加载执行过程…'
                    : '加载完整执行过程…'}
                </span>
              </div>
            ) : timelineLoadState === 'error' ? (
              <button
                type="button"
                className="shell-process-panel__lazy-retry"
                onClick={onRetryTimelineLoad}
              >
                <RotateCw size={12} aria-hidden="true" />
                <span>重新加载完整执行过程</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {supplementalContent ? (
          <div className="shell-process-panel__supplemental">{supplementalContent}</div>
        ) : null}
        {activity ? (
          <ProcessActivityRow activity={activity} stall={stall} elapsed={durationLabel} />
        ) : null}
      </section>
    </ConversationContentScope.Provider>
  );
});
