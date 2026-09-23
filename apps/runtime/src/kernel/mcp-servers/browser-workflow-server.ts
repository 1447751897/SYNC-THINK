/**
 * `browser-workflow` server: local Browser Automation task metadata and replay.
 * It is independent from live web access, so it remains available when the
 * conversation's networking switch is off.
 */
import { CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(
  schema: (typeof CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS)[number],
): KernelMcpToolDefinition {
  const planningDenied =
    schema.name === 'browser_workflow_create_draft' || schema.name === 'browser_workflow_execute';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: schema.name === 'browser_workflow_create_draft' ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const browserWorkflowServer: KernelMcpServerDefinition = {
  name: 'browser-workflow',
  version: '1.0.0',
  alwaysLoad: true,
  tools: CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS.map(toTool),
};
