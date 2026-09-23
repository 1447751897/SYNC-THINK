import type {
  McpToolCommand,
  McpToolCommandRequest,
  McpToolCommandResponse,
} from '@sync-think/protocol';
import {
  parseCallMcpToolPayload,
  parseProbeMcpPolicyPayload,
  parseProbeMcpSpawnPayload,
  parseRefreshMcpToolsPayload,
  parseRequestMcpToolPayload,
} from '../mcp-tool-payloads.js';

export interface McpToolHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestMcpTool<K extends McpToolCommand>(
    command: K,
    payload: McpToolCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<McpToolCommandResponse<K>>;
}

export function registerMcpToolHandlers<Event>(host: McpToolHost<Event>): void {
  host.handle('runtime:mcp-policy-probe', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpTool('mcp.policy.probe', parseProbeMcpPolicyPayload(value));
  });

  host.handle('runtime:mcp-tool-request', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpTool('mcp.tool.request', parseRequestMcpToolPayload(value));
  });

  host.handle('runtime:mcp-spawn-probe', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpTool('mcp.spawn.probe', parseProbeMcpSpawnPayload(value));
  });

  host.handle('runtime:mcp-tool-call', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpTool('mcp.tool.call', parseCallMcpToolPayload(value));
  });

  host.handle('runtime:mcp-tools-refresh', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpTool('mcp.tools.refresh', parseRefreshMcpToolsPayload(value));
  });
}
