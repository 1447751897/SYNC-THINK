import type {
  ArchiveTaskPayload,
  CreateTaskPayload,
  ListTasksPayload,
  OpenTaskPayload,
  SearchTasksPayload,
  UnarchiveTaskPayload,
} from '@sync-think/protocol';
import { normalizeAcceptanceCriteria } from '@sync-think/shared';
import { isRecord } from '@sync-think/shared/value-validation';

export function parseCreateTaskPayload(value: unknown): CreateTaskPayload {
  if (!isRecord(value)) throw new Error('Invalid create-task payload');
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 512 ||
    typeof value.goal !== 'string' ||
    value.goal.trim().length === 0 ||
    value.goal.length > 10_000
  ) {
    throw new Error('Invalid create-task payload');
  }
  if (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string') {
    throw new Error('Invalid create-task payload');
  }
  let acceptanceCriteria: string[] | undefined;
  try {
    acceptanceCriteria =
      value.acceptanceCriteria === undefined
        ? undefined
        : normalizeAcceptanceCriteria(value.acceptanceCriteria);
  } catch {
    throw new Error('Invalid create-task payload');
  }
  return {
    workspaceId: value.workspaceId as CreateTaskPayload['workspaceId'],
    title: value.title.trim(),
    goal: value.goal.trim(),
    parentTaskId: value.parentTaskId as CreateTaskPayload['parentTaskId'],
    acceptanceCriteria,
  };
}

export function parseListTasksPayload(value: unknown): ListTasksPayload {
  if (!isRecord(value)) throw new Error('Invalid list-tasks payload');
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) {
    throw new Error('Invalid list-tasks payload');
  }
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean') {
    throw new Error('Invalid list-tasks payload');
  }
  return {
    workspaceId: value.workspaceId as ListTasksPayload['workspaceId'],
    includeArchived: value.includeArchived === true ? true : undefined,
  };
}

export function parseArchiveTaskPayload(value: unknown): ArchiveTaskPayload {
  if (!isRecord(value)) throw new Error('Invalid archive-task payload');
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.length === 0 ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    throw new Error('Invalid archive-task payload');
  }
  if (value.cascade !== undefined && typeof value.cascade !== 'boolean') {
    throw new Error('Invalid archive-task payload');
  }
  return {
    taskId: value.taskId as ArchiveTaskPayload['taskId'],
    expectedTaskVersion: value.expectedTaskVersion as number,
    cascade: value.cascade,
  };
}

export function parseUnarchiveTaskPayload(value: unknown): UnarchiveTaskPayload {
  return parseArchiveTaskPayload(value);
}

export function parseOpenTaskPayload(value: unknown): OpenTaskPayload {
  if (!isRecord(value)) throw new Error('Invalid open-task payload');
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
    throw new Error('Invalid open-task payload');
  }
  return { taskId: value.taskId as OpenTaskPayload['taskId'] };
}

export function parseSearchTasksPayload(value: unknown): SearchTasksPayload {
  if (!isRecord(value)) throw new Error('Invalid search-tasks payload');
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length === 0 ||
    typeof value.query !== 'string' ||
    value.query.length > 512
  ) {
    throw new Error('Invalid search-tasks payload');
  }
  return {
    workspaceId: value.workspaceId as SearchTasksPayload['workspaceId'],
    query: value.query,
  };
}
