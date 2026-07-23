// Workspace UI preferences (product §15.2 / §10.1 L3 soft craft).
// M1: renderer localStorage — calm, restart-safe, no Runtime dependency.

export type ConversationLayoutPreference = 'default' | 'single';
export type ThemePreference = 'light' | 'dark' | 'system';

export const UI_PREF_KEYS = {
  conversationLayout: 'sync-think.conversationLayout',
  theme: 'sync-think.theme',
  traceCollapsed: 'sync-think.traceCollapsed',
  recentConversationSections: 'sync-think.recentConversationSections',
  pinnedConversations: 'sync-think.pinnedConversations',
  conversationTracks: 'sync-think.conversationTracks',
} as const;

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

export function readThemePreference(
  storage?: Pick<Storage, 'getItem'>,
): ThemePreference {
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

/** Default: expanded (false). Collapsing does not pause Run — only UI rail. */
export function readTraceCollapsedPreference(
  storage?: Pick<Storage, 'getItem'>,
): boolean {
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

function readJsonPreference(
  key: string,
  storage?: Pick<Storage, 'getItem'>,
): unknown {
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

export function readPinnedConversationIds(
  storage?: Pick<Storage, 'getItem'>,
): readonly string[] {
  const raw = readJsonPreference(UI_PREF_KEYS.pinnedConversations, storage);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))];
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
