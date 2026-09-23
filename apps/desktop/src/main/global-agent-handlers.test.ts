import { describe, expect, it, vi } from 'vitest';
import { registerGlobalAgentHandlers, type GlobalAgentHost } from './global-agent-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { agents: [] };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestGlobalAgent: request as GlobalAgentHost<string>['requestGlobalAgent'],
  };
  registerGlobalAgentHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Global Agent IPC boundary', () => {
  it('registers the mutable Global Agent command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:global-agent-list',
      'runtime:global-agent-create',
      'runtime:global-agent-update',
      'runtime:global-agent-delete',
      'runtime:global-agent-list-workspace-activations',
      'runtime:global-agent-set-workspace-activation',
    ]);
  });

  it.each([
    [
      'runtime:global-agent-list',
      { includeArchived: true },
      'globalAgent.list',
      { includeArchived: true },
    ],
    [
      'runtime:global-agent-create',
      {
        name: ' Reviewer ',
        defaultModelId: ' model-1 ',
        avatar: '=',
        persona: 'Review changes',
        description: 'Code reviewer',
        fallbackModelIds: [' model-2 '],
        skillIds: [' skill-1 '],
        mcpServerIds: [' mcp-1 '],
        reasoningEffort: 'high',
        availabilityScope: 'global',
      },
      'globalAgent.create',
      {
        name: 'Reviewer',
        defaultModelId: 'model-1',
        avatar: '=',
        persona: 'Review changes',
        description: 'Code reviewer',
        fallbackModelIds: ['model-2'],
        skillIds: ['skill-1'],
        mcpServerIds: ['mcp-1'],
        reasoningEffort: 'high',
        availabilityScope: 'global',
      },
    ],
    [
      'runtime:global-agent-update',
      {
        agentId: ' agent-1 ',
        name: ' Reviewer ',
        defaultModelId: ' model-1 ',
        avatar: '=',
        persona: 'Review changes',
        description: 'Code reviewer',
        fallbackModelIds: [' model-2 '],
        skillIds: [' skill-1 '],
        mcpServerIds: [' mcp-1 '],
        reasoningEffort: 'high',
        availabilityScope: 'workspace',
        archived: true,
      },
      'globalAgent.update',
      {
        agentId: 'agent-1',
        name: 'Reviewer',
        defaultModelId: 'model-1',
        avatar: '=',
        persona: 'Review changes',
        description: 'Code reviewer',
        fallbackModelIds: ['model-2'],
        skillIds: ['skill-1'],
        mcpServerIds: ['mcp-1'],
        reasoningEffort: 'high',
        availabilityScope: 'workspace',
        archived: true,
      },
    ],
    [
      'runtime:global-agent-delete',
      { agentId: ' agent-1 ' },
      'globalAgent.delete',
      { agentId: 'agent-1' },
    ],
    [
      'runtime:global-agent-list-workspace-activations',
      { workspaceId: ' workspace-1 ' },
      'globalAgent.listWorkspaceActivations',
      { workspaceId: 'workspace-1' },
    ],
    [
      'runtime:global-agent-set-workspace-activation',
      { agentId: ' agent-1 ', workspaceId: ' workspace-1 ', active: true },
      'globalAgent.setWorkspaceActivation',
      { agentId: 'agent-1', workspaceId: 'workspace-1', active: true },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:global-agent-update')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed list payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:global-agent-list')!('trusted', { includeArchived: 'yes' }),
    ).rejects.toThrow('Invalid list-global-agents payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects malformed workspace activation writes before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:global-agent-set-workspace-activation')!('trusted', {
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        active: 'yes',
      }),
    ).rejects.toThrow('Invalid set-global-agent-workspace-activation payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:global-agent-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:global-agent-delete')!('trusted', {
        agentId: 'agent-1',
      }),
    ).rejects.toBe(failure);
  });
});
