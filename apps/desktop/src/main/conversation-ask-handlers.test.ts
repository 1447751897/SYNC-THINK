import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationAskHandlers,
  type ConversationAskHost,
} from './conversation-ask-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { askId: 'ask-1' };
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
    requestConversation: request as ConversationAskHost<string>['requestConversation'],
  };
  registerConversationAskHandlers(host);
  return { handlers, host, order, request, response };
}

describe('conversation Ask IPC boundary', () => {
  it('registers the Ask lifecycle', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:conversation-ask-answer',
      'runtime:conversation-ask-cancel',
      'runtime:conversation-ask-pending',
    ]);
  });

  it.each([
    [
      'runtime:conversation-ask-answer',
      { askId: ' ask-1 ', answers: [{ id: 'question-1', selected: ['Proceed'] }] },
      'conversation.ask.answer',
      { askId: 'ask-1', answers: [{ id: 'question-1', selected: ['Proceed'] }] },
    ],
    [
      'runtime:conversation-ask-cancel',
      { askId: ' ask-1 ' },
      'conversation.ask.cancel',
      { askId: 'ask-1' },
    ],
    [
      'runtime:conversation-ask-pending',
      { threadId: ' thread-1 ' },
      'conversation.ask.pending',
      { threadId: 'thread-1' },
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
      handlers.get('runtime:conversation-ask-answer')!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting invalid answers without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-ask-answer')!('trusted', {
        askId: 'ask-1',
        answers: [],
      }),
    ).rejects.toThrow('Invalid conversation-ask-answer payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid pending queries before transport', async () => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-ask-pending')!('trusted', { threadId: '' }),
    ).rejects.toThrow('Invalid conversation-ask-pending payload');
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-ask-cancel')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:conversation-ask-pending')!('trusted', {
        threadId: 'thread-1',
      }),
    ).rejects.toBe(failure);
  });
});
