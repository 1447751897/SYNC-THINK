import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, RotateCcw, Webhook } from 'lucide-react';
import {
  looksLikeOpaqueId,
  type Event,
  type RunIndexEntry,
  type RunIndexSource,
  type RunIndexState,
} from '@sync-think/shared';
import type { ActivityExternalEventSummary } from '@sync-think/protocol';
import { resolveKernelDisplayName } from './brand-icons.js';
import { toastApi } from './Toast.js';

const PAGE_LIMIT = 25;

/**
 * Only these types advance a run's lifecycle. Filtering by `category === 'run'`
 * is not enough: that category also carries `plan.approved` and `run.queued`,
 * which would trigger refreshes that change nothing in the list.
 */
const RUN_LIFECYCLE_TYPES = new Set([
  'run.started',
  'run.recovered',
  'run.retrying',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

const STATE_LABELS: Record<RunIndexState, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  paused: '已暂停',
};

const SOURCE_LABELS: Record<RunIndexSource, string> = {
  chat: '对话',
  scheduled: '定时任务',
  external: '系统触发',
  orchestration: '编排',
};

const EXTERNAL_STATE_LABELS: Record<string, string> = {
  pending: '待处理',
  leased: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATE_ORDER: readonly RunIndexState[] = [
  'running',
  'failed',
  'completed',
  'cancelled',
  'paused',
];

function bridge() {
  return window.syncThink?.runtime;
}

function formatLocal(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function activityRunTitle(entry: RunIndexEntry): string {
  const title = entry.title?.trim();
  if (title && !looksLikeOpaqueId(title)) return title;
  return SOURCE_LABELS[entry.source];
}

function activityModelLabel(entry: RunIndexEntry): string | undefined {
  for (const candidate of [entry.providerModelId, entry.modelId]) {
    const text = candidate?.trim();
    if (text && !looksLikeOpaqueId(text)) return text;
  }
  return undefined;
}

function formatDuration(entry: RunIndexEntry): string {
  if (!entry.finishedAt) return '—';
  const started = new Date(entry.startedAt).getTime();
  const finished = new Date(entry.finishedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '—';
  const seconds = Math.round((finished - started) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export interface ActivityCenterPageProps {
  onOpenConversation?(conversationId: string): void;
  /**
   * Hands the resolved prompt back to the host, which seeds it into the target
   * conversation's composer.
   *
   * This page deliberately does not send anything itself. A turn is not just
   * `appendMessage`: it also needs `expectedTaskVersion`, the resolved model /
   * kernel / reasoning overrides and the auto-compact check that ChatView owns.
   * Re-sending from here would fork all of that.
   */
  onRetryRun?(anchor: { conversationId: string; text: string }): void;
  /** Global event stream; used only as a signal that the list is stale. */
  eventHistory?: readonly Event[];
}

export function ActivityCenterPage(props: ActivityCenterPageProps): JSX.Element {
  const { onOpenConversation, onRetryRun } = props;
  const [entries, setEntries] = useState<RunIndexEntry[] | null>(null);
  const [counts, setCounts] = useState<Record<RunIndexState, number> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [stateFilter, setStateFilter] = useState<RunIndexState | null>(null);
  const [sourceFilter, setSourceFilter] = useState<RunIndexSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [externalEvents, setExternalEvents] = useState<ActivityExternalEventSummary[] | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const reportNotice = useCallback((text: string | null) => {
    if (!text) return;
    toastApi.toast({ type: 'error', title: text, id: 'activity-notice' });
  }, []);

  const filterPayload = useMemo(
    () => ({
      limit: PAGE_LIMIT,
      ...(stateFilter ? { states: [stateFilter] } : {}),
      ...(sourceFilter ? { sources: [sourceFilter] } : {}),
    }),
    [stateFilter, sourceFilter],
  );

  const refresh = useCallback(async () => {
    const api = bridge();
    if (!api?.activityListRuns) {
      setError('Runtime 未连接');
      return;
    }
    setLoading(true);
    try {
      const res = await api.activityListRuns(filterPayload);
      setEntries(res.entries);
      setCounts(res.counts);
      setNextCursor(res.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [filterPayload]);

  const loadMore = useCallback(async () => {
    const api = bridge();
    if (!api?.activityListRuns || !nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await api.activityListRuns({ ...filterPayload, cursor: nextCursor });
      // Appended rather than replaced: the cursor walks strictly older rows, so
      // concatenating cannot duplicate a row already on screen.
      setEntries((prev) => [...(prev ?? []), ...res.entries]);
      setNextCursor(res.nextCursor);
    } catch (cause) {
      reportNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [filterPayload, nextCursor, reportNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    if (!api?.activityListExternalEvents) return;
    void api
      .activityListExternalEvents({ limit: 20 })
      .then((res) => {
        if (!cancelled) setExternalEvents(res.entries);
      })
      .catch(() => {
        if (!cancelled) setExternalEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Event-driven refresh. `primedRef` skips the history already accumulated
  // before this page mounted — without it, every past run would fire a refresh
  // on the first render.
  const primedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const eventHistory = props.eventHistory;
  useEffect(() => {
    if (!eventHistory) return;
    let fresh = false;
    for (const event of eventHistory) {
      if (!RUN_LIFECYCLE_TYPES.has(event.type)) continue;
      if (seenRef.current.has(event.id)) continue;
      seenRef.current.add(event.id);
      if (primedRef.current) fresh = true;
    }
    primedRef.current = true;
    // The event payload carries no kernel/model/failure columns, so it can only
    // say "re-query"; the row itself always comes from the read model.
    if (fresh) void refresh();
  }, [eventHistory, refresh]);

  const retry = useCallback(
    async (entry: RunIndexEntry) => {
      const api = bridge();
      if (!api?.activityRetryAnchor) return;
      setRetryingId(entry.runId);
      try {
        const anchor = await api.activityRetryAnchor({ runId: entry.runId });
        // `retryable: false` is a normal answer (run still active, anchor
        // message gone), not a transport failure — it arrives as a payload.
        if (!anchor.retryable || !anchor.conversationId || !anchor.text) {
          reportNotice(anchor.reason ?? '该 Run 无法恢复原指令');
          return;
        }
        // Seeding the composer, not sending: the user confirms in the chat.
        onRetryRun?.({ conversationId: anchor.conversationId, text: anchor.text });
        onOpenConversation?.(anchor.conversationId);
      } catch (cause) {
        reportNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setRetryingId(null);
      }
    },
    [onOpenConversation, onRetryRun, reportNotice],
  );

  const totalCount = useMemo(
    () => (counts ? STATE_ORDER.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : 0),
    [counts],
  );

  return (
    // `task-panel` is kept on the root on purpose: the whole `--task-*` palette
    // is scoped to that class, and every `task-panel__*` element reused below
    // resolves its colours from it. Dropping it renders the page unstyled.
    <div className="task-panel activity-panel" data-testid="activity-panel">
      <header className="task-panel__head">
        <div>
          <h1 className="task-panel__title">后台活动</h1>
          <p className="task-panel__subtitle">
            查看后台 Run，以及 Webhook、Git 推送和文件监听等系统触发记录
          </p>
        </div>
        <button
          type="button"
          className="task-panel__new"
          data-testid="activity-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </header>

      <div className="task-panel__frame">
        <aside className="task-panel__side">
          <button
            type="button"
            className="task-panel__sb-item is-all"
            data-active={stateFilter === null && sourceFilter === null ? '1' : undefined}
            data-testid="activity-filter-all"
            onClick={() => {
              setStateFilter(null);
              setSourceFilter(null);
            }}
          >
            <span className="task-panel__sb-label">全部 Run</span>
            <span className="task-panel__sb-count">{totalCount}</span>
          </button>

          <div className="task-panel__sb-divider" />
          <div className="task-panel__sb-group">状态</div>
          {STATE_ORDER.map((state) => (
            <button
              key={state}
              type="button"
              className="task-panel__sb-item"
              data-active={stateFilter === state ? '1' : undefined}
              data-testid={`activity-filter-${state}`}
              onClick={() => setStateFilter((prev) => (prev === state ? null : state))}
            >
              <span className="task-panel__sb-label">{STATE_LABELS[state]}</span>
              <span className="task-panel__sb-count">{counts?.[state] ?? 0}</span>
            </button>
          ))}

          <div className="task-panel__sb-divider" />
          <div className="task-panel__sb-group">来源</div>
          {(Object.keys(SOURCE_LABELS) as RunIndexSource[]).map((source) => (
            <button
              key={source}
              type="button"
              className="task-panel__sb-item"
              data-active={sourceFilter === source ? '1' : undefined}
              data-testid={`activity-source-${source}`}
              onClick={() => setSourceFilter((prev) => (prev === source ? null : source))}
            >
              <span className="task-panel__sb-label">{SOURCE_LABELS[source]}</span>
            </button>
          ))}
        </aside>

        <section className="task-panel__main activity-panel__main">
          {error ? (
            <div className="task-panel__empty" role="alert">
              {error}
            </div>
          ) : !entries ? (
            <div className="task-panel__empty">
              <LoaderCircle size={16} className="shell-process-spin" />
              加载中…
            </div>
          ) : entries.length === 0 ? (
            <div className="task-panel__empty">没有符合条件的 Run</div>
          ) : (
            <>
              <div className="activity-panel__list" data-testid="activity-run-list">
                {entries.map((entry) => {
                  const modelLabel = activityModelLabel(entry);
                  return (
                  <article
                    key={entry.runId}
                    className="activity-row"
                    data-state={entry.state}
                    data-testid="activity-run-row"
                  >
                    <span className={`activity-badge is-${entry.state}`}>
                      {STATE_LABELS[entry.state]}
                    </span>
                    <div className="activity-row__body">
                      <div className="activity-row__title">
                        {activityRunTitle(entry)}
                        <span className="activity-row__source">{SOURCE_LABELS[entry.source]}</span>
                      </div>
                      <div className="activity-row__meta">
                        <span>{formatLocal(entry.startedAt)}</span>
                        <span>耗时 {formatDuration(entry)}</span>
                        {entry.kernelId ? (
                          <span>{resolveKernelDisplayName(entry.kernelId)}</span>
                        ) : null}
                        {modelLabel ? <span>{modelLabel}</span> : null}
                      </div>
                      {entry.errorMessage ? (
                        <div className="activity-row__error" title={entry.errorMessage}>
                          {entry.failureClass ? `[${entry.failureClass}] ` : ''}
                          {entry.errorMessage}
                        </div>
                      ) : null}
                    </div>
                    <div className="activity-row__actions">
                      {entry.conversationId && onOpenConversation ? (
                        <button
                          type="button"
                          className="task-hist__open-conv"
                          onClick={() => onOpenConversation(entry.conversationId!)}
                        >
                          打开对话
                        </button>
                      ) : null}
                      {entry.state === 'failed' || entry.state === 'cancelled' ? (
                        <button
                          type="button"
                          className="task-hist__open-conv"
                          data-testid="activity-retry"
                          disabled={retryingId === entry.runId}
                          title="将原指令带回对话输入框；不会自动发送或更换模型"
                          onClick={() => void retry(entry)}
                        >
                          <RotateCcw size={13} /> 重新编辑
                        </button>
                      ) : null}
                    </div>
                  </article>
                  );
                })}
              </div>
              {nextCursor ? (
                <button
                  type="button"
                  className="activity-panel__more"
                  data-testid="activity-load-more"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              ) : null}
            </>
          )}

          {externalEvents && externalEvents.length > 0 ? (
            <section className="activity-panel__events" data-testid="activity-external-events">
              <h2 className="activity-panel__events-title">
                <Webhook size={14} /> 系统触发事件
              </h2>
              {externalEvents.map((event) => (
                <div key={event.id} className="activity-row" data-state={event.state}>
                  <span className={`activity-badge is-${event.state}`}>
                    {EXTERNAL_STATE_LABELS[event.state] ?? event.state}
                  </span>
                  <div className="activity-row__body">
                    <div className="activity-row__title">
                      {event.title ?? event.dedupeKey}
                      <span className="activity-row__source">
                        {event.sourceName ?? event.sourceKind}
                      </span>
                    </div>
                    <div className="activity-row__meta">
                      <span>{formatLocal(event.createdAt)}</span>
                      <span>尝试 {event.attemptCount} 次</span>
                      {event.resultReason ? <span>{event.resultReason}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
