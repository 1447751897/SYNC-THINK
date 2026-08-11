export type PaneSplitDirection = 'horizontal' | 'vertical';

export interface ConversationPaneTab {
  id: string;
  type: 'conversation';
  conversationId: string;
}

export interface FilePaneTab {
  id: string;
  type: 'file';
  path: string;
}

export interface TerminalPaneTab {
  id: string;
  type: 'terminal';
  terminalId: string;
  cwd: string;
}

export interface BrowserPaneTab {
  id: string;
  type: 'browser';
  browserId: string;
  url: string;
}

export interface WorkspaceFilesPaneTab {
  id: 'workspace-files';
  type: 'workspace-files';
}

export type WorkspacePaneTab =
  ConversationPaneTab | FilePaneTab | TerminalPaneTab | BrowserPaneTab | WorkspaceFilesPaneTab;

export type PaneResourceRef =
  | { type: 'conversation'; id: string }
  | { type: 'file'; id: string }
  | { type: 'terminal'; id: string }
  | { type: 'browser'; id: string }
  | { type: 'workspace-files'; id: 'workspace-files' };

export interface WorkspacePane {
  id: string;
  tabs: WorkspacePaneTab[];
  activeTabId?: string;
}

export interface PaneLeafNode {
  type: 'pane';
  id: string;
  paneId: string;
}

