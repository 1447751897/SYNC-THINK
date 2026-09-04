// Workspace UI preferences (product §15.2 / §10.1 L3 soft craft).
// M1: renderer localStorage — calm, restart-safe, no Runtime dependency.

import { parseWorkspacePaneLayouts, type WorkspacePaneLayouts } from './shell/pane-layout.js';
import {
  parseWorkspaceWorkbenchLayouts,
  type WorkspaceWorkbenchLayouts,
} from './shell/workspace-workbench.js';

export type ConversationLayoutPreference = 'default' | 'single';
export type ThemePreference = 'light' | 'dark' | 'system';
export type DefaultPermissionPreference = 'ask' | 'workspace' | 'full-access';
export type AgentThinkingBudget =
  | 'auto'
  | 'minimal'
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface AgentPreferences {
  promptEnhancementEnabled: boolean;
  promptEnhancementModelId: string | null;
  thinkingBudget: AgentThinkingBudget;
  collapseExecutionProcess: boolean;
  showToolUse: boolean;
  toolCallExpandedByDefault: boolean;
}

export const DEFAULT_AGENT_PREFERENCES: Readonly<AgentPreferences> = {
  promptEnhancementEnabled: true,
  promptEnhancementModelId: null,
  thinkingBudget: 'auto',
  collapseExecutionProcess: true,
  showToolUse: true,
  toolCallExpandedByDefault: false,
};

export const AGENT_PREFERENCES_CHANGED_EVENT = 'shell-agent-preferences-changed';
export const CONVERSATION_KERNEL_OVERRIDES_CHANGED_EVENT =
  'shell-conversation-kernel-overrides-changed';

export const SHELL_ANIMATION_PREFERENCE_KEY = 'sync-think-animation';

/** In-app 界面动画 is the source of truth; OS reduced-motion must not override it. */
export function applyShellMotionPreference(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-reduced-motion', !enabled);
  if (enabled) document.documentElement.setAttribute('data-motion', 'full');
  else document.documentElement.removeAttribute('data-motion');
}

/** Shell conversation permission defaults to the user-confirmed full access mode. */
export const DEFAULT_PERMISSION_PREFERENCE: DefaultPermissionPreference = 'full-access';

export const UI_PREF_KEYS = {
  conversationLayout: 'sync-think.conversationLayout',
  theme: 'sync-think.theme',
  traceCollapsed: 'sync-think.traceCollapsed',
  agentPreferences: 'sync-think.agentPreferences',
  recentConversationSections: 'sync-think.recentConversationSections',
  pinnedConversations: 'sync-think.pinnedConversations',
  conversationTracks: 'sync-think.conversationTracks',
  /** Default execution permission for newly created conversations. */
  defaultPermission: 'sync-think-default-permission',
  /** Draft retained while the empty-state target picker is open. */
  newConversationDraft: 'sync-think.newConversationDraft',
  /** Model selected in the empty-state compose. */
  newConversationModel: 'sync-think.newConversationModel',
  /** Kernel selected in the empty-state compose. */
  newConversationKernel: 'sync-think.newConversationKernel',
  /** Shell: last used conversation track for 新建对话 (N3). */
  lastConversationTrack: 'sync-think.lastConversationTrack',
  /** Shell sidebar width in px (draggable). */
  sidebarWidth: 'sync-think.sidebarWidth',
  /** Geometry revision used to migrate the former 300px default once. */
  sidebarWidthVersion: 'sync-think.sidebarWidthVersion',
  /** Active workspace id (no "全部" — always a workspace when possible). */
  activeWorkspaceId: 'sync-think.activeWorkspaceId',
  /** Display name used in the welcome greeting. */
  userName: 'sync-think.userName',
  /**
   * Conversation groups, isolated per workspace.
   * Stored as { version: 2, workspaces: Record<workspaceId, GroupsByTrack> }.
   * The former global shape is migrated into the active workspace on read.
   */
  conversationGroups: 'sync-think.conversationGroups',
  /**
   * Open conversation tabs per workspace (stage tab strip).
   * Shape: Record<workspaceId, conversationId[]>.
   */
  openConversationTabs: 'sync-think.openConversationTabs',
  /**
   * Last focused conversation per workspace while its tabs were open.
   * Shape: Record<workspaceId, conversationId>.
   */
  selectedConversationByWorkspace: 'sync-think.selectedConversationByWorkspace',
  /** Versioned recursive pane tree and focused tab state per workspace. */
  workspacePaneLayouts: 'sync-think.workspacePaneLayouts',
  /** NewMax-style right/bottom workbench tabs, visibility, and dimensions. */
  workspaceWorkbenchLayouts: 'sync-think.workspaceWorkbenchLayouts',
  /**
   * Per-conversation model override (catalog modelId).
   * Shape: Record<conversationId, modelId>.
   * Survives restart so the compose model trigger does not fall back to a
   * stale/unknown conversation.targetRef after rebuild.
   */
  conversationModelOverrides: 'sync-think.conversationModelOverrides',
  /**
   * Per-conversation kernel id chosen in compose (multi-kernel selector).
   * Shape: Record<conversationId, KernelId>.
   * Default (absent) = 'native' (the in-process runtime).
   */
  conversationKernelOverrides: 'sync-think.conversationKernelOverrides',
  /**
   * Per-conversation reasoning effort chosen in compose.
   * Shape: Record<conversationId, ReasoningEffort>.
   * Survives conversation switches and restarts so each conversation keeps
   * its own thinking intensity until the user changes it again.
   */
  conversationReasoningEfforts: 'sync-think.conversationReasoningEfforts',
  /** Per-conversation web-search choice used by the compose @ settings menu. */
  conversationNetworkEnabled: 'sync-think.conversationNetworkEnabled',
} as const;

