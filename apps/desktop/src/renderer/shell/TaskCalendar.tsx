import { WorkbenchPageHeader } from './WorkbenchPageHeader.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CalendarDays,
  Clock3,
  Pencil,
  Play,
  History,
  X,
  Globe,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import type { ScheduledTask, ScheduledTaskHistoryEntry } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { CalendarPopover } from './TaskCalendarPopover.js';
import { TaskCalendarDatePicker } from './TaskCalendarDatePicker.js';
import { TaskScopePicker } from './TaskScopePicker.js';
import {
  addCalendarDays,
  calendarDateKey,
  calendarDays,
  calendarOccurrences,
  calendarScrollMinute,
  positionCalendarEvents,
  type CalendarOccurrence,
  type CalendarView,
} from './scheduled-calendar.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const VIEW_LABELS = { day: '日', week: '周', month: '月', list: '列表' } as const;
const TARGET_LABELS = { agent: '智能体任务', model: '模型任务', team: '小队任务' } as const;
const EVENT_PALETTES = ['lime', 'pink', 'purple', 'blue', 'emerald'] as const;
/** Stable by identity: renaming, filtering or moving to another view never changes a task's color. */
export function calendarTaskPalette(taskId: string) {
  let hash = 0;
  for (const letter of taskId) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  return EVENT_PALETTES[hash % EVENT_PALETTES.length]!;
}
const RESULT_LABELS = {
  success: '已完成',
  failed: '执行失败',
  skipped: '已跳过',
  cancelled: '已取消',
  waiting_input: '等待操作',
  blocked: '配置阻塞',
  reconciling: '交付待核对',
} as const;
const timeLabel = (at: number) =>
  new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

function occurrenceLabel(event: CalendarOccurrence) {
  if (event.kind === 'history') return RESULT_LABELS[event.status!];
  if (event.kind === 'window') return '随机时间窗';
  if (event.kind === 'paused') return '已停用';
  if (event.kind === 'overdue') return '待处理';
  if (event.kind === 'unrecorded') return '无执行记录';
  return '计划';
}

function EventButton({
  event,
  onOpen,
  active,
  style,
  compact = false,
}: {
  event: CalendarOccurrence;
  onOpen(event: CalendarOccurrence, anchor: HTMLButtonElement): void;
  active?: boolean;
  style?: CSSProperties;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`task-cal__event${compact ? ' is-compact' : ''}`}
      data-target={event.task.target.kind}
      data-palette={calendarTaskPalette(event.task.id)}
      aria-haspopup="dialog"
      aria-expanded={Boolean(active)}
      data-kind={event.kind}
      data-status={event.status}
      style={style}
      aria-label={`${calendarDateKey(new Date(event.start))} ${timeLabel(event.start)} ${event.task.name} ${occurrenceLabel(event)}`}
      title={`${event.task.name}\n${timeLabel(event.start)}${event.end ? `–${timeLabel(event.end)}` : ''} · ${occurrenceLabel(event)}\n任务时区：${event.task.timeZone}`}
      onClick={(click) => onOpen(event, click.currentTarget)}
    >
      <strong>
        {event.kind === 'history'
          ? event.status === 'success'
            ? '✓ '
            : event.status === 'failed'
              ? '! '
              : ''
          : ''}
        {event.task.name}
      </strong>
      {compact ? (
        <time dateTime={new Date(event.start).toISOString()}>{timeLabel(event.start)}</time>
      ) : (
        <span>
          {timeLabel(event.start)}
          {event.kind === 'window' && event.end ? `–${timeLabel(event.end)}` : ''} ·{' '}
          {occurrenceLabel(event)}
        </span>
      )}
    </button>
  );
}

