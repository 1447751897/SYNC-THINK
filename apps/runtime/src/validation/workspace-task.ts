// workspace-task command payload parsers (extracted from command-validation.ts).
import type { BindWorkspaceFolderPayload, CreateTaskPayload, CreateWorkspacePayload, UpdateWorkspacePayload, DeleteWorkspacePayload, ListTasksPayload, ListWorkspacesPayload, OpenTaskPayload, SearchTasksPayload, SetParticipationModePayload } from '@sync-think/protocol';
import { normalizeAcceptanceCriteria } from '@sync-think/shared';
import { PARTICIPATION_MODES, isRecord } from './shared.js';

export function parseCreateWorkspacePayload(value: unknown): CreateWorkspacePayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 256
  ) {
    return undefined;
  }
  if (
    value.folderPath !== undefined &&
    (typeof value.folderPath !== 'string' ||
      value.folderPath.trim().length === 0 ||
      value.folderPath.length > 4096)
  ) {
    return undefined;
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      return undefined;
    }
  }
  return {
    name: value.name.trim(),
    folderPath: typeof value.folderPath === 'string' ? value.folderPath.trim() : undefined,
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseBindWorkspaceFolderPayload(
  value: unknown,
): BindWorkspaceFolderPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.folderPath !== 'string' ||
    value.folderPath.trim().length === 0 ||
    value.folderPath.length > 4096
  ) {
    return undefined;
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      return undefined;
    }
  }
  return {
    workspaceId: value.workspaceId.trim() as BindWorkspaceFolderPayload['workspaceId'],
    folderPath: value.folderPath.trim(),
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseListWorkspacesPayload(value: unknown): ListWorkspacesPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  return value as ListWorkspacesPayload;
}

export function parseUpdateWorkspacePayload(value: unknown): UpdateWorkspacePayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    return undefined;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256) {
      return undefined;
    }
  }
  if (value.folderPath !== undefined) {
    if (
      typeof value.folderPath !== 'string' ||
      value.folderPath.trim().length === 0 ||
      value.folderPath.length > 4096
    ) {
      return undefined;
    }
  }
  if (value.icon !== undefined && value.icon !== null) {
    if (typeof value.icon !== 'string' || value.icon.length > 32) return undefined;
  }
  if (
    value.name === undefined &&
    value.folderPath === undefined &&
    value.icon === undefined
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId.trim() as UpdateWorkspacePayload['workspaceId'],
    name: typeof value.name === 'string' ? value.name.trim() : undefined,
    folderPath: typeof value.folderPath === 'string' ? value.folderPath.trim() : undefined,
    icon:
      value.icon === null
        ? null
        : typeof value.icon === 'string'
          ? value.icon.trim() || null
          : undefined,
  };
}

export function parseDeleteWorkspacePayload(value: unknown): DeleteWorkspacePayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId.trim() as DeleteWorkspacePayload['workspaceId'],
  };
}

export function parseCreateTaskPayload(value: unknown): CreateTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
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
    return undefined;
  }
  if (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string') return undefined;
  let acceptanceCriteria: string[] | undefined;
  if (value.acceptanceCriteria !== undefined) {
    try {
      acceptanceCriteria = normalizeAcceptanceCriteria(value.acceptanceCriteria);
    } catch {
      return undefined;
    }
  }
  return { ...value, acceptanceCriteria } as unknown as CreateTaskPayload;
}

export function parseListTasksPayload(value: unknown): ListTasksPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) return undefined;
  if (
    value.includeArchived !== undefined &&
    typeof value.includeArchived !== 'boolean'
  ) {
    return undefined;
  }
  return value as unknown as ListTasksPayload;
}

export function parseArchiveTaskPayload(value: unknown): import('@sync-think/protocol').ArchiveTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.length === 0 ||
    value.taskId.length > 256 ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    return undefined;
  }
  if (value.cascade !== undefined && typeof value.cascade !== 'boolean') return undefined;
  return value as unknown as import('@sync-think/protocol').ArchiveTaskPayload;
}

export function parseUnarchiveTaskPayload(
  value: unknown,
): import('@sync-think/protocol').UnarchiveTaskPayload | undefined {
  return parseArchiveTaskPayload(value) as
    | import('@sync-think/protocol').UnarchiveTaskPayload
    | undefined;
}

export function parseOpenTaskPayload(value: unknown): OpenTaskPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) return undefined;
  return value as unknown as OpenTaskPayload;
}

export function parseSearchTasksPayload(value: unknown): SearchTasksPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length === 0 ||
    typeof value.query !== 'string' ||
    value.query.length > 512
  ) {
    return undefined;
  }
  return value as unknown as SearchTasksPayload;
}

export function parseSetParticipationModePayload(
  value: unknown,
): SetParticipationModePayload | undefined {
  if (!isRecord(value) || Object.hasOwn(value, 'approvedPlan')) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.length === 0 ||
    value.taskId.length > 256 ||
    typeof value.mode !== 'string' ||
    !PARTICIPATION_MODES.has(value.mode) ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0
  ) {
    return undefined;
  }
  return value as unknown as SetParticipationModePayload;
}
