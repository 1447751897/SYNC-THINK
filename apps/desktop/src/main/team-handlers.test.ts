import { describe, expect, it, vi } from 'vitest';
import { registerTeamHandlers, type TeamHost } from './team-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { teams: [] };
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
    requestTeam: request as TeamHost<string>['requestTeam'],
  };
  registerTeamHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Team IPC boundary', () => {
  it('registers the Team catalog and run-control command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:team-list',
      'runtime:team-create',
      'runtime:team-update',
      'runtime:team-delete',
      'runtime:team-start-run',
      'runtime:team-set-run-status',
    ]);
  });

  it.each([
    ['runtime:team-list', undefined, 'team.list', {}],
    [
      'runtime:team-create',
      {
        name: ' Review Team ',
        avatar: 'RT',
        mission: 'Review changes',
        strategy: 'parallel',
        coordinatorAgentId: ' agent-1 ',
        members: [
          {
            agentId: ' agent-1 ',
            role: 'reviewer',
            title: 'Lead',
            dependsOn: [' agent-2 '],
          },
        ],
      },
      'team.create',
      {
        name: 'Review Team',
        avatar: 'RT',
        mission: 'Review changes',
        strategy: 'parallel',
        coordinatorAgentId: 'agent-1',
        members: [
          {
            agentId: 'agent-1',
            role: 'reviewer',
            title: 'Lead',
            dependsOn: ['agent-2'],
          },
        ],
      },
    ],
    [
      'runtime:team-update',
      {
        teamId: ' team-1 ',
        name: ' Review Team ',
        avatar: 'RT',
        mission: 'Review changes',
        strategy: 'serial',
        coordinatorAgentId: ' agent-1 ',
        members: [],
      },
      'team.update',
      {
        teamId: 'team-1',
        name: 'Review Team',
        avatar: 'RT',
        mission: 'Review changes',
        strategy: 'serial',
        coordinatorAgentId: 'agent-1',
        members: [],
      },
    ],
    ['runtime:team-delete', { teamId: ' team-1 ' }, 'team.delete', { teamId: 'team-1' }],
    [
      'runtime:team-start-run',
      { teamId: ' team-1 ', conversationId: ' conversation-1 ' },
      'team.startRun',
      { teamId: 'team-1', conversationId: 'conversation-1' },
    ],
    [
      'runtime:team-set-run-status',
      { runId: ' run-1 ', status: 'completed' },
      'team.setRunStatus',
      { runId: 'run-1', status: 'completed' },
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
    await expect(handlers.get('runtime:team-update')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed Team definitions without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:team-create')!('trusted', {
        name: 'Review Team',
        strategy: 'random',
      }),
    ).rejects.toThrow('Invalid create-team payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid run states before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:team-set-run-status')!('trusted', {
        runId: 'run-1',
        status: 'paused',
      }),
    ).rejects.toThrow('Invalid set-team-run-status payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:team-list')!('trusted', undefined),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:team-delete')!('trusted', { teamId: 'team-1' }),
    ).rejects.toBe(failure);
  });
});
