import type {
  ConversationTransientFrame,
  ConversationTransientSnapshot,
} from '@sync-think/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationTransientHandlers,
  type ConversationTransientHost,
} from './conversation-transient-handlers.js';

interface TestEvent {
  senderId: number;
}

function fixture() {
  const handlers = new Map<
    string,
    (event: TestEvent, value: unknown) => Promise<unknown>
  >();
  const destroyedListeners = new Map<number, () => void>();
  const order: string[] = [];
  const host: ConversationTransientHost<TestEvent> = {
    handle: (channel, listener) => {
      expect(handlers.has(channel)).toBe(false);
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    senderId: vi.fn((event) => event.senderId),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    subscribe: vi.fn(async () => {
      order.push('subscribe');
    }),
    unsubscribe: vi.fn(async () => {
      order.push('unsubscribe');
    }),
    unsubscribeForSender: vi.fn(async () => {
      order.push('unsubscribe-sender');
    }),
    onSenderDestroyed: vi.fn((event, listener) => {
      order.push('watch-destroyed');
      destroyedListeners.set(event.senderId, listener);
    }),
    sendToSender: vi.fn(),
  };
  registerConversationTransientHandlers(host);
  return { handlers, host, destroyedListeners, order };
}

const subscription = {
  threadId: 'thread-1',
  subscriptionId: 'subscription-1',
  afterStreamSequence: 12,
};

describe('conversation transient IPC boundary', () => {
  it('subscribes after validation and connection, then registers one sender cleanup', async () => {
    const { handlers, host, order } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:conversation-subscribe-transient',
      'runtime:conversation-unsubscribe-transient',
    ]);

    await expect(
      handlers.get('runtime:conversation-subscribe-transient')!({ senderId: 7 }, subscription),
    ).resolves.toEqual({ subscriptionId: 'subscription-1' });
    expect(host.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 7,
      subscriptionId: 'subscription-1',
      threadId: 'thread-1',
      afterStreamSequence: 12,
      listener: expect.any(Function),
      snapshotListener: expect.any(Function),
    }));
    expect(order).toEqual(['source', 'connect', 'subscribe', 'watch-destroyed']);

    order.length = 0;
    await handlers.get('runtime:conversation-subscribe-transient')!({ senderId: 7 }, {
      ...subscription,
      subscriptionId: 'subscription-2',
    });
    expect(host.onSenderDestroyed).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['source', 'connect', 'subscribe']);
  });

  it('routes frames and snapshots back to the event sender without inventing an empty snapshot', async () => {
    const { handlers, host } = fixture();
    const event = { senderId: 7 };
    await handlers.get('runtime:conversation-subscribe-transient')!(event, subscription);
    const input = vi.mocked(host.subscribe).mock.calls[0]![0];
    const frame = {
      streamId: 'stream-1',
      streamSequence: 13,
      kind: 'assistant_delta',
      payload: { text: 'hello' },
    } as unknown as ConversationTransientFrame;
    const snapshot = {
      streamId: 'stream-1',
      latestStreamSequence: 13,
    } as unknown as ConversationTransientSnapshot;

    input.listener(frame);
    input.snapshotListener(13, snapshot);
    input.snapshotListener(14, undefined);

    expect(host.sendToSender).toHaveBeenNthCalledWith(1, event, 'subscription-1', {
      type: 'frame',
      frame,
    });
    expect(host.sendToSender).toHaveBeenNthCalledWith(2, event, 'subscription-1', {
      type: 'reset',
      latestStreamSequence: 13,
      snapshot,
    });
    expect(host.sendToSender).toHaveBeenNthCalledWith(3, event, 'subscription-1', {
      type: 'reset',
      latestStreamSequence: 14,
    });
  });

  it('cleans every sender subscription on destruction and permits sender-id reuse', async () => {
    const { handlers, host, destroyedListeners } = fixture();
    const event = { senderId: 7 };
    await handlers.get('runtime:conversation-subscribe-transient')!(event, subscription);
    destroyedListeners.get(7)!();
    expect(host.unsubscribeForSender).toHaveBeenCalledWith(7);

    await handlers.get('runtime:conversation-subscribe-transient')!(event, {
      ...subscription,
      subscriptionId: 'subscription-2',
    });
    expect(host.onSenderDestroyed).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes by sender and subscription without opening a connection', async () => {
    const { handlers, host, order } = fixture();
    await expect(
      handlers.get('runtime:conversation-unsubscribe-transient')!({ senderId: 9 }, {
        subscriptionId: 'subscription-1',
      }),
    ).resolves.toEqual({ subscriptionId: 'subscription-1' });
    expect(host.unsubscribe).toHaveBeenCalledWith(9, 'subscription-1');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(order).toEqual(['source', 'unsubscribe']);
  });

  it.each([
    ['runtime:conversation-subscribe-transient', subscription],
    ['runtime:conversation-unsubscribe-transient', { subscriptionId: 'subscription-1' }],
  ])('rejects an untrusted %s call before session work', async (channel, payload) => {
    const { handlers, host } = fixture();
    vi.mocked(host.assertSource).mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get(channel)!({ senderId: 7 }, payload)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(host.subscribe).not.toHaveBeenCalled();
    expect(host.unsubscribe).not.toHaveBeenCalled();
  });

  it.each([
    'runtime:conversation-subscribe-transient',
    'runtime:conversation-unsubscribe-transient',
  ])('rejects malformed %s requests before session work', async (channel) => {
    const { handlers, host } = fixture();
    await expect(handlers.get(channel)!({ senderId: 7 }, null)).rejects.toThrow();
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(host.subscribe).not.toHaveBeenCalled();
    expect(host.unsubscribe).not.toHaveBeenCalled();
  });

  it('does not register a lifecycle listener when connection or subscribe fails', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    vi.mocked(connectionFixture.host.ensureConnection).mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-subscribe-transient')!(
        { senderId: 7 },
        subscription,
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.host.onSenderDestroyed).not.toHaveBeenCalled();

    const subscribeFixture = fixture();
    const rejected = new Error('subscribe rejected');
    vi.mocked(subscribeFixture.host.subscribe).mockRejectedValue(rejected);
    await expect(
      subscribeFixture.handlers.get('runtime:conversation-subscribe-transient')!(
        { senderId: 7 },
        subscription,
      ),
    ).rejects.toBe(rejected);
    expect(subscribeFixture.host.onSenderDestroyed).not.toHaveBeenCalled();
  });
});
