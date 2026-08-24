/**
 * `task-board` server — persisted task checklist tools.
 */
import { CHAT_PLAN_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_PLAN_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied =
    schema.name === 'TaskCreate' ||
    schema.name === 'TaskUpdate' ||
    schema.name === 'update_task_plan';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: 'never',
    planningDenied,
  };
}

export const taskBoardServer: KernelMcpServerDefinition = {
  name: 'task-board',
  version: '1.0.0',
  tools: CHAT_PLAN_TOOL_SCHEMAS.map(toTool),
};