export interface PaneSplitNode {
  type: 'split';
  id: string;
  direction: PaneSplitDirection;
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeafNode | PaneSplitNode;

export interface WorkspacePaneLayout {
  version: 1;
  panes: Record<string, WorkspacePane>;
  root: PaneNode;
  focusedPaneId: string;
}

export type WorkspacePaneLayouts = Record<string, WorkspacePaneLayout>;

const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const MAX_SNAPSHOT_DEPTH = 16;
const MAX_SNAPSHOT_PANES = 32;
export const MAX_TABS_PER_PANE = 100;

const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

let generatedId = 0;

function nextId(prefix: string): string {
  generatedId += 1;
  return `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
}

function workspacePrefix(workspaceId: string): string {
  const normalized = workspaceId.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  return normalized || 'workspace';
}

function conversationTab(conversationId: string): ConversationPaneTab {
  return {
    id: `conversation:${conversationId}`,
    type: 'conversation',
    conversationId,
  };
}

function fileTab(path: string): FilePaneTab {
  return { id: `file:${path}`, type: 'file', path };
}

function normalizeTerminalCwd(cwd: string): string {
  const normalized = cwd.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.') return '';
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return '';
  if (normalized.split('/').some((part) => part === '..')) return '';
  return normalized;
}

function terminalTab(terminalId: string, cwd = ''): TerminalPaneTab {
  return {
    id: `terminal:${terminalId}`,
    type: 'terminal',
    terminalId,
    cwd: normalizeTerminalCwd(cwd),
  };
}

function normalizeBrowserUrl(url: string): string {
  const normalized = url.trim();
  return normalized.slice(0, 4_000) || 'https://www.bing.com';
}

function browserTab(browserId: string, url: string): BrowserPaneTab {
  return {
    id: `browser:${browserId}`,
    type: 'browser',
    browserId,
    url: normalizeBrowserUrl(url),
  };
}

function workspaceFilesTab(): WorkspaceFilesPaneTab {
  return { id: 'workspace-files', type: 'workspace-files' };
}

function tabResourceKey(tab: WorkspacePaneTab): string {
  if (tab.type === 'conversation') return `conversation:${tab.conversationId}`;
  if (tab.type === 'file') return `file:${tab.path}`;
  if (tab.type === 'terminal') return `terminal:${tab.terminalId}`;
  if (tab.type === 'browser') return `browser:${tab.browserId}`;
  return 'workspace-files';
}

function isSafeRecordKey(value: string): boolean {
  return value.length > 0 && !RESERVED_RECORD_KEYS.has(value);
}

function limitPaneTabs(
  tabs: readonly WorkspacePaneTab[],
  activeTabId?: string,
): WorkspacePaneTab[] {
  if (tabs.length <= MAX_TABS_PER_PANE) return [...tabs];
  const statefulTabs = tabs.filter((tab) => tab.type !== 'conversation');
  const limitedStatefulTabs = limitTabsByCount(
    statefulTabs,
    Math.min(MAX_TABS_PER_PANE, statefulTabs.length),
    activeTabId,
  );
  const remainingCapacity = MAX_TABS_PER_PANE - limitedStatefulTabs.length;
  const limitedConversations = limitTabsByCount(
    tabs.filter((tab) => tab.type === 'conversation'),
    remainingCapacity,
    activeTabId,
  );
  const keptIds = new Set([...limitedStatefulTabs, ...limitedConversations].map((tab) => tab.id));
  return tabs.filter((tab) => keptIds.has(tab.id));
}

function limitTabsByCount(
  tabs: readonly WorkspacePaneTab[],
  limit: number,
  activeTabId?: string,
): WorkspacePaneTab[] {
  if (limit <= 0) return [];
  if (tabs.length <= limit) return [...tabs];
  const cutoff = tabs.length - limit;
  const activeIndex = activeTabId ? tabs.findIndex((tab) => tab.id === activeTabId) : -1;
  if (activeIndex < 0 || activeIndex >= cutoff) return tabs.slice(cutoff);

  // Keep an older active tab plus the newest inactive tabs.
  return tabs.filter((_, index) => index === activeIndex || index > cutoff);
}

function paneHasOnlyStatefulTabsAtLimit(pane: WorkspacePane): boolean {
  return (
    pane.tabs.length >= MAX_TABS_PER_PANE && pane.tabs.every((tab) => tab.type !== 'conversation')
  );
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

function paneIdsInTree(node: PaneNode): string[] {
  if (node.type === 'pane') return [node.paneId];
  return [...paneIdsInTree(node.children[0]), ...paneIdsInTree(node.children[1])];
}

function findPaneNode(node: PaneNode, paneId: string): PaneLeafNode | undefined {
  if (node.type === 'pane') return node.paneId === paneId ? node : undefined;
  return findPaneNode(node.children[0], paneId) ?? findPaneNode(node.children[1], paneId);
}

function replacePaneNode(node: PaneNode, paneId: string, replacement: PaneNode): PaneNode {
  if (node.type === 'pane') return node.paneId === paneId ? replacement : node;
  const left = replacePaneNode(node.children[0], paneId, replacement);
  const right = replacePaneNode(node.children[1], paneId, replacement);
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

function updateNode(
  node: PaneNode,
  nodeId: string,
  update: (node: PaneNode) => PaneNode,
): PaneNode {
  if (node.id === nodeId) return update(node);
  if (node.type === 'pane') return node;
  const left = updateNode(node.children[0], nodeId, update);
  const right = updateNode(node.children[1], nodeId, update);
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

function removePaneNode(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') return node.paneId === paneId ? null : node;
  const left = removePaneNode(node.children[0], paneId);
  const right = removePaneNode(node.children[1], paneId);
  if (!left) return right;
  if (!right) return left;
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

function activeConversationId(pane: WorkspacePane | undefined): string | undefined {
  if (!pane) return undefined;
  const tab = pane.tabs.find((item) => item.id === pane.activeTabId);
  return tab?.type === 'conversation' ? tab.conversationId : undefined;
}

function normalizePane(pane: WorkspacePane, valid?: ReadonlySet<string>): WorkspacePane {
  const seen = new Set<string>();
  const deduplicatedTabs = pane.tabs
    .filter((tab) => tab.type !== 'conversation' || !valid || valid.has(tab.conversationId))
    .filter((tab) => {
      const key = tabResourceKey(tab);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const requestedActiveTabId = deduplicatedTabs.some((tab) => tab.id === pane.activeTabId)
    ? pane.activeTabId
    : deduplicatedTabs.at(-1)?.id;
  const tabs = limitPaneTabs(deduplicatedTabs, requestedActiveTabId);
  const activeTabId = tabs.some((tab) => tab.id === requestedActiveTabId)
    ? requestedActiveTabId
    : tabs.at(-1)?.id;
  return { ...pane, tabs, activeTabId };
}

function removeConversationWithoutCollapsing(
  layout: WorkspacePaneLayout,
  paneId: string,
  conversationId: string,
): WorkspacePaneLayout {
  const pane = layout.panes[paneId];
  if (!pane) return layout;
  const index = pane.tabs.findIndex(
    (tab) => tab.type === 'conversation' && tab.conversationId === conversationId,
  );
  if (index < 0) return layout;
  const tabs = pane.tabs.filter(
    (tab) => tab.type !== 'conversation' || tab.conversationId !== conversationId,
  );
  const activeTabId =
    pane.activeTabId === pane.tabs[index]?.id
      ? (tabs[index]?.id ?? tabs[index - 1]?.id)
      : pane.activeTabId;
  return {
    ...layout,
    panes: { ...layout.panes, [paneId]: { ...pane, tabs, activeTabId } },
  };
}

function findConversationPane(
  layout: WorkspacePaneLayout,
  conversationId: string,
): string | undefined {
  return paneIdsInTree(layout.root).find((paneId) =>
    layout.panes[paneId]?.tabs.some(
      (tab) => tab.type === 'conversation' && tab.conversationId === conversationId,
    ),
  );
}

function findFilePane(layout: WorkspacePaneLayout, path: string): string | undefined {
  return paneIdsInTree(layout.root).find((paneId) =>
    layout.panes[paneId]?.tabs.some((tab) => tab.type === 'file' && tab.path === path),
  );
}

function findTerminalPane(layout: WorkspacePaneLayout, terminalId: string): string | undefined {
  return paneIdsInTree(layout.root).find((paneId) =>
    layout.panes[paneId]?.tabs.some(
      (tab) => tab.type === 'terminal' && tab.terminalId === terminalId,
    ),
  );
}

function findBrowserPane(layout: WorkspacePaneLayout, browserId: string): string | undefined {
  return paneIdsInTree(layout.root).find((paneId) =>
    layout.panes[paneId]?.tabs.some((tab) => tab.type === 'browser' && tab.browserId === browserId),
  );
}

export function findWorkspaceFilesPane(layout: WorkspacePaneLayout): string | undefined {
  return paneIdsInTree(layout.root).find((paneId) =>
    layout.panes[paneId]?.tabs.some((tab) => tab.type === 'workspace-files'),
  );
}

function findPaneTab(
  layout: WorkspacePaneLayout,
  resource: PaneResourceRef,
): { paneId: string; tab: WorkspacePaneTab } | undefined {
  const id = resource.id.trim();
  if (!id) return undefined;
  const key = `${resource.type}:${id}`;
  if (resource.type === 'workspace-files') {
    return findWorkspaceFilesPane(layout)
      ? {
          paneId: findWorkspaceFilesPane(layout)!,
          tab: workspaceFilesTab(),
        }
      : undefined;
  }
  for (const paneId of paneIdsInTree(layout.root)) {
    const tab = layout.panes[paneId]?.tabs.find((candidate) => tabResourceKey(candidate) === key);
    if (tab) return { paneId, tab };
  }
  return undefined;
}

function removePaneTabWithoutCollapsing(
  layout: WorkspacePaneLayout,
  paneId: string,
  tabId: string,
): WorkspacePaneLayout {
  const pane = layout.panes[paneId];
  if (!pane) return layout;
  const index = pane.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return layout;
  const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId =
    pane.activeTabId === tabId ? (tabs[index]?.id ?? tabs[index - 1]?.id) : pane.activeTabId;
  return {
    ...layout,
    panes: { ...layout.panes, [paneId]: { ...pane, tabs, activeTabId } },
  };
}

function closePaneTabByResource(
  layout: WorkspacePaneLayout,
  paneId: string,
  resource: PaneResourceRef,
): WorkspacePaneLayout {
  const found = findPaneTab(layout, resource);
  if (!found || found.paneId !== paneId) return layout;
  const next = removePaneTabWithoutCollapsing(layout, paneId, found.tab.id);
  if (next.panes[paneId]?.tabs.length === 0 && Object.keys(next.panes).length > 1) {
    return closePane(next, paneId);
  }
  return next;
}

export function createWorkspacePaneLayout(
  workspaceId: string,
  conversationIds: readonly string[] = [],
  activeConversationId?: string,
): WorkspacePaneLayout {
  const prefix = workspacePrefix(workspaceId);
  const paneId = `${prefix}:pane:root`;
  const ids = [...new Set(conversationIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const tabs = ids.map(conversationTab);
  const activeId = activeConversationId?.trim();
  const activeTabId = tabs.find((tab) => tab.conversationId === activeId)?.id ?? tabs.at(-1)?.id;
  const pane = normalizePane({ id: paneId, tabs, activeTabId });
  return {
    version: 1,
    panes: { [paneId]: pane },
    root: { type: 'pane', id: `${prefix}:node:root`, paneId },
    focusedPaneId: paneId,
  };
}

export function paneConversationIds(layout: WorkspacePaneLayout): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const paneId of paneIdsInTree(layout.root)) {
    for (const tab of layout.panes[paneId]?.tabs ?? []) {
      if (tab.type !== 'conversation') continue;
      if (seen.has(tab.conversationId)) continue;
      seen.add(tab.conversationId);
      result.push(tab.conversationId);
    }
  }
  return result;
}

export function focusedConversationId(layout: WorkspacePaneLayout): string | undefined {
  return activeConversationId(layout.panes[layout.focusedPaneId]);
}

export function activatePaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  conversationId: string,
): WorkspacePaneLayout {
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find(
    (item) => item.type === 'conversation' && item.conversationId === conversationId,
  );
  if (!pane || !tab) return layout;
  if (layout.focusedPaneId === paneId && pane.activeTabId === tab.id) return layout;
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tab.id } },
  };
}

export function activateFilePaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  path: string,
): WorkspacePaneLayout {
  const normalizedPath = path.trim();
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find((item) => item.type === 'file' && item.path === normalizedPath);
  if (!pane || !tab) return layout;
  if (layout.focusedPaneId === paneId && pane.activeTabId === tab.id) return layout;
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tab.id } },
  };
}

export function activateTerminalPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  terminalId: string,
): WorkspacePaneLayout {
  const normalizedId = terminalId.trim();
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find(
    (item) => item.type === 'terminal' && item.terminalId === normalizedId,
  );
  if (!pane || !tab) return layout;
  if (layout.focusedPaneId === paneId && pane.activeTabId === tab.id) return layout;
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tab.id } },
  };
}

export function activateBrowserPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  browserId: string,
): WorkspacePaneLayout {
  const normalizedId = browserId.trim();
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find((item) => item.type === 'browser' && item.browserId === normalizedId);
  if (!pane || !tab) return layout;
  if (layout.focusedPaneId === paneId && pane.activeTabId === tab.id) return layout;
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tab.id } },
  };
}

export function activateWorkspaceFilesPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
): WorkspacePaneLayout {
  const pane = layout.panes[paneId];
  const tab = pane?.tabs.find((item) => item.type === 'workspace-files');
  if (!pane || !tab) return layout;
  if (layout.focusedPaneId === paneId && pane.activeTabId === tab.id) return layout;
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tab.id } },
  };
}

export function openFileInPane(
  layout: WorkspacePaneLayout,
  path: string,
  targetPaneId: string = layout.focusedPaneId,
): WorkspacePaneLayout {
  const normalizedPath = path.trim();
  if (!normalizedPath) return layout;
  const existingPaneId = findFilePane(layout, normalizedPath);
  if (existingPaneId) {
    const pane = layout.panes[existingPaneId];
    const tab = pane?.tabs.find((item) => item.type === 'file' && item.path === normalizedPath);
    if (!pane || !tab) return layout;
    return {
      ...layout,
      focusedPaneId: existingPaneId,
      panes: { ...layout.panes, [existingPaneId]: { ...pane, activeTabId: tab.id } },
    };
  }
  const paneId = layout.panes[targetPaneId] ? targetPaneId : paneIdsInTree(layout.root)[0];
  const pane = layout.panes[paneId];
  if (!pane || paneHasOnlyStatefulTabsAtLimit(pane)) return layout;
  const tab = fileTab(normalizedPath);
  const nextPane = normalizePane({
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.id,
  });
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: {
      ...layout.panes,
      [paneId]: nextPane,
    },
  };
}

export function replaceFileInPane(
  layout: WorkspacePaneLayout,
  paneId: string,
  fromPath: string,
  toPath: string,
): WorkspacePaneLayout {
  const sourcePath = fromPath.trim();
  const destinationPath = toPath.trim();
  if (!sourcePath || !destinationPath) return layout;
  if (sourcePath === destinationPath) {
    return activateFilePaneTab(layout, paneId, destinationPath);
  }

  const sourcePane = layout.panes[paneId];
  const sourceIndex =
    sourcePane?.tabs.findIndex((tab) => tab.type === 'file' && tab.path === sourcePath) ?? -1;
  if (!sourcePane || sourceIndex < 0) return layout;

  const existingPaneId = findFilePane(layout, destinationPath);
  if (existingPaneId) {
    let next = removePaneTabWithoutCollapsing(layout, paneId, sourcePane.tabs[sourceIndex]!.id);
    next = activateFilePaneTab(next, existingPaneId, destinationPath);
    if (next.panes[paneId]?.tabs.length === 0 && Object.keys(next.panes).length > 1) {
      next = closePane(next, paneId);
    }
    return next;
  }

  const replacement = fileTab(destinationPath);
  const tabs = sourcePane.tabs.map((tab, index) => (index === sourceIndex ? replacement : tab));
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: {
      ...layout.panes,
      [paneId]: {
        ...sourcePane,
        tabs,
        activeTabId:
          sourcePane.activeTabId === sourcePane.tabs[sourceIndex]?.id
            ? replacement.id
            : sourcePane.activeTabId,
      },
    },
  };
}

export function openTerminalInPane(
  layout: WorkspacePaneLayout,
  terminalId: string,
  cwd = '',
  targetPaneId: string = layout.focusedPaneId,
): WorkspacePaneLayout {
  const normalizedId = terminalId.trim();
  if (!normalizedId || normalizedId.length > 200 || !isSafeRecordKey(normalizedId)) return layout;
  const existingPaneId = findTerminalPane(layout, normalizedId);
  if (existingPaneId) return activateTerminalPaneTab(layout, existingPaneId, normalizedId);
  const paneId = layout.panes[targetPaneId] ? targetPaneId : paneIdsInTree(layout.root)[0];
  const pane = layout.panes[paneId];
  if (!pane || paneHasOnlyStatefulTabsAtLimit(pane)) return layout;
  const tab = terminalTab(normalizedId, cwd);
  const nextPane = normalizePane({
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.id,
  });
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: nextPane },
  };
}

export function openBrowserInPane(
  layout: WorkspacePaneLayout,
  browserId: string,
  url = 'https://www.bing.com',
  targetPaneId: string = layout.focusedPaneId,
): WorkspacePaneLayout {
  const normalizedId = browserId.trim();
  if (!normalizedId || normalizedId.length > 200 || !isSafeRecordKey(normalizedId)) return layout;
  const existingPaneId = findBrowserPane(layout, normalizedId);
  if (existingPaneId) return activateBrowserPaneTab(layout, existingPaneId, normalizedId);
  const paneId = layout.panes[targetPaneId] ? targetPaneId : paneIdsInTree(layout.root)[0];
  const pane = layout.panes[paneId];
  if (!pane || paneHasOnlyStatefulTabsAtLimit(pane)) return layout;
  const tab = browserTab(normalizedId, url);
  const nextPane = normalizePane({
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.id,
  });
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: { ...layout.panes, [paneId]: nextPane },
  };
}

export function focusPane(layout: WorkspacePaneLayout, paneId: string): WorkspacePaneLayout {
  if (!layout.panes[paneId] || layout.focusedPaneId === paneId) return layout;
  return { ...layout, focusedPaneId: paneId };
}

export function openConversationInPane(
  layout: WorkspacePaneLayout,
  conversationId: string,
  targetPaneId: string = layout.focusedPaneId,
): WorkspacePaneLayout {
  const id = conversationId.trim();
  if (!id) return layout;
  const existingPaneId = findConversationPane(layout, id);
  if (existingPaneId) return activatePaneTab(layout, existingPaneId, id);
  const paneId = layout.panes[targetPaneId] ? targetPaneId : paneIdsInTree(layout.root)[0];
  const pane = layout.panes[paneId];
  if (!pane || paneHasOnlyStatefulTabsAtLimit(pane)) return layout;
  const tab = conversationTab(id);
  const nextPane = normalizePane({
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.id,
  });
  return {
    ...layout,
    focusedPaneId: paneId,
    panes: {
      ...layout.panes,
      [paneId]: nextPane,
    },
  };
}

export function replaceConversationInPane(
  layout: WorkspacePaneLayout,
  fromConversationId: string,
  toConversationId: string,
): WorkspacePaneLayout {
  const fromId = fromConversationId.trim();
  const toId = toConversationId.trim();
  if (!fromId || !toId || fromId === toId) return layout;
  const sourcePaneId = findConversationPane(layout, fromId);
  if (!sourcePaneId) return layout;

  const sourcePane = layout.panes[sourcePaneId];
  const sourceIndex =
    sourcePane?.tabs.findIndex(
      (tab) => tab.type === 'conversation' && tab.conversationId === fromId,
    ) ?? -1;
  if (!sourcePane || sourceIndex < 0) return layout;

  const existingPaneId = findConversationPane(layout, toId);
  if (existingPaneId) {
    let next = removeConversationWithoutCollapsing(layout, sourcePaneId, fromId);
    next = activatePaneTab(next, existingPaneId, toId);
    if (next.panes[sourcePaneId]?.tabs.length === 0 && Object.keys(next.panes).length > 1) {
      next = closePane(next, sourcePaneId);
    }
    return next;
  }

  const replacement = conversationTab(toId);
  const tabs = sourcePane.tabs.map((tab, index) => (index === sourceIndex ? replacement : tab));
  return {
    ...layout,
    focusedPaneId: sourcePaneId,
    panes: {
      ...layout.panes,
      [sourcePaneId]: {
        ...sourcePane,
        tabs,
        activeTabId:
          sourcePane.activeTabId === sourcePane.tabs[sourceIndex]?.id
            ? replacement.id
            : sourcePane.activeTabId,
      },
    },
  };
}

export function reorderPaneTabs(
  layout: WorkspacePaneLayout,
  paneId: string,
  fromConversationId: string,
  toConversationId: string,
): WorkspacePaneLayout {
  if (fromConversationId === toConversationId) return layout;
  const pane = layout.panes[paneId];
  if (!pane) return layout;
  const from = pane.tabs.findIndex(
    (tab) => tab.type === 'conversation' && tab.conversationId === fromConversationId,
  );
  const to = pane.tabs.findIndex(
    (tab) => tab.type === 'conversation' && tab.conversationId === toConversationId,
  );
  if (from < 0 || to < 0) return layout;
  const tabs = [...pane.tabs];
  const [moved] = tabs.splice(from, 1);
  if (!moved) return layout;
  tabs.splice(to, 0, moved);
  return { ...layout, panes: { ...layout.panes, [paneId]: { ...pane, tabs } } };
}

export function moveConversationToPane(
  layout: WorkspacePaneLayout,
  conversationId: string,
  targetPaneId: string,
): WorkspacePaneLayout {
  const id = conversationId.trim();
  const sourcePaneId = findConversationPane(layout, id);
  const targetPane = layout.panes[targetPaneId];
  if (!id || !sourcePaneId || !targetPane) return layout;
  if (sourcePaneId === targetPaneId) return activatePaneTab(layout, targetPaneId, id);

  let next = removeConversationWithoutCollapsing(layout, sourcePaneId, id);
  const currentTarget = next.panes[targetPaneId];
  if (!currentTarget) return layout;
  const tab = conversationTab(id);
  const nextTarget = normalizePane({
    ...currentTarget,
    tabs: [...currentTarget.tabs, tab],
    activeTabId: tab.id,
  });
  next = {
    ...next,
    panes: {
      ...next.panes,
      [targetPaneId]: nextTarget,
    },
    focusedPaneId: targetPaneId,
  };
  if (next.panes[sourcePaneId]?.tabs.length === 0) next = closePane(next, sourcePaneId);
  return { ...next, focusedPaneId: targetPaneId };
}

export function splitPaneWithConversation(
  layout: WorkspacePaneLayout,
  targetPaneId: string,
  direction: PaneSplitDirection,
  conversationId: string,
): WorkspacePaneLayout {
  const id = conversationId.trim();
  const targetPane = layout.panes[targetPaneId];
  const targetNode = findPaneNode(layout.root, targetPaneId);
  if (!id || !targetPane || !targetNode) return layout;

  const existingPaneId = findConversationPane(layout, id);
  if (existingPaneId === targetPaneId && targetPane.tabs.length <= 1) return layout;

  let base = layout;
  if (existingPaneId) {
    base = removeConversationWithoutCollapsing(base, existingPaneId, id);
    if (existingPaneId !== targetPaneId && base.panes[existingPaneId]?.tabs.length === 0) {
      base = closePane(base, existingPaneId);
    }
  }
  if (!base.panes[targetPaneId]) return layout;

  const newPaneId = nextId('pane');
  const newPaneNode: PaneLeafNode = { type: 'pane', id: nextId('node'), paneId: newPaneId };
  const currentTargetNode = findPaneNode(base.root, targetPaneId);
  if (!currentTargetNode) return layout;
  const splitNode: PaneSplitNode = {
    type: 'split',
    id: nextId('split'),
    direction,
    ratio: 0.5,
    children: [currentTargetNode, newPaneNode],
  };
  const tab = conversationTab(id);
  return {
    ...base,
    panes: {
      ...base.panes,
      [newPaneId]: { id: newPaneId, tabs: [tab], activeTabId: tab.id },
    },
    root: replacePaneNode(base.root, targetPaneId, splitNode),
    focusedPaneId: newPaneId,
  };
}

export function splitPaneWithWorkspaceFiles(
  layout: WorkspacePaneLayout,
  targetPaneId: string = layout.focusedPaneId,
  direction: PaneSplitDirection = 'horizontal',
): WorkspacePaneLayout {
  const existingPaneId = findWorkspaceFilesPane(layout);
  if (existingPaneId) return activateWorkspaceFilesPaneTab(layout, existingPaneId);
  const targetPane = layout.panes[targetPaneId];
  const targetNode = findPaneNode(layout.root, targetPaneId);
  if (!targetPane || !targetNode) return layout;

  const newPaneId = nextId('pane');
  const newPaneNode: PaneLeafNode = { type: 'pane', id: nextId('node'), paneId: newPaneId };
  const splitNode: PaneSplitNode = {
    type: 'split',
    id: nextId('split'),
    direction,
    ratio: 0.68,
    children: [targetNode, newPaneNode],
  };
  const tab = workspaceFilesTab();
  return {
    ...layout,
    panes: {
      ...layout.panes,
      [newPaneId]: { id: newPaneId, tabs: [tab], activeTabId: tab.id },
    },
    root: replacePaneNode(layout.root, targetPaneId, splitNode),
    focusedPaneId: newPaneId,
  };
}

export function movePaneResourceToPane(
  layout: WorkspacePaneLayout,
  resource: PaneResourceRef,
  targetPaneId: string,
): WorkspacePaneLayout {
  const found = findPaneTab(layout, resource);
  const targetPane = layout.panes[targetPaneId];
  if (!found || !targetPane) return layout;
  if (found.paneId === targetPaneId) {
    if (resource.type === 'conversation') return activatePaneTab(layout, targetPaneId, resource.id);
    if (resource.type === 'file') return activateFilePaneTab(layout, targetPaneId, resource.id);
    if (resource.type === 'terminal') {
      return activateTerminalPaneTab(layout, targetPaneId, resource.id);
    }
    if (resource.type === 'browser') {
      return activateBrowserPaneTab(layout, targetPaneId, resource.id);
    }
    return activateWorkspaceFilesPaneTab(layout, targetPaneId);
  }

  let next = removePaneTabWithoutCollapsing(layout, found.paneId, found.tab.id);
  const currentTarget = next.panes[targetPaneId];
  if (!currentTarget) return layout;
  const existingTargetTab = currentTarget.tabs.find(
    (tab) => tabResourceKey(tab) === tabResourceKey(found.tab),
  );
  if (existingTargetTab) {
    next = {
      ...next,
      focusedPaneId: targetPaneId,
      panes: {
        ...next.panes,
        [targetPaneId]: { ...currentTarget, activeTabId: existingTargetTab.id },
      },
    };
  } else {
    next = {
      ...next,
      focusedPaneId: targetPaneId,
      panes: {
        ...next.panes,
        [targetPaneId]: normalizePane({
          ...currentTarget,
          tabs: [...currentTarget.tabs, found.tab],
          activeTabId: found.tab.id,
        }),
      },
    };
  }
  if (next.panes[found.paneId]?.tabs.length === 0) next = closePane(next, found.paneId);
  return { ...next, focusedPaneId: targetPaneId };
}

export function closeBrowserPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  browserId: string,
): WorkspacePaneLayout {
  return closePaneTabByResource(layout, paneId, { type: 'browser', id: browserId });
}

export function closeWorkspaceFilesPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
): WorkspacePaneLayout {
  return closePaneTabByResource(layout, paneId, {
    type: 'workspace-files',
    id: 'workspace-files',
  });
}

export function setSplitRatio(
  layout: WorkspacePaneLayout,
  splitNodeId: string,
  ratio: number,
): WorkspacePaneLayout {
  const root = updateNode(layout.root, splitNodeId, (node) =>
    node.type === 'split' ? { ...node, ratio: clampRatio(ratio) } : node,
  );
  return root === layout.root ? layout : { ...layout, root };
}

export function swapSplitChildren(
  layout: WorkspacePaneLayout,
  splitNodeId: string,
): WorkspacePaneLayout {
  const root = updateNode(layout.root, splitNodeId, (node) =>
    node.type === 'split' ? { ...node, children: [node.children[1], node.children[0]] } : node,
  );
  return root === layout.root ? layout : { ...layout, root };
}

export function closePane(layout: WorkspacePaneLayout, paneId: string): WorkspacePaneLayout {
  if (!layout.panes[paneId] || Object.keys(layout.panes).length <= 1) return layout;
  const root = removePaneNode(layout.root, paneId);
  if (!root) return layout;
  const panes = { ...layout.panes };
  delete panes[paneId];
  const leafIds = paneIdsInTree(root);
  const focusedPaneId =
    layout.focusedPaneId !== paneId && panes[layout.focusedPaneId]
      ? layout.focusedPaneId
      : leafIds[0]!;
  return { ...layout, panes, root, focusedPaneId };
}

export function closePaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  conversationId: string,
): WorkspacePaneLayout {
  const next = removeConversationWithoutCollapsing(layout, paneId, conversationId);
  if (next === layout) return layout;
  if (next.panes[paneId]?.tabs.length === 0 && Object.keys(next.panes).length > 1) {
    return closePane(next, paneId);
  }
  return next;
}

export function closeFilePaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  path: string,
): WorkspacePaneLayout {
  const normalizedPath = path.trim();
  const pane = layout.panes[paneId];
  const index =
    pane?.tabs.findIndex((tab) => tab.type === 'file' && tab.path === normalizedPath) ?? -1;
  if (!pane || index < 0) return layout;
  const tabs = pane.tabs.filter((tab) => tab.type !== 'file' || tab.path !== normalizedPath);
  const activeTabId =
    pane.activeTabId === pane.tabs[index]?.id
      ? (tabs[index]?.id ?? tabs[index - 1]?.id)
      : pane.activeTabId;
  const next = {
    ...layout,
    panes: { ...layout.panes, [paneId]: { ...pane, tabs, activeTabId } },
  };
  if (tabs.length === 0 && Object.keys(next.panes).length > 1) return closePane(next, paneId);
  return next;
}

export function closeTerminalPaneTab(
  layout: WorkspacePaneLayout,
  paneId: string,
  terminalId: string,
): WorkspacePaneLayout {
  const normalizedId = terminalId.trim();
  const pane = layout.panes[paneId];
  const index =
    pane?.tabs.findIndex((tab) => tab.type === 'terminal' && tab.terminalId === normalizedId) ?? -1;
  if (!pane || index < 0) return layout;
  const tabs = pane.tabs.filter(
    (tab) => tab.type !== 'terminal' || tab.terminalId !== normalizedId,
  );
  const activeTabId =
    pane.activeTabId === pane.tabs[index]?.id
      ? (tabs[index]?.id ?? tabs[index - 1]?.id)
      : pane.activeTabId;
  const next = {
    ...layout,
    panes: { ...layout.panes, [paneId]: { ...pane, tabs, activeTabId } },
  };
  if (tabs.length === 0 && Object.keys(next.panes).length > 1) return closePane(next, paneId);
  return next;
}

export function updateTerminalPaneCwd(
  layout: WorkspacePaneLayout,
  paneId: string,
  terminalId: string,
  cwd: string,
): WorkspacePaneLayout {
  const pane = layout.panes[paneId];
  const normalizedId = terminalId.trim();
  const normalizedCwd = normalizeTerminalCwd(cwd);
  if (!pane || !normalizedId) return layout;
  let changed = false;
  const tabs = pane.tabs.map((tab) => {
    if (tab.type !== 'terminal' || tab.terminalId !== normalizedId || tab.cwd === normalizedCwd) {
      return tab;
    }
    changed = true;
    return { ...tab, cwd: normalizedCwd };
  });
  if (!changed) return layout;
  return {
    ...layout,
    panes: { ...layout.panes, [paneId]: { ...pane, tabs } },
  };
}

export function closeConversationInLayout(
  layout: WorkspacePaneLayout,
  conversationId: string,
): WorkspacePaneLayout {
  const paneId = findConversationPane(layout, conversationId.trim());
  return paneId ? closePaneTab(layout, paneId, conversationId) : layout;
}

export function pruneWorkspacePaneLayout(
  layout: WorkspacePaneLayout,
  validConversationIds?: ReadonlySet<string>,
): WorkspacePaneLayout {
  const orderedPaneIds = paneIdsInTree(layout.root);
  const seenResources = new Set<string>();
  const panes: Record<string, WorkspacePane> = {};
  for (const paneId of orderedPaneIds) {
    const pane = layout.panes[paneId];
    if (!pane) continue;
    const normalized = normalizePane(pane, validConversationIds);
    const tabs = normalized.tabs.filter((tab) => {
      const key = tabResourceKey(tab);
      if (seenResources.has(key)) return false;
      seenResources.add(key);
      return true;
    });
    panes[paneId] = normalizePane({ ...normalized, tabs });
  }

  const nonEmpty = new Set(
    Object.values(panes)
      .filter((pane) => pane.tabs.length > 0)
      .map((pane) => pane.id),
  );
  const keepEmptyPaneId =
    nonEmpty.size === 0 ? orderedPaneIds.find((paneId) => panes[paneId]) : undefined;
  const pruneNode = (node: PaneNode): PaneNode | null => {
    if (node.type === 'pane') {
      return nonEmpty.has(node.paneId) || node.paneId === keepEmptyPaneId ? node : null;
    }
    const left = pruneNode(node.children[0]);
    const right = pruneNode(node.children[1]);
    if (!left) return right;
    if (!right) return left;
    return { ...node, ratio: clampRatio(node.ratio), children: [left, right] };
  };
  const root = pruneNode(layout.root);
  if (!root) return layout;
  const retainedIds = new Set(paneIdsInTree(root));
  const retainedPanes = Object.fromEntries(
    Object.entries(panes).filter(([paneId]) => retainedIds.has(paneId)),
  );
  const focusedPaneId = retainedPanes[layout.focusedPaneId]
    ? layout.focusedPaneId
    : paneIdsInTree(root)[0]!;
  return { version: 1, panes: retainedPanes, root, focusedPaneId };
}

export function migrateLegacyPaneLayouts(
  current: WorkspacePaneLayouts,
  openTabs: Readonly<Record<string, readonly string[]>>,
  selected: Readonly<Record<string, string | undefined>>,
): WorkspacePaneLayouts {
  let next = current;
  for (const [workspaceId, conversationIds] of Object.entries(openTabs)) {
    if (!isSafeRecordKey(workspaceId) || Object.hasOwn(next, workspaceId)) continue;
    if (next === current) next = { ...current };
    next[workspaceId] = createWorkspacePaneLayout(
      workspaceId,
      conversationIds,
      selected[workspaceId],
    );
  }
  return next;
}

function parsePaneNode(
  raw: unknown,
  panes: Readonly<Record<string, WorkspacePane>>,
  usedPaneIds: Set<string>,
  depth: number,
): PaneNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > MAX_SNAPSHOT_DEPTH) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  if (record.type === 'pane') {
    const paneId = typeof record.paneId === 'string' ? record.paneId.trim() : '';
    if (!paneId || !Object.hasOwn(panes, paneId) || usedPaneIds.has(paneId)) return null;
    usedPaneIds.add(paneId);
    return { type: 'pane', id, paneId };
  }
  if (record.type !== 'split' || !Array.isArray(record.children) || record.children.length !== 2) {
    return null;
  }
  const direction = record.direction;
  if (direction !== 'horizontal' && direction !== 'vertical') return null;
  const left = parsePaneNode(record.children[0], panes, usedPaneIds, depth + 1);
  const right = parsePaneNode(record.children[1], panes, usedPaneIds, depth + 1);
  if (!left || !right) return null;
  return {
    type: 'split',
    id,
    direction,
    ratio: clampRatio(typeof record.ratio === 'number' ? record.ratio : 0.5),
    children: [left, right],
  };
}

export function parseWorkspacePaneLayout(raw: unknown): WorkspacePaneLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !record.panes ||
    typeof record.panes !== 'object' ||
    Array.isArray(record.panes)
  ) {
    return null;
  }
  const rawPanes = Object.entries(record.panes as Record<string, unknown>).slice(
    0,
    MAX_SNAPSHOT_PANES,
  );
  const panes: Record<string, WorkspacePane> = {};
  for (const [rawPaneId, value] of rawPanes) {
    const paneId = rawPaneId.trim();
    if (!isSafeRecordKey(paneId) || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const paneRecord = value as Record<string, unknown>;
    const tabs = Array.isArray(paneRecord.tabs)
      ? paneRecord.tabs
          .map((tab) => {
            if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null;
            const tabRecord = tab as Record<string, unknown>;
            if (tabRecord.type === 'file') {
              const path = typeof tabRecord.path === 'string' ? tabRecord.path.trim() : '';
              return path ? fileTab(path) : null;
            }
            if (tabRecord.type === 'terminal') {
              const terminalId =
                typeof tabRecord.terminalId === 'string' ? tabRecord.terminalId.trim() : '';
              const cwd = typeof tabRecord.cwd === 'string' ? tabRecord.cwd : '';
              return terminalId && terminalId.length <= 200 && isSafeRecordKey(terminalId)
                ? terminalTab(terminalId, cwd)
                : null;
            }
            if (tabRecord.type === 'browser') {
              const browserId =
                typeof tabRecord.browserId === 'string' ? tabRecord.browserId.trim() : '';
              const url = typeof tabRecord.url === 'string' ? tabRecord.url : '';
              return browserId && browserId.length <= 200 && isSafeRecordKey(browserId)
                ? browserTab(browserId, url)
                : null;
            }
            if (tabRecord.type === 'workspace-files') return workspaceFilesTab();
            if (tabRecord.type !== 'conversation') return null;
            const conversationId =
              typeof tabRecord.conversationId === 'string'
                ? String(tabRecord.conversationId).trim()
                : '';
            return conversationId ? conversationTab(conversationId) : null;
          })
          .filter((tab): tab is WorkspacePaneTab => tab !== null)
      : [];
    const activeTabId =
      typeof paneRecord.activeTabId === 'string' ? paneRecord.activeTabId.trim() : undefined;
    panes[paneId] = normalizePane({ id: paneId, tabs, activeTabId });
  }
  const usedPaneIds = new Set<string>();
  const root = parsePaneNode(record.root, panes, usedPaneIds, 0);
  if (!root) return null;
  const referencedPanes = Object.fromEntries(
    Object.entries(panes).filter(([paneId]) => usedPaneIds.has(paneId)),
  );
  const requestedFocus =
    typeof record.focusedPaneId === 'string' ? record.focusedPaneId.trim() : '';
  const focusedPaneId = Object.hasOwn(referencedPanes, requestedFocus)
    ? requestedFocus
    : paneIdsInTree(root)[0]!;
  return pruneWorkspacePaneLayout({ version: 1, panes: referencedPanes, root, focusedPaneId });
}

export function parseWorkspacePaneLayouts(raw: unknown): WorkspacePaneLayouts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !record.workspaces ||
    typeof record.workspaces !== 'object' ||
    Array.isArray(record.workspaces)
  ) {
    return {};
  }
  const result: WorkspacePaneLayouts = {};
  for (const [workspaceId, candidate] of Object.entries(
    record.workspaces as Record<string, unknown>,
  )) {
    const id = workspaceId.trim();
    if (!isSafeRecordKey(id)) continue;
    const layout = parseWorkspacePaneLayout(candidate);
    if (layout) result[id] = layout;
  }
  return result;
}
