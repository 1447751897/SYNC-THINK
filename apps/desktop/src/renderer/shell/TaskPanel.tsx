/**
 * 定时任务面板（侧栏「定时任务」入口）。
 *
 * 按设计稿 v8 实现：
 * - 整体面板：左导航 + 右卡片流合并为同一容器；左栏可拖拽调宽（150–300px，双击恢复）；
 *   响应式（≤700px 纵向堆叠，左栏变顶部横向条）。
 * - 左栏筛选（无图标）：全部任务（默认选中，选中时归属组灰显禁用）、归属组（全局收件箱 +
 *   各工作区，多选 = 或）、状态组（启用中 / 已停用 / 上次失败，多选 = 或）；跨组 = 与；
 *   每组可不选（= 不限）；计数角标实时。
 * - 执行者头像统一走 AgentAvatarView（dataURL / emoji / 首字母三态，修复 base64 头像乱码）。
 * - 随机规则支持「最少 / 最多」两次输入（minTimes / maxTimes）。
 * - 编辑器六分区、执行历史弹层保持 v6 视觉不变。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
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

const HISTORY_LIMIT = 20;
const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 300;
const SIDEBAR_DEFAULT = 196;
const SIDEBAR_NARROW = 860;

type StatusKey = 'enabled' | 'disabled' | 'last-fail';
type ScopeKey = 'global' | string;

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
    case 'cron':
      return `cron ${rule.expression}`;
    default:
      return '';
  }
}

export interface TaskPanelProps {
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  teams: readonly Team[];
  workspaces: readonly WorkspaceSummary[];
  skills: readonly SkillVersionSummary[];
  onOpenConversation?(conversationId: string): void;
  onNotify?(tone: 'info' | 'error', text: string): void;
}

export function TaskPanel({
  agents,
  models,
  teams,
  workspaces,
  skills,
  onOpenConversation,
  onNotify,
}: TaskPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 筛选：全部任务（默认选中）/ 归属多选 / 状态多选
  const [scopeAll, setScopeAll] = useState(true);
  const [scopeSel, setScopeSel] = useState<Set<ScopeKey>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<StatusKey>>(new Set());
  // 左栏宽度（拖拽调整）
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);

  const refresh = async () => {
    const api = bridge();
    if (!api?.listScheduledTasks) return;
    try {
      const res = await api.listScheduledTasks({});
      setTasks(res.tasks);
    } catch (error) {
      onNotify?.('error', `加载任务失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = async (task: ScheduledTask) => {
    const api = bridge();
    if (!api?.updateScheduledTask) return;
    setBusyId(task.id);
    try {
      await api.updateScheduledTask({ taskId: task.id, patch: { enabled: !task.enabled } });
      await refresh();
    } catch (error) {
      onNotify?.('error', `切换失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const triggerNow = async (task: ScheduledTask) => {
    const api = bridge();
    if (!api?.triggerScheduledTask) return;
    setBusyId(task.id);
    try {
      const res = await api.triggerScheduledTask({ taskId: task.id });
      if (!res.fired) {
        onNotify?.('error', `未触发：${res.reason ?? '未知原因'}`);
      } else {
        onNotify?.('info', `已触发「${task.name}」`);
      }
      await refresh();
    } catch (error) {
      onNotify?.('error', `触发失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeTask = async (task: ScheduledTask) => {
    const api = bridge();
    if (!api?.deleteScheduledTask) return;
    if (!window.confirm(`删除定时任务「${task.name}」？任务会话保留。`)) return;
    setBusyId(task.id);
    try {
      await api.deleteScheduledTask({ taskId: task.id });
      await refresh();
    } catch (error) {
      onNotify?.('error', `删除失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const workspaceName = (workspaceId?: string): string => {
    if (!workspaceId) return '全局';
    const ws = workspaces.find((w) => w.workspaceId === workspaceId);
    return ws?.name ?? '未知工作区';
  };

  // 归属选项：全局收件箱 + 有任务或已选的工作区
  const scopeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const key = task.workspaceId ?? 'global';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const options: { id: string; label: string; count: number }[] = [
      { id: 'global', label: '全局收件箱', count: counts.get('global') ?? 0 },
    ];
    for (const ws of workspaces) {
      const count = counts.get(ws.workspaceId) ?? 0;
      if (count > 0 || scopeSel.has(ws.workspaceId)) {
        options.push({ id: ws.workspaceId, label: ws.name, count });
      }
    }
    return options;
  }, [tasks, workspaces, scopeSel]);

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '')),
    [tasks],
  );

  const counts = useMemo(() => {
    const enabled = tasks.filter((t) => t.enabled).length;
    return {
      all: tasks.length,
      enabled,
      disabled: tasks.length - enabled,
      lastFail: tasks.filter((t) => t.lastResult?.status === 'failed').length,
    };
  }, [tasks]);

  const shown = useMemo(
    () =>
      sorted.filter((task) => {
        const scopeOk =
          scopeAll ||
          scopeSel.size === 0 ||
          scopeSel.has(task.workspaceId ?? 'global');
        const statusOk =
          statusSel.size === 0 ||
          (statusSel.has('enabled') && task.enabled) ||
          (statusSel.has('disabled') && !task.enabled) ||
          (statusSel.has('last-fail') && task.lastResult?.status === 'failed');
        return scopeOk && statusOk;
      }),
    [sorted, scopeAll, scopeSel, statusSel],
  );

  const summaryText = useMemo(() => {
    const parts: string[] = [];
    if (scopeAll) {
      parts.push('全部任务');
    } else if (scopeSel.size > 0) {
      parts.push(
        [...scopeSel]
          .map((key) => (key === 'global' ? '全局收件箱' : workspaceName(key)))
          .join(' + '),
      );
    }
    if (statusSel.size > 0) {
      const names: Record<StatusKey, string> = { enabled: '启用中', disabled: '已停用', 'last-fail': '上次失败' };
      parts.push([...statusSel].map((k) => names[k]).join(' + '));
    }
    return parts.length > 0 ? parts.join(' · ') : '全部';
  }, [scopeAll, scopeSel, statusSel, workspaces]);

  // 拖拽调宽
  const onGripMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (window.innerWidth <= SIDEBAR_NARROW) return;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const toggleScope = (key: ScopeKey) => {
    setScopeAll(false);
    setScopeSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleStatus = (key: StatusKey) => {
    setStatusSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="task-panel" data-testid="task-panel">
      <header className="task-panel__head">
        <div>
          <h1 className="task-panel__title">定时任务</h1>
          <p className="task-panel__subtitle">到点向任务会话注入指令执行，支持工作区 / 全局归属</p>
        </div>
        <button
          type="button"
          className="task-panel__new"
          data-testid="task-create"
          onClick={() => setEditing('new')}
        >
          <Plus size={14} /> 新建任务
        </button>
      </header>

      <div className="task-panel__frame">
        {/* 左栏导航（可拖拽调宽） */}
        <aside
          className="task-panel__side"
          style={{ width: sidebarWidth }}
          data-testid="task-sidebar"
        >
          <button
            type="button"
            className="task-panel__sb-item is-all"
            data-active={scopeAll ? '1' : '0'}
            onClick={() => setScopeAll(true)}
          >
            <span className="task-panel__sb-label">全部任务</span>
            <span className="task-panel__sb-count">{counts.all}</span>
          </button>

          <div className="task-panel__sb-divider" />
          <div className="task-panel__sb-group">归属</div>
          <button
            type="button"
            className="task-panel__sb-item"
            data-active={!scopeAll && scopeSel.has('global') ? '1' : '0'}
            disabled={scopeAll}
            onClick={() => toggleScope('global')}
          >
            <span className="task-panel__sb-label">全局收件箱</span>
            <span className="task-panel__sb-count">{scopeOptions.find((o) => o.id === 'global')?.count ?? 0}</span>
            <span className="task-panel__sb-check">✓</span>
          </button>
          {scopeOptions
            .filter((o) => o.id !== 'global')
            .map((option) => (
              <button
                key={option.id}
                type="button"
                className="task-panel__sb-item"
                data-active={!scopeAll && scopeSel.has(option.id) ? '1' : '0'}
                disabled={scopeAll}
                onClick={() => toggleScope(option.id)}
              >
                <span className="task-panel__sb-label">{option.label}</span>
                <span className="task-panel__sb-count">{option.count}</span>
                <span className="task-panel__sb-check">✓</span>
              </button>
            ))}

          <div className="task-panel__sb-divider" />
          <div className="task-panel__sb-group">状态</div>
          {(
            [
              ['enabled', '启用中'],
              ['disabled', '已停用'],
              ['last-fail', '上次失败'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="task-panel__sb-item"
              data-active={statusSel.has(key) ? '1' : '0'}
              onClick={() => toggleStatus(key)}
            >
              <span className="task-panel__sb-label">{label}</span>
              <span className="task-panel__sb-count">
                {counts[key === 'last-fail' ? 'lastFail' : key]}
              </span>
              <span className="task-panel__sb-check">✓</span>
            </button>
          ))}

          <div className="task-panel__sb-divider" />
          <div className="task-panel__sb-note">拖拽右侧分隔线调整左栏宽度 · 双击恢复默认</div>
        </aside>

        {/* 拖拽手柄 */}
        <div
          className="task-panel__grip"
          title="拖拽调整宽度 · 双击恢复"
          onMouseDown={onGripMouseDown}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        >
          <span className="task-panel__grip-hint">⇔ 拖拽</span>
        </div>

        {/* 右栏卡片流 */}
        <main className="task-panel__main">
          <div className="task-panel__bar" data-testid="task-bar">
            {summaryText} · 共 <b>{shown.length}</b> 个
          </div>
          <div className="task-panel__list">
            {loading ? (
              <div className="task-panel__empty">
                <LoaderCircle size={16} className="shell-process-spin" />
                加载中…
              </div>
            ) : shown.length === 0 ? (
              <div className="task-panel__empty" data-testid="task-empty">
                没有符合条件的任务
              </div>
            ) : (
              shown.map((task) => {
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
                          onClick={() => setHistoryTask(task)}
                        >
                          <span className="task-panel__lr-dot" data-status={task.lastResult.status} />
                          {task.lastResult.status === 'success'
                            ? '✓'
                            : task.lastResult.status === 'skipped'
                              ? '⏭'
                              : '✗'}{' '}
                          上次 {formatLocal(task.lastRunAt)}
                          {task.lastResult.status === 'success'
                            ? ' · 成功'
                            : task.lastResult.status === 'skipped'
                              ? ' · 已跳过'
                              : ' · 失败'}
                          {task.lastResult.reason ? ` · ${task.lastResult.reason}` : ''}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="task-panel__last-result"
                          title="查看执行历史"
                          onClick={() => setHistoryTask(task)}
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
                          onClick={() => setHistoryTask(task)}
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
                          onClick={() => setEditing(task)}
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
                          onClick={() => void removeTask(task)}
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
        </main>
      </div>

      {editing ? (
        <TaskEditor
          task={editing === 'new' ? null : editing}
          agents={agents}
          models={models}
          teams={teams}
          workspaces={workspaces}
          skills={skills}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {historyTask ? (
        <HistoryPanel
          task={historyTask}
          onClose={() => setHistoryTask(null)}
          onOpenConversation={onOpenConversation}
        />
      ) : null}
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
    <div className="task-hist-backdrop" data-testid="task-history" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="task-hist">
        <header className="task-hist__head">
          <div>
            <h2>执行历史 <span className="task-hist__task">· {task.name}</span></h2>
            <p className="task-hist__subtitle">最近 {HISTORY_LIMIT} 次执行记录</p>
          </div>
          <button type="button" className="task-editor__close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="task-hist__body">
          {error ? (
            <div className="task-panel__empty" role="alert">{error}</div>
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
                  {entry.status === 'success' ? '成功' : entry.status === 'failed' ? '失败' : '跳过'}
                </span>
                <span className="task-hist__time">{formatLocal(entry.firedAt)}</span>
                {entry.summary ? (
                  <span className="task-hist__summary">{entry.summary}</span>
                ) : entry.reason ? (
                  <span className="task-hist__reason">{entry.reason}</span>
                ) : (
                  <span className="task-hist__summary">—</span>
                )}
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
      </div>
    </div>
  );
}

// ─── 通用下拉组件（设计稿 v6：点击展开、选中收起、外部点击关闭）──────────────

function SelectBox({
  value,
  placeholder = '请选择',
  children,
  className,
}: {
  value: string;
  placeholder?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div className={`task-editor__select${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className="task-editor__select-box"
        data-open={open ? '1' : '0'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="task-editor__select-value">{value || placeholder}</span>
        <span className="task-editor__select-caret">▾</span>
      </button>
      {open ? <div className="task-editor__select-menu">{children}</div> : null}
    </div>
  );
}

function SelectOption({
  value,
  label,
  active,
  onPick,
}: {
  value: string;
  label: string;
  active?: boolean;
  onPick(value: string): void;
}) {
  return (
    <button
      type="button"
      className="task-editor__select-opt"
      data-active={active ? '1' : '0'}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  );
}

// ─── 时区菜单（搜索 + 常用/全部分组）────────────────────────────────────────

function ZoneMenu({
  value,
  onPick,
}: {
  value: string;
  onPick(zone: string): void;
}) {
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
        autoFocus
      />
      {filtered ? (
        filtered.length === 0 ? (
          <div className="task-editor__zone-empty">无匹配时区</div>
        ) : (
          filtered.map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} active={zone === value} onPick={onPick} />
          ))
        )
      ) : (
        <>
          <div className="task-editor__zone-group">常用</div>
          {TIME_ZONE_COMMON.map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} active={zone === value} onPick={onPick} />
          ))}
          <div className="task-editor__zone-group">全部</div>
          {TIME_ZONES.filter((z) => !TIME_ZONE_COMMON.includes(z)).map((zone) => (
            <SelectOption key={zone} value={zone} label={zone} active={zone === value} onPick={onPick} />
          ))}
        </>
      )}
    </div>
  );
}

// ─── 新建 / 编辑对话框（设计稿 v6 六分区；随机规则支持最少/最多）──────────────

function TaskEditor({
  task,
  agents,
  models,
  teams,
  workspaces,
  skills,
  onClose,
  onSaved,
}: {
  task: ScheduledTask | null;
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  teams: readonly Team[];
  workspaces: readonly WorkspaceSummary[];
  skills: readonly SkillVersionSummary[];
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(task?.name ?? '');
  const [instruction, setInstruction] = useState(task?.instruction ?? '');
  const [ownerKind, setOwnerKind] = useState<'global' | 'workspace'>(task?.workspaceId ? 'workspace' : 'global');
  const [workspaceId, setWorkspaceId] = useState(task?.workspaceId ?? workspaces[0]?.workspaceId ?? '');
  const [targetKind, setTargetKind] = useState<'agent' | 'model' | 'team'>(task?.target.kind ?? 'agent');
  const [targetRef, setTargetRef] = useState(() => {
    if (!task) return '';
    const t = task.target;
    if (t.kind === 'agent') return t.agentId;
    if (t.kind === 'team') return t.teamId;
    return t.modelId;
  });
  const [providerRef, setProviderRef] = useState('');
  const [ruleKind, setRuleKind] = useState<TaskRule['kind']>(task?.rule.kind ?? 'every');
  const [atTime, setAtTime] = useState(() => {
    if (task?.rule.kind === 'at') return task.rule.runAt.slice(0, 16);
    return new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16);
  });
  const [everyMinutes, setEveryMinutes] = useState(
    task?.rule.kind === 'every' ? String(task.rule.intervalMinutes) : '60',
  );
  const [windowUnlimited, setWindowUnlimited] = useState(
    task?.rule.kind === 'every'
      ? !(task.rule.windowStart && task.rule.windowEnd)
      : false,
  );
  const [windowStart, setWindowStart] = useState(
    task?.rule.kind === 'every' && task.rule.windowStart ? task.rule.windowStart : '09:00',
  );
  const [windowEnd, setWindowEnd] = useState(
    task?.rule.kind === 'every' && task.rule.windowEnd ? task.rule.windowEnd : '18:00',
  );
  const [randomStart, setRandomStart] = useState(task?.rule.kind === 'random' ? task.rule.windowStart : '09:00');
  const [randomEnd, setRandomEnd] = useState(task?.rule.kind === 'random' ? task.rule.windowEnd : '18:00');
  const [randomMin, setRandomMin] = useState(task?.rule.kind === 'random' ? String(task.rule.minTimes) : '1');
  const [randomMax, setRandomMax] = useState(task?.rule.kind === 'random' ? String(task.rule.maxTimes) : '2');
  const [cronExpr, setCronExpr] = useState(task?.rule.kind === 'cron' ? task.rule.expression : '0 9 * * *');
  const [timeZone, setTimeZone] = useState(task?.timeZone ?? 'Asia/Shanghai');
  const [selectedSkills, setSelectedSkills] = useState<string[]>(task?.skillVersionIds ?? []);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillRef = useRef<HTMLDivElement>(null);

  const agentOptions = agents.filter((agent) => !agent.archived);
  const teamOptions = teams;
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
      if (skillRef.current && !skillRef.current.contains(e.target as Node)) setSkillPickerOpen(false);
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
    if (ruleKind === 'every') {
      const minutes = Number(everyMinutes);
      if (!Number.isInteger(minutes) || minutes < 5) {
        setError('周期必须为 ≥5 的整数分钟');
        return null;
      }
      if (windowUnlimited) {
        return { kind: 'every', intervalMinutes: minutes };
      }
      if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd)) {
        setError('时段窗口时间需为 HH:mm');
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
      if (!/^\d{2}:\d{2}$/.test(randomStart) || !/^\d{2}:\d{2}$/.test(randomEnd)) {
        setError('窗口时间需为 HH:mm');
        return null;
      }
      return { kind: 'random', windowStart: randomStart, windowEnd: randomEnd, minTimes: min, maxTimes: max };
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
    const api = bridge();
    if (!api?.createScheduledTask || !api?.updateScheduledTask) {
      setError('Runtime 未连接');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (task) {
        await api.updateScheduledTask({
          taskId: task.id,
          patch: {
            name: name.trim(),
            instruction: instruction.trim(),
            target,
            rule,
            timeZone,
            workspaceId: workspaceIdValue ?? null,
            skillVersionIds: selectedSkills.length > 0 ? selectedSkills : null,
          },
        });
      } else {
        await api.createScheduledTask({
          name: name.trim(),
          instruction: instruction.trim(),
          target,
          rule,
          timeZone,
          ...(workspaceIdValue ? { workspaceId: workspaceIdValue } : {}),
          ...(selectedSkills.length > 0 ? { skillVersionIds: selectedSkills } : {}),
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  const windowIsCrossDay = !windowUnlimited && windowStart >= windowEnd;

  return (
    <div className="task-editor-backdrop" data-testid="task-editor" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="task-editor">
        <header className="task-editor__head">
          <div>
            <h2>{task ? '编辑定时任务' : '新建定时任务'}</h2>
            <p className="task-editor__subtitle">六个分区 · 自上而下依次配置</p>
          </div>
          <button type="button" className="task-editor__close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="task-editor__body">
          {/* ① 基本信息 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">① 基本信息</h3>
            <div className="task-editor__section-body">
              <label className="task-editor__field">
                <span>任务名称</span>
                <input value={name} placeholder="如：每日代码巡检" onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="task-editor__field">
                <span>指令</span>
                <textarea
                  rows={3}
                  value={instruction}
                  placeholder="如：检查仓库中未提交的改动，总结风险并输出报告"
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </label>
            </div>
          </section>

          {/* ② 归属 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">② 归属</h3>
            <div className="task-editor__section-body">
              <div className="task-editor__owner-list">
                <button
                  type="button"
                  className="task-editor__owner-opt"
                  data-active={ownerKind === 'global' ? '1' : '0'}
                  onClick={() => setOwnerKind('global')}
                >
                  <span className="task-editor__radio" data-checked={ownerKind === 'global' ? '1' : '0'} />
                  <span className="task-editor__owner-info">
                    <span className="task-editor__owner-title">全局任务</span>
                    <span className="task-editor__owner-desc">使用独立会话，不携带工作区上下文</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="task-editor__owner-opt"
                  data-active={ownerKind === 'workspace' ? '1' : '0'}
                  onClick={() => setOwnerKind('workspace')}
                >
                  <span className="task-editor__radio" data-checked={ownerKind === 'workspace' ? '1' : '0'} />
                  <span className="task-editor__owner-info">
                    <span className="task-editor__owner-title">绑定工作区</span>
                    <span className="task-editor__owner-desc">触发时使用该工作区的上下文与文件</span>
                  </span>
                </button>
              </div>
              {ownerKind === 'workspace' ? (
                <div className="task-editor__ws-row">
                  <SelectBox
                    value={
                      workspaceId
                        ? (workspaces.find((ws) => ws.workspaceId === workspaceId)?.name ?? workspaceId)
                        : ''
                    }
                    placeholder="选择工作区"
                  >
                    {workspaces.length === 0 ? (
                      <div className="task-editor__zone-empty">（暂无工作区）</div>
                    ) : (
                      workspaces.map((ws) => (
                        <SelectOption
                          key={ws.workspaceId}
                          value={ws.workspaceId}
                          label={ws.icon ? `${ws.icon} ${ws.name}` : ws.name}
                          active={ws.workspaceId === workspaceId}
                          onPick={setWorkspaceId}
                        />
                      ))
                    )}
                  </SelectBox>
                </div>
              ) : null}
            </div>
          </section>

          {/* ③ 执行者 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">③ 执行者</h3>
            <div className="task-editor__section-body">
              <div className="task-editor__seg">
                {(
                  [
                    ['agent', '智能体'],
                    ['model', '直接模型'],
                    ['team', '小队'],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="task-editor__seg-item"
                    data-active={targetKind === kind ? '1' : '0'}
                    onClick={() => {
                      setTargetKind(kind);
                      setTargetRef('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {targetKind === 'agent' ? (
                <div className="task-editor__target-list">
                  {agentOptions.length === 0 ? (
                    <div className="task-editor__target-empty">（智能体库为空，请先创建智能体）</div>
                  ) : (
                    agentOptions.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className="task-editor__target-opt"
                        data-selected={targetRef === agent.id ? '1' : '0'}
                        onClick={() => setTargetRef(agent.id)}
                      >
                        <AgentAvatarView name={agent.name} avatar={agent.avatar} size={34} />
                        <span className="task-editor__target-info">
                          <span className="task-editor__target-name">{agent.name}</span>
                          {agent.description?.trim() ? (
                            <span className="task-editor__target-desc">{agent.description.trim()}</span>
                          ) : null}
                        </span>
                        <span className="task-editor__radio" data-checked={targetRef === agent.id ? '1' : '0'} />
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {targetKind === 'team' ? (
                <div className="task-editor__target-list">
                  {teamOptions.length === 0 ? (
                    <div className="task-editor__target-empty">（暂无小队，请先创建小队）</div>
                  ) : (
                    teamOptions.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        className="task-editor__target-opt"
                        data-selected={targetRef === team.id ? '1' : '0'}
                        onClick={() => setTargetRef(team.id)}
                      >
                        <AgentAvatarView name={team.name} avatar={team.avatar} size={34} />
                        <span className="task-editor__target-info">
                          <span className="task-editor__target-name">{team.name}</span>
                          {team.mission?.trim() ? (
                            <span className="task-editor__target-desc">{team.mission.trim()}</span>
                          ) : null}
                        </span>
                        <span className="task-editor__radio" data-checked={targetRef === team.id ? '1' : '0'} />
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {targetKind === 'model' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">供应商</span>
                    <SelectBox
                      value={
                        providerRef ||
                        (providerOptions.length === 1 ? providerOptions[0]! : '')
                      }
                      placeholder="选择供应商"
                      className="task-editor__select-grow"
                    >
                      {providerOptions.length === 0 ? (
                        <div className="task-editor__zone-empty">（无可用供应商）</div>
                      ) : (
                        providerOptions.map((provider) => (
                          <SelectOption
                            key={provider}
                            value={provider}
                            label={provider}
                            active={provider === providerRef}
                            onPick={(provider) => {
                              setProviderRef(provider);
                              const firstModel = models.find((m) => m.providerName === provider);
                              setTargetRef(firstModel?.modelId ?? '');
                            }}
                          />
                        ))
                      )}
                    </SelectBox>
                  </div>
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">模型</span>
                    <SelectBox
                      value={models.find((m) => m.modelId === targetRef)?.displayName ?? targetRef}
                      placeholder="选择模型"
                      className="task-editor__select-grow"
                    >
                      {providerModels.length === 0 ? (
                        <div className="task-editor__zone-empty">（无模型）</div>
                      ) : (
                        providerModels.map((model) => (
                          <SelectOption
                            key={model.modelId}
                            value={model.modelId}
                            label={model.displayName}
                            active={model.modelId === targetRef}
                            onPick={setTargetRef}
                          />
                        ))
                      )}
                    </SelectBox>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* ④ 触发规则 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">④ 触发规则</h3>
            <div className="task-editor__section-body">
              <div className="task-editor__seg">
                {(
                  [
                    ['at', '单次'],
                    ['every', '周期'],
                    ['random', '随机'],
                    ['cron', 'cron'],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="task-editor__seg-item"
                    data-active={ruleKind === kind ? '1' : '0'}
                    onClick={() => setRuleKind(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {ruleKind === 'at' ? (
                <div className="task-editor__stack">
                  <div className="task-editor__row">
                    <span className="task-editor__field-label">执行时间</span>
                    <input
                      className="task-editor__input-grow"
                      type="datetime-local"
                      value={atTime}
                      onChange={(e) => setAtTime(e.target.value)}
                    />
                  </div>
                  <div className="task-editor__hint-row">到点执行一次后任务自动完成</div>
                </div>
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
                    <input
                      className="task-editor__time"
                      type="time"
                      value={windowStart}
                      disabled={windowUnlimited}
                      onChange={(e) => setWindowStart(e.target.value)}
                    />
                    <span className="task-editor__field-label">结束</span>
                    <input
                      className="task-editor__time"
                      type="time"
                      value={windowEnd}
                      disabled={windowUnlimited}
                      onChange={(e) => setWindowEnd(e.target.value)}
                    />
                    <label className="task-editor__switch-wrap">
                      <input
                        type="checkbox"
                        className="task-editor__switch-input"
                        checked={windowUnlimited}
                        onChange={(e) => setWindowUnlimited(e.target.checked)}
                      />
                      <span className="task-editor__switch" data-on={windowUnlimited ? '1' : '0'} aria-hidden="true" />
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
                    <input
                      className="task-editor__time"
                      type="time"
                      value={randomStart}
                      onChange={(e) => setRandomStart(e.target.value)}
                    />
                    <span className="task-editor__field-label">–</span>
                    <input
                      className="task-editor__time"
                      type="time"
                      value={randomEnd}
                      onChange={(e) => setRandomEnd(e.target.value)}
                    />
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
                    <span className="task-editor__field-label" style={{ marginLeft: 6 }}>最多</span>
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
                    {(
                      [
                        '*/30 * * * *',
                        '0 9 * * 1-5',
                        '0 8 * * *',
                      ] as const
                    ).map((expr) => (
                      <button key={expr} type="button" onClick={() => setCronExpr(expr)}>
                        {expr}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* ⑤ 注入 Skill */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">⑤ 注入 Skill</h3>
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
                        onClick={() => setSelectedSkills((prev) => prev.filter((id) => id !== skillVersionId))}
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
                                <span className="task-editor__skill-opt-desc">{skill.description}</span>
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
              <div className="task-editor__hint-row">候选 Skill 仅在点击「添加 Skill」时弹出；已添加项置灰防重复，最多 5 个</div>
            </div>
          </section>

          {/* ⑥ 时区 */}
          <section className="task-editor__section">
            <h3 className="task-editor__section-title">⑥ 时区</h3>
            <div className="task-editor__section-body">
              <SelectBox
                value={timeZone}
                placeholder="选择时区"
              >
                <ZoneMenu value={timeZone} onPick={setTimeZone} />
              </SelectBox>
            </div>
          </section>

          {error ? (
            <p className="task-editor__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="task-editor__foot">
          <button type="button" className="task-editor__cancel" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="task-editor__save"
            data-testid="task-save"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle size={14} className="shell-process-spin" /> : null}
            {task ? '保存修改' : '创建任务'}
          </button>
        </footer>
      </div>
    </div>
  );
}
