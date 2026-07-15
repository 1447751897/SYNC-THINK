import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Radar } from 'lucide-react';

// TraceList — right rail event list. Items look like developing events (§6.2),
// not log snippets. Each item carries a category tag coloring as accent only.
// Soft observability strip (§15.2 / §6.2) summarizes categories + last event.

export type TraceCategory =
  | 'run'
  | 'model-call'
  | 'credential-choice'
  | 'tool-action'
  | 'approval'
  | 'artifact'
  | 'review'
  | 'context-transfer'
  | 'recovery';

export interface TraceItem {
  id: string;
  category: TraceCategory;
  summary: string;
  /** Optional timestamp string formatted by caller. */
  time?: string;
  /** Full audit evidence shown only for the selected event. */
  details?: readonly { label: string; value: string }[];
}

export type TraceReadinessLevel = 'empty' | 'live' | 'streaming' | 'partial';

export interface TraceReadiness {
  level: TraceReadinessLevel;
  badge: string;
  total: number;
  categoryCount: number;
  modelCallCount: number;
  recoveryCount: number;
  toolCount: number;
  approvalCount: number;
  artifactCount: number;
  lastSummary: string | null;
  lastCategory: TraceCategory | null;
  lastTime: string | null;
  hasEvents: boolean;
  hasModelCall: boolean;
  hasRecovery: boolean;
  hasTool: boolean;
  note: string;
}

export interface TraceListProps {
  items: TraceItem[];
  /** Compact mode for narrow rail. */
  compact?: boolean;
  emptyState?: ReactNode;
  /** Currently selected item id (e.g. Manifest inspect). */
  selectedId?: string | null;
  onSelectItem?: (id: string) => void;
  /** Soft observability: whether a task is open (affects empty copy). */
  hasActiveTask?: boolean;
  /** Soft observability: stream in progress. */
  streaming?: boolean;
  /** Hide the readiness strip (tests / dense embeds). */
  hideReadiness?: boolean;
}

const TRACE_CATEGORY_LABEL: Record<TraceCategory, string> = {
  run: 'Run',
  'model-call': '模型调用',
  'credential-choice': '凭证选择',
  'tool-action': '工具动作',
  approval: '审批',
  artifact: '产物',
  review: '评审',
  'context-transfer': '上下文传递',
  recovery: '恢复',
};

function categoryLabel(category: TraceCategory): string {
  return TRACE_CATEGORY_LABEL[category] ?? category;
}

/** Pure projector for tests + UI — §6.2 run-trace observability. */
export function projectTraceReadiness(
  items: TraceItem[],
  options?: { hasActiveTask?: boolean; streaming?: boolean },
): TraceReadiness {
  const total = items.length;
  const counts: Partial<Record<TraceCategory, number>> = {};
  for (const it of items) {
    counts[it.category] = (counts[it.category] ?? 0) + 1;
  }
  const modelCallCount = counts['model-call'] ?? 0;
  const recoveryCount = counts.recovery ?? 0;
  const toolCount = counts['tool-action'] ?? 0;
  const approvalCount = counts.approval ?? 0;
  const artifactCount = counts.artifact ?? 0;
  const categoryCount = Object.keys(counts).length;
  const last = total > 0 ? items[total - 1] : null;
  const streaming = Boolean(options?.streaming);
  const hasActiveTask = options?.hasActiveTask;
  const hasEvents = total > 0;
  const hasModelCall = modelCallCount > 0;
  const hasRecovery = recoveryCount > 0;
  const hasTool = toolCount > 0;

  let level: TraceReadinessLevel = 'empty';
  if (streaming) level = 'streaming';
  else if (hasEvents && (hasModelCall || hasTool || approvalCount > 0 || artifactCount > 0)) level = 'live';
  else if (hasEvents) level = 'partial';
  else level = 'empty';

  const badge =
    level === 'streaming'
      ? '流式中'
      : level === 'live'
        ? '有轨迹'
        : level === 'partial'
          ? '部分事件'
          : hasActiveTask === false
            ? '等待任务'
            : '静默';

  const notes: string[] = [];
  if (streaming) notes.push('流式写入中 · 折叠轨迹不暂停 Run');
  else if (!hasEvents) {
    if (hasActiveTask === false) notes.push('打开任务后，发送消息会出现模型调用与恢复事件');
    else notes.push('发送消息后这里会出现模型调用、凭证选择与恢复事件');
  } else if (!hasModelCall) notes.push('已有事件 · 尚未见模型调用（可能是恢复/审批）');
  else notes.push('点击条目可对齐 Manifest 检查 · 折叠不暂停 Run');

  return {
    level,
    badge,
    total,
    categoryCount,
    modelCallCount,
    recoveryCount,
    toolCount,
    approvalCount,
    artifactCount,
    lastSummary: last?.summary ?? null,
    lastCategory: last?.category ?? null,
    lastTime: last?.time ?? null,
    hasEvents,
    hasModelCall,
    hasRecovery,
    hasTool,
    note: notes.join(' · '),
  };
}

