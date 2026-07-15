// Workspace UI preferences (product §15.2 / §10.1 L3 soft craft).
// M1: renderer localStorage — calm, restart-safe, no Runtime dependency.

export type ConversationLayoutPreference = 'default' | 'single';
export type ThemePreference = 'light' | 'dark' | 'system';

export const UI_PREF_KEYS = {
  conversationLayout: 'sync-think.conversationLayout',
  theme: 'sync-think.theme',
  traceCollapsed: 'sync-think.traceCollapsed',
} as const;

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
