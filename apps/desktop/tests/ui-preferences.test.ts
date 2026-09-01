import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_PREFERENCES,
  readAgentPreferences,
  readConversationGroups,
  readConversationLayoutPreference,
  readConversationTrackPreferences,
  readWorkspacePaneLayouts,
  readPinnedConversationIds,
  readRecentConversationSectionPreference,
  readThemePreference,
  readTraceCollapsedPreference,
  writeConversationGroups,
  writeAgentPreferences,
  writeConversationLayoutPreference,
  writeConversationTrackPreferences,
  writeWorkspacePaneLayouts,
  writePinnedConversationIds,
  writeRecentConversationSectionPreference,
  writeThemePreference,
  writeTraceCollapsedPreference,
  UI_PREF_KEYS,
} from '../src/renderer/ui-preferences.js';
import {
  createWorkspacePaneLayout,
  paneConversationIds,
} from '../src/renderer/shell/pane-layout.js';

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

  it('persists NewMax-style Agent defaults and rejects malformed values', () => {
    const s = memoryStorage();
    expect(readAgentPreferences(s)).toEqual(DEFAULT_AGENT_PREFERENCES);

    writeAgentPreferences(
      {
        promptEnhancementEnabled: false,
        promptEnhancementModelId: 'model-fast',
        thinkingBudget: 'minimal',
        collapseExecutionProcess: false,
        showToolUse: false,
        toolCallExpandedByDefault: true,
      },
      s,
    );
    expect(readAgentPreferences(s)).toEqual({
      promptEnhancementEnabled: false,
      promptEnhancementModelId: 'model-fast',
      thinkingBudget: 'minimal',
      collapseExecutionProcess: false,
      showToolUse: false,
      toolCallExpandedByDefault: true,
    });

    s.setItem(
      UI_PREF_KEYS.agentPreferences,
      JSON.stringify({
        promptEnhancementEnabled: 'yes',
        promptEnhancementModelId: 42,
        thinkingBudget: 'impossible',
        collapseExecutionProcess: 0,
        showToolUse: null,
        toolCallExpandedByDefault: 'true',
      }),
    );
    expect(readAgentPreferences(s)).toEqual(DEFAULT_AGENT_PREFERENCES);
  });

  it('persists recent conversation section disclosure and pinned ids', () => {
    const s = memoryStorage();
    expect(readRecentConversationSectionPreference(s)).toEqual({
      model: true,
      agent: true,
      team: true,
    });

    writeRecentConversationSectionPreference({ model: true, agent: false, team: true }, s);
    expect(readRecentConversationSectionPreference(s)).toEqual({
      model: true,
      agent: false,
      team: true,
    });

    writePinnedConversationIds(['task-1', 'task-2', 'task-1'], s);
    expect(readPinnedConversationIds(s)).toEqual(['task-1', 'task-2']);

    writeConversationTrackPreferences({ 'task-1': 'model', 'task-2': 'team' }, s);
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

  it('isolates conversation groups by workspace', () => {
    const s = memoryStorage();
    writeConversationGroups(
      'ws-a',
      {
        model: [{ id: 'group-a', name: 'A', conversationIds: ['conv-a'] }],
        agent: [],
        team: [],
      },
      s,
    );
    writeConversationGroups(
      'ws-b',
      {
        model: [],
        agent: [{ id: 'group-b', name: 'B', conversationIds: ['conv-b'] }],
        team: [],
      },
      s,
    );

    expect(readConversationGroups('ws-a', s).model[0]?.conversationIds).toEqual(['conv-a']);
    expect(readConversationGroups('ws-a', s).agent).toEqual([]);
    expect(readConversationGroups('ws-b', s).model).toEqual([]);
    expect(readConversationGroups('ws-b', s).agent[0]?.conversationIds).toEqual(['conv-b']);
    expect(readConversationGroups(undefined, s)).toEqual({ model: [], agent: [], team: [] });
  });

  it('migrates the former global conversation groups only into the active workspace', () => {
    const legacy = {
      model: [{ id: 'legacy', name: '旧分组', conversationIds: ['conv-a', 'conv-a'] }],
      agent: [],
      team: [],
    };
    const s = memoryStorage({
      [UI_PREF_KEYS.conversationGroups]: JSON.stringify(legacy),
    });

    expect(readConversationGroups('ws-a', s).model[0]).toEqual({
      id: 'legacy',
      name: '旧分组',
      collapsed: false,
      conversationIds: ['conv-a'],
    });
    expect(readConversationGroups('ws-b', s)).toEqual({ model: [], agent: [], team: [] });
    expect(JSON.parse(s.getItem(UI_PREF_KEYS.conversationGroups) ?? '{}')).toEqual({
      version: 2,
      workspaces: {
        'ws-a': {
          model: [
            {
              id: 'legacy',
              name: '旧分组',
              collapsed: false,
              conversationIds: ['conv-a'],
            },
          ],
          agent: [],
          team: [],
        },
      },
    });
  });

  it('persists versioned pane snapshots and drops malformed workspace entries', () => {
    const s = memoryStorage();
    const layout = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c2');
    writeWorkspacePaneLayouts({ 'ws-a': layout }, s);

    const restored = readWorkspacePaneLayouts(s);
    expect(paneConversationIds(restored['ws-a']!)).toEqual(['c1', 'c2']);

    s.setItem(
      UI_PREF_KEYS.workspacePaneLayouts,
      JSON.stringify({
        version: 1,
        workspaces: {
          broken: { version: 1, panes: {}, root: { type: 'pane', id: 'n', paneId: 'gone' } },
          'ws-a': layout,
        },
      }),
    );
    expect(Object.keys(readWorkspacePaneLayouts(s))).toEqual(['ws-a']);
  });
});
