import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationPlanHandlers,
  type ConversationPlanHost,
} from './conversation-plan-handlers.js';

const plan = {
  title: 'Implementation plan',
  goal: 'Ship the change',
  scope: [],
  assumptions: [],
  decisions: [],
  steps: [],
  risks: [],
  finalAcceptanceChecks: [],
};

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { plan: undefined };
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
    requestConversation: request as ConversationPlanHost<string>['requestConversation'],
  };
  registerConversationPlanHandlers(host);
  return { handlers, host, order, request, response };
}

describe('conversation Plan IPC boundary', () => {
  it('registers the Plan lifecycle', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:conversation-plan-submit',
      'runtime:conversation-plan-get',
      'runtime:conversation-plan-approve',
      'runtime:conversation-plan-revise',
      'runtime:conversation-plan-cancel',
    ]);
  });

  it.each([
    [
      'runtime:conversation-plan-submit',
      { conversationId: ' conversation-1 ', plan },
      'conversation.plan.submit',
      { conversationId: 'conversation-1', plan },
    ],
    [
      'runtime:conversation-plan-get',
      { conversationId: ' conversation-1 ' },
      'conversation.plan.get',
      { conversationId: 'conversation-1' },
    ],
    [
      'runtime:conversation-plan-approve',
      { conversationId: ' conversation-1 ', revision: 2 },
      'conversation.plan.approve',
      { conversationId: 'conversation-1', revision: 2 },
    ],
    [
      'runtime:conversation-plan-revise',
      { conversationId: ' conversation-1 ', expectedRevision: 2, plan },
      'conversation.plan.revise',
      { conversationId: 'conversation-1', expectedRevision: 2, plan },
    ],
    [
      'runtime:conversation-plan-cancel',
      { conversationId: ' conversation-1 ' },
      'conversation.plan.cancel',
      { conversationId: 'conversation-1' },
    ],
  ])(
    'forwards %s through the typed conversation transport',
    async (channel, value, command, payload) => {
      const { handlers, order, request, response } = fixture();
      await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
      expect(request).toHaveBeenCalledWith(command, payload);
      expect(order).toEqual(['source', 'connect', `request:${command}`]);
    },
  );

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('runtime:conversation-plan-revise')!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting incomplete plan content without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-plan-submit')!('trusted', {
        conversationId: 'conversation-1',
        plan: { title: 'Incomplete' },
      }),
    ).rejects.toThrow('Invalid conversation-plan-submit payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid approval revisions before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-plan-approve')!('trusted', {
        conversationId: 'conversation-1',
        revision: '2',
      }),
    ).rejects.toThrow('Invalid conversation-plan-approve payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-plan-get')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:conversation-plan-cancel')!('trusted', {
        conversationId: 'conversation-1',
      }),
    ).rejects.toBe(failure);
  });
});
