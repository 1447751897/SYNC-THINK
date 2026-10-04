import { WorkbenchPageHeader } from './WorkbenchPageHeader.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Webhook,
  Plus,
  Timer,
  MessageSquare,
  Workflow,
  Search,
  Inbox,
  ArrowLeft,
  ArrowUpRight,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Send,
} from 'lucide-react';
import {
  looksLikeOpaqueId,
  type CollaborationActivitySummary,
  type CollaborationAttemptStatus,
  type Event,
  type RunIndexEntry,
  type RunIndexSource,
  type RunIndexState,
} from '@sync-think/shared';
import type { ActivityExternalEventSummary } from '@sync-think/protocol';
import { resolveKernelDisplayName } from './brand-icons.js';
import { toastApi } from './Toast.js';
import { PROJECTLESS_SCOPE } from './projectless-scope.js';

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
  chat: '普通对话',
  scheduled: '定时任务',
  external: '外部触发',
  orchestration: '小队编排',
};

const EXTERNAL_STATE_LABELS: Record<string, string> = {
  pending: '待处理',
  leased: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const COLLABORATION_STATE_LABELS: Record<CollaborationAttemptStatus, string> = {
  queued: '排队中',
  running: '执行中',
  waiting_input: '等待输入',
  stopping: '停止中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
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

const SOURCE_ICONS = {
  chat: MessageSquare,
  scheduled: Timer,
  external: Webhook,
  orchestration: Workflow,
};
function SourceBadge({ source }: { source: RunIndexSource }) {
  const Icon = SOURCE_ICONS[source];
  return (
    <span className="inbox-source" data-source={source}>
      <Icon size={12} />
      {SOURCE_LABELS[source]}
    </span>
  );
}

export interface ActivityCenterPageProps {
  onNewConversation?(): void;
  workspaces?: readonly { workspaceId: string; name: string }[];
  conversations?: readonly { id: string; workspaceId?: string }[];
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
  const workspaceLabel = (entry: RunIndexEntry) => {
    const conversation = props.conversations?.find((item) => item.id === entry.conversationId);
    const id = conversation ? conversation.workspaceId : entry.workspaceId;
    const workspace = props.workspaces?.find((item) => item.workspaceId === id);
    return !id || id === PROJECTLESS_SCOPE || workspace?.name === '__inbox__'
      ? '不绑定工作区'
      : (workspace?.name ?? '工作区对话');
  };
  const [entries, setEntries] = useState<RunIndexEntry[] | null>(null);
  const [counts, setCounts] = useState<Record<RunIndexState, number> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [stateFilter, setStateFilter] = useState<RunIndexState | null>(null);
  const [sourceFilter, setSourceFilter] = useState<RunIndexSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [externalEvents, setExternalEvents] = useState<ActivityExternalEventSummary[] | null>(null);
  const [collaborationActivities, setCollaborationActivities] = useState<
    CollaborationActivitySummary[]
  >([]);
  const [query, setQuery] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const refreshRequestRef = useRef(0);
  const reportNotice = useCallback((text: string | null) => {
    if (!text) return;
    toastApi.toast({ type: 'error', title: text, id: 'activity-notice' });
  }, []);

  const filterPayload = useMemo(
    () => ({
      limit: PAGE_LIMIT,
      ...(stateFilter
        ? { states: [stateFilter] }
        : attentionOnly
          ? { states: ['failed' as const, 'paused' as const] }
          : {}),
      ...(sourceFilter ? { sources: [sourceFilter] } : {}),
    }),
    [stateFilter, sourceFilter, attentionOnly],
  );

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    const api = bridge();
    if (!api?.activityListRuns) {
      if (requestId === refreshRequestRef.current) setError('Runtime 未连接');
      return;
    }
    setLoading(true);
    setLoadingMore(false);
    try {
      const [res, collaboration, external] = await Promise.all([
        api.activityListRuns(filterPayload),
        api.collaboration?.({ action: 'activity' }).catch(() => ({ activities: [] })),
        api.activityListExternalEvents?.({ limit: 20 }).catch(() => ({ entries: [] })),
      ]);
      if (requestId !== refreshRequestRef.current) return;
      setEntries(res.entries);
      setCounts(res.counts);
      setNextCursor(res.nextCursor);
      setCollaborationActivities(collaboration?.activities ?? []);
      setExternalEvents(external?.entries ?? []);
      setError(null);
    } catch (cause) {
      if (requestId !== refreshRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId === refreshRequestRef.current) setLoading(false);
    }
  }, [filterPayload]);

  const loadMore = useCallback(async () => {
    const api = bridge();
    if (!api?.activityListRuns || !nextCursor) return;
    const requestId = refreshRequestRef.current;
    setLoadingMore(true);
    try {
      const res = await api.activityListRuns({ ...filterPayload, cursor: nextCursor });
      if (requestId !== refreshRequestRef.current) return;
      // Appended rather than replaced: the cursor walks strictly older rows, so
      // concatenating cannot duplicate a row already on screen.
      setEntries((prev) => [...(prev ?? []), ...res.entries]);
      setNextCursor(res.nextCursor);
    } catch (cause) {
      if (requestId !== refreshRequestRef.current) return;
      reportNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId === refreshRequestRef.current) setLoadingMore(false);
    }
  }, [filterPayload, nextCursor, reportNotice]);

  useEffect(
    () => () => {
      refreshRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      if (!RUN_LIFECYCLE_TYPES.has(event.type) && event.type !== 'collaboration.updated') continue;
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

  type Message = {
    id: string;
    title: string;
    actor: string;
    source: RunIndexSource;
    state: RunIndexState;
    status: string;
    date: string;
    meta: string[];
    error?: string;
    summary: string;
    conversationId?: string;
    run?: RunIndexEntry;
    kind: 'run' | 'collaboration' | 'external';
  };
  const messages: Message[] = [
    ...(entries ?? []).map((entry): Message => ({
      id: 'run:' + entry.runId,
      kind: 'run',
      title: activityRunTitle(entry),
      actor: entry.kernelId
        ? resolveKernelDisplayName(entry.kernelId)
        : SOURCE_LABELS[entry.source],
      source: entry.source,
      state: entry.state,
      status: STATE_LABELS[entry.state],
      date: entry.startedAt,
      conversationId: entry.conversationId,
      run: entry,
      error: entry.errorMessage,
      meta: [
        workspaceLabel(entry),
        '耗时 ' + formatDuration(entry),
        activityModelLabel(entry),
      ].filter((v): v is string => Boolean(v)),
      summary:
        entry.state === 'completed'
          ? '执行已完成，完整结果与附件保留在原对话中。'
          : entry.state === 'running'
            ? '任务正在执行，运行状态会自动更新。'
            : entry.state === 'failed'
              ? '执行遇到问题。查看下方原因，或将原指令带回对话重新编辑。'
              : entry.state === 'paused'
                ? '执行已暂停，打开原对话查看待处理事项。'
                : '这次执行已取消。',
    })),
    ...collaborationActivities.map((activity): Message => ({
      id: 'collaboration:' + activity.conversationId + ':' + activity.taskId,
      kind: 'collaboration',
      title: activity.taskTitle,
      actor: activity.assigneeName,
      source: 'orchestration',
      state:
        activity.status === 'succeeded'
          ? 'completed'
          : activity.status === 'cancelled'
            ? 'cancelled'
            : activity.status === 'failed' || activity.status === 'interrupted'
              ? 'failed'
              : activity.status === 'waiting_input'
                ? 'paused'
                : 'running',
      status: COLLABORATION_STATE_LABELS[activity.status],
      date: activity.updatedAt,
      conversationId: activity.conversationId,
      meta: [
        activity.conversationTitle,
        ...(activity.planRef ? ['计划 v' + activity.planRef.revision] : []),
      ],
      error: activity.errorMessage,
      summary:
        activity.status === 'waiting_input'
          ? '小队正在等待输入，打开协作对话继续处理。'
          : activity.status === 'succeeded'
            ? '协作任务已完成，打开协作对话查看成员交付的结果。'
            : '在协作对话中查看成员进展、任务结果和上下文。',
    })),
    ...(externalEvents ?? []).map((event): Message => ({
      id: 'external:' + event.id,
      kind: 'external',
      title: event.title ?? event.sourceName ?? '系统触发事件',
      actor: event.sourceName ?? '系统事件',
      source: 'external',
      state:
        event.state === 'pending' ? 'paused' : event.state === 'leased' ? 'running' : event.state,
      status: EXTERNAL_STATE_LABELS[event.state] ?? event.state,
      date: event.createdAt,
      meta: ['尝试 ' + event.attemptCount + ' 次'],
      error: event.state === 'failed' ? event.resultReason : undefined,
      summary: event.resultReason ?? '由外部事件触发的任务，执行状态与处理结果会显示在这里。',
    })),
  ];
  const needle = query.trim().toLocaleLowerCase();
  const shownMessages = messages
    .filter(
      (message) =>
        (!stateFilter || message.state === stateFilter) &&
        (!sourceFilter || message.source === sourceFilter) &&
        (!attentionOnly || message.state === 'failed' || message.state === 'paused') &&
        (!needle ||
          [message.title, message.actor, message.status, message.error, ...message.meta]
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle)),
    )
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const selected = shownMessages.find((message) => message.id === selectedId);
  const attentionCount =
    (counts?.failed ?? 0) +
    (counts?.paused ?? 0) +
    messages.filter((m) => m.kind !== 'run' && (m.state === 'failed' || m.state === 'paused'))
      .length;
  const allCount = totalCount + messages.filter((m) => m.kind !== 'run').length;
  const completedCount =
    (counts?.completed ?? 0) +
    messages.filter((m) => m.kind !== 'run' && m.state === 'completed').length;
  const selectMessage = (message: Message) => {
    setSelectedId(message.id);
    setFeedback('');
  };
  const openMessage = (message: Message) => {
    if (message.conversationId) onOpenConversation?.(message.conversationId);
  };
  const renderMessage = (message: Message) => {
    const Icon = SOURCE_ICONS[message.source];
    return (
      <article
        key={message.id}
        className="inbox-message-row"
        data-state={message.state}
        data-selected={selected?.id === message.id || undefined}
        data-testid={
          message.kind === 'run'
            ? 'activity-run-row'
            : message.kind === 'collaboration'
              ? 'activity-collaboration-tasks'
              : 'activity-external-events'
        }
      >
        <button
          type="button"
          className="inbox-message"
          aria-pressed={selected?.id === message.id}
          aria-label={'查看消息：' + message.title}
          onClick={() => selectMessage(message)}
        >
          <span className="inbox-message__avatar" data-source={message.source}>
            <Icon size={20} />
          </span>
          <span className="inbox-message__body">
            <span className="inbox-message__eyebrow">
              <span>{message.actor}</span>
              <time dateTime={message.date}>{formatLocal(message.date)}</time>
            </span>
            <strong className="inbox-message__title">{message.title}</strong>
            <span className="inbox-message__meta">
              {message.meta.map((meta, index) => (
                <span key={index}>{meta}</span>
              ))}
            </span>
            {message.error ? (
              <span className="inbox-message__error" title={message.error}>
                {message.error}
              </span>
            ) : null}
            <span className="inbox-message__foot">
              <SourceBadge source={message.source} />
              <span className={'activity-badge is-' + message.state}>{message.status}</span>
            </span>
          </span>
        </button>
        <div className="inbox-message__actions">
          {message.conversationId && onOpenConversation ? (
            <button
              type="button"
              className="inbox-text-action"
              onClick={() => openMessage(message)}
            >
              {message.kind === 'collaboration' ? '打开协作' : '打开对话'}
              <ArrowUpRight size={12} />
            </button>
          ) : null}
          {message.run && message.state === 'failed' && onRetryRun ? (
            <button
              type="button"
              className="inbox-text-action"
              data-testid="activity-retry"
              disabled={retryingId === message.run.runId}
              title="将原指令带回对话输入框；不会自动发送或更换模型"
              onClick={() => void retry(message.run!)}
            >
              <RotateCcw size={12} />
              重新编辑
            </button>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <div
      className="task-panel activity-panel inbox-workbench"
      data-workbench-page="inbox"
      data-testid="activity-panel"
    >
      <WorkbenchPageHeader
        heading={
          <>
            <h1>收件箱</h1>
            <p>统一查看对话、定时任务和外部触发的执行结果</p>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="workbench-page__secondary"
              data-testid="activity-refresh"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'shell-process-spin' : undefined} />
              刷新
            </button>
            {props.onNewConversation ? (
              <button
                type="button"
                className="task-panel__new"
                onClick={props.onNewConversation}
                data-testid="inbox-new-conversation"
              >
                <Plus size={14} />
                不绑定工作区的对话
              </button>
            ) : null}
          </>
        }
      />
      <div className="inbox-workbench__frame" data-detail-open={Boolean(selected)}>
        <aside className="inbox-workbench__list-pane" aria-label="收件箱消息">
          <div className="inbox-workbench__controls">
            <div className="inbox-workbench__summary">
              <strong>消息</strong>
              <span>{attentionCount} 条需关注</span>
            </div>
            <label className="inbox-search">
              <Search size={15} />
              <input
                aria-label="搜索消息或任务"
                placeholder="搜索已加载的消息或任务"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                  ×
                </button>
              ) : null}
            </label>
            <div className="inbox-tabs" role="group" aria-label="消息分类">
              <button
                type="button"
                aria-pressed={attentionOnly}
                onClick={() => {
                  setStateFilter(null);
                  setAttentionOnly(true);
                }}
              >
                需关注 <span>{attentionCount}</span>
              </button>
              <button
                type="button"
                aria-pressed={!attentionOnly && stateFilter === null}
                data-testid="activity-filter-all"
                onClick={() => {
                  setStateFilter(null);
                  setSourceFilter(null);
                  setAttentionOnly(false);
                }}
              >
                全部 <span>{allCount}</span>
              </button>
              <button
                type="button"
                aria-pressed={!attentionOnly && stateFilter === 'completed'}
                onClick={() => {
                  setStateFilter('completed');
                  setAttentionOnly(false);
                }}
              >
                已完成 <span>{completedCount}</span>
              </button>
            </div>
            <details className="inbox-filters">
              <summary>
                <SlidersHorizontal size={14} />
                {stateFilter
                  ? STATE_LABELS[stateFilter]
                  : attentionOnly
                    ? '需关注'
                    : '全部状态'} · {sourceFilter ? SOURCE_LABELS[sourceFilter] : '全部来源'}
              </summary>
              <div className="inbox-filters__body">
                <span>状态</span>
                {STATE_ORDER.map((state) => (
                  <button
                    key={state}
                    type="button"
                    aria-pressed={stateFilter === state}
                    data-testid={'activity-filter-' + state}
                    onClick={() => {
                      setStateFilter((previous) => (previous === state ? null : state));
                      setAttentionOnly(false);
                    }}
                  >
                    {STATE_LABELS[state]} <small>{counts?.[state] ?? 0}</small>
                  </button>
                ))}
                <span>来源</span>
                {(Object.keys(SOURCE_LABELS) as RunIndexSource[]).map((source) => (
                  <button
                    key={source}
                    type="button"
                    aria-pressed={sourceFilter === source}
                    data-testid={'activity-source-' + source}
                    onClick={() =>
                      setSourceFilter((previous) => (previous === source ? null : source))
                    }
                  >
                    {SOURCE_LABELS[source]}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <div
            className="inbox-workbench__messages"
            data-testid="activity-run-list"
            aria-busy={loading}
          >
            {error ? (
              <div className="inbox-list-empty" role="alert">
                <AlertCircle size={24} />
                <p>{error}</p>
                <button type="button" className="inbox-text-action" onClick={() => void refresh()}>
                  重新加载
                </button>
              </div>
            ) : !entries ? (
              <div className="inbox-list-empty">
                <LoaderCircle size={22} className="shell-process-spin" />
                <p>加载中…</p>
              </div>
            ) : shownMessages.length === 0 ? (
              <div className="inbox-list-empty">
                <Inbox size={26} />
                <strong>{query ? '没有找到匹配的消息' : '没有符合条件的记录'}</strong>
                <p>
                  {query
                    ? '尝试其他关键词，或继续加载历史消息。'
                    : '新任务的执行结果会显示在这里。'}
                </p>
              </div>
            ) : (
              shownMessages.map(renderMessage)
            )}
            {nextCursor ? (
              <button
                type="button"
                className="activity-panel__more"
                data-testid="activity-load-more"
                disabled={loadingMore || loading}
                onClick={() => void loadMore()}
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </div>
          <div className="inbox-workbench__list-footer">
            已加载 {messages.length} 条消息{nextCursor ? ' · 更多历史可继续加载' : ''}
          </div>
        </aside>
        <section
          className="inbox-workbench__detail"
          aria-label="消息详情"
          data-testid="inbox-message-detail"
        >
          {selected ? (
            <>
              <header className="inbox-detail__header">
                <button
                  type="button"
                  className="inbox-detail__back"
                  aria-label="返回消息列表"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="inbox-detail__identity">
                  <span className="inbox-message__avatar">
                    <SourceIcon source={selected.source} />
                  </span>
                  <div>
                    <strong>{selected.actor}</strong>
                    <span>{selected.meta[0]}</span>
                  </div>
                </div>
                {selected.conversationId && onOpenConversation ? (
                  <button
                    type="button"
                    className="workbench-page__secondary"
                    onClick={() => openMessage(selected)}
                  >
                    查看对话
                    <ArrowUpRight size={14} />
                  </button>
                ) : null}
              </header>
              <div className="inbox-detail__content" key={selected.id}>
                <div className="inbox-detail__title">
                  <h2>{selected.title}</h2>
                  <span className={'activity-badge is-' + selected.state}>{selected.status}</span>
                </div>
                <time className="inbox-detail__time" dateTime={selected.date}>
                  {formatLocal(selected.date)}
                </time>
                <p className="inbox-detail__summary">{selected.summary}</p>
                {selected.error ? (
                  <section className="inbox-detail__notice" data-state="failed">
                    <AlertCircle size={18} />
                    <div>
                      <strong>执行异常</strong>
                      <p>
                        {selected.run?.failureClass ? '[' + selected.run.failureClass + '] ' : ''}
                        {selected.error}
                      </p>
                    </div>
                  </section>
                ) : null}
                {(selected.state === 'paused' || selected.state === 'failed') &&
                selected.conversationId ? (
                  <section className="inbox-detail__attention">
                    <span>需要关注</span>
                    <h3>
                      {selected.state === 'failed'
                        ? '查看原因，继续推进任务'
                        : '回到对话，处理待办事项'}
                    </h3>
                    <p>在原对话中保留任务上下文，确认后再继续执行。</p>
                    <div>
                      {onOpenConversation ? (
                        <button
                          type="button"
                          className="task-panel__new"
                          onClick={() => openMessage(selected)}
                        >
                          前往处理
                          <ArrowUpRight size={14} />
                        </button>
                      ) : null}
                      {selected.run?.state === 'failed' && onRetryRun ? (
                        <button
                          type="button"
                          className="workbench-page__secondary"
                          disabled={retryingId === selected.run.runId}
                          onClick={() => void retry(selected.run!)}
                        >
                          <RotateCcw size={14} />
                          重新编辑原指令
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {selected.state === 'completed' ? (
                  <section className="inbox-detail__notice">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>已完成执行</strong>
                      <p>打开原对话查看完整输出、文件和后续操作。</p>
                    </div>
                  </section>
                ) : null}
                <section className="inbox-detail__execution">
                  <h3>执行信息</h3>
                  <dl>
                    <div>
                      <dt>来源</dt>
                      <dd>
                        <SourceBadge source={selected.source} />
                      </dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{selected.status}</dd>
                    </div>
                    <div>
                      <dt>时间</dt>
                      <dd>{formatLocal(selected.date)}</dd>
                    </div>
                    {selected.meta.map((meta, index) => (
                      <div key={index}>
                        <dt>
                          {index === 0 ? (selected.kind === 'run' ? '工作区' : '上下文') : '执行'}
                        </dt>
                        <dd>{meta}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              {selected.conversationId && onRetryRun && onOpenConversation ? (
                <form
                  className="inbox-detail__composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = feedback.trim();
                    if (!text || !selected.conversationId) return;
                    onRetryRun({ conversationId: selected.conversationId, text });
                    onOpenConversation(selected.conversationId);
                    setFeedback('');
                  }}
                >
                  <label htmlFor="inbox-feedback">补充反馈</label>
                  <div>
                    <textarea
                      id="inbox-feedback"
                      placeholder="补充说明，带回原对话继续处理…"
                      rows={2}
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                    />
                    <button
                      type="submit"
                      className="task-panel__new"
                      disabled={!feedback.trim()}
                      aria-label="将反馈带回对话"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <small>带回对话输入框，由你确认后发送。</small>
                </form>
              ) : null}
            </>
          ) : (
            <div className="inbox-detail__empty">
              <span>
                <Inbox size={30} />
              </span>
              <h2>选择一条消息</h2>
              <p>
                在这里查看执行详情、处理异常，
                <br />
                或回到原对话继续协作。
              </p>
              <div>
                <span>
                  <AlertCircle size={13} />
                  {attentionCount} 条需关注
                </span>
                <span>
                  <CheckCircle2 size={13} />
                  {completedCount} 条已完成
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SourceIcon({ source }: { source: RunIndexSource }): JSX.Element {
  const Icon = SOURCE_ICONS[source];
  return <Icon size={20} />;
}
