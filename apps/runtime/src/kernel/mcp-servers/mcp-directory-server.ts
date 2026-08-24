/**
 * `mcp-directory` server — MCP catalog + remote registry tools.
 */
import { CHAT_MCP_CATALOG_TOOL_SCHEMAS, CHAT_MCP_REGISTRY_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

const ALL = [...CHAT_MCP_CATALOG_TOOL_SCHEMAS, ...CHAT_MCP_REGISTRY_TOOL_SCHEMAS];

function toTool(schema: (typeof ALL)[number]): KernelMcpToolDefinition {
  const planningDenied = schema.name === 'register_remote_mcp';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: planningDenied ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const mcpDirectoryServer: KernelMcpServerDefinition = {
  name: 'mcp-directory',
  version: '1.0.0',
  tools: ALL.map(toTool),
};
