/** Scheduled tasks: calendar projections, workspace filters, editor and execution history. */
import './TaskExperience.css';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bot,
  Check,
  Cpu,
  ChevronDown,
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  GlobalAgent,
  Team,
  ScheduledTask,
  ScheduledTaskHistoryEntry,
  ScheduledTaskTarget,
  TaskRule,
} from '@sync-think/shared';
import type { WorkspaceSummary, SkillVersionSummary } from '@sync-think/protocol';
import type { ModelOption } from './NewConversationDialog.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { isTaskTime, TaskTemporalPicker, TaskTimeField } from './TaskTemporalPicker.js';
import { TaskSheet, useTaskSheetPortalContainer } from './TaskSheet.js';
import { TaskCalendar } from './TaskCalendar.js';
import { TaskScopePicker } from './TaskScopePicker.js';
import { TaskConversationPicker } from './TaskConversationPicker.js';
import { WeeklyRuleEditor } from './WeeklyRuleEditor.js';
import { dateString, parseWeeklyRule, weeklyRuleSummary } from '@sync-think/shared/task-schedule';
import type { TaskRuleWeekly } from '@sync-think/shared';
import { localDateTimeInput } from './scheduled-calendar.js';
import { AutomationCenter, AutomationHandoffs, type AutomationFilter } from './AutomationCenter.js';
import {
  AutomationBindings,
  automationFormError,
  automationIssues,
  useAutomationResources,
  type AutomationResources,
  type AutomationBinding,
} from './AutomationBindings.js';

function bridge() {
  return window.syncThink?.runtime;
}

/** 设计稿 v8 时区列表：常用 7 个 + 全部 25 个（含搜索过滤）。 */
const TIME_ZONE_COMMON = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

