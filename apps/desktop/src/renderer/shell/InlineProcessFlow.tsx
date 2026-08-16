/**
 * DSH-style inline execution process for an assistant message.
 *
 * Renders the ordered process items inside ONE collapsible outer panel so a
 * reader who only wants the final conclusion can skip the process entirely:
 *
 *   [执行过程 · N 个工具 · 12s]   ← outer panel (collapsed by default,
 *                                    auto-opens while streaming)
 *     ├─ 思考行（折叠显示首行，展开看全文）
 *     ├─ 摘要 / 中间文本（内联）
 *     └─ [read_file ×2 · write_file ×1 · 2s]   ← tool batch (adjacent tools
 *           ├─ read_file …                    grouped; expand to individual
 *           └─ write_file …                   cards, each expandable)
 *
 * Tool cards have two sources: durable message blocks (external kernels such
 * as claude-code / codex write tool-call/tool-result blocks) and the run
 * process view steps (native kernel keeps tools in run events, not blocks).
 * When the blocks carry no tool items, the steps are merged through the same
 * boundary ordering as ExecutionTimeline (commentary segments interleaved by
 * their afterSequence).
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { Brain, ChevronDown, CircleAlert, Layers, Wrench } from 'lucide-react';
import type { CommentaryTimelineSegment, ExecutionProcessStep } from '@sync-think/protocol';
import type { InlineProcessItem } from './ChatView.js';
import { MarkdownContent } from './MarkdownContent.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';

type ToolItem = Extract<InlineProcessItem, { kind: 'tool' }>;

/** A renderable sequence entry: a single item or a batch of adjacent tools. */
type RenderItem = InlineProcessItem | { kind: 'tool-batch'; tools: ToolItem[] };

/** First non-empty line of a multi-line text (the collapsed Think-row summary). */
function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '');
  return line?.trim() ?? '';
}

/** Last non-empty line while streaming (the running summary stays current). */
function latestLine(text: string): string {
  const lines = text.split('\n').filter((part) => part.trim() !== '');
  return lines.at(-1)?.trim() ?? '';
}

/** Format a millisecond duration as a compact `Ns` label. */
function formatElapsed(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  return `${Math.round(ms / 1000)}s`;
}

/** Merge adjacent tool items into batches (a thinking/summary row splits them). */
function groupToolBatches(items: readonly InlineProcessItem[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const item of items) {
    if (item.kind !== 'tool') {
      out.push(item);
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'tool-batch') last.tools.push(item);
    else out.push({ kind: 'tool-batch', tools: [item] });
  }
  return out;
}

/** Span of a batch's step timestamps (earliest start → latest completion). */
function batchElapsed(tools: readonly ToolItem[]): string | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const tool of tools) {
    const start = tool.startedAt ? Date.parse(tool.startedAt) : Number.NaN;
    const end = tool.completedAt ? Date.parse(tool.completedAt) : Number.NaN;
    if (Number.isFinite(start)) min = Math.min(min, start);
    if (Number.isFinite(end)) max = Math.max(max, end);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return formatElapsed(max - min);
}

/** Aggregated batch title: `read_file ×2 · write_file · 2s`. */
function batchTitle(tools: readonly ToolItem[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([name, count]) =>
    count > 1 ? `${name} ×${count}` : name,
  );
  const elapsed = batchElapsed(tools);
  return parts.join(' · ') + (elapsed ? ` · ${elapsed}` : '');
}

