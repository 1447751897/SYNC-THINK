/** QA-only calendar service: in-memory examples, never schedules real model runs. */
import type {
  ScheduledTask,
  ScheduledTaskHistoryEntry,
  ScheduledTaskTarget,
  TaskRule,
} from '@sync-think/shared';
import type {
  CreateScheduledTaskPayload,
  UpdateScheduledTaskPayload,
  ListScheduledTaskHistoryPayload,
} from '@sync-think/protocol';
import { initialNextRunAt } from '@sync-think/shared/task-schedule';

export function createCalendarPreviewRuntime(
  ids: { agentId: string; modelId: string; teamId: string; workspaceId: string },
  now = new Date(),
  scenario: 'sample' | 'hourly-missing' = 'sample',
) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(now.getFullYear(), now.getMonth(), day, hour, minute);
  const createdAt = first.toISOString();
  const agent: ScheduledTaskTarget = { kind: 'agent', agentId: ids.agentId };
  const model: ScheduledTaskTarget = { kind: 'model', modelId: ids.modelId };
  const team: ScheduledTaskTarget = { kind: 'team', teamId: ids.teamId };
  let serial = 0;
  const make = (
    name: string,
    target: ScheduledTaskTarget,
    rule: TaskRule,
    enabled = true,
  ): ScheduledTask => {
    const task: ScheduledTask = {
      id: `qa-calendar-${++serial}`,
      name,
      instruction: 'QA 日历交互示例，不执行真实任务。',
      target,
      rule,
      timeZone,
      enabled,
      workspaceId: ids.workspaceId,
      createdAt,
      updatedAt: now.toISOString(),
    };
    if (enabled) task.nextRunAt = initialNextRunAt(task, now);
    return task;
  };
  let tasks = [
    make('代码与质量巡检', agent, { kind: 'cron', expression: '0 9 * * 1-5' }),
    make('整理知识与资料', model, { kind: 'cron', expression: '0 14 * * 1,3,5' }),
    make('每周研发复盘', team, { kind: 'cron', expression: '0 16 * * 5' }),
    make('发送每日进展', agent, { kind: 'cron', expression: '30 17 * * 1-5' }),
    make('收集新想法', model, {
      kind: 'random',
      minTimes: 1,
      maxTimes: 2,
      windowStart: '13:00',
      windowEnd: '16:00',
    }),
    make('检查链接健康', agent, { kind: 'every', intervalMinutes: 1440 }, false),
    ...Array.from({ length: 4 }, (_, index) =>
      make(
        ['准备发布清单', '审查变更', '测试与验证', '汇总执行结果'][index]!,
        index % 2 ? team : agent,
        { kind: 'at', runAt: at(now.getDate() + 1, 9 + index).toISOString() },
      ),
    ),
  ];
  const history: ScheduledTaskHistoryEntry[] = [];
  if (scenario === 'hourly-missing') {
    const hourly = make('每小时测试', agent, {
      kind: 'every',
      intervalMinutes: 60,
      windowStart: '12:00',
      windowEnd: '18:00',
    });
    hourly.createdAt = at(now.getDate(), 11, 42).toISOString();
    const firedAt = new Date(at(now.getDate(), 12).getTime() + 101).toISOString();
    if (Date.parse(firedAt) < now.getTime()) {
      history.push({ id: 'qa-hourly-history', taskId: hourly.id, firedAt, status: 'success' });
      hourly.lastRunAt = firedAt;
      hourly.lastResult = { status: 'success', firedAt };
    }
    tasks = [hourly];
  }
  for (const [index, task] of (scenario === 'sample' ? tasks.slice(0, 4) : []).entries()) {
    for (let day = 2 + index; day < now.getDate(); day += index === 2 ? 7 : 6) {
      history.push({
        id: `qa-history-${task.id}-${day}`,
        taskId: task.id,
        firedAt: at(day, [9, 14, 16, 17][index]!, index === 3 ? 30 : 0).toISOString(),
        status: index === 3 && day + 6 >= now.getDate() ? 'failed' : 'success',
        summary: 'QA 日历示例运行记录。',
        ...(index === 3 && day + 6 >= now.getDate() ? { reason: '示例：服务临时离线' } : {}),
      });
    }
    const latest = history.filter((entry) => entry.taskId === task.id).at(-1);
    if (latest) {
      task.lastRunAt = latest.firedAt;
      task.lastResult = { status: latest.status, firedAt: latest.firedAt, reason: latest.reason };
    }
  }
  return {
    listScheduledTasks: async () => ({ tasks: [...tasks] }),
    scheduledTaskHistory: async ({ taskId, limit = 20 }: ListScheduledTaskHistoryPayload) => ({
      entries: history
        .filter((entry) => entry.taskId === taskId)
        .sort((a, b) => b.firedAt.localeCompare(a.firedAt))
        .slice(0, limit),
    }),
    createScheduledTask: async (payload: CreateScheduledTaskPayload) => {
      const task: ScheduledTask = {
        ...payload,
        id: `qa-calendar-${++serial}`,
        timeZone: payload.timeZone ?? timeZone,
        enabled: payload.enabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (task.enabled && !task.nextRunAt) task.nextRunAt = initialNextRunAt(task);
      tasks = [...tasks, task];
      return { task };
    },
    updateScheduledTask: async ({ taskId, patch }: UpdateScheduledTaskPayload) => {
      const current = tasks.find((task) => task.id === taskId);
      if (!current) throw new Error('QA 任务未找到');
      const updated = {
        ...current,
        ...patch,
        workspaceId:
          patch.workspaceId === null ? undefined : (patch.workspaceId ?? current.workspaceId),
        skillVersionIds:
          patch.skillVersionIds === null
            ? undefined
            : (patch.skillVersionIds ?? current.skillVersionIds),
        automation:
          patch.automation === null ? undefined : (patch.automation ?? current.automation),
        nextRunAt: patch.nextRunAt === null ? undefined : (patch.nextRunAt ?? current.nextRunAt),
        updatedAt: new Date().toISOString(),
      };
      if (!updated.enabled) updated.nextRunAt = undefined;
      else if (patch.rule || patch.timeZone || patch.enabled === true)
        updated.nextRunAt = initialNextRunAt(updated);
      tasks = tasks.map((task) => (task.id === taskId ? updated : task));
      return { task: updated };
    },
    deleteScheduledTask: async ({ taskId }: { taskId: string }) => {
      tasks = tasks.filter((task) => task.id !== taskId);
      return { deleted: true };
    },
    triggerScheduledTask: async ({ taskId }: { taskId: string }) => {
      const task = tasks.find((task) => task.id === taskId);
      if (!task) throw new Error('QA 任务未找到');
      return { task, fired: false, reason: 'QA 预览只验证交互，不启动真实执行。' };
    },
  };
}
