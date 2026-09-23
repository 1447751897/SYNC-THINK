import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import {
  parseConversationAskAnswerPayload,
  parseConversationAskCancelPayload,
  parseConversationAskPendingPayload,
} from '../team-payloads.js';

export interface ConversationAskHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
  ): Promise<ConversationCommandResponse<K>>;
}

export function registerConversationAskHandlers<Event>(host: ConversationAskHost<Event>): void {
  host.handle('runtime:conversation-ask-answer', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.ask.answer',
      parseConversationAskAnswerPayload(value),
    );
  });

  host.handle('runtime:conversation-ask-cancel', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.ask.cancel',
      parseConversationAskCancelPayload(value),
    );
  });

  host.handle('runtime:conversation-ask-pending', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.ask.pending',
      parseConversationAskPendingPayload(value),
    );
  });
}
