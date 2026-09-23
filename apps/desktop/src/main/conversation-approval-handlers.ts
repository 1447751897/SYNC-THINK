import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import { parseListPendingToolApprovalsPayload } from '../approval-payloads.js';
import { parseConversationDecideToolApprovalPayload } from '../team-payloads.js';

export interface ConversationApprovalHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ConversationCommandResponse<K>>;
}

export function registerConversationApprovalHandlers<Event>(
  host: ConversationApprovalHost<Event>,
): void {
  host.handle('runtime:conversation-decide-tool-approval', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.decideToolApproval',
      parseConversationDecideToolApprovalPayload(value),
    );
  });

  host.handle('runtime:conversation-list-pending-tool-approvals', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.listPendingToolApprovals',
      parseListPendingToolApprovalsPayload(value),
    );
  });
}
