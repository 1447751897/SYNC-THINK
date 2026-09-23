import type {
  WorkspaceCommand,
  WorkspaceCommandRequest,
  WorkspaceCommandResponse,
} from '@sync-think/protocol';
import {
  parseBindWorkspaceFolderPayload,
  parseCreateWorkspacePayload,
  parseDeleteWorkspacePayload,
  parseListWorkspacesPayload,
  parseUpdateWorkspacePayload,
} from '../workspace-lifecycle-payloads.js';
import { WORKSPACE_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface WorkspaceHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestWorkspace<K extends WorkspaceCommand>(
    command: K,
    payload: WorkspaceCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<WorkspaceCommandResponse<K>>;
}

export function registerWorkspaceHandlers<Event>(host: WorkspaceHost<Event>): void {
  host.handle(WORKSPACE_RUNTIME_IPC_CHANNELS.create, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestWorkspace('workspace.create', parseCreateWorkspacePayload(value));
  });

  host.handle(WORKSPACE_RUNTIME_IPC_CHANNELS.bindFolder, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestWorkspace('workspace.bindFolder', parseBindWorkspaceFolderPayload(value));
  });

  host.handle(WORKSPACE_RUNTIME_IPC_CHANNELS.list, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestWorkspace('workspace.list', parseListWorkspacesPayload(value));
  });

  host.handle(WORKSPACE_RUNTIME_IPC_CHANNELS.update, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestWorkspace('workspace.update', parseUpdateWorkspacePayload(value));
  });

  host.handle(WORKSPACE_RUNTIME_IPC_CHANNELS.delete, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestWorkspace('workspace.delete', parseDeleteWorkspacePayload(value));
  });
}
