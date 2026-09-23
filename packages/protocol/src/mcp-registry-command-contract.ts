import type {
  DeleteMcpServerPayload,
  DeleteMcpServerResponse,
  ListMcpServersPayload,
  ListMcpServersResponse,
  RegisterMcpServerPayload,
  RegisterMcpServerResponse,
  RegisterRemoteMcpPayload,
  RegisterRemoteMcpResponse,
  SetMcpServerEnabledPayload,
  SetMcpServerEnabledResponse,
} from './commands.js';

/** MCP server registry lifecycle RPCs. */
export interface McpRegistryCommandContract {
  'mcp.register': { request: RegisterMcpServerPayload; response: RegisterMcpServerResponse };
  'mcp.registerRemote': {
    request: RegisterRemoteMcpPayload;
    response: RegisterRemoteMcpResponse;
  };
  'mcp.list': { request: ListMcpServersPayload; response: ListMcpServersResponse };
  'mcp.setEnabled': {
    request: SetMcpServerEnabledPayload;
    response: SetMcpServerEnabledResponse;
  };
  'mcp.delete': { request: DeleteMcpServerPayload; response: DeleteMcpServerResponse };
}

export type McpRegistryCommand = keyof McpRegistryCommandContract;
export type McpRegistryCommandRequest<K extends McpRegistryCommand> =
  McpRegistryCommandContract[K]['request'];
export type McpRegistryCommandResponse<K extends McpRegistryCommand> =
  McpRegistryCommandContract[K]['response'];
