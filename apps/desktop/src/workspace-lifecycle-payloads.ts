import type {
  BindWorkspaceFolderPayload,
  CreateWorkspacePayload,
  DeleteWorkspacePayload,
  ListWorkspacesPayload,
  UpdateWorkspacePayload,
} from '@sync-think/protocol';
import { isRecord } from '@sync-think/shared/value-validation';

export function parseCreateWorkspacePayload(value: unknown): CreateWorkspacePayload {
  if (!isRecord(value)) throw new Error('Invalid create-workspace payload');
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256) {
    throw new Error('Invalid create-workspace payload');
  }
  if (
    value.folderPath !== undefined &&
    (typeof value.folderPath !== 'string' ||
      value.folderPath.trim().length === 0 ||
      value.folderPath.length > 4096)
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
    folderPath: typeof value.folderPath === 'string' ? value.folderPath.trim() : undefined,
    name: value.name.trim(),
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseBindWorkspaceFolderPayload(value: unknown): BindWorkspaceFolderPayload {
  if (!isRecord(value)) throw new Error('Invalid bind-workspace-folder payload');
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.folderPath !== 'string' ||
    value.folderPath.trim().length === 0 ||
    value.folderPath.length > 4096
  ) {
    throw new Error('Invalid bind-workspace-folder payload');
  }
  if (value.allowedRoots !== undefined) {
    if (
      !Array.isArray(value.allowedRoots) ||
      !value.allowedRoots.every(
        (root) => typeof root === 'string' && root.length > 0 && root.length <= 4096,
      )
    ) {
      throw new Error('Invalid bind-workspace-folder payload');
    }
  }
  return {
    workspaceId: value.workspaceId.trim() as BindWorkspaceFolderPayload['workspaceId'],
    folderPath: value.folderPath.trim(),
    allowedRoots: value.allowedRoots as string[] | undefined,
  };
}

export function parseListWorkspacesPayload(value: unknown): ListWorkspacesPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-workspaces payload');
  return {};
}

export function parseUpdateWorkspacePayload(value: unknown): UpdateWorkspacePayload {
  if (!isRecord(value)) throw new Error('Invalid update-workspace payload');
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    throw new Error('Invalid update-workspace payload');
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 256) {
      throw new Error('Invalid update-workspace payload');
    }
  }
  if (value.folderPath !== undefined) {
    if (
      typeof value.folderPath !== 'string' ||
      value.folderPath.trim().length === 0 ||
      value.folderPath.length > 4096
    ) {
      throw new Error('Invalid update-workspace payload');
    }
  }
  if (value.icon !== undefined && value.icon !== null) {
    if (typeof value.icon !== 'string' || value.icon.length > 32) {
      throw new Error('Invalid update-workspace payload');
    }
  }
  if (value.sortOrder !== undefined) {
    if (typeof value.sortOrder !== 'number' || !Number.isFinite(value.sortOrder)) {
      throw new Error('Invalid update-workspace payload');
    }
  }
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') {
    throw new Error('Invalid update-workspace payload');
  }
  if (
    value.name === undefined &&
    value.folderPath === undefined &&
    value.icon === undefined &&
    value.sortOrder === undefined &&
    value.hidden === undefined
  ) {
    throw new Error('Invalid update-workspace payload');
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
    sortOrder:
      typeof value.sortOrder === 'number' && Number.isFinite(value.sortOrder)
        ? Math.trunc(value.sortOrder)
        : undefined,
    hidden: typeof value.hidden === 'boolean' ? value.hidden : undefined,
  };
}

export function parseDeleteWorkspacePayload(value: unknown): DeleteWorkspacePayload {
  if (!isRecord(value)) throw new Error('Invalid delete-workspace payload');
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    throw new Error('Invalid delete-workspace payload');
  }
  return {
    workspaceId: value.workspaceId.trim() as DeleteWorkspacePayload['workspaceId'],
  };
}
