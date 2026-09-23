import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarDays, Globe, ChevronLeft, ChevronRight, List, RefreshCw } from 'lucide-react';
import type { ScheduledTask, ScheduledTaskHistoryEntry } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { TaskScopePicker } from './TaskScopePicker.js';
import {
  addCalendarDays,
  calendarDateKey,
  calendarDays,
  calendarOccurrences,
  positionCalendarEvents,
  type CalendarOccurrence,
  type CalendarView,
} from './scheduled-calendar.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const VIEW_LABELS = { day: '日', week: '周', month: '月', list: '列表' } as const;
const TARGET_LABELS = { agent: '智能体任务', model: '模型任务', team: '小队任务' } as const;
const RESULT_LABELS = {
  success: '已完成',
  failed: '执行失败',
  skipped: '已跳过',
  cancelled: '已取消',
} as const;
const timeLabel = (at: number) =>
  new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

function occurrenceLabel(event: CalendarOccurrence) {
  if (event.kind === 'history') return RESULT_LABELS[event.status!];
  if (event.kind === 'window') return '随机时间窗';
  if (event.kind === 'paused') return '已停用';
  if (event.kind === 'overdue') return '待处理';
  return '计划';
}

function EventButton({
  event,
  onPick,
  style,
  compact = false,
}: {
  event: CalendarOccurrence;
  onPick(task: ScheduledTask): void;
  style?: CSSProperties;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`task-cal__event${compact ? ' is-compact' : ''}`}
      data-target={event.task.target.kind}
      data-kind={event.kind}
      data-status={event.status}
      style={style}
      aria-label={`${calendarDateKey(new Date(event.start))} ${timeLabel(event.start)} ${event.task.name} ${occurrenceLabel(event)}`}
      title={`${event.task.name}\n${timeLabel(event.start)}${event.end ? `–${timeLabel(event.end)}` : ''} · ${occurrenceLabel(event)}\n任务时区：${event.task.timeZone}`}
      onClick={() => onPick(event.task)}
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
      <span>
        {timeLabel(event.start)}
        {event.kind === 'window' && event.end ? `–${timeLabel(event.end)}` : ''} ·{' '}
        {occurrenceLabel(event)}
      </span>
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
  listContent: ReactNode;
  loading: boolean;
  now: number;
  onPick(task: ScheduledTask): void;
  onCreate(date: Date): void;
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
  listContent,
  loading,
  now,
  onPick,
  onCreate,
  onRefresh,
}: TaskCalendarProps) {
  const [view, setView] = useState<CalendarView>('week');
  const [selected, setSelected] = useState(() => new Date(now));
  const [miniMonth, setMiniMonth] = useState(() => new Date(now));
  const [history, setHistory] = useState<ScheduledTaskHistoryEntry[]>([]);
  const [historyNotice, setHistoryNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(selected, view), [selected, view]);
  const miniDays = useMemo(() => calendarDays(miniMonth, 'month'), [miniMonth]);
  const rangeStart = days[0]!.getTime(),
    rangeEnd = addCalendarDays(days[days.length - 1]!, 1).getTime();
  const today = calendarDateKey(new Date(now));
  const selectedKey = calendarDateKey(selected);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let cancelled = false;
    const api = window.syncThink?.runtime;
    if (view === 'list' || rangeStart > now || !api?.scheduledTaskHistory) return;
    const candidates = tasks.filter((task) => task.lastRunAt || task.lastResult);
    let index = 0;
    const entries: ScheduledTaskHistoryEntry[] = [];
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
          failed = true;
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker)).then(() => {
      if (cancelled) return;
      setHistory(entries);
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
    // `tasks` refreshes on runtime updates; the clock alone must not reload every history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, rangeStart, view]);

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
  const represented = new Set(projection.events.map((event) => event.task.id));
  const otherTasks = tasks.filter((task) => !represented.has(task.id));

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: view === 'week' || view === 'day' ? 7 * 60 : 0 });
  }, [view]);

  const selectDate = (date: Date) => {
    setSelected(date);
    setMiniMonth(date);
  };
  const move = (amount: number) => {
    const next =
      view === 'month'
        ? new Date(selected.getFullYear(), selected.getMonth() + amount, 1)
        : addCalendarDays(selected, amount * (view === 'week' ? 7 : 1));
    selectDate(next);
  };
  const heading =
    view === 'month'
      ? `${selected.getFullYear()} 年 ${selected.getMonth() + 1} 月`
      : view === 'day'
        ? `${selected.getFullYear()} 年 ${selected.getMonth() + 1} 月 ${selected.getDate()} 日`
        : `${days[0]!.getFullYear()} 年 ${days[0]!.getMonth() + 1} 月 ${days[0]!.getDate()} 日 — ${days.at(-1)!.getMonth() + 1} 月 ${days.at(-1)!.getDate()} 日`;

  return (
    <div className="task-cal" data-testid="task-calendar">
      <aside className="task-cal__sidebar" data-testid="task-sidebar">
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
        <div className="task-cal__filter-label">归属</div>
        <TaskScopePicker
          layout="sidebar"
          value={scopes[0] ?? 'all'}
          onChange={(value) => onScopesChange([value])}
          selectedScopes={scopes}
          onSelectedScopesChange={onScopesChange}
          workspaces={workspaces}
          tasks={allTasks}
        />
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
          <div className="task-cal__filter-label">状态</div>
          {statusFilters}
        </div>
        <div className="task-cal__zone">
          <Globe size={14} />
          <span>
            {timezone}
            <small>日历按本地时区展示</small>
          </span>
        </div>
      </aside>
      <main className="task-cal__main">
        <div className="task-cal__toolbar">
          <button
            type="button"
            className="task-cal__today"
            onClick={() => selectDate(new Date(now))}
          >
            今天
          </button>
          <button type="button" aria-label="上一时段" onClick={() => move(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="下一时段" onClick={() => move(1)}>
            <ChevronRight size={16} />
          </button>
          <strong className="task-cal__range" aria-live="polite">
            {view === 'list' ? '所有定时任务' : heading}
          </strong>
          <button type="button" aria-label="刷新任务" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={14} />
          </button>
          <div className="task-cal__views" aria-label="日历视图">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {key === 'list' ? <List size={13} /> : null}
                {VIEW_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        {view === 'list' ? (
          <div className="task-cal__list-view">{listContent}</div>
        ) : (
          <>
            {loading ? (
              <div className="task-cal__notice" role="status">
                正在加载任务…
              </div>
            ) : null}
            {!loading && tasks.length === 0 ? (
              <div className="task-cal__notice" data-testid="task-empty">
                没有符合条件的任务，可调整筛选或新建任务。
              </div>
            ) : null}
            {historyNotice || projection.truncated || projection.errors.length ? (
              <div className="task-cal__notice" role="status">
                {historyNotice}{' '}
                {projection.truncated ? '任务较密集，部分计划已省略；切换日视图查看。' : ''}{' '}
                {projection.errors.length
                  ? `部分规则未能展开：${projection.errors.join('、')}`
                  : ''}
              </div>
            ) : null}
            <div ref={scrollRef} className="task-cal__scroll">
              {view === 'month' ? (
                <div className="task-cal__month">
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
                          <button
                            type="button"
                            className="task-cal__month-add"
                            aria-label={`在 ${key} 新建任务`}
                            onClick={() => {
                              const at = new Date(day);
                              at.setHours(9);
                              onCreate(at);
                            }}
                          >
                            +
                          </button>
                        </div>
                        {events.slice(0, 3).map((item) => (
                          <EventButton
                            key={item.event.id}
                            event={item.event}
                            compact
                            onPick={onPick}
                          />
                        ))}
                        {events.length > 3 ? (
                          <button
                            type="button"
                            className="task-cal__more"
                            onClick={() => {
                              selectDate(day);
                              setView('day');
                            }}
                          >
                            另有 {events.length - 3} 项
                          </button>
                        ) : null}
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
                                at.setHours(hour);
                                onCreate(at);
                              }}
                            />
                          ))}
                          {(dayEvents.get(key) ?? []).map((item) => (
                            <EventButton
                              key={item.event.id}
                              event={item.event}
                              onPick={onPick}
                              style={{
                                top: item.top,
                                height: item.height,
                                left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`,
                                width: `calc(${100 / item.lanes}% - 4px)`,
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
                {otherTasks.map((task) => (
                  <button type="button" key={task.id} onClick={() => onPick(task)}>
                    {task.name}
                    {!task.enabled ? ' · 已停用' : ''}
                  </button>
                ))}
              </div>
            ) : null}
            <footer className="task-cal__footer">
              <span>
                <CalendarDays size={13} /> 点击空白时间新建
              </span>
              <span>未来卡片表示启动时间，斜纹表示随机时间窗</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
