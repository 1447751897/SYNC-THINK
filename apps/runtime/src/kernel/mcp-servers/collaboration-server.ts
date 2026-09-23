/**
 * `collaboration` server — structured collaboration conversation tools
 * (agent-to-agent messaging + task dispatch).
 *
 * Schemas are reused verbatim from `chat-tools.ts` (single source of truth).
 * The registry gates this server on `collaborationEnabled` (a bound
 * collaboration conversation) and the per-run track filter; the host executor
 * still requires the same binding and injects the sender identity.
 */
import { CHAT_COLLABORATION_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(
  schema: (typeof CHAT_COLLABORATION_TOOL_SCHEMAS)[number],
): KernelMcpToolDefinition {
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    // Native parity: `chatToolRequiresApproval` classifies both tools as
    // approval-gated outside full-access (they mutate the collaboration
    // conversation), and neither is part of PLANNING_MODE_DENIED_TOOLS today.
    approval: 'outside-full-access',
    planningDenied: false,
  };
}

export const collaborationServer: KernelMcpServerDefinition = {
  name: 'collaboration',
  version: '1.0.0',
  // Loaded only inside collaboration conversations — the runtime injects the
  // `collaborationEnabled` flag via the registry condition override.
  tools: CHAT_COLLABORATION_TOOL_SCHEMAS.map(toTool),
};