export interface TaskCalendarProps {
  tasks: readonly ScheduledTask[];
  allTasks: readonly ScheduledTask[];
  workspaces: readonly WorkspaceSummary[];
  scopes: readonly string[];
  onScopesChange(values: string[]): void;
  targets: ReadonlySet<ScheduledTask['target']['kind']>;
  onTargetToggle(kind: ScheduledTask['target']['kind']): void;
  statusFilters: ReactNode;
  activeFilterCount: number;
  onResetFilters(): void;
  listContent: ReactNode;
  loading: boolean;
  loadError?: string | null;
  now: number;
  onPick(task: ScheduledTask): void;
  onEdit(task: ScheduledTask): void;
  onHistory(task: ScheduledTask): void;
  onRun(task: ScheduledTask): void;
  busyTaskId?: string | null;
  taskContext(task: ScheduledTask): { target: ReactNode; rule: string; workspace: string };
  onCreate(date: Date): void;
  onCreateTask(): void;
  onRefresh(): void;
}

export function TaskCalendar({
  tasks,
  allTasks,
  workspaces,
  scopes,
  onScopesChange,
  targets,
  onTargetToggle,
  statusFilters,
  activeFilterCount,
  onResetFilters,
  listContent,
  loading,
  loadError,
  now,
  onPick,
  onEdit,
  onHistory,
  onRun,
  busyTaskId,
  taskContext,
  onCreate,
  onCreateTask,
  onRefresh,
}: TaskCalendarProps) {
  const [view, setView] = useState<CalendarView>('month');
  const [selected, setSelected] = useState(() => new Date(now));
  const [miniMonth, setMiniMonth] = useState(() => new Date(now));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [floating, setFloating] = useState<
    | { kind: 'date'; anchor: HTMLButtonElement }
    | { kind: 'event'; anchor: HTMLButtonElement; event: CalendarOccurrence }
    | null
  >(null);
  const closePopover = () => setFloating(null);
  const openEvent = (event: CalendarOccurrence, anchor: HTMLButtonElement) =>
    setFloating((current) =>
      current?.kind === 'event' && current.anchor === anchor
        ? null
        : { kind: 'event', anchor, event },
    );
  const [historySnapshot, setHistorySnapshot] = useState<{ scope: string; entries: ScheduledTaskHistoryEntry[] }>({ scope: '', entries: [] });
  const [historyNotice, setHistoryNotice] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = useRef('');
  const days = useMemo(() => calendarDays(selected, view), [selected, view]);
  const miniDays = useMemo(() => calendarDays(miniMonth, 'month'), [miniMonth]);
  const rangeStart = days[0]!.getTime();
  const rangeEnd = addCalendarDays(days[days.length - 1]!, 1).getTime();
  // A task refresh is background revalidation, not a new calendar. Keep the
  // last good records in the same range; filters/date changes get a clean scope.
  const historyScope = JSON.stringify([view === 'list', rangeStart, rangeEnd, tasks.map(task => task.id).sort()]);
  const history = useMemo(
    () => historySnapshot.scope === historyScope ? historySnapshot.entries : [],
    [historySnapshot, historyScope],
  );
  const historyRef = useRef(historySnapshot);
  historyRef.current = historySnapshot;
  const today = calendarDateKey(new Date(now));
  const selectedKey = calendarDateKey(selected);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneOffset =
    new Intl.DateTimeFormat('zh-CN', { timeZoneName: 'shortOffset' })
      .formatToParts(new Date(now))
      .find((part) => part.type === 'timeZoneName')?.value ?? timezone;

  useEffect(() => {
    let cancelled = false;
    const api = window.syncThink?.runtime;
    if (historyRef.current.scope !== historyScope) setHistoryNotice('');
    setHistoryLoading(false);
    if (view === 'list' || rangeStart > now || !api?.scheduledTaskHistory) return;
    const candidates = tasks.filter((task) => task.lastRunAt || task.lastResult);
    if (!candidates.length) return;
    setHistoryLoading(true);
    let index = 0;
    const entries: ScheduledTaskHistoryEntry[] = [];
    const retained = historyRef.current.scope === historyScope ? historyRef.current.entries : [];
    let failed = false,
      limited = false;
    async function worker() {
      while (!cancelled && index < candidates.length) {
        const task = candidates[index++]!;
        try {
          const result = await api!.scheduledTaskHistory({ taskId: task.id, limit: 100 });
          entries.push(...result.entries);
          if (result.entries.length >= 100) limited = true;
        } catch {
          // A transient request failure must not erase confirmed past runs.
          entries.push(...retained.filter(entry => entry.taskId === task.id));
          failed = true;
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker)).then(() => {
      if (cancelled) return;
      setHistorySnapshot({ scope: historyScope, entries });
      setHistoryLoading(false);
      setHistoryNotice(
        failed
          ? '部分历史记录加载失败，可刷新重试'
          : limited
            ? '历史仅展示每个任务最近 100 次记录'
            : '',
      );
    });
    return () => {
      cancelled = true;
    };
    // A clock tick must not reload every task's history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, rangeStart, view, historyScope]);

  const projection = useMemo(
    () => calendarOccurrences(tasks, rangeStart, rangeEnd, now, history),
    [tasks, rangeStart, rangeEnd, now, history],
  );
  const dayEvents = useMemo(
    () =>
      new Map(
        days.map((day) => [calendarDateKey(day), positionCalendarEvents(projection.events, day)]),
      ),
    [days, projection.events],
  );
  const openedEvent =
    floating?.kind === 'event'
      ? projection.events.find((event) => event.id === floating.event.id)
      : undefined;
  // Task deletion, refreshes and filters must not leave a stale occurrence card behind.
  useEffect(() => {
    if (floating?.kind === 'event' && !openedEvent) setFloating(null);
  }, [floating, openedEvent]);
  const represented = new Set(projection.events.map((event) => event.task.id));
  const otherTasks = tasks.filter((task) => !represented.has(task.id));

  useEffect(() => {
    const key = `${view}:${rangeStart}:${rangeEnd}`;
    const element = scrollRef.current;
    if (!element || loading || scrollKey.current === key) return;
    element.scrollTop =
      view === 'week' || view === 'day'
        ? calendarScrollMinute(projection.events, rangeStart, rangeEnd, now)
        : 0;
    scrollKey.current = key;
    // The key prevents data refreshes and clock ticks from undoing manual scrolling.
  }, [view, rangeStart, rangeEnd, projection.events, loading, now]);

  const selectDate = (date: Date) => {
    closePopover();
    setSelected(date);
    setMiniMonth(date);
  };
  const move = (amount: number) =>
    selectDate(
      view === 'month'
        ? new Date(selected.getFullYear(), selected.getMonth() + amount, 1)
        : addCalendarDays(selected, amount * (view === 'week' ? 7 : 1)),
    );
  const heading =
    view === 'list'
      ? '任务列表'
      : view === 'month'
        ? `${selected.getFullYear()}年${selected.getMonth() + 1}月`
        : view === 'day'
          ? `${selected.getFullYear()}年${selected.getMonth() + 1}月${selected.getDate()}日`
          : `${days[0]!.getFullYear()}年${days[0]!.getMonth() + 1}月${days[0]!.getDate()}日 — ${days.at(-1)!.getFullYear() !== days[0]!.getFullYear() ? `${days.at(-1)!.getFullYear()}年` : ''}${days.at(-1)!.getMonth() + 1}月${days.at(-1)!.getDate()}日`;
  const context = openedEvent ? taskContext(openedEvent.task) : undefined;
  const openedHistory =
    openedEvent?.kind === 'history'
      ? history.find((entry) => entry.id === openedEvent.id)
      : undefined;
  const openedResult =
    openedHistory ??
    (openedEvent?.kind === 'history' && openedEvent.id === 'last-' + openedEvent.task.id
      ? openedEvent.task.lastResult
      : undefined);
  const actOnEvent = (action: (task: ScheduledTask) => void) => {
    if (!openedEvent) return;
    closePopover();
    action(openedEvent.task);
  };
  const empty = !loading && !loadError && !historyLoading;

  return (
    <div className="task-cal task-cal--board" data-testid="task-calendar" data-view={view}>
      <WorkbenchPageHeader
          className="task-cal__toolbar"
          heading={<>

        <div className="task-cal__heading">
          <h1 className="task-cal__range" aria-live="polite">
            {heading}
          </h1>
          <p>
            {loading
              ? '正在加载任务…'
              : loadError
                ? '任务加载失败，请重试'
                : `${tasks.length} 项任务 · ${tasks.filter((task) => task.enabled).length} 项启用`}
          </p>
        </div>

          </>}
          actions={<>
{view !== 'list' ? (
          <div className="task-cal__navigation" aria-label="日期翻页">
            <button type="button" aria-label="上一时段" onClick={() => move(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="task-cal__date-trigger"
              aria-label={`选择日期，当前 ${heading}`}
              aria-haspopup="dialog"
              aria-expanded={floating?.kind === 'date'}
              onClick={(event) => {
                const anchor = event.currentTarget;
                setFloating((current) =>
                  current?.kind === 'date' ? null : { kind: 'date', anchor },
                );
              }}
            >
              {heading}
            </button>
            <button type="button" aria-label="下一时段" onClick={() => move(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
        {view !== 'list' ? (
          <button
            type="button"
            className="task-cal__today"
            onClick={() => selectDate(new Date(now))}
          >
            今天
          </button>
        ) : null}
        <button
          type="button"
          className="task-cal__refresh"
          aria-label="刷新任务"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw size={16} className={loading ? 'shell-process-spin' : undefined} />
        </button>
        <button
          type="button"
          className="task-panel__new"
          data-testid="task-create"
          onClick={onCreateTask}
        >
          <Plus size={16} /> 新建任务
        </button>

          </>}
        />
      <div className="task-cal__controls">
        <TaskScopePicker
          layout="sidebar"
          value={scopes[0] ?? 'all'}
          onChange={(value) => onScopesChange([value])}
          selectedScopes={scopes}
          onSelectedScopesChange={onScopesChange}
          workspaces={workspaces}
          tasks={allTasks}
        />
        <button
          type="button"
          className="task-cal__filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="task-calendar-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={14} /> 筛选{' '}
          {activeFilterCount ? <small>{activeFilterCount}</small> : null}
        </button>
        <div className="task-cal__legend" aria-label="颜色用于区分任务，不代表执行状态">
          {EVENT_PALETTES.map((color) => (
            <i key={color} data-palette={color} aria-hidden="true" />
          ))}
          <span>颜色区分任务</span>
        </div>
        <div className="task-cal__views" role="group" aria-label="日历视图">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => {
                closePopover();
                setView(key);
              }}
            >
              {key === 'list' ? <List size={13} /> : null}
              {VIEW_LABELS[key]}
            </button>
          ))}
        </div>
      </div>
      <div className="task-cal__body" data-filters-open={filtersOpen}>
        {filtersOpen ? (
          <aside
            className="task-cal__sidebar"
            id="task-calendar-filters"
            data-testid="task-sidebar"
            aria-label="任务筛选"
          >
            <div className="task-cal__filter-head">
              <strong>任务筛选</strong>
              <button type="button" onClick={onResetFilters}>
                重置
              </button>
            </div>
            <div className="task-cal__mini-head">
              <strong>
                {miniMonth.getFullYear()}年{miniMonth.getMonth() + 1}月
              </strong>
              <div>
                <button
                  type="button"
                  aria-label="上个月"
                  onClick={() =>
                    setMiniMonth(new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1))
                  }
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  aria-label="下个月"
                  onClick={() =>
                    setMiniMonth(new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1))
                  }
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className="task-cal__mini" aria-label="日期导航">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
              {miniDays.map((day) => {
                const key = calendarDateKey(day);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={key === selectedKey}
                    data-today={key === today}
                    data-outside={day.getMonth() !== miniMonth.getMonth()}
                    onClick={() => selectDate(day)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="task-cal__filters">
              <div className="task-cal__filter-label">任务类型</div>
              {(['agent', 'model', 'team'] as const).map((kind) => (
                <label key={kind} className="task-cal__filter" data-target={kind}>
                  <input
                    type="checkbox"
                    checked={targets.has(kind)}
                    onChange={() => onTargetToggle(kind)}
                  />
                  <span>{TARGET_LABELS[kind]}</span>
                  <small>
                    {
                      allTasks.filter(
                        (task) =>
                          task.target.kind === kind &&
                          (scopes.includes('all') || scopes.includes(task.workspaceId ?? 'global')),
                      ).length
                    }
                  </small>
                </label>
              ))}
              <div className="task-cal__filter-label">执行状态</div>
              {statusFilters}
            </div>
            <div className="task-cal__zone">
              <Globe size={14} />
              <span title={timezone}>
                {timezoneOffset}
                <small>
                  按本机时区显示
                  <br />
                  {timezone}
                </small>
              </span>
            </div>
          </aside>
        ) : null}
        <section
          className="task-cal__main"
          aria-label={view === 'list' ? '定时任务列表' : '任务日历'}
        >
          {view === 'list' ? (
            <div className="task-cal__list-view">{listContent}</div>
          ) : (
            <>
              {loading || (historyLoading && historySnapshot.scope !== historyScope) ? (
                <div className="task-cal__notice task-cal__refresh-notice" role="status">
                  {loading ? '正在加载任务…' : '正在加载运行记录…'}
                </div>
              ) : null}
              {empty && tasks.length === 0 ? (
                <div className="task-cal__empty" data-testid="task-empty" role="status">
                  <CalendarDays size={20} />
                  <div>
                    <strong>{allTasks.length ? '没有符合筛选条件的任务' : '还没有定时任务'}</strong>
                    <span>
                      {allTasks.length
                        ? '调整归属、任务类型或执行状态，找回你的日程。'
                        : '让智能体按计划工作，从创建第一个任务开始。'}
                    </span>
                  </div>
                  <button type="button" onClick={allTasks.length ? onResetFilters : onCreateTask}>
                    {allTasks.length ? '清除筛选' : '创建第一个任务'}
                  </button>
                </div>
              ) : empty && !projection.events.length && !projection.errors.length ? (
                <div className="task-cal__notice task-cal__period-empty" role="status">
                  <span>这段时间没有日程，其他任务仍在列表中。</span>
                  <button type="button" onClick={() => setView('list')}>
                    查看任务列表
                  </button>
                </div>
              ) : null}
              {historyNotice || projection.truncated || projection.errors.length ? (
                <div className="task-cal__notice task-cal__data-notice" role="status">
                  {historyNotice}{' '}
                  {projection.truncated ? '任务较密集，部分计划已省略；切换日视图查看。' : ''}{' '}
                  {projection.errors.length
                    ? `部分规则未能展开：${projection.errors.join('、')}`
                    : ''}
                </div>
              ) : null}
              <div ref={scrollRef} className="task-cal__scroll" data-testid="task-calendar-scroll">
                {view === 'month' ? (
                  <div
                    className="task-cal__month"
                    style={{ '--calendar-weeks': days.length / 7 } as CSSProperties}
                  >
                    {WEEKDAYS.map((day) => (
                      <div className="task-cal__month-weekday" key={day}>
                        周{day}
                      </div>
                    ))}
                    {days.map((day) => {
                      const key = calendarDateKey(day),
                        events = dayEvents.get(key) ?? [];
                      return (
                        <div
                          key={key}
                          className="task-cal__month-cell"
                          data-date={key}
                          data-today={key === today}
                          data-outside={day.getMonth() !== selected.getMonth()}
                        >
                          <div className="task-cal__month-date">
                            <button
                              type="button"
                              aria-label={`查看 ${key}`}
                              data-today={key === today}
                              onClick={() => {
                                selectDate(day);
                                setView('day');
                              }}
                            >
                              {day.getDate()}
                            </button>
                            {events.length > 3 ? (
                              <button
                                type="button"
                                className="task-cal__more"
                                aria-label={`查看 ${key} 的全部 ${events.length} 项日程`}
                                onClick={() => {
                                  selectDate(day);
                                  setView('day');
                                }}
                              >
                                +{events.length - 3}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="task-cal__month-add"
                              aria-label={`在 ${key} 新建任务`}
                              onClick={() => {
                                const at = new Date(day);
                                at.setHours(9, 0, 0, 0);
                                onCreate(at);
                              }}
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                          <div className="task-cal__month-events">
                            {events.slice(0, 3).map((item) => (
                              <EventButton
                                key={item.event.id}
                                event={item.event}
                                compact
                                onOpen={openEvent}
                                active={
                                  floating?.kind === 'event' && floating.event.id === item.event.id
                                }
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className="task-cal__time-grid"
                    style={{ '--calendar-days': days.length } as CSSProperties}
                  >
                    <div className="task-cal__week-head">
                      <span className="task-cal__hour-caption">时间</span>
                      {days.map((day) => (
                        <div key={calendarDateKey(day)} data-today={calendarDateKey(day) === today}>
                          <small>周{WEEKDAYS[day.getDay()]}</small>
                          <strong>{day.getDate()}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="task-cal__time-body">
                      <div className="task-cal__hours">
                        {HOURS.map((hour) => (
                          <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
                        ))}
                      </div>
                      {days.map((day) => {
                        const key = calendarDateKey(day);
                        return (
                          <div key={key} className="task-cal__day" data-today={key === today}>
                            {HOURS.map((hour) => (
                              <button
                                key={hour}
                                type="button"
                                className="task-cal__slot"
                                aria-label={`在 ${key} ${String(hour).padStart(2, '0')}:00 新建任务`}
                                onClick={() => {
                                  const at = new Date(day);
                                  at.setHours(hour, 0, 0, 0);
                                  onCreate(at);
                                }}
                              />
                            ))}
                            {(dayEvents.get(key) ?? []).map((item) => (
                              <EventButton
                                key={item.event.id}
                                event={item.event}
                                onOpen={openEvent}
                                active={
                                  floating?.kind === 'event' && floating.event.id === item.event.id
                                }
                                style={{
                                  top: item.top,
                                  height: item.height,
                                  left: `calc(${(item.lane / item.lanes) * 100}% + 3px)`,
                                  width: `calc(${100 / item.lanes}% - 6px)`,
                                }}
                              />
                            ))}
                            {key === today ? (
                              <div
                                className="task-cal__now"
                                style={{
                                  top: new Date(now).getHours() * 60 + new Date(now).getMinutes(),
                                }}
                              >
                                <span />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {otherTasks.length ? (
                <div className="task-cal__outside">
                  <span>本时段无日程 · {otherTasks.length}</span>
                  {otherTasks.slice(0, 5).map((task) => (
                    <button type="button" key={task.id} onClick={() => onPick(task)}>
                      {task.name}
                      {!task.enabled ? ' · 已停用' : ''}
                    </button>
                  ))}
                  {otherTasks.length > 5 ? (
                    <button type="button" onClick={() => setView('list')}>
                      查看全部 {otherTasks.length} 项
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
      {floating?.kind === 'date' ? (
        <TaskCalendarDatePicker
          anchor={floating.anchor}
          selected={selected}
          now={now}
          onSelect={selectDate}
          onClose={closePopover}
        />
      ) : floating?.kind === 'event' && openedEvent && context ? (
        <CalendarPopover
          key={openedEvent.id}
          anchor={floating.anchor}
          title="日程详情"
          side="right"
          onClose={closePopover}
        >
          <div
            className="task-cal__event-details"
            data-palette={calendarTaskPalette(openedEvent.task.id)}
          >
            <header className="task-cal__detail-head">
              <div>
                <span
                  className="task-cal__detail-status"
                  data-kind={openedEvent.kind}
                  data-status={openedEvent.status}
                >
                  {occurrenceLabel(openedEvent)}
                </span>
                <h2>{openedEvent.task.name}</h2>
                <p>
                  {new Date(openedEvent.start).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short',
                  })}
                </p>
              </div>
              <button type="button" aria-label="关闭日程详情" onClick={closePopover}>
                <X size={15} />
              </button>
            </header>
            <div className="task-cal__detail-time">
              <Clock3 size={16} />
              <strong>
                {timeLabel(openedEvent.start)}
                {openedEvent.end ? ` – ${timeLabel(openedEvent.end)}` : ''}
              </strong>
              <span>{openedEvent.kind === 'window' ? '时间窗' : '本地时间'}</span>
            </div>
            {openedEvent.kind === 'unrecorded' ? (
              <p className="task-cal__detail-notice">
                此时间点按当前规则推算，未查询到对应运行记录；这不是已完成或已跳过的记录。若任务曾修改规则或运行记录加载不完整，请以运行记录为准。
              </p>
            ) : null}
            <dl className="task-cal__detail-facts">
              <div>
                <dt>执行者</dt>
                <dd>{context.target}</dd>
              </div>
              <div>
                <dt>执行计划</dt>
                <dd>{context.rule}</dd>
              </div>
              <div>
                <dt>任务时区</dt>
                <dd>
                  <Globe size={13} />
                  {openedEvent.task.timeZone}
                </dd>
              </div>
              <div>
                <dt>任务归属</dt>
                <dd>{context.workspace}</dd>
              </div>
            </dl>
            {openedResult ? (
              <section className="task-cal__detail-instruction" aria-label="执行结果">
                <h3>执行结果</h3>
                {openedHistory?.summary ? <p>{openedHistory?.summary}</p> : null}
                {openedResult.reason && openedResult.reason !== openedHistory?.summary ? (
                  <p>{openedResult.reason}</p>
                ) : null}
              </section>
            ) : null}
            <section className="task-cal__detail-instruction">
              <h3>执行内容</h3>
              <p>{openedEvent.task.instruction}</p>
            </section>
            <div className="task-cal__detail-links">
              <button type="button" onClick={() => actOnEvent(onHistory)}>
                <History size={14} />
                运行记录
              </button>
              <button type="button" onClick={() => actOnEvent(onPick)}>
                完整详情
                <ChevronRight size={13} />
              </button>
            </div>
            <footer>
              <button type="button" onClick={() => actOnEvent(onEdit)}>
                <Pencil size={14} />
                编辑任务
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busyTaskId === openedEvent.task.id}
                onClick={() => actOnEvent(onRun)}
              >
                <Play size={14} />
                立即执行
              </button>
            </footer>
          </div>
        </CalendarPopover>
      ) : null}
      <footer className="task-cal__footer">
        <span title={timezone}>
          <Globe size={13} />
          {timezoneOffset} · 本机时区
        </span>
        <span>
          {view === 'month'
            ? '日期旁的 + 新建任务 · 点击标签查看详情'
            : view === 'list'
              ? '管理任务与运行记录'
              : '点击空白时间新建任务'}
          <span className="task-cal__footer-note">
            {' '}
            · 虚线为无执行记录，斜纹为随机时间窗，✓ 为已完成
          </span>
        </span>
      </footer>
    </div>
  );
}
