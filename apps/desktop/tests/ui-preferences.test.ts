import { describe, expect, it } from 'vitest';
import {
  applyFontSizePreference,
  readConversationLayoutPreference,
  readFontSizePreference,
  readThemePreference,
  readTraceCollapsedPreference,
  writeConversationLayoutPreference,
  writeFontSizePreference,
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

  it('treats true string as collapsed', () => {
    const s = memoryStorage({ [UI_PREF_KEYS.traceCollapsed]: 'true' });
    expect(readTraceCollapsedPreference(s)).toBe(true);
  });

  it('persists a bounded application font size and rejects invalid stored values', () => {
    const s = memoryStorage();
    expect(readFontSizePreference(s)).toBe(14);

    writeFontSizePreference(17, s);
    expect(s.getItem(UI_PREF_KEYS.fontSize)).toBe('17');
    expect(readFontSizePreference(s)).toBe(17);

    s.setItem(UI_PREF_KEYS.fontSize, '42');
    expect(readFontSizePreference(s)).toBe(14);
  });

  it('applies font size variables without scaling fixed layout geometry', () => {
    const attributes = new Map<string, string>();
    const properties = new Map<string, string>();
    applyFontSizePreference(
      {
        setAttribute: (name, value) => attributes.set(name, value),
        style: { setProperty: (name, value) => properties.set(name, value) },
      },
      16,
    );

    expect(attributes.get('data-st-font-size')).toBe('16');
    expect(properties.get('--st-user-font-size')).toBe('16px');
    expect(properties.get('--st-user-font-scale')).toBe(String(16 / 14));
  });
});
