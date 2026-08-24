/**
 * `team-library` server — Team Library CRUD tools.
 */
import { CHAT_TEAM_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_TEAM_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied =
    schema.name === 'create_team' || schema.name === 'update_team' || schema.name === 'delete_team';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: planningDenied ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const teamLibraryServer: KernelMcpServerDefinition = {
  name: 'team-library',
  version: '1.0.0',
  tools: CHAT_TEAM_TOOL_SCHEMAS.map(toTool),
};
