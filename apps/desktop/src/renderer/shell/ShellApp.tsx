// New shell root — NewMax visual constitution (S3 / D3 first cut).
// Sidebar top actions + three tracks with groups · workspace tabs (no 全部) ·
// welcome empty state · settings modal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Brain, Globe, SendHorizonal, Sparkles, Users, Zap, X } from 'lucide-react';
import type {
  Conversation,
  ConversationTrack,
  Event,
  GlobalAgent,
  Team,
  WorkspaceId,
} from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { mergeEventHistory } from '../../event-history.js';
import {
  buildConversationActivity,
  buildWorkspaceActivity,
  isConversationUnread,
  markConversationSeen,
  readConversationLastSeen,
  writeConversationLastSeen,
} from '../conversation-activity.js';
import type { RunActivityAuthority } from '../run-activity-authority.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { ConversationTabs } from './ConversationTabs.js';
import { WorkspacePaneHost } from './WorkspacePaneHost.js';
import { ChatView, type RuntimeConnectionNotice } from './ChatView.js';
import {
  FilePane,
  clearFilePaneSession,
  isFilePaneSessionDirty,
  type FileRevealTarget,
} from './FilePane.js';
import { TerminalPane } from './TerminalPane.js';
import { disposeTerminalSession } from './terminal-session-store.js';
import { BrowserPanel } from './BrowserPanel.js';
import { WorkspaceFilesPanel } from './RightDock.js';
import { AgentLibrary } from './AgentLibrary.js';
import { TeamLibrary } from './TeamLibrary.js';
import { AbilitiesPage } from './AbilitiesPage.js';
import { BrowserStage } from './BrowserStage.js';
import { SettingsPage } from './SettingsPage.js';
import { FirstLaunchGuide } from './FirstLaunchGuide.js';
import {
  ContextRing,
  estimateContextWindow,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  ReasoningMenu,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import {
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
} from './compose-skill-selection.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { canCloseSettings } from './settings-unsaved.js';
import { NewConversationDialog, type ModelOption } from './NewConversationDialog.js';
import { useDialog, DialogProvider } from './Dialog.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import {
  createConversationGroup,
  deleteConversationGroup,
  emptyConversationGroups,
  filterByWorkspace,
  INITIAL_NAV,
  moveConversationToGroup,
  openConversation,
  renameConversationGroup,
  selectStage,
  setLastTrack,
  setSidebarCollapsed,
  STAGE_LABELS,
  targetName,
  toggleConversationGroupCollapsed,
  toggleSidebar,
  toggleTrack,
  type ShellNavState,
  type ShellStage,
} from './shell-state.js';
import {
  readActiveWorkspaceId,
  readConversationGroups,
  readDefaultPermission,
  readLastConversationTrack,
  readNewConversationDraft,
  readNewConversationModel,
  readConversationModelOverrides,
  readOpenConversationTabs,
  readSelectedConversationByWorkspace,
  readWorkspacePaneLayouts,
  readSidebarWidth,
  readUserName,
  buildGreeting,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  writeActiveWorkspaceId,
  writeConversationGroups,
  writeLastConversationTrack,
  writeNewConversationDraft,
  writeNewConversationModel,
  writeConversationModelOverride,
  writeOpenConversationTabs,
  writeSelectedConversationByWorkspace,
  writeWorkspacePaneLayouts,
  writeSidebarWidth,
  type ConversationGroupsByTrack,
} from '../ui-preferences.js';
import {
  activateFilePaneTab,
  activatePaneTab,
  activateBrowserPaneTab,
  activateWorkspaceFilesPaneTab,
  activateTerminalPaneTab,
  closeBrowserPaneTab,
  closeFilePaneTab,
  closeConversationInLayout,
  closePane,
  closePaneTab,
  closeWorkspaceFilesPaneTab,
  closeTerminalPaneTab,
  createWorkspacePaneLayout,
  findWorkspaceFilesPane,
  focusPane,
  focusedConversationId,
  migrateLegacyPaneLayouts,
  movePaneResourceToPane,
  openBrowserInPane,
  openFileInPane,
  openConversationInPane,
  openTerminalInPane,
  paneConversationIds,
  pruneWorkspacePaneLayout,
  replaceConversationInPane,
  reorderPaneTabs,
  setSplitRatio,
  splitPaneWithConversation,
  splitPaneWithWorkspaceFiles,
  updateTerminalPaneCwd,
  type PaneResourceRef,
  type PaneSplitDirection,
  type WorkspacePaneLayout,
  type WorkspacePaneLayouts,
} from './pane-layout.js';

interface ShellData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  modelNames: Map<string, string>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
}

interface DraftConversationSession {
  id: string;
  workspaceId: string;
  track: ConversationTrack;
  targetRef?: string;
  createdAt: string;
}

const EMPTY: ShellData = {
  conversations: [],
  agents: [],
  teams: [],
  modelNames: new Map(),
  models: [],
  workspaces: [],
};

const MAX_MOUNTED_CHAT_VIEWS = 2;

function bridge() {
  return window.syncThink?.runtime;
}

function persistPaneLayouts(layouts: WorkspacePaneLayouts): void {
  writeWorkspacePaneLayouts(layouts);
  const legacyTabs: Record<string, string[]> = {};
  const legacySelected: Record<string, string> = {};
  for (const [workspaceId, layout] of Object.entries(layouts)) {
    const ids = paneConversationIds(layout);
    if (ids.length > 0) legacyTabs[workspaceId] = ids;
    const selected = focusedConversationId(layout);
    if (selected) legacySelected[workspaceId] = selected;
  }
  writeOpenConversationTabs(legacyTabs);
  writeSelectedConversationByWorkspace(legacySelected);
}

function fileTabDirtyKey(workspaceId: string, path: string): string {
  return `${workspaceId}\0${path}`;
}

function createTerminalId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function createBrowserId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function paneTabMatchesResource(
  tab: WorkspacePaneLayout['panes'][string]['tabs'][number],
  resource: PaneResourceRef,
): boolean {
  if (resource.type === 'conversation') {
    return tab.type === 'conversation' && tab.conversationId === resource.id;
  }
  if (resource.type === 'file') return tab.type === 'file' && tab.path === resource.id;
  if (resource.type === 'terminal') {
    return tab.type === 'terminal' && tab.terminalId === resource.id;
  }
  if (resource.type === 'browser') {
    return tab.type === 'browser' && tab.browserId === resource.id;
  }
  return tab.type === 'workspace-files';
}

function parsePaneResourceDrag(raw: string): PaneResourceRef | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PaneResourceRef>;
    if (
      value.type === 'conversation' ||
      value.type === 'file' ||
      value.type === 'terminal' ||
      value.type === 'browser'
    ) {
      return typeof value.id === 'string' && value.id.trim()
        ? { type: value.type, id: value.id }
        : null;
    }
    if (value.type === 'workspace-files') {
      return { type: 'workspace-files', id: 'workspace-files' };
    }
  } catch {
    return null;
  }
  return null;
}

export function ShellApp() {
  // DialogProvider wraps the real component tree so useDialog() resolves
  // to the in-app NewMax dialogs; tests that render <ShellApp /> also get it.
  return (
    <DialogProvider>
      <ShellAppInner />
    </DialogProvider>
  );
}

