import type { Conversation, GlobalAgent } from '@sync-think/shared';

export type SidebarMode = 'conversations' | 'agents';
export const SIDEBAR_MODE_KEY = 'sync-think.sidebar-mode.v1';
export interface AgentContactGroup {
  id: string;
  name: string;
  agentIds: string[];
  collapsed?: boolean;
}
const groupKey = (workspaceId: string) => `sync-think.agent-contact-groups.v1:${workspaceId}`;

export function readSidebarMode(): SidebarMode {
  try {
    return localStorage.getItem(SIDEBAR_MODE_KEY) === 'agents' ? 'agents' : 'conversations';
  } catch {
    return 'conversations';
  }
}
export function writeSidebarMode(mode: SidebarMode): void {
  try {
    localStorage.setItem(SIDEBAR_MODE_KEY, mode);
  } catch {
    /* Session-only when storage is full. */
  }
}
export function readAgentContactGroups(workspaceId: string): AgentContactGroup[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(groupKey(workspaceId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const members = new Set<string>();
    return value.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const g = entry as Partial<AgentContactGroup>;
      if (
        typeof g.id !== 'string' ||
        !g.id ||
        ids.has(g.id) ||
        typeof g.name !== 'string' ||
        !g.name.trim() ||
        !Array.isArray(g.agentIds)
      )
        return [];
      ids.add(g.id);
      return [
        {
          id: g.id,
          name: g.name.trim().slice(0, 60),
          collapsed: g.collapsed === true,
          agentIds: g.agentIds.filter((id): id is string => {
            if (typeof id !== 'string' || members.has(id)) return false;
            members.add(id);
            return true;
          }),
        },
      ];
    });
  } catch {
    return [];
  }
}
export function writeAgentContactGroups(workspaceId: string, groups: AgentContactGroup[]): void {
  try {
    localStorage.setItem(groupKey(workspaceId), JSON.stringify(groups));
  } catch {
    /* Session-only. */
  }
}

/** Identity is global; direct-chat history is strictly workspace-local. Pinning does not change recency. */
export function agentChatHistory(
  conversations: readonly Conversation[],
  workspaceId: string,
  agentId: string,
): Conversation[] {
  return conversations
    .filter(
      (c) =>
        c.workspaceId === workspaceId &&
        c.track === 'agent' &&
        c.targetRef === agentId &&
        !c.archivedAt &&
        (!c.collaborationKind || c.collaborationKind === 'direct'),
    )
    .sort(
      (a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt) ||
        b.id.localeCompare(a.id),
    );
}
export function isAgentActive(
  agent: GlobalAgent,
  workspaceId: string,
  activations: Readonly<Record<string, boolean>>,
): boolean {
  return (
    !agent.archived &&
    agent.enabled !== false &&
    ((agent.availabilityScope ?? 'global') === 'global' ||
      activations[`${agent.id}:${workspaceId}`] === true)
  );
}
