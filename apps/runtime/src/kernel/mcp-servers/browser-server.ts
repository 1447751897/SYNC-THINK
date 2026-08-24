/**
 * `browser` server — system-browser automation tools (联网开启时加载).
 */
import { CHAT_BROWSER_TOOL_SCHEMAS } from '../../chat-tools.js';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

function toTool(schema: (typeof CHAT_BROWSER_TOOL_SCHEMAS)[number]): KernelMcpToolDefinition {
  const planningDenied = schema.name === 'browser_click' || schema.name === 'browser_type';
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: planningDenied ? 'outside-full-access' : 'never',
    planningDenied,
  };
}

export const browserServer: KernelMcpServerDefinition = {
  name: 'browser',
  version: '1.0.0',
  tools: CHAT_BROWSER_TOOL_SCHEMAS.map(toTool),
};
