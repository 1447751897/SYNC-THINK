import { parseScheduledTaskAutomation } from '@sync-think/shared';
import { parseWeeklyRule } from '@sync-think/shared/task-schedule';
import type { ScheduledTaskTarget, TaskRule } from '@sync-think/shared';
import type { CreateScheduledTaskPayload, UpdateScheduledTaskPayload } from './commands.js';

export { parseScheduledTaskAutomation, tryParseScheduledTaskAutomation } from '@sync-think/shared';

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function target(value: unknown): value is ScheduledTaskTarget {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'agent':
      return only(value, ['kind', 'agentId']) && id(value.agentId);
    case 'model':
      return only(value, ['kind', 'modelId']) && id(value.modelId);
    case 'team':
      return only(value, ['kind', 'teamId']) && id(value.teamId);
    default:
      return false;
  }
}
// Validate the boundary without converting task-local dates/times to the host timezone.
function rule(value: unknown): value is TaskRule {
  if (!record(value)) return false;
  const time = (item: unknown): item is string =>
    typeof item === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item);
  const instant = (item: unknown): item is string =>
    typeof item === 'string' && Number.isFinite(Date.parse(item));
  switch (value.kind) {
    case 'at':
      return only(value, ['kind', 'runAt']) && instant(value.runAt);
    case 'every':
      return (
        only(value, ['kind', 'intervalMinutes', 'firstRunAt', 'windowStart', 'windowEnd']) &&
        typeof value.intervalMinutes === 'number' &&
        Number.isInteger(value.intervalMinutes) &&
        value.intervalMinutes >= 5 &&
        (value.firstRunAt === undefined || instant(value.firstRunAt)) &&
        (value.windowStart === undefined || time(value.windowStart)) &&
        (value.windowEnd === undefined || time(value.windowEnd)) &&
        (value.windowStart === undefined ||
          value.windowEnd === undefined ||
          value.windowEnd > value.windowStart)
      );
    case 'random':
      return (
        only(value, ['kind', 'windowStart', 'windowEnd', 'minTimes', 'maxTimes', 'atLeastOnce']) &&
        time(value.windowStart) &&
        time(value.windowEnd) &&
        typeof value.minTimes === 'number' &&
        Number.isInteger(value.minTimes) &&
        value.minTimes >= 1 &&
        typeof value.maxTimes === 'number' &&
        Number.isInteger(value.maxTimes) &&
        value.maxTimes >= value.minTimes &&
        (value.atLeastOnce === undefined || typeof value.atLeastOnce === 'boolean')
      );
    case 'cron':
      return only(value, ['kind', 'expression']) && id(value.expression);
    case 'weekly':
      return (
        only(value, ['kind', 'selection', 'time', 'startDate']) &&
        record(value.selection) &&
        only(
          value.selection,
          value.selection.mode === 'days' ? ['mode', 'days'] : ['mode', 'start', 'end'],
        ) &&
        Boolean(parseWeeklyRule(value))
      );
    default:
      return false;
  }
}

export function tryParseCreateScheduledTaskPayload(
  value: unknown,
): CreateScheduledTaskPayload | undefined {
  if (
    !record(value) ||
    !only(value, [
      'collaborationConversationId',
      'name',
      'instruction',
      'target',
      'rule',
      'timeZone',
      'enabled',
      'workspaceId',
      'skillVersionIds',
      'nextRunAt',
      'automation',
    ]) ||
    typeof value.name !== 'string' ||
    typeof value.instruction !== 'string' ||
    !target(value.target) ||
    !rule(value.rule) ||
    (value.collaborationConversationId !== undefined && !id(value.collaborationConversationId)) ||
    (value.timeZone !== undefined && typeof value.timeZone !== 'string') ||
    (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
    (value.workspaceId !== undefined && typeof value.workspaceId !== 'string') ||
    (value.skillVersionIds !== undefined &&
      (!Array.isArray(value.skillVersionIds) || !value.skillVersionIds.every(id))) ||
    (value.nextRunAt !== undefined && typeof value.nextRunAt !== 'string')
  )
    return undefined;
  const automation =
    value.automation === undefined ? undefined : parseScheduledTaskAutomation(value.automation);
  if (value.automation !== undefined && !automation) return undefined;
  return {
    ...value,
    ...(automation ? { automation } : {}),
  } as unknown as CreateScheduledTaskPayload;
}

export function tryParseUpdateScheduledTaskPayload(
  value: unknown,
): UpdateScheduledTaskPayload | undefined {
  if (
    !record(value) ||
    !only(value, ['taskId', 'patch']) ||
    !id(value.taskId) ||
    !record(value.patch)
  )
    return undefined;
  const patch = value.patch;
  if (
    !only(patch, [
      'name',
      'instruction',
      'target',
      'rule',
      'timeZone',
      'enabled',
      'workspaceId',
      'skillVersionIds',
      'nextRunAt',
      'automation',
    ]) ||
    (patch.name !== undefined && typeof patch.name !== 'string') ||
    (patch.instruction !== undefined && typeof patch.instruction !== 'string') ||
    (patch.target !== undefined && !target(patch.target)) ||
    (patch.rule !== undefined && !rule(patch.rule)) ||
    (patch.timeZone !== undefined && typeof patch.timeZone !== 'string') ||
    (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') ||
    (patch.workspaceId !== undefined &&
      patch.workspaceId !== null &&
      typeof patch.workspaceId !== 'string') ||
    (patch.skillVersionIds !== undefined &&
      patch.skillVersionIds !== null &&
      (!Array.isArray(patch.skillVersionIds) || !patch.skillVersionIds.every(id))) ||
    (patch.nextRunAt !== undefined &&
      patch.nextRunAt !== null &&
      typeof patch.nextRunAt !== 'string')
  )
    return undefined;
  const automation =
    patch.automation == null ? undefined : parseScheduledTaskAutomation(patch.automation);
  if (patch.automation !== undefined && patch.automation !== null && !automation) return undefined;
  return {
    taskId: value.taskId,
    patch: { ...patch, ...(automation ? { automation } : {}) },
  } as UpdateScheduledTaskPayload;
}
