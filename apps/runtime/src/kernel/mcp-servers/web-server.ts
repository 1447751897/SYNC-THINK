/** Network search/fetch servers. They are split so native search does not get
 * a second, ambiguous `web_search` while known-URL retrieval remains usable. */
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

export const webSearchServer: KernelMcpServerDefinition = {
  name: 'web-search',
  version: '1.0.0',
  tools: CHAT_NETWORK_TOOL_SCHEMAS.filter((schema) => schema.name === 'web_search').map(toTool),
};

export const webFetchServer: KernelMcpServerDefinition = {
  name: 'web-fetch',
  version: '1.0.0',
  tools: CHAT_NETWORK_TOOL_SCHEMAS.filter((schema) => schema.name === 'web_fetch').map(toTool),
};

/** @deprecated Import the split servers instead. */
export const webServer = webSearchServer;
