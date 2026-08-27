// New shell root — NewMax visual constitution (S3 / D3 first cut).
// Sidebar top actions + three tracks with groups · workspace tabs (no 全部) ·
// welcome empty state · settings modal.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Bot,
  Compass,
  ImagePlus,
  MessageSquare,
  Puzzle,
  SendHorizonal,
  Sparkles,
  Users,
  Zap,
  X,
} from 'lucide-react';
import type {
  Conversation,
  ConversationTrack,
  Event,
  GlobalAgent,
  KernelDetectionResult,
  Team,
  WorkspaceId,
} from '@sync-think/shared';
import type { RunProcessView, WorkspaceSummary, SkillVersionSummary } from '@sync-think/protocol';
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
import { WallpaperReadingLayers } from './WallpaperReadingLayers.js';
import { WorkspaceWorkbench, type WorkbenchNewResource } from './WorkspaceWorkbench.js';
import { ChatView, type RuntimeConnectionNotice } from './ChatView.js';
import { clearFilePaneSession, isFilePaneSessionDirty, type FileRevealTarget } from './FilePane.js';
import { WorkspaceFileView } from './WorkspaceFileView.js';
import { TerminalPane } from './TerminalPane.js';
import { disposeTerminalSession } from './terminal-session-store.js';
import { BrowserPanel } from './BrowserPanel.js';
import { ReviewPanel, WorkspaceFilesPanel } from './RightDock.js';
import { AgentLibrary } from './AgentLibrary.js';
import { TaskPanel } from './TaskPanel.js';
import { ActivityCenterPage } from './ActivityCenterPage.js';
import { TeamLibrary } from './TeamLibrary.js';
import { AbilitiesPage } from './AbilitiesPage.js';
import { BrowserStage } from './BrowserStage.js';
import { SettingsPage } from './SettingsPage.js';
import { FirstLaunchGuide } from './FirstLaunchGuide.js';
import {
  ComposeAtSettingsMenu,
  ContextRing,
  estimateContextWindow,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  type KernelInstallState,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import {
  addAttachment,
  detectMentionQuery,
  isImageFile,
  messageImagesFromAttachments,
  readFileAsDataUrl,
  removeAttachment,
  stripMentionToken,
  type ComposeAttachment,
  type MentionQuery,
  type MessageImage,
} from './compose-mention.js';
import {
  detectSlashQuery,
  filterSlashCommands,
  parseSlashCommand,
  stripSlashToken,
  type SlashCommand,
  type SlashQuery,
} from './compose-slash.js';
import {
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
} from './compose-skill-selection.js';
import { compressImageDataUrl } from './image-compress.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { keepListboxOptionVisible } from './compose-picker-scroll.js';
import { canCloseSettings } from './settings-unsaved.js';
import { NewConversationDialog, type ModelOption } from './NewConversationDialog.js';
import { useDialog, DialogProvider } from './Dialog.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import { matchesShortcut, readShortcutPreferences } from './preferences-store.js';
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
  readNewConversationKernel,
  readNewConversationModel,
  readConversationModelOverrides,
  readOpenConversationTabs,
  readSelectedConversationByWorkspace,
  readWorkspacePaneLayouts,
  readWorkspaceWorkbenchLayouts,
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
  writeNewConversationKernel,
  writeNewConversationModel,
  writeConversationKernelOverride,
  writeConversationModelOverride,
  writeConversationNetworkEnabled,
  writeConversationReasoningEffort,
  writeOpenConversationTabs,
  writeSelectedConversationByWorkspace,
  writeWorkspacePaneLayouts,
  writeWorkspaceWorkbenchLayouts,
  writeSidebarWidth,
  type ConversationGroupsByTrack,
} from '../ui-preferences.js';
import {
  activateFilePaneTab,
  activatePaneTab,
  activateBrowserPaneTab,
  activateReviewPaneTab,
  activateWorkspaceFilesPaneTab,
  activateTerminalPaneTab,
  closeBrowserPaneTab,
  closeReviewPaneTab,
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
  navigateBrowserPaneTab,
  openBrowserInPane,
  openFileInPane,
  openConversationInPane,
  openTerminalInPane,
  paneConversationIds,
  pruneWorkspacePaneLayout,
  replaceConversationInPane,
  replaceFileInPane,
  reorderPaneTabs,
  setSplitRatio,
  splitPaneWithConversation,
  splitPaneWithResource,
  splitPaneWithWorkspaceFiles,
  updateTerminalPaneCwd,
  type PaneResourceRef,
  type PaneSplitDirection,
  type WorkspacePaneLayout,
  type WorkspacePaneLayouts,
} from './pane-layout.js';
import {
  activateWorkbenchTab,
  browserWorkbenchTab,
  closeWorkbenchTab,
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  openWorkbenchTab,
  reviewWorkbenchTab,
  setWorkbenchFileBrowserWidth,
  setWorkbenchFileBrowserOpen,
  setWorkbenchOpen,
  setWorkbenchSize,
  terminalWorkbenchTab,
  workspaceFilesWorkbenchTab,
  type WorkbenchPlacement,
  type WorkbenchTab,
  type WorkspaceWorkbenchLayout,
  type WorkspaceWorkbenchLayouts,
} from './workspace-workbench.js';

interface ShellData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  modelNames: Map<string, string>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
  skills: SkillVersionSummary[];
}

interface DraftConversationSession {
  id: string;
  workspaceId: string;
  track: ConversationTrack;
  targetRef?: string;
  createdAt: string;
}

interface DraftFirstMessage {
  text: string;
  images: MessageImage[];
  modelId?: string;
  kernelId: string;
  interactionMode: 'plan' | 'execute';
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
  networkEnabled: boolean;
  skillVersionIds: string[];
}

const EMPTY: ShellData = {
  conversations: [],
  agents: [],
  teams: [],
  modelNames: new Map(),
  models: [],
  workspaces: [],
  skills: [],
};

const MAX_MOUNTED_CHAT_VIEWS = 2;

type PaneDropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

interface PaneDropTarget {
  paneId: string;
  zone: PaneDropZone;
}

function resolvePaneDropZone(rect: DOMRect, clientX: number, clientY: number): PaneDropZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center';
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  const edges: Array<{ zone: Exclude<PaneDropZone, 'center'>; distance: number }> = [
    { zone: 'left', distance: x },
    { zone: 'right', distance: 1 - x },
    { zone: 'top', distance: y },
    { zone: 'bottom', distance: 1 - y },
  ];
  edges.sort((a, b) => a.distance - b.distance);
  return edges[0]!.distance <= 0.24 ? edges[0]!.zone : 'center';
}

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

