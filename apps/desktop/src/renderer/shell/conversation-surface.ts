import type { Conversation } from '@sync-think/shared';

/** Shared routing rule: a model chat stays a model chat when it delegates work. */
export function isAgentConversation(conversation: Pick<Conversation, 'track' | 'collaborationKind'>): boolean {
  return conversation.collaborationKind
    ? conversation.collaborationKind !== 'model'
    : conversation.track !== 'model';
}

/** An explicit navigation request, not a second copy of the conversation. */
export interface AgentWorkspaceNavigation {
  workspaceId: string;
  conversationId?: string;
  agentId?: string;
  teamId?: string;
  fresh?: boolean;
  nonce: number;
}
