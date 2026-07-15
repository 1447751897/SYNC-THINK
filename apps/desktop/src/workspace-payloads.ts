import type {
  CreateTaskPayload,
  CreateWorkspacePayload,
  ListTasksPayload,
  ListWorkspacesPayload,
  OpenTaskPayload,
  SearchTasksPayload,
} from '@sync-think/protocol';
import { normalizeAcceptanceCriteria } from '@sync-think/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCreateWorkspacePayload(value: unknown): CreateWorkspacePayload {
  if (!isRecord(value)) throw new Error('Invalid create-workspace payload');
  if (
    typeof value.folderPath !== 'string' ||
    value.folderPath.trim().length === 0 ||
    value.folderPath.length > 4096 ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256
  ) {
    throw new Error('Invalid create-workspace payload');
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      throw new Error('Invalid create-workspace payload');
    }
  }
  return {
    folderPath: value.folderPath.trim(),
    name: value.name.trim(),
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseListWorkspacesPayload(value: unknown): ListWorkspacesPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-workspaces payload');
  return {};
}

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
  return { workspaceId: value.workspaceId as ListTasksPayload['workspaceId'] };
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
