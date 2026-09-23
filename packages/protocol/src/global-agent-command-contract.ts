import type {
  CreateGlobalAgentPayload,
  DeleteGlobalAgentPayload,
  DeleteGlobalAgentResponse,
  GlobalAgentResponse,
  ListGlobalAgentsPayload,
  ListGlobalAgentsResponse,
  ListGlobalAgentWorkspaceActivationsPayload,
  ListGlobalAgentWorkspaceActivationsResponse,
  SetGlobalAgentWorkspaceActivationPayload,
  SetGlobalAgentWorkspaceActivationResponse,
  UpdateGlobalAgentPayload,
} from './commands.js';

/** Mutable global Agent RPCs bind each command to its request and response payload. */
export interface GlobalAgentCommandContract {
  'globalAgent.list': {
    request: ListGlobalAgentsPayload;
    response: ListGlobalAgentsResponse;
  };
  'globalAgent.create': {
    request: CreateGlobalAgentPayload;
    response: GlobalAgentResponse;
  };
  'globalAgent.update': {
    request: UpdateGlobalAgentPayload;
    response: GlobalAgentResponse;
  };
  'globalAgent.delete': {
    request: DeleteGlobalAgentPayload;
    response: DeleteGlobalAgentResponse;
  };
  'globalAgent.listWorkspaceActivations': {
    request: ListGlobalAgentWorkspaceActivationsPayload;
    response: ListGlobalAgentWorkspaceActivationsResponse;
  };
  'globalAgent.setWorkspaceActivation': {
    request: SetGlobalAgentWorkspaceActivationPayload;
    response: SetGlobalAgentWorkspaceActivationResponse;
  };
}

export type GlobalAgentCommand = keyof GlobalAgentCommandContract;
export type GlobalAgentCommandRequest<K extends GlobalAgentCommand> =
  GlobalAgentCommandContract[K]['request'];
export type GlobalAgentCommandResponse<K extends GlobalAgentCommand> =
  GlobalAgentCommandContract[K]['response'];
