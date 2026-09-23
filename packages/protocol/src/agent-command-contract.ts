import type {
  CreateAgentPayload,
  CreateAgentResponse,
  CreateAgentVersionPayload,
  CreateAgentVersionResponse,
  GetAgentPayload,
  GetAgentResponse,
  ListAgentVersionsPayload,
  ListAgentVersionsResponse,
  ListAgentsPayload,
  ListAgentsResponse,
  UpdateAgentBindingPayload,
  UpdateAgentBindingResponse,
} from './commands.js';

/** Agent catalog RPCs bind each command to its request and response payload. */
export interface AgentCommandContract {
  'agent.get': {
    request: GetAgentPayload;
    response: GetAgentResponse;
  };
  'agent.updateBinding': {
    request: UpdateAgentBindingPayload;
    response: UpdateAgentBindingResponse;
  };
  'agent.list': {
    request: ListAgentsPayload;
    response: ListAgentsResponse;
  };
  'agent.create': {
    request: CreateAgentPayload;
    response: CreateAgentResponse;
  };
  'agent.listVersions': {
    request: ListAgentVersionsPayload;
    response: ListAgentVersionsResponse;
  };
  'agent.createVersion': {
    request: CreateAgentVersionPayload;
    response: CreateAgentVersionResponse;
  };
}

export type AgentCommand = keyof AgentCommandContract;
export type AgentCommandRequest<K extends AgentCommand> = AgentCommandContract[K]['request'];
export type AgentCommandResponse<K extends AgentCommand> = AgentCommandContract[K]['response'];
