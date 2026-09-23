import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import { parseConversationSubmitBrowserResultPayload } from '../team-payloads.js';

export interface ConversationBrowserHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ConversationCommandResponse<K>>;
}

export function registerConversationBrowserHandlers<Event>(
  host: ConversationBrowserHost<Event>,
): void {
  host.handle('runtime:conversation-submit-browser-result', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.submitBrowserResult',
      parseConversationSubmitBrowserResultPayload(value),
    );
  });
}
