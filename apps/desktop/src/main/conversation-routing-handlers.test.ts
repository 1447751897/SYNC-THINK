import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationRoutingHandlers,
  type ConversationRoutingHost,
} from './conversation-routing-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { conversation: { id: 'conversation-1' } };
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
    requestConversation: request as ConversationRoutingHost<string>['requestConversation'],
  };
  registerConversationRoutingHandlers(host);
  return { handlers, host, order, request, response };
}

describe('conversation routing IPC boundary', () => {
  it('registers execution and target routing commands', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:conversation-set-execution-mode',
      'runtime:conversation-set-interaction-mode',
      'runtime:conversation-set-context-window-override',
      'runtime:conversation-upgrade-track',
      'runtime:conversation-rebind-target',
    ]);
  });

  it.each([
    [
      'runtime:conversation-set-execution-mode',
      { conversationId: ' conversation-1 ', executionMode: ' full-access ' },
      'conversation.setExecutionMode',
      { conversationId: 'conversation-1', executionMode: 'full-access' },
    ],
    [
      'runtime:conversation-set-interaction-mode',
      { conversationId: ' conversation-1 ', interactionMode: 'plan' },
      'conversation.setInteractionMode',
      { conversationId: 'conversation-1', interactionMode: 'plan' },
    ],
    [
      'runtime:conversation-set-context-window-override',
      { conversationId: ' conversation-1 ', contextWindowOverride: 32_768 },
      'conversation.setContextWindowOverride',
      { conversationId: 'conversation-1', contextWindowOverride: 32_768 },
    ],
    [
      'runtime:conversation-upgrade-track',
      { conversationId: ' conversation-1 ', track: 'agent', targetRef: ' agent-1 ' },
      'conversation.upgradeTrack',
      { conversationId: 'conversation-1', track: 'agent', targetRef: 'agent-1' },
    ],
    [
      'runtime:conversation-rebind-target',
      { conversationId: ' conversation-1 ', track: 'model', targetRef: ' model-1 ' },
      'conversation.rebindTarget',
      { conversationId: 'conversation-1', track: 'model', targetRef: 'model-1' },
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
      handlers.get('runtime:conversation-rebind-target')!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting invalid interaction modes without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-set-interaction-mode')!('trusted', {
        conversationId: 'conversation-1',
        interactionMode: 'chat',
      }),
    ).rejects.toThrow('Invalid set-conversation-interaction-mode payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid context window overrides before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-set-context-window-override')!('trusted', {
        conversationId: 'conversation-1',
        contextWindowOverride: 512,
      }),
    ).rejects.toThrow('Invalid set-conversation-context-window-override payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-set-execution-mode')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:conversation-rebind-target')!('trusted', {
        conversationId: 'conversation-1',
        track: 'model',
        targetRef: 'model-1',
      }),
    ).rejects.toBe(failure);
  });
});
