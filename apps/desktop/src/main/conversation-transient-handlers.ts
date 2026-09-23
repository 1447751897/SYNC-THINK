import type {
  ConversationTransientFrame,
  ConversationTransientSnapshot,
} from '@sync-think/protocol';
import {
  parseSubscribeConversationTransientStreamPayload,
  parseUnsubscribeConversationTransientStreamPayload,
} from '../team-payloads.js';

export type ConversationTransientRendererPayload =
  | { type: 'frame'; frame: ConversationTransientFrame }
  | {
      type: 'reset';
      latestStreamSequence: number;
      snapshot?: ConversationTransientSnapshot;
    };

export interface ConversationTransientHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  senderId(event: Event): number;
  ensureConnection(): Promise<unknown>;
  subscribe(input: {
    senderId: number;
    subscriptionId: string;
    threadId: string;
    afterStreamSequence?: number;
    listener: (frame: ConversationTransientFrame) => void;
    snapshotListener: (
      latestStreamSequence: number,
      snapshot: ConversationTransientSnapshot | undefined,
    ) => void;
  }): Promise<void>;
  unsubscribe(senderId: number, subscriptionId: string): Promise<void>;
  unsubscribeForSender(senderId: number): Promise<void>;
  onSenderDestroyed(event: Event, listener: () => void): void;
  sendToSender(
    event: Event,
    subscriptionId: string,
    payload: ConversationTransientRendererPayload,
  ): void;
}

/** Transient stream IPC group. Sender identity and concrete session transport stay host-owned. */
export function registerConversationTransientHandlers<Event>(
  host: ConversationTransientHost<Event>,
): void {
  const cleanupRegisteredSenders = new Set<number>();

  host.handle('runtime:conversation-subscribe-transient', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseSubscribeConversationTransientStreamPayload(value);
    await host.ensureConnection();
    const senderId = host.senderId(event);
    await host.subscribe({
      senderId,
      subscriptionId: payload.subscriptionId,
      threadId: payload.threadId,
      afterStreamSequence: payload.afterStreamSequence,
      listener: (frame) =>
        host.sendToSender(event, payload.subscriptionId, { type: 'frame', frame }),
      snapshotListener: (latestStreamSequence, snapshot) =>
        host.sendToSender(event, payload.subscriptionId, {
          type: 'reset',
          latestStreamSequence,
          ...(snapshot ? { snapshot } : {}),
        }),
    });
    if (!cleanupRegisteredSenders.has(senderId)) {
      cleanupRegisteredSenders.add(senderId);
      host.onSenderDestroyed(event, () => {
        cleanupRegisteredSenders.delete(senderId);
        void host.unsubscribeForSender(senderId);
      });
    }
    return { subscriptionId: payload.subscriptionId };
  });

  host.handle('runtime:conversation-unsubscribe-transient', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseUnsubscribeConversationTransientStreamPayload(value);
    await host.unsubscribe(host.senderId(event), payload.subscriptionId);
    return { subscriptionId: payload.subscriptionId };
  });
}
