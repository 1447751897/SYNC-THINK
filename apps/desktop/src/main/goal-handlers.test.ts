import { describe, expect, it, vi } from 'vitest';
import { registerGoalHandlers, type GoalHost } from './goal-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { goal: undefined };
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
    requestGoal: request as GoalHost<string>['requestGoal'],
  };
  registerGoalHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Goal IPC boundary', () => {
  it('registers the Goal lifecycle command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:goal-set',
      'runtime:goal-get',
      'runtime:goal-clear',
      'runtime:goal-pause',
      'runtime:goal-resume',
    ]);
  });

  it.each([
    [
      'runtime:goal-set',
      {
        conversationId: ' conversation-1 ',
        condition: ' Ship the feature ',
        stopCondition: ' All checks pass ',
        maxGoalRounds: 3,
        maxGoalTokens: 20_000,
        modelId: ' model-1 ',
        kernelId: ' kernel-1 ',
        reasoningEffort: ' high ',
        networkEnabled: true,
      },
      'goal.set',
      {
        conversationId: 'conversation-1',
        condition: 'Ship the feature',
        stopCondition: 'All checks pass',
        maxGoalRounds: 3,
        maxGoalTokens: 20_000,
        modelId: 'model-1',
        kernelId: 'kernel-1',
        reasoningEffort: 'high',
        networkEnabled: true,
      },
    ],
    [
      'runtime:goal-get',
      { conversationId: ' conversation-1 ' },
      'goal.get',
      { conversationId: 'conversation-1' },
    ],
    [
      'runtime:goal-clear',
      { conversationId: ' conversation-1 ' },
      'goal.clear',
      { conversationId: 'conversation-1' },
    ],
    [
      'runtime:goal-pause',
      { conversationId: ' conversation-1 ' },
      'goal.pause',
      { conversationId: 'conversation-1' },
    ],
    [
      'runtime:goal-resume',
      {
        conversationId: ' conversation-1 ',
        modelId: ' model-2 ',
        kernelId: ' kernel-2 ',
        reasoningEffort: ' medium ',
        networkEnabled: false,
      },
      'goal.resume',
      {
        conversationId: 'conversation-1',
        modelId: 'model-2',
        kernelId: 'kernel-2',
        reasoningEffort: 'medium',
        networkEnabled: false,
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
    await expect(handlers.get('runtime:goal-set')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:goal-set', { conversationId: 'conversation-1', condition: '', maxGoalRounds: 0 }],
    ['runtime:goal-get', {}],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid goal-/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:goal-get')!('trusted', {
        conversationId: 'conversation-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:goal-pause')!('trusted', {
        conversationId: 'conversation-1',
      }),
    ).rejects.toBe(failure);
  });
});
