import { describe, expect, it } from 'vitest';
import { createWorkspacePaneLayout } from './pane-layout.js';
import { browserWorkbenchTab, createWorkspaceWorkbenchLayout, fileWorkbenchTab, openWorkbenchTab } from './workspace-workbench.js';
import { materializeWorkbenchScope, migrateConversationWorkbenches, parseWorkbenchScopeKey, workbenchScopeKey, workbenchesForWorkspace } from './conversation-workbench.js';

const browser = (id: string, ownerId?: string) => ({ ...browserWorkbenchTab(id, 'https://same.test'), ownerId });

describe('conversation workbench scopes', () => {
  it('uses collision-free keys for projects, conversations and anonymous scopes', () => {
    const keys = [workbenchScopeKey('a:b', 'c'), workbenchScopeKey('a', 'b:c'), workbenchScopeKey('a'), workbenchScopeKey('a', 'null')];
    expect(new Set(keys).size).toBe(4);
    expect(parseWorkbenchScopeKey(keys[0])).toEqual({ workspaceId: 'a:b', conversationId: 'c' });
    expect(parseWorkbenchScopeKey(keys[2])).toEqual({ workspaceId: 'a', conversationId: undefined });
    for (const value of ['ws', 'conversation:bad', 'conversation:[1,null]', 'conversation:["ws",""]', 'conversation:["ws",null,1]']) expect(parseWorkbenchScopeKey(value)).toBeNull();
  });

  it('assigns unowned files and browsers only to the last selected conversation', () => {
    const old = openWorkbenchTab(openWorkbenchTab(createWorkspaceWorkbenchLayout(), 'right', fileWorkbenchTab('AGENTS.md')), 'right', browser('manual'));
    const migrated = migrateConversationWorkbenches({ ws: old }, { ws: createWorkspacePaneLayout('ws', ['a', 'b'], 'b') }, { ws: 'a' });
    expect(Object.keys(migrated.layouts)).toEqual([workbenchScopeKey('ws', 'a')]);
    expect(migrated.layouts[workbenchScopeKey('ws', 'a')]).toEqual(old);
    expect(migrated.layouts[workbenchScopeKey('ws', 'b')]).toBeUndefined();
    expect(migrateConversationWorkbenches(migrated.layouts, {}, {}).layouts).toBe(migrated.layouts);
  });

  it('splits old owned browser guests without changing IDs, URLs or partitions', () => {
    let old = openWorkbenchTab(createWorkspaceWorkbenchLayout(), 'right', fileWorkbenchTab('AGENTS.md'));
    old = openWorkbenchTab(old, 'right', browser('one', 'a'));
    old = openWorkbenchTab(old, 'right', browser('two', 'b'));
    const result = migrateConversationWorkbenches({ ws: old }, {}, { ws: 'a' }).layouts;
    const a = result[workbenchScopeKey('ws', 'a')].right;
    const b = result[workbenchScopeKey('ws', 'b')].right;
    expect(a.tabs.map(tab => tab.id)).toEqual(['workspace-files', 'file:AGENTS.md', 'browser:one']);
    expect(a.activeTabId).toBe('browser:one');
    expect(b.tabs).toEqual([browser('two', 'b')]);
    expect(b.activeTabId).toBe('browser:two');
  });

  it('preserves existing scopes during a repeated/interrupted legacy migration', () => {
    const existing = openWorkbenchTab(createWorkspaceWorkbenchLayout(), 'right', browser('one', 'a'));
    const legacy = openWorkbenchTab(existing, 'right', fileWorkbenchTab('note.md'));
    const result = migrateConversationWorkbenches({ ws: legacy, [workbenchScopeKey('ws', 'a')]: existing }, {}, { ws: 'a' }).layouts;
    expect(result[workbenchScopeKey('ws', 'a')].right.tabs).toHaveLength(3);
  });

  it('preserves empty panel sizes/open state and falls back to the focused conversation', () => {
    const old = createWorkspaceWorkbenchLayout();
    old.right = { ...old.right, size: 850, fileBrowserOpen: true };
    const result = migrateConversationWorkbenches({ ws: old }, { ws: createWorkspacePaneLayout('ws', ['b'], 'b') }, {}).layouts;
    expect(result[workbenchScopeKey('ws', 'b')]).toEqual(old);
  });

  it('moves draft resources and browser ownership to the persisted conversation once', () => {
    const key = workbenchScopeKey('ws', 'draft:a');
    const old = openWorkbenchTab(createWorkspaceWorkbenchLayout(), 'right', browser('guest', 'draft:a'));
    const untouched = createWorkspaceWorkbenchLayout();
    const result = materializeWorkbenchScope({ [key]: old, [workbenchScopeKey('other', 'a')]: untouched }, 'ws', 'draft:a', 'a');
    expect(result[key]).toBeUndefined();
    expect(result[workbenchScopeKey('ws', 'a')].right.tabs[0]).toMatchObject({ browserId: 'guest', ownerId: 'a' });
    expect(result[workbenchScopeKey('other', 'a')]).toBe(untouched);
    expect(workbenchesForWorkspace(result, 'ws')).toHaveLength(1);
    expect(materializeWorkbenchScope(result, 'ws', 'draft:a', 'a')).toBe(result);
  });
});
