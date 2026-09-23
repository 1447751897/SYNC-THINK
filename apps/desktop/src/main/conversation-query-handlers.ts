import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import {
  parseTaskPlanHistoryPayload,
  parseConversationListFileChangesPayload,
  parseConversationReadFileDiffPayload,
  parseConversationReadContentPayload,
} from '@sync-think/protocol';
import {
  parseConversationListMessagesPayload,
  parseConversationListNavigationPayload,
  parseConversationGetContextStatusPayload,
  parseConversationGetRunProcessPayload,
  parseConversationListRunTimelinePayload,
} from '../team-payloads.js';

export interface ConversationQueryHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
  ): Promise<ConversationCommandResponse<K>>;
}

/** Read-only conversation IPC group. Connection, sender trust and transport belong to the host. */
export function registerConversationQueryHandlers<Event>(host: ConversationQueryHost<Event>): void {
  host.handle('runtime:conversation-list-messages', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.listMessages',
      parseConversationListMessagesPayload(value),
    );
  });
  host.handle('runtime:conversation-list-navigation', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.listNavigation',
      parseConversationListNavigationPayload(value),
    );
  });
  host.handle('runtime:conversation-get-context-status', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.getContextStatus',
      parseConversationGetContextStatusPayload(value),
    );
  });
  host.handle('runtime:conversation-get-run-process', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseConversationGetRunProcessPayload(value);
    await host.ensureConnection();
    return host.requestConversation('conversation.getRunProcess', payload);
  });
  host.handle('runtime:conversation-task-plan-history', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseTaskPlanHistoryPayload(value);
    if (!payload) throw new Error('Invalid conversation task history request');
    await host.ensureConnection();
    return host.requestConversation('conversation.taskPlanHistory', payload);
  });
  host.handle('runtime:conversation-list-file-changes', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseConversationListFileChangesPayload(value);
    if (!payload) throw new Error('Invalid conversation file directory request');
    await host.ensureConnection();
    return host.requestConversation('conversation.listFileChanges', payload);
  });
  host.handle('runtime:conversation-read-content', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseConversationReadContentPayload(value);
    if (!payload) throw new Error('Invalid conversation content request');
    await host.ensureConnection();
    return host.requestConversation('conversation.readContent', payload);
  });
  host.handle('runtime:conversation-read-file-diff', async (event, value: unknown) => {
    host.assertSource(event);
    const payload = parseConversationReadFileDiffPayload(value);
    if (!payload) throw new Error('Invalid conversation file diff request');
    await host.ensureConnection();
    return host.requestConversation('conversation.readFileDiff', payload);
  });
  host.handle('runtime:conversation-list-run-timeline', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.listRunTimeline',
      parseConversationListRunTimelinePayload(value),
    );
  });
}
