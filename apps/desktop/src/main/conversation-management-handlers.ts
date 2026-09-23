import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import {
  parseCreateConversationPayload,
  parseDeleteConversationPayload,
  parseListConversationsPayload,
  parseRenameConversationPayload,
  parseSetConversationArchivedPayload,
  parseSetConversationPinnedPayload,
} from '../team-payloads.js';

export interface ConversationManagementHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
  ): Promise<ConversationCommandResponse<K>>;
}

/** Conversation catalog lifecycle. Run modes, plans and prompts remain separate boundaries. */
export function registerConversationManagementHandlers<Event>(
  host: ConversationManagementHost<Event>,
): void {
  host.handle('runtime:conversation-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation('conversation.list', parseListConversationsPayload(value));
  });

  host.handle('runtime:conversation-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation('conversation.create', parseCreateConversationPayload(value));
  });

  host.handle('runtime:conversation-rename', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation('conversation.rename', parseRenameConversationPayload(value));
  });

  host.handle('runtime:conversation-set-pinned', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.setPinned',
      parseSetConversationPinnedPayload(value),
    );
  });

  host.handle('runtime:conversation-set-archived', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.setArchived',
      parseSetConversationArchivedPayload(value),
    );
  });

  host.handle('runtime:conversation-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation('conversation.delete', parseDeleteConversationPayload(value));
  });
}
