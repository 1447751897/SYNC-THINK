import type {
  BrowserPaneTab,
  ConversationPaneTab,
  FilePaneTab,
  ReviewPaneTab,
  TerminalPaneTab,
  WorkspaceFilesPaneTab,
} from './pane-layout.js';

export type WorkbenchPlacement = 'right' | 'bottom';

export type WorkbenchTab =
  | ConversationPaneTab
  | FilePaneTab
  | TerminalPaneTab
  | BrowserPaneTab
  | ReviewPaneTab
  | WorkspaceFilesPaneTab;

export interface WorkbenchScope {
  open: boolean;
  size: number;
  tabs: WorkbenchTab[];
  activeTabId?: string;
  fileBrowserOpen: boolean;
  fileBrowserWidth: number;
}

export interface WorkspaceWorkbenchLayout {
  version: 1;
  right: WorkbenchScope;
  bottom: WorkbenchScope;
}

export type WorkspaceWorkbenchLayouts = Record<string, WorkspaceWorkbenchLayout>;

export const WORKBENCH_RIGHT_COMPACT_WIDTH = 330;
export const WORKBENCH_RIGHT_PREVIEW_WIDTH = 713;
export const WORKBENCH_RIGHT_MIN_WIDTH = 221;
export const WORKBENCH_RIGHT_MAX_WIDTH = 1_600;
export const WORKBENCH_BOTTOM_DEFAULT_HEIGHT = 280;
export const WORKBENCH_BOTTOM_MIN_HEIGHT = 180;
export const WORKBENCH_BOTTOM_MAX_HEIGHT = 720;
export const WORKBENCH_FILE_BROWSER_WIDTH = 288;
export const WORKBENCH_FILE_BROWSER_MIN_WIDTH = 221;
export const WORKBENCH_FILE_BROWSER_MAX_WIDTH = 600;

const MAX_WORKBENCH_TABS = 50;
const MAX_WORKBENCH_WORKSPACES = 100;
const MAX_ID_LENGTH = 4_000;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function scopeDefaults(placement: WorkbenchPlacement): WorkbenchScope {
  return {
    open: false,
    size: placement === 'right' ? WORKBENCH_RIGHT_COMPACT_WIDTH : WORKBENCH_BOTTOM_DEFAULT_HEIGHT,
    tabs: [],
    fileBrowserOpen: false,
    fileBrowserWidth: WORKBENCH_FILE_BROWSER_WIDTH,
  };
}

