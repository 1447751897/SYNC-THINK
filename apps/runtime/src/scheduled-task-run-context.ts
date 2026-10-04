import { parseScheduledTaskAutomation, type ScheduledTask } from '@sync-think/shared';
import { parseWeeklyRule } from '@sync-think/shared/task-schedule';

/** Host-authored occurrence identity retained in the provider run journal, never tool arguments. */
export interface ScheduledTaskRunContext {
  version: 1;
  threadId: string;
  task: ScheduledTask;
  firedAt: string;
  workflowVersionId?: string;
  daemonDispatched?: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\s\u0000-\u001f\u007f]/u.test(value);

/** Reject incomplete/cross-thread context instead of guessing a scheduled occurrence on resume. */
export function parseScheduledTaskRunContext(
  value: unknown,
  threadId: string,
): ScheduledTaskRunContext | undefined {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.threadId !== threadId ||
    !id(value.threadId) ||
    !record(value.task) ||
    typeof value.firedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.firedAt,
    ) ||
    !Number.isFinite(Date.parse(value.firedAt)) ||
    (value.workflowVersionId !== undefined && !id(value.workflowVersionId)) ||
    (value.daemonDispatched !== undefined && typeof value.daemonDispatched !== 'boolean')
  )
    return undefined;
  const task = value.task;
  if (
    !id(task.id) ||
    typeof task.name !== 'string' ||
    typeof task.instruction !== 'string' ||
    typeof task.enabled !== 'boolean' ||
    typeof task.timeZone !== 'string' ||
    typeof task.createdAt !== 'string' ||
    typeof task.updatedAt !== 'string' ||
    !record(task.target) ||
    !record(task.rule) ||
    (task.workspaceId !== undefined && !id(task.workspaceId)) ||
    (task.conversationId !== undefined && !id(task.conversationId)) ||
    (task.skillVersionIds !== undefined &&
      (!Array.isArray(task.skillVersionIds) || !task.skillVersionIds.every(id)))
  )
    return undefined;
  const target = task.target;
  if (
    !(target.kind === 'model' && id(target.modelId)) &&
    !(target.kind === 'agent' && id(target.agentId)) &&
    !(target.kind === 'team' && id(target.teamId))
  )
    return undefined;
  const rule = task.rule;
  if (rule.kind === 'at') {
    if (typeof rule.runAt !== 'string' || !Number.isFinite(Date.parse(rule.runAt)))
      return undefined;
  } else if (rule.kind === 'every') {
    if (!Number.isInteger(rule.intervalMinutes) || Number(rule.intervalMinutes) < 5)
      return undefined;
  } else if (rule.kind === 'cron') {
    if (typeof rule.expression !== 'string' || !rule.expression.trim()) return undefined;
  } else if (rule.kind === 'weekly') {
    if (!parseWeeklyRule(rule)) return undefined;
  } else if (rule.kind === 'random') {
    if (
      typeof rule.windowStart !== 'string' ||
      typeof rule.windowEnd !== 'string' ||
      !Number.isInteger(rule.minTimes) ||
      !Number.isInteger(rule.maxTimes) ||
      Number(rule.minTimes) < 0 ||
      Number(rule.maxTimes) < 1 ||
      Number(rule.maxTimes) < Number(rule.minTimes)
    )
      return undefined;
  } else return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: task.timeZone });
  } catch {
    return undefined;
  }
  if (task.automation !== undefined && !parseScheduledTaskAutomation(task.automation))
    return undefined;
  return structuredClone(value) as unknown as ScheduledTaskRunContext;
}
