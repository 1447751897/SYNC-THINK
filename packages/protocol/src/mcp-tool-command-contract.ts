import type {
  CallMcpToolPayload,
  CallMcpToolResponse,
  ProbeMcpPolicyPayload,
  ProbeMcpPolicyResponse,
  ProbeMcpSpawnPayload,
  ProbeMcpSpawnResponse,
  RefreshMcpToolsPayload,
  RefreshMcpToolsResponse,
  RequestMcpToolPayload,
  RequestMcpToolResponse,
} from './commands.js';

/** MCP tool policy, execution and catalog-refresh RPCs. */
export interface McpToolCommandContract {
  'mcp.policy.probe': { request: ProbeMcpPolicyPayload; response: ProbeMcpPolicyResponse };
  'mcp.tool.request': { request: RequestMcpToolPayload; response: RequestMcpToolResponse };
  'mcp.spawn.probe': { request: ProbeMcpSpawnPayload; response: ProbeMcpSpawnResponse };
  'mcp.tool.call': { request: CallMcpToolPayload; response: CallMcpToolResponse };
  'mcp.tools.refresh': { request: RefreshMcpToolsPayload; response: RefreshMcpToolsResponse };
}

export type McpToolCommand = keyof McpToolCommandContract;
export type McpToolCommandRequest<K extends McpToolCommand> = McpToolCommandContract[K]['request'];
export type McpToolCommandResponse<K extends McpToolCommand> =
  McpToolCommandContract[K]['response'];
