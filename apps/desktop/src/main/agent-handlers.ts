import type { AgentCommand, AgentCommandRequest, AgentCommandResponse } from '@sync-think/protocol';
import { parseGetAgentPayload, parseUpdateAgentBindingPayload } from '../agent-payloads.js';
import {
  parseAgentCreatePayload,
  parseAgentCreateVersionPayload,
  parseAgentListPayload,
  parseAgentVersionsPayload,
} from '../orchestration-payloads.js';

export interface AgentHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestAgent<K extends AgentCommand>(
    command: K,
    payload: AgentCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<AgentCommandResponse<K>>;
}

export function registerAgentHandlers<Event>(host: AgentHost<Event>): void {
  host.handle('runtime:agent-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.get', parseGetAgentPayload(value));
  });

  host.handle('runtime:agent-update-binding', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.updateBinding', parseUpdateAgentBindingPayload(value));
  });

  host.handle('runtime:agent-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.list', parseAgentListPayload(value));
  });

  host.handle('runtime:agent-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.create', parseAgentCreatePayload(value));
  });

  host.handle('runtime:agent-list-versions', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.listVersions', parseAgentVersionsPayload(value));
  });

  host.handle('runtime:agent-create-version', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestAgent('agent.createVersion', parseAgentCreateVersionPayload(value));
  });
}