export function createWorkspaceWorkbenchLayout(): WorkspaceWorkbenchLayout {
  return {
    version: 1,
    right: scopeDefaults('right'),
    bottom: scopeDefaults('bottom'),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function placementSize(placement: WorkbenchPlacement, value: number): number {
  return placement === 'right'
    ? clamp(value, WORKBENCH_RIGHT_MIN_WIDTH, WORKBENCH_RIGHT_MAX_WIDTH)
    : clamp(value, WORKBENCH_BOTTOM_MIN_HEIGHT, WORKBENCH_BOTTOM_MAX_HEIGHT);
}

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').slice(0, MAX_ID_LENGTH);
}

function normalizeTerminalCwd(value: string): string {
  const cwd = normalizeRelativePath(value);
  if (!cwd || cwd === '.' || cwd.startsWith('/') || /^[A-Za-z]:\//.test(cwd)) return '';
  return cwd.split('/').some((part) => part === '..') ? '' : cwd;
}

function normalizeBrowserUrl(value: string): string {
  const normalized = value.trim();
  if (/^data:text\/html(?:;|,)/i.test(normalized)) return normalized.slice(0, 8 * 1024 * 1024);
  return normalized.slice(0, MAX_ID_LENGTH) || 'https://www.bing.com';
}

export function workbenchBrowserUrlsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => normalizeBrowserUrl(value).replace(/\/+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function normalizeWorkbenchTab(value: unknown): WorkbenchTab | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'workspace-files') {
    return { id: 'workspace-files', type: 'workspace-files' };
  }
  if (record.type === 'conversation' && typeof record.conversationId === 'string') {
    const conversationId = record.conversationId.trim().slice(0, MAX_ID_LENGTH);
    return conversationId
      ? { id: `conversation:${conversationId}`, type: 'conversation', conversationId }
      : null;
  }
  if (record.type === 'file' && typeof record.path === 'string') {
    const path = normalizeRelativePath(record.path);
    return path ? { id: `file:${path}`, type: 'file', path } : null;
  }
  if (record.type === 'terminal' && typeof record.terminalId === 'string') {
    const terminalId = record.terminalId.trim().slice(0, MAX_ID_LENGTH);
    return terminalId
      ? {
          id: `terminal:${terminalId}`,
          type: 'terminal',
          terminalId,
          cwd: typeof record.cwd === 'string' ? normalizeTerminalCwd(record.cwd) : '',
        }
      : null;
  }
  if (record.type === 'browser' && typeof record.browserId === 'string') {
    const browserId = record.browserId.trim().slice(0, MAX_ID_LENGTH);
    return browserId
      ? {
          id: `browser:${browserId}`,
          type: 'browser',
          browserId,
          url:
            typeof record.url === 'string'
              ? normalizeBrowserUrl(record.url)
              : 'https://www.bing.com',
        }
      : null;
  }
  if (record.type === 'review' && typeof record.runId === 'string') {
    const runId = record.runId.trim().slice(0, MAX_ID_LENGTH);
    return runId ? { id: `review:${runId}`, type: 'review', runId } : null;
  }
  return null;
}

function normalizeScope(value: unknown, placement: WorkbenchPlacement): WorkbenchScope {
  const defaults = scopeDefaults(placement);
  if (!value || typeof value !== 'object') return defaults;
  const record = value as Record<string, unknown>;
  const tabs: WorkbenchTab[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record.tabs)) {
    for (const candidate of record.tabs.slice(0, MAX_WORKBENCH_TABS)) {
      const tab = normalizeWorkbenchTab(candidate);
      if (placement === 'bottom' && tab?.type === 'workspace-files') continue;
      if (!tab || seen.has(tab.id)) continue;
      seen.add(tab.id);
      tabs.push(tab);
    }
  }
  const requestedActive = typeof record.activeTabId === 'string' ? record.activeTabId : '';
  const activeTabId = tabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : tabs.at(-1)?.id;
  return {
    open: record.open === true && tabs.length > 0,
    size: placementSize(placement, typeof record.size === 'number' ? record.size : defaults.size),
    tabs,
    activeTabId,
    fileBrowserOpen: record.fileBrowserOpen === true,
    fileBrowserWidth: clamp(
      typeof record.fileBrowserWidth === 'number'
        ? record.fileBrowserWidth
        : WORKBENCH_FILE_BROWSER_WIDTH,
      WORKBENCH_FILE_BROWSER_MIN_WIDTH,
      WORKBENCH_FILE_BROWSER_MAX_WIDTH,
    ),
  };
}

export function parseWorkspaceWorkbenchLayout(value: unknown): WorkspaceWorkbenchLayout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  return {
    version: 1,
    right: normalizeScope(record.right, 'right'),
    bottom: normalizeScope(record.bottom, 'bottom'),
  };
}

export function parseWorkspaceWorkbenchLayouts(value: unknown): WorkspaceWorkbenchLayouts {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const source =
    record.version === 1 && record.workspaces && typeof record.workspaces === 'object'
      ? (record.workspaces as Record<string, unknown>)
      : record;
  const result: WorkspaceWorkbenchLayouts = {};
  for (const [workspaceId, candidate] of Object.entries(source).slice(
    0,
    MAX_WORKBENCH_WORKSPACES,
  )) {
    if (!workspaceId || RESERVED_RECORD_KEYS.has(workspaceId)) continue;
    const layout = parseWorkspaceWorkbenchLayout(candidate);
    if (layout) result[workspaceId] = layout;
  }
  return result;
}

function scopeWithoutTab(scope: WorkbenchScope, tabId: string): WorkbenchScope {
  const index = scope.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return scope;
  const tabs = scope.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId =
    scope.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id : scope.activeTabId;
  return { ...scope, tabs, activeTabId, open: scope.open && tabs.length > 0 };
}

export function openWorkbenchTab(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  tab: WorkbenchTab,
): WorkspaceWorkbenchLayout {
  const normalized = normalizeWorkbenchTab(tab);
  if (!normalized) return layout;
  if (normalized.type === 'workspace-files' && placement !== 'right') {
    return openWorkbenchTab(layout, 'right', normalized);
  }
  const otherPlacement: WorkbenchPlacement = placement === 'right' ? 'bottom' : 'right';
  const other = scopeWithoutTab(layout[otherPlacement], normalized.id);
  const current = layout[placement];
  const existing = current.tabs.find((item) => item.id === normalized.id);
  let tabs = existing
    ? current.tabs.map((item) => (item.id === normalized.id ? normalized : item))
    : [...current.tabs, normalized].slice(-MAX_WORKBENCH_TABS);
  if (
    placement === 'right' &&
    normalized.type !== 'workspace-files' &&
    normalized.type !== 'browser' &&
    !tabs.some((item) => item.type === 'workspace-files')
  ) {
    tabs = [workspaceFilesWorkbenchTab(), ...tabs].slice(0, MAX_WORKBENCH_TABS);
  }
  const openingCompactFiles =
    placement === 'right' && normalized.type === 'workspace-files' && current.tabs.length === 0;
  const minimumPreviewWidth =
    placement === 'right' && normalized.type !== 'workspace-files'
      ? WORKBENCH_RIGHT_PREVIEW_WIDTH
      : current.size;
  return {
    ...layout,
    [otherPlacement]: other,
    [placement]: {
      ...current,
      open: true,
      tabs,
      activeTabId: normalized.id,
      size: placementSize(
        placement,
        openingCompactFiles
          ? WORKBENCH_RIGHT_COMPACT_WIDTH
          : Math.max(current.size, minimumPreviewWidth),
      ),
    },
  };
}

