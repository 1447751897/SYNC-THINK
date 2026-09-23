import type {
  McpRegistryCommand,
  McpRegistryCommandRequest,
  McpRegistryCommandResponse,
} from '@sync-think/protocol';
import {
  parseDeleteMcpServerPayload,
  parseListMcpServersPayload,
  parseRegisterMcpServerPayload,
  parseRegisterRemoteMcpPayload,
  parseSetMcpServerEnabledPayload,
} from '../mcp-registry-payloads.js';

export interface McpRegistryHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestMcpRegistry<K extends McpRegistryCommand>(
    command: K,
    payload: McpRegistryCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<McpRegistryCommandResponse<K>>;
}

export function registerMcpRegistryHandlers<Event>(host: McpRegistryHost<Event>): void {
  host.handle('runtime:mcp-register', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpRegistry('mcp.register', parseRegisterMcpServerPayload(value));
  });

  host.handle('runtime:mcp-register-remote', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpRegistry('mcp.registerRemote', parseRegisterRemoteMcpPayload(value));
  });

  host.handle('runtime:mcp-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpRegistry('mcp.list', parseListMcpServersPayload(value));
  });

  host.handle('runtime:mcp-set-enabled', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpRegistry('mcp.setEnabled', parseSetMcpServerEnabledPayload(value));
  });

  host.handle('runtime:mcp-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMcpRegistry('mcp.delete', parseDeleteMcpServerPayload(value));
  });
}