export type ConversationTrackPreference = 'model' | 'agent' | 'team';

export interface ConversationGroupPreference {
  id: string;
  name: string;
  collapsed?: boolean;
  conversationIds: string[];
}

export type ConversationGroupsByTrack = Record<
  ConversationTrackPreference,
  ConversationGroupPreference[]
>;

const DEFAULT_CONVERSATION_GROUPS: ConversationGroupsByTrack = {
  model: [],
  agent: [],
  team: [],
};

export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 360;
export const SIDEBAR_WIDTH_DEFAULT = 220;
const SIDEBAR_WIDTH_VERSION = '2';

export type RecentConversationSectionState = Record<'model' | 'agent' | 'team', boolean>;

const DEFAULT_RECENT_CONVERSATION_SECTIONS: RecentConversationSectionState = {
  model: true,
  agent: true,
  team: true,
};

function safeGet(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

export function readConversationLayoutPreference(
  storage?: Pick<Storage, 'getItem'>,
): ConversationLayoutPreference {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.conversationLayout);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.conversationLayout);
  return raw === 'single' ? 'single' : 'default';
}

export function writeConversationLayoutPreference(
  layout: ConversationLayoutPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.conversationLayout, layout);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.conversationLayout, layout);
}

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.theme);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.theme);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function writeThemePreference(
  theme: ThemePreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.theme, theme);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.theme, theme);
}

export function readDefaultPermission(
  storage?: Pick<Storage, 'getItem'>,
): DefaultPermissionPreference {
  let raw: string | null = null;
  try {
    raw = storage
      ? storage.getItem(UI_PREF_KEYS.defaultPermission)
      : safeGet(UI_PREF_KEYS.defaultPermission);
  } catch {
    raw = null;
  }
  if (raw === 'ask' || raw === 'workspace' || raw === 'full-access') return raw;
  // Migrate the former SettingsPage value without propagating the old
  // read-only alias into the conversation execution contract.
  if (raw === 'read-only') return 'ask';
  return DEFAULT_PERMISSION_PREFERENCE;
}

export function writeDefaultPermission(
  permission: DefaultPermissionPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.defaultPermission, permission);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.defaultPermission, permission);
}

export function readNewConversationDraft(storage?: Pick<Storage, 'getItem'>): string {
  try {
    return (
      storage?.getItem(UI_PREF_KEYS.newConversationDraft) ??
      safeGet(UI_PREF_KEYS.newConversationDraft) ??
      ''
    );
  } catch {
    return '';
  }
}