export function activateWorkbenchTab(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  tabId: string,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  if (!scope.tabs.some((tab) => tab.id === tabId)) return layout;
  return { ...layout, [placement]: { ...scope, open: true, activeTabId: tabId } };
}

export function closeWorkbenchTab(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  tabId: string,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  const next = scopeWithoutTab(scope, tabId);
  if (next === scope) return layout;
  const compact =
    placement === 'right' && next.tabs.length === 1 && next.tabs[0]?.type === 'workspace-files'
      ? { ...next, size: WORKBENCH_RIGHT_COMPACT_WIDTH }
      : next;
  return { ...layout, [placement]: compact };
}

export function updateWorkbenchBrowserUrl(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  browserId: string,
  url: string,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  const normalized = normalizeBrowserUrl(url);
  let changed = false;
  const tabs = scope.tabs.map((tab) => {
    if (tab.type !== 'browser' || tab.browserId !== browserId || tab.url === normalized) return tab;
    changed = true;
    return { ...tab, url: normalized };
  });
  if (!changed) return layout;
  return { ...layout, [placement]: { ...scope, tabs } };
}

export function setWorkbenchOpen(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  open: boolean,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  if (scope.open === open || (open && scope.tabs.length === 0)) return layout;
  return { ...layout, [placement]: { ...scope, open } };
}

export function toggleWorkspaceFilesWorkbench(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement = 'right',
): WorkspaceWorkbenchLayout {
  const target: WorkbenchPlacement = placement === 'bottom' ? 'right' : placement;
  const scope = layout[target];
  const resources = scope.tabs.filter((tab) => tab.type !== 'workspace-files');
  const hasFilesTab = scope.tabs.some((tab) => tab.type === 'workspace-files');
  const activeIsFiles = !scope.activeTabId || scope.activeTabId === 'workspace-files';

  if (resources.length === 0) {
    if (scope.open && hasFilesTab && activeIsFiles) return layout;
    return openWorkbenchTab(layout, 'right', workspaceFilesWorkbenchTab());
  }

  if (activeIsFiles) {
    return setWorkbenchFileBrowserOpen(
      activateWorkbenchTab(layout, 'right', resources.at(-1)!.id),
      'right',
      true,
    );
  }

  return setWorkbenchFileBrowserOpen(layout, 'right', !scope.fileBrowserOpen);
}

export function setWorkbenchSize(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  size: number,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  const nextSize = placementSize(placement, size);
  return nextSize === scope.size
    ? layout
    : { ...layout, [placement]: { ...scope, size: nextSize } };
}

export function setWorkbenchFileBrowserOpen(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  open: boolean,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  if (scope.fileBrowserOpen === open) return layout;
  if (placement !== 'right') {
    return { ...layout, [placement]: { ...scope, fileBrowserOpen: open } };
  }
  return {
    ...layout,
    right: {
      ...scope,
      fileBrowserOpen: open,
      size: open
        ? placementSize('right', Math.max(scope.size, WORKBENCH_RIGHT_PREVIEW_WIDTH))
        : scope.size,
    },
  };
}

export function setWorkbenchFileBrowserWidth(
  layout: WorkspaceWorkbenchLayout,
  placement: WorkbenchPlacement,
  width: number,
): WorkspaceWorkbenchLayout {
  const scope = layout[placement];
  const fileBrowserWidth = clamp(
    width,
    WORKBENCH_FILE_BROWSER_MIN_WIDTH,
    WORKBENCH_FILE_BROWSER_MAX_WIDTH,
  );
  return fileBrowserWidth === scope.fileBrowserWidth
    ? layout
    : { ...layout, [placement]: { ...scope, fileBrowserWidth } };
}

export function workspaceFilesWorkbenchTab(): WorkspaceFilesPaneTab {
  return { id: 'workspace-files', type: 'workspace-files' };
}

