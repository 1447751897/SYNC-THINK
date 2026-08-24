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
    expect(closed.right).toMatchObject({ open: false, tabs: [] });
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
});
