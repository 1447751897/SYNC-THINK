import { useMemo } from 'react';
import type {
  CommentaryTimelineSegment,
  ExecutionProcessStep,
  RunProcessView,
} from '@sync-think/protocol';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAutoDisclosure } from './auto-disclosure.js';
import { ExecutionProcessStepCard } from './ExecutionProcessBlock.js';

type RawExecutionTimelineItem =
  | {
      type: 'commentary';
      id: string;
      text: string;
      startedAt?: string;
      completedAt?: string;
      afterSequence?: number;
      sortKey: number;
      originalIndex: number;
    }
  | {
      type: 'tool';
      id: string;
      step: ExecutionProcessStep;
      startedAt?: string;
      completedAt?: string;
      sequence?: number;
      sortKey: number;
      originalIndex: number;
    };

export type ExecutionTimelineItem =
  | Extract<RawExecutionTimelineItem, { type: 'commentary' }>
  | {
      type: 'tools';
      id: string;
      steps: ExecutionProcessStep[];
      startedAt?: string;
      completedAt?: string;
      sortKey: number;
      originalIndex: number;
    };

function timestampSortKey(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundarySortKey(item: RawExecutionTimelineItem): number | undefined {
  if (item.type === 'tool') return item.sequence;
  return item.afterSequence !== undefined ? item.afterSequence + 0.5 : undefined;
}

function itemTimestamp(item: RawExecutionTimelineItem): number | undefined {
  if (!item.startedAt) return undefined;
  const parsed = Date.parse(item.startedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function groupAdjacentTools(items: readonly RawExecutionTimelineItem[]): ExecutionTimelineItem[] {
  const grouped: ExecutionTimelineItem[] = [];

  for (const item of items) {
    if (item.type === 'commentary') {
      grouped.push(item);
      continue;
    }

    const previous = grouped[grouped.length - 1];
    if (previous?.type === 'tools') {
      previous.steps.push(item.step);
      // Keep the first tool id stable as more calls join this batch so manual
      // disclosure choices survive streaming updates.
      previous.completedAt = item.completedAt ?? previous.completedAt;
      continue;
    }

    grouped.push({
      type: 'tools',
      id: `tools:${item.step.id}`,
      steps: [item.step],
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      sortKey: item.sortKey,
      originalIndex: item.originalIndex,
    });
  }

  return grouped;
}

/**
 * Commentary tokens are transient, while tool boundaries are durable. A
 * commentary segment records the latest durable sequence observed when it
 * started, so placing it at `afterSequence + 0.5` reconstructs the interleaved
 * execution order without persisting one event per token.
 */
export function buildExecutionTimeline(input: {
  commentarySegments?: readonly CommentaryTimelineSegment[];
  commentaryText?: string;
  steps?: readonly ExecutionProcessStep[];
}): ExecutionTimelineItem[] {
  const timeline: RawExecutionTimelineItem[] = [];
  const steps = input.steps ?? [];

  for (const [index, step] of steps.entries()) {
    const sequence = step.sequence;
    timeline.push({
      type: 'tool',
      id: step.id,
      step,
      startedAt: step.startedAt ?? step.occurredAt,
      completedAt: step.completedAt,
      sequence,
      sortKey:
        sequence !== undefined
          ? sequence
          : timestampSortKey(step.startedAt ?? step.occurredAt, index),
      originalIndex: index,
    });
  }

  const visibleSegments = (input.commentarySegments ?? []).filter((segment) => segment.text.trim());
  if (visibleSegments.length > 0) {
    for (const [index, segment] of visibleSegments.entries()) {
      timeline.push({
        type: 'commentary',
        id: segment.id,
        text: segment.text,
        startedAt: segment.startedAt,
        completedAt: segment.completedAt,
        afterSequence: segment.afterSequence,
        sortKey:
          segment.afterSequence !== undefined
            ? segment.afterSequence + 0.5
            : timestampSortKey(segment.startedAt, index - visibleSegments.length),
        originalIndex: steps.length + index,
      });
    }
  } else {
    const aggregateText = input.commentaryText?.trim();
    if (aggregateText) {
      timeline.push({
        type: 'commentary',
        id: 'commentary-aggregate',
        text: aggregateText,
        sortKey: Number.NEGATIVE_INFINITY,
        originalIndex: steps.length,
      });
    }
  }

  const aggregateItems = timeline.filter(
    (item) =>
      item.type === 'commentary' &&
      item.afterSequence === undefined &&
      item.startedAt === undefined,
  );
  const orderedItems = timeline.filter((item) => !aggregateItems.includes(item));
  const canUseBoundaryOrder =
    orderedItems.length > 0 && orderedItems.every((item) => boundarySortKey(item) !== undefined);
  const canUseClockOrder =
    orderedItems.length > 0 && orderedItems.every((item) => itemTimestamp(item) !== undefined);

  orderedItems.sort((left, right) => {
    if (canUseBoundaryOrder) {
      return (
        boundarySortKey(left)! - boundarySortKey(right)! ||
        timestampSortKey(left.startedAt, left.originalIndex) -
          timestampSortKey(right.startedAt, right.originalIndex) ||
        left.originalIndex - right.originalIndex
      );
    }
    if (canUseClockOrder) {
      return (
        itemTimestamp(left)! - itemTimestamp(right)! ||
        (boundarySortKey(left) ?? left.originalIndex) -
          (boundarySortKey(right) ?? right.originalIndex) ||
        left.originalIndex - right.originalIndex
      );
    }
    return left.originalIndex - right.originalIndex;
  });

  // Aggregate commentary from messages written before timeline segmentation has
  // no clock or execution boundary, so retain the historical "commentary first"
  // placement without contaminating the numeric sequence/time sort domains.
  return groupAdjacentTools([...aggregateItems, ...orderedItems]);
}

function CommentaryTimelineContent({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="shell-execution-timeline__commentary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text.trim()}</ReactMarkdown>
      {streaming ? <span className="shell-execution-timeline__caret" aria-hidden /> : null}
    </div>
  );
}

function ExecutionToolsGroup({
  steps,
  onOpenChange,
}: {
  steps: readonly ExecutionProcessStep[];
  onOpenChange?: (path: string) => void;
}) {
  const batchActive = steps.some((step) => step.status === 'running');
  const { open, toggle } = useAutoDisclosure({
    autoOpen: batchActive,
    resetKey: steps[0]?.id,
  });

  return (
    <div className="shell-execution-tools" data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="shell-execution-tools__toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>调用了 {steps.length} 个工具</span>
        <ChevronDown
          size={14}
          className={`shell-execution-tools__chevron ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-execution-tools__body">
          {steps.map((step) => (
            <div key={step.id} className="shell-execution-tools__step">
              <ExecutionProcessStepCard
                step={step}
                autoOpen={batchActive}
                onOpenChange={onOpenChange}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExecutionTimeline({
  commentarySegments,
  commentaryText,
  processView,
  streaming = false,
  onOpenChange,
}: {
  commentarySegments?: readonly CommentaryTimelineSegment[];
  commentaryText?: string;
  processView?: RunProcessView;
  streaming?: boolean;
  onOpenChange?: (path: string) => void;
}) {
  const timeline = useMemo(
    () =>
      buildExecutionTimeline({
        commentarySegments,
        commentaryText,
        steps: processView?.steps,
      }),
    [commentarySegments, commentaryText, processView?.steps],
  );
  const lastCommentaryId = [...timeline].reverse().find((item) => item.type === 'commentary')?.id;

  if (timeline.length === 0) return null;

  return (
    <div className="shell-execution-timeline" data-testid="execution-timeline">
      {timeline.map((item) => {
        return (
          <div
            key={`${item.type}:${item.id}`}
            className={`shell-execution-timeline__item is-${item.type}`}
            data-testid={
              item.type === 'commentary' ? 'execution-commentary-item' : 'execution-tools-item'
            }
          >
            <div className="shell-execution-timeline__rail" aria-hidden="true">
              <span className="shell-execution-timeline__node" />
            </div>
            <div className="shell-execution-timeline__content">
              {item.type === 'commentary' ? (
                <CommentaryTimelineContent
                  text={item.text}
                  streaming={streaming && item.id === lastCommentaryId && !item.completedAt}
                />
              ) : (
                <ExecutionToolsGroup steps={item.steps} onOpenChange={onOpenChange} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
