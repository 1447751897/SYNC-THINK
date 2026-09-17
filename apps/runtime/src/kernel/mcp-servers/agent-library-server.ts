/**
 * `agent-library` server — Sync-Think Agent Directory tools.
 *
 * Schemas are reused verbatim from `chat-tools.ts` (single source of truth);
 * External kernels may query and run existing Agents; Agent Library mutations
 * stay in the native host loop where approval cards and UI control apply.
 */
import { CHAT_AGENT_DIRECTORY_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_AGENT_DIRECTORY_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied = false;
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: planningDenied ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const agentLibraryServer: KernelMcpServerDefinition = {
  name: 'agent-library',
  version: '1.0.0',
  // Loaded when the global agent store exists (runtime checks via condition
  // override in the registry — see KERNEL_MCP_SERVERS wiring).
  tools: CHAT_AGENT_DIRECTORY_TOOL_SCHEMAS.map(toTool),
};
