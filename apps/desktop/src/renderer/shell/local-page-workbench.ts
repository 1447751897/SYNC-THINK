import { canonicalizeLocalWebPageUrl, isLocalWebPageUrl } from '../../local-web-page-contract.js';
import { closeBrowserPaneTab, type WorkspacePaneLayouts } from './pane-layout.js';
import {
  createWorkspaceWorkbenchLayout,
  openWorkbenchTab,
  type WorkspaceWorkbenchLayouts,
} from './workspace-workbench.js';

/** Repair layouts saved by the old HTML-open route without changing browser partitions. */
export function migrateLocalPageBrowsersToWorkbench(
  panes: WorkspacePaneLayouts,
  workbenches: WorkspaceWorkbenchLayouts,
): { panes: WorkspacePaneLayouts; workbenches: WorkspaceWorkbenchLayouts; migrated: boolean } {
  let nextPanes = panes;
  let nextWorkbenches = workbenches;
  for (const [workspaceId, layout] of Object.entries(panes)) {
    let nextLayout = layout;
    const previousWorkbench = workbenches[workspaceId] ?? createWorkspaceWorkbenchLayout();
    let nextWorkbench = previousWorkbench;
    let focusedBrowserTabId: string | undefined;
    for (const pane of Object.values(layout.panes)) {
      for (const tab of pane.tabs) {
        if (tab.type !== 'browser' || !isLocalWebPageUrl(tab.url)) continue;
        if (pane.id === layout.focusedPaneId && pane.activeTabId === tab.id) {
          focusedBrowserTabId = tab.id;
        }
        // Keep browserId/ownerId: the durable URL index belongs to this browser's partition.
        nextWorkbench = openWorkbenchTab(nextWorkbench, 'right', {
          ...tab,
          url: canonicalizeLocalWebPageUrl(tab.url),
        });
        nextLayout = closeBrowserPaneTab(nextLayout, pane.id, tab.browserId);
      }
    }
    if (nextLayout === layout) continue;
    // Moving an inactive old preview must not steal focus from the user's right-side editor.
    nextWorkbench = {
      ...nextWorkbench,
      right: {
        ...nextWorkbench.right,
        activeTabId:
          focusedBrowserTabId ??
          previousWorkbench.right.activeTabId ??
          nextWorkbench.right.activeTabId,
        open: focusedBrowserTabId ? true : previousWorkbench.right.open,
        size: focusedBrowserTabId ? nextWorkbench.right.size : previousWorkbench.right.size,
      },
    };
    nextPanes = { ...nextPanes, [workspaceId]: nextLayout };
    nextWorkbenches = { ...nextWorkbenches, [workspaceId]: nextWorkbench };
  }
  return { panes: nextPanes, workbenches: nextWorkbenches, migrated: nextPanes !== panes };
}
