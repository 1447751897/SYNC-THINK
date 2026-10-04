import { focusedConversationId, type WorkspacePaneLayouts } from './pane-layout.js';
import { createWorkspaceWorkbenchLayout, type WorkspaceWorkbenchLayouts, type WorkbenchPlacement } from './workspace-workbench.js';

const PREFIX = 'conversation:';

/** JSON tuples avoid collisions between project IDs, conversation IDs and drafts. */
export function workbenchScopeKey(workspaceId: string, conversationId?: string): string {
  return PREFIX + JSON.stringify([workspaceId, conversationId || null]);
}

export function parseWorkbenchScopeKey(key: string): { workspaceId: string; conversationId?: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  try {
    const tuple: unknown = JSON.parse(key.slice(PREFIX.length));
    if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' || !tuple[0] ||
        (tuple[1] !== null && (typeof tuple[1] !== 'string' || !tuple[1]))) return null;
    return { workspaceId: tuple[0], conversationId: tuple[1] ?? undefined };
  } catch { return null; }
}

/** Assign unowned legacy resources once, not a copy in every conversation. */
export function migrateConversationWorkbenches(
  layouts: WorkspaceWorkbenchLayouts,
  panes: WorkspacePaneLayouts,
  selected: Record<string, string>,
): { layouts: WorkspaceWorkbenchLayouts; migrated: boolean } {
  if (Object.keys(layouts).every(key => parseWorkbenchScopeKey(key))) return { layouts, migrated: false };
  const next: WorkspaceWorkbenchLayouts = Object.fromEntries(Object.entries(layouts).filter(([key]) => parseWorkbenchScopeKey(key)));
  for (const [workspaceId, legacy] of Object.entries(layouts)) {
    if (parseWorkbenchScopeKey(workspaceId)) continue;
    const conversationTab = [...legacy.right.tabs, ...legacy.bottom.tabs].find(tab => tab.type === 'conversation');
    const defaultOwner = selected[workspaceId] ?? (panes[workspaceId] ? focusedConversationId(panes[workspaceId]) : undefined) ??
      (conversationTab?.type === 'conversation' ? conversationTab.conversationId : undefined);
    const defaultKey = workbenchScopeKey(workspaceId, defaultOwner);
    // Empty scopes still carry the user's panel sizes/open state.
    next[defaultKey] ??= {
      ...legacy,
      right: { ...legacy.right, tabs: [], activeTabId: undefined },
      bottom: { ...legacy.bottom, tabs: [], activeTabId: undefined },
    };
    for (const placement of ['right', 'bottom'] as const) {
      const groups = new Map<string, typeof legacy.right.tabs>();
      for (const tab of legacy[placement].tabs) {
        const owner = tab.type === 'browser' ? tab.ownerId ?? defaultOwner : defaultOwner;
        const key = workbenchScopeKey(workspaceId, owner);
        groups.set(key, [...(groups.get(key) ?? []), tab]);
      }
      for (const [key, legacyTabs] of groups) {
        const current = next[key] ?? createWorkspaceWorkbenchLayout();
        const scope = current[placement];
        const tabs = [...scope.tabs, ...legacyTabs.filter(tab => !scope.tabs.some(item => item.id === tab.id))];
        next[key] = { ...current, [placement]: {
          ...legacy[placement], tabs,
          activeTabId: legacyTabs.some(tab => tab.id === legacy[placement].activeTabId)
            ? legacy[placement].activeTabId : scope.activeTabId ?? tabs.at(-1)?.id,
        } };
      }
    }
  }
  return { layouts: next, migrated: true };
}

export function workbenchesForWorkspace(layouts: WorkspaceWorkbenchLayouts, workspaceId: string) {
  return Object.entries(layouts).filter(([key]) => parseWorkbenchScopeKey(key)?.workspaceId === workspaceId);
}

/** Moving a draft to its persisted ID must also move its resource ownership. */
export function materializeWorkbenchScope(layouts: WorkspaceWorkbenchLayouts, workspaceId: string, draftId: string | undefined, conversationId: string): WorkspaceWorkbenchLayouts {
  const oldKey = workbenchScopeKey(workspaceId, draftId);
  const layout = layouts[oldKey];
  if (!layout) return layouts;
  const next = { ...layouts };
  delete next[oldKey];
  const update = (placement: WorkbenchPlacement) => ({ ...layout[placement], tabs: layout[placement].tabs.map(tab =>
    tab.type === 'browser' && tab.ownerId === draftId ? { ...tab, ownerId: conversationId } : tab) });
  next[workbenchScopeKey(workspaceId, conversationId)] = { ...layout, right: update('right'), bottom: update('bottom') };
  return next;
}