function ThinkRow({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = streaming ? latestLine(text) : firstLine(text);
  return (
    <div className="shell-inline-process__think" data-testid="inline-process-reasoning">
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Brain size={12} aria-hidden="true" />
        <span className="shell-inline-process__think-label">思考</span>
        <span className="shell-inline-process__think-summary" data-testid="think-row-summary">
          {summary}
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MarkdownContent text={text} streaming={Boolean(streaming)} />
        </div>
      ) : null}
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`shell-inline-process__tool${item.failed ? ' is-failed' : ''}`}
      data-testid="inline-process-tool"
      data-failed={item.failed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-inline-process__tool-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Wrench size={12} aria-hidden="true" />
        <span className="shell-inline-process__tool-name">{item.name}</span>
        {item.failed ? (
          <CircleAlert
            size={12}
            className="shell-inline-process__tool-failed-icon"
            aria-hidden="true"
          />
        ) : null}
        <span className="shell-inline-process__tool-status">
          {item.failed ? '失败' : item.result !== undefined ? '完成' : '执行中'}
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-inline-process__tool-body">
          {item.argumentsJson ? (
            <pre className="shell-inline-process__tool-code">{item.argumentsJson}</pre>
          ) : null}
          {item.result !== undefined ? (
            <pre
              className={`shell-inline-process__tool-code${item.failed ? ' is-failed' : ''}`}
              data-testid="inline-process-tool-result"
            >
              {item.result}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One batch of adjacent tool calls: expand to see the individual cards. */
function ToolBatchCard({ tools }: { tools: readonly ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const failed = tools.some((tool) => tool.failed);
  return (
    <div
      className={`shell-tool-batch${failed ? ' has-failed' : ''}`}
      data-testid="tool-batch"
    >
      <button
        type="button"
        className="shell-tool-batch__toggle"
        data-testid="tool-batch-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Layers size={12} aria-hidden="true" />
        <span className="shell-tool-batch__title">{batchTitle(tools)}</span>
        <span className="shell-tool-batch__count">{tools.length} 个调用</span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-tool-batch__body" data-testid="tool-batch-body">
          {tools.map((tool, index) => (
            <ToolCard key={`${tool.name}-${index}`} item={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
}: {
  item: RenderItem;
  streaming?: boolean;
}) {
  if (item.kind === 'tool-batch') return <ToolBatchCard tools={item.tools} />;
  switch (item.kind) {
    case 'reasoning':
      return <ThinkRow text={item.text} streaming={streaming} />;
    case 'text':
      return (
        <div className="shell-inline-process__text" data-testid="inline-process-text">
          <MarkdownContent text={item.text} streaming={Boolean(streaming)} />
        </div>
      );
    case 'commentary':
      return (
        <div className="shell-inline-process__commentary" data-testid="inline-process-commentary">
          <MarkdownContent text={item.text} streaming={Boolean(streaming)} />
        </div>
      );
    case 'tool':
      return <ToolCard item={item} />;
    default:
      return null;
  }
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  steps,
  commentarySegments,
  streaming,
  durationMs,
  autoOpen = false,
}: {
  items: readonly InlineProcessItem[];
  /** Run process-view steps (native kernel tools live here, not in blocks). */
  steps?: readonly ExecutionProcessStep[];
  /** Commentary timeline segments interleaved with the steps' sequence. */
  commentarySegments?: readonly CommentaryTimelineSegment[];
  streaming?: boolean;
  /** Overall run elapsed time shown in the outer panel title. */
  durationMs?: number;
  /** Auto-expand the outer panel (e.g. while the run is streaming). */
  autoOpen?: boolean;
}) {
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    // External kernels write tool-call/tool-result blocks; keep their order.
    if (items.some((item) => item.kind === 'tool')) return items;
    // Native kernel: tools live in the run process view. Merge steps with the
    // commentary segments using the same boundary ordering as the timeline,
    // and let the timeline own the commentary rows (blocks repeat them).
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
          ...(step.status === 'error' ? { failed: true } : {}),
          ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
          ...(step.completedAt !== undefined ? { completedAt: step.completedAt } : {}),
        });
      }
    }
    // Reasoning and intermediate text keep their block order before the
    // interleaved commentary/tool segment (native blocks rarely carry text).
    return [...items.filter((item) => item.kind !== 'commentary'), ...merged];
  }, [items, steps, commentarySegments]);

  const rendered = useMemo(() => groupToolBatches(orderedItems), [orderedItems]);
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  if (rendered.length === 0) return null;

  const toolCount = rendered.reduce(
    (sum, item) => (item.kind === 'tool-batch' ? sum + item.tools.length : sum),
    0,
  );
  const elapsed =
    formatElapsed(durationMs) ??
    (toolCount > 0
      ? batchElapsed(rendered.flatMap((item) => (item.kind === 'tool-batch' ? item.tools : [])))
      : undefined);

  return (
    <section className="shell-process-panel" data-testid="process-panel">
      <button
        type="button"
        className="shell-process-panel__toggle"
        data-testid="process-panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="shell-process-panel__title">执行过程</span>
        {toolCount > 0 ? (
          <span className="shell-process-panel__meta">{toolCount} 个工具</span>
        ) : null}
        {elapsed ? <span className="shell-process-panel__meta">· {elapsed}</span> : null}
        <ChevronDown
          size={14}
          className={`shell-process-panel__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-process-panel__body" data-testid="process-panel-body">
          {rendered.map((item, index) => (
            <ProcessItemView
              key={item.kind === 'tool-batch' ? `batch-${index}` : `${item.kind}-${index}`}
              item={item}
              streaming={streaming}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});
