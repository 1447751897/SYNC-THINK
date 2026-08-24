/**
 * `web` server — network search/fetch tools (联网开启时加载).
 */
import { CHAT_NETWORK_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_NETWORK_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: 'never',
  };
}

export const webServer: KernelMcpServerDefinition = {
  name: 'web',
  version: '1.0.0',
  tools: CHAT_NETWORK_TOOL_SCHEMAS.map(toTool),
};