export function TraceList(props: TraceListProps) {
  const pageSize = 50;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = props.selectedId === undefined ? internalSelectedId : props.selectedId;
  const firstItemId = props.items[0]?.id;
  useEffect(() => {
    setVisibleCount(pageSize);
    setInternalSelectedId(null);
  }, [firstItemId]);
  const readiness = useMemo(
    () =>
      projectTraceReadiness(props.items, {
        hasActiveTask: props.hasActiveTask,
        streaming: props.streaming,
      }),
    [props.items, props.hasActiveTask, props.streaming],
  );

  const selectItem = (id: string) => {
    if (props.selectedId === undefined) {
      setInternalSelectedId((current) => (current === id ? null : id));
    }
    props.onSelectItem?.(id);
  };

  const onKeyDown = (id: string, event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectItem(id);
    }
  };

  const visibleItems = props.items.slice(-visibleCount);
  const hiddenCount = Math.max(0, props.items.length - visibleItems.length);

  return (
    <div
      className="st-trace-list-wrap"
      data-testid="trace-list-wrap"
      data-level={readiness.level}
      data-count={String(readiness.total)}
    >
      {props.hideReadiness ? null : (
        <div
          className="st-trace__readiness"
          data-testid="trace-readiness"
          data-level={readiness.level}
          aria-label="运行轨迹就绪"
        >
          <div className="st-trace__readiness-head">
            <Radar size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>运行轨迹</span>
            <small>§6.2 · 可折叠</small>
            <strong data-testid="trace-readiness-badge">{readiness.badge}</strong>
          </div>
          <ul className="st-trace__readiness-list">
            <li data-ok={readiness.hasEvents ? '1' : '0'} data-testid="trace-check-events">
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              事件 {readiness.total}
              {readiness.hasEvents ? ` · ${readiness.categoryCount} 类` : ' · 尚无'}
            </li>
            <li data-ok={readiness.hasModelCall ? '1' : '0'} data-testid="trace-check-model">
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              模型调用 {readiness.modelCallCount}
              {readiness.hasModelCall ? ' · 有' : ' · 无'}
            </li>
            <li data-ok={readiness.hasRecovery ? '1' : '0'} data-testid="trace-check-recovery">
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              恢复 {readiness.recoveryCount}
              {readiness.hasRecovery ? ' · 有' : ' · 无'}
            </li>
            <li data-ok={readiness.hasTool || readiness.approvalCount > 0 ? '1' : '0'} data-testid="trace-check-action">
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              工具/审批 {readiness.toolCount + readiness.approvalCount}
            </li>
            <li
              data-ok={readiness.lastSummary ? '1' : '0'}
              data-testid="trace-check-last"
              className="st-trace__readiness-last"
            >
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              最近{' '}
              {readiness.lastSummary
                ? `${readiness.lastCategory ? categoryLabel(readiness.lastCategory) + ' · ' : ''}${
                    readiness.lastSummary.length > 28
                      ? readiness.lastSummary.slice(0, 28) + '…'
                      : readiness.lastSummary
                  }`
                : '—'}
            </li>
            <li
              data-ok={
                props.streaming
                  ? '1'
                  : props.hasActiveTask === undefined
                    ? readiness.hasEvents
                      ? '1'
                      : '0'
                    : props.hasActiveTask
                      ? '1'
                      : '0'
              }
              data-testid="trace-check-live"
            >
              <span className="st-trace__readiness-dot" aria-hidden="true" />
              {props.streaming
                ? '流式写入'
                : props.hasActiveTask === false
                  ? '任务未打开'
                  : props.hasActiveTask
                    ? '任务已打开'
                    : readiness.hasEvents
                      ? '有写入'
                      : '等待写入'}
            </li>
          </ul>
          <p className="st-trace__readiness-note" data-testid="trace-readiness-note">
            {readiness.note}
          </p>
        </div>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          className="st-trace-list__load-more"
          onClick={() => setVisibleCount((count) => Math.min(props.items.length, count + pageSize))}
          aria-label={`加载更早轨迹（还有 ${hiddenCount} 条）`}
        >
          加载更早轨迹 · {hiddenCount}
        </button>
      ) : null}
      <ol className="st-trace-list" data-compact={props.compact ? '1' : '0'} aria-label="运行轨迹事件">
        {props.items.length === 0 ? (
          <li className="st-trace-list__empty" data-testid="trace-empty">
            {props.emptyState ??
              (props.hasActiveTask === false
                ? '尚无轨迹 · 先打开任务再发送消息'
                : props.streaming
                  ? '轨迹写入中…'
                  : '尚无轨迹 · 发送消息后这里会出现模型调用与恢复事件')}
          </li>
        ) : (
          visibleItems.map((it) => {
            const selected = selectedId === it.id;
            return (
              <li
                key={it.id}
                data-testid={`trace-item-${it.id}`}
                className="st-trace-list__item"
                data-category={it.category}
                data-selected={selected ? '1' : '0'}
                onClick={() => selectItem(it.id)}
                onKeyDown={(event) => onKeyDown(it.id, event)}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
              >
                <span
                  className="st-trace-list__category"
                  data-category={it.category}
                  data-testid={`trace-category-${it.id}`}
                  title={it.category}
                >
                  {categoryLabel(it.category)}
                </span>
                <span className="st-trace-list__summary">{it.summary}</span>
                {it.time && <time className="st-trace-list__time">{it.time}</time>}
                {selected && it.details && it.details.length > 0 ? (
                  <dl
                    className="st-trace-list__details"
                    data-testid={`trace-details-${it.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {it.details.map((detail, index) => (
                      <div key={`${detail.label}-${index}`}>
                        <dt>{detail.label}</dt>
                        <dd>{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
