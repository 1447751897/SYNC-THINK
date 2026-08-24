/**
 * `skill-center` server — Skill capability center tools (list/read/import).
 */
import { CHAT_SKILL_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_SKILL_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied = schema.name !== 'list_skills' && schema.name !== 'read_skill';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: planningDenied ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const skillCenterServer: KernelMcpServerDefinition = {
  name: 'skill-center',
  version: '1.0.0',
  tools: CHAT_SKILL_TOOL_SCHEMAS.map(toTool),
};
