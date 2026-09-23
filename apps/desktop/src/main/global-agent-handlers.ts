import type {
  GlobalAgentCommand,
  GlobalAgentCommandRequest,
  GlobalAgentCommandResponse,
} from '@sync-think/protocol';
import {
  parseCreateGlobalAgentPayload,
  parseDeleteGlobalAgentPayload,
  parseListGlobalAgentsPayload,
  parseListGlobalAgentWorkspaceActivationsPayload,
  parseSetGlobalAgentWorkspaceActivationPayload,
  parseUpdateGlobalAgentPayload,
} from '../team-payloads.js';

export interface GlobalAgentHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestGlobalAgent<K extends GlobalAgentCommand>(
    command: K,
    payload: GlobalAgentCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<GlobalAgentCommandResponse<K>>;
}

export function registerGlobalAgentHandlers<Event>(host: GlobalAgentHost<Event>): void {
  host.handle('runtime:global-agent-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent('globalAgent.list', parseListGlobalAgentsPayload(value));
  });

  host.handle('runtime:global-agent-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent('globalAgent.create', parseCreateGlobalAgentPayload(value));
  });

  host.handle('runtime:global-agent-update', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent('globalAgent.update', parseUpdateGlobalAgentPayload(value));
  });

  host.handle('runtime:global-agent-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent('globalAgent.delete', parseDeleteGlobalAgentPayload(value));
  });

  host.handle('runtime:global-agent-list-workspace-activations', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent(
      'globalAgent.listWorkspaceActivations',
      parseListGlobalAgentWorkspaceActivationsPayload(value),
    );
  });

  host.handle('runtime:global-agent-set-workspace-activation', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGlobalAgent(
      'globalAgent.setWorkspaceActivation',
      parseSetGlobalAgentWorkspaceActivationPayload(value),
    );
  });
}
