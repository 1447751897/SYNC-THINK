// Product shell state — NewMax-style navigation (2026-07-22 rewrite).
// Pure data + reducers so the shell layout stays testable without React.

import type { Conversation, ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';

/** Left-nav primary stages. 对话 is the default landing stage. */
export type ShellStage =
  | 'talk'        // 最近对话 + 聊天主舞台
  | 'projects'    // 项目（任务板/排期）
  | 'agents'      // 智能体库（全局配置）
  | 'teams'       // 小队库（全局配置）
  | 'abilities'   // 能力（Skill / 浏览器 / MCP）
  | 'settings';

export interface ShellNavState {
  stage: ShellStage;
  /** Which「最近对话」group is expanded; all three may be open at once. */
  expandedTracks: Record<ConversationTrack, boolean>;
  selectedConversationId?: string;
  /** Collapsed sidebar shows only the icon rail (NewMax-style panel collapse). */
  sidebarCollapsed: boolean;
}

export const INITIAL_NAV: ShellNavState = {
  stage: 'talk',
  expandedTracks: { model: true, agent: true, team: true },
  selectedConversationId: undefined,
  sidebarCollapsed: false,
};

export const TRACK_LABELS: Record<ConversationTrack, string> = {
  model: '模型对话',
  agent: '智能体对话',
  team: '小队对话',
};

export const STAGE_LABELS: Record<ShellStage, string> = {
  talk: '对话',
  projects: '项目',
  agents: '智能体库',
  teams: '小队库',
  abilities: '能力',
  settings: '设置',
};

export function toggleTrack(state: ShellNavState, track: ConversationTrack): ShellNavState {
  return {
    ...state,
    expandedTracks: { ...state.expandedTracks, [track]: !state.expandedTracks[track] },
  };
}

export function selectStage(state: ShellNavState, stage: ShellStage): ShellNavState {
  return { ...state, stage };
}

export function toggleSidebar(state: ShellNavState): ShellNavState {
  return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
}

export function openConversation(state: ShellNavState, conversationId: string): ShellNavState {
  return { ...state, stage: 'talk', selectedConversationId: conversationId };
}

/** Sidebar grouping: pinned first inside each track (store already orders). */
export function groupConversations(
  conversations: readonly Conversation[],
): Record<ConversationTrack, Conversation[]> {
  const groups: Record<ConversationTrack, Conversation[]> = { model: [], agent: [], team: [] };
  for (const c of conversations) groups[c.track].push(c);
  return groups;
}

/**
 * Project-tab filter: undefined = 全部（everything, including 未归类
 * conversations with no workspace）; a workspaceId shows only that project's.
 */
export function filterByWorkspace(
  conversations: readonly Conversation[],
  workspaceId: string | undefined,
): Conversation[] {
  if (workspaceId === undefined) return [...conversations];
  return conversations.filter((c) => c.workspaceId === workspaceId);
}

/** Split active vs archived conversations for the sidebar archive section. */
export function partitionActiveArchived(conversations: readonly Conversation[]): {
  active: Conversation[];
  archived: Conversation[];
} {
  const active: Conversation[] = [];
  const archived: Conversation[] = [];
  for (const c of conversations) {
    if (c.archivedAt) archived.push(c);
    else active.push(c);
  }
  return { active, archived };
}

/**
 * Local title/target search for the sidebar (FTS comes later in P5).
 * Matches conversation.title, optional resolved target name, and raw targetRef.
 */
export function filterConversationsByQuery(
  conversations: readonly Conversation[],
  query: string,
  resolveName?: (conversation: Conversation) => string,
): Conversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...conversations];
  return conversations.filter((c) => {
    const title = (c.title || '').toLowerCase();
    const name = (resolveName?.(c) || '').toLowerCase();
    const ref = (c.targetRef || '').toLowerCase();
    return title.includes(q) || name.includes(q) || ref.includes(q);
  });
}

/** Resolve the display name of a conversation target for the sidebar row. */
export function targetName(
  conversation: Conversation,
  agents: readonly GlobalAgent[],
  teams: readonly Team[],
  modelNames?: ReadonlyMap<string, string>,
): string {
  if (conversation.track === 'agent') {
    return agents.find((a) => a.id === conversation.targetRef)?.name ?? '智能体';
  }
  if (conversation.track === 'team') {
    return teams.find((t) => t.id === conversation.targetRef)?.name ?? '小队';
  }
  return modelNames?.get(conversation.targetRef) ?? '模型对话';
}