function persistWorkbenchLayouts(layouts: WorkspaceWorkbenchLayouts): void {
  writeWorkspaceWorkbenchLayouts(layouts);
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
  if (resource.type === 'review') {
    return tab.type === 'review' && tab.runId === resource.id;
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
      value.type === 'browser' ||
      value.type === 'review'
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
  const [workbenchLayouts, setWorkbenchLayouts] = useState<WorkspaceWorkbenchLayouts>(() =>
    readWorkspaceWorkbenchLayouts(),
  );
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
  /** Latest run with file changes, reported up from the active ChatView for the
   *  workspace-files tab Review panel (right rail was removed; tabs are the only chrome). */
  const [latestReviewView, setLatestReviewView] = useState<RunProcessView | null>(null);
  const [reviewViewsByRunId, setReviewViewsByRunId] = useState<Map<string, RunProcessView>>(
    () => new Map(),
  );
  const handleLatestReviewChange = useCallback((view: RunProcessView | null) => {
    setLatestReviewView(view);
    if (!view) return;
    const runId = String(view.runId);
    setReviewViewsByRunId((current) => {
      if (current.get(runId) === view) return current;
      const next = new Map(current);
      next.set(runId, view);
      return next;
    });
  }, []);
  /** AI browser_open tool → navigate the tab-strip browser tab (right rail removed). */
  const [aiBrowserNav, setAiBrowserNav] = useState<{
    browserId: string;
    url: string;
    seq: number;
  } | null>(null);
  /**
   * 正在被拖拽的对话 tab id（NewMax 式跨屏移动）：拖动 tab 时聊天区右缘
   * 显示「拖到此处开分屏」落点，drop 后该对话进入右侧分屏。
   */
  const [tabDragResource, setTabDragResource] = useState<PaneResourceRef | null>(null);
  const [paneDropTarget, setPaneDropTarget] = useState<PaneDropTarget | null>(null);
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
      const next = typeof value === 'function' ? value(draftSessionRef.current) : value;
      draftSessionRef.current = next;
      setDraftSessionState(next);
    },
    [],
  );
  const pendingFirstMessageRef = useRef<DraftFirstMessage | null>(null);
  const initialConversationSkillSelectionsRef = useRef(new Map<string, string[]>());
  /**
   * conversationId → text waiting to be dropped into that chat's composer
   * (活动中心“重新编辑”). A ref alone would not re-render the mounted ChatView,
   * so a revision counter forces the pass-through.
   */
  const seedComposerTextRef = useRef(new Map<string, string>());
  const [seedComposerRevision, setSeedComposerRevision] = useState(0);
  const readSeedComposerText = useCallback(
    (conversationId: string): string | undefined => seedComposerTextRef.current.get(conversationId),
    // `seedComposerRevision` is the only reason this callback changes identity:
    // it is what propagates a newly queued seed down to the mounted ChatView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedComposerRevision],
  );
  const queueSeedComposerText = useCallback((conversationId: string, text: string) => {
    seedComposerTextRef.current.set(conversationId, text);
    setSeedComposerRevision((revision) => revision + 1);
  }, []);
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
    (workspaceId: string, update: (currentLayout: WorkspacePaneLayout) => WorkspacePaneLayout) => {
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

  const commitWorkbenchLayout = useCallback(
    (
      workspaceId: string,
      update: (currentLayout: WorkspaceWorkbenchLayout) => WorkspaceWorkbenchLayout,
      persist = true,
    ) => {
      setWorkbenchLayouts((current) => {
        const currentLayout = current[workspaceId] ?? createWorkspaceWorkbenchLayout();
        const layout = update(currentLayout);
        if (layout === currentLayout && Object.hasOwn(current, workspaceId)) return current;
        const next = { ...current, [workspaceId]: layout };
        if (persist) persistWorkbenchLayouts(next);
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
    },
    [activeWorkspaceId, commitPaneLayout],
  );

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
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleOpenFileInWorkbench = useCallback(
    (placement: WorkbenchPlacement, path: string, location?: ProjectTextLocation) => {
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
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openWorkbenchTab(current, placement, fileWorkbenchTab(path)),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleOpenFileInSplit = useCallback(
    (_paneId: string, path: string, location?: ProjectTextLocation) => {
      handleOpenFileInWorkbench('right', path, location);
    },
    [handleOpenFileInWorkbench],
  );

  const handleOpenReviewInWorkbench = useCallback(
    (placement: WorkbenchPlacement, view: RunProcessView) => {
      if (!activeWorkspaceId) return;
      const runId = String(view.runId);
      setReviewViewsByRunId((current) => {
        const next = new Map(current);
        next.set(runId, view);
        return next;
      });
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openWorkbenchTab(current, placement, reviewWorkbenchTab(runId)),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleOpenReviewInSplit = useCallback(
    (_paneId: string, view: RunProcessView) => {
      handleOpenReviewInWorkbench('right', view);
    },
    [handleOpenReviewInWorkbench],
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

  /** AI browser_open tool result → navigate the tab-strip browser tab (right rail removed). */
  const handleAiBrowserOpen = useCallback(
    (url: string) => {
      if (!activeWorkspaceId) return;
      let pendingNav: { browserId: string; url: string; seq: number } | null = null;
      commitPaneLayout(activeWorkspaceId, (current) => {
        const targetPaneId = current.focusedPaneId;
        const pane = current.panes[targetPaneId];
        const browserTab = pane?.tabs.find((tab) => tab.type === 'browser');
        if (browserTab && browserTab.type === 'browser') {
          // seq < 0 marker: existing tab → bump from the previous nav sequence.
          pendingNav = { browserId: browserTab.browserId, url, seq: -1 };
          return navigateBrowserPaneTab(current, targetPaneId, browserTab.browserId, url);
        }
        const browserId = createBrowserId();
        pendingNav = { browserId, url, seq: 1 };
        return openBrowserInPane(current, browserId, url, targetPaneId);
      });
      if (pendingNav) {
        const { browserId, url: navUrl, seq } = pendingNav;
        setAiBrowserNav((current) => ({
          browserId,
          url: navUrl,
          seq: seq === 1 ? 1 : (current?.seq ?? 0) + 1,
        }));
      }
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  // AI browser_open tool.completed → navigate the tab-strip browser tab.
  // First pass only registers historical events (no auto-navigation on reopen);
  // afterwards each fresh browser_open result navigates the focused pane's tab.
  const seenBrowserOpenIdsRef = useRef<Set<string>>(new Set());
  const browserNavPrimedRef = useRef(false);
  useEffect(() => {
    const priming = !browserNavPrimedRef.current;
    browserNavPrimedRef.current = true;
    let latest: { id: string; url: string } | undefined;
    for (const event of eventHistory) {
      if (event.type !== 'tool.completed' && event.type !== 'execution.tool.completed') continue;
      const payload = event.payload as {
        toolName?: unknown;
        tool?: unknown;
        result?: unknown;
        toolCallId?: unknown;
      };
      const toolName =
        typeof payload.toolName === 'string'
          ? payload.toolName
          : typeof payload.tool === 'string'
            ? payload.tool
            : '';
      if (toolName !== 'browser_open') continue;
      const eventKey =
        typeof payload.toolCallId === 'string' && payload.toolCallId
          ? payload.toolCallId
          : String(event.id);
      if (seenBrowserOpenIdsRef.current.has(eventKey)) continue;
      if (priming) {
        // 历史回放：全部登记为已见，绝不自动打开浏览器标签。
        seenBrowserOpenIdsRef.current.add(eventKey);
        continue;
      }
      try {
        const parsed = JSON.parse(String(payload.result ?? '')) as { ok?: boolean; url?: string };
        if (parsed.ok === true && typeof parsed.url === 'string') {
          latest = { id: eventKey, url: parsed.url };
        }
      } catch {
        /* malformed result — ignore */
      }
    }
    if (latest) {
      seenBrowserOpenIdsRef.current.add(latest.id);
      handleAiBrowserOpen(latest.url);
    }
  }, [eventHistory, handleAiBrowserOpen]);

  const handleCloseBrowserTab = useCallback(
    (paneId: string, browserId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        closeBrowserPaneTab(current, paneId, browserId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleActivateReviewTab = useCallback(
    (paneId: string, runId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        activateReviewPaneTab(current, paneId, runId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleCloseReviewTab = useCallback(
    (paneId: string, runId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) => closeReviewPaneTab(current, paneId, runId));
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
      commitPaneLayout(activeWorkspaceId, (current) => closeWorkspaceFilesPaneTab(current, paneId));
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const handleToggleWorkbench = useCallback(
    (placement: WorkbenchPlacement) => {
      if (!activeWorkspaceId) return;
      const hasProjectFolder = Boolean(
        data.workspaces
          .find((workspace) => workspace.workspaceId === activeWorkspaceId)
          ?.folderPath?.trim(),
      );
      commitWorkbenchLayout(activeWorkspaceId, (current) => {
        const scope = current[placement];
        if (scope.open) return setWorkbenchOpen(current, placement, false);
        if (scope.tabs.length > 0) return setWorkbenchOpen(current, placement, true);
        if (placement === 'right' || !hasProjectFolder) {
          return openWorkbenchTab(current, placement, workspaceFilesWorkbenchTab());
        }
        return openWorkbenchTab(current, placement, terminalWorkbenchTab(createTerminalId()));
      });
    },
    [activeWorkspaceId, commitWorkbenchLayout, data.workspaces],
  );

  const handleNewWorkbenchResource = useCallback(
    (placement: WorkbenchPlacement, resource: WorkbenchNewResource) => {
      if (!activeWorkspaceId) return;
      if (resource === 'files') {
        commitWorkbenchLayout(activeWorkspaceId, (current) =>
          openWorkbenchTab(current, placement, workspaceFilesWorkbenchTab()),
        );
        return;
      }
      if (resource === 'terminal') {
        const projectFolder = data.workspaces
          .find((workspace) => workspace.workspaceId === activeWorkspaceId)
          ?.folderPath?.trim();
        if (!projectFolder) return;
        commitWorkbenchLayout(activeWorkspaceId, (current) =>
          openWorkbenchTab(current, placement, terminalWorkbenchTab(createTerminalId())),
        );
        return;
      }
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openWorkbenchTab(
          current,
          placement,
          browserWorkbenchTab(createBrowserId(), 'https://www.bing.com'),
        ),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout, data.workspaces],
  );

  const handleActivateWorkbenchTab = useCallback(
    (placement: WorkbenchPlacement, tabId: string) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        activateWorkbenchTab(current, placement, tabId),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleCloseWorkbench = useCallback(
    (placement: WorkbenchPlacement) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        setWorkbenchOpen(current, placement, false),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleWorkbenchSizeChange = useCallback(
    (placement: WorkbenchPlacement, size: number, commit: boolean) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(
        activeWorkspaceId,
        (current) => setWorkbenchSize(current, placement, size),
        commit,
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleWorkbenchFileBrowserOpenChange = useCallback(
    (placement: WorkbenchPlacement, open: boolean) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        setWorkbenchFileBrowserOpen(current, placement, open),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleWorkbenchFileBrowserWidthChange = useCallback(
    (placement: WorkbenchPlacement, width: number, commit: boolean) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(
        activeWorkspaceId,
        (current) => setWorkbenchFileBrowserWidth(current, placement, width),
        commit,
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleCloseWorkbenchTab = useCallback(
    async (placement: WorkbenchPlacement, tab: WorkbenchTab) => {
      if (!activeWorkspaceId) return;
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      if (tab.type === 'file' && projectFolder && isFilePaneSessionDirty(projectFolder, tab.path)) {
        const confirmed = await dialog.confirm({
          title: '关闭未保存的文件',
          message: `${tab.path} 还有未保存的修改，确定放弃这些修改吗？`,
          confirmText: '放弃并关闭',
          danger: true,
        });
        if (!confirmed) return;
      }
      if (tab.type === 'file') {
        if (projectFolder) clearFilePaneSession(projectFolder, tab.path);
        const dirtyKey = fileTabDirtyKey(activeWorkspaceId, tab.path);
        setDirtyFileTabs((current) => {
          if (!current.has(dirtyKey)) return current;
          const next = new Set(current);
          next.delete(dirtyKey);
          return next;
        });
        setFileRevealTargets((current) => {
          const key = fileTabDirtyKey(activeWorkspaceId, tab.path);
          if (!current.has(key)) return current;
          const next = new Map(current);
          next.delete(key);
          return next;
        });
      } else if (tab.type === 'terminal') {
        disposeTerminalSession(tab.terminalId);
      }
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        closeWorkbenchTab(current, placement, tab.id),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout, data.workspaces, dialog],
  );

  const handleFileDirtyChange = useCallback((workspaceId: string, path: string, dirty: boolean) => {
    const key = fileTabDirtyKey(workspaceId, path);
    setDirtyFileTabs((current) => {
      if (current.has(key) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleOpenFileInCurrentTab = useCallback(
    (paneId: string, currentPath: string, nextPath: string, location?: ProjectTextLocation) => {
      if (!activeWorkspaceId) return;
      const normalizedPath = nextPath.trim();
      if (!normalizedPath) return;
      if (normalizedPath === currentPath) {
        handleOpenFileInPane(paneId, normalizedPath, location);
        return;
      }

      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      if (projectFolder && isFilePaneSessionDirty(projectFolder, currentPath)) {
        handleOpenFileInPane(paneId, normalizedPath, location);
        return;
      }

      if (projectFolder) clearFilePaneSession(projectFolder, currentPath);
      handleFileDirtyChange(activeWorkspaceId, currentPath, false);
      setFileRevealTargets((current) => {
        const next = new Map(current);
        next.delete(fileTabDirtyKey(activeWorkspaceId, currentPath));
        if (location) {
          fileRevealNonceRef.current += 1;
          next.set(fileTabDirtyKey(activeWorkspaceId, normalizedPath), {
            ...location,
            nonce: fileRevealNonceRef.current,
          });
        }
        return next;
      });
      commitPaneLayout(activeWorkspaceId, (current) =>
        replaceFileInPane(current, paneId, currentPath, normalizedPath),
      );
    },
    [
      activeWorkspaceId,
      commitPaneLayout,
      data.workspaces,
      handleFileDirtyChange,
      handleOpenFileInPane,
    ],
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
      commitPaneLayout(activeWorkspaceId, (current) => activateFilePaneTab(current, paneId, path));
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

  const handleDropPaneResource = useCallback(
    (resource: PaneResourceRef, targetPaneId: string, zone: PaneDropZone) => {
      if (!activeWorkspaceId) return;
      if (zone === 'center') {
        handleMovePaneResourceToPane(resource, targetPaneId);
        return;
      }
      const direction: PaneSplitDirection =
        zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
      const side = zone === 'left' || zone === 'top' ? 'before' : 'after';
      commitPaneLayout(activeWorkspaceId, (current) =>
        splitPaneWithResource(current, targetPaneId, direction, resource, side),
      );
      if (resource.type === 'conversation') {
        setNav((state) => openConversation(state, resource.id));
      }
    },
    [activeWorkspaceId, commitPaneLayout, handleMovePaneResourceToPane],
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
    const [conversations, agents, teams, providers, workspaces, skills] = await Promise.all([
      api.listConversations({ includeArchived: true }),
      api.listGlobalAgents({}),
      api.listTeams(),
      api.listProviders({}),
      api.listWorkspaces({}),
      api.listSkills({}),
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
          providerId: String(provider.providerId),
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
      skills: skills.skills,
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
    setWorkbenchLayouts((current) => {
      const validWorkspaceIds = new Set<string>(
        workspaces.workspaces.map((workspace) => String(workspace.workspaceId)),
      );
      const next = Object.fromEntries(
        Object.entries(current).filter(([workspaceId]) => validWorkspaceIds.has(workspaceId)),
      );
      persistWorkbenchLayouts(next);
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
      // 全局智能体库随事件即时刷新：AI 通过 create_agent / update_agent /
      // archive_agent 工具变更智能体时发布 globalAgent.* 事件，不在此刷新则
      // 智能体库列表要等手动刷新/切页才更新。
      if (
        event.type === 'globalAgent.created' ||
        event.type === 'globalAgent.updated' ||
        event.type === 'globalAgent.deleted'
      ) {
        void refresh();
      }
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
    async (track: ConversationTrack, targetRef: string, firstMessage?: DraftFirstMessage) => {
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
      const createdConversationId = String(created.conversation.id);
      const initialModelId = firstMessage?.modelId?.trim();
      const initialKernelId = firstMessage?.kernelId.trim() || 'native';
      if (initialModelId) {
        writeConversationModelOverride(createdConversationId, initialModelId);
        setModelOverrides((current) => ({
          ...current,
          [createdConversationId]: initialModelId,
        }));
      }
      if (firstMessage) {
        writeConversationKernelOverride(createdConversationId, initialKernelId);
        writeConversationReasoningEffort(createdConversationId, firstMessage.reasoningEffort);
        writeConversationNetworkEnabled(createdConversationId, firstMessage.networkEnabled);
        if (firstMessage.interactionMode === 'plan') {
          await api.setConversationInteractionMode({
            conversationId: created.conversation.id,
            interactionMode: 'plan',
          });
        }
      }

      const hasFirstTurn = Boolean(
        firstMessage && (firstMessage.text.trim() || firstMessage.images.length > 0),
      );
      if (firstMessage && hasFirstTurn) {
        const outboundText = firstMessage.text.trim()
          ? firstMessage.text
          : firstMessage.images.map((image) => `[图片] ${image.name || 'image'}`).join('\n');
        const prep = await api.sendConversationMessage({
          conversationId: created.conversation.id,
          text: outboundText,
          modelId: firstMessage.modelId as Parameters<
            typeof api.sendConversationMessage
          >[0]['modelId'],
        });
        const skillVersionIds = resolveAppendSkillVersionIds(track, firstMessage.skillVersionIds);
        await api.appendMessage({
          threadId: prep.threadId,
          expectedTaskVersion: prep.taskVersion,
          role: 'user',
          text: outboundText,
          modelId: firstMessage.modelId as Parameters<typeof api.appendMessage>[0]['modelId'],
          kernelId: initialKernelId,
          reasoningEffort: firstMessage.reasoningEffort,
          networkEnabled: firstMessage.networkEnabled || undefined,
          skillVersionIds,
          images:
            firstMessage.images.length > 0
              ? firstMessage.images.map((image) => ({
                  name: image.name || 'image',
                  mimeType: image.mimeType || 'image/png',
                  dataUrl: image.url,
                }))
              : undefined,
        });
        initialConversationSkillSelectionsRef.current.set(
          String(created.conversation.id),
          skillVersionIds,
        );
      }

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
        if (hasFirstTurn) {
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
    async (input: { name: string; folderPath: string; icon?: string }): Promise<boolean> => {
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
        commitPaneLayout(activeWorkspaceId, (current) => closeConversationInLayout(current, id));
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
      const workspaceId = (source.workspaceId ?? activeWorkspaceId) as WorkspaceId | undefined;
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
      interactionMode: 'execute',
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
  const activeWorkbenchLayout = useMemo(
    () =>
      activeWorkspaceId
        ? (workbenchLayouts[activeWorkspaceId] ?? createWorkspaceWorkbenchLayout())
        : undefined,
    [activeWorkspaceId, workbenchLayouts],
  );

  useEffect(() => {
    let voiceConversationId: string | undefined;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || settingsOpen) return;
      const shortcuts = readShortcutPreferences();
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (shortcuts.newChat.enabled && matchesShortcut(event, shortcuts.newChat.accelerator)) {
        event.preventDefault();
        handleNewConversation();
        return;
      }
      if (
        shortcuts.conversationSearch.enabled &&
        matchesShortcut(event, shortcuts.conversationSearch.accelerator)
      ) {
        event.preventDefault();
        setNav((current) => setSidebarCollapsed(current, false));
        window.dispatchEvent(new CustomEvent('shell-open-conversation-search'));
        return;
      }
      if (
        !event.repeat &&
        shortcuts.voiceInput.enabled &&
        matchesShortcut(event, shortcuts.voiceInput.accelerator)
      ) {
        const pane = activePaneLayout?.focusedPaneId
          ? activePaneLayout.panes[activePaneLayout.focusedPaneId]
          : undefined;
        const tab = pane?.tabs.find((item) => item.id === pane.activeTabId);
        if (tab?.type !== 'conversation') return;
        event.preventDefault();
        voiceConversationId = tab.conversationId;
        window.dispatchEvent(
          new CustomEvent('shell-voice-input-start', {
            detail: { conversationId: voiceConversationId },
          }),
        );
        return;
      }
      if (shortcuts.workspaceSwitch.enabled && /^[1-9]$/.test(event.key)) {
        const candidate = shortcuts.workspaceSwitch.accelerator.replace(/\+1$/, `+${event.key}`);
        if (matchesShortcut(event, candidate)) {
          const workspace = data.workspaces[Number(event.key) - 1];
          if (workspace) {
            event.preventDefault();
            selectWorkspace(workspace.workspaceId);
          }
          return;
        }
      }
      if (
        !editing &&
        shortcuts.sidebarLeft.enabled &&
        matchesShortcut(event, shortcuts.sidebarLeft.accelerator)
      ) {
        event.preventDefault();
        setNav((current) => toggleSidebar(current));
        return;
      }
      if (
        !editing &&
        shortcuts.sidebarRight.enabled &&
        matchesShortcut(event, shortcuts.sidebarRight.accelerator)
      ) {
        event.preventDefault();
        handleToggleWorkspaceFilesPane(activePaneLayout?.focusedPaneId);
        return;
      }
      if (shortcuts.planMode.enabled && matchesShortcut(event, shortcuts.planMode.accelerator)) {
        const pane = activePaneLayout?.focusedPaneId
          ? activePaneLayout.panes[activePaneLayout.focusedPaneId]
          : undefined;
        const tab = pane?.tabs.find((item) => item.id === pane.activeTabId);
        if (tab?.type !== 'conversation') return;
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('shell-toggle-plan-mode', {
            detail: { conversationId: tab.conversationId },
          }),
        );
        return;
      }
      if (shortcuts.goalMode.enabled && matchesShortcut(event, shortcuts.goalMode.accelerator)) {
        const pane = activePaneLayout?.focusedPaneId
          ? activePaneLayout.panes[activePaneLayout.focusedPaneId]
          : undefined;
        const tab = pane?.tabs.find((item) => item.id === pane.activeTabId);
        if (tab?.type !== 'conversation') return;
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('shell-toggle-goal-mode', {
            detail: { conversationId: tab.conversationId },
          }),
        );
        return;
      }
      if (shortcuts.closeTab.enabled && matchesShortcut(event, shortcuts.closeTab.accelerator)) {
        const paneId = activePaneLayout?.focusedPaneId;
        const pane = paneId ? activePaneLayout?.panes[paneId] : undefined;
        const tab = pane?.tabs.find((item) => item.id === pane.activeTabId);
        if (!paneId || !tab) return;
        event.preventDefault();
        if (tab.type === 'conversation') handleCloseConversationTab(paneId, tab.conversationId);
        else if (tab.type === 'file') void handleCloseFileTab(paneId, tab.path);
        else if (tab.type === 'terminal') void handleCloseTerminalTab(paneId, tab.terminalId);
        else if (tab.type === 'browser') handleCloseBrowserTab(paneId, tab.browserId);
        else if (tab.type === 'review') handleCloseReviewTab(paneId, tab.runId);
        else if (tab.type === 'workspace-files') handleCloseWorkspaceFilesTab(paneId);
      }
    };
    const handleShortcutRelease = () => {
      if (!voiceConversationId) return;
      window.dispatchEvent(
        new CustomEvent('shell-voice-input-stop', {
          detail: { conversationId: voiceConversationId },
        }),
      );
      voiceConversationId = undefined;
    };
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('keyup', handleShortcutRelease);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('keyup', handleShortcutRelease);
    };
  }, [
    activePaneLayout,
    data.workspaces,
    handleCloseBrowserTab,
    handleCloseConversationTab,
    handleCloseFileTab,
    handleCloseReviewTab,
    handleCloseTerminalTab,
    handleCloseWorkspaceFilesTab,
    handleNewConversation,
    handleToggleWorkspaceFilesPane,
    selectWorkspace,
    settingsOpen,
  ]);
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
        (pane) => pane.tabs.find((tab) => tab.id === pane.activeTabId)?.type === 'conversation',
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
      text: string;
      images: MessageImage[];
      modelId: string;
      kernelId: string;
      interactionMode: 'plan' | 'execute';
      permissionMode: PermissionMode;
      reasoningEffort: ReasoningEffort;
      networkEnabled: boolean;
      skillVersionIds: string[];
    }) => {
      const text = options.text.trim();
      if ((!text && options.images.length === 0) || newConversationSending) return false;
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
        images: options.images,
        modelId: options.modelId || undefined,
        kernelId: options.kernelId || 'native',
        interactionMode: options.interactionMode,
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
          setNewConversationError(error instanceof Error ? error.message : '发送第一条消息失败');
          return false;
        } finally {
          setNewConversationSending(false);
        }
      }

      const modelId =
        options.modelId || session.targetRef || newConversationModel || data.models[0]?.modelId;
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
        setNewConversationError(error instanceof Error ? error.message : '发送第一条消息失败');
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
    [beginDraftConversation, data.models, newConversationModel, rememberTrack, setDraftSession],
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

  const renderWorkbenchContent = (placement: WorkbenchPlacement, tab: WorkbenchTab) => {
    const scope = activeWorkbenchLayout?.[placement];
    if (tab.type === 'workspace-files') {
      return (
        <WorkspaceFilesPanel
          projectFolder={activeProjectFolder}
          activeFilePath={undefined}
          reviewView={latestReviewView}
          onOpenReview={(view) => handleOpenReviewInWorkbench(placement, view)}
          onOpenFile={(path, location) => handleOpenFileInWorkbench(placement, path, location)}
          onOpenFileInNewTab={(path, location) =>
            handleOpenFileInWorkbench(placement, path, location)
          }
        />
      );
    }
    if (tab.type === 'file') {
      return (
        <WorkspaceFileView
          key={tab.path}
          projectFolder={activeProjectFolder}
          path={tab.path}
          revealTarget={
            activeWorkspaceId
              ? fileRevealTargets.get(fileTabDirtyKey(activeWorkspaceId, tab.path))
              : undefined
          }
          workspaceFilesOpen={scope?.fileBrowserOpen ?? true}
          onWorkspaceFilesOpenChange={(open) =>
            handleWorkbenchFileBrowserOpenChange(placement, open)
          }
          explorerWidth={scope?.fileBrowserWidth}
          onExplorerWidthChange={(width, commit) =>
            handleWorkbenchFileBrowserWidthChange(placement, width, commit)
          }
          reviewView={latestReviewView}
          onOpenReview={(view) => handleOpenReviewInWorkbench(placement, view)}
          onDirtyChange={(dirty) => {
            if (activeWorkspaceId) handleFileDirtyChange(activeWorkspaceId, tab.path, dirty);
          }}
          onOpenFileInCurrentTab={(path, location) =>
            handleOpenFileInWorkbench(placement, path, location)
          }
          onOpenFileInNewTab={(path, location) =>
            handleOpenFileInWorkbench(placement, path, location)
          }
        />
      );
    }
    if (tab.type === 'review') {
      return (
        <ReviewPanel
          view={reviewViewsByRunId.get(tab.runId) ?? null}
          projectFolder={activeProjectFolder}
          standalone
          onOpenFile={(path, location) => handleOpenFileInWorkbench(placement, path, location)}
          onOpenFileInNewTab={(path, location) =>
            handleOpenFileInWorkbench(placement, path, location)
          }
        />
      );
    }
    if (tab.type === 'terminal') {
      return (
        <TerminalPane
          key={tab.terminalId}
          terminalId={tab.terminalId}
          projectFolder={activeProjectFolder}
          cwd={tab.cwd}
          onCwdChange={(cwd) => {
            if (!activeWorkspaceId) return;
            commitWorkbenchLayout(activeWorkspaceId, (current) =>
              openWorkbenchTab(current, placement, terminalWorkbenchTab(tab.terminalId, cwd)),
            );
          }}
        />
      );
    }
    return (
      <BrowserPanel
        key={tab.browserId}
        initialUrl={tab.url}
        navigateUrl={aiBrowserNav?.browserId === tab.browserId ? aiBrowserNav.url : undefined}
        navigateSeq={aiBrowserNav?.browserId === tab.browserId ? aiBrowserNav.seq : undefined}
        onClose={() => void handleCloseWorkbenchTab(placement, tab)}
        partition={`workbench-browser-${tab.browserId}`}
        registerForAutomation={false}
      />
    );
  };

  return (
    <div className="shell-app-root flex h-full flex-col bg-page">
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
              setNav((n) =>
                selectStage(n, stage === 'agents' || stage === 'teams' ? stage : n.stage),
              );
            }}
            onClose={() => {
              pendingFirstMessageRef.current = null;
              setPickerTrack(null);
            }}
          />
        )}

        <main
          className={`shell-board flex min-w-0 flex-1 flex-col overflow-hidden bg-panel${nav.stage === 'talk' ? ' shell-stage--talk' : ''}`}
          data-testid="shell-stage"
        >
          {/* Workspace tabs live inside the stage board (NewMax mid-stage),
              not as a full-window chrome bar above the pure sidebar. */}
          <TopBar
            workspaces={data.workspaces}
            activeWorkspaceId={activeWorkspaceId}
            sidebarCollapsed={nav.sidebarCollapsed}
            contextStage={nav.stage === 'talk' || nav.stage === 'settings' ? undefined : nav.stage}
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
            bottomWorkbenchOpen={activeWorkbenchLayout?.bottom.open ?? false}
            rightWorkbenchOpen={activeWorkbenchLayout?.right.open ?? false}
            onToggleBottomWorkbench={() => handleToggleWorkbench('bottom')}
            onToggleRightWorkbench={() => handleToggleWorkbench('right')}
            workspaceActivity={workspaceActivity}
          />
          {nav.stage === 'talk' ? (
            <div className="shell-workspace-content-frame" data-workspace-content-frame="true">
              <div className="shell-workspace-content-row" data-workspace-content-row="true">
                <div
                  className="shell-workspace-primary-content"
                  data-workspace-primary-content="true"
                >
                  <WallpaperReadingLayers />
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
                        const localTerminalTabs = pane.tabs.filter(
                          (tab) => tab.type === 'terminal',
                        );
                        const localBrowserTabs = pane.tabs.filter((tab) => tab.type === 'browser');
                        const localReviewTabs = pane.tabs.filter((tab) => tab.type === 'review');
                        const hasLocalWorkspaceFilesTab = pane.tabs.some(
                          (tab) => tab.type === 'workspace-files',
                        );
                        const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
                        const activeFilePath =
                          activeTab?.type === 'file' ? activeTab.path : undefined;
                        const activeTerminalId =
                          activeTab?.type === 'terminal' ? activeTab.terminalId : undefined;
                        const activeBrowserId =
                          activeTab?.type === 'browser' ? activeTab.browserId : undefined;
                        const activeReviewRunId =
                          activeTab?.type === 'review' ? activeTab.runId : undefined;
                        const workspaceFilesPaneId = findWorkspaceFilesPane(activePaneLayout);
                        const isDraftConversation =
                          activeTab?.type === 'conversation' &&
                          activeTab.conversationId === draftSession?.id;
                        const conversation =
                          activeTab?.type === 'conversation'
                            ? visibleConversations.find(
                                (item) => item.id === activeTab.conversationId,
                              )
                            : undefined;
                        const conversationsForPane = visibleConversations.filter(
                          (item) =>
                            localConversationIds.includes(String(item.id)) ||
                            !openIdsForWorkspace.includes(String(item.id)),
                        );
                        const activeConversationPaneCount = Object.values(
                          activePaneLayout.panes,
                        ).filter(
                          (item) =>
                            item.tabs.find((tab) => tab.id === item.activeTabId)?.type ===
                            'conversation',
                        ).length;
                        const shouldMountConversation = mountedConversationPaneIds.has(pane.id);
                        const canToggleWorkspaceFiles = focused || hasLocalWorkspaceFilesTab;
                        const draggingFromThisPane = Boolean(
                          tabDragResource &&
                          pane.tabs.some((tab) => paneTabMatchesResource(tab, tabDragResource)),
                        );
                        return (
                          <div
                            className="shell-pane-frame relative flex min-h-0 flex-1 flex-col overflow-hidden"
                            onDragOver={(event) => {
                              if (!tabDragResource) return;
                              const zone = resolvePaneDropZone(
                                event.currentTarget.getBoundingClientRect(),
                                event.clientX,
                                event.clientY,
                              );
                              if (
                                draggingFromThisPane &&
                                (pane.tabs.length <= 1 || zone === 'center')
                              ) {
                                setPaneDropTarget((current) =>
                                  current?.paneId === pane.id ? null : current,
                                );
                                return;
                              }
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setPaneDropTarget({ paneId: pane.id, zone });
                            }}
                            onDragLeave={(event) => {
                              if (
                                event.relatedTarget instanceof Node &&
                                event.currentTarget.contains(event.relatedTarget)
                              ) {
                                return;
                              }
                              setPaneDropTarget((current) =>
                                current?.paneId === pane.id ? null : current,
                              );
                            }}
                            onDrop={(event) => {
                              if (!tabDragResource) return;
                              event.preventDefault();
                              const zone = resolvePaneDropZone(
                                event.currentTarget.getBoundingClientRect(),
                                event.clientX,
                                event.clientY,
                              );
                              if (
                                draggingFromThisPane &&
                                (pane.tabs.length <= 1 || zone === 'center')
                              ) {
                                setPaneDropTarget(null);
                                setTabDragResource(null);
                                return;
                              }
                              const resource =
                                parsePaneResourceDrag(
                                  event.dataTransfer.getData(
                                    'application/x-sync-think-pane-resource',
                                  ),
                                ) ??
                                parsePaneResourceDrag(event.dataTransfer.getData('text/plain')) ??
                                tabDragResource;
                              setPaneDropTarget(null);
                              setTabDragResource(null);
                              handleDropPaneResource(resource, pane.id, zone);
                            }}
                          >
                            <ConversationTabs
                              paneId={pane.id}
                              focused={focused}
                              conversations={conversationsForPane}
                              openIds={localConversationIds}
                              activeId={conversation?.id}
                              fileTabs={localFileTabs}
                              activeFilePath={activeFilePath}
                              terminalTabs={localTerminalTabs}
                              activeTerminalId={activeTerminalId}
                              browserTabs={localBrowserTabs}
                              activeBrowserId={activeBrowserId}
                              reviewTabs={localReviewTabs}
                              activeReviewRunId={activeReviewRunId}
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
                              onSelectReview={(runId) => handleActivateReviewTab(pane.id, runId)}
                              onCloseReview={(runId) => handleCloseReviewTab(pane.id, runId)}
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
                                if (!id) setPaneDropTarget(null);
                              }}
                              conversationActivity={conversationActivityView}
                            />
                            <div className="shell-pane-canvas relative flex min-h-0 flex-1 overflow-hidden">
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
                                    initialConversationSkillSelectionsRef.current.delete(
                                      conversationId,
                                    );
                                  }}
                                  seedComposerText={readSeedComposerText(String(conversation.id))}
                                  onSeedComposerTextConsumed={(conversationId) => {
                                    seedComposerTextRef.current.delete(conversationId);
                                  }}
                                  onTitleUpdated={() => void refresh()}
                                  onConversationUpdated={handleConversationUpdated}
                                  onLatestReviewChange={handleLatestReviewChange}
                                  onOpenFile={(path, location) =>
                                    handleOpenFileInSplit(pane.id, path, location)
                                  }
                                  onOpenReview={(view) => handleOpenReviewInSplit(pane.id, view)}
                                />
                              ) : conversation ? (
                                <button
                                  type="button"
                                  className="shell-chat-parked"
                                  data-testid={`parked-conversation-${conversation.id}`}
                                  onClick={() => handleFocusPane(pane.id)}
                                >
                                  <MessageSquare size={18} aria-hidden="true" />
                                  <span>
                                    <strong>{conversation.title?.trim() || '未命名对话'}</strong>
                                    <small>此对话暂时休眠，点击加载</small>
                                  </span>
                                </button>
                              ) : activeTab?.type === 'browser' ? (
                                <BrowserPanel
                                  key={activeTab.browserId}
                                  initialUrl={activeTab.url}
                                  navigateUrl={
                                    aiBrowserNav?.browserId === activeTab.browserId
                                      ? aiBrowserNav.url
                                      : undefined
                                  }
                                  navigateSeq={
                                    aiBrowserNav?.browserId === activeTab.browserId
                                      ? aiBrowserNav.seq
                                      : undefined
                                  }
                                  onClose={() =>
                                    handleCloseBrowserTab(pane.id, activeTab.browserId)
                                  }
                                  partition={`pane-browser-${activeTab.browserId}`}
                                  registerForAutomation={false}
                                />
                              ) : activeTab?.type === 'workspace-files' ? (
                                <WorkspaceFilesPanel
                                  projectFolder={activeProjectFolder}
                                  activeFilePath={undefined}
                                  reviewView={latestReviewView}
                                  onOpenReview={(view) =>
                                    handleOpenReviewInWorkbench('right', view)
                                  }
                                  onOpenFile={(path, location) =>
                                    handleOpenFileInPane(pane.id, path, location)
                                  }
                                />
                              ) : activeTab?.type === 'review' ? (
                                <ReviewPanel
                                  view={reviewViewsByRunId.get(activeTab.runId) ?? null}
                                  projectFolder={activeProjectFolder}
                                  standalone
                                  onOpenFile={(path, location) =>
                                    handleOpenFileInPane(pane.id, path, location)
                                  }
                                  onOpenFileInNewTab={(path, location) =>
                                    handleOpenFileInPane(pane.id, path, location)
                                  }
                                />
                              ) : activeTab?.type === 'file' ? (
                                <WorkspaceFileView
                                  projectFolder={activeProjectFolder}
                                  path={activeTab.path}
                                  reviewView={latestReviewView}
                                  onOpenReview={(view) =>
                                    handleOpenReviewInWorkbench('right', view)
                                  }
                                  revealTarget={
                                    activeWorkspaceId
                                      ? fileRevealTargets.get(
                                          fileTabDirtyKey(activeWorkspaceId, activeTab.path),
                                        )
                                      : undefined
                                  }
                                  onDirtyChange={(dirty) => {
                                    if (activeWorkspaceId) {
                                      handleFileDirtyChange(
                                        activeWorkspaceId,
                                        activeTab.path,
                                        dirty,
                                      );
                                    }
                                  }}
                                  onOpenFileInCurrentTab={(path, location) =>
                                    handleOpenFileInCurrentTab(
                                      pane.id,
                                      activeTab.path,
                                      path,
                                      location,
                                    )
                                  }
                                  onOpenFileInNewTab={(path, location) =>
                                    handleOpenFileInPane(pane.id, path, location)
                                  }
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
                              {paneDropTarget?.paneId === pane.id ? (
                                <div
                                  className="shell-pane-drop-overlay pointer-events-none absolute z-30"
                                  data-zone={paneDropTarget.zone}
                                />
                              ) : null}
                            </div>
                          </div>
                        );
                      }}
                    />
                  ) : (
                    <div className="shell-pane-canvas shell-pane-canvas--empty relative flex min-h-0 flex-1 overflow-hidden">
                      {emptyTalk}
                    </div>
                  )}
                </div>
                {activeWorkbenchLayout?.right.open &&
                activeWorkbenchLayout.right.tabs.length > 0 ? (
                  <WorkspaceWorkbench
                    placement="right"
                    scope={activeWorkbenchLayout.right}
                    canOpenTerminal={Boolean(activeProjectFolder)}
                    renderContent={(tab) => renderWorkbenchContent('right', tab)}
                    onActivateTab={(tabId) => handleActivateWorkbenchTab('right', tabId)}
                    onCloseTab={(tab) => void handleCloseWorkbenchTab('right', tab)}
                    onNewResource={(resource) => handleNewWorkbenchResource('right', resource)}
                    onClose={() => handleCloseWorkbench('right')}
                    onSizeChange={(size, commit) =>
                      handleWorkbenchSizeChange('right', size, commit)
                    }
                  />
                ) : null}
              </div>
              {activeWorkbenchLayout?.bottom.open &&
              activeWorkbenchLayout.bottom.tabs.length > 0 ? (
                <WorkspaceWorkbench
                  placement="bottom"
                  scope={activeWorkbenchLayout.bottom}
                  canOpenTerminal={Boolean(activeProjectFolder)}
                  renderContent={(tab) => renderWorkbenchContent('bottom', tab)}
                  onActivateTab={(tabId) => handleActivateWorkbenchTab('bottom', tabId)}
                  onCloseTab={(tab) => void handleCloseWorkbenchTab('bottom', tab)}
                  onNewResource={(resource) => handleNewWorkbenchResource('bottom', resource)}
                  onClose={() => handleCloseWorkbench('bottom')}
                  onSizeChange={(size, commit) => handleWorkbenchSizeChange('bottom', size, commit)}
                />
              ) : null}
            </div>
          ) : nav.stage === 'agents' ? (
            <AgentLibrary
              agents={data.agents}
              models={data.models}
              teams={data.teams}
              conversations={data.conversations}
              workspaces={data.workspaces}
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
          ) : nav.stage === 'tasks' ? (
            <TaskPanel
              agents={data.agents}
              models={data.models}
              teams={data.teams}
              workspaces={data.workspaces}
              skills={data.skills}
              onOpenConversation={(conversationId) => {
                void openConversationById(conversationId);
                setNav((n) => selectStage(n, 'talk'));
              }}
            />
          ) : nav.stage === 'activity' ? (
            <ActivityCenterPage
              eventHistory={eventHistory}
              onRetryRun={({ conversationId, text }) => {
                // Only stages the prompt; ChatView still owns the send.
                queueSeedComposerText(conversationId, text);
              }}
              onOpenConversation={(conversationId) => {
                void openConversationById(conversationId);
                setNav((n) => selectStage(n, 'talk'));
              }}
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
    text: string;
    images: MessageImage[];
    modelId: string;
    kernelId: string;
    interactionMode: 'plan' | 'execute';
    permissionMode: PermissionMode;
    reasoningEffort: ReasoningEffort;
    networkEnabled: boolean;
    skillVersionIds: string[];
  }): Promise<boolean>;
  onOpenWorkspaceMenu(): void;
  onPickTrack(track: ConversationTrack): void;
}) {
  const chips: Array<{
    track: ConversationTrack;
    icon: typeof Sparkles;
    label: string;
    desc: string;
  }> = [
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
  const [interactionMode, setInteractionMode] = useState<'plan' | 'execute'>('execute');
  const [kernelOverride, setKernelOverride] = useState(() => readNewConversationKernel());
  const [kernelRegistry, setKernelRegistry] = useState<KernelDetectionResult[] | null>(null);
  const [kernelInstallStates, setKernelInstallStates] = useState<
    Record<string, KernelInstallState | undefined>
  >({});
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | undefined>();
  const [atQuery, setAtQuery] = useState<MentionQuery | null>(null);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashSkills, setSlashSkills] = useState<SkillVersionSummary[]>([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const networkSettingRef = useRef<HTMLDivElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const kernelInstallPromisesRef = useRef(new Map<string, Promise<void>>());
  const kernelDetectionGenerationRef = useRef(0);
  const kernelInstallMountedRef = useRef(true);
  const selectedModel =
    props.models.find((model) => model.modelId === props.selectedModelId) ?? props.models[0];
  const draftTrack = props.draftTrack ?? 'model';
  const activeKernel = kernelRegistry?.find((kernel) => kernel.kernelId === kernelOverride) ?? null;
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
  const [selectedSkillVersionIds, setSelectedSkillVersionIds] = useState<string[]>(
    () => defaultSkillVersionIds,
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

  useEffect(() => {
    kernelInstallMountedRef.current = true;
    return () => {
      kernelInstallMountedRef.current = false;
    };
  }, []);

  const detectKernels = useCallback(async (): Promise<KernelDetectionResult[] | null> => {
    const api = bridge();
    if (!api?.detectKernels) return null;
    const generation = (kernelDetectionGenerationRef.current += 1);
    try {
      const response = await api.detectKernels();
      if (!Array.isArray(response?.kernels)) return null;
      if (kernelInstallMountedRef.current && generation === kernelDetectionGenerationRef.current) {
        setKernelRegistry(response.kernels);
      }
      return response.kernels;
    } catch {
      if (kernelInstallMountedRef.current && generation === kernelDetectionGenerationRef.current) {
        setKernelRegistry(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void detectKernels();
  }, [detectKernels]);

  const installKernel = useCallback(
    (kernelId: string) => {
      const existing = kernelInstallPromisesRef.current.get(kernelId);
      if (existing) return existing;
      const api = bridge();
      if (!api?.installKernel) {
        setKernelInstallStates((current) => ({
          ...current,
          [kernelId]: { status: 'error', error: '当前桌面版本不支持内核安装' },
        }));
        return Promise.resolve();
      }

      const installPromise = (async () => {
        setKernelInstallStates((current) => ({
          ...current,
          [kernelId]: { status: 'installing' },
        }));
        try {
          const result = await api.installKernel(kernelId);
          if (!result.ok) throw new Error(result.error || '安装命令执行失败');
          if (!kernelInstallMountedRef.current) return;
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: { status: 'verifying' },
          }));
          const detected = await detectKernels();
          if (!detected?.some((kernel) => kernel.kernelId === kernelId && kernel.installed)) {
            throw new Error('安装完成，但仍未检测到内核');
          }
          if (!kernelInstallMountedRef.current) return;
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: { status: 'success' },
          }));
        } catch (error) {
          if (!kernelInstallMountedRef.current) return;
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: {
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        } finally {
          kernelInstallPromisesRef.current.delete(kernelId);
        }
      })();
      kernelInstallPromisesRef.current.set(kernelId, installPromise);
      return installPromise;
    },
    [detectKernels],
  );

  const slashCommands = useMemo(() => (slash ? filterSlashCommands(slash.query) : []), [slash]);
  const filteredSlashSkills = useMemo(() => {
    if (!slash) return [];
    const query = slash.query.trim().toLocaleLowerCase();
    return slashSkills.filter((skill) => {
      if (!skill.enabled || selectedSkillVersionIds.includes(skill.skillVersionId)) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.skillId, skill.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [selectedSkillVersionIds, slash, slashSkills]);
  const slashItemCount = slashCommands.length + filteredSlashSkills.length;
  const slashOpen = slash !== null;
  const selectedSlashSkills = useMemo(
    () =>
      selectedSkillVersionIds
        .map((skillVersionId) =>
          slashSkills.find((skill) => skill.skillVersionId === skillVersionId),
        )
        .filter((skill): skill is SkillVersionSummary => Boolean(skill)),
    [selectedSkillVersionIds, slashSkills],
  );
  const shouldLoadSlashSkills = slashOpen || selectedSkillVersionIds.length > 0;

  useEffect(() => {
    if (!shouldLoadSlashSkills) return;
    const api = bridge();
    if (!api?.listSkills) return;
    let cancelled = false;
    setSlashSkillsLoading(true);
    void api
      .listSkills(props.workspaceId ? { workspaceId: props.workspaceId as WorkspaceId } : undefined)
      .then((result) => {
        if (!cancelled) setSlashSkills(result.skills ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlashSkills([]);
      })
      .finally(() => {
        if (!cancelled) setSlashSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceId, shouldLoadSlashSkills]);

  useLayoutEffect(() => {
    if (!slashOpen) return;
    keepListboxOptionVisible(slashListRef.current, slashIndex);
  }, [slashIndex, slashItemCount, slashOpen]);

  const updatePickersFromCaret = useCallback((text: string, caret: number) => {
    const mention = detectMentionQuery(text, caret);
    if (mention) {
      setAtQuery(mention);
      setSlash(null);
      setSlashIndex(0);
      return;
    }
    setAtQuery(null);
    const nextSlash = detectSlashQuery(text, caret);
    setSlash(nextSlash);
    if (!nextSlash) setSlashIndex(0);
  }, []);

  const selectSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (!slash) return;
      const next =
        props.draft.slice(0, slash.slashIndex) +
        `${command.command} ` +
        props.draft.slice(slash.caret);
      props.onDraftChange(next);
      setSlash(null);
      setSlashIndex(0);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(
          slash.slashIndex + command.command.length + 1,
          slash.slashIndex + command.command.length + 1,
        );
      });
    },
    [props, slash],
  );

  const selectSlashSkill = useCallback(
    (skill: SkillVersionSummary) => {
      if (!slash) return;
      const stripped = stripSlashToken(props.draft, slash);
      props.onDraftChange(stripped.text);
      setSelectedSkillVersionIds((current) =>
        resolveAppendSkillVersionIds(draftTrack, [...current, skill.skillVersionId]),
      );
      setSlash(null);
      setSlashIndex(0);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(stripped.caret, stripped.caret);
      });
    },
    [draftTrack, props, slash],
  );

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const remainingSlots = Math.max(
        0,
        8 - attachments.filter((item) => item.kind === 'image').length,
      );
      const list = Array.from(files).filter(isImageFile).slice(0, remainingSlots);
      if (list.length === 0) return;
      const nextItems: ComposeAttachment[] = [];
      for (const file of list) {
        try {
          const rawUrl = await readFileAsDataUrl(file);
          const compressed = await compressImageDataUrl(rawUrl, {
            mimeType: file.type || 'image/png',
          });
          nextItems.push({
            path: `image:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
            name: file.name || 'image',
            kind: 'image',
            previewUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            sizeBytes: Math.floor(
              (compressed.dataUrl.length - compressed.dataUrl.indexOf(',') - 1) * 0.75,
            ),
          });
        } catch {
          setComposeNotice(`图片读取失败：${file.name || '未命名图片'}`);
        }
      }
      if (nextItems.length === 0) return;
      setAttachments((current) => {
        let next = [...current];
        for (const item of nextItems) next = addAttachment(next, item);
        return next.slice(0, 8);
      });
      setComposeNotice(undefined);
    },
    [attachments],
  );

  const handleImageInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) void addImageFiles(files);
      event.target.value = '';
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) return;
      event.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.currentTarget === event.target) setDragOver(false);
  }, []);
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      if (event.dataTransfer.files.length > 0) void addImageFiles(event.dataTransfer.files);
    },
    [addImageFiles],
  );

  const submit = async () => {
    const parsed = parseSlashCommand(props.draft);
    if (parsed.kind === 'plan') {
      setInteractionMode('plan');
      props.onDraftChange('');
      setSlash(null);
      setComposeNotice(undefined);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return false;
    }
    if (parsed.kind === 'execute') {
      setInteractionMode('execute');
      props.onDraftChange('');
      setSlash(null);
      setComposeNotice(undefined);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return false;
    }
    if (parsed.kind === 'compact' || parsed.kind === 'compact-with-trailing') {
      setComposeNotice('新对话还没有可压缩的上下文');
      return false;
    }
    if (
      parsed.kind === 'goal' ||
      parsed.kind === 'goal-with-condition' ||
      parsed.kind === 'goal-clear'
    ) {
      setComposeNotice('先发送第一条消息，再为对话设置目标');
      return false;
    }
    if (parsed.kind === 'unknown') {
      setComposeNotice(`未知命令：${parsed.command}`);
      return false;
    }

    const text = parsed.kind === 'plan-with-request' ? parsed.request : props.draft;
    const modeForTurn = parsed.kind === 'plan-with-request' ? 'plan' : interactionMode;
    const skillVersionIds = resolveAppendSkillVersionIds(draftTrack, selectedSkillVersionIds);
    const sent = await props.onSend({
      text,
      images: messageImagesFromAttachments(attachments),
      modelId: selectedModel?.modelId ?? '',
      kernelId: kernelOverride,
      interactionMode: modeForTurn,
      permissionMode,
      reasoningEffort,
      networkEnabled,
      skillVersionIds,
    });
    if (sent) {
      setAttachments([]);
      setComposeNotice(undefined);
    }
    return sent;
  };

  const changeNetworkSetting = (enabled: boolean) => {
    setNetworkEnabled(enabled);
    if (!atQuery) return;
    const stripped = stripMentionToken(props.draft, atQuery);
    props.onDraftChange(stripped.text);
    setAtQuery(null);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(stripped.caret, stripped.caret);
    });
  };

  const dismissNetworkSetting = () => {
    setAtQuery(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="shell-chat-column flex min-h-0 flex-1 flex-col bg-chat">
      <div className="shell-welcome flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
        <div className="flex flex-col items-center gap-1.5">
          <h2
            data-testid="welcome-greeting"
            className="shell-welcome-title m-0 text-[26px] font-semibold tracking-tight text-text"
          >
            {props.hasWorkspace ? greeting : '先打开一个工作区'}
          </h2>
          <p className="shell-welcome-subtitle m-0 text-[13px] text-text-faint">
            {props.hasWorkspace ? '今天想做什么？' : '在顶栏打开文件夹或新建工作区后即可对话'}
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
        <div
          className="shell-chat-content-wrap shrink-0 pb-4 pt-2"
          data-testid="empty-compose-wrap"
        >
          <div className="shell-chat-content mx-auto">
            <div
              className={`shell-compose relative ${dragOver ? 'is-dragover' : ''}`}
              data-testid="empty-compose"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {slash ? (
                <div
                  ref={slashListRef}
                  className="shell-mention-pop shell-slash-pop shell-empty-slash-pop"
                  data-testid="empty-compose-slash-pop"
                  role="listbox"
                  aria-label="斜杠命令"
                >
                  <div className="shell-slash-pop__section">命令</div>
                  {slashCommands.length === 0 ? (
                    <div className="shell-mention-pop__empty">无匹配命令</div>
                  ) : (
                    slashCommands.map((command, index) => (
                      <button
                        key={command.id}
                        type="button"
                        role="option"
                        aria-selected={index === slashIndex}
                        className={`shell-mention-pop__item shell-slash-pop__item ${
                          index === slashIndex ? 'is-active' : ''
                        }`}
                        onMouseEnter={() => setSlashIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectSlashCommand(command);
                        }}
                      >
                        <span className="shell-slash-pop__cmd">{command.command}</span>
                        <span className="shell-slash-pop__meta">
                          <span className="shell-slash-pop__label">{command.label}</span>
                          <span className="shell-slash-pop__desc">{command.description}</span>
                        </span>
                      </button>
                    ))
                  )}
                  <div className="shell-slash-pop__section">Skill</div>
                  {slashSkillsLoading ? (
                    <div className="shell-mention-pop__empty">正在读取已启用 Skill…</div>
                  ) : filteredSlashSkills.length === 0 ? (
                    <div className="shell-mention-pop__empty">没有匹配的已启用 Skill</div>
                  ) : (
                    filteredSlashSkills.map((skill, skillIndex) => {
                      const index = slashCommands.length + skillIndex;
                      return (
                        <button
                          key={skill.skillVersionId}
                          type="button"
                          role="option"
                          aria-selected={index === slashIndex}
                          className={`shell-mention-pop__item shell-slash-pop__item ${
                            index === slashIndex ? 'is-active' : ''
                          }`}
                          onMouseEnter={() => setSlashIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectSlashSkill(skill);
                          }}
                        >
                          <span className="shell-slash-pop__cmd">/{skill.name}</span>
                          <span className="shell-slash-pop__meta">
                            <span className="shell-slash-pop__label">{skill.name}</span>
                            <span className="shell-slash-pop__desc">
                              {skill.description || `v${skill.version}`}
                            </span>
                          </span>
                          <span className="shell-slash-pop__badge">Skill</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}

              {attachments.length > 0 ? (
                <div className="shell-compose__chips" data-testid="empty-compose-attachments">
                  {attachments.map((image) => (
                    <div
                      key={image.path}
                      className="shell-attach-chip"
                      data-kind="image"
                      title={image.name}
                    >
                      {image.previewUrl ? (
                        <span className="shell-attach-chip__thumb" aria-hidden="true">
                          <img src={image.previewUrl} alt="" />
                        </span>
                      ) : null}
                      <span className="shell-attach-chip__name">{image.name}</span>
                      <button
                        type="button"
                        className="shell-attach-chip__remove"
                        aria-label={`移除图片 ${image.name}`}
                        onClick={() =>
                          setAttachments((current) => removeAttachment(current, image.path))
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedSlashSkills.length > 0 ? (
                <div
                  className="shell-compose__selected-skills"
                  data-testid="empty-compose-selected-skills"
                >
                  {selectedSlashSkills.map((skill) => (
                    <span
                      key={skill.skillVersionId}
                      className="shell-compose__selected-skill"
                      title={`${skill.name} · v${skill.version}`}
                    >
                      <Puzzle size={13} aria-hidden="true" />
                      <span>{skill.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={inputRef}
                data-testid="empty-compose-input"
                className="shell-compose__input"
                placeholder="输入消息…（输入 / 打开快捷面板）"
                value={props.draft}
                onChange={(event) => {
                  props.onDraftChange(event.target.value);
                  setComposeNotice(undefined);
                  updatePickersFromCaret(
                    event.target.value,
                    event.target.selectionStart ?? event.target.value.length,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && slash) {
                    event.preventDefault();
                    setSlash(null);
                    setSlashIndex(0);
                    return;
                  }
                  if (slash && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault();
                    setSlashIndex((index) => {
                      if (slashItemCount === 0) return 0;
                      return event.key === 'ArrowDown'
                        ? (index + 1) % slashItemCount
                        : (index - 1 + slashItemCount) % slashItemCount;
                    });
                    return;
                  }
                  if (slash && (event.key === 'Enter' || event.key === 'Tab')) {
                    const selectedCommand = slashCommands[slashIndex];
                    const selectedSkill = filteredSlashSkills[slashIndex - slashCommands.length];
                    if (selectedCommand || selectedSkill) {
                      event.preventDefault();
                      if (selectedCommand) selectSlashCommand(selectedCommand);
                      else if (selectedSkill) selectSlashSkill(selectedSkill);
                      return;
                    }
                  }
                  if (event.key === 'Escape' && atQuery) {
                    event.preventDefault();
                    setAtQuery(null);
                    return;
                  }
                  if (event.key === 'Tab' && atQuery) {
                    const segments = networkSettingRef.current?.querySelectorAll<HTMLButtonElement>(
                      '.shell-mention-setting__segment',
                    );
                    const target = segments?.[event.shiftKey ? segments.length - 1 : 0];
                    if (target) {
                      event.preventDefault();
                      target.focus();
                      return;
                    }
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                onPaste={handlePaste}
                onClick={(event) =>
                  updatePickersFromCaret(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart ?? 0,
                  )
                }
                onSelect={(event) =>
                  updatePickersFromCaret(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart ?? 0,
                  )
                }
                rows={1}
                disabled={props.sending}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="shell-compose__file-input"
                data-testid="empty-compose-image-input"
                onChange={handleImageInputChange}
                tabIndex={-1}
              />
              <ComposeAtSettingsMenu
                open={Boolean(atQuery)}
                enabled={networkEnabled}
                anchorEl={inputRef.current}
                networkSettingRef={networkSettingRef}
                onClose={() => setAtQuery(null)}
                onDismiss={dismissNetworkSetting}
                onChange={changeNetworkSetting}
              />
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  <button
                    type="button"
                    className="shell-compose__icon-tool"
                    aria-label="添加图片"
                    title="添加图片"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={props.sending || attachments.length >= 8}
                  >
                    <ImagePlus size={15} />
                  </button>
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
                        {PERMISSION_OPTIONS.find((option) => option.value === permissionMode)
                          ?.title ?? '完全访问'}
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
                  <TurnSkillControl
                    owner={skillOwner}
                    workspaceId={props.workspaceId}
                    open={skillMenuOpen}
                    selectedSkillVersionIds={selectedSkillVersionIds}
                    onOpenChange={setSkillMenuOpen}
                    onChange={updateSelectedSkillVersionIds}
                  />
                  {interactionMode === 'plan' ? (
                    <button
                      type="button"
                      className="shell-compose__tool shell-compose__mode-badge"
                      data-mode="plan"
                      data-testid="empty-compose-mode"
                      title="规划模式 · 点击切换到执行模式"
                      onClick={() => setInteractionMode('execute')}
                    >
                      <Compass size={14} aria-hidden="true" />
                      <span className="shell-compose__tool-label">规划</span>
                    </button>
                  ) : null}
                </div>
                <div className="shell-compose__bar-right">
                  <ContextRing
                    used={Math.round(props.draft.length / 4)}
                    limit={
                      (typeof selectedModel?.contextWindow === 'number' &&
                      selectedModel.contextWindow > 0
                        ? selectedModel.contextWindow
                        : undefined) ||
                      estimateContextWindow(selectedModel?.displayName || selectedModel?.modelId)
                    }
                  />
                  <div className="shell-compose__tool-wrap">
                    <ModelTrigger
                      label={selectedModel?.displayName ?? '选择模型'}
                      reasoningLabel={REASONING_LABELS[reasoningEffort]}
                      open={modelMenuOpen}
                      buttonRef={modelButtonRef}
                      onClick={() => setModelMenuOpen((value) => !value)}
                    />
                    {kernelOverride !== 'native'
                      ? (() => {
                          const label = resolveKernelDisplayName(
                            kernelOverride,
                            activeKernel?.name,
                          );
                          const logo = resolveKernelBrandLogo(
                            activeKernel ? activeKernel.icon : kernelOverride,
                          );
                          return (
                            <span
                              className={`shell-kernel-chip${logo ? ' shell-kernel-chip--logo' : ''}`}
                              data-testid="empty-compose-kernel-chip"
                              title={`内核：${label}`}
                            >
                              {logo ? <BrandLogoMark logo={logo} size={14} /> : label}
                            </span>
                          );
                        })()
                      : null}
                    <ModelPickerMenu
                      open={modelMenuOpen}
                      models={props.models}
                      selectedModelId={selectedModel?.modelId ?? ''}
                      defaultLabel="选择模型"
                      reasoningEffort={reasoningEffort}
                      kernels={kernelRegistry ?? undefined}
                      selectedKernelId={kernelOverride}
                      kernelInstallStates={kernelInstallStates}
                      anchorEl={modelButtonRef.current}
                      onClose={() => setModelMenuOpen(false)}
                      onInstallKernel={(kernelId) => void installKernel(kernelId)}
                      onPickKernel={(kernelId) => {
                        setKernelOverride(kernelId);
                        writeNewConversationKernel(kernelId);
                      }}
                      onPick={props.onModelChange}
                      onReasoningChange={setReasoningEffort}
                    />
                  </div>
                  <button
                    type="button"
                    className="shell-compose__send"
                    onClick={() => void submit()}
                    disabled={(!props.draft.trim() && attachments.length === 0) || props.sending}
                    title="发送 (Enter)"
                    data-testid="empty-compose-send"
                  >
                    <SendHorizonal size={15} />
                  </button>
                </div>
              </div>
              {props.error || composeNotice ? (
                <div className="px-3 pb-2 text-[11.5px] text-error" role="alert">
                  {props.error ?? composeNotice}
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

  const clampDrag = useCallback((dx: number, dy: number) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const compact = viewportWidth <= 900 || viewportHeight <= 650;
    const viewportInset = compact ? 24 : 48;
    const modalWidth = Math.min(1060, Math.max(compact ? 0 : 760, viewportWidth - viewportInset));
    const modalHeight = Math.min(720, Math.max(compact ? 0 : 520, viewportHeight - viewportInset));
    const maxDx = Math.max(0, (viewportWidth - modalWidth) / 2 - 4);
    const maxDy = Math.max(0, (viewportHeight - modalHeight) / 2 - 4);
    return {
      dx: Math.round(Math.min(Math.max(dx, -maxDx), maxDx)),
      dy: Math.round(Math.min(Math.max(dy, -maxDy), maxDy)),
    };
  }, []);

  // Restore the last dragged position (session-local convenience; keep in-memory if storage is unavailable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sync-think-settings-pos');
      if (raw) {
        const pos = JSON.parse(raw) as { dx?: number; dy?: number };
        if (typeof pos.dx === 'number' && typeof pos.dy === 'number') {
          setDragOffset(clampDrag(pos.dx, pos.dy));
        }
      }
    } catch {
      /* ignore storage failures */
    }
  }, [clampDrag]);

  useEffect(() => {
    const clampCurrentPosition = () => {
      setDragOffset((current) => (current ? clampDrag(current.dx, current.dy) : current));
    };
    window.addEventListener('resize', clampCurrentPosition);
    return () => window.removeEventListener('resize', clampCurrentPosition);
  }, [clampDrag]);

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