export function writeNewConversationDraft(draft: string, storage?: Pick<Storage, 'setItem'>): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.newConversationDraft, draft);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.newConversationDraft, draft);
}

export function readNewConversationModel(storage?: Pick<Storage, 'getItem'>): string {
  try {
    return (
      storage?.getItem(UI_PREF_KEYS.newConversationModel) ??
      safeGet(UI_PREF_KEYS.newConversationModel) ??
      ''
    );
  } catch {
    return '';
  }
}

export function writeNewConversationModel(
  modelId: string,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.newConversationModel, modelId);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.newConversationModel, modelId);
}

export function readNewConversationKernel(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const value =
      storage?.getItem(UI_PREF_KEYS.newConversationKernel) ??
      safeGet(UI_PREF_KEYS.newConversationKernel) ??
      'native';
    return value.trim() || 'native';
  } catch {
    return 'native';
  }
}

export function writeNewConversationKernel(
  kernelId: string,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const value = kernelId.trim() || 'native';
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.newConversationKernel, value);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.newConversationKernel, value);
}

/** Default: expanded (false). Collapsing does not pause Run — only UI rail. */
export function readTraceCollapsedPreference(storage?: Pick<Storage, 'getItem'>): boolean {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.traceCollapsed);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.traceCollapsed);
  return raw === '1' || raw === 'true';
}

export function writeTraceCollapsedPreference(
  collapsed: boolean,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const value = collapsed ? '1' : '0';
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.traceCollapsed, value);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.traceCollapsed, value);
}

const AGENT_THINKING_BUDGETS = new Set<AgentThinkingBudget>([
  'auto',
  'minimal',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function normalizeAgentPreferences(value: unknown): AgentPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  const valid =
    typeof record.promptEnhancementEnabled === 'boolean' &&
    (record.promptEnhancementModelId === null ||
      typeof record.promptEnhancementModelId === 'string') &&
    typeof record.thinkingBudget === 'string' &&
    AGENT_THINKING_BUDGETS.has(record.thinkingBudget as AgentThinkingBudget) &&
    typeof record.collapseExecutionProcess === 'boolean' &&
    typeof record.showToolUse === 'boolean' &&
    typeof record.toolCallExpandedByDefault === 'boolean';
  if (!valid) return { ...DEFAULT_AGENT_PREFERENCES };
  return {
    promptEnhancementEnabled: record.promptEnhancementEnabled as boolean,
    promptEnhancementModelId:
      typeof record.promptEnhancementModelId === 'string'
        ? record.promptEnhancementModelId.trim() || null
        : null,
    thinkingBudget: record.thinkingBudget as AgentThinkingBudget,
    collapseExecutionProcess: record.collapseExecutionProcess as boolean,
    showToolUse: record.showToolUse as boolean,
    toolCallExpandedByDefault: record.toolCallExpandedByDefault as boolean,
  };
}

export function readAgentPreferences(storage?: Pick<Storage, 'getItem'>): AgentPreferences {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.agentPreferences);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.agentPreferences);
  if (!raw) return { ...DEFAULT_AGENT_PREFERENCES };
  try {
    return normalizeAgentPreferences(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_AGENT_PREFERENCES };
  }
}

export function writeAgentPreferences(
  preferences: AgentPreferences,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const normalized = normalizeAgentPreferences(preferences);
  const value = JSON.stringify(normalized);
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.agentPreferences, value);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.agentPreferences, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AGENT_PREFERENCES_CHANGED_EVENT, { detail: normalized }),
    );
  }
}

function readJsonPreference(key: string, storage?: Pick<Storage, 'getItem'>): unknown {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      })()
    : safeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJsonPreference(
  key: string,
  value: unknown,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const serialized = JSON.stringify(value);
  if (storage) {
    try {
      storage.setItem(key, serialized);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(key, serialized);
}

export function readRecentConversationSectionPreference(
  storage?: Pick<Storage, 'getItem'>,
): RecentConversationSectionState {
  const raw = readJsonPreference(UI_PREF_KEYS.recentConversationSections, storage);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_RECENT_CONVERSATION_SECTIONS };
  }
  const record = raw as Record<string, unknown>;
  return {
    model: typeof record.model === 'boolean' ? record.model : true,
    agent: typeof record.agent === 'boolean' ? record.agent : true,
    team: typeof record.team === 'boolean' ? record.team : true,
  };
}

