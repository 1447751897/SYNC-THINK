// Product shell state — NewMax-style navigation (shell constitution v1).
// Pure data + reducers so the shell layout stays testable without React.

import type { Conversation, ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';
import type {
  ConversationGroupPreference,
  ConversationGroupsByTrack,
} from '../ui-preferences.js';

/** Left-nav primary stages. 对话 is the default landing stage. */
export type ShellStage =
  | 'talk' // 最近对话 + 聊天主舞台
  | 'agents' // 智能体库
  | 'teams' // 小队库
  | 'browser' // 浏览器（Profile 管理 + 独立登录态）
  | 'abilities' // 能力
  | 'settings';

export interface ShellNavState {
  stage: ShellStage;
  /** Which「最近对话」group is expanded; all three may be open at once. */
  expandedTracks: Record<ConversationTrack, boolean>;
  selectedConversationId?: string;
  /**
   * Collapsed sidebar is fully hidden (not icon rail).
   * Reopen via topbar button or Ctrl+B.
   */
  sidebarCollapsed: boolean;
  /** Last used track for 新建对话 (N3). */
  lastTrack: ConversationTrack;
}

export const INITIAL_NAV: ShellNavState = {
  stage: 'talk',
  expandedTracks: { model: true, agent: true, team: true },
  selectedConversationId: undefined,
  sidebarCollapsed: false,
  lastTrack: 'model',
};

export const TRACK_LABELS: Record<ConversationTrack, string> = {
  model: '模型对话',
  agent: '智能体对话',
  team: '小队对话',
};

export const STAGE_LABELS: Record<ShellStage, string> = {
  talk: '对话',
  agents: '智能体',
  teams: '小队',
  browser: '浏览器',
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

export function setSidebarCollapsed(state: ShellNavState, collapsed: boolean): ShellNavState {
  return { ...state, sidebarCollapsed: collapsed };
}

export function openConversation(state: ShellNavState, conversationId: string): ShellNavState {
  return { ...state, stage: 'talk', selectedConversationId: conversationId };
}

export function setLastTrack(state: ShellNavState, track: ConversationTrack): ShellNavState {
  return { ...state, lastTrack: track };
}

// ─── Open conversation tabs (per workspace) ─────────────────────────────────
// Sidebar = full recent list; stage tab strip = opened subset (O1: click opens).

/** workspaceId → ordered open conversation ids (tab order). */
export type OpenTabsByWorkspace = Record<string, string[]>;

/** workspaceId → last focused conversation id while that workspace was active. */
export type SelectedByWorkspace = Record<string, string | undefined>;

/**
 * Ensure a conversation appears in the open-tab strip for its workspace.
 * Already-open ids stay in place (no re-order on re-focus).
 */
export function openConversationTab(
  tabs: OpenTabsByWorkspace,
  workspaceId: string,
  conversationId: string,
): OpenTabsByWorkspace {
  const id = conversationId.trim();
  const ws = workspaceId.trim();
  if (!id || !ws) return tabs;
  const current = tabs[ws] ?? [];
  if (current.includes(id)) return tabs;
  return { ...tabs, [ws]: [...current, id] };
}

/**
 * Reorder open tabs within a workspace by dragging one id onto another.
 * Returns the original map when the move is a no-op.
 */
export function reorderConversationTab(
  tabs: OpenTabsByWorkspace,
  workspaceId: string,
  fromId: string,
  toId: string,
): OpenTabsByWorkspace {
  const ws = workspaceId.trim();
  const from = fromId.trim();
  const to = toId.trim();
  if (!ws || !from || !to || from === to) return tabs;
  const current = tabs[ws] ?? [];
  const fromIdx = current.indexOf(from);
  const toIdx = current.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return tabs;
  const next = [...current];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, from);
  return { ...tabs, [ws]: next };
}

/**
 * Close a tab without deleting the conversation.
 * Returns the next selection candidate: prefer the tab to the right, else left.
 */
export function closeConversationTab(
  tabs: OpenTabsByWorkspace,
  workspaceId: string,
  conversationId: string,
): { tabs: OpenTabsByWorkspace; nextSelectedId?: string } {
  const ws = workspaceId.trim();
  const id = conversationId.trim();
  if (!ws || !id) return { tabs };
  const current = tabs[ws] ?? [];
  const idx = current.indexOf(id);
  if (idx < 0) return { tabs };
  const next = current.filter((item) => item !== id);
  const nextSelectedId = next[idx] ?? next[idx - 1];
  if (next.length === 0) {
    const { [ws]: _removed, ...rest } = tabs;
    return { tabs: rest, nextSelectedId };
  }
  return { tabs: { ...tabs, [ws]: next }, nextSelectedId };
}

/** Drop open-tab ids that no longer exist (deleted / filtered out). */
export function pruneOpenTabs(
  tabs: OpenTabsByWorkspace,
  existingIds: ReadonlySet<string>,
): OpenTabsByWorkspace {
  let changed = false;
  const next: OpenTabsByWorkspace = {};
  for (const [workspaceId, ids] of Object.entries(tabs)) {
    const kept = ids.filter((id) => existingIds.has(id));
    if (kept.length !== ids.length) changed = true;
    if (kept.length > 0) next[workspaceId] = kept;
    else if (ids.length > 0) changed = true;
  }
  return changed ? next : tabs;
}

export function rememberWorkspaceSelection(
  selectedByWorkspace: SelectedByWorkspace,
  workspaceId: string,
  conversationId: string | undefined,
): SelectedByWorkspace {
  const ws = workspaceId.trim();
  if (!ws) return selectedByWorkspace;
  if (!conversationId) {
    if (!(ws in selectedByWorkspace)) return selectedByWorkspace;
    const { [ws]: _removed, ...rest } = selectedByWorkspace;
    return rest;
  }
  if (selectedByWorkspace[ws] === conversationId) return selectedByWorkspace;
  return { ...selectedByWorkspace, [ws]: conversationId };
}

/**
 * When switching workspaces, restore the last focused open tab if still open;
 * otherwise fall back to the rightmost open tab; otherwise clear selection.
 */
export function resolveWorkspaceSelection(
  tabs: OpenTabsByWorkspace,
  selectedByWorkspace: SelectedByWorkspace,
  workspaceId: string | undefined,
): string | undefined {
  if (!workspaceId) return undefined;
  const open = tabs[workspaceId] ?? [];
  if (open.length === 0) return undefined;
  const remembered = selectedByWorkspace[workspaceId];
  if (remembered && open.includes(remembered)) return remembered;
  return open[open.length - 1];
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
 * Workspace filter: always requires a workspace id (no "全部").
 * Conversations without workspaceId are hidden when filtering.
 */
export function filterByWorkspace(
  conversations: readonly Conversation[],
  workspaceId: string | undefined,
): Conversation[] {
  if (!workspaceId) return [];
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

/**
 * Resolve the display name of a conversation target for the sidebar row.
 *
 * Model-track chats may have a per-conversation compose override that is only
 * stored in local UI prefs (not in conversation.targetRef). When present, that
 * override is the live identity the sidebar must show.
 */
export function targetName(
  conversation: Conversation,
  agents: readonly GlobalAgent[],
  teams: readonly Team[],
  modelNames?: ReadonlyMap<string, string>,
  modelOverrides?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  if (conversation.track === 'agent') {
    return agents.find((a) => a.id === conversation.targetRef)?.name ?? '智能体';
  }
  if (conversation.track === 'team') {
    return teams.find((t) => t.id === conversation.targetRef)?.name ?? '小队';
  }

  let overrideRaw: string | undefined;
  if (modelOverrides instanceof Map) {
    overrideRaw = modelOverrides.get(String(conversation.id));
  } else if (modelOverrides && typeof modelOverrides === 'object') {
    const value = (modelOverrides as Record<string, string | undefined>)[String(conversation.id)];
    overrideRaw = typeof value === 'string' ? value : undefined;
  }
  const ref = (overrideRaw?.trim() || conversation.targetRef?.trim() || '');
  if (!ref) return '未选择模型';
  const mapped = modelNames?.get(ref);
  if (mapped?.trim()) return mapped.trim();
  // Stale / deleted model ids should not collapse to the track label "模型对话".
  // Prefer a short bare id so the UI still shows *something* model-like.
  if (ref.includes('/')) return ref.slice(ref.lastIndexOf('/') + 1);
  return ref;
}

// ─── Conversation groups (local CRUD) ───────────────────────────────────────

export interface TrackTreeSection {
  groups: Array<{
    group: ConversationGroupPreference;
    conversations: Conversation[];
  }>;
  ungrouped: Conversation[];
}

/** Build track tree: named groups first, then ungrouped conversations. */
export function buildTrackTree(
  conversations: readonly Conversation[],
  groups: readonly ConversationGroupPreference[],
): TrackTreeSection {
  const byId = new Map<string, Conversation>(conversations.map((c) => [String(c.id), c]));
  const placed = new Set<string>();
  const sections: TrackTreeSection['groups'] = [];

  for (const group of groups) {
    const items: Conversation[] = [];
    for (const id of group.conversationIds) {
      const conv = byId.get(id);
      if (!conv || placed.has(id)) continue;
      items.push(conv);
      placed.add(id);
    }
    sections.push({ group, conversations: items });
  }

  const ungrouped = conversations.filter((c) => !placed.has(String(c.id)));
  return { groups: sections, ungrouped };
}

export function createConversationGroup(
  groups: ConversationGroupsByTrack,
  track: ConversationTrack,
  name: string,
  id?: string,
): ConversationGroupsByTrack {
  const trimmed = name.trim();
  if (!trimmed) return groups;
  const group: ConversationGroupPreference = {
    id: id ?? `grp-${track}-${Date.now().toString(36)}`,
    name: trimmed,
    collapsed: false,
    conversationIds: [],
  };
  return {
    ...groups,
    [track]: [...groups[track], group],
  };
}

export function renameConversationGroup(
  groups: ConversationGroupsByTrack,
  track: ConversationTrack,
  groupId: string,
  name: string,
): ConversationGroupsByTrack {
  const trimmed = name.trim();
  if (!trimmed) return groups;
  return {
    ...groups,
    [track]: groups[track].map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
  };
}

/** Delete group; conversations become ungrouped (ids simply drop from group). */
export function deleteConversationGroup(
  groups: ConversationGroupsByTrack,
  track: ConversationTrack,
  groupId: string,
): ConversationGroupsByTrack {
  return {
    ...groups,
    [track]: groups[track].filter((g) => g.id !== groupId),
  };
}

export function toggleConversationGroupCollapsed(
  groups: ConversationGroupsByTrack,
  track: ConversationTrack,
  groupId: string,
): ConversationGroupsByTrack {
  return {
    ...groups,
    [track]: groups[track].map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
    ),
  };
}

/** Move conversation into a group (or ungroup when groupId is null). Removes from other groups on same track. */
export function moveConversationToGroup(
  groups: ConversationGroupsByTrack,
  track: ConversationTrack,
  conversationId: string,
  groupId: string | null,
): ConversationGroupsByTrack {
  const nextList = groups[track].map((g) => {
    const without = g.conversationIds.filter((id) => id !== conversationId);
    if (groupId && g.id === groupId) {
      return { ...g, conversationIds: [...without, conversationId] };
    }
    return { ...g, conversationIds: without };
  });
  return { ...groups, [track]: nextList };
}

export function emptyConversationGroups(): ConversationGroupsByTrack {
  return { model: [], agent: [], team: [] };
}
