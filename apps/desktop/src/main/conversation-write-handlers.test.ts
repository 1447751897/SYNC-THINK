import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationWriteHandlers,
  type ConversationWriteHost,
  type PersistedAppendMessageImage,
  type StagedAppendMessageImage,
} from './conversation-write-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const appendResponse = { messageId: 'message-1', taskVersion: 4 };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return command === 'task.appendMessage'
      ? appendResponse
      : { command, result: 'transport response' };
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      expect(handlers.has(channel)).toBe(false);
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    stageAppendMessageImages: vi.fn((value: unknown) => {
      order.push('stage');
      return { payload: value, images: [] as StagedAppendMessageImage[] };
    }),
    persistMessageImages: vi.fn((): PersistedAppendMessageImage[] => {
      order.push('persist');
      return [];
    }),
    requestConversation: request as ConversationWriteHost<string>['requestConversation'],
  };
  registerConversationWriteHandlers(host);
  return { handlers, host, order, request, appendResponse };
}

const appendPayload = {
  threadId: 'thread-1',
  expectedTaskVersion: 3,
  role: 'user',
  text: 'hello',
};

describe('conversation write IPC boundary', () => {
  it('registers and forwards all write commands with their existing ordering and timeout', async () => {
    const { handlers, host, order, request, appendResponse } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:append-message',
      'runtime:conversation-send-message',
      'runtime:conversation-compact',
    ]);

    expect(await handlers.get('runtime:append-message')!('trusted', appendPayload)).toBe(
      appendResponse,
    );
    expect(request).toHaveBeenLastCalledWith('task.appendMessage', appendPayload);
    expect(order).toEqual(['source', 'connect', 'stage', 'request:task.appendMessage']);

    order.length = 0;
    await handlers.get('runtime:conversation-send-message')!('trusted', {
      conversationId: 'conversation-1',
      text: 'send',
    });
    expect(request).toHaveBeenLastCalledWith('conversation.sendMessage', {
      conversationId: 'conversation-1',
      text: 'send',
      modelId: undefined,
    });
    expect(order).toEqual(['source', 'connect', 'request:conversation.sendMessage']);

    order.length = 0;
    await handlers.get('runtime:conversation-compact')!('trusted', {
      conversationId: 'conversation-1',
      mode: 'manual',
    });
    expect(request).toHaveBeenLastCalledWith(
      'conversation.compact',
      expect.objectContaining({ conversationId: 'conversation-1', mode: 'manual' }),
      { timeoutMs: 120_000 },
    );
    expect(order).toEqual(['source', 'connect', 'request:conversation.compact']);
    expect(host.assertSource).toHaveBeenCalledTimes(3);
  });

  it('persists staged images, attaches durable refs, and returns their local URLs', async () => {
    const { handlers, host, order, request } = fixture();
    const staged = { name: 'screen.png', mimeType: 'image/png', stagingPath: 'D:/tmp/screen.png' };
    host.stageAppendMessageImages.mockReturnValue({
      payload: { ...appendPayload, images: [staged] },
      images: [staged],
    });
    host.persistMessageImages.mockImplementation(() => {
      order.push('persist');
      return [{
        id: 'image-1',
        name: 'screen.png',
        mimeType: 'image/png',
        storageRef: 'image-1.png',
        url: 'sync-think-message-image://image-1.png',
      }];
    });

    await expect(
      handlers.get('runtime:append-message')!('trusted', appendPayload),
    ).resolves.toEqual({
      messageId: 'message-1',
      taskVersion: 4,
      images: [expect.objectContaining({ id: 'image-1', url: expect.any(String) })],
    });
    expect(host.persistMessageImages).toHaveBeenCalledWith('message-1', [staged]);
    expect(request).toHaveBeenCalledWith('message.attachImages', {
      threadId: 'thread-1',
      messageId: 'message-1',
      images: [{
        id: 'image-1',
        name: 'screen.png',
        mimeType: 'image/png',
        storageRef: 'image-1.png',
      }],
    });
    expect(order).toEqual([
      'source',
      'connect',
      'request:task.appendMessage',
      'persist',
      'request:message.attachImages',
    ]);
  });

  it('does not attach an event when no staged image survives persistence', async () => {
    const { handlers, host, request } = fixture();
    const staged = { name: 'gone.png', mimeType: 'image/png', stagingPath: 'D:/tmp/gone.png' };
    host.stageAppendMessageImages.mockReturnValue({
      payload: { ...appendPayload, images: [staged] },
      images: [staged],
    });
    await handlers.get('runtime:append-message')!('trusted', appendPayload);
    expect(host.persistMessageImages).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith('message.attachImages', expect.anything());
  });

  it.each([
    ['runtime:append-message', appendPayload],
    ['runtime:conversation-send-message', { conversationId: 'conversation-1', text: 'send' }],
    ['runtime:conversation-compact', { conversationId: 'conversation-1' }],
  ])('rejects an untrusted %s call before connection or transport', async (channel, payload) => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get(channel)!('untrusted', payload)).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'runtime:append-message',
    'runtime:conversation-send-message',
    'runtime:conversation-compact',
  ])('rejects malformed %s requests without invoking transport', async (channel) => {
    const { handlers, request } = fixture();
    await expect(handlers.get(channel)!('trusted', null)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection, transport, and attachment failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:append-message')!('trusted', appendPayload),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const stale = new Error('stale task version');
    transportFixture.request.mockRejectedValue(stale);
    await expect(
      transportFixture.handlers.get('runtime:append-message')!('trusted', appendPayload),
    ).rejects.toBe(stale);

    const attachmentFixture = fixture();
    const staged = { name: 'screen.png', mimeType: 'image/png', stagingPath: 'D:/tmp/screen.png' };
    attachmentFixture.host.stageAppendMessageImages.mockReturnValue({
      payload: { ...appendPayload, images: [staged] },
      images: [staged],
    });
    attachmentFixture.host.persistMessageImages.mockReturnValue([{
      id: 'image-1',
      name: 'screen.png',
      mimeType: 'image/png',
      storageRef: 'image-1.png',
      url: 'sync-think-message-image://image-1.png',
    }]);
    const attachFailure = new Error('attachment event failed');
    attachmentFixture.request.mockImplementation(async (command: string) => {
      if (command === 'message.attachImages') throw attachFailure;
      return attachmentFixture.appendResponse;
    });
    await expect(
      attachmentFixture.handlers.get('runtime:append-message')!('trusted', appendPayload),
    ).rejects.toBe(attachFailure);
  });
});