export function writeRecentConversationSectionPreference(
  state: RecentConversationSectionState,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.recentConversationSections, state, storage);
}

export function readPinnedConversationIds(storage?: Pick<Storage, 'getItem'>): readonly string[] {
  const raw = readJsonPreference(UI_PREF_KEYS.pinnedConversations, storage);
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0)),
  ];
}

export function writePinnedConversationIds(
  ids: readonly string[],
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.pinnedConversations, [...new Set(ids)], storage);
}

export function readConversationTrackPreferences(
  storage?: Pick<Storage, 'getItem'>,
): Readonly<Record<string, 'model' | 'agent' | 'team'>> {
  const raw = readJsonPreference(UI_PREF_KEYS.conversationTracks, storage);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, 'model' | 'agent' | 'team'> = {};
  for (const [taskId, track] of Object.entries(raw as Record<string, unknown>)) {
    if (!taskId || (track !== 'model' && track !== 'agent' && track !== 'team')) continue;
    result[taskId] = track;
  }
  return result;
}

export function writeConversationTrackPreferences(
  tracks: Readonly<Record<string, 'model' | 'agent' | 'team'>>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.conversationTracks, tracks, storage);
}

export function readLastConversationTrack(
  storage?: Pick<Storage, 'getItem'>,
): ConversationTrackPreference {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.lastConversationTrack);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.lastConversationTrack);
  if (raw === 'model' || raw === 'agent' || raw === 'team') return raw;
  return 'model';
}

export function writeLastConversationTrack(
  track: ConversationTrackPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.lastConversationTrack, track);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.lastConversationTrack, track);
}

export function readSidebarWidth(storage?: Pick<Storage, 'getItem'>): number {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.sidebarWidth);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.sidebarWidth);
  const version = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.sidebarWidthVersion);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.sidebarWidthVersion);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  if (version !== SIDEBAR_WIDTH_VERSION) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)));
}

export function writeSidebarWidth(width: number, storage?: Pick<Storage, 'setItem'>): void {
  const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
  const value = String(clamped);
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.sidebarWidth, value);
      storage.setItem(UI_PREF_KEYS.sidebarWidthVersion, SIDEBAR_WIDTH_VERSION);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.sidebarWidth, value);
  safeSet(UI_PREF_KEYS.sidebarWidthVersion, SIDEBAR_WIDTH_VERSION);
}

export function readActiveWorkspaceId(storage?: Pick<Storage, 'getItem'>): string | undefined {
  const raw = storage
    ? (() => {
        try {
          return storage.getItem(UI_PREF_KEYS.activeWorkspaceId);
        } catch {
          return null;
        }
      })()
    : safeGet(UI_PREF_KEYS.activeWorkspaceId);
  if (!raw || !raw.trim()) return undefined;
  return raw.trim();
}

