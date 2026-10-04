import { describe, expect, it } from 'vitest';
import { migrateLocalPageBrowsersToWorkbench } from './local-page-workbench.js';
import {
  activatePaneTab,
  createWorkspacePaneLayout,
  openBrowserInPane,
} from './pane-layout.js';
import {
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  openWorkbenchTab,
} from './workspace-workbench.js';

function fixture(scheme = 'sync-think-local-web') {
  const chat = createWorkspacePaneLayout('ws-a', ['conv-a'], 'conv-a');
  const panes = {
    'ws-a': openBrowserInPane(chat, 'saved-preview', `${scheme}://token/pelican.html`),
  };
  const workbenches = {
    'ws-a': openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      fileWorkbenchTab('AGENTS.md'),
    ),
  };
  return { chat, panes, workbenches };
}

describe('local HTML workbench migration', () => {
  it.each(['sync-think-local-web', 'newmax-local-web'])(
    'restores %s previews beside the chat without discarding the editor',
    (scheme) => {
      const { panes, workbenches } = fixture(scheme);
      const originalBrowser = panes['ws-a'].panes[panes['ws-a'].focusedPaneId].tabs.find(
        (tab) => tab.type === 'browser',
      )!;
      const result = migrateLocalPageBrowsersToWorkbench(panes, workbenches);
      expect(result.migrated).toBe(true);
      const left = result.panes['ws-a'].panes[result.panes['ws-a'].focusedPaneId];
      expect(left.tabs).toEqual([
        expect.objectContaining({ type: 'conversation', conversationId: 'conv-a' }),
      ]);
      expect(left.activeTabId).toBe('conversation:conv-a');
      expect(result.workbenches['ws-a'].right.tabs).toContainEqual(
        expect.objectContaining({ type: 'file', path: 'AGENTS.md' }),
      );
      expect(result.workbenches['ws-a'].right.tabs).toContainEqual({
        ...originalBrowser,
        url: 'sync-think-local-web://token/pelican.html',
      });
      expect(result.workbenches['ws-a'].right.activeTabId).toBe(originalBrowser.id);
      expect(result.workbenches['ws-a'].right.open).toBe(true);
    },
  );

  it('keeps the right editor active when the saved local preview was inactive', () => {
    const { panes, workbenches } = fixture();
    const paneId = panes['ws-a'].focusedPaneId;
    panes['ws-a'] = activatePaneTab(panes['ws-a'], paneId, 'conv-a');
    const result = migrateLocalPageBrowsersToWorkbench(panes, workbenches);
    expect(result.workbenches['ws-a'].right.activeTabId).toBe(
      workbenches['ws-a'].right.activeTabId,
    );
    expect(result.workbenches['ws-a'].right.size).toBe(workbenches['ws-a'].right.size);
    expect(result.panes['ws-a'].panes[paneId].activeTabId).toBe('conversation:conv-a');
  });

  it('preserves the browser owner and partition identity and does not duplicate a partially migrated tab', () => {
    const { panes, workbenches } = fixture();
    const pane = panes['ws-a'].panes[panes['ws-a'].focusedPaneId];
    const tab = pane.tabs.find((tab) => tab.type === 'browser')!;
    tab.ownerId = 'thread-a';
    workbenches['ws-a'] = openWorkbenchTab(workbenches['ws-a'], 'right', tab);
    const result = migrateLocalPageBrowsersToWorkbench(panes, workbenches);
    expect(result.workbenches['ws-a'].right.tabs.filter((item) => item.id === tab.id)).toEqual([
      tab,
    ]);
    expect(result.workbenches['ws-a'].right.tabs.find((item) => item.id === tab.id)).toMatchObject({
      browserId: 'saved-preview',
      ownerId: 'thread-a',
    });
    const again = migrateLocalPageBrowsersToWorkbench(result.panes, result.workbenches);
    expect(again.migrated).toBe(false);
    expect(again.panes).toBe(result.panes);
    expect(again.workbenches).toBe(result.workbenches);
  });

  it('leaves explicitly opened website panes untouched and does not mutate inputs', () => {
    const { chat, workbenches } = fixture();
    const panes = { 'ws-a': openBrowserInPane(chat, 'manual-browser', 'https://example.test') };
    const before = JSON.stringify({ panes, workbenches });
    const result = migrateLocalPageBrowsersToWorkbench(panes, workbenches);
    expect(result.migrated).toBe(false);
    expect(result.panes).toBe(panes);
    expect(result.workbenches).toBe(workbenches);
    expect(JSON.stringify({ panes, workbenches })).toBe(before);
  });

  it('repairs a browser-only pane without losing the preview or leaving a browser in the chat', () => {
    const pane = openBrowserInPane(
      createWorkspacePaneLayout('ws-a'),
      'saved-preview',
      'sync-think-local-web://token/pelican.html',
    );
    const result = migrateLocalPageBrowsersToWorkbench({ 'ws-a': pane }, {});
    expect(
      Object.values(result.panes['ws-a'].panes)
        .flatMap((pane) => pane.tabs)
        .some((tab) => tab.type === 'browser'),
    ).toBe(false);
    expect(result.workbenches['ws-a'].right.tabs).toHaveLength(1);
    expect(result.workbenches['ws-a'].right.open).toBe(true);
  });
});
