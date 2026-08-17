/**
 * 定时任务面板（侧栏「定时任务」入口）。
 *
 * 列表卡片：名称 + 执行者（智能体/模型）+ 规则摘要 + 下次触发（本地时间）+
 * 最近结果 + 启停开关 + 操作（立即触发/编辑/删除/打开任务会话）。
 * 新建/编辑对话框：名称、指令、执行者两组下拉（智能体库 / 模型目录）、
 * 规则四 tab（单次 at / 周期 every / 随机 random / cron）、时区、预览行。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock3,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { GlobalAgent } from '@sync-think/shared';
import type { ScheduledTask, ScheduledTaskTarget, TaskRule } from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';

function bridge() {
  return window.syncThink?.runtime;
}

const TIME_ZONES = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];

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
    case 'every':
      return `每 ${rule.intervalMinutes} 分钟`;
    case 'random':
      return `随机 ${rule.minTimes}-${rule.maxTimes} 次/天 · ${rule.windowStart}-${rule.windowEnd}`;
    case 'cron':
      return `cron ${rule.expression}`;
    default:
      return '';
  }
}

function targetLabel(target: ScheduledTaskTarget, agents: readonly GlobalAgent[], models: readonly ModelOption[]): string {
  if (target.kind === 'agent') {
    const agent = agents.find((item) => item.id === target.agentId);
    return agent ? `智能体 · ${agent.name}` : `智能体 · ${target.agentId}`;
  }
  const model = models.find((item) => item.modelId === target.modelId);
  return model ? `模型 · ${model.displayName}` : `模型 · ${target.modelId}`;
}

export interface TaskPanelProps {
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  onOpenConversation?(conversationId: string): void;
  onNotify?(tone: 'info' | 'error', text: string): void;
}

export function TaskPanel({ agents, models, onOpenConversation, onNotify }: TaskPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
        onNotify?.('info', `未触发：${res.reason ?? '未知原因'}`);
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

  const sorted = useMemo(() => [...tasks].sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '')), [tasks]);

  return (
    <div className="task-panel" data-testid="task-panel">
      <header className="task-panel__head">
        <div>
          <h1 className="task-panel__title">定时任务</h1>
          <p className="task-panel__subtitle">
            到点向任务会话注入指令执行；支持单次、周期、随机窗口与 cron。
          </p>
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

      <div className="task-panel__list">
        {loading ? (
          <div className="task-panel__empty">
            <LoaderCircle size={16} className="shell-process-spin" />
            加载中…
          </div>
        ) : sorted.length === 0 ? (
          <div className="task-panel__empty" data-testid="task-empty">
            还没有定时任务。点击「新建任务」创建第一个。
          </div>
        ) : (
          sorted.map((task) => {
            const nextMs = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN;
            const dueSoon = Number.isFinite(nextMs) && nextMs - now < 5 * 60_000 && task.enabled;
            return (
              <div
                key={task.id}
                className="task-panel__card"
                data-testid="task-card"
                data-enabled={task.enabled ? '1' : '0'}
              >
                <div className="task-panel__card-main">
                  <div className="task-panel__card-title-row">
                    <span className="task-panel__card-name">{task.name}</span>
                    {task.rule.kind === 'random' ? (
                      <span className="task-panel__badge is-random">随机</span>
                    ) : null}
                    {!task.enabled ? <span className="task-panel__badge is-paused">已停用</span> : null}
                    {dueSoon ? <span className="task-panel__badge is-soon">即将触发</span> : null}
                  </div>
                  <div className="task-panel__card-meta">
                    <span>{targetLabel(task.target, agents, models)}</span>
                    <span className="task-panel__dot" aria-hidden="true" />
                    <span>{ruleSummary(task.rule)}</span>
                    <span className="task-panel__dot" aria-hidden="true" />
                    <span className={task.enabled ? undefined : 'opacity-60'}>
                      <Clock3 size={11} /> 下次 {formatLocal(task.nextRunAt)}
                    </span>
                  </div>
                  {task.lastResult ? (
                    <div className="task-panel__card-last" data-status={task.lastResult.status}>
                      {task.lastResult.status === 'success'
                        ? '✓'
                        : task.lastResult.status === 'skipped'
                          ? '⏭'
                          : '✗'}{' '}
                      上次 {formatLocal(task.lastRunAt)}
                      {task.lastResult.reason ? ` · ${task.lastResult.reason}` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="task-panel__card-actions">
                  {task.conversationId && onOpenConversation ? (
                    <button
                      type="button"
                      className="task-panel__icon-btn"
                      title="打开任务会话"
                      onClick={() => onOpenConversation(task.conversationId!)}
                    >
                      <RefreshCw size={13} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title="立即触发"
                    disabled={busyId === task.id}
                    onClick={() => void triggerNow(task)}
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title="编辑"
                    disabled={busyId === task.id}
                    onClick={() => setEditing(task)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn"
                    title={task.enabled ? '停用' : '启用'}
                    disabled={busyId === task.id}
                    onClick={() => void toggleEnabled(task)}
                  >
                    {busyId === task.id ? (
                      <LoaderCircle size={13} className="shell-process-spin" />
                    ) : task.enabled ? (
                      <X size={13} />
                    ) : (
                      <Check size={13} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="task-panel__icon-btn is-danger"
                    title="删除"
                    disabled={busyId === task.id}
                    onClick={() => void removeTask(task)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {editing ? (
        <TaskEditor
          task={editing === 'new' ? null : editing}
          agents={agents}
          models={models}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── 新建 / 编辑对话框 ───────────────────────────────────────────────────────

function TaskEditor({
  task,
  agents,
  models,
  onClose,
  onSaved,
}: {
  task: ScheduledTask | null;
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(task?.name ?? '');
  const [instruction, setInstruction] = useState(task?.instruction ?? '');
  const [targetKind, setTargetKind] = useState<'agent' | 'model'>(task?.target.kind ?? 'agent');
  const [targetRef, setTargetRef] = useState(
    task ? (task.target.kind === 'agent' ? task.target.agentId : task.target.modelId) : '',
  );
  const [ruleKind, setRuleKind] = useState<TaskRule['kind']>(task?.rule.kind ?? 'every');
  const [atTime, setAtTime] = useState(() => {
    if (task?.rule.kind === 'at') return task.rule.runAt.slice(0, 16);
    return new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16);
  });
  const [everyMinutes, setEveryMinutes] = useState(
    task?.rule.kind === 'every' ? String(task.rule.intervalMinutes) : '60',
  );
  const [windowStart, setWindowStart] = useState(task?.rule.kind === 'random' ? task.rule.windowStart : '09:00');
  const [windowEnd, setWindowEnd] = useState(task?.rule.kind === 'random' ? task.rule.windowEnd : '18:00');
  const [minTimes, setMinTimes] = useState(task?.rule.kind === 'random' ? String(task.rule.minTimes) : '1');
  const [maxTimes, setMaxTimes] = useState(task?.rule.kind === 'random' ? String(task.rule.maxTimes) : '2');
  const [cronExpr, setCronExpr] = useState(task?.rule.kind === 'cron' ? task.rule.expression : '0 9 * * *');
  const [timeZone, setTimeZone] = useState(task?.timeZone ?? 'UTC');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentOptions = agents.filter((agent) => !agent.archived);
  const modelOptions = models;

  useEffect(() => {
    if (!targetRef && agentOptions.length > 0 && targetKind === 'agent') {
      setTargetRef(agentOptions[0]!.id);
    }
    if (!targetRef && modelOptions.length > 0 && targetKind === 'model') {
      setTargetRef(modelOptions[0]!.modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind]);

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
      return { kind: 'every', intervalMinutes: minutes };
    }
    if (ruleKind === 'random') {
      const min = Number(minTimes);
      const max = Number(maxTimes);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
        setError('随机次数非法（min ≥1 且 max ≥ min）');
        return null;
      }
      if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd)) {
        setError('窗口时间需为 HH:mm');
        return null;
      }
      return { kind: 'random', windowStart, windowEnd, minTimes: min, maxTimes: max };
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
    const target: ScheduledTaskTarget =
      targetKind === 'agent' ? { kind: 'agent', agentId: targetRef } : { kind: 'model', modelId: targetRef };
    if (targetKind === 'agent' && !targetRef) {
      setError('请选择执行智能体');
      return;
    }
    if (targetKind === 'model' && !targetRef) {
      setError('请选择执行模型');
      return;
    }
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
          patch: { name: name.trim(), instruction: instruction.trim(), target, rule, timeZone },
        });
      } else {
        await api.createScheduledTask({
          name: name.trim(),
          instruction: instruction.trim(),
          target,
          rule,
          timeZone,
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <div className="task-editor-backdrop" data-testid="task-editor" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="task-editor">
        <header className="task-editor__head">
          <div>
            <h2>{task ? '编辑任务' : '新建任务'}</h2>
            <p className="task-editor__subtitle">触发时向任务专属会话注入指令，由执行者完成。</p>
          </div>
          <button type="button" className="task-editor__close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="task-editor__body">
          <label className="task-editor__field">
            <span>任务名称</span>
            <input value={name} placeholder="如：每日代码巡检" onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="task-editor__field">
            <span>指令（触发时交给执行者）</span>
            <textarea
              rows={3}
              value={instruction}
              placeholder="如：检查仓库中未提交的改动，总结风险并输出报告"
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>

          <div className="task-editor__field">
            <span>执行者</span>
            <div className="task-editor__target">
              <div className="task-editor__target-kind">
                <button
                  type="button"
                  data-active={targetKind === 'agent' ? '1' : '0'}
                  onClick={() => {
                    setTargetKind('agent');
                    setTargetRef(agentOptions[0]?.id ?? '');
                  }}
                >
                  智能体
                </button>
                <button
                  type="button"
                  data-active={targetKind === 'model' ? '1' : '0'}
                  onClick={() => {
                    setTargetKind('model');
                    setTargetRef(modelOptions[0]?.modelId ?? '');
                  }}
                >
                  直接模型
                </button>
              </div>
              {targetKind === 'agent' ? (
                <select value={targetRef} onChange={(e) => setTargetRef(e.target.value)}>
                  {agentOptions.length === 0 ? (
                    <option value="">（智能体库为空，请先创建智能体）</option>
                  ) : null}
                  {agentOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.persona?.trim() ? ` — ${agent.persona.trim().slice(0, 40)}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={targetRef} onChange={(e) => setTargetRef(e.target.value)}>
                  {modelOptions.length === 0 ? <option value="">（模型目录为空）</option> : null}
                  {modelOptions.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.displayName} · {model.providerName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="task-editor__field">
            <span>触发规则</span>
            <div className="task-editor__rule-tabs">
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
                  data-active={ruleKind === kind ? '1' : '0'}
                  onClick={() => setRuleKind(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="task-editor__rule-body">
              {ruleKind === 'at' ? (
                <input
                  type="datetime-local"
                  value={atTime}
                  onChange={(e) => setAtTime(e.target.value)}
                />
              ) : null}
              {ruleKind === 'every' ? (
                <div className="task-editor__row">
                  <span>每</span>
                  <input
                    type="number"
                    min={5}
                    value={everyMinutes}
                    onChange={(e) => setEveryMinutes(e.target.value)}
                  />
                  <span>分钟</span>
                </div>
              ) : null}
              {ruleKind === 'random' ? (
                <div className="task-editor__grid2">
                  <label>
                    <span>窗口开始</span>
                    <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                  </label>
                  <label>
                    <span>窗口结束</span>
                    <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                  </label>
                  <label>
                    <span>每天最少次数</span>
                    <input type="number" min={1} value={minTimes} onChange={(e) => setMinTimes(e.target.value)} />
                  </label>
                  <label>
                    <span>每天最多次数</span>
                    <input type="number" min={1} value={maxTimes} onChange={(e) => setMaxTimes(e.target.value)} />
                  </label>
                </div>
              ) : null}
              {ruleKind === 'cron' ? (
                <div className="task-editor__row">
                  <input
                    value={cronExpr}
                    placeholder="如：0 9 * * 1（每周一 09:00）"
                    onChange={(e) => setCronExpr(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <label className="task-editor__field">
            <span>时区</span>
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

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