const TIME_ZONES = [
  ...TIME_ZONE_COMMON,
  'Asia/Taipei',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

const RUN_RESULT_LABELS = {
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
  waiting_input: '等待操作',
  blocked: '配置阻塞',
  reconciling: '交付待核对',
} as const;
const HISTORY_LIMIT = 20;
type StatusKey = 'enabled' | 'disabled' | 'last-fail';

function formatLocal(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ruleSummary(rule: TaskRule): string {
  switch (rule.kind) {
    case 'at':
      return `单次 · ${formatLocal(rule.runAt)}`;
    case 'every': {
      const window =
        rule.windowStart && rule.windowEnd ? ` · 每天 ${rule.windowStart}–${rule.windowEnd}` : '';
      return `每 ${rule.intervalMinutes} 分钟${window}`;
    }
    case 'random':
      return `随机 ${rule.minTimes}-${rule.maxTimes} 次/天 · ${rule.windowStart}-${rule.windowEnd}`;
    case 'weekly':
      return `${weeklyRuleSummary(rule)} · ${rule.startDate} 起`;
    case 'cron':
      return `cron ${rule.expression}`;
    default:
      return '';
  }
}

export interface TaskPanelProps {
  /** Optional showcase variant; scheduled tasks always enter the existing calendar by default. */
  initialView?: 'calendar' | 'center';
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  teams: readonly Team[];
  workspaces: readonly WorkspaceSummary[];
  skills: readonly SkillVersionSummary[];
  onOpenConversation?(conversationId: string): void;
  onNotify?(tone: 'info' | 'error', text: string): void;
}

export function TaskPanel({
  initialView = 'calendar',
  agents,
  models,
  teams,
  workspaces,
  skills,
  onOpenConversation,
  onNotify,
}: TaskPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [view, setView] = useState<'center' | 'calendar'>(initialView);
  const [automationFilter, setAutomationFilter] = useState<AutomationFilter>('all');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const { resources, reload: reloadResources } = useAutomationResources();
  const refreshSequence = useRef({ value: 0 });
  const executorReady = (task: ScheduledTask): boolean => {
    const target = task.target;
    return target.kind === 'model'
      ? models.some((model) => model.modelId === target.modelId)
      : target.kind === 'agent'
        ? agents.some(
            (agent) => agent.id === target.agentId && !agent.archived && agent.enabled !== false,
          )
        : teams.some((team) => team.id === target.teamId && team.members.length > 0);
  };
  const workspaceReady = (task: ScheduledTask) =>
    !task.workspaceId || workspaces.some((workspace) => workspace.workspaceId === task.workspaceId);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [scopes, setScopes] = useState<string[]>(['all']);
  const [statusSel, setStatusSel] = useState<Set<StatusKey>>(new Set());
  const [targets, setTargets] = useState<Set<ScheduledTask['target']['kind']>>(
    new Set(['agent', 'model', 'team']),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createAt, setCreateAt] = useState<Date | undefined>();
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async (showLoading = false) => {
    const sequence = ++refreshSequence.current.value;
    if (showLoading) setLoading(true);
    const api = bridge();
    if (!api?.listScheduledTasks) {
      setLoading(false);
      setLoadError('任务服务尚未连接');
      return;
    }
    try {
      const res = await api.listScheduledTasks({ includeDisabled: true });
      if (sequence !== refreshSequence.current.value) return;
      setTasks(res.tasks);
      setLoadError(null);
    } catch (error) {
      if (sequence !== refreshSequence.current.value) return;
      setLoadError(error instanceof Error ? error.message : String(error));
      onNotify?.(
        'error',
        `加载任务失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (sequence === refreshSequence.current.value) setLoading(false);
    }
  };

  useEffect(() => {
    const requests = refreshSequence.current;
    void refresh();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      requests.value++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = async (task: ScheduledTask) => {
    const api = bridge();
    if (busyId) return;
    if (!api?.updateScheduledTask) {
      setActionError('任务更新服务待连接');
      return;
    }
    if (!task.enabled) {
      const issues = automationIssues(task.automation, resources, task.workspaceId);
      if (!executorReady(task)) issues.push('执行者待配置');
      if (!workspaceReady(task)) issues.push('工作区待配置');
      if (
        resources.loading &&
        (task.automation?.browser ||
          task.automation?.requiredMcpServerIds?.length ||
          task.automation?.delivery)
      )
        issues.push('能力配置加载中');
      if (issues.length) {
        setActionError(issues.join('；'));
        return;
      }
    }
    setActionError(null);
    setBusyId(task.id);
    try {
      await api.updateScheduledTask({ taskId: task.id, patch: { enabled: !task.enabled } });
      await refresh();
    } catch (error) {
      setActionError(`切换失败: ${error instanceof Error ? error.message : String(error)}`);
      onNotify?.('error', `切换失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const triggerNow = async (task: ScheduledTask) => {
    const api = bridge();
    if (busyId) return;
    if (!api?.triggerScheduledTask) {
      setActionError('任务触发服务待连接');
      return;
    }
    setActionError(null);
    setBusyId(task.id);
    try {
      const res = await api.triggerScheduledTask({ taskId: task.id });
      if (!res.fired) {
        setActionError(`未触发：${res.reason ?? '未知原因'}`);
        onNotify?.('error', `未触发：${res.reason ?? '未知原因'}`);
      } else {
        onNotify?.('info', `已触发「${task.name}」`);
      }
      setHistoryRevision((value) => value + 1);
      await refresh();
    } catch (error) {
      setActionError(`触发失败: ${error instanceof Error ? error.message : String(error)}`);
      onNotify?.('error', `触发失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeTask = async (task: ScheduledTask) => {
    const api = bridge();
    if (busyId) return;
    if (!api?.deleteScheduledTask) {
      setActionError('任务删除服务待连接');
      return;
    }
    setActionError(null);
    setBusyId(task.id);
    try {
      await api.deleteScheduledTask({ taskId: task.id });
      setDeleting(null);
      setSelectedTaskId(null);
      setHistoryTask(null);
      await refresh();
    } catch (error) {
      setActionError(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
      onNotify?.('error', `删除失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const workspaceName = useCallback(
    (workspaceId?: string): string => {
      if (!workspaceId) return '全局任务';
      const ws = workspaces.find((w) => w.workspaceId === workspaceId);
      return ws?.name ?? '未知工作区';
    },
    [workspaces],
  );

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '')),
    [tasks],
  );

  const counts = useMemo(() => {
    const scoped = tasks.filter(
      (task) =>
        (scopes.includes('all') || scopes.includes(task.workspaceId ?? 'global')) &&
        targets.has(task.target.kind),
    );
    const enabled = scoped.filter((task) => task.enabled).length;
    return {
      enabled,
      disabled: scoped.length - enabled,
      lastFail: scoped.filter((task) => task.lastResult?.status === 'failed').length,
    };
  }, [tasks, scopes, targets]);

  const shown = useMemo(
    () =>
      sorted.filter((task) => {
        const scopeOk = scopes.includes('all') || scopes.includes(task.workspaceId ?? 'global');
        const statusOk =
          statusSel.size === 0 ||
          (statusSel.has('enabled') && task.enabled) ||
          (statusSel.has('disabled') && !task.enabled) ||
          (statusSel.has('last-fail') && task.lastResult?.status === 'failed');
        return scopeOk && statusOk && targets.has(task.target.kind);
      }),
    [sorted, scopes, statusSel, targets],
  );

  const toggleStatus = (key: StatusKey) => {
    setStatusSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderCards = (displayedTasks: readonly ScheduledTask[]) => (
    <div className="task-panel__list">
      {loading ? (
        <div className="task-panel__empty">
          <LoaderCircle size={16} className="shell-process-spin" />
          加载中…
        </div>
      ) : displayedTasks.length === 0 ? (
        <div className="task-panel__empty" data-testid="task-empty">
          {loadError
            ? '任务暂未加载，请重试'
            : tasks.length
              ? '没有符合筛选条件的任务'
              : '还没有定时任务'}
        </div>
      ) : (
        displayedTasks.map((task) => {
          const nextMs = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN;
          const dueSoon = Number.isFinite(nextMs) && nextMs - now < 5 * 60_000 && task.enabled;
          return (
            <div
              key={task.id}
              className="task-panel__card"
              data-testid="task-card"
              data-enabled={task.enabled ? '1' : '0'}
            >
              <div className="task-panel__card-top">
                <span className="task-panel__card-name">{task.name}</span>
                <div className="task-panel__badges">
                  {!task.enabled ? (
                    <span className="task-panel__badge is-paused">已停用</span>
                  ) : dueSoon ? (
                    <span className="task-panel__badge is-soon">即将触发</span>
                  ) : task.lastResult?.status === 'failed' ? (
                    <span className="task-panel__badge is-failed">上次失败</span>
                  ) : task.rule.kind === 'random' ? (
                    <span className="task-panel__badge is-random">随机</span>
                  ) : (
                    <span className="task-panel__badge is-idle">启用中</span>
                  )}
                </div>
              </div>
              <TargetLine task={task} agents={agents} models={models} teams={teams} />
              <div className="task-panel__card-meta">
                <span>⏱ {ruleSummary(task.rule)}</span>
                <span className="task-panel__dot" aria-hidden="true" />
                <span className={task.enabled ? undefined : 'opacity-60'}>
                  <Clock3 size={11} /> 下次 {formatLocal(task.nextRunAt)}
                </span>
              </div>
              {task.skillVersionIds && task.skillVersionIds.length > 0 ? (
                <div className="task-panel__skills">
                  {task.skillVersionIds.map((skillVersionId) => {
                    const skill = skills.find((s) => s.skillVersionId === skillVersionId);
                    return (
                      <span key={skillVersionId} className="task-panel__skill-chip">
                        {skill?.name ?? skillVersionId.slice(0, 8)}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <div className="task-panel__card-foot">
                <span className={`task-panel__ws-tag${task.workspaceId ? '' : ' is-global'}`}>
                  {workspaceName(task.workspaceId)}
                </span>
                {task.lastResult ? (
                  <button
                    type="button"
                    className="task-panel__last-result"
                    data-status={task.lastResult.status}
                    title="查看执行历史"
                    onClick={() => {
                      setSelectedTaskId(null);
                      setHistoryTask(task);
                    }}
                  >
                    <span className="task-panel__lr-dot" data-status={task.lastResult.status} />
                    {task.lastResult.status === 'success'
                      ? '✓'
                      : task.lastResult.status === 'failed'
                        ? '✗'
                        : task.lastResult.status === 'skipped'
                          ? '⏭'
                          : '…'}{' '}
                    上次 {formatLocal(task.lastRunAt)}
                    {' · ' + RUN_RESULT_LABELS[task.lastResult.status]}
                    {task.lastResult.reason ? ` · ${task.lastResult.reason}` : ''}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="task-panel__last-result"
                    title="查看执行历史"
                    onClick={() => {
                      setSelectedTaskId(null);
                      setHistoryTask(task);
                    }}
                  >
                    尚无执行记录 · 查看历史
                  </button>
                )}
                <div className="task-panel__actions">
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title="立即触发"
                    disabled={busyId === task.id}
                    onClick={() => void triggerNow(task)}
                  >
                    <Play size={14} />
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title="执行历史"
                    disabled={busyId === task.id}
                    onClick={() => {
                      setSelectedTaskId(null);
                      setHistoryTask(task);
                    }}
                  >
                    <Clock3 size={14} />
                  </button>
                  {task.conversationId && onOpenConversation ? (
                    <button
                      type="button"
                      className="task-panel__icon-btn"
                      title="打开任务会话"
                      onClick={() => onOpenConversation(task.conversationId!)}
                    >
                      <RefreshCw size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title="编辑"
                    disabled={busyId === task.id}
                    onClick={() => {
                      setSelectedTaskId(null);
                      setEditing(task);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title={task.enabled ? '停用' : '启用'}
                    disabled={busyId === task.id}
                    onClick={() => void toggleEnabled(task)}
                  >
                    {busyId === task.id ? (
                      <LoaderCircle size={14} className="shell-process-spin" />
                    ) : task.enabled ? (
                      <Pause size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn is-danger"
                    title="删除"
                    disabled={busyId === task.id}
                    onClick={() => {
                      setSelectedTaskId(null);
                      setDeleting(task);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
  const selectedTask = tasks.find((task) => task.id === (selectedTaskId ?? historyTask?.id));
  const closeDetails = () => {
    setSelectedTaskId(null);
    setHistoryTask(null);
  };
  const editSelected = () => {
    if (selectedTask) {
      closeDetails();
      setEditing(selectedTask);
    }
  };
  const centerTasks = shown.filter(
    (task) =>
      automationFilter === 'all' ||
      (automationFilter === 'browser'
        ? Boolean(task.automation?.browser)
        : !task.automation?.browser),
  );
  const centerSelected = centerTasks.find((task) => task.id === selectedTaskId) ?? centerTasks[0];
  return (
    <div
      className={`task-panel task-panel--${view === 'center' ? 'automation' : 'calendar'}`}
      data-testid="task-panel"
      data-workbench-page="tasks"
    >
      {view === 'center' ? (
        <AutomationCenter
          tasks={centerTasks}
          totalCount={tasks.length}
          selected={centerSelected}
          filter={automationFilter}
          onFilter={(filter) => {
            setAutomationFilter(filter);
            setActionError(null);
          }}
          onSelect={(id) => {
            setSelectedTaskId(id);
            setActionError(null);
          }}
          loading={loading}
          error={loadError}
          actionError={actionError}
          busy={Boolean(busyId)}
          resources={resources}
          executor={(task) => (
            <TargetLine task={task} agents={agents} models={models} teams={teams} />
          )}
          executorReady={executorReady}
          workspaceName={workspaceName}
          workspaceReady={workspaceReady}
          ruleSummary={ruleSummary}
          formatTime={formatLocal}
          historyRevision={historyRevision}
          onCreate={() => {
            setCreateAt(undefined);
            setEditing('new');
          }}
          onCalendar={() => {
            closeDetails();
            setView('calendar');
          }}
          onRefresh={() => {
            reloadResources();
            setHistoryRevision((value) => value + 1);
            void refresh(true);
          }}
          onEdit={(task) => setEditing(task)}
          onTest={(task) => void triggerNow(task)}
          onPublish={(task) => void toggleEnabled(task)}
          onDelete={setDeleting}
          onOpenConversation={onOpenConversation}
          onHandoffResolved={() => {
            setHistoryRevision((value) => value + 1);
            void refresh();
          }}
          scopePicker={
            <TaskScopePicker
              workspaces={workspaces}
              value={scopes[0] ?? 'all'}
              onChange={(value) => setScopes([value])}
              selectedScopes={scopes}
              onSelectedScopesChange={setScopes}
              tasks={tasks}
            />
          }
        />
      ) : (
        <>
          {actionError ? (
            <div className="task-cal__notice" role="alert">
              {actionError}
            </div>
          ) : null}
          {loadError ? (
            <div className="task-cal__notice" role="alert">
              加载失败：{loadError}
              <button type="button" onClick={() => void refresh()}>
                重试
              </button>
            </div>
          ) : null}
          <TaskCalendar
            tasks={shown}
            allTasks={tasks}
            workspaces={workspaces}
            scopes={scopes}
            onScopesChange={setScopes}
            targets={targets}
            onTargetToggle={(kind) =>
              setTargets((previous) => {
                const next = new Set(previous);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                return next;
              })
            }
            statusFilters={(
              [
                ['enabled', '启用中'],
                ['disabled', '已停用'],
                ['last-fail', '上次失败'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="task-cal__status-filter"
                aria-pressed={statusSel.has(key)}
                onClick={() => toggleStatus(key)}
              >
                <span>{label}</span>
                <small>{counts[key === 'last-fail' ? 'lastFail' : key]}</small>
                <span className="task-cal__status-check">{statusSel.has(key) ? '✓' : ''}</span>
              </button>
            ))}
            activeFilterCount={
              statusSel.size + (3 - targets.size) + (scopes.includes('all') ? 0 : scopes.length)
            }
            onResetFilters={() => {
              setScopes(['all']);
              setStatusSel(new Set());
              setTargets(new Set(['agent', 'model', 'team']));
            }}
            onCreateTask={() => {
              setCreateAt(undefined);
              setEditing('new');
            }}
            loadError={loadError}
            listContent={renderCards(shown)}
            loading={loading}
            now={now}
            onPick={(task) => {
              setHistoryTask(null);
              setSelectedTaskId(task.id);
            }}
            onEdit={(task) => {
              closeDetails();
              setEditing(task);
            }}
            onHistory={(task) => {
              setSelectedTaskId(null);
              setHistoryTask(task);
            }}
            onRun={(task) => void triggerNow(task)}
            busyTaskId={busyId}
            taskContext={(task) => ({
              target: <TargetLine task={task} agents={agents} models={models} teams={teams} />,
              rule: ruleSummary(task.rule),
              workspace: workspaceName(task.workspaceId),
            })}
            onCreate={(date) => {
              setCreateAt(date);
              setEditing('new');
            }}
            onRefresh={() => void refresh()}
          />
          {selectedTask && !editing ? (
            <TaskSheet
              title="任务详情"
              description="查看计划、管理执行与运行记录"
              onClose={closeDetails}
              footer={
                <>
                  <button
                    type="button"
                    className="task-sheet__button"
                    title="编辑"
                    onClick={editSelected}
                  >
                    <Pencil size={14} />
                    编辑任务
                  </button>
                  <button
                    type="button"
                    className="task-sheet__button is-primary"
                    disabled={busyId === selectedTask.id}
                    onClick={() => void triggerNow(selectedTask)}
                  >
                    <Play size={14} />
                    立即执行
                  </button>
                </>
              }
            >
              <div className="task-sheet__tabs" aria-label="任务信息">
                <button
                  type="button"
                  aria-pressed={!historyTask}
                  onClick={() => {
                    setSelectedTaskId(selectedTask.id);
                    setHistoryTask(null);
                  }}
                >
                  任务详情
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(historyTask)}
                  onClick={() => setHistoryTask(selectedTask)}
                >
                  运行记录
                </button>
              </div>
              <AutomationHandoffs
                task={selectedTask}
                revision={historyRevision}
                onResolved={() => {
                  setHistoryRevision((value) => value + 1);
                  void refresh();
                }}
              />
              {historyTask ? (
                <HistoryPanel
                  key={selectedTask.id}
                  task={selectedTask}
                  onClose={closeDetails}
                  onOpenConversation={onOpenConversation}
                />
              ) : (
                <>
                  <div className="task-sheet__status" data-enabled={selectedTask.enabled}>
                    {selectedTask.enabled ? '启用中' : '已停用'}
                  </div>
                  <h3 className="task-sheet__task-name">{selectedTask.name}</h3>
                  <dl className="task-sheet__facts">
                    <div>
                      <dt>任务归属</dt>
                      <dd>{workspaceName(selectedTask.workspaceId)}</dd>
                    </div>
                    <div>
                      <dt>执行者</dt>
                      <dd>
                        <TargetLine
                          task={selectedTask}
                          agents={agents}
                          models={models}
                          teams={teams}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>执行计划</dt>
                      <dd>{ruleSummary(selectedTask.rule)}</dd>
                    </div>
                    <div>
                      <dt>下次执行</dt>
                      <dd>{formatLocal(selectedTask.nextRunAt)}</dd>
                    </div>
                    <div>
                      <dt>任务时区</dt>
                      <dd>{selectedTask.timeZone}</dd>
                    </div>
                    {selectedTask.skillVersionIds?.length ? (
                      <div>
                        <dt>注入 Skill</dt>
                        <dd>
                          {selectedTask.skillVersionIds
                            .map(
                              (id) =>
                                skills.find((skill) => skill.skillVersionId === id)?.name ?? id,
                            )
                            .join('、')}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <h4 className="task-sheet__label">执行内容</h4>
                  <p className="task-sheet__instruction">{selectedTask.instruction}</p>
                  <div className="task-sheet__actions">
                    <button
                      type="button"
                      className="task-sheet__button"
                      disabled={busyId === selectedTask.id}
                      onClick={() => void toggleEnabled(selectedTask)}
                    >
                      {selectedTask.enabled ? <Pause size={14} /> : <Check size={14} />}
                      {selectedTask.enabled ? '停用任务' : '启用任务'}
                    </button>
                    <button
                      type="button"
                      className="task-sheet__button is-danger"
                      onClick={() => setDeleting(selectedTask)}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                    {selectedTask.conversationId && onOpenConversation ? (
                      <button
                        type="button"
                        className="task-sheet__button"
                        onClick={() => {
                          closeDetails();
                          onOpenConversation(selectedTask.conversationId!);
                        }}
                      >
                        打开任务会话
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </TaskSheet>
          ) : null}
        </>
      )}
      {editing ? (
        <TaskEditor
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? null : editing}
          initialDate={createAt}
          initialWorkspaceId={
            scopes.length === 1 && scopes[0] !== 'all' && scopes[0] !== 'global'
              ? scopes[0]
              : undefined
          }
          agents={agents}
          models={models}
          teams={teams}
          workspaces={workspaces}
          skills={skills}
          resources={resources}
          onReloadResources={reloadResources}
          onClose={() => setEditing(null)}
          onSaved={(savedTask) => {
            setSelectedTaskId(savedTask.id);
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
      <Dialog.Root
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busyId) setDeleting(null);
        }}
      >
        {deleting ? (
          <Dialog.Overlay className="task-cal__delete-backdrop">
            <Dialog.Content className="task-cal__delete-dialog" role="alertdialog">
              <Dialog.Title>删除「{deleting.name}」？</Dialog.Title>
              <Dialog.Description>删除后停止定时执行，已有任务会话保留。</Dialog.Description>
              <footer>
                <button
                  type="button"
                  disabled={busyId === deleting.id}
                  onClick={() => setDeleting(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busyId === deleting.id}
                  onClick={() => void removeTask(deleting)}
                >
                  确认删除
                </button>
              </footer>
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Root>
    </div>
  );
}

// ─── 卡片执行者行（头像走 AgentAvatarView，支持 base64 dataURL）──────────────

function TargetLine({
  task,
  agents,
  models,
  teams,
}: {
  task: ScheduledTask;
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  teams: readonly Team[];
}) {
  const target = task.target;
  if (target.kind === 'agent') {
    const agent = agents.find((item) => item.id === target.agentId);
    return (
      <div className="task-panel__target">
        {agent ? (
          <>
            <AgentAvatarView name={agent.name} avatar={agent.avatar} size={34} />
            <span className="task-panel__target-info">
              <span className="task-panel__target-name">智能体 · {agent.name}</span>
              {agent.description?.trim() ? (
                <span className="task-panel__target-desc">{agent.description.trim()}</span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="task-panel__target-info">
            <span className="task-panel__target-name">智能体 · {target.agentId}</span>
          </span>
        )}
      </div>
    );
  }
  if (target.kind === 'team') {
    const team = teams.find((item) => item.id === target.teamId);
    return (
      <div className="task-panel__target">
        {team ? (
          <>
            <AgentAvatarView name={team.name} avatar={team.avatar} size={34} />
            <span className="task-panel__target-info">
              <span className="task-panel__target-name">小队 · {team.name}</span>
              {team.mission?.trim() ? (
                <span className="task-panel__target-desc">{team.mission.trim()}</span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="task-panel__target-info">
            <span className="task-panel__target-name">小队 · {target.teamId}</span>
          </span>
        )}
      </div>
    );
  }
  const model = models.find((item) => item.modelId === target.modelId);
  return (
    <div className="task-panel__target">
      <span className="task-panel__target-avatar">🧠</span>
      <span className="task-panel__target-info">
        <span className="task-panel__target-name">
          直接模型 · {model ? `${model.displayName}` : target.modelId}
        </span>
        {model ? <span className="task-panel__target-desc">{model.providerName}</span> : null}
      </span>
    </div>
  );
}

// ─── 执行历史弹层（设计稿 v6）───────────────────────────────────────────────

function HistoryPanel({
  task,
  onClose,
  onOpenConversation,
}: {
  task: ScheduledTask;
  onClose(): void;
  onOpenConversation?(conversationId: string): void;
}) {
  const [entries, setEntries] = useState<ScheduledTaskHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    if (!api?.scheduledTaskHistory) {
      setError('Runtime 未连接');
      return;
    }
    void api
      .scheduledTaskHistory({ taskId: task.id, limit: HISTORY_LIMIT })
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const stats = useMemo(() => {
    if (!entries) return null;
    const ok = entries.filter((e) => e.status === 'success').length;
    const fail = entries.filter((e) => e.status === 'failed').length;
    const skip = entries.filter((e) => e.status === 'skipped').length;
    return { ok, fail, skip };
  }, [entries]);

  return (
    <section className="task-history" data-testid="task-history">
      <header className="task-history__head">
        <h3>{task.name}</h3>
        <p>最近 {HISTORY_LIMIT} 次执行记录</p>
      </header>
      <div className="task-hist__body">
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
          <div className="task-panel__empty">该任务还没有执行记录</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="task-hist__row" data-status={entry.status}>
              <span className={`task-hist__status is-${entry.status}`}>
                {RUN_RESULT_LABELS[entry.status]}
              </span>
              <span className="task-hist__time">{formatLocal(entry.firedAt)}</span>
              {entry.summary ? <span className="task-hist__summary">{entry.summary}</span> : null}
              {entry.reason && entry.reason !== entry.summary ? (
                <span className="task-hist__reason">{entry.reason}</span>
              ) : null}
              {!entry.summary && !entry.reason ? (
                <span className="task-hist__summary">—</span>
              ) : null}
            </div>
          ))
        )}
      </div>
      <footer className="task-hist__foot">
        <span className="task-hist__stats">
          {stats ? `成功 ${stats.ok} · 失败 ${stats.fail} · 跳过 ${stats.skip}` : ''}
        </span>
        {task.conversationId && onOpenConversation ? (
          <button
            type="button"
            className="task-hist__open-conv"
            onClick={() => {
              onClose();
              onOpenConversation(task.conversationId!);
            }}
          >
            打开任务会话
          </button>
        ) : null}
      </footer>
    </section>
  );
}

// ─── 通用下拉组件（设计稿 v6：点击展开、选中收起、外部点击关闭）──────────────

function SelectBox({
  value,
  selectedValue,
  leading,
  placeholder = '请选择',
  children,
  className,
}: {
  value: string;
  selectedValue: string;
  leading?: ReactNode;
  placeholder?: string;
  children: ReactNode;
  className?: string;
}) {
  const portalContainer = useTaskSheetPortalContainer();
  return (
    <DropdownMenu.Root modal={false}>
      <div className={`task-editor__select${className ? ` ${className}` : ''}`}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="task-editor__select-box" aria-label={placeholder}>
            <span className="task-editor__select-value">
              {leading ? (
                <span className="task-editor__select-leading" aria-hidden="true">
                  {leading}
                </span>
              ) : null}
              <span className="task-editor__select-label">{value || placeholder}</span>
            </span>
            <ChevronDown size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={portalContainer}>
          <DropdownMenu.Content
            className="task-editor__select-menu task-select-menu"
            align="start"
            sideOffset={5}
            collisionPadding={12}
          >
            <DropdownMenu.RadioGroup value={selectedValue} className="task-editor__select-options">
              {children}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </div>
    </DropdownMenu.Root>
  );
}

function SelectOption({
  value,
  label,
  leading,
  onPick,
}: {
  value: string;
  label: string;
  leading?: ReactNode;
  onPick(value: string): void;
}) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      aria-label={label}
      className="task-editor__select-opt"
      onSelect={() => onPick(value)}
    >
      {leading ? (
        <span className="task-editor__select-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="task-editor__select-label">{label}</span>
      <span className="task-editor__select-check" aria-hidden="true">
        <DropdownMenu.ItemIndicator>
          <Check size={16} />
        </DropdownMenu.ItemIndicator>
      </span>
    </DropdownMenu.RadioItem>
  );
}

function ExecutorTypeIcon({ kind }: { kind: ScheduledTaskTarget['kind'] }) {
  return kind === 'agent' ? (
    <Bot size={18} />
  ) : kind === 'model' ? (
    <Cpu size={18} />
  ) : (
    <UsersRound size={18} />
  );
}

// ─── 时区菜单（搜索 + 常用/全部分组）────────────────────────────────────────

function ZoneMenu({ onPick }: { onPick(zone: string): void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? TIME_ZONES.filter((z) => z.toLowerCase().includes(q)) : null;

  return (
    <div className="task-editor__zone-menu">
      <input
        className="task-editor__zone-search"
        placeholder="搜索时区…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        }}
        autoFocus
      />
      {filtered ? (
        filtered.length === 0 ? (
          <div className="task-editor__zone-empty">无匹配时区</div>
        ) : (
          filtered.map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} onPick={onPick} />
          ))
        )
      ) : (
        <>
          <div className="task-editor__zone-group">常用</div>
          {TIME_ZONE_COMMON.map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} onPick={onPick} />
          ))}
          <div className="task-editor__zone-group">全部</div>
          {TIME_ZONES.filter((z) => !TIME_ZONE_COMMON.includes(z)).map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} onPick={onPick} />
          ))}
        </>
      )}
    </div>
  );
}

// Task editor: compact fields with shared sheet geometry.

function TaskEditor({
  task,
  initialDate,
  initialWorkspaceId,
  agents,
  models,
  teams,
  workspaces,
  skills,
  resources,
  onReloadResources,
  onClose,
  onSaved,
}: {
  task: ScheduledTask | null;
  initialDate?: Date;
  initialWorkspaceId?: string;
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  teams: readonly Team[];
  workspaces: readonly WorkspaceSummary[];
  skills: readonly SkillVersionSummary[];
  resources: AutomationResources;
  onReloadResources(): void;
  onClose(): void;
  onSaved(task: ScheduledTask): void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [automation, setAutomation] = useState<AutomationBinding | undefined>(
    task?.automation ?? { executionMode: 'workspace' },
  );
  const [name, setName] = useState(task?.name ?? '');
  const [instruction, setInstruction] = useState(task?.instruction ?? '');
  const [ownerKind, setOwnerKind] = useState<'global' | 'workspace'>(
    (task ? task.workspaceId : initialWorkspaceId) ? 'workspace' : 'global',
  );
  const [workspaceId, setWorkspaceId] = useState(
    task?.workspaceId ?? initialWorkspaceId ?? workspaces[0]?.workspaceId ?? '',
  );
  const [targetKind, setTargetKind] = useState<'agent' | 'model' | 'team'>(
    task?.target.kind ?? 'agent',
  );
  const [targetRef, setTargetRef] = useState(() => {
    if (!task) return '';
    const t = task.target;
    if (t.kind === 'agent') return t.agentId;
    if (t.kind === 'team') return t.teamId;
    return t.modelId;
  });
  const [providerRef, setProviderRef] = useState('');
  const [ruleKind, setRuleKind] = useState<TaskRule['kind']>(
    task?.rule.kind ?? (initialDate ? 'at' : 'every'),
  );
  const [atTime, setAtTime] = useState(() => {
    if (task?.rule.kind === 'at') return localDateTimeInput(new Date(task.rule.runAt));
    return localDateTimeInput(initialDate ?? new Date(Date.now() + 60 * 60_000));
  });
  const [weeklyRule, setWeeklyRule] = useState<TaskRuleWeekly>(() =>
    task?.rule.kind === 'weekly'
      ? task.rule
      : {
          kind: 'weekly',
          selection: { mode: 'range', start: 1, end: 5 },
          time: '09:00',
          startDate: dateString(
            task?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            initialDate ?? new Date(),
          ),
        },
  );
  const [everyMinutes, setEveryMinutes] = useState(
    task?.rule.kind === 'every' ? String(task.rule.intervalMinutes) : '60',
  );
  const [windowUnlimited, setWindowUnlimited] = useState(
    task?.rule.kind === 'every' ? !(task.rule.windowStart && task.rule.windowEnd) : false,
  );
  const [windowStart, setWindowStart] = useState(
    task?.rule.kind === 'every' && task.rule.windowStart ? task.rule.windowStart : '09:00',
  );
  const [windowEnd, setWindowEnd] = useState(
    task?.rule.kind === 'every' && task.rule.windowEnd ? task.rule.windowEnd : '18:00',
  );
  const [randomStart, setRandomStart] = useState(
    task?.rule.kind === 'random' ? task.rule.windowStart : '09:00',
  );
  const [randomEnd, setRandomEnd] = useState(
    task?.rule.kind === 'random' ? task.rule.windowEnd : '18:00',
  );
  const [randomMin, setRandomMin] = useState(
    task?.rule.kind === 'random' ? String(task.rule.minTimes) : '1',
  );
  const [randomMax, setRandomMax] = useState(
    task?.rule.kind === 'random' ? String(task.rule.maxTimes) : '2',
  );
  const [cronExpr, setCronExpr] = useState(
    task?.rule.kind === 'cron' ? task.rule.expression : '0 9 * * *',
  );
  const [timeZone, setTimeZone] = useState(
    task?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(task?.skillVersionIds ?? []);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearExistingConversation = () => {
    if (automation?.conversation?.mode === 'existing') {
      setAutomation(current => ({ ...current, conversation: { mode: 'task' } }));
    }
  };

  const skillRef = useRef<HTMLDivElement>(null);

  const agentOptions = agents.filter((agent) => !agent.archived);
  const teamOptions = teams;
  const executorOptions = targetKind === 'agent' ? agentOptions : teamOptions;
  const selectedExecutor = executorOptions.find((item) => item.id === targetRef);
  const providerOptions = useMemo(
    () => [...new Set(models.map((m) => m.providerName).filter(Boolean))],
    [models],
  );
  const providerModels = useMemo(
    () => models.filter((m) => m.providerName === providerRef),
    [models, providerRef],
  );
  const skillOptions = skills.filter((s) => s.enabled !== false);

  // 默认选中：智能体/小队第一个；模型按供应商联动默认选第一个供应商。
  useEffect(() => {
    if (!targetRef && targetKind === 'agent' && agentOptions.length > 0) {
      setTargetRef(agentOptions[0]!.id);
    }
    if (!targetRef && targetKind === 'team' && teamOptions.length > 0) {
      setTargetRef(teamOptions[0]!.id);
    }
    if (!targetRef && targetKind === 'model' && models.length > 0) {
      const firstProvider = providerOptions[0];
      if (firstProvider) {
        setProviderRef(firstProvider);
        const firstModel = models.find((m) => m.providerName === firstProvider);
        if (firstModel) setTargetRef(firstModel.modelId);
      } else {
        setTargetRef(models[0]!.modelId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind]);

  // 编辑已有模型任务时回填供应商。
  useEffect(() => {
    if (targetKind === 'model' && targetRef && !providerRef) {
      const model = models.find((m) => m.modelId === targetRef);
      if (model?.providerName) setProviderRef(model.providerName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind, targetRef]);

  // Skill 菜单外部点击关闭
  useEffect(() => {
    if (!skillPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (skillRef.current && !skillRef.current.contains(e.target as Node))
        setSkillPickerOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [skillPickerOpen]);

  const buildRule = (): TaskRule | null => {
    if (ruleKind === 'at') {
      const runAt = new Date(atTime);
      if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= Date.now()) {
        setError('单次触发时间必须晚于当前时间');
        return null;
      }
      return { kind: 'at', runAt: runAt.toISOString() };
    }
    if (ruleKind === 'weekly') {
      const weekly = parseWeeklyRule(weeklyRule);
      if (!weekly) {
        setError('请检查每周任务的星期、开始时间及生效日期');
        return null;
      }
      return weekly;
    }
    if (ruleKind === 'every') {
      const minutes = Number(everyMinutes);
      if (!Number.isInteger(minutes) || minutes < 5) {
        setError('周期必须为 ≥5 的整数分钟');
        return null;
      }
      if (windowUnlimited) {
        return { kind: 'every', intervalMinutes: minutes };
      }
      if (!isTaskTime(windowStart) || !isTaskTime(windowEnd)) {
        setError('时段窗口时间需为 HH:mm（00:00–23:59）');
        return null;
      }
      return {
        kind: 'every',
        intervalMinutes: minutes,
        windowStart,
        windowEnd,
      };
    }
    if (ruleKind === 'random') {
      const min = Number(randomMin);
      const max = Number(randomMax);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
        setError('随机次数非法（最少 ≥1 且最多 ≥ 最少）');
        return null;
      }
      if (!isTaskTime(randomStart) || !isTaskTime(randomEnd)) {
        setError('窗口时间需为 HH:mm（00:00–23:59）');
        return null;
      }
      return {
        kind: 'random',
        windowStart: randomStart,
        windowEnd: randomEnd,
        minTimes: min,
        maxTimes: max,
      };
    }
    if (ruleKind === 'cron') {
      if (!cronExpr.trim()) {
        setError('cron 表达式不能为空');
        return null;
      }
      return { kind: 'cron', expression: cronExpr.trim() };
    }
    return null;
  };

  const save = async () => {
    if (!name.trim() || !instruction.trim()) {
      setError('名称与指令为必填');
      return;
    }
    const bindingError = automationFormError(automation, resources);
    if (bindingError) {
      setError(bindingError);
      return;
    }
    const rule = buildRule();
    if (!rule) return;
    if (!targetRef) {
      setError('请选择执行者');
      return;
    }
    const target: ScheduledTaskTarget =
      targetKind === 'agent'
        ? { kind: 'agent', agentId: targetRef }
        : targetKind === 'team'
          ? { kind: 'team', teamId: targetRef }
          : { kind: 'model', modelId: targetRef };
    const workspaceIdValue = ownerKind === 'workspace' && workspaceId ? workspaceId : undefined;
    if (ownerKind === 'workspace' && !workspaceIdValue) { setError('请选择运行工作区'); return; }
    const api = bridge();
    if (!api?.createScheduledTask || !api?.updateScheduledTask) {
      setError('Runtime 未连接');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let saved: ScheduledTask;
      if (task) {
        const result = await api.updateScheduledTask({
          taskId: task.id,
          patch: {
            name: name.trim(),
            instruction: instruction.trim(),
            target,
            rule,
            timeZone,
            workspaceId: workspaceIdValue ?? null,
            skillVersionIds: selectedSkills.length > 0 ? selectedSkills : null,
            automation: automation ?? {},
          },
        });
        saved = result.task;
      } else {
        const result = await api.createScheduledTask({
          name: name.trim(),
          enabled: false,
          ...(automation ? { automation } : {}),
          instruction: instruction.trim(),
          target,
          rule,
          timeZone,
          ...(workspaceIdValue ? { workspaceId: workspaceIdValue } : {}),
          ...(selectedSkills.length > 0 ? { skillVersionIds: selectedSkills } : {}),
        });
        saved = result.task;
      }
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  const windowIsCrossDay = !windowUnlimited && windowStart >= windowEnd;

  return (
    <TaskSheet
      title={task ? '编辑任务' : '新建任务'}
      description="目标决定工作；浏览器、工具与交付按需组合。"
      onClose={onClose}
      busy={saving}
      testId="task-editor"
      footer={
        <>
          <span className="task-sheet__foot-hint">
            {!task
              ? '保存为草稿，不自动执行；测试后发布'
              : task.enabled === false
                ? '保存后保持停用'
                : '保存后按计划执行'}
          </span>
          <div className="task-sheet__actions">
            <button
              type="button"
              className="task-sheet__button"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            {step > 1 && (
              <button
                type="button"
                className="task-sheet__button"
                disabled={saving}
                onClick={() => setStep(step === 3 ? 2 : 1)}
              >
                上一步
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                className="task-sheet__button is-primary"
                disabled={saving}
                onClick={() => setStep(step === 1 ? 2 : 3)}
              >
                下一步
              </button>
            )}
            <button
              type="button"
              className={step === 3 ? 'task-sheet__button is-primary' : 'task-sheet__button'}
              data-testid="task-save"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? <LoaderCircle size={14} className="shell-process-spin" /> : null}
              {task ? '保存修改' : '创建任务'}
            </button>
          </div>
        </>
      }
    >
      <div className="task-editor__body task-editor__body--unified" data-step={step}>
        <nav className="task-steps" aria-label="任务配置步骤">
          {(['目标与执行', '能力与交付', '验收与权限'] as const).map((label, index) => (
            <button
              type="button"
              key={label}
              aria-current={step === index + 1 ? 'step' : undefined}
              disabled={saving}
              onClick={() => setStep((index + 1) as 1 | 2 | 3)}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="task-editor__step" hidden={step !== 1}>
          <section className="task-editor__section">
            <div className="task-editor__section-body">
              <label className="task-editor__field">
                <span>任务名称</span>
                <input
                  value={name}
                  placeholder="如：每日代码巡检"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="task-editor__field">
                <span>执行内容</span>
                <textarea
                  rows={3}
                  value={instruction}
                  placeholder="如：检查仓库中未提交的改动，总结风险并输出报告"
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </label>
              <div className="task-editor__field">
                <span>运行会话</span>
                <TaskConversationPicker value={automation?.conversation} workspaceId={ownerKind === 'workspace' ? workspaceId : undefined} workspaces={workspaces} onChange={(conversation,selected)=>{
                  setAutomation(current=>({...current,conversation}));
                  if (selected) {
                    setTargetKind(selected.track); setTargetRef(selected.targetRef);
                    if(selected.track==='model')setProviderRef(models.find(model=>model.modelId===selected.targetRef)?.providerName??'');
                    setOwnerKind(selected.workspaceId?'workspace':'global');
                    if(selected.workspaceId)setWorkspaceId(selected.workspaceId);
                  }
                }}/>
              </div>
              <div className="task-editor__columns">
                <div className="task-editor__field">
                  <span>运行工作区</span>
                  <TaskScopePicker
                    value={ownerKind === 'global' ? 'global' : workspaceId}
                    label="任务归属"
                    allowAll={false}
                    workspaces={workspaces}
                    tasks={task ? [task] : []}
                    onChange={(value) => {
                      setOwnerKind(value === 'global' ? 'global' : 'workspace');
                      if (value !== 'global') setWorkspaceId(value);
                      if (value !== (ownerKind === 'global' ? 'global' : workspaceId) && automation?.conversation?.mode === 'existing') setAutomation(current=>({...current,conversation:{mode:'task'}}));
                    }}
                  />
                </div>
                <div className="task-editor__field">
                  <span>执行者类型</span>
                  <SelectBox
                    value={{ agent: '智能体', model: '直接模型', team: '小队' }[targetKind]}
                    selectedValue={targetKind}
                    leading={<ExecutorTypeIcon kind={targetKind} />}
                    placeholder="执行者类型"
                  >
                    {(['agent', 'model', 'team'] as const).map((kind) => (
                      <SelectOption
                        key={kind}
                        value={kind}
                        label={{ agent: '智能体', model: '直接模型', team: '小队' }[kind]}
                        leading={<ExecutorTypeIcon kind={kind} />}
                        onPick={() => {
                          if (kind === targetKind) return;
                          setTargetKind(kind);
                          setTargetRef('');
                          setProviderRef('');
                          clearExistingConversation();
                        }}
                      />
                    ))}
                  </SelectBox>
                </div>
              </div>
              {targetKind === 'agent' || targetKind === 'team' ? (
                <div className="task-editor__field">
                  <span>执行者</span>
                  <SelectBox
                    value={selectedExecutor?.name ?? ''}
                    selectedValue={targetRef}
                    leading={
                      selectedExecutor ? (
                        <AgentAvatarView
                          name={selectedExecutor.name}
                          avatar={selectedExecutor.avatar}
                          size={22}
                        />
                      ) : undefined
                    }
                    placeholder="选择执行者"
                  >
                    {executorOptions.map((item) => (
                      <SelectOption
                        key={item.id}
                        value={item.id}
                        label={item.name}
                        leading={
                          <AgentAvatarView name={item.name} avatar={item.avatar} size={22} />
                        }
                        onPick={(value) => { if (value !== targetRef) clearExistingConversation(); setTargetRef(value); }}
                      />
                    ))}
                    {executorOptions.length === 0 ? (
                      <div className="task-editor__zone-empty">
                        暂无可用{targetKind === 'agent' ? '智能体' : '小队'}
                      </div>
                    ) : null}
                  </SelectBox>
                </div>
              ) : (
                <div className="task-editor__columns">
                  <div className="task-editor__field">
                    <span>供应商</span>
                    <SelectBox
                      value={providerRef}
                      selectedValue={providerRef}
                      placeholder="选择供应商"
                    >
                      {providerOptions.map((provider) => (
                        <SelectOption
                          key={provider}
                          value={provider}
                          label={provider}
                          onPick={(value) => {
                            if (value === providerRef) return;
                            clearExistingConversation();
                            setProviderRef(value);
                            setTargetRef(
                              models.find((model) => model.providerName === value)?.modelId ?? '',
                            );
                          }}
                        />
                      ))}
                    </SelectBox>
                  </div>
                  <div className="task-editor__field">
                    <span>模型</span>
                    <SelectBox
                      value={models.find((model) => model.modelId === targetRef)?.displayName ?? ''}
                      selectedValue={targetRef}
                      placeholder="选择模型"
                    >
                      {providerModels.map((model) => (
                        <SelectOption
                          key={model.modelId}
                          value={model.modelId}
                          label={model.displayName}
                          onPick={(value) => { if (value !== targetRef) clearExistingConversation(); setTargetRef(value); }}
                        />
                      ))}
                    </SelectBox>
                  </div>
                </div>
              )}
            </div>
          </section>
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">
              执行计划 <span>{timeZone}</span>
            </h3>
            <div className="task-editor__section-body">
              <div className="task-editor__field">
                <span>重复方式</span>
                <SelectBox
                  value={
                    { at: '单次', weekly: '每周', every: '固定间隔', random: '随机', cron: 'Cron' }[
                      ruleKind
                    ]
                  }
                  selectedValue={ruleKind}
                  placeholder="重复方式"
                >
                  {(['at', 'weekly', 'every', 'random', 'cron'] as const).map((kind) => (
                    <SelectOption
                      key={kind}
                      value={kind}
                      label={
                        {
                          at: '单次',
                          weekly: '每周',
                          every: '固定间隔',
                          random: '随机',
                          cron: 'Cron',
                        }[kind]
                      }
                      onPick={() => setRuleKind(kind)}
                    />
                  ))}
                </SelectBox>
              </div>
              {ruleKind === 'at' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__columns">
                    <label className="task-editor__field">
                      <span>执行日期（本地）</span>
                      <div className="task-temporal-field">
                        <input
                          aria-label="单次执行日期"
                          placeholder="YYYY-MM-DD"
                          value={atTime.slice(0, 10)}
                          onChange={(e) =>
                            setAtTime(`${e.target.value}T${atTime.split('T')[1] ?? '09:00'}`)
                          }
                        />
                        <TaskTemporalPicker
                          type="date"
                          value={atTime.slice(0, 10)}
                          onChange={(date) =>
                            setAtTime(`${date}T${atTime.split('T')[1] ?? '09:00'}`)
                          }
                        />
                      </div>
                    </label>
                    <label className="task-editor__field">
                      <span>执行时间（本地）</span>
                      <div className="task-temporal-field">
                        <input
                          aria-label="单次执行时间"
                          placeholder="HH:mm"
                          inputMode="numeric"
                          value={atTime.split('T')[1] ?? ''}
                          onChange={(e) => setAtTime(`${atTime.slice(0, 10)}T${e.target.value}`)}
                        />
                        <TaskTemporalPicker
                          type="time"
                          value={atTime.split('T')[1] ?? '09:00'}
                          onChange={(time) => setAtTime(`${atTime.slice(0, 10)}T${time}`)}
                        />
                      </div>
                    </label>
                  </div>
                  <div className="task-editor__hint-row">到点执行一次后任务自动完成</div>
                </div>
              ) : null}

              {ruleKind === 'weekly' ? (
                <WeeklyRuleEditor rule={weeklyRule} timeZone={timeZone} onChange={setWeeklyRule} />
              ) : null}

              {ruleKind === 'every' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">每</span>
                    <input
                      className="task-editor__num"
                      type="number"
                      min={5}
                      value={everyMinutes}
                      onChange={(e) => setEveryMinutes(e.target.value)}
                    />
                    <span className="task-editor__field-label">分钟执行一次</span>
                  </div>
                  <div className="task-editor__window-row">
                    <span className="task-editor__field-label">开始</span>
                    <TaskTimeField
                      label="窗口开始时间"
                      value={windowStart}
                      disabled={windowUnlimited}
                      onChange={setWindowStart}
                    />
                    <span className="task-editor__field-label">结束</span>
                    <TaskTimeField
                      label="窗口结束时间"
                      value={windowEnd}
                      disabled={windowUnlimited}
                      onChange={setWindowEnd}
                    />
                    <label className="task-editor__switch-wrap">
                      <input
                        type="checkbox"
                        className="task-editor__switch-input"
                        checked={windowUnlimited}
                        onChange={(e) => setWindowUnlimited(e.target.checked)}
                      />
                      <span
                        className="task-editor__switch"
                        data-on={windowUnlimited ? '1' : '0'}
                        aria-hidden="true"
                      />
                      <span className="task-editor__field-label">不限（全天）</span>
                    </label>
                  </div>
                  {!windowUnlimited ? (
                    <div className="task-editor__hint-row">
                      仅在该时段内周期触发
                      {windowIsCrossDay ? (
                        <span className="task-editor__crossday">
                          跨天窗口（{windowStart} → {windowEnd}）
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="task-editor__hint-row">不限时段，全天按间隔执行</div>
                  )}
                </div>
              ) : null}

              {ruleKind === 'random' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">每天</span>
                    <TaskTimeField
                      label="窗口开始时间"
                      value={randomStart}
                      onChange={setRandomStart}
                    />
                    <span className="task-editor__field-label">–</span>
                    <TaskTimeField label="窗口结束时间" value={randomEnd} onChange={setRandomEnd} />
                    <span className="task-editor__field-label">时段内</span>
                  </div>
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">最少触发</span>
                    <input
                      className="task-editor__num"
                      type="number"
                      min={1}
                      value={randomMin}
                      onChange={(e) => setRandomMin(e.target.value)}
                    />
                    <span className="task-editor__field-label">次</span>
                    <span className="task-editor__field-label" style={{ marginLeft: 6 }}>
                      最多
                    </span>
                    <input
                      className="task-editor__num"
                      type="number"
                      min={1}
                      value={randomMax}
                      onChange={(e) => setRandomMax(e.target.value)}
                    />
                    <span className="task-editor__field-label">次</span>
                  </div>
                  <div className="task-editor__hint-row">窗口内随机触发 最少–最多 次</div>
                </div>
              ) : null}

              {ruleKind === 'cron' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">表达式</span>
                    <input
                      className="task-editor__input-grow"
                      value={cronExpr}
                      placeholder="如：0 9 * * *"
                      onChange={(e) => setCronExpr(e.target.value)}
                    />
                  </div>
                  <div className="task-editor__presets">
                    {(['*/30 * * * *', '0 9 * * 1-5', '0 8 * * *'] as const).map((expr) => (
                      <button key={expr} type="button" onClick={() => setCronExpr(expr)}>
                        {expr}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <p className="task-experience-note">
            不绑定工作区时，会话与产物保存在设置中的「对话与全局任务目录」，每个任务独立隔离。Runtime
            需保持在线；休眠或退出期间不会自动运行。
          </p>
        </div>
        <div className="task-editor__step" hidden={step !== 2}>
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">注入 Skill</h3>
            <div className="task-editor__section-body">
              <div className="task-editor__skill-picker" ref={skillRef}>
                {selectedSkills.map((skillVersionId) => {
                  const skill = skills.find((s) => s.skillVersionId === skillVersionId);
                  return (
                    <span key={skillVersionId} className="task-editor__skill-chip">
                      {skill?.name ?? skillVersionId.slice(0, 8)}
                      <button
                        type="button"
                        aria-label="移除"
                        onClick={() =>
                          setSelectedSkills((prev) => prev.filter((id) => id !== skillVersionId))
                        }
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="task-editor__skill-add"
                  onClick={() => setSkillPickerOpen((open) => !open)}
                >
                  ＋ 添加 Skill
                </button>
                {skillPickerOpen ? (
                  <div className="task-editor__skill-menu">
                    {skillOptions.length === 0 ? (
                      <div className="task-editor__zone-empty">（技能库为空）</div>
                    ) : (
                      skillOptions.map((skill) => {
                        const added = selectedSkills.includes(skill.skillVersionId);
                        return (
                          <button
                            key={skill.skillVersionId}
                            type="button"
                            className="task-editor__skill-opt"
                            data-added={added ? '1' : '0'}
                            disabled={added || selectedSkills.length >= 5}
                            onClick={() => {
                              setSelectedSkills((prev) =>
                                prev.length >= 5 ? prev : [...prev, skill.skillVersionId],
                              );
                            }}
                          >
                            <span className="task-editor__skill-opt-info">
                              <span className="task-editor__skill-opt-name">{skill.name}</span>
                              {skill.description ? (
                                <span className="task-editor__skill-opt-desc">
                                  {skill.description}
                                </span>
                              ) : null}
                            </span>
                            <span className="task-editor__skill-opt-state">
                              {added ? '已添加' : '添加'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
              <div className="task-editor__hint-row">最多为本任务添加 5 个 Skill</div>
            </div>
          </section>
        </div>
        {step === 3 && (
          <section className="task-review" aria-label="任务配置摘要">
            <h3>{name || '未命名任务'}</h3>
            <p>{instruction || '尚未填写目标'}</p>
            <dl>
              <div>
                <dt>执行者</dt>
                <dd>
                  {targetKind === 'model'
                    ? (models.find((model) => model.modelId === targetRef)?.displayName ?? '待选择')
                    : (selectedExecutor?.name ?? '待选择')}
                </dd>
              </div>
              <div>
                <dt>执行模型</dt>
                <dd>{targetKind === 'team' ? '按小队成员的模型配置执行' : (() => {
                  const id = targetKind === 'model' ? targetRef : agents.find(agent => agent.id === targetRef)?.defaultModelId;
                  return models.find(model => model.modelId === id)?.displayName ?? id ?? '待选择';
                })()}</dd>
              </div>
              <div>
                <dt>运行工作区</dt>
                <dd>
                  {ownerKind === 'workspace'
                    ? (workspaces.find((item) => item.workspaceId === workspaceId)?.name ??
                      '待选择')
                    : '不绑定工作区 · 独立任务目录'}
                </dd>
              </div>
              <div>
                <dt>运行会话</dt>
                <dd>{automation?.conversation?.mode === 'new' ? '每次运行时新建会话' : automation?.conversation?.mode === 'existing' ? '继续已有会话' : '此任务的专属会话'}</dd>
              </div>
              <div>
                <dt>浏览器</dt>
                <dd>
                  {automation?.browser
                    ? (resources.profiles.find(
                        (profile) => profile.id === automation.browser?.profileId,
                      )?.name ?? automation.browser.profileId)
                    : '不使用浏览器'}
                </dd>
              </div>
              <div>
                <dt>操作流程</dt>
                <dd>
                  {automation?.browser?.workflowTaskId
                    ? (resources.workflows.find(
                        (flow) => flow.id === automation.browser?.workflowTaskId,
                      )?.name ?? '待核对')
                    : '按目标动态执行'}
                </dd>
              </div>
              <div>
                <dt>计划</dt>
                <dd>
                  {
                    {
                      at: '执行一次',
                      weekly: '每周',
                      every: '固定间隔',
                      random: '随机时段',
                      cron: 'Cron',
                    }[ruleKind]
                  }{' '}
                  · {timeZone}
                </dd>
              </div>
            </dl>
            <p className="task-experience-note">
              保存新任务为草稿。先按验收说明测试；需要文件或外部交付时，再核对产物及回执。模型结束或流程跑完不代表目标已达成。
            </p>
          </section>
        )}
        <AutomationBindings
          page={step === 1 ? 'hidden' : step === 2 ? 'capabilities' : 'review'}
          value={automation}
          onChange={(binding) => {
            setAutomation(binding);
            setError(null);
          }}
          resources={resources}
          onReload={onReloadResources}
          workspaceId={ownerKind === 'workspace' ? workspaceId : undefined}
          disabled={saving}
        />

        <div className="task-editor__step" hidden={step !== 1}>
          {/* 任务时区 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">任务时区</h3>
            <div className="task-editor__section-body">
              <SelectBox value={timeZone} selectedValue={timeZone} placeholder="选择时区">
                <ZoneMenu onPick={setTimeZone} />
              </SelectBox>
            </div>
          </section>
        </div>
        {error ? (
          <p className="task-editor__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </TaskSheet>
  );
}
