import { describe, expect, it } from 'vitest';
import {
  activateWorkbenchTab,
  browserWorkbenchTab,
  closeWorkbenchTab,
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  openWorkbenchTab,
  parseWorkspaceWorkbenchLayouts,
  reviewWorkbenchTab,
  setWorkbenchFileBrowserWidth,
  setWorkbenchOpen,
  setWorkbenchSize,
  terminalWorkbenchTab,
  toggleWorkspaceFilesWorkbench,
  WORKBENCH_BOTTOM_MAX_HEIGHT,
  WORKBENCH_FILE_BROWSER_MIN_WIDTH,
  WORKBENCH_RIGHT_COMPACT_WIDTH,
  WORKBENCH_RIGHT_MAX_WIDTH,
  WORKBENCH_RIGHT_PREVIEW_WIDTH,
  workspaceFilesWorkbenchTab,
} from './workspace-workbench.js';

describe('workspace workbench state', () => {
  it('opens compact files and expands the right workbench for preview resources', () => {
    const initial = createWorkspaceWorkbenchLayout();
    const files = openWorkbenchTab(initial, 'right', workspaceFilesWorkbenchTab());
    expect(files.right).toMatchObject({ open: true, activeTabId: 'workspace-files' });
    expect(files.right.size).toBe(WORKBENCH_RIGHT_COMPACT_WIDTH);

    const preview = openWorkbenchTab(files, 'right', fileWorkbenchTab('src/app.ts'));
    expect(preview.right.size).toBe(WORKBENCH_RIGHT_PREVIEW_WIDTH);
    expect(preview.right.tabs.map((tab) => tab.id)).toEqual(['workspace-files', 'file:src/app.ts']);
    expect(preview.right.activeTabId).toBe('file:src/app.ts');

    const compactAgain = closeWorkbenchTab(preview, 'right', 'file:src/app.ts');
    expect(compactAgain.right.size).toBe(WORKBENCH_RIGHT_COMPACT_WIDTH);

    const documentOnly = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      fileWorkbenchTab('notes.md'),
    );
    expect(documentOnly.right.tabs.map((tab) => tab.id)).toEqual([
      'workspace-files',
      'file:notes.md',
    ]);
    expect(documentOnly.right.activeTabId).toBe('file:notes.md');
    expect(documentOnly.right.fileBrowserOpen).toBe(false);
  });

  it('moves a stateful resource between placements and collapses an empty scope', () => {
    const initial = createWorkspaceWorkbenchLayout();
    const bottom = openWorkbenchTab(initial, 'bottom', terminalWorkbenchTab('terminal-1'));
    const right = openWorkbenchTab(bottom, 'right', terminalWorkbenchTab('terminal-1'));
    expect(right.bottom).toMatchObject({ open: false, tabs: [] });
    expect(right.right.tabs).toContainEqual(
      expect.objectContaining({ type: 'terminal', terminalId: 'terminal-1' }),
    );

    const closed = closeWorkbenchTab(right, 'right', 'terminal:terminal-1');
    expect(closed.right).toMatchObject({
      open: true,
      activeTabId: 'workspace-files',
      tabs: [{ id: 'workspace-files', type: 'workspace-files' }],
    });
  });

  it('activates existing tabs and preserves their order', () => {
    const initial = createWorkspaceWorkbenchLayout();
    const withTabs = openWorkbenchTab(
      openWorkbenchTab(initial, 'right', reviewWorkbenchTab('run-1')),
      'right',
      browserWorkbenchTab('browser-1', 'https://example.com'),
    );
    const activated = activateWorkbenchTab(withTabs, 'right', 'review:run-1');
    expect(activated.right.activeTabId).toBe('review:run-1');
    expect(activated.right.tabs.map((tab) => tab.id)).toEqual([
      'workspace-files',
      'review:run-1',
      'browser:browser-1',
    ]);
  });

  it('clamps persisted dimensions and ignores duplicate or malformed tabs', () => {
    const parsed = parseWorkspaceWorkbenchLayouts({
      version: 1,
      workspaces: {
        ws: {
          version: 1,
          right: {
            open: true,
            size: 99_999,
            fileBrowserWidth: 10,
            tabs: [
              { type: 'file', path: './src/app.ts' },
              { type: 'file', path: 'src/app.ts' },
              { type: 'unknown' },
            ],
          },
          bottom: { open: true, size: 99_999, tabs: [] },
        },
      },
    });
    expect(parsed.ws?.right.size).toBe(WORKBENCH_RIGHT_MAX_WIDTH);
    expect(parsed.ws?.right.fileBrowserWidth).toBe(WORKBENCH_FILE_BROWSER_MIN_WIDTH);
    expect(parsed.ws?.right.tabs).toHaveLength(1);
    expect(parsed.ws?.bottom.size).toBe(WORKBENCH_BOTTOM_MAX_HEIGHT);
    expect(parsed.ws?.bottom.open).toBe(false);
  });

  it('persists bounded resize updates and refuses to open an empty scope', () => {
    const initial = createWorkspaceWorkbenchLayout();
    expect(setWorkbenchOpen(initial, 'bottom', true)).toBe(initial);
    const resized = setWorkbenchFileBrowserWidth(
      setWorkbenchSize(initial, 'right', 50_000),
      'right',
      0,
    );
    expect(resized.right.size).toBe(WORKBENCH_RIGHT_MAX_WIDTH);
    expect(resized.right.fileBrowserWidth).toBe(WORKBENCH_FILE_BROWSER_MIN_WIDTH);
  });

  it('docks workspace files beside a resource instead of stealing the workbench tab', () => {
    const initial = createWorkspaceWorkbenchLayout();
    const opened = toggleWorkspaceFilesWorkbench(initial);
    expect(opened.right).toMatchObject({
      open: true,
      activeTabId: 'workspace-files',
      fileBrowserOpen: false,
    });

    const stillFiles = toggleWorkspaceFilesWorkbench(opened);
    expect(stillFiles.right.open).toBe(true);
    expect(stillFiles.right.activeTabId).toBe('workspace-files');

    const preview = openWorkbenchTab(opened, 'right', fileWorkbenchTab('src/app.ts'));
    expect(preview.right.activeTabId).toBe('file:src/app.ts');
    expect(preview.right.fileBrowserOpen).toBe(false);

    const docked = toggleWorkspaceFilesWorkbench(preview);
    expect(docked.right).toMatchObject({
      open: true,
      activeTabId: 'file:src/app.ts',
      fileBrowserOpen: true,
    });
    expect(docked.right.size).toBe(WORKBENCH_RIGHT_PREVIEW_WIDTH);
    expect(docked.right.tabs.map((tab) => tab.id)).toEqual(['workspace-files', 'file:src/app.ts']);

    const tabsAgain = toggleWorkspaceFilesWorkbench(docked);
    expect(tabsAgain.right.open).toBe(true);
    expect(tabsAgain.right.activeTabId).toBe('file:src/app.ts');
    expect(tabsAgain.right.fileBrowserOpen).toBe(false);

    const onFilesTab = activateWorkbenchTab(preview, 'right', 'workspace-files');
    const dockedFromFilesTab = toggleWorkspaceFilesWorkbench(onFilesTab);
    expect(dockedFromFilesTab.right.activeTabId).toBe('file:src/app.ts');
    expect(dockedFromFilesTab.right.fileBrowserOpen).toBe(true);
  });

  it('keeps workspace files exclusive to the right-side workbench', () => {
    const opened = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'bottom',
      workspaceFilesWorkbenchTab(),
    );
    expect(opened.bottom.tabs).toEqual([]);
    expect(opened.right).toMatchObject({ open: true, activeTabId: 'workspace-files' });

    const restored = parseWorkspaceWorkbenchLayouts({
      workspace: {
        version: 1,
        right: { open: false, tabs: [] },
        bottom: {
          open: true,
          tabs: [{ id: 'workspace-files', type: 'workspace-files' }],
        },
      },
    });
    expect(restored.workspace?.bottom).toMatchObject({ open: false, tabs: [] });
  });
});
