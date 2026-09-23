import { describe, expect, it, vi } from 'vitest';
import { registerAgentHandlers, type AgentHost } from './agent-handlers.js';

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
    requestAgent: request as AgentHost<string>['requestAgent'],
  };
  registerAgentHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Agent catalog IPC boundary', () => {
  it('registers the current Agent catalog command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:agent-get',
      'runtime:agent-update-binding',
      'runtime:agent-list',
      'runtime:agent-create',
      'runtime:agent-list-versions',
      'runtime:agent-create-version',
    ]);
  });

  it.each([
    ['runtime:agent-get', { agentId: 'agent-1' }, 'agent.get', { agentId: 'agent-1' }],
    [
      'runtime:agent-update-binding',
      {
        agentId: 'agent-1',
        defaultModelId: ' model-1 ',
        fallbackModelIds: [' model-2 '],
        skillVersionIds: [' skill-1 '],
      },
      'agent.updateBinding',
      {
        agentId: 'agent-1',
        defaultModelId: 'model-1',
        fallbackModelIds: ['model-2'],
        pauseOnFailure: undefined,
        defaultCredentialGroupId: undefined,
        pinnedCredentialRefId: undefined,
        skillVersionIds: ['skill-1'],
        mcpServerIds: undefined,
      },
    ],
    ['runtime:agent-list', {}, 'agent.list', {}],
    [
      'runtime:agent-create',
      {
        name: 'Reviewer',
        role: 'reviewer',
        developerInstructions: 'Review changes',
        inputContract: 'diff',
        outputContract: 'findings',
        defaultModelId: 'model-1',
      },
      'agent.create',
      {
        name: 'Reviewer',
        role: 'reviewer',
        developerInstructions: 'Review changes',
        inputContract: 'diff',
        outputContract: 'findings',
        defaultModelId: 'model-1',
      },
    ],
    [
      'runtime:agent-list-versions',
      { agentId: 'agent-1' },
      'agent.listVersions',
      { agentId: 'agent-1' },
    ],
    [
      'runtime:agent-create-version',
      {
        agentId: 'agent-1',
        expectedVersion: 1,
        name: 'Reviewer',
        role: 'reviewer',
        developerInstructions: 'Review changes',
        inputContract: 'diff',
        outputContract: 'findings',
        defaultModelId: 'model-1',
        pauseOnFailure: true,
        fallbackModelIds: [],
        memoryScope: 'task',
        skillVersionIds: [],
        mcpServerIds: [],
        approvalMode: 'request',
      },
      'agent.createVersion',
      {
        agentId: 'agent-1',
        expectedVersion: 1,
        name: 'Reviewer',
        role: 'reviewer',
        developerInstructions: 'Review changes',
        inputContract: 'diff',
        outputContract: 'findings',
        defaultModelId: 'model-1',
        pauseOnFailure: true,
        fallbackModelIds: [],
        memoryScope: 'task',
        skillVersionIds: [],
        mcpServerIds: [],
        approvalMode: 'request',
      },
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
    await expect(handlers.get('runtime:agent-update-binding')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:agent-list')!('trusted', { role: 'worker' }),
    ).rejects.toThrow('Invalid agent-list payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects stale or incomplete Agent version writes before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:agent-create-version')!('trusted', {
        agentId: 'agent-1',
        expectedVersion: 0,
      }),
    ).rejects.toThrow('Invalid agent-create-version payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(connectionFixture.handlers.get('runtime:agent-get')!('trusted', {})).rejects.toBe(
      offline,
    );
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(transportFixture.handlers.get('runtime:agent-list')!('trusted', {})).rejects.toBe(
      failure,
    );
  });
});
