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
    // Execution is scoped by Runtime to the originating reply/task. Document
    // delivery and team scheduling do not grant workspace write permission.
    approval: ['collaboration_read_context', 'collaboration_send_message', 'collaboration_dispatch_tasks', 'collaboration_handoff', 'collaboration_start_workflow', 'collaboration_submit_artifact', 'collaboration_report_blocker', 'collaboration_request_login'].includes(schema.name) ? 'never' : 'outside-full-access',
    planningDenied: ['collaboration_start_workflow', 'collaboration_submit_artifact', 'collaboration_dispatch_tasks', 'collaboration_handoff', 'collaboration_report_blocker', 'collaboration_request_login'].includes(schema.name),
  };
}

export const collaborationServer: KernelMcpServerDefinition = {
  name: 'collaboration',
  version: '1.0.0',
  // Loaded only inside collaboration conversations — the runtime injects the
  // `collaborationEnabled` flag via the registry condition override.
  tools: CHAT_COLLABORATION_TOOL_SCHEMAS.map(toTool),
};
