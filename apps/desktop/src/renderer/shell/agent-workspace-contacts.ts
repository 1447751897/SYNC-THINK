import type { Conversation, GlobalAgent } from '@sync-think/shared';
import { hasAgentChatMessages } from './agent-contacts.js';

export type AgentWorkspaceContact =
  | {
      kind: 'agent';
      id: string;
      agent: GlobalAgent;
      conversation?: Conversation;
      history: Conversation[];
      pinned: boolean;
    }
  | {
      kind: 'group';
      id: string;
      conversation: Conversation;
      pinned: boolean;
    };

export const contactOrderKey = (scope: string) => `sync-think.agent-workspace.contact-order.v1:${scope}`;
export const pinnedAgentsKey = (scope: string) => `sync-think.agent-workspace.pinned-agents.v1:${scope}`;

export function agentContactId(agentId: string) {
  return `agent:${agentId}`;
}
export function groupContactId(conversationId: string) {
  return `group:${conversationId}`;
}

function readStringList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((id): id is string => {
      if (typeof id !== 'string' || !id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return [];
  }
}

function writeStringList(key: string, ids: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* Session-only when storage is full. */
  }
}

export function readContactOrder(scope: string): string[] {
  return readStringList(contactOrderKey(scope));
}
export function writeContactOrder(scope: string, ids: readonly string[]) {
  writeStringList(contactOrderKey(scope), ids);
}
export function readPinnedAgents(scope: string): string[] {
  return readStringList(pinnedAgentsKey(scope));
}
export function writePinnedAgents(scope: string, ids: readonly string[]) {
  writeStringList(pinnedAgentsKey(scope), ids);
}

export function togglePinnedAgent(ids: readonly string[], agentId: string): string[] {
  return ids.includes(agentId) ? ids.filter((id) => id !== agentId) : [...ids, agentId];
}

export function reorderContactIds(ids: readonly string[], activeId: string, overId: string): string[] {
  const next = [...ids];
  const from = next.indexOf(activeId);
  const to = next.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function sortAgentWorkspaceContacts(
  contacts: readonly AgentWorkspaceContact[],
  order: readonly string[],
): AgentWorkspaceContact[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...contacts].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return 0;
  });
}

export function buildAgentWorkspaceContacts({
  agents,
  conversations,
  selectedId,
  searchTerm,
  order,
  pinnedAgentIds,
}: {
  agents: readonly GlobalAgent[];
  conversations: readonly Conversation[];
  selectedId?: string;
  searchTerm: string;
  order: readonly string[];
  pinnedAgentIds: ReadonlySet<string>;
}): AgentWorkspaceContact[] {
  // An explicitly created room is durable even before its first message.
  const live = conversations.filter((conversation) => !conversation.archivedAt && !conversation.id.startsWith('draft:'));
  const agentContacts: AgentWorkspaceContact[] = agents.flatMap((agent) => {
    const history = live.filter(
      (conversation) =>
        hasAgentChatMessages(conversation) &&
        conversation.collaborationKind !== 'group' &&
        conversation.track !== 'team' &&
        conversation.targetRef === agent.id,
    );
    if (!history.length) return [];
    const haystack =
      `${agent.name} ${agent.description} ${history.map((conversation) => `${conversation.title} ${conversation.lastMessagePreview ?? ''}`).join(' ')}`.toLocaleLowerCase();
    if (searchTerm && !haystack.includes(searchTerm)) return [];
    const conversation = history.find((item) => item.id === selectedId) ?? history[0];
    return [
      {
        kind: 'agent',
        id: agentContactId(agent.id),
        agent,
        conversation,
        history,
        pinned: Boolean(conversation?.pinnedAt) || (!conversation && pinnedAgentIds.has(agent.id)),
      },
    ];
  });
  const groupContacts: AgentWorkspaceContact[] = live.flatMap((conversation) => {
    if (conversation.collaborationKind !== 'group' && conversation.track !== 'team') return [];
    const haystack =
      `${conversation.title} ${conversation.lastMessagePreview ?? ''}`.toLocaleLowerCase();
    if (searchTerm && !haystack.includes(searchTerm)) return [];
    return [
      {
        kind: 'group',
        id: groupContactId(conversation.id),
        conversation,
        pinned: Boolean(conversation.pinnedAt),
      },
    ];
  });
  return sortAgentWorkspaceContacts([...agentContacts, ...groupContacts], order);
}