export function writeActiveWorkspaceId(
  workspaceId: string | undefined,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  if (!workspaceId) {
    if (storage && 'removeItem' in storage) {
      try {
        storage.removeItem?.(UI_PREF_KEYS.activeWorkspaceId);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(UI_PREF_KEYS.activeWorkspaceId);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  if (storage && 'setItem' in storage) {
    try {
      storage.setItem(UI_PREF_KEYS.activeWorkspaceId, workspaceId);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.activeWorkspaceId, workspaceId);
}

function parseGroup(raw: unknown): ConversationGroupPreference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!id || !name) return null;
  const conversationIds = Array.isArray(record.conversationIds)
    ? [
        ...new Set(
          record.conversationIds.filter(
            (item): item is string => typeof item === 'string' && item.length > 0,
          ),
        ),
      ]
    : [];
  return {
    id,
    name,
    collapsed: record.collapsed === true,
    conversationIds,
  };
}

function parseGroupsByTrack(raw: unknown): ConversationGroupsByTrack {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { model: [], agent: [], team: [] };
  }
  const record = raw as Record<string, unknown>;
  const parseTrack = (key: ConversationTrackPreference): ConversationGroupPreference[] => {
    const list = record[key];
    if (!Array.isArray(list)) return [];
    return list
      .map(parseGroup)
      .filter((item): item is ConversationGroupPreference => item !== null);
  };
  return {
    model: parseTrack('model'),
    agent: parseTrack('agent'),
    team: parseTrack('team'),
  };
}

interface WorkspaceConversationGroupsPreference {
  version: 2;
  workspaces: Record<string, ConversationGroupsByTrack>;
}

function parseWorkspaceConversationGroups(
  raw: unknown,
): WorkspaceConversationGroupsPreference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 2 || !record.workspaces || typeof record.workspaces !== 'object') {
    return null;
  }
  const workspaces: Record<string, ConversationGroupsByTrack> = {};
  for (const [workspaceId, groups] of Object.entries(
    record.workspaces as Record<string, unknown>,
  )) {
    const id = workspaceId.trim();
    if (!id) continue;
    workspaces[id] = parseGroupsByTrack(groups);
  }
  return { version: 2, workspaces };
}

export function readConversationGroups(
  workspaceId: string | undefined,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ConversationGroupsByTrack {
  if (!workspaceId) return { model: [], agent: [], team: [] };
  const raw = readJsonPreference(UI_PREF_KEYS.conversationGroups, storage);
  const scoped = parseWorkspaceConversationGroups(raw);
  if (scoped) {
    return scoped.workspaces[workspaceId] ?? { model: [], agent: [], team: [] };
  }

  // One-time migration from the former global shape. Assign it only to the
  // currently active workspace so it cannot leak into every workspace.
  const migrated = parseGroupsByTrack(raw);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    writeJsonPreference(
      UI_PREF_KEYS.conversationGroups,
      { version: 2, workspaces: { [workspaceId]: migrated } },
      storage,
    );
  }
  return migrated;
}

export function writeConversationGroups(
  workspaceId: string,
  groups: ConversationGroupsByTrack,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const raw = readJsonPreference(UI_PREF_KEYS.conversationGroups, storage);
  const current = parseWorkspaceConversationGroups(raw) ?? {
    version: 2 as const,
    workspaces: {},
  };
  writeJsonPreference(
    UI_PREF_KEYS.conversationGroups,
    {
      version: 2,
      workspaces: {
        ...current.workspaces,
        [workspaceId]: {
          model: groups.model ?? DEFAULT_CONVERSATION_GROUPS.model,
          agent: groups.agent ?? DEFAULT_CONVERSATION_GROUPS.agent,
          team: groups.team ?? DEFAULT_CONVERSATION_GROUPS.team,
        },
      },
    },
    storage,
  );
}

/** workspaceId → ordered open conversation ids for the stage tab strip. */
export type OpenConversationTabsPreference = Record<string, string[]>;

/** workspaceId → last focused conversation id. */
export type SelectedConversationByWorkspacePreference = Record<string, string>;

function parseIdListMap(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string[]> = {};
  for (const [workspaceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const ws = workspaceId.trim();
    if (!ws || !Array.isArray(value)) continue;
    const ids = [
      ...new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      ),
    ];
    if (ids.length > 0) result[ws] = ids;
  }
  return result;
}

function parseIdMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [workspaceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const ws = workspaceId.trim();
    const id = typeof value === 'string' ? value.trim() : '';
    if (!ws || !id) continue;
    result[ws] = id;
  }
  return result;
}

export function readOpenConversationTabs(
  storage?: Pick<Storage, 'getItem'>,
): OpenConversationTabsPreference {
  return parseIdListMap(readJsonPreference(UI_PREF_KEYS.openConversationTabs, storage));
}

export function writeOpenConversationTabs(
  tabs: OpenConversationTabsPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.openConversationTabs, tabs, storage);
}

