import type { Socket } from 'node:net';
import {
  encodeFrame,
  type Frame,
  type ListTasksResponse,
  type ListWorkspacesResponse,
  type OpenTaskResponse,
  type SearchTasksResponse,
} from '@sync-think/protocol';
import { ErrorCode, type TaskId } from '@sync-think/shared';
import {
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
} from '../command-validation.js';
import { toTaskSummary } from '../summaries.js';
import type { QueryContext } from './query-context.js';

/**
 * Read-only query command handlers extracted from the Runtime class.
 *
 * Each handler is a free function taking a narrow QueryContext instead of the
 * full Runtime instance. Logic is a line-for-line move from the original
 * private methods — no behavior change.
 */

export function handleListWorkspaces(ctx: QueryContext, socket: Socket, frame: Frame): void {
  const payload = parseListWorkspacesPayload(frame.payload ?? {});
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.workspaceStore) {
    ctx.writeWorkspaceStoreUnavailable(socket, frame);
    return;
  }
  const response: ListWorkspacesResponse = {
    workspaces: ctx.workspaceStore.listWorkspaces().map((workspace) =>
      ctx.toWorkspaceSummary(workspace),
    ),
  };
  socket.write(
    encodeFrame({
      id: frame.id,
      kind: 'response',
      type: 'workspace.list',
      payload: response,
    }),
  );
}

export function handleListTasks(ctx: QueryContext, socket: Socket, frame: Frame): void {
  const payload = parseListTasksPayload(frame.payload);
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.workspaceStore) {
    ctx.writeWorkspaceStoreUnavailable(socket, frame);
    return;
  }
  if (!ctx.workspaceStore.getWorkspace(payload.workspaceId)) {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.WORKSPACE_NOT_FOUND,
          message: `Workspace not found: ${payload.workspaceId}`,
        },
      }),
    );
    return;
  }
  const response: ListTasksResponse = {
    tasks: ctx.workspaceStore
      .listTasks(payload.workspaceId, { includeArchived: Boolean(payload.includeArchived) })
      .map((task) => toTaskSummary(task)),
  };
  socket.write(
    encodeFrame({
      id: frame.id,
      kind: 'response',
      type: 'task.list',
      payload: response,
    }),
  );
}

export function handleOpenTask(ctx: QueryContext, socket: Socket, frame: Frame): void {
  const payload = parseOpenTaskPayload(frame.payload);
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.workspaceStore) {
    ctx.writeWorkspaceStoreUnavailable(socket, frame);
    return;
  }
  try {
    const opened = ctx.workspaceStore.openTask(payload.taskId as TaskId);
    const response: OpenTaskResponse = {
      task: toTaskSummary(opened),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'task.open',
        payload: response,
      }),
    );
  } catch (error) {
    ctx.writeWorkspaceCommandError(socket, frame, error);
  }
}

export function handleSearchTasks(ctx: QueryContext, socket: Socket, frame: Frame): void {
  const payload = parseSearchTasksPayload(frame.payload);
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.workspaceStore) {
    ctx.writeWorkspaceStoreUnavailable(socket, frame);
    return;
  }
  if (!ctx.workspaceStore.getWorkspace(payload.workspaceId)) {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.WORKSPACE_NOT_FOUND,
          message: `Workspace not found: ${payload.workspaceId}`,
        },
      }),
    );
    return;
  }
  const response: SearchTasksResponse = {
    tasks: ctx.workspaceStore
      .searchTasks(payload.workspaceId, payload.query)
      .map((task) => toTaskSummary(task)),
  };
  socket.write(
    encodeFrame({
      id: frame.id,
      kind: 'response',
      type: 'task.search',
      payload: response,
    }),
  );
}
