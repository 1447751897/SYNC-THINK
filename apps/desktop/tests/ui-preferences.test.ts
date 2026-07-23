import { describe, expect, it } from 'vitest';
import {
  readConversationLayoutPreference,
  readConversationTrackPreferences,
  readPinnedConversationIds,
  readRecentConversationSectionPreference,
  readThemePreference,
  readTraceCollapsedPreference,
  writeConversationLayoutPreference,
  writeConversationTrackPreferences,
  writePinnedConversationIds,
  writeRecentConversationSectionPreference,
  writeThemePreference,
  writeTraceCollapsedPreference,
  UI_PREF_KEYS,
} from '../src/renderer/ui-preferences.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  } as Storage;
}

describe('ui-preferences (Locked IA §15.2 workspace prefs)', () => {
  it('defaults conversation layout to split (default)', () => {
    const s = memoryStorage();
    expect(readConversationLayoutPreference(s)).toBe('default');
  });

  it('persists single-column conversation layout', () => {
    const s = memoryStorage();
    writeConversationLayoutPreference('single', s);
    expect(s.getItem(UI_PREF_KEYS.conversationLayout)).toBe('single');
    expect(readConversationLayoutPreference(s)).toBe('single');
  });

  it('defaults theme to system and rejects unknown values', () => {
    const s = memoryStorage({ [UI_PREF_KEYS.theme]: 'neon' });
    expect(readThemePreference(s)).toBe('system');
    writeThemePreference('dark', s);
    expect(readThemePreference(s)).toBe('dark');
  });

  it('defaults trace expanded and remembers collapse (does not imply run pause)', () => {
    const s = memoryStorage();
    expect(readTraceCollapsedPreference(s)).toBe(false);
    writeTraceCollapsedPreference(true, s);
    expect(s.getItem(UI_PREF_KEYS.traceCollapsed)).toBe('1');
    expect(readTraceCollapsedPreference(s)).toBe(true);
    writeTraceCollapsedPreference(false, s);
    expect(readTraceCollapsedPreference(s)).toBe(false);
  });

  it('persists recent conversation section disclosure and pinned ids', () => {
    const s = memoryStorage();
    expect(readRecentConversationSectionPreference(s)).toEqual({
      model: true,
      agent: true,
      team: true,
    });

    writeRecentConversationSectionPreference(
      { model: true, agent: false, team: true },
      s,
    );
    expect(readRecentConversationSectionPreference(s)).toEqual({
      model: true,
      agent: false,
      team: true,
    });

    writePinnedConversationIds(['task-1', 'task-2', 'task-1'], s);
    expect(readPinnedConversationIds(s)).toEqual(['task-1', 'task-2']);

    writeConversationTrackPreferences(
      { 'task-1': 'model', 'task-2': 'team' },
      s,
    );
    expect(readConversationTrackPreferences(s)).toEqual({
      'task-1': 'model',
      'task-2': 'team',
    });
  });

  it('ignores malformed recent conversation preferences', () => {
    const s = memoryStorage({
      [UI_PREF_KEYS.recentConversationSections]: '{broken',
      [UI_PREF_KEYS.pinnedConversations]: JSON.stringify(['ok', 2, '', 'ok']),
      [UI_PREF_KEYS.conversationTracks]: JSON.stringify({
        model: 'model',
        invalid: 'chat',
      }),
    });
    expect(readRecentConversationSectionPreference(s)).toEqual({
      model: true,
      agent: true,
      team: true,
    });
    expect(readPinnedConversationIds(s)).toEqual(['ok']);
    expect(readConversationTrackPreferences(s)).toEqual({ model: 'model' });
  });

  it('treats true string as collapsed', () => {
    const s = memoryStorage({ [UI_PREF_KEYS.traceCollapsed]: 'true' });
    expect(readTraceCollapsedPreference(s)).toBe(true);
  });
});