export function readSelectedConversationByWorkspace(
  storage?: Pick<Storage, 'getItem'>,
): SelectedConversationByWorkspacePreference {
  return parseIdMap(readJsonPreference(UI_PREF_KEYS.selectedConversationByWorkspace, storage));
}

export function writeSelectedConversationByWorkspace(
  selected: SelectedConversationByWorkspacePreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.selectedConversationByWorkspace, selected, storage);
}

export function readWorkspacePaneLayouts(storage?: Pick<Storage, 'getItem'>): WorkspacePaneLayouts {
  return parseWorkspacePaneLayouts(readJsonPreference(UI_PREF_KEYS.workspacePaneLayouts, storage));
}

export function writeWorkspacePaneLayouts(
  layouts: WorkspacePaneLayouts,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(
    UI_PREF_KEYS.workspacePaneLayouts,
    { version: 1, workspaces: layouts },
    storage,
  );
}

export function readWorkspaceWorkbenchLayouts(
  storage?: Pick<Storage, 'getItem'>,
): WorkspaceWorkbenchLayouts {
  return parseWorkspaceWorkbenchLayouts(
    readJsonPreference(UI_PREF_KEYS.workspaceWorkbenchLayouts, storage),
  );
}

export function writeWorkspaceWorkbenchLayouts(
  layouts: WorkspaceWorkbenchLayouts,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(
    UI_PREF_KEYS.workspaceWorkbenchLayouts,
    { version: 1, workspaces: layouts },
    storage,
  );
}

/** conversationId → catalog modelId override chosen in compose. */
export type ConversationModelOverridesPreference = Record<string, string>;

export function readConversationModelOverrides(
  storage?: Pick<Storage, 'getItem'>,
): ConversationModelOverridesPreference {
  return parseIdMap(readJsonPreference(UI_PREF_KEYS.conversationModelOverrides, storage));
}

export function writeConversationModelOverrides(
  overrides: ConversationModelOverridesPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.conversationModelOverrides, overrides, storage);
}

export function readConversationModelOverride(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>,
): string | undefined {
  const id = conversationId.trim();
  if (!id) return undefined;
  const value = readConversationModelOverrides(storage)[id];
  return value && value.trim() ? value.trim() : undefined;
}

export function writeConversationModelOverride(
  conversationId: string,
  modelId: string | undefined,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const id = conversationId.trim();
  if (!id) return;
  const current = { ...readConversationModelOverrides(storage) };
  const next = modelId?.trim();
  if (!next) delete current[id];
  else current[id] = next;
  writeConversationModelOverrides(current, storage);
}

/** conversationId → kernelId override chosen in compose (multi-kernel selector). */
export type ConversationKernelOverridesPreference = Record<string, string>;

export function readConversationKernelOverrides(
  storage?: Pick<Storage, 'getItem'>,
): ConversationKernelOverridesPreference {
  return parseIdMap(readJsonPreference(UI_PREF_KEYS.conversationKernelOverrides, storage));
}

export function writeConversationKernelOverrides(
  overrides: ConversationKernelOverridesPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.conversationKernelOverrides, overrides, storage);
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CONVERSATION_KERNEL_OVERRIDES_CHANGED_EVENT, { detail: overrides }),
    );
  }
}

/** Default kernel: native (the in-process runtime) — no override needed. */
export function readConversationKernelOverride(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>,
): string | undefined {
  const id = conversationId.trim();
  if (!id) return undefined;
  const value = readConversationKernelOverrides(storage)[id];
  return value && value.trim() ? value.trim() : undefined;
}

export function writeConversationKernelOverride(
  conversationId: string,
  kernelId: string | undefined,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const id = conversationId.trim();
  if (!id) return;
  const current = { ...readConversationKernelOverrides(storage) };
  const next = kernelId?.trim();
  if (!next || next === 'native') delete current[id];
  else current[id] = next;
  writeConversationKernelOverrides(current, storage);
}

/**
 * Valid reasoning effort values persisted per conversation.
 * Kept in sync with the compose-toolbar ReasoningEffort union so stored
 * values are validated against a bounded set instead of free-form strings.
 */
