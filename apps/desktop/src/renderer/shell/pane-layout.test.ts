import { describe, expect, it } from 'vitest';
import {
  activateFilePaneTab,
  activatePaneTab,
  activateReviewPaneTab,
  activateTerminalPaneTab,
  closeFilePaneTab,
  closePane,
  closePaneTab,
  closeReviewPaneTab,
  closeTerminalPaneTab,
  createWorkspacePaneLayout,
  focusedConversationId,
  migrateLegacyPaneLayouts,
  moveConversationToPane,
  openFileInPane,
  openConversationInPane,
  openTerminalInPane,
  paneConversationIds,
  parseWorkspacePaneLayout,
  parseWorkspacePaneLayouts,
  pruneWorkspacePaneLayout,
  replaceFileInPane,
  replaceConversationInPane,
  reorderPaneTabs,
  setSplitRatio,
  splitPaneWithConversation,
  splitPaneWithFile,
  splitPaneWithReview,
  updateTerminalPaneCwd,
} from './pane-layout.js';

function rootPaneId(layout: ReturnType<typeof createWorkspacePaneLayout>): string {
  expect(layout.root.type).toBe('pane');
  return layout.root.type === 'pane' ? layout.root.paneId : '';
}

describe('workspace pane layout', () => {
  it('creates one focused pane from legacy open tabs', () => {
    const layout = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c2');
    const paneId = rootPaneId(layout);

    expect(layout.focusedPaneId).toBe(paneId);
    expect(
      layout.panes[paneId]?.tabs
        .filter((tab) => tab.type === 'conversation')
        .map((tab) => tab.conversationId),
    ).toEqual(['c1', 'c2']);
    expect(layout.panes[paneId]?.activeTabId).toBe('conversation:c2');
    expect(focusedConversationId(layout)).toBe('c2');
  });

  it('recursively splits panes horizontally and vertically while moving an existing tab', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const firstPaneId = rootPaneId(initial);
    const horizontal = splitPaneWithConversation(initial, firstPaneId, 'horizontal', 'c2');

    expect(horizontal.root.type).toBe('split');
    expect(horizontal.root.type === 'split' ? horizontal.root.direction : '').toBe('horizontal');
    expect(
      horizontal.panes[firstPaneId]?.tabs
        .filter((tab) => tab.type === 'conversation')
        .map((tab) => tab.conversationId),
    ).toEqual(['c1']);
    expect(focusedConversationId(horizontal)).toBe('c2');

    const secondPaneId = horizontal.focusedPaneId;
    const vertical = splitPaneWithConversation(horizontal, secondPaneId, 'vertical', 'c3');
    expect(vertical.root.type).toBe('split');
    const right = vertical.root.type === 'split' ? vertical.root.children[1] : null;
    expect(right?.type).toBe('split');
    expect(right?.type === 'split' ? right.direction : '').toBe('vertical');
    expect(Object.keys(vertical.panes)).toHaveLength(3);
    expect(focusedConversationId(vertical)).toBe('c3');
  });

  it('deduplicates conversations across panes and reorders tabs inside one pane', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2', 'c3'], 'c1');
    const paneId = rootPaneId(initial);
    const reordered = reorderPaneTabs(initial, paneId, 'c3', 'c1');
    expect(paneConversationIds(reordered)).toEqual(['c3', 'c1', 'c2']);

    const reopened = openConversationInPane(reordered, 'c1');
    expect(paneConversationIds(reopened)).toEqual(['c3', 'c1', 'c2']);
    expect(focusedConversationId(reopened)).toBe('c1');
  });

  it('replaces a temporary conversation in place without changing tab order or focus', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'draft:ws-a:1', 'c2'], 'draft:ws-a:1');
    const paneId = rootPaneId(initial);
    const replaced = replaceConversationInPane(initial, 'draft:ws-a:1', 'created-conversation');

    expect(
      replaced.panes[paneId]?.tabs
        .filter((tab) => tab.type === 'conversation')
        .map((tab) => tab.conversationId),
    ).toEqual(['c1', 'created-conversation', 'c2']);
    expect(replaced.panes[paneId]?.activeTabId).toBe('conversation:created-conversation');
    expect(focusedConversationId(replaced)).toBe('created-conversation');
  });

  it('does not duplicate the replacement conversation when it is already open', () => {
    const initial = createWorkspacePaneLayout(
      'ws-a',
      ['c1', 'draft:ws-a:1', 'created-conversation'],
      'draft:ws-a:1',
    );
    const paneId = rootPaneId(initial);
    const replaced = replaceConversationInPane(initial, 'draft:ws-a:1', 'created-conversation');

    expect(paneConversationIds(replaced)).toEqual(['c1', 'created-conversation']);
    expect(replaced.panes[paneId]?.activeTabId).toBe('conversation:created-conversation');
  });

  it('clamps split ratios and supports keyboard-sized adjustments', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const split = splitPaneWithConversation(initial, rootPaneId(initial), 'horizontal', 'c2');
    expect(split.root.type).toBe('split');
    const splitId = split.root.id;

    expect(setSplitRatio(split, splitId, 0.02).root).toMatchObject({ ratio: 0.2 });
    expect(setSplitRatio(split, splitId, 0.98).root).toMatchObject({ ratio: 0.8 });
  });

  it('collapses an empty pane to its sibling and retains one empty root pane', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const split = splitPaneWithConversation(initial, rootPaneId(initial), 'horizontal', 'c2');
    const secondaryPaneId = split.focusedPaneId;
    const collapsed = closePaneTab(split, secondaryPaneId, 'c2');

    expect(collapsed.root.type).toBe('pane');
    expect(Object.keys(collapsed.panes)).toHaveLength(1);
    expect(focusedConversationId(collapsed)).toBe('c1');

    const onlyPaneId = collapsed.focusedPaneId;
    const empty = closePaneTab(collapsed, onlyPaneId, 'c1');
    expect(empty.root.type).toBe('pane');
    expect(empty.panes[onlyPaneId]?.tabs).toEqual([]);
    expect(focusedConversationId(empty)).toBeUndefined();
  });

  it('closes a nested pane and prunes stale conversations without leaving broken nodes', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const split = splitPaneWithConversation(initial, rootPaneId(initial), 'horizontal', 'c2');
    const secondaryPaneId = split.focusedPaneId;

    const closed = closePane(split, secondaryPaneId);
    expect(closed.root.type).toBe('pane');
    expect(paneConversationIds(closed)).toEqual(['c1']);

    const pruned = pruneWorkspacePaneLayout(split, new Set(['c1']));
    expect(pruned.root.type).toBe('pane');
    expect(paneConversationIds(pruned)).toEqual(['c1']);
  });

  it('migrates old workspace tabs once without replacing an existing pane snapshot', () => {
    const existing = createWorkspacePaneLayout('ws-a', ['new-a'], 'new-a');
    const migrated = migrateLegacyPaneLayouts(
      { 'ws-a': existing },
      { 'ws-a': ['old-a'], 'ws-b': ['b1', 'b2'] },
      { 'ws-a': 'old-a', 'ws-b': 'b1' },
    );

    expect(paneConversationIds(migrated['ws-a']!)).toEqual(['new-a']);
    expect(paneConversationIds(migrated['ws-b']!)).toEqual(['b1', 'b2']);
    expect(focusedConversationId(migrated['ws-b']!)).toBe('b1');
  });

  it('activates a tab in a specific pane and updates focus', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const paneId = rootPaneId(initial);
    const next = activatePaneTab(initial, paneId, 'c2');
    expect(next.focusedPaneId).toBe(paneId);
    expect(focusedConversationId(next)).toBe('c2');
  });

  it('stores file tabs by path and reuses an already open file tab', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const paneId = rootPaneId(initial);
    const opened = openFileInPane(initial, 'src/index.ts');
    const reopened = openFileInPane(opened, 'src/index.ts');

    expect(reopened.panes[paneId]?.tabs).toEqual([
      expect.objectContaining({ type: 'conversation', conversationId: 'c1' }),
      expect.objectContaining({ type: 'file', path: 'src/index.ts' }),
    ]);
    expect(reopened.panes[paneId]?.activeTabId).toBe('file:src/index.ts');
  });

  it('activates and closes file tabs without deleting conversation resources', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const paneId = rootPaneId(initial);
    const opened = openFileInPane(initial, 'src/index.ts');
    const conversationActive = activatePaneTab(opened, paneId, 'c1');

    const fileActive = activateFilePaneTab(conversationActive, paneId, 'src/index.ts');
    expect(fileActive.panes[paneId]?.activeTabId).toBe('file:src/index.ts');

    const closed = closeFilePaneTab(fileActive, paneId, 'src/index.ts');
    expect(closed.panes[paneId]?.tabs).toEqual([
      expect.objectContaining({ type: 'conversation', conversationId: 'c1' }),
    ]);
    expect(closed.panes[paneId]?.activeTabId).toBe('conversation:c1');
  });

  it('opens files and reviews in one neighboring resource pane', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const conversationPaneId = rootPaneId(initial);
    const withFirstFile = splitPaneWithFile(initial, conversationPaneId, 'src/first.ts');
    const resourcePaneId = withFirstFile.focusedPaneId;
    const withSecondFile = splitPaneWithFile(withFirstFile, conversationPaneId, 'src/second.ts');
    const withReview = splitPaneWithReview(withSecondFile, conversationPaneId, 'run-1');

    expect(Object.keys(withReview.panes)).toHaveLength(2);
    expect(withReview.focusedPaneId).toBe(resourcePaneId);
    expect(withReview.panes[conversationPaneId]?.tabs).toEqual([
      expect.objectContaining({ type: 'conversation', conversationId: 'c1' }),
    ]);
    expect(withReview.panes[resourcePaneId]?.tabs).toEqual([
      expect.objectContaining({ type: 'file', path: 'src/first.ts' }),
      expect.objectContaining({ type: 'file', path: 'src/second.ts' }),
      expect.objectContaining({ type: 'review', runId: 'run-1' }),
    ]);
    expect(withReview.panes[resourcePaneId]?.activeTabId).toBe('review:run-1');
  });

  it('focuses existing file and review resources instead of duplicating them', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const conversationPaneId = rootPaneId(initial);
    const withFile = splitPaneWithFile(initial, conversationPaneId, 'src/index.ts');
    const resourcePaneId = withFile.focusedPaneId;
    const withReview = splitPaneWithReview(withFile, conversationPaneId, 'run-1');
    const fileFocused = splitPaneWithFile(withReview, conversationPaneId, 'src/index.ts');
    const reviewFocused = splitPaneWithReview(fileFocused, conversationPaneId, 'run-1');

    expect(Object.keys(reviewFocused.panes)).toHaveLength(2);
    expect(reviewFocused.panes[resourcePaneId]?.tabs).toHaveLength(2);
    expect(fileFocused.panes[resourcePaneId]?.activeTabId).toBe('file:src/index.ts');
    expect(reviewFocused.panes[resourcePaneId]?.activeTabId).toBe('review:run-1');
  });

  it('restores, activates, and closes review resources', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const conversationPaneId = rootPaneId(initial);
    const opened = splitPaneWithReview(initial, conversationPaneId, 'run-1');
    const reviewPaneId = opened.focusedPaneId;
    const restored = parseWorkspacePaneLayout(JSON.parse(JSON.stringify(opened)));

    expect(restored?.panes[reviewPaneId]?.tabs).toContainEqual({
      id: 'review:run-1',
      type: 'review',
      runId: 'run-1',
    });

    const activated = activateReviewPaneTab(restored!, reviewPaneId, 'run-1');
    expect(activated.focusedPaneId).toBe(reviewPaneId);
    expect(activated.panes[reviewPaneId]?.activeTabId).toBe('review:run-1');

    const closed = closeReviewPaneTab(activated, reviewPaneId, 'run-1');
    expect(Object.keys(closed.panes)).toEqual([conversationPaneId]);
    expect(closed.root.type).toBe('pane');
  });

  it('reuses the current file tab when the embedded explorer opens another file', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const paneId = rootPaneId(initial);
    const opened = openFileInPane(initial, 'src/first.ts', paneId);
    const replaced = replaceFileInPane(opened, paneId, 'src/first.ts', 'src/second.ts');

    expect(replaced.panes[paneId]?.tabs).toEqual([
      expect.objectContaining({ type: 'conversation', conversationId: 'c1' }),
      expect.objectContaining({ type: 'file', path: 'src/second.ts' }),
    ]);
    expect(replaced.panes[paneId]?.activeTabId).toBe('file:src/second.ts');
  });

  it('activates an existing destination instead of duplicating it when replacing a file tab', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const paneId = rootPaneId(initial);
    const withFirst = openFileInPane(initial, 'src/first.ts', paneId);
    const withSecond = openFileInPane(withFirst, 'src/second.ts', paneId);
    const replaced = replaceFileInPane(withSecond, paneId, 'src/first.ts', 'src/second.ts');

    expect(replaced.panes[paneId]?.tabs.filter((tab) => tab.type === 'file')).toEqual([
      expect.objectContaining({ type: 'file', path: 'src/second.ts' }),
    ]);
    expect(replaced.panes[paneId]?.activeTabId).toBe('file:src/second.ts');
  });

  it('opens, restores, activates, and closes a terminal tab as a pane resource', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1'], 'c1');
    const paneId = rootPaneId(initial);
    const opened = openTerminalInPane(initial, 'terminal-one', 'src');

    expect(opened.panes[paneId]?.activeTabId).toBe('terminal:terminal-one');
    expect(opened.panes[paneId]?.tabs).toContainEqual({
      id: 'terminal:terminal-one',
      type: 'terminal',
      terminalId: 'terminal-one',
      cwd: 'src',
    });

    const restored = parseWorkspacePaneLayout(JSON.parse(JSON.stringify(opened)));
    expect(restored?.panes[paneId]?.tabs).toContainEqual(
      expect.objectContaining({ type: 'terminal', terminalId: 'terminal-one', cwd: 'src' }),
    );

    const conversationActive = activatePaneTab(restored!, paneId, 'c1');
    const terminalActive = activateTerminalPaneTab(conversationActive, paneId, 'terminal-one');
    expect(terminalActive.panes[paneId]?.activeTabId).toBe('terminal:terminal-one');

    const movedCwd = updateTerminalPaneCwd(terminalActive, paneId, 'terminal-one', 'src/app');
    expect(movedCwd.panes[paneId]?.tabs).toContainEqual(
      expect.objectContaining({ type: 'terminal', terminalId: 'terminal-one', cwd: 'src/app' }),
    );

    const closed = closeTerminalPaneTab(movedCwd, paneId, 'terminal-one');
    expect(closed.panes[paneId]?.tabs.some((tab) => tab.type === 'terminal')).toBe(false);
    expect(closed.panes[paneId]?.activeTabId).toBe('conversation:c1');
  });

  it('moves tabs across panes and collapses a source pane that becomes empty', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2', 'c3'], 'c1');
    const firstPaneId = rootPaneId(initial);
    const split = splitPaneWithConversation(initial, firstPaneId, 'horizontal', 'c2');
    const secondPaneId = split.focusedPaneId;

    const moved = moveConversationToPane(split, 'c3', secondPaneId);
    expect(
      moved.panes[firstPaneId]?.tabs.map(
        (tab) => tab.type === 'conversation' && tab.conversationId,
      ),
    ).toEqual(['c1']);
    expect(
      moved.panes[secondPaneId]?.tabs.map(
        (tab) => tab.type === 'conversation' && tab.conversationId,
      ),
    ).toEqual(['c2', 'c3']);
    expect(focusedConversationId(moved)).toBe('c3');

    const collapsed = moveConversationToPane(moved, 'c1', secondPaneId);
    expect(collapsed.root.type).toBe('pane');
    expect(Object.keys(collapsed.panes)).toEqual([secondPaneId]);
    expect(paneConversationIds(collapsed)).toEqual(['c2', 'c3', 'c1']);
  });

  it('enforces the persisted tab limit while preserving the active tab', () => {
    const ids = Array.from({ length: 101 }, (_, index) => `c${index + 1}`);
    const initial = createWorkspacePaneLayout('ws-a', ids, 'c1');

    expect(paneConversationIds(initial)).toHaveLength(100);
    expect(paneConversationIds(initial)).toContain('c1');
    expect(paneConversationIds(initial)).toContain('c101');
    expect(focusedConversationId(initial)).toBe('c1');

    const restored = parseWorkspacePaneLayout(JSON.parse(JSON.stringify(initial)));
    expect(restored).not.toBeNull();
    expect(paneConversationIds(restored!)).toHaveLength(100);
    expect(focusedConversationId(restored!)).toBe('c1');

    const opened = openConversationInPane(restored!, 'c102');
    expect(paneConversationIds(opened)).toHaveLength(100);
    expect(paneConversationIds(opened)).toContain('c102');
    expect(focusedConversationId(opened)).toBe('c102');
  });

  it('never evicts terminal or file resources when enforcing the tab limit', () => {
    const ids = Array.from({ length: 98 }, (_, index) => `c${index + 1}`);
    const initial = createWorkspacePaneLayout('ws-a', ids, 'c1');
    const paneId = rootPaneId(initial);
    const withFile = openFileInPane(initial, 'src/kept.ts', paneId);
    const withTerminal = openTerminalInPane(withFile, 'terminal-running', '', paneId);
    const overflowed = openConversationInPane(withTerminal, 'c-overflow', paneId);

    expect(overflowed.panes[paneId]?.tabs).toHaveLength(100);
    expect(overflowed.panes[paneId]?.tabs).toContainEqual(
      expect.objectContaining({ type: 'file', path: 'src/kept.ts' }),
    );
    expect(overflowed.panes[paneId]?.tabs).toContainEqual(
      expect.objectContaining({ type: 'terminal', terminalId: 'terminal-running' }),
    );
    expect(overflowed.panes[paneId]?.activeTabId).toBe('conversation:c-overflow');
  });

  it('blocks a new stateful resource when all 100 tabs require lifecycle preservation', () => {
    let layout = createWorkspacePaneLayout('ws-a');
    const paneId = rootPaneId(layout);
    for (let index = 0; index < 100; index += 1) {
      layout = openTerminalInPane(layout, `terminal-${index}`, '', paneId);
    }
    const overflowed = openTerminalInPane(layout, 'terminal-overflow', '', paneId);

    expect(overflowed).toBe(layout);
    expect(overflowed.panes[paneId]?.tabs).toHaveLength(100);
    expect(
      overflowed.panes[paneId]?.tabs.some(
        (tab) => tab.type === 'terminal' && tab.terminalId === 'terminal-overflow',
      ),
    ).toBe(false);
  });

  it('rejects reserved record keys in pane snapshots without throwing', () => {
    const raw = JSON.parse(`{
      "version": 1,
      "panes": {
        "__proto__": {
          "id": "__proto__",
          "tabs": [{
            "id": "conversation:c1",
            "type": "conversation",
            "conversationId": "c1"
          }],
          "activeTabId": "conversation:c1"
        }
      },
      "focusedPaneId": "__proto__",
      "root": { "type": "pane", "id": "node", "paneId": "__proto__" }
    }`) as unknown;
    let parsed: ReturnType<typeof parseWorkspacePaneLayout>;

    expect(() => {
      parsed = parseWorkspacePaneLayout(raw);
    }).not.toThrow();
    expect(parsed!).toBeNull();
  });

  it('skips reserved workspace keys in snapshots and legacy migration', () => {
    const layout = createWorkspacePaneLayout('safe', ['c1'], 'c1');
    const raw = JSON.parse(
      JSON.stringify({
        version: 1,
        workspaces: {
          ['__proto__']: layout,
          constructor: layout,
          prototype: layout,
          safe: layout,
        },
      }),
    ) as unknown;
    const parsed = parseWorkspacePaneLayouts(raw);

    expect(Object.keys(parsed)).toEqual(['safe']);
    expect(Object.hasOwn(parsed, '__proto__')).toBe(false);
    expect(Object.hasOwn(parsed, 'constructor')).toBe(false);
    expect(Object.hasOwn(parsed, 'prototype')).toBe(false);

    const legacyOpen = JSON.parse(
      '{"__proto__":["bad-a"],"constructor":["bad-b"],"prototype":["bad-c"],"safe":["c1"]}',
    ) as Record<string, string[]>;
    const migrated = migrateLegacyPaneLayouts({}, legacyOpen, {});
    expect(Object.keys(migrated)).toEqual(['safe']);
  });
});
