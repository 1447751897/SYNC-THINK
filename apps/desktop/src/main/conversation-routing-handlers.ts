import type {
  ConversationCommand,
  ConversationCommandRequest,
  ConversationCommandResponse,
} from '@sync-think/protocol';
import {
  parseRebindConversationTargetPayload,
  parseSetConversationContextWindowOverridePayload,
  parseSetConversationExecutionModePayload,
  parseSetConversationInteractionModePayload,
  parseUpgradeConversationTrackPayload,
} from '../team-payloads.js';

export interface ConversationRoutingHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
  ): Promise<ConversationCommandResponse<K>>;
}

/** Conversation execution and target routing. Plans and Ask state remain separate boundaries. */
export function registerConversationRoutingHandlers<Event>(
  host: ConversationRoutingHost<Event>,
): void {
  host.handle('runtime:conversation-set-execution-mode', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.setExecutionMode',
      parseSetConversationExecutionModePayload(value),
    );
  });

  host.handle('runtime:conversation-set-interaction-mode', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.setInteractionMode',
      parseSetConversationInteractionModePayload(value),
    );
  });

  host.handle('runtime:conversation-set-context-window-override', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.setContextWindowOverride',
      parseSetConversationContextWindowOverridePayload(value),
    );
  });

  host.handle('runtime:conversation-upgrade-track', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.upgradeTrack',
      parseUpgradeConversationTrackPayload(value),
    );
  });

  host.handle('runtime:conversation-rebind-target', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.rebindTarget',
      parseRebindConversationTargetPayload(value),
    );
  });
}
