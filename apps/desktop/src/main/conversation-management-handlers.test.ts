import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationManagementHandlers,
  type ConversationManagementHost,
} from './conversation-management-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { conversations: [] };
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
    requestConversation: request as ConversationManagementHost<string>['requestConversation'],
  };
  registerConversationManagementHandlers(host);
  return { handlers, host, order, request, response };
}

describe('conversation management IPC boundary', () => {
  it('registers the conversation catalog lifecycle', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:conversation-list',
      'runtime:conversation-create',
      'runtime:conversation-rename',
      'runtime:conversation-set-pinned',
      'runtime:conversation-set-archived',
      'runtime:conversation-delete',
    ]);
  });

  it.each([
    [
      'runtime:conversation-list',
      {
        track: 'agent',
        workspaceId: ' workspace-1 ',
        includeArchived: true,
        cursor: 'cursor-1',
        limit: 100,
      },
      'conversation.list',
      {
        track: 'agent',
        workspaceId: 'workspace-1',
        includeArchived: true,
        cursor: 'cursor-1',
        limit: 100,
      },
    ],
    [
      'runtime:conversation-create',
      {
        track: 'agent',
        targetRef: ' agent-1 ',
        workspaceId: ' workspace-1 ',
        title: 'Review',
        executionMode: 'full-access',
      },
      'conversation.create',
      {
        track: 'agent',
        targetRef: 'agent-1',
        workspaceId: 'workspace-1',
        title: 'Review',
        executionMode: 'full-access',
      },
    ],
    [
      'runtime:conversation-rename',
      { conversationId: ' conversation-1 ', title: ' Renamed ' },
      'conversation.rename',
      { conversationId: 'conversation-1', title: 'Renamed' },
    ],
    [
      'runtime:conversation-set-pinned',
      { conversationId: ' conversation-1 ', pinned: true },
      'conversation.setPinned',
      { conversationId: 'conversation-1', pinned: true },
    ],
    [
      'runtime:conversation-set-archived',
      { conversationId: ' conversation-1 ', archived: true },
      'conversation.setArchived',
      { conversationId: 'conversation-1', archived: true },
    ],
    [
      'runtime:conversation-delete',
      { conversationId: ' conversation-1 ' },
      'conversation.delete',
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
    await expect(handlers.get('runtime:conversation-rename')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed catalog payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-list')!('trusted', { track: 'invalid' }),
    ).rejects.toThrow('Invalid list-conversations payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects incomplete metadata writes before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-set-pinned')!('trusted', {
        conversationId: 'conversation-1',
      }),
    ).rejects.toThrow('Invalid set-conversation-pinned payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:conversation-delete')!('trusted', {
        conversationId: 'conversation-1',
      }),
    ).rejects.toBe(failure);
  });
});