const CONVERSATION_REASONING_EFFORTS = [
  'auto',
  'minimal',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ConversationReasoningEffort = (typeof CONVERSATION_REASONING_EFFORTS)[number];

export function readConversationReasoningEfforts(
  storage?: Pick<Storage, 'getItem'>,
): Record<string, ConversationReasoningEffort> {
  const raw = readJsonPreference(UI_PREF_KEYS.conversationReasoningEfforts, storage);
  const result: Record<string, ConversationReasoningEffort> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (
        typeof value === 'string' &&
        (CONVERSATION_REASONING_EFFORTS as readonly string[]).includes(value)
      ) {
        result[key] = value as ConversationReasoningEffort;
      }
    }
  }
  return result;
}

export function writeConversationReasoningEfforts(
  efforts: Record<string, ConversationReasoningEffort>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  writeJsonPreference(UI_PREF_KEYS.conversationReasoningEfforts, efforts, storage);
}

export function readConversationReasoningEffort(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>,
): ConversationReasoningEffort | undefined {
  const id = conversationId.trim();
  if (!id) return undefined;
  return readConversationReasoningEfforts(storage)[id];
}

export function writeConversationReasoningEffort(
  conversationId: string,
  effort: ConversationReasoningEffort,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const id = conversationId.trim();
  if (!id) return;
  const current = { ...readConversationReasoningEfforts(storage) };
  current[id] = effort;
  writeConversationReasoningEfforts(current, storage);
}

export function readConversationNetworkPreferences(
  storage?: Pick<Storage, 'getItem'>,
): Record<string, boolean> {
  const raw = readJsonPreference(UI_PREF_KEYS.conversationNetworkEnabled, storage);
  const result: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [conversationId, enabled] of Object.entries(raw as Record<string, unknown>)) {
    if (conversationId.trim() && typeof enabled === 'boolean') {
      result[conversationId] = enabled;
    }
  }
  return result;
}

export function readConversationNetworkEnabled(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>,
): boolean | undefined {
  const id = conversationId.trim();
  if (!id) return undefined;
  return readConversationNetworkPreferences(storage)[id];
}

export function writeConversationNetworkEnabled(
  conversationId: string,
  enabled: boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const id = conversationId.trim();
  if (!id) return;
  const current = { ...readConversationNetworkPreferences(storage), [id]: enabled };
  writeJsonPreference(UI_PREF_KEYS.conversationNetworkEnabled, current, storage);
}

/** Max length for the greeting display name; keeps the welcome headline on one line. */
export const USER_NAME_MAX_LENGTH = 24;

export function readUserName(storage?: Pick<Storage, 'getItem'>): string {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(UI_PREF_KEYS.userName) : safeGet(UI_PREF_KEYS.userName);
  } catch {
    raw = null;
  }
  return (raw ?? '').trim().slice(0, USER_NAME_MAX_LENGTH);
}

export function writeUserName(name: string, storage?: Pick<Storage, 'setItem'>): void {
  const value = name.trim().slice(0, USER_NAME_MAX_LENGTH);
  if (storage) {
    try {
      storage.setItem(UI_PREF_KEYS.userName, value);
    } catch {
      /* ignore */
    }
    return;
  }
  safeSet(UI_PREF_KEYS.userName, value);
}

/**
 * Time-of-day greeting. Boundaries follow common zh-CN usage:
 * 凌晨 0–4, 早上 5–10, 上午 11, 中午 12, 下午 13–17, 晚上 18–23.
 */
export function greetingForHour(hour: number): string {
  if (!Number.isFinite(hour)) return '你好';
  const h = Math.floor(hour) % 24;
  if (h < 0) return '你好';
  if (h < 5) return '凌晨好';
  if (h < 11) return '早上好';
  if (h < 12) return '上午好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** Full greeting line, e.g. "晚上好，Kevin" or just "晚上好" when unnamed. */
export function buildGreeting(hour: number, userName: string): string {
  const greeting = greetingForHour(hour);
  const name = userName.trim();
  return name ? `${greeting}，${name}` : greeting;
}
