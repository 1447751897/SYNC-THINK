/**
 * `agent-library` server — Agent Library CRUD tools.
 *
 * Schemas are reused verbatim from `chat-tools.ts` (single source of truth);
 * executors live in the runtime (native tool loop already handles these names).
 */
import { CHAT_AGENT_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_AGENT_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied =
    schema.name === 'create_agent' ||
    schema.name === 'update_agent' ||
    schema.name === 'archive_agent';
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
  tools: CHAT_AGENT_TOOL_SCHEMAS.map(toTool),
};