function ShellAppInner() {
  const dialog = useDialog();
  const [nav, setNav] = useState<ShellNavState>(() => ({
    ...INITIAL_NAV,
    lastTrack: readLastConversationTrack(),
  }));
  const [data, setData] = useState<ShellData>(EMPTY);
  const [skillCatalogRevision, setSkillCatalogRevision] = useState(0);
  const [eventHistory, setEventHistory] = useState<readonly Event[]>([]);
  const [runActivityAuthority, setRunActivityAuthority] = useState<
    RunActivityAuthority | undefined
  >();
  const [runtimeConnectionRevision, setRuntimeConnectionRevision] = useState(0);
  const [runtimeConnectionNotice, setRuntimeConnectionNotice] =
    useState<RuntimeConnectionNotice>(null);
  const [pickerTrack, setPickerTrack] = useState<ConversationTrack | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(() =>
    readActiveWorkspaceId(),
  );
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  const [groups, setGroups] = useState<ConversationGroupsByTrack>(() =>
    readConversationGroups(readActiveWorkspaceId()),
  );
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [newConversationDraft, setNewConversationDraft] = useState(() =>
    readNewConversationDraft(),
  );
  const [newConversationModel, setNewConversationModel] = useState(() =>
    readNewConversationModel(),
  );
  const [newConversationSending, setNewConversationSending] = useState(false);
  const [newConversationError, setNewConversationError] = useState<string | undefined>();
  const [paneLayouts, setPaneLayouts] = useState<WorkspacePaneLayouts>(() =>
    migrateLegacyPaneLayouts(
      readWorkspacePaneLayouts(),
      readOpenConversationTabs(),
      readSelectedConversationByWorkspace(),
    ),
  );
  const initialPaneLayoutsRef = useRef(paneLayouts);
  const [dirtyFileTabs, setDirtyFileTabs] = useState<Set<string>>(() => new Set());
  const [fileRevealTargets, setFileRevealTargets] = useState<Map<string, FileRevealTarget>>(
    () => new Map(),
  );
  const fileRevealNonceRef = useRef(0);
  /**
   * Per-conversation compose model overrides (local UI pref).
   * Sidebar identity for model-track chats must prefer these over targetRef,
   * otherwise switching models in Compose leaves the left list stale.
   */
  const [modelOverrides, setModelOverrides] = useState(() => readConversationModelOverrides());
  /** Right rail open state lives on the stage tab strip (no in-chat title bar). */
  const [railOpen, setRailOpen] = useState(false);
  /**
   * 正在被拖拽的对话 tab id（NewMax 式跨屏移动）：拖动 tab 时聊天区右缘
   * 显示「拖到此处开分屏」落点，drop 后该对话进入右侧分屏。
   */
  const [tabDragResource, setTabDragResource] = useState<PaneResourceRef | null>(null);
  const [paneDropTargetId, setPaneDropTargetId] = useState<string | null>(null);
  /** 各对话「用户最后查看到的事件 sequence」——完成后未查看即未读。 */
  const [conversationLastSeen, setConversationLastSeen] = useState(() =>
    readConversationLastSeen(),
  );
  /**
   * A local-only conversation projected into the current workspace tree and
   * pane tabs. Runtime persistence still waits for the first successful turn.
   */
  const [draftSession, setDraftSessionState] = useState<DraftConversationSession | null>(null);
  const draftSessionRef = useRef<DraftConversationSession | null>(null);
  const draftNonceRef = useRef(0);
  const setDraftSession = useCallback(
    (
      value:
        | DraftConversationSession
        | null
        | ((current: DraftConversationSession | null) => DraftConversationSession | null),
    ) => {
      const next =
        typeof value === 'function' ? value(draftSessionRef.current) : value;
      draftSessionRef.current = next;
      setDraftSessionState(next);
    },
    [],
  );
  const pendingFirstMessageRef = useRef<{
    text: string;
    modelId?: string;
    permissionMode: PermissionMode;
    reasoningEffort: ReasoningEffort;
    networkEnabled: boolean;
    skillVersionIds: string[];
  } | null>(null);
  const initialConversationSkillSelectionsRef = useRef(new Map<string, string[]>());
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const persistGroups = useCallback(
    (next: ConversationGroupsByTrack) => {
      setGroups(next);
      if (activeWorkspaceId) writeConversationGroups(activeWorkspaceId, next);
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    // Persist a one-time migration from the former openTabs/selected keys.
    persistPaneLayouts(initialPaneLayoutsRef.current);
    // The initial snapshot is intentionally written once; later writes happen
    // at reducer commit points so divider drags do not churn localStorage.
  }, []);

  const commitPaneLayout = useCallback(
    (
      workspaceId: string,
      update: (currentLayout: WorkspacePaneLayout) => WorkspacePaneLayout,
    ) => {
      setPaneLayouts((current) => {
        const currentLayout = current[workspaceId] ?? createWorkspacePaneLayout(workspaceId);
        const layout = update(currentLayout);
        if (layout === currentLayout && Object.hasOwn(current, workspaceId)) return current;
        const next = { ...current, [workspaceId]: layout };
        persistPaneLayouts(next);
        return next;
      });
    },
    [],
  );

  const focusConversation = useCallback(
    (conversationId: string, workspaceId?: string) => {
      const ws =
        workspaceId ??
        data.conversations.find((c) => c.id === conversationId)?.workspaceId ??
        activeWorkspaceIdRef.current;
      if (ws) {
        commitPaneLayout(ws, (current) => openConversationInPane(current, conversationId));
      }
      if (!ws || activeWorkspaceIdRef.current === ws) {
        setNav((n) => openConversation(n, conversationId));
      }
    },
    [commitPaneLayout, data.conversations],
  );

  const handleSplitConversation = useCallback(
    (paneId: string, conversationId: string, direction: PaneSplitDirection) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        splitPaneWithConversation(current, paneId, direction, conversationId),
      );
      setNav((state) => openConversation(state, conversationId));
      setRailOpen(false);
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleRailOpenChange = useCallback((open: boolean) => {
    setRailOpen(open);
  }, []);

  const handleCloseConversationTab = useCallback(
    (paneId: string, conversationId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        closePaneTab(current, paneId, conversationId),
      );
      if (draftSessionRef.current?.id === conversationId) {
        pendingFirstMessageRef.current = null;
        setDraftSession(null);
        setNewConversationDraft('');
        writeNewConversationDraft('');
        setNewConversationError(undefined);
      }
    },
    [activeWorkspaceId, commitPaneLayout, setDraftSession],
  );

  const handleOpenFileInPane = useCallback(
    (paneId: string, path: string, location?: ProjectTextLocation) => {
      if (!activeWorkspaceId) return;
      if (location) {
        fileRevealNonceRef.current += 1;
        const key = fileTabDirtyKey(activeWorkspaceId, path);
        const target: FileRevealTarget = { ...location, nonce: fileRevealNonceRef.current };
        setFileRevealTargets((current) => {
          const next = new Map(current);
          next.set(key, target);
          return next;
        });
      }
      commitPaneLayout(activeWorkspaceId, (current) => openFileInPane(current, path, paneId));
      setRailOpen(false);
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleOpenTerminalInPane = useCallback(
    (paneId?: string) => {
      if (!activeWorkspaceId) return;
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      if (!projectFolder) return;
      const terminalId = createTerminalId();
      commitPaneLayout(activeWorkspaceId, (current) =>
        openTerminalInPane(current, terminalId, '', paneId ?? current.focusedPaneId),
      );
      setRailOpen(false);
    },
    [activeWorkspaceId, commitPaneLayout, data.workspaces],
  );

  const handleOpenBrowserInPane = useCallback(
    (paneId?: string) => {
      if (!activeWorkspaceId) return;
      const browserId = createBrowserId();
      commitPaneLayout(activeWorkspaceId, (current) =>
        openBrowserInPane(
          current,
          browserId,
          'https://www.bing.com',
          paneId ?? current.focusedPaneId,
        ),
      );
      setRailOpen(false);
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleActivateBrowserTab = useCallback(
    (paneId: string, browserId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activateBrowserPaneTab(current, paneId, browserId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleCloseBrowserTab = useCallback(
    (paneId: string, browserId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        closeBrowserPaneTab(current, paneId, browserId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleToggleWorkspaceFilesPane = useCallback(
    (targetPaneId?: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) => {
        const existingPaneId = findWorkspaceFilesPane(current);
        if (existingPaneId) {
          return closeWorkspaceFilesPaneTab(current, existingPaneId);
        }
        return splitPaneWithWorkspaceFiles(
          current,
          targetPaneId ?? current.focusedPaneId,
          'horizontal',
        );
      });
      setRailOpen(false);
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleActivateWorkspaceFilesTab = useCallback(
    (paneId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activateWorkspaceFilesPaneTab(current, paneId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleCloseWorkspaceFilesTab = useCallback(
    (paneId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        closeWorkspaceFilesPaneTab(current, paneId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleFileDirtyChange = useCallback(
    (workspaceId: string, path: string, dirty: boolean) => {
      const key = fileTabDirtyKey(workspaceId, path);
      setDirtyFileTabs((current) => {
        if (current.has(key) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [],
  );

  const handleCloseFileTab = useCallback(
    async (paneId: string, path: string) => {
      if (!activeWorkspaceId) return;
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      if (projectFolder && isFilePaneSessionDirty(projectFolder, path)) {
        const confirmed = await dialog.confirm({
          title: '关闭未保存的文件',
          message: `${path} 还有未保存的修改，确定放弃这些修改吗？`,
          confirmText: '放弃并关闭',
          danger: true,
        });
        if (!confirmed) return;
      }
      if (projectFolder) clearFilePaneSession(projectFolder, path);
      handleFileDirtyChange(activeWorkspaceId, path, false);
      setFileRevealTargets((current) => {
        const key = fileTabDirtyKey(activeWorkspaceId, path);
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      commitPaneLayout(activeWorkspaceId, (current) => closeFilePaneTab(current, paneId, path));
    },
    [activeWorkspaceId, commitPaneLayout, data.workspaces, dialog, handleFileDirtyChange],
  );

  const handleClosePane = useCallback(
    async (paneId: string) => {
      if (!activeWorkspaceId) return;
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      const filePaths = (paneLayouts[activeWorkspaceId]?.panes[paneId]?.tabs ?? [])
        .filter((tab) => tab.type === 'file')
        .map((tab) => tab.path);
      const terminalIds = (paneLayouts[activeWorkspaceId]?.panes[paneId]?.tabs ?? [])
        .filter((tab) => tab.type === 'terminal')
        .map((tab) => tab.terminalId);
      const dirtyPaths = projectFolder
        ? filePaths.filter((path) => isFilePaneSessionDirty(projectFolder, path))
        : [];
      if (dirtyPaths.length > 0) {
        const confirmed = await dialog.confirm({
          title: '关闭含未保存文件的窗格',
          message: `该窗格还有 ${dirtyPaths.length} 个文件未保存，确定放弃修改并关闭吗？`,
          confirmText: '放弃并关闭',
          danger: true,
        });
        if (!confirmed) return;
      }
      if (projectFolder) {
        for (const path of filePaths) clearFilePaneSession(projectFolder, path);
      }
      await Promise.all(terminalIds.map((terminalId) => disposeTerminalSession(terminalId)));
      setDirtyFileTabs((current) => {
        const next = new Set(current);
        let changed = false;
        for (const path of filePaths) {
          changed = next.delete(fileTabDirtyKey(activeWorkspaceId, path)) || changed;
        }
        return changed ? next : current;
      });
      setFileRevealTargets((current) => {
        const next = new Map(current);
        let changed = false;
        for (const path of filePaths) {
          changed = next.delete(fileTabDirtyKey(activeWorkspaceId, path)) || changed;
        }
        return changed ? next : current;
      });
      commitPaneLayout(activeWorkspaceId, (current) => closePane(current, paneId));
    },
    [activeWorkspaceId, commitPaneLayout, data.workspaces, dialog, paneLayouts],
  );

  const handleActivatePaneTab = useCallback(
    (paneId: string, conversationId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activatePaneTab(current, paneId, conversationId),
      );
      setNav((state) => openConversation(state, conversationId));
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleActivateFileTab = useCallback(
    (paneId: string, path: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activateFilePaneTab(current, paneId, path),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleActivateTerminalTab = useCallback(
    (paneId: string, terminalId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activateTerminalPaneTab(current, paneId, terminalId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleCloseTerminalTab = useCallback(
    async (paneId: string, terminalId: string) => {
      if (!activeWorkspaceId) return;
      await disposeTerminalSession(terminalId);
      commitPaneLayout(activeWorkspaceId, (current) =>
        closeTerminalPaneTab(current, paneId, terminalId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleTerminalCwdChange = useCallback(
    (paneId: string, terminalId: string, cwd: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        updateTerminalPaneCwd(current, paneId, terminalId, cwd),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleFocusPane = useCallback(
    (paneId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) => focusPane(current, paneId));
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleMovePaneResourceToPane = useCallback(
    (resource: PaneResourceRef, targetPaneId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        movePaneResourceToPane(current, resource, targetPaneId),
      );
      if (resource.type === 'conversation') {
        setNav((state) => openConversation(state, resource.id));
      }
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      const draft = draftSessionRef.current;
      if (draft && draft.workspaceId !== workspaceId) {
        setPaneLayouts((current) => {
          const layout = current[draft.workspaceId];
          if (!layout) return current;
          const next = {
            ...current,
            [draft.workspaceId]: closeConversationInLayout(layout, draft.id),
          };
          persistPaneLayouts(next);
          return next;
        });
        pendingFirstMessageRef.current = null;
        setDraftSession(null);
        setNewConversationDraft('');
        writeNewConversationDraft('');
      }
      activeWorkspaceIdRef.current = workspaceId;
      setActiveWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId);
      setGroups(readConversationGroups(workspaceId));
      setNav((current) => ({
        ...current,
        stage: 'talk',
        selectedConversationId: undefined,
      }));
      setSelectedIds(new Set());
      setMultiSelect(false);
      setPickerTrack(null);
      setRailOpen(false);
    },
    [setDraftSession],
  );

  const handleReorderConversationTab = useCallback(
    (paneId: string, fromId: string, toId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        reorderPaneTabs(current, paneId, fromId, toId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleSplitRatioChange = useCallback(
    (splitNodeId: string, ratio: number, commit: boolean) => {
      if (!activeWorkspaceId) return;
      setPaneLayouts((current) => {
        const layout = current[activeWorkspaceId] ?? createWorkspacePaneLayout(activeWorkspaceId);
        const nextLayout = setSplitRatio(layout, splitNodeId, ratio);
        const next = { ...current, [activeWorkspaceId]: nextLayout };
        if (commit) persistPaneLayouts(next);
        return next;
      });
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    setGroups(readConversationGroups(activeWorkspaceId));
  }, [activeWorkspaceId]);

  const refresh = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const [conversations, agents, teams, providers, workspaces] = await Promise.all([
      api.listConversations({ includeArchived: true }),
      api.listGlobalAgents({}),
      api.listTeams(),
      api.listProviders({}),
      api.listWorkspaces({}),
    ]);
    const modelNames = new Map<string, string>();
    const models: ModelOption[] = [];
    for (const provider of providers.providers) {
      if (provider.enabled === false) continue;
      for (const model of provider.models) {
        modelNames.set(model.modelId, model.displayName);
        models.push({
          modelId: model.modelId,
          displayName: model.displayName,
          providerName: provider.name,
          contextWindow: model.contextWindow,
        });
      }
    }
    setData({
      conversations: conversations.conversations,
      agents: agents.agents,
      teams: teams.teams,
      modelNames,
      models,
      workspaces: workspaces.workspaces,
    });

    // Drop stale tabs per workspace and collapse empty branches without ever
    // using another workspace's conversation as a valid reference.
    setPaneLayouts((current) => {
      const next: WorkspacePaneLayouts = {};
      for (const [workspaceId, layout] of Object.entries(current)) {
        const validIds = new Set(
          conversations.conversations
            .filter((conversation) => conversation.workspaceId === workspaceId)
            .map((conversation) => String(conversation.id)),
        );
        const draft = draftSessionRef.current;
        if (draft?.workspaceId === workspaceId) validIds.add(draft.id);
        next[workspaceId] = pruneWorkspacePaneLayout(layout, validIds);
      }
      persistPaneLayouts(next);
      return next;
    });

    // No「全部」: always land on a concrete workspace when possible.
    setActiveWorkspaceId((current) => {
      const list = workspaces.workspaces;
      if (list.length === 0) {
        activeWorkspaceIdRef.current = undefined;
        writeActiveWorkspaceId(undefined);
        return undefined;
      }
      if (current && list.some((w) => w.workspaceId === current)) {
        activeWorkspaceIdRef.current = current;
        return current;
      }
      const next = list[0]!.workspaceId;
      activeWorkspaceIdRef.current = next;
      writeActiveWorkspaceId(next);
      return next;
    });
  }, []);

  // After boot data is ready, restore the last focused conversation for the
  // active workspace so open tabs and the main stage stay in sync.
  useEffect(() => {
    if (bootState !== 'ready') return;
    if (!activeWorkspaceId) return;
    setNav((current) => {
      if (current.stage !== 'talk') return current;
      if (current.selectedConversationId) return current;
      const restored = focusedConversationId(
        paneLayouts[activeWorkspaceId] ?? createWorkspacePaneLayout(activeWorkspaceId),
      );
      if (!restored || restored === current.selectedConversationId) return current;
      return { ...current, selectedConversationId: restored };
    });
    // Intentionally only on boot readiness / workspace id — not on every tab edit.
  }, [bootState, activeWorkspaceId, paneLayouts]);

  useEffect(() => {
    const api = bridge();
    if (!api) {
      setBootState('error');
      setBootError('渲染进程未注入 runtime bridge');
      return;
    }

    let cancelled = false;
    setBootState('loading');
    setBootError(undefined);

    const unsub = api.onEvent?.((event: Event) => {
      setEventHistory((prev) => mergeEventHistory(prev, [event]));
    });

    const stopConnect = startRuntimeConnection({
      connect: () => api.connect(),
      retryDelaysMs: [300, 600, 1_200, 2_000, 3_000],
      onConnected: (result) => {
        if (cancelled) return;
        setRuntimeConnectionNotice(null);
        setEventHistory((prev) => mergeEventHistory(prev, result.snapshot));
        const health = result.health;
        setRunActivityAuthority(
          health?.ok
            ? {
                throughSequence: health.eventSequence,
                activeRunIds: new Set(health.inFlightRunIds),
              }
            : undefined,
        );
        setRuntimeConnectionRevision((revision) => revision + 1);
        void refresh()
          .then(() => {
            if (!cancelled) {
              setBootState('ready');
              setBootError(undefined);
            }
          })
          .catch((error) => {
            if (cancelled) return;
            setBootState('error');
            setBootError(error instanceof Error ? error.message : '加载对话列表失败');
          });
      },
      onRetrying: ({ attempt, maxAttempts }) => {
        if (cancelled) return;
        setRuntimeConnectionNotice({
          state: 'retrying',
          text: `正在重新连接运行时 ${attempt}/${maxAttempts}`,
        });
      },
      onFailed: (error) => {
        if (cancelled) return;
        setRuntimeConnectionNotice({
          state: 'failed',
          text: `连接运行时失败：${error.code}`,
        });
        setBootError(error.code);
        void refresh()
          .then(() => {
            if (!cancelled) setBootState('ready');
          })
          .catch(() => {
            if (!cancelled) setBootState('error');
          });
      },
    });

    return () => {
      cancelled = true;
      stopConnect();
      unsub?.();
    };
  }, [refresh]);

  const pendingOpenRef = useRef<string | null>(null);

  const openConversationById = useCallback(
    (conversationId: string) => {
      const target = data.conversations.find((c) => c.id === conversationId);
      if (!target) {
        // Conversations not loaded yet — hold the id; refresh() or a later
        // data update flushes it once it appears.
        pendingOpenRef.current = conversationId;
        return;
      }
      pendingOpenRef.current = null;
      // Deep links can target a conversation in another workspace. Switch there
      // first so the workspace-scoped main stage can resolve the selection.
      if (target.workspaceId && target.workspaceId !== activeWorkspaceIdRef.current) {
        selectWorkspace(target.workspaceId);
      }
      focusConversation(conversationId, target.workspaceId);
    },
    [data.conversations, focusConversation, selectWorkspace],
  );

  // Inbox for syncthink://conversation/{id} dispatched by the main process.
  useEffect(() => {
    const api = bridge();
    const unsubscribe = api?.onOpenConversation?.((conversationId) => {
      void openConversationById(conversationId);
    });
    // Tell main we are mounted so it can flush any cold-start deep link.
    api?.notifyRendererReady?.();
    return () => unsubscribe?.();
  }, [openConversationById]);

  // Flush a pending deep link once conversations arrive.
  useEffect(() => {
    if (pendingOpenRef.current && data.conversations.length > 0) {
      openConversationById(pendingOpenRef.current);
    }
  }, [data.conversations, openConversationById]);

  // Ctrl+B toggles sidebar (R3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setNav((n) => toggleSidebar(n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sidebar drag resize.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, drag.startWidth + (e.clientX - drag.startX)),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      setSidebarWidth((w) => {
        writeSidebarWidth(w);
        return w;
      });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const rememberTrack = useCallback((track: ConversationTrack) => {
    setNav((n) => setLastTrack(n, track));
    writeLastConversationTrack(track);
  }, []);

  const beginDraftConversation = useCallback(
    (
      track: ConversationTrack,
      targetRef?: string,
      targetPaneId?: string,
    ): DraftConversationSession | null => {
      if (!activeWorkspaceId) {
        setNewConversationError('请先创建或打开一个工作区');
        return null;
      }
      const existing = draftSessionRef.current;
      if (existing?.workspaceId === activeWorkspaceId) {
        commitPaneLayout(activeWorkspaceId, (current) =>
          openConversationInPane(current, existing.id, targetPaneId),
        );
        setNav((current) => openConversation(current, existing.id));
        return existing;
      }

      draftNonceRef.current += 1;
      const createdAt = new Date().toISOString();
      const draft: DraftConversationSession = {
        id: `draft:${activeWorkspaceId}:${createdAt}:${draftNonceRef.current}`,
        workspaceId: activeWorkspaceId,
        track,
        targetRef: targetRef?.trim() || undefined,
        createdAt,
      };
      setDraftSession(draft);
      commitPaneLayout(activeWorkspaceId, (current) =>
        openConversationInPane(current, draft.id, targetPaneId),
      );
      setNav((current) => openConversation({ ...current, stage: 'talk' }, draft.id));
      return draft;
    },
    [activeWorkspaceId, commitPaneLayout, setDraftSession],
  );

  const createConversationWithTarget = useCallback(
    async (track: ConversationTrack, targetRef: string, firstMessage?: {
      text: string;
      modelId?: string;
      permissionMode: PermissionMode;
      reasoningEffort: ReasoningEffort;
      networkEnabled: boolean;
      skillVersionIds: string[];
    }) => {
      const api = bridge();
      if (!api) return;
      if (!activeWorkspaceId) {
        setNewConversationError('请先创建或打开一个工作区');
        return;
      }
      const workspaceId = activeWorkspaceId;
      setPickerTrack(null);
      rememberTrack(track);
      const created = await api.createConversation({
        track,
        targetRef,
        workspaceId: workspaceId as WorkspaceId,
        executionMode: firstMessage?.permissionMode ?? readDefaultPermission(),
      });
      const initialModelId = firstMessage?.modelId?.trim();
      if (initialModelId) {
        const conversationId = String(created.conversation.id);
        writeConversationModelOverride(conversationId, initialModelId);
        setModelOverrides((current) => ({
          ...current,
          [conversationId]: initialModelId,
        }));
      }

      if (firstMessage?.text.trim()) {
        const prep = await api.sendConversationMessage({
          conversationId: created.conversation.id,
          text: firstMessage.text,
          modelId: firstMessage.modelId as Parameters<
            typeof api.sendConversationMessage
          >[0]['modelId'],
        });
        const skillVersionIds = resolveAppendSkillVersionIds(track, firstMessage.skillVersionIds);
        await api.appendMessage({
          threadId: prep.threadId,
          expectedTaskVersion: prep.taskVersion,
          role: 'user',
          text: firstMessage.text,
          modelId: firstMessage.modelId as Parameters<typeof api.appendMessage>[0]['modelId'],
          reasoningEffort:
            firstMessage.reasoningEffort === 'auto' ? undefined : firstMessage.reasoningEffort,
          networkEnabled: firstMessage.networkEnabled || undefined,
          skillVersionIds,
        });
        initialConversationSkillSelectionsRef.current.set(
          String(created.conversation.id),
          skillVersionIds,
        );
      }

      const createdConversationId = String(created.conversation.id);
      const materializedDraft = draftSessionRef.current;
      if (materializedDraft?.workspaceId === workspaceId) {
        commitPaneLayout(workspaceId, (current) =>
          replaceConversationInPane(current, materializedDraft.id, createdConversationId),
        );
        setDraftSession(null);
        setNav((current) => openConversation(current, createdConversationId));
      }

      await refresh();
      focusConversation(createdConversationId, workspaceId);
      if (activeWorkspaceIdRef.current === workspaceId) {
        if (firstMessage?.text.trim()) {
          setNewConversationDraft('');
          writeNewConversationDraft('');
        }
        setNewConversationError(undefined);
      }
      return created.conversation;
    },
    [
      activeWorkspaceId,
      commitPaneLayout,
      focusConversation,
      refresh,
      rememberTrack,
      setDraftSession,
    ],
  );

  const handlePickTarget = useCallback(
    async (track: ConversationTrack, targetRef: string) => {
      const pending = pendingFirstMessageRef.current;
      // Picking a target prepares the local draft; Runtime persistence still
      // waits until the user submits the first turn.
      if (!pending) {
        const draft = beginDraftConversation(track, targetRef);
        if (!draft) return;
        setDraftSession({ ...draft, track, targetRef });
        rememberTrack(track);
        setPickerTrack(null);
        if (track === 'model') {
          setNewConversationModel(targetRef);
          writeNewConversationModel(targetRef);
        }
        return;
      }
      setNewConversationSending(true);
      try {
        await createConversationWithTarget(track, targetRef, pending);
        pendingFirstMessageRef.current = null;
      } catch (error) {
        setNewConversationError(error instanceof Error ? error.message : '新建对话失败');
      } finally {
        setNewConversationSending(false);
      }
    },
    [beginDraftConversation, createConversationWithTarget, rememberTrack, setDraftSession],
  );

  const handleNewConversation = useCallback(
    (
      track?: ConversationTrack,
      sourceConversation?: Conversation | null,
      targetPaneId?: string,
    ) => {
      const current =
        sourceConversation === undefined
          ? data.conversations.find((c) => c.id === nav.selectedConversationId)
          : (sourceConversation ?? undefined);
      const t = track ?? current?.track ?? nav.lastTrack;
      rememberTrack(t);
      setPickerTrack(null);
      setRailOpen(false);
      const carriedTarget =
        current && !track
          ? current.targetRef
          : t === 'model'
            ? newConversationModel || data.models[0]?.modelId
            : undefined;
      const draft = beginDraftConversation(t, carriedTarget, targetPaneId);
      if (!draft) return;
      if (current && !track) {
        if (current.track === 'model' && current.targetRef) {
          setNewConversationModel(current.targetRef);
          writeNewConversationModel(current.targetRef);
        }
        return;
      }
      // Explicit track from a header still needs a target for agent/team.
      if (t !== 'model' && !draft.targetRef) setPickerTrack(t);
    },
    [
      beginDraftConversation,
      data.conversations,
      data.models,
      nav.lastTrack,
      nav.selectedConversationId,
      newConversationModel,
      rememberTrack,
    ],
  );

  const handleOpenFolder = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const picked = await api.pickFolder();
    if (picked.canceled || !picked.path) return;
    const name =
      picked.path
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? picked.path;
    const created = await api.createWorkspace({ name, folderPath: picked.path });
    await refresh();
    selectWorkspace(created.workspaceId);
  }, [refresh, selectWorkspace]);

  const handleCreateWorkspace = useCallback(
    async (input: {
      name: string;
      folderPath: string;
      icon?: string;
    }): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        return false;
      }
      try {
        const created = await api.createWorkspace({
          name: input.name,
          folderPath: input.folderPath,
        });
        // Icon is stored via workspace.update (create payload has no icon field).
        if (input.icon?.trim() && api.updateWorkspace) {
          await api.updateWorkspace({
            workspaceId: created.workspaceId,
            icon: input.icon.trim(),
          });
        }
        await refresh();
        selectWorkspace(created.workspaceId);
        return true;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [refresh, selectWorkspace],
  );

  const handleUpdateWorkspace = useCallback(
    async (input: {
      workspaceId: string;
      name?: string;
      folderPath?: string;
      icon?: string | null;
    }): Promise<boolean> => {
      const api = bridge();
      if (!api?.updateWorkspace) return false;
      try {
        await api.updateWorkspace({
          workspaceId: input.workspaceId as WorkspaceId,
          name: input.name,
          folderPath: input.folderPath,
          icon: input.icon,
        });
        await refresh();
        return true;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [refresh],
  );

  /** Hide/unhide a workspace in the folder tab row (data untouched). */
  const handleSetWorkspaceHidden = useCallback(
    async (workspaceId: string, hidden: boolean): Promise<boolean> => {
      const api = bridge();
      if (!api?.updateWorkspace) return false;
      try {
        await api.updateWorkspace({
          workspaceId: workspaceId as WorkspaceId,
          hidden,
        });
        await refresh();
        return true;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [refresh],
  );

  /** Persist a custom folder-tab order after drag reordering. */
  const handleReorderWorkspaces = useCallback(
    async (orderedIds: string[]): Promise<boolean> => {
      const api = bridge();
      if (!api?.updateWorkspace) return false;
      const indexById = new Map(orderedIds.map((id, index) => [id, index]));
      const writes: Promise<unknown>[] = [];
      for (const workspace of data.workspaces) {
        const desired = indexById.get(workspace.workspaceId);
        if (desired === undefined || workspace.sortOrder === desired) continue;
        writes.push(
          api.updateWorkspace({
            workspaceId: workspace.workspaceId as WorkspaceId,
            sortOrder: desired,
          }),
        );
      }
      if (writes.length === 0) return true;
      await Promise.all(writes);
      await refresh();
      return true;
    },
    [data.workspaces, refresh],
  );

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const api = bridge();
      if (!api?.deleteWorkspace) return false;
      const target = data.workspaces.find((w) => w.workspaceId === workspaceId);
      const label = target?.name ?? workspaceId;
      if (
        !(await dialog.confirm({
          title: '删除工作区',
          message: `确定删除工作区「${label}」吗？对话不会随工作区自动删除，但该工作区将从列表中移除。`,
          confirmText: '删除',
          danger: true,
        }))
      ) {
        return false;
      }
      try {
        await api.deleteWorkspace({
          workspaceId: workspaceId as WorkspaceId,
        });
        const terminalIds = Object.values(paneLayouts[workspaceId]?.panes ?? {})
          .flatMap((pane) => pane.tabs)
          .filter((tab) => tab.type === 'terminal')
          .map((tab) => tab.terminalId);
        await Promise.all(terminalIds.map((terminalId) => disposeTerminalSession(terminalId)));
        setPaneLayouts((current) => {
          const next = { ...current };
          delete next[workspaceId];
          persistPaneLayouts(next);
          return next;
        });
        if (activeWorkspaceIdRef.current === workspaceId) {
          const remaining = data.workspaces.filter((w) => w.workspaceId !== workspaceId);
          if (remaining[0]) selectWorkspace(remaining[0].workspaceId);
          else {
            activeWorkspaceIdRef.current = undefined;
            setActiveWorkspaceId(undefined);
            writeActiveWorkspaceId(undefined);
            setNav((n) => ({ ...n, selectedConversationId: undefined }));
          }
        }
        await refresh();
        return true;
      } catch (err) {
        await dialog.alert({
          title: '删除失败',
          message: err instanceof Error ? err.message : String(err),
          dismissText: '知道了',
        });
        return false;
      }
    },
    [data.workspaces, dialog, paneLayouts, refresh, selectWorkspace],
  );

  const handlePickFolder = useCallback(async () => {
    const api = bridge();
    if (!api) return { canceled: true as const };
    const picked = await api.pickFolder();
    return { canceled: picked.canceled, path: picked.path ?? undefined };
  }, []);

  const handleTogglePin = useCallback(
    async (id: string, pinned: boolean) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationPinned({
        conversationId: id as Parameters<typeof api.setConversationPinned>[0]['conversationId'],
        pinned,
      });
      await refresh();
    },
    [refresh],
  );

  const handleRename = useCallback(
    async (id: string, currentTitle: string) => {
      const api = bridge();
      if (!api) return;
      const title = await dialog.prompt({
        title: '重命名对话',
        message: '为这条对话设置一个新标题',
        defaultValue: currentTitle,
        placeholder: '对话标题',
        confirmText: '保存',
      });
      if (title === null) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === currentTitle) return;
      await api.renameConversation({
        conversationId: id as Parameters<typeof api.renameConversation>[0]['conversationId'],
        title: trimmed,
      });
      await refresh();
    },
    [dialog, refresh],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: true,
      });
      setNav((n) =>
        n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
      );
      await refresh();
    },
    [refresh],
  );

  const handleUnarchive = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: false,
      });
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      if (
        !(await dialog.confirm({
          title: '删除对话',
          message: '删除后无法恢复，确定删除这条对话吗？',
          confirmText: '删除',
          danger: true,
        }))
      )
        return;
      await api.deleteConversation({
        conversationId: id as Parameters<typeof api.deleteConversation>[0]['conversationId'],
      });
      if (activeWorkspaceId) {
        commitPaneLayout(activeWorkspaceId, (current) =>
          closeConversationInLayout(current, id),
        );
      } else {
        setNav((n) =>
          n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
        );
      }
      // Drop from local groups.
      persistGroups({
        model: groups.model.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        agent: groups.agent.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        team: groups.team.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
      });
      await refresh();
    },
    [activeWorkspaceId, commitPaneLayout, dialog, groups, persistGroups, refresh],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      const source = data.conversations.find((c) => c.id === id);
      if (!source) return;
      const workspaceId = (source.workspaceId ?? activeWorkspaceId) as
        | WorkspaceId
        | undefined;
      // Copy conversation config (track, target, workspace, execution permission,
      // bound model) and the title in a single create. Message history is NOT
      // copied: there is no Runtime command to list a conversation's messages,
      // so duplicating messages would require a new protocol command.
      const created = await api.createConversation({
        track: source.track,
        targetRef: source.targetRef,
        workspaceId,
        title: source.title ? `${source.title}（副本）` : undefined,
        executionMode: source.executionMode,
      });
      // Preserve group membership (front-end only; no Runtime call needed).
      const track = source.track;
      const sourceGroup = groups[track].find((g) => g.conversationIds.includes(id));
      if (sourceGroup && workspaceId) {
        persistGroups(
          moveConversationToGroup(groups, track, created.conversation.id, sourceGroup.id),
        );
      }
      await refresh();
      focusConversation(created.conversation.id, workspaceId);
    },
    [activeWorkspaceId, data.conversations, focusConversation, groups, persistGroups, refresh],
  );

  const handleCopyLink = useCallback(
    async (id: string) => {
      const link = `syncthink://conversation/${id}`;
      try {
        await navigator.clipboard.writeText(link);
        return;
      } catch {
        // clipboard unavailable; fall through to an in-app alert so the user can copy manually.
      }
      await dialog.alert({
        title: '复制链接',
        message: (
          <code className="block break-all rounded-(--radius-row) bg-surface-200 px-2 py-1 text-[12px] text-text">
            {link}
          </code>
        ),
        dismissText: '关闭',
      });
    },
    [dialog],
  );

  const removeConversationIdsFromGroups = useCallback(
    (source: ConversationGroupsByTrack, ids: ReadonlySet<string>): ConversationGroupsByTrack => ({
      model: source.model.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
      agent: source.agent.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
      team: source.team.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
    }),
    [],
  );

  const handleBulkArchive = useCallback(async () => {
    const api = bridge();
    if (!api || selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: true,
      });
    }
    setSelectedIds(new Set());
    setMultiSelect(false);
    await refresh();
  }, [refresh, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    const api = bridge();
    if (!api || selectedIds.size === 0) return;
    if (
      !(await dialog.confirm({
        title: '批量删除对话',
        message: `确定删除选中的 ${selectedIds.size} 条对话？删除后无法恢复。`,
        confirmText: '删除',
        danger: true,
      }))
    )
      return;
    for (const id of selectedIds) {
      await api.deleteConversation({
        conversationId: id as Parameters<typeof api.deleteConversation>[0]['conversationId'],
      });
    }
    if (activeWorkspaceId) {
      commitPaneLayout(activeWorkspaceId, (current) => {
        let next = current;
        for (const id of selectedIds) next = closeConversationInLayout(next, id);
        return next;
      });
    }
    persistGroups(removeConversationIdsFromGroups(groups, selectedIds));
    setSelectedIds(new Set());
    setMultiSelect(false);
    await refresh();
  }, [
    activeWorkspaceId,
    commitPaneLayout,
    dialog,
    groups,
    persistGroups,
    refresh,
    removeConversationIdsFromGroups,
    selectedIds,
  ]);

  const handleBulkMoveToGroup = useCallback(
    (track: ConversationTrack, groupId: string | null) => {
      const idsInTrack = data.conversations
        .filter(
          (conversation) =>
            conversation.workspaceId === activeWorkspaceId &&
            conversation.track === track &&
            selectedIds.has(conversation.id),
        )
        .map((conversation) => conversation.id);
      if (idsInTrack.length === 0) return;
      let next = groups;
      for (const id of idsInTrack) {
        next = moveConversationToGroup(next, track, id, groupId);
      }
      persistGroups(next);
      setSelectedIds((current) => {
        const remaining = new Set(current);
        idsInTrack.forEach((id) => remaining.delete(id));
        if (remaining.size === 0) setMultiSelect(false);
        return remaining;
      });
    },
    [activeWorkspaceId, data.conversations, groups, persistGroups, selectedIds],
  );

  const visibleConversations = useMemo(() => {
    const conversations = filterByWorkspace(data.conversations, activeWorkspaceId);
    if (!draftSession || draftSession.workspaceId !== activeWorkspaceId) return conversations;
    const draftConversation: Conversation = {
      id: draftSession.id as Conversation['id'],
      workspaceId: draftSession.workspaceId as WorkspaceId,
      track: draftSession.track,
      targetRef: draftSession.targetRef ?? '',
      title: '新对话',
      executionMode: readDefaultPermission(),
      createdAt: draftSession.createdAt,
      updatedAt: draftSession.createdAt,
    };
    return [draftConversation, ...conversations];
  }, [activeWorkspaceId, data.conversations, draftSession]);

  // Tracks with no active conversations collapse by default: the sidebar only
  // auto-expands branches that actually have content. Branches WITH content are
  // left alone so a user's manual collapse is never overridden.
  useEffect(() => {
    if (bootState !== 'ready') return;
    const activeTracks = new Set<ConversationTrack>();
    for (const conversation of visibleConversations) {
      if (conversation.archivedAt) continue;
      activeTracks.add(conversation.track);
    }
    setNav((current) => {
      let changed = false;
      const next = { ...current.expandedTracks };
      for (const track of Object.keys(next) as ConversationTrack[]) {
        if (!activeTracks.has(track) && next[track]) {
          next[track] = false;
          changed = true;
        }
      }
      return changed ? { ...current, expandedTracks: next } : current;
    });
  }, [bootState, visibleConversations]);

  const activePaneLayout = useMemo(
    () =>
      activeWorkspaceId
        ? (paneLayouts[activeWorkspaceId] ?? createWorkspacePaneLayout(activeWorkspaceId))
        : undefined,
    [activeWorkspaceId, paneLayouts],
  );
  const activeProjectFolder = useMemo(
    () =>
      data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim(),
    [activeWorkspaceId, data.workspaces],
  );
  const openIdsForWorkspace = activePaneLayout ? paneConversationIds(activePaneLayout) : [];
  const hasOpenPaneTabs = Boolean(
    activePaneLayout && Object.values(activePaneLayout.panes).some((pane) => pane.tabs.length > 0),
  );
  const mountedConversationPaneIds = useMemo(() => {
    if (!activePaneLayout) return new Set<string>();
    const candidates = Object.values(activePaneLayout.panes)
      .filter(
        (pane) =>
          pane.tabs.find((tab) => tab.id === pane.activeTabId)?.type === 'conversation',
      )
      .map((pane) => pane.id);
    const ordered = activePaneLayout.focusedPaneId
      ? [
          activePaneLayout.focusedPaneId,
          ...candidates.filter((paneId) => paneId !== activePaneLayout.focusedPaneId),
        ]
      : candidates;
    return new Set(
      ordered.filter((paneId) => candidates.includes(paneId)).slice(0, MAX_MOUNTED_CHAT_VIEWS),
    );
  }, [activePaneLayout]);

  useEffect(() => {
    if (nav.stage !== 'talk') return;
    const selectedConversationId = activePaneLayout
      ? focusedConversationId(activePaneLayout)
      : undefined;
    setNav((current) => {
      if (current.stage !== 'talk' || current.selectedConversationId === selectedConversationId) {
        return current;
      }
      return { ...current, selectedConversationId };
    });
  }, [activePaneLayout, nav.stage]);

  const resolveTargetName = useCallback(
    (conversation: Conversation) =>
      targetName(conversation, data.agents, data.teams, data.modelNames, modelOverrides),
    [data.agents, data.modelNames, data.teams, modelOverrides],
  );

  const handleConversationUpdated = useCallback(() => {
    // Re-read local model overrides so sidebar identity updates immediately
    // after a compose model switch (without waiting for a full runtime refresh).
    setModelOverrides(readConversationModelOverrides());
    void refresh();
  }, [refresh]);

  /** 各对话运行/完成状态（由全局事件流按 taskId 投影）。 */
  const conversationActivity = useMemo(
    () => buildConversationActivity(eventHistory, data.conversations, runActivityAuthority),
    [eventHistory, data.conversations, runActivityAuthority],
  );
  /** 对话级 running/unread map（对话 tab 与侧栏用）。 */
  const conversationActivityView = useMemo(() => {
    const map = new Map<string, { running: boolean; unread: boolean }>();
    for (const conversation of data.conversations) {
      const id = String(conversation.id);
      const activity = conversationActivity.get(id);
      if (!activity) continue;
      map.set(id, {
        running: activity.running,
        unread: isConversationUnread(activity, conversationLastSeen, id),
      });
    }
    return map;
  }, [data.conversations, conversationActivity, conversationLastSeen]);
  /** 工作区级聚合（顶部工作区 tab 用）。 */
  const workspaceActivity = useMemo(
    () => buildWorkspaceActivity(data.conversations, conversationActivity, conversationLastSeen),
    [data.conversations, conversationActivity, conversationLastSeen],
  );
  // Only mounted talk-stage Runtime conversations count as viewed. Draft tabs
  // are ignored, while other visible panes can still clear their unread state.
  useEffect(() => {
    if (nav.stage !== 'talk' || settingsOpen) return;
    const watched = activePaneLayout
      ? Object.values(activePaneLayout.panes)
          .filter((pane) => mountedConversationPaneIds.has(pane.id))
          .map((pane) => pane.tabs.find((tab) => tab.id === pane.activeTabId))
          .filter((tab) => tab?.type === 'conversation')
          .map((tab) => tab.conversationId)
          .filter((id) => id !== draftSession?.id)
      : [];
    if (watched.length === 0) return;
    setConversationLastSeen((current) => {
      let next = current;
      for (const id of watched) {
        const activity = conversationActivity.get(id);
        if (activity?.lastFinishedSequence == null) continue;
        next = markConversationSeen(next, id, activity.lastFinishedSequence);
      }
      if (next !== current) writeConversationLastSeen(next);
      return next;
    });
  }, [
    activePaneLayout,
    conversationActivity,
    draftSession,
    mountedConversationPaneIds,
    nav.stage,
    settingsOpen,
  ]);

  const handleSelectStage = useCallback((stage: ShellStage) => {
    if (stage === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setNav((n) => selectStage(n, stage));
  }, []);

  const handleDraftModelChange = useCallback(
    (modelId: string) => {
      setNewConversationModel(modelId);
      writeNewConversationModel(modelId);
      setDraftSession((current) =>
        current && current.track === 'model'
          ? { ...current, targetRef: modelId || current.targetRef }
          : current,
      );
    },
    [setDraftSession],
  );

  const handleDraftSend = useCallback(
    async (options: {
      modelId: string;
      permissionMode: PermissionMode;
      reasoningEffort: ReasoningEffort;
      networkEnabled: boolean;
      skillVersionIds: string[];
    }) => {
      const text = newConversationDraft.trim();
      if (!text || newConversationSending) return false;
      if (!activeWorkspaceId) {
        setNewConversationError('请先创建或打开一个工作区');
        return false;
      }
      const track = draftSession?.track ?? nav.lastTrack;
      const session =
        draftSession ??
        beginDraftConversation(
          track,
          track === 'model'
            ? options.modelId || newConversationModel || data.models[0]?.modelId
            : undefined,
        );
      if (!session) return false;
      const requested = {
        text,
        modelId: options.modelId || undefined,
        permissionMode: options.permissionMode,
        reasoningEffort: options.reasoningEffort,
        networkEnabled: options.networkEnabled,
        skillVersionIds: resolveAppendSkillVersionIds(track, options.skillVersionIds),
      };

      if (track !== 'model' && !session.targetRef) {
        pendingFirstMessageRef.current = requested;
        setPickerTrack(track);
        return false;
      }
      if (track !== 'model' && session.targetRef) {
        setNewConversationSending(true);
        try {
          await createConversationWithTarget(track, session.targetRef, requested);
          return true;
        } catch (error) {
          setNewConversationError(
            error instanceof Error ? error.message : '发送第一条消息失败',
          );
          return false;
        } finally {
          setNewConversationSending(false);
        }
      }

      const modelId =
        options.modelId ||
        session.targetRef ||
        newConversationModel ||
        data.models[0]?.modelId;
      if (!modelId) {
        setNewConversationError('还没有可用模型，请先在设置中添加模型');
        return false;
      }
      setNewConversationSending(true);
      try {
        await createConversationWithTarget('model', modelId, {
          ...requested,
          modelId,
        });
        return true;
      } catch (error) {
        setNewConversationError(
          error instanceof Error ? error.message : '发送第一条消息失败',
        );
        return false;
      } finally {
        setNewConversationSending(false);
      }
    },
    [
      activeWorkspaceId,
      beginDraftConversation,
      createConversationWithTarget,
      data.models,
      draftSession,
      nav.lastTrack,
      newConversationDraft,
      newConversationModel,
      newConversationSending,
    ],
  );

  const handleDraftTrackPick = useCallback(
    (track: ConversationTrack) => {
      rememberTrack(track);
      if (track === 'model') {
        const draft = beginDraftConversation(
          'model',
          newConversationModel || data.models[0]?.modelId,
        );
        if (draft) {
          setDraftSession({
            ...draft,
            track: 'model',
            targetRef: newConversationModel || data.models[0]?.modelId,
          });
        }
        setPickerTrack(null);
        return;
      }
      const draft = beginDraftConversation(track);
      if (draft) setDraftSession({ ...draft, track, targetRef: undefined });
      setPickerTrack(track);
    },
    [
      beginDraftConversation,
      data.models,
      newConversationModel,
      rememberTrack,
      setDraftSession,
    ],
  );

  const emptyTalk = (
    <EmptyTalk
      hasWorkspace={Boolean(activeWorkspaceId)}
      workspaceId={activeWorkspaceId}
      models={data.models}
      agents={data.agents}
      teams={data.teams}
      draft={newConversationDraft}
      selectedModelId={newConversationModel}
      draftTrack={draftSession?.track ?? nav.lastTrack}
      draftTargetRef={draftSession?.targetRef}
      sending={newConversationSending}
      error={newConversationError}
      onDraftChange={(draft) => {
        setNewConversationDraft(draft);
        writeNewConversationDraft(draft);
        setNewConversationError(undefined);
      }}
      onModelChange={handleDraftModelChange}
      onSend={handleDraftSend}
      onOpenWorkspaceMenu={() => {
        /* user uses topbar */
      }}
      onPickTrack={handleDraftTrackPick}
    />
  );

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="shell-boards flex min-h-0 flex-1 bg-page">
        {/* Keep sidebar mounted so width can animate on collapse/expand. */}
        <Sidebar
          nav={nav}
          width={sidebarWidth || SIDEBAR_WIDTH_DEFAULT}
          collapsed={nav.sidebarCollapsed}
          settingsOpen={settingsOpen}
          conversations={visibleConversations}
          agents={data.agents}
          teams={data.teams}
          modelNames={data.modelNames}
          modelOverrides={modelOverrides}
          groups={groups}
          bootState={bootState}
          bootError={bootError}
          multiSelect={multiSelect}
          selectedIds={selectedIds}
          conversationActivity={conversationActivityView}
          onSelectStage={handleSelectStage}
          onToggleTrack={(track) => setNav((n) => toggleTrack(n, track))}
          onToggleSidebar={() => setNav((n) => setSidebarCollapsed(n, true))}
          onOpenConversation={(id) => focusConversation(id)}
          onNewConversation={handleNewConversation}
          onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
          onRename={(id, currentTitle) => void handleRename(id, currentTitle)}
          onArchive={(id) => void handleArchive(id)}
          onUnarchive={(id) => void handleUnarchive(id)}
          onDelete={(id) => void handleDelete(id)}
          onDuplicate={(id) => void handleDuplicate(id)}
          onCopyLink={(id) => void handleCopyLink(id)}
          onCreateGroup={(track, name) => {
            persistGroups(createConversationGroup(groups, track, name));
          }}
          onRenameGroup={(track, groupId, name) => {
            persistGroups(renameConversationGroup(groups, track, groupId, name));
          }}
          onDeleteGroup={(track, groupId) => {
            persistGroups(deleteConversationGroup(groups, track, groupId));
          }}
          onToggleGroupCollapsed={(track, groupId) => {
            persistGroups(toggleConversationGroupCollapsed(groups, track, groupId));
          }}
          onMoveToGroup={(track, conversationId, groupId) => {
            persistGroups(moveConversationToGroup(groups, track, conversationId, groupId));
          }}
          onToggleMultiSelect={() => {
            setMultiSelect((v) => !v);
            setSelectedIds(new Set());
          }}
          onToggleSelected={(id) => {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onBulkArchive={() => void handleBulkArchive()}
          onBulkDelete={() => void handleBulkDelete()}
          onBulkMoveToGroup={handleBulkMoveToGroup}
          onResizeStart={(clientX) => {
            if (nav.sidebarCollapsed) return;
            resizeRef.current = { startX: clientX, startWidth: sidebarWidth };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {pickerTrack && (
          <NewConversationDialog
            track={pickerTrack}
            models={data.models}
            agents={data.agents}
            teams={data.teams}
            draft={newConversationDraft}
            onPick={(targetRef) => void handlePickTarget(pickerTrack, targetRef)}
            onGoToLibrary={(stage) => {
              pendingFirstMessageRef.current = null;
              setPickerTrack(null);
              setNav((n) => selectStage(n, stage === 'agents' || stage === 'teams' ? stage : n.stage));
            }}
            onClose={() => {
              pendingFirstMessageRef.current = null;
              setPickerTrack(null);
            }}
          />
        )}

        <main
          className="shell-board flex min-w-0 flex-1 flex-col overflow-hidden bg-panel"
          data-testid="shell-stage"
        >
          {/* Workspace tabs live inside the stage board (NewMax mid-stage),
              not as a full-window chrome bar above the pure sidebar. */}
          <TopBar
            workspaces={data.workspaces}
            activeWorkspaceId={activeWorkspaceId}
            sidebarCollapsed={nav.sidebarCollapsed}
            onSelectWorkspace={selectWorkspace}
            onOpenFolder={() => void handleOpenFolder()}
            onCreateWorkspace={handleCreateWorkspace}
            onUpdateWorkspace={handleUpdateWorkspace}
            onReorderWorkspaces={handleReorderWorkspaces}
            onSetWorkspaceHidden={handleSetWorkspaceHidden}
            onDeleteWorkspace={handleDeleteWorkspace}
            onToggleSidebar={() => setNav((n) => toggleSidebar(n))}
            onPickFolder={handlePickFolder}
            onOpenTerminal={() => handleOpenTerminalInPane(activePaneLayout?.focusedPaneId)}
            canOpenTerminal={Boolean(activeProjectFolder)}
            workspaceActivity={workspaceActivity}
          />
          {nav.stage === 'talk' ? (
            <>
              {activePaneLayout && hasOpenPaneTabs ? (
                <WorkspacePaneHost
                  layout={activePaneLayout}
                  onFocusPane={handleFocusPane}
                  onSplitRatioChange={handleSplitRatioChange}
                  renderPane={(pane, focused) => {
                    const localConversationIds = pane.tabs
                      .filter((tab) => tab.type === 'conversation')
                      .map((tab) => tab.conversationId);
                    const localFileTabs = pane.tabs
                      .filter((tab) => tab.type === 'file')
                      .map((tab) => ({
                        ...tab,
                        dirty: activeWorkspaceId
                          ? dirtyFileTabs.has(fileTabDirtyKey(activeWorkspaceId, tab.path))
                          : false,
                      }));
                    const localTerminalTabs = pane.tabs.filter((tab) => tab.type === 'terminal');
                    const localBrowserTabs = pane.tabs.filter((tab) => tab.type === 'browser');
                    const hasLocalWorkspaceFilesTab = pane.tabs.some(
                      (tab) => tab.type === 'workspace-files',
                    );
                    const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
                    const activeFilePath = activeTab?.type === 'file' ? activeTab.path : undefined;
                    const activeTerminalId =
                      activeTab?.type === 'terminal' ? activeTab.terminalId : undefined;
                    const activeBrowserId =
                      activeTab?.type === 'browser' ? activeTab.browserId : undefined;
                    const workspaceFilesPaneId = findWorkspaceFilesPane(activePaneLayout);
                    const isDraftConversation =
                      activeTab?.type === 'conversation' &&
                      activeTab.conversationId === draftSession?.id;
                    const conversation =
                      activeTab?.type === 'conversation'
                        ? visibleConversations.find((item) => item.id === activeTab.conversationId)
                        : undefined;
                    const conversationsForPane = visibleConversations.filter(
                      (item) =>
                        localConversationIds.includes(String(item.id)) ||
                        !openIdsForWorkspace.includes(String(item.id)),
                    );
                    const activeConversationPaneCount = Object.values(activePaneLayout.panes).filter(
                      (item) =>
                        item.tabs.find((tab) => tab.id === item.activeTabId)?.type === 'conversation',
                    ).length;
                    const canUseRail = Object.keys(activePaneLayout.panes).length === 1 && focused;
                    const shouldMountConversation = mountedConversationPaneIds.has(pane.id);
                    const canToggleWorkspaceFiles =
                      focused || hasLocalWorkspaceFilesTab;
                    const draggingFromThisPane = Boolean(
                      tabDragResource &&
                      pane.tabs.some((tab) => paneTabMatchesResource(tab, tabDragResource)),
                    );
                    return (
                      <div
                        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
                        onDragOver={(event) => {
                          if (!tabDragResource || draggingFromThisPane) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setPaneDropTargetId(pane.id);
                        }}
                        onDragLeave={() => {
                          setPaneDropTargetId((current) => (current === pane.id ? null : current));
                        }}
                        onDrop={(event) => {
                          if (!tabDragResource || draggingFromThisPane) return;
                          event.preventDefault();
                          const resource =
                            parsePaneResourceDrag(
                              event.dataTransfer.getData('application/x-sync-think-pane-resource'),
                            ) ??
                            parsePaneResourceDrag(event.dataTransfer.getData('text/plain')) ??
                            tabDragResource;
                          setPaneDropTargetId(null);
                          setTabDragResource(null);
                          handleMovePaneResourceToPane(resource, pane.id);
                        }}
                      >
                        <ConversationTabs
                          paneId={pane.id}
                          conversations={conversationsForPane}
                          openIds={localConversationIds}
                          activeId={conversation?.id}
                          fileTabs={localFileTabs}
                          activeFilePath={activeFilePath}
                          terminalTabs={localTerminalTabs}
                          activeTerminalId={activeTerminalId}
                          browserTabs={localBrowserTabs}
                          activeBrowserId={activeBrowserId}
                          workspaceFilesActive={activeTab?.type === 'workspace-files'}
                          workspaceFilesTab={hasLocalWorkspaceFilesTab}
                          workspaceFilesPaneOpen={Boolean(workspaceFilesPaneId)}
                          canSplit={activeConversationPaneCount < MAX_MOUNTED_CHAT_VIEWS}
                          onSelect={(id) => handleActivatePaneTab(pane.id, id)}
                          onClose={(id) => handleCloseConversationTab(pane.id, id)}
                          onSelectFile={(path) => handleActivateFileTab(pane.id, path)}
                          onCloseFile={(path) => void handleCloseFileTab(pane.id, path)}
                          onSelectTerminal={(terminalId) =>
                            handleActivateTerminalTab(pane.id, terminalId)
                          }
                          onCloseTerminal={(terminalId) =>
                            void handleCloseTerminalTab(pane.id, terminalId)
                          }
                          onNewTerminal={() => handleOpenTerminalInPane(pane.id)}
                          onSelectBrowser={(browserId) =>
                            handleActivateBrowserTab(pane.id, browserId)
                          }
                          onCloseBrowser={(browserId) =>
                            handleCloseBrowserTab(pane.id, browserId)
                          }
                          onNewBrowser={() => handleOpenBrowserInPane(pane.id)}
                          onSelectWorkspaceFiles={() =>
                            handleActivateWorkspaceFilesTab(pane.id)
                          }
                          onCloseWorkspaceFiles={() => handleCloseWorkspaceFilesTab(pane.id)}
                          onToggleWorkspaceFilesPane={
                            canToggleWorkspaceFiles
                              ? () => handleToggleWorkspaceFilesPane(pane.id)
                              : undefined
                          }
                          canOpenTerminal={Boolean(activeProjectFolder)}
                          onNew={() => {
                            handleFocusPane(pane.id);
                            handleNewConversation(undefined, conversation ?? null, pane.id);
                          }}
                          onReorder={(fromId, toId) =>
                            handleReorderConversationTab(pane.id, fromId, toId)
                          }
                          onRename={(id, currentTitle) => void handleRename(id, currentTitle)}
                          onOpenInSplit={(id, direction) =>
                            handleSplitConversation(pane.id, id, direction)
                          }
                          onClosePane={
                            Object.keys(activePaneLayout.panes).length > 1
                              ? () => void handleClosePane(pane.id)
                              : undefined
                          }
                          onTabDragStateChange={(id) => {
                            setTabDragResource(id);
                            if (!id) setPaneDropTargetId(null);
                          }}
                          conversationActivity={conversationActivityView}
                        />
                        {isDraftConversation ? (
                          emptyTalk
                        ) : conversation && shouldMountConversation ? (
                          <ChatView
                            key={conversation.id}
                            conversation={conversation}
                            modelName={resolveTargetName(conversation)}
                            models={data.models}
                            agents={data.agents}
                            teams={data.teams}
                            workspaces={data.workspaces}
                            eventHistory={eventHistory}
                            runActivityAuthority={runActivityAuthority}
                            runtimeConnectionRevision={runtimeConnectionRevision}
                            runtimeConnectionNotice={runtimeConnectionNotice}
                            initialSkillVersionIds={initialConversationSkillSelectionsRef.current.get(
                              String(conversation.id),
                            )}
                            onInitialSkillSelectionConsumed={(conversationId) => {
                              initialConversationSkillSelectionsRef.current.delete(conversationId);
                            }}
                            onTitleUpdated={() => void refresh()}
                            onConversationUpdated={handleConversationUpdated}
                            railOpen={canUseRail ? railOpen : false}
                            onRailOpenChange={canUseRail ? handleRailOpenChange : undefined}
                            onOpenFile={(path, location) =>
                              handleOpenFileInPane(pane.id, path, location)
                            }
                          />
                        ) : activeTab?.type === 'browser' ? (
                          <BrowserPanel
                            key={activeTab.browserId}
                            initialUrl={activeTab.url}
                            onClose={() => handleCloseBrowserTab(pane.id, activeTab.browserId)}
                            partition={`pane-browser-${activeTab.browserId}`}
                            registerForAutomation={false}
                          />
                        ) : activeTab?.type === 'workspace-files' ? (
                          <WorkspaceFilesPanel
                            projectFolder={activeProjectFolder}
                            activeFilePath={undefined}
                            onOpenFile={(path, location) =>
                              handleOpenFileInPane(pane.id, path, location)
                            }
                          />
                        ) : activeTab?.type === 'file' ? (
                          <FilePane
                            key={`${activeWorkspaceId ?? 'workspace'}:${activeTab.path}`}
                            projectFolder={activeProjectFolder}
                            path={activeTab.path}
                            revealTarget={
                              activeWorkspaceId
                                ? fileRevealTargets.get(
                                    fileTabDirtyKey(activeWorkspaceId, activeTab.path),
                                  )
                                : undefined
                            }
                            onDirtyChange={(dirty) => {
                              if (activeWorkspaceId) {
                                handleFileDirtyChange(activeWorkspaceId, activeTab.path, dirty);
                              }
                            }}
                          />
                        ) : activeTab?.type === 'terminal' ? (
                          <TerminalPane
                            key={activeTab.terminalId}
                            terminalId={activeTab.terminalId}
                            projectFolder={activeProjectFolder}
                            cwd={activeTab.cwd}
                            onCwdChange={(cwd) =>
                              handleTerminalCwdChange(pane.id, activeTab.terminalId, cwd)
                            }
                          />
                        ) : null}
                        {paneDropTargetId === pane.id ? (
                          <div className="shell-pane-drop-overlay pointer-events-none absolute inset-0 z-30" />
                        ) : null}
                      </div>
                    );
                  }}
                />
              ) : (
                emptyTalk
              )}
            </>
          ) : nav.stage === 'agents' ? (
            <AgentLibrary
              agents={data.agents}
              models={data.models}
              teams={data.teams}
              conversations={data.conversations}
              onRefresh={() => void refresh()}
              onManageSkills={() => setNav((n) => selectStage(n, 'abilities'))}
              skillCatalogRevision={skillCatalogRevision}
              onStartConversation={(agentId) => {
                void handlePickTarget('agent', agentId);
                setNav((n) => ({ ...n, stage: 'talk' }));
              }}
              onOpenConversation={(conversationId) => {
                void openConversationById(conversationId);
              }}
            />
          ) : nav.stage === 'teams' ? (
            <TeamLibrary
              teams={data.teams}
              agents={data.agents}
              onRefresh={() => void refresh()}
              onStartConversation={(teamId) => {
                void handlePickTarget('team', teamId);
                setNav((n) => ({ ...n, stage: 'talk' }));
              }}
            />
          ) : nav.stage === 'browser' ? (
            <BrowserStage />
          ) : nav.stage === 'abilities' ? (
            <AbilitiesPage
              activeWorkspaceId={activeWorkspaceId}
              workspaces={data.workspaces}
              onCatalogChanged={() => {
                setSkillCatalogRevision((revision) => revision + 1);
                void refresh();
              }}
              onGoToAgents={() => setNav((n) => selectStage(n, 'agents'))}
            />
          ) : (
            <StagePlaceholder stage={nav.stage} />
          )}
        </main>
      </div>

      <Dialog.Root
        open={settingsOpen}
        onOpenChange={(open) => {
          if (open) setSettingsOpen(true);
        }}
      >
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onCatalogChanged={() => void refresh()}
        />
      </Dialog.Root>
    </div>
  );
}

export function EmptyTalk(props: {
  hasWorkspace: boolean;
  workspaceId?: string;
  models: readonly ModelOption[];
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  draft: string;
  selectedModelId: string;
  /** Track/target carried from "new chat" while still a welcome draft. */
  draftTrack?: ConversationTrack;
  draftTargetRef?: string;
  sending: boolean;
  error?: string;
  onDraftChange(draft: string): void;
  onModelChange(modelId: string): void;
  onSend(options: {
    modelId: string;
    permissionMode: PermissionMode;
    reasoningEffort: ReasoningEffort;
    networkEnabled: boolean;
    skillVersionIds: string[];
  }): Promise<boolean>;
  onOpenWorkspaceMenu(): void;
  onPickTrack(track: ConversationTrack): void;
}) {
  const chips: Array<{ track: ConversationTrack; icon: typeof Sparkles; label: string; desc: string }> =
    [
      { track: 'model', icon: Sparkles, label: '跟模型聊', desc: '使用下方当前模型直接开始' },
      { track: 'agent', icon: Bot, label: '智能体', desc: '先选择一个智能体' },
      { track: 'team', icon: Users, label: '小队', desc: '先选择一个小队' },
    ];
  const [networkEnabled, setNetworkEnabled] = useState(true);
  const [userName, setUserName] = useState(() => readUserName());
  // Settings writes the name to localStorage; this event keeps the greeting
  // live without needing a restart or a shared store.
  useEffect(() => {
    const sync = () => setUserName(readUserName());
    window.addEventListener('shell-user-name-changed', sync);
    return () => window.removeEventListener('shell-user-name-changed', sync);
  }, []);
  const greeting = buildGreeting(new Date().getHours(), userName);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    readDefaultPermission(),
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const reasoningButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const selectedModel =
    props.models.find((model) => model.modelId === props.selectedModelId) ?? props.models[0];
  const draftTrack = props.draftTrack ?? 'model';
  const skillOwner = useMemo(
    () =>
      resolveConversationSkillOwner(
        { track: draftTrack, targetRef: props.draftTargetRef ?? '' },
        props.agents,
        props.teams,
    ),
    [draftTrack, props.agents, props.draftTargetRef, props.teams],
  );
  const defaultSkillVersionIds = useMemo<string[]>(() => [], []);
  const [selectedSkillVersionIds, setSelectedSkillVersionIds] = useState<string[]>(() =>
    defaultSkillVersionIds,
  );
  const skillScopeKey =
    draftTrack === 'model'
      ? `model:${props.workspaceId ?? ''}:${selectedModel?.modelId ?? ''}`
      : `${draftTrack}:${props.workspaceId ?? ''}:${props.draftTargetRef ?? ''}`;
  const skillScopeKeyRef = useRef(skillScopeKey);
  const updateSelectedSkillVersionIds = useCallback((skillVersionIds: string[]) => {
    setSelectedSkillVersionIds(skillVersionIds);
  }, []);
  useEffect(() => {
    if (skillScopeKeyRef.current === skillScopeKey) return;
    skillScopeKeyRef.current = skillScopeKey;
    setSkillMenuOpen(false);
    updateSelectedSkillVersionIds(defaultSkillVersionIds);
  }, [defaultSkillVersionIds, skillScopeKey, updateSelectedSkillVersionIds]);

  const submit = async () => {
    const skillVersionIds = resolveAppendSkillVersionIds(
      draftTrack,
      selectedSkillVersionIds,
    );
    return props.onSend({
      modelId: selectedModel?.modelId ?? '',
      permissionMode,
      reasoningEffort,
      networkEnabled,
      skillVersionIds,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      <div className="shell-welcome flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
        <div className="flex flex-col items-center gap-1.5">
          <h2
            data-testid="welcome-greeting"
            className="shell-welcome-title m-0 text-[26px] font-semibold tracking-tight text-text"
          >
            {props.hasWorkspace ? greeting : '先打开一个工作区'}
          </h2>
          <p className="shell-welcome-subtitle m-0 text-[13px] text-text-faint">
            {props.hasWorkspace
              ? '今天想做什么？'
              : '在顶栏打开文件夹或新建工作区后即可对话'}
          </p>
        </div>

        <FirstLaunchGuide
          hasWorkspace={props.hasWorkspace}
          onOpenWorkspaceMenu={props.onOpenWorkspaceMenu}
          onPickTrack={props.onPickTrack}
        />

        {props.hasWorkspace ? (
          <div className="flex flex-wrap justify-center gap-2">
            {chips.map((chip, i) => {
              const Icon = chip.icon;
              return (
                <button
                  key={chip.track}
                  type="button"
                  data-testid={`welcome-track-${chip.track}`}
                  title={chip.desc}
                  className="shell-chip flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-secondary"
                  style={{ animationDelay: `${0.12 + i * 0.06}s` }}
                  onClick={() => props.onPickTrack(chip.track)}
                >
                  <Icon size={13} className="text-accent" />
                  {chip.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-text-faint">
            使用顶栏 <span className="font-medium text-text-secondary">+</span> 或工作区菜单创建
          </p>
        )}
      </div>

      {props.hasWorkspace ? (
        <div className="shell-chat-content-wrap shrink-0 pb-4 pt-2" data-testid="empty-compose-wrap">
          <div className="shell-chat-content mx-auto">
            <div className="shell-compose relative" data-testid="empty-compose">
              <textarea
                data-testid="empty-compose-input"
                className="shell-compose__input"
                placeholder="有什么我能帮你的吗？"
                value={props.draft}
                onChange={(event) => props.onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                disabled={props.sending}
              />
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={permissionButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={
                        permissionMenuOpen || permissionMode === 'full-access' ? '1' : '0'
                      }
                      title={`权限：${PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.title ?? '完全访问'}`}
                      onClick={() => setPermissionMenuOpen((value) => !value)}
                    >
                      <Zap size={15} />
                      <span className="shell-compose__tool-label">
                        {PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.title ??
                          '完全访问'}
                      </span>
                    </button>
                    <PermissionMenu
                      open={permissionMenuOpen}
                      value={permissionMode}
                      anchorEl={permissionButtonRef.current}
                      onClose={() => setPermissionMenuOpen(false)}
                      onChange={setPermissionMode}
                    />
                  </div>
                  <button
                    type="button"
                    className="shell-compose__tool"
                    data-active={networkEnabled ? '1' : '0'}
                    onClick={() => setNetworkEnabled((value) => !value)}
                    title={networkEnabled ? '联网已开（点击关闭）' : '联网已关（点击开启）'}
                  >
                    <Globe size={15} />
                  </button>
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={reasoningButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={reasoningMenuOpen ? '1' : '0'}
                      title={`推理强度：${REASONING_LABELS[reasoningEffort]}`}
                      onClick={() => setReasoningMenuOpen((value) => !value)}
                    >
                      <Brain size={15} />
                      <span className="shell-compose__tool-label">
                        {REASONING_LABELS[reasoningEffort]}
                      </span>
                    </button>
                    <ReasoningMenu
                      open={reasoningMenuOpen}
                      value={reasoningEffort}
                      anchorEl={reasoningButtonRef.current}
                      onClose={() => setReasoningMenuOpen(false)}
                      onChange={setReasoningEffort}
                    />
                  </div>
                  <TurnSkillControl
                    owner={skillOwner}
                    workspaceId={props.workspaceId}
                    open={skillMenuOpen}
                    selectedSkillVersionIds={selectedSkillVersionIds}
                    onOpenChange={setSkillMenuOpen}
                    onChange={updateSelectedSkillVersionIds}
                  />
                </div>
                <div className="shell-compose__bar-right">
                  <ContextRing
                    used={Math.round(props.draft.length / 4)}
                    limit={
                      (typeof selectedModel?.contextWindow === 'number' &&
                      selectedModel.contextWindow > 0
                        ? selectedModel.contextWindow
                        : undefined) ||
                      estimateContextWindow(
                        selectedModel?.displayName || selectedModel?.modelId,
                      )
                    }
                  />
                  <div className="shell-compose__tool-wrap">
                    <ModelTrigger
                      label={selectedModel?.displayName ?? '选择模型'}
                      open={modelMenuOpen}
                      buttonRef={modelButtonRef}
                      onClick={() => setModelMenuOpen((value) => !value)}
                    />
                    <ModelPickerMenu
                      open={modelMenuOpen}
                      models={props.models}
                      selectedModelId={selectedModel?.modelId ?? ''}
                      defaultLabel="选择模型"
                      anchorEl={modelButtonRef.current}
                      onClose={() => setModelMenuOpen(false)}
                      onPick={props.onModelChange}
                    />
                  </div>
                  <button
                    type="button"
                    className="shell-compose__send"
                    onClick={() => void submit()}
                    disabled={!props.draft.trim() || props.sending}
                    title="发送 (Enter)"
                    data-testid="empty-compose-send"
                  >
                    <SendHorizonal size={15} />
                  </button>
                </div>
              </div>
              {props.error ? (
                <div className="px-3 pb-2 text-[11.5px] text-error" role="alert">
                  {props.error}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StagePlaceholder({ stage }: { stage: ShellNavState['stage'] }) {
  return (
    <div className="flex flex-1 items-center justify-center text-text-faint">
      <div className="text-[13px]">{STAGE_LABELS[stage]} · 即将推出</div>
    </div>
  );
}

function SettingsModal({
  onClose,
  onCatalogChanged,
}: {
  onClose(): void;
  onCatalogChanged(): void;
}) {
  const [dirty, setDirty] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragSessionRef = useRef<{
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);

  // Restore the last dragged position (session-local convenience; keep in-memory if storage is unavailable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sync-think-settings-pos');
      if (raw) {
        const pos = JSON.parse(raw) as { dx?: number; dy?: number };
        if (typeof pos.dx === 'number' && typeof pos.dy === 'number') {
          setDragOffset({
            dx: Math.round(pos.dx),
            dy: Math.round(pos.dy),
          });
        }
      }
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const clampDrag = useCallback((dx: number, dy: number) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      dx: Math.round(Math.min(Math.max(dx, -w / 2 + 80), w / 2 - 80)),
      dy: Math.round(Math.min(Math.max(dy, -h / 2 + 80), h / 2 - 80)),
    };
  }, []);

  const handleDragPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      const target = event.target as Element;
      if (!(target instanceof Element)) return;
      // Only the two top header rows act as the drag handle; interactive
      // elements (buttons, inputs, the search box) keep their own behaviour.
      if (target.closest('button, input, textarea, select, a, [role="button"], .settings-search')) {
        return;
      }
      if (!target.closest('.settings-sidebar__header, .settings-content__topbar')) return;
      event.preventDefault();
      const base = dragOffset ?? { dx: 0, dy: 0 };
      dragSessionRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        baseDx: base.dx,
        baseDy: base.dy,
      };
      document.body.style.userSelect = 'none';
      const onMove = (ev: PointerEvent) => {
        const session = dragSessionRef.current;
        if (!session) return;
        setDragOffset(
          clampDrag(
            session.baseDx + ev.clientX - session.startX,
            session.baseDy + ev.clientY - session.startY,
          ),
        );
      };
      const onUp = () => {
        dragSessionRef.current = null;
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [clampDrag, dragOffset],
  );

  // Persist the final position when the modal unmounts.
  useEffect(
    () => () => {
      if (dragOffset) {
        try {
          localStorage.setItem('sync-think-settings-pos', JSON.stringify(dragOffset));
        } catch {
          /* ignore storage failures */
        }
      }
    },
    [dragOffset],
  );

  const requestClose = () => {
    if (!canCloseSettings(dirty, (message) => confirm(message))) return;
    setDirty(false);
    onClose();
  };

  const forceClose = () => {
    setDirty(false);
    onClose();
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="settings-modal-backdrop" />
      <Dialog.Content
        className="settings-modal-positioner"
        style={
          dragOffset
            ? {
                left: `${dragOffset.dx}px`,
                right: `${-dragOffset.dx}px`,
                top: `${dragOffset.dy}px`,
                bottom: `${-dragOffset.dy}px`,
              }
            : undefined
        }
        aria-describedby={undefined}
        onPointerDown={handleDragPointerDown}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onFocusOutside={(event) => {
          // 点击应用级确认框会令焦点移出设置弹窗；若不拦截，
          // Radix modal 默认行为是直接关闭设置弹窗。
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          // 应用级确认框/提示框（DialogProvider）渲染在设置弹窗之外，
          // 点击它们不应被视为“点击弹窗外部”而关闭设置。
          if (
            typeof document !== 'undefined' &&
            document.querySelector('[data-testid="app-dialog"]')?.contains(event.target as Node)
          ) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          requestClose();
        }}
      >
        <div className="settings-modal-content">
          <Dialog.Title className="sr-only">设置</Dialog.Title>
          <button
            type="button"
            className="settings-modal-close"
            aria-label="关闭设置"
            onClick={requestClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <SettingsPage
            onDone={forceClose}
            onCatalogChanged={onCatalogChanged}
            onDirtyChange={setDirty}
          />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

// Keep empty groups helper referenced for tests / future reset.
void emptyConversationGroups;
