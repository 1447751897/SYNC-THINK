import type {
  BindWorkspaceFolderPayload,
  BindWorkspaceFolderResponse,
  CreateWorkspacePayload,
  CreateWorkspaceResponse,
  DeleteWorkspacePayload,
  DeleteWorkspaceResponse,
  ListWorkspacesPayload,
  ListWorkspacesResponse,
  UpdateWorkspacePayload,
  UpdateWorkspaceResponse,
} from './commands.js';

/** Workspace catalog and folder-binding lifecycle RPCs. */
export interface WorkspaceCommandContract {
  'workspace.create': {
    request: CreateWorkspacePayload;
    response: CreateWorkspaceResponse;
  };
  'workspace.bindFolder': {
    request: BindWorkspaceFolderPayload;
    response: BindWorkspaceFolderResponse;
  };
  'workspace.list': {
    request: ListWorkspacesPayload;
    response: ListWorkspacesResponse;
  };
  'workspace.update': {
    request: UpdateWorkspacePayload;
    response: UpdateWorkspaceResponse;
  };
  'workspace.delete': {
    request: DeleteWorkspacePayload;
    response: DeleteWorkspaceResponse;
  };
}

export type WorkspaceCommand = keyof WorkspaceCommandContract;
export type WorkspaceCommandRequest<K extends WorkspaceCommand> =
  WorkspaceCommandContract[K]['request'];
export type WorkspaceCommandResponse<K extends WorkspaceCommand> =
  WorkspaceCommandContract[K]['response'];