export function conversationWorkbenchTab(conversationId: string): ConversationPaneTab {
  const normalized = conversationId.trim().slice(0, MAX_ID_LENGTH);
  return {
    id: `conversation:${normalized}`,
    type: 'conversation',
    conversationId: normalized,
  };
}

export function findWorkbenchBrowser(
  layout: WorkspaceWorkbenchLayout,
): { placement: WorkbenchPlacement; tab: BrowserPaneTab } | null {
  for (const placement of ['right', 'bottom'] as const) {
    const tab = layout[placement].tabs.find(
      (item): item is BrowserPaneTab => item.type === 'browser',
    );
    if (tab) return { placement, tab };
  }
  return null;
}

export function findWorkbenchBrowserByUrl(
  layout: WorkspaceWorkbenchLayout,
  url: string,
): { placement: WorkbenchPlacement; tab: BrowserPaneTab } | null {
  for (const placement of ['right', 'bottom'] as const) {
    const tab = layout[placement].tabs.find(
      (item): item is BrowserPaneTab =>
        item.type === 'browser' && workbenchBrowserUrlsMatch(item.url, url),
    );
    if (tab) return { placement, tab };
  }
  return null;
}

export function openOrFocusWorkbenchBrowser(
  layout: WorkspaceWorkbenchLayout,
  browserId: string,
  url: string,
  placement: WorkbenchPlacement = 'right',
): WorkspaceWorkbenchLayout {
  const existingSame = findWorkbenchBrowserByUrl(layout, url);
  if (existingSame) {
    return activateWorkbenchTab(layout, existingSame.placement, existingSame.tab.id);
  }
  return openWorkbenchTab(layout, placement, browserWorkbenchTab(browserId, url));
}

export function findWorkbenchConversation(
  layout: WorkspaceWorkbenchLayout,
  conversationId: string,
): { placement: WorkbenchPlacement; tab: ConversationPaneTab } | null {
  const id = conversationId.trim();
  if (!id) return null;
  for (const placement of ['right', 'bottom'] as const) {
    const tab = layout[placement].tabs.find(
      (item): item is ConversationPaneTab =>
        item.type === 'conversation' && item.conversationId === id,
    );
    if (tab) return { placement, tab };
  }
  return null;
}

export function closeWorkbenchConversation(
  layout: WorkspaceWorkbenchLayout,
  conversationId: string,
): WorkspaceWorkbenchLayout {
  const found = findWorkbenchConversation(layout, conversationId);
  return found ? closeWorkbenchTab(layout, found.placement, found.tab.id) : layout;
}

export function replaceWorkbenchConversation(
  layout: WorkspaceWorkbenchLayout,
  fromConversationId: string,
  toConversationId: string,
): WorkspaceWorkbenchLayout {
  const fromId = fromConversationId.trim();
  const toId = toConversationId.trim();
  if (!fromId || !toId || fromId === toId) return layout;
  const found = findWorkbenchConversation(layout, fromId);
  if (!found) return layout;
  const existing = findWorkbenchConversation(layout, toId);
  if (existing) {
    const closed = closeWorkbenchTab(layout, found.placement, found.tab.id);
    return activateWorkbenchTab(closed, existing.placement, existing.tab.id);
  }
  const replacement = conversationWorkbenchTab(toId);
  const scope = layout[found.placement];
  return {
    ...layout,
    [found.placement]: {
      ...scope,
      tabs: scope.tabs.map((tab) => (tab.id === found.tab.id ? replacement : tab)),
      activeTabId: scope.activeTabId === found.tab.id ? replacement.id : scope.activeTabId,
    },
  };
}

export function fileWorkbenchTab(path: string): FilePaneTab {
  const normalized = normalizeRelativePath(path);
  return { id: `file:${normalized}`, type: 'file', path: normalized };
}

export function reviewWorkbenchTab(runId: string): ReviewPaneTab {
  const normalized = runId.trim().slice(0, MAX_ID_LENGTH);
  return { id: `review:${normalized}`, type: 'review', runId: normalized };
}

export function terminalWorkbenchTab(terminalId: string, cwd = ''): TerminalPaneTab {
  const normalized = terminalId.trim().slice(0, MAX_ID_LENGTH);
  return {
    id: `terminal:${normalized}`,
    type: 'terminal',
    terminalId: normalized,
    cwd: normalizeTerminalCwd(cwd),
  };
}

export function browserWorkbenchTab(browserId: string, url: string): BrowserPaneTab {
  const normalized = browserId.trim().slice(0, MAX_ID_LENGTH);
  return {
    id: `browser:${normalized}`,
    type: 'browser',
    browserId: normalized,
    url: normalizeBrowserUrl(url),
  };
}
