import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import {
  parseConversationPlanApprovePayload,
  parseConversationPlanCancelPayload,
  parseConversationPlanGetPayload,
  parseConversationPlanRevisePayload,
  parseConversationPlanSubmitPayload,
} from '../team-payloads.js';

export interface ConversationPlanHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
  ): Promise<ConversationCommandResponse<K>>;
}

export function registerConversationPlanHandlers<Event>(host: ConversationPlanHost<Event>): void {
  host.handle('runtime:conversation-plan-submit', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.plan.submit',
      parseConversationPlanSubmitPayload(value),
    );
  });

  host.handle('runtime:conversation-plan-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.plan.get',
      parseConversationPlanGetPayload(value),
    );
  });

  host.handle('runtime:conversation-plan-approve', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.plan.approve',
      parseConversationPlanApprovePayload(value),
    );
  });

  host.handle('runtime:conversation-plan-revise', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.plan.revise',
      parseConversationPlanRevisePayload(value),
    );
  });

  host.handle('runtime:conversation-plan-cancel', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.plan.cancel',
      parseConversationPlanCancelPayload(value),
    );
  });
}
