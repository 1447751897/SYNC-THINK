// New shell root — NewMax visual constitution (S3 / D3 first cut).
// Sidebar top actions + three tracks with groups · workspace tabs (no 全部) ·
// welcome empty state · settings modal.
import { reviewViewKey, conversationReviewFromKey, type ReviewView } from './review-view.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, MessageSquare, Users, Zap, X } from 'lucide-react';
import { isKernelExecutionSupported, kernelExecutionUnavailableReason } from '@sync-think/shared';
import type {
  Conversation,
  ConversationTrack,
  Event,
  GlobalAgent,
  KernelDetectionResult,
  Team,
  WorkspaceId,
} from '@sync-think/shared';
import type { WorkspaceSummary, SkillVersionSummary } from '@sync-think/protocol';
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
import type { WorkbenchNewResource } from './WorkspaceWorkbench.js';
import { emptyExcalidrawContent } from './ExcalidrawPreview.js';
import { ChatView, type RuntimeConnectionNotice } from './ChatView.js';
import {
  clearFilePaneSession,
  isFilePaneSessionDirty,
  type FileRevealTarget,
} from './FilePane.js';
import { collectOpenFilePaths, createUntitledProjectFile } from './untitled-project-file.js';
import { WorkspaceFileView } from './WorkspaceFileView.js';
import { TerminalPane } from './TerminalPane.js';
import { disposeTerminalSession } from './terminal-session-store.js';
import { BrowserPanel } from './BrowserPanel.js';
import { ReviewPanel, WorkspaceFilesPanel } from './RightDock.js';
import type { AbilityCenterInitialView } from './AbilitiesPage.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { lazyPanel } from './lazy-panel.js';
import {
  emptyPaneRetainedSurfaces,
  rememberRetainedKey,
  RETAINED_CONVERSATION_LIMIT,
  RETAINED_FILE_LIMIT,
  RETAINED_REVIEW_LIMIT,
  RETAINED_TERMINAL_LIMIT,
  shouldMountRetainedSurface,
  type PaneRetainedSurfaces,
} from './surface-keep-alive.js';
import type { BrowserWorkflowAiTaskRequest } from './BrowserWorkflowPanel.js';
import type { ConnectionTab, SettingsSection } from './SettingsPage.js';
import type { ModelSettingsDetailView } from './ModelSettings.js';
import { FirstLaunchGuide } from './FirstLaunchGuide.js';
import {
  ComposerActionSlot,
  ContextRing,
  estimateContextWindow,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  SKILL_COLLAPSED_TOOLBAR_LEVEL,
  useComposerToolbarCollapse,
  type KernelInstallState,
  type IdentityOption,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import {
  applyManagedKernelSnapshotToInstallStates,
  useManagedKernelUpdateSync,
} from './managed-kernel-sync.js';
import {
  addAttachment,
  buildMessageWithAttachments,
  detectMentionQuery,
  fileNameFromPath,
  isImageFile,
  messageImagesFromAttachments,
  readFileAsDataUrl,
  removeAttachment,
  type ComposeAttachment,
  type MessageImage,
} from './compose-mention.js';
import {
  detectSlashQuery,
  filterSlashCommands,
  parseComposerModeKeywordHint,
  parseSlashCommand,
  replaceSlashTokenWithCommand,
  stripSlashToken,
  withComposerModeKeywordHint,
  withComposerModeCommand,
  withoutComposerModeCommand,
  type SlashCommand,
  type SlashQuery,
} from './compose-slash.js';
import {
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
} from './compose-skill-selection.js';
import { compressImageDataUrl } from './image-compress.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { ComposerEditor } from './ComposerEditor.js';
import {
  PromptEnhancementAction,
  tryHandlePromptEnhancementShortcut,
  usePromptEnhancement,
  usePromptEnhancementShortcutEnabled,
} from './prompt-enhancement.js';
import { ComposerMcpMenu } from './ComposerMcpMenu.js';
import { ComposerModeBanner } from './ComposerModeBanner.js';
import { ComposerActiveModePill, ComposerModeKeywordHint } from './ComposerModeControls.js';
import {
  ComposerSlashMenu,
  resolveComposerSlashMenuKeyboardAction,
  type ComposerSkillCategory,
  type ComposerSlashMenuResolvedItem,
} from './ComposerSlashMenu.js';
import {
  GoalRiskConfirmationDialog,
  GoalSettingsDialog,
  goalRequiresRiskConfirmation,
  type GoalSettingsValues,
} from './GoalSettingsDialog.js';
import { NewMaxComposerFrame } from './NewMaxComposerFrame.js';
import { ComposerAddControl } from './ComposerAddMenu.js';
import { TipsCarousel } from './TipsCarousel.js';
import { HomeScenarios } from './HomeScenarios.js';
import {
  parseComposerPlanActSetting,
  resolveComposerModelSelection,
  type ComposerPlanActSetting,
} from './composer-plan-model.js';
import { keepListboxOptionVisible } from './compose-picker-scroll.js';
import { canCloseSettings } from './settings-unsaved.js';
import { NewConversationDialog, type ModelOption } from './NewConversationDialog.js';
import { useDialog, DialogProvider } from './Dialog.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import {
  hasShellBootSnapshot,
  readShellBootSnapshot,
  writeShellBootSnapshot,
} from './shell-boot-snapshot.js';
import type { HtmlBrowserOpenOptions } from './html-browser.js';
import {
  matchesShortcut,
  readAppearancePreferences,
  readShortcutPreferences,
} from './preferences-store.js';
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
  targetName,
  toggleConversationGroupCollapsed,
  toggleSidebar,
  toggleTrack,
  type ShellNavState,
  type ShellStage,
} from './shell-state.js';
import {
  AGENT_PREFERENCES_CHANGED_EVENT,
  CONVERSATION_KERNEL_OVERRIDES_CHANGED_EVENT,
  readActiveWorkspaceId,
  readAgentPreferences,
  readConversationGroups,
  readDefaultPermission,
  readLastConversationTrack,
  readNewConversationDraft,
  readNewConversationKernel,
  readNewConversationModel,
  readConversationKernelOverrides,
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
  activateTerminalPaneTab,
  closeBrowserPaneTab,
  closeReviewPaneTab,
  closeFilePaneTab,
  closeConversationInLayout,
  closePane,
  closePaneTab,
  closeTerminalPaneTab,
  createWorkspacePaneLayout,
  focusPane,
  focusedConversationId,
  layoutHasOpenTabs,
  migrateLegacyPaneLayouts,
  movePaneResourceToPane,
  openBrowserInPane,
  openFileInPane,
  openConversationInPane,
  openTerminalInPane,
  paneConversationIds,
  paneKeepAliveBrowserId,
  paneKeepAliveConversationId,
  pruneWorkspacePaneLayout,
  replaceConversationInPane,
  reorderPaneTabs,
  setSplitRatio,
  splitPaneWithConversation,
  splitPaneWithResource,
  updateTerminalPaneCwd,
  type PaneResourceRef,
  type PaneSplitDirection,
  type WorkspacePaneLayout,
  type WorkspacePaneLayouts,
} from './pane-layout.js';
import {
  activateWorkbenchTab,
  browserWorkbenchTab,
  closeWorkbenchConversation,
  closeWorkbenchTab,
  conversationWorkbenchTab,
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  findWorkbenchBrowserByUrl,
  findWorkbenchConversation,
  MAX_TERMINAL_SESSIONS,
  openOrFocusWorkbenchBrowser,
  openWorkbenchTab,
  replaceWorkbenchConversation,
  reviewWorkbenchTab,
  setWorkbenchFileBrowserOpen,
  setWorkbenchFileBrowserWidth,
  setWorkbenchOpen,
  setWorkbenchSize,
  terminalWorkbenchTab,
  toggleWorkspaceFilesWorkbench,
  updateWorkbenchBrowserUrl,
  workspaceFilesWorkbenchTab,
  type WorkbenchPlacement,
  type WorkbenchTab,
  type WorkspaceWorkbenchLayout,
  type WorkspaceWorkbenchLayouts,
} from './workspace-workbench.js';

const WorkspaceWorkbench = lazyPanel(
  async () => ({ default: (await import('./WorkspaceWorkbench.js')).WorkspaceWorkbench }),
  '工作台',
  'WorkspaceWorkbench',
);
const AgentLibrary = lazyPanel(
  async () => ({ default: (await import('./AgentLibrary.js')).AgentLibrary }),
  '智能体',
  'AgentLibrary',
);
const TeamLibrary = lazyPanel(
  async () => ({ default: (await import('./TeamLibrary.js')).TeamLibrary }),
  '团队',
  'TeamLibrary',
);
const BrowserStage = lazyPanel<{ onStartAiTask?(request: BrowserWorkflowAiTaskRequest): void }>(
  async () => ({ default: (await import('./BrowserStage.js')).BrowserStage }),
  '浏览器',
  'BrowserStage',
);
const AbilitiesPage = lazyPanel(
  async () => ({ default: (await import('./AbilitiesPage.js')).AbilitiesPage }),
  '能力中心',
  'AbilitiesPage',
);
const TaskPanel = lazyPanel(
  async () => ({ default: (await import('./TaskPanel.js')).TaskPanel }),
  '任务',
  'TaskPanel',
);
const ActivityCenterPage = lazyPanel(
  async () => ({ default: (await import('./ActivityCenterPage.js')).ActivityCenterPage }),
  '活动中心',
  'ActivityCenterPage',
);
const SettingsPage = lazyPanel(
  async () => ({ default: (await import('./SettingsPage.js')).SettingsPage }),
  '设置',
  'SettingsPage',
);

interface ShellData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  modelNames: Map<string, string>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
  skills: SkillVersionSummary[];
}

type WorkspaceChromeFocus = 'primary' | 'right' | 'bottom';

function resolveProjectRelativePath(root: string, relativePath: string): string {
  const normalizedRoot = root.trim().replace(/[\\/]+$/, '');
  const separator = normalizedRoot.includes('\\') ? '\\' : '/';
  return `${normalizedRoot}${separator}${relativePath.replace(/[\\/]+/g, separator)}`;
}

function isSafeProjectRelativePath(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  return /\.html?$/i.test(normalized);
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
  helpMode?: boolean;
  goalCondition?: string;
  goalSettings?: GoalSettingsValues;
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
  return false;
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
  const lastTrackRef = useRef(nav.lastTrack);
  lastTrackRef.current = nav.lastTrack;
  const ensureDefaultDraftRef = useRef<(workspaceId: string) => void>(() => {});
  const [data, setData] = useState<ShellData>(() => readShellBootSnapshot() ?? EMPTY);
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
  const navigationRequestSequenceRef = useRef(0);
  const [settingsNavigation, setSettingsNavigation] = useState<{
    initialSection?: SettingsSection;
    initialModelDetail?: ModelSettingsDetailView;
    initialConnectionTab?: ConnectionTab;
    navigationKey: number;
  }>(() => ({ navigationKey: 0 }));
  const [abilityNavigation, setAbilityNavigation] = useState<{
    initialView: AbilityCenterInitialView;
    navigationKey: number;
  }>();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(() =>
    readActiveWorkspaceId(),
  );
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>(() =>
    hasShellBootSnapshot(readShellBootSnapshot()) ? 'ready' : 'loading',
  );
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
  const paneLayoutsRef = useRef(paneLayouts);
  paneLayoutsRef.current = paneLayouts;
  const [workbenchLayouts, setWorkbenchLayouts] = useState<WorkspaceWorkbenchLayouts>(() =>
    readWorkspaceWorkbenchLayouts(),
  );
  const [workspaceChromeFocus, setWorkspaceChromeFocus] = useState<WorkspaceChromeFocus>('primary');
  const workbenchLayoutsRef = useRef(workbenchLayouts);
  workbenchLayoutsRef.current = workbenchLayouts;
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
  const [kernelOverrides, setKernelOverrides] = useState(() => readConversationKernelOverrides());
  useEffect(() => {
    const sync = () => setKernelOverrides(readConversationKernelOverrides());
    window.addEventListener(CONVERSATION_KERNEL_OVERRIDES_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CONVERSATION_KERNEL_OVERRIDES_CHANGED_EVENT, sync);
  }, []);
  /** Latest run with file changes, reported up from the active ChatView for review surfaces. */
  const [latestReviewView, setLatestReviewView] = useState<ReviewView | null>(null);
  const [reviewViewsByRunId, setReviewViewsByRunId] = useState<Map<string, ReviewView>>(
    () => new Map(),
  );
  const handleLatestReviewChange = useCallback((view: ReviewView | null) => {
    setLatestReviewView(view);
    if (!view) return;
    const runId = reviewViewKey(view);
    setReviewViewsByRunId((current) => {
      if (current.get(runId) === view) return current;
      const next = new Map(current);
      next.set(runId, view);
      return next;
    });
  }, []);
  /** AI browser_open → open or focus a matching right-workbench browser, never rewrite another page. */
  const [aiBrowserNav, setAiBrowserNav] = useState<{
    browserId: string;
    url: string;
    seq: number;
  } | null>(null);
  const [browserPageMeta, setBrowserPageMeta] = useState<
    Record<string, { title?: string; favicon?: string }>
  >({});
  const handleBrowserPageMeta = useCallback(
    (browserId: string, meta: { title?: string; favicon?: string }) => {
      setBrowserPageMeta((current) => {
        const prev = current[browserId];
        if (prev?.title === meta.title && prev?.favicon === meta.favicon) return current;
        return { ...current, [browserId]: { title: meta.title, favicon: meta.favicon } };
      });
    },
    [],
  );
  const lastConversationIdByPaneRef = useRef(new Map<string, string>());
  const lastBrowserIdByPaneRef = useRef(new Map<string, string>());
  const retainedSurfacesByPaneRef = useRef(new Map<string, PaneRetainedSurfaces>());
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
        if (layout === currentLayout) return current;
        const next = { ...current, [workspaceId]: layout };
        workbenchLayoutsRef.current = next;
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
        const found = findWorkbenchConversation(
          workbenchLayoutsRef.current[ws] ?? createWorkspaceWorkbenchLayout(),
          conversationId,
        );
        if (found) {
          commitWorkbenchLayout(ws, (current) =>
            activateWorkbenchTab(current, found.placement, found.tab.id),
          );
        } else {
          commitPaneLayout(ws, (current) => openConversationInPane(current, conversationId));
        }
      }
      if (!ws || activeWorkspaceIdRef.current === ws) {
        setNav((n) => openConversation(n, conversationId));
      }
    },
    [commitPaneLayout, commitWorkbenchLayout, data.conversations],
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
      commitWorkbenchLayout(activeWorkspaceId, (current) => {
        const opened = openWorkbenchTab(current, placement, fileWorkbenchTab(path));
        return placement === 'right' ? setWorkbenchFileBrowserOpen(opened, 'right', true) : opened;
      });
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
    (placement: WorkbenchPlacement, view: ReviewView) => {
      if (!activeWorkspaceId) return;
      const runId = reviewViewKey(view);
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
    (_paneId: string, view: ReviewView) => {
      handleOpenReviewInWorkbench('right', view);
    },
    [handleOpenReviewInWorkbench],
  );

  const countOpenTerminals = useCallback(
    (workspaceId: string) => {
      const paneCount = Object.values(paneLayouts[workspaceId]?.panes ?? {}).reduce(
        (count, pane) => count + pane.tabs.filter((tab) => tab.type === 'terminal').length,
        0,
      );
      const workbench = workbenchLayouts[workspaceId];
      const workbenchCount = (workbench?.right.tabs ?? [])
        .concat(workbench?.bottom.tabs ?? [])
        .filter((tab) => tab.type === 'terminal').length;
      return paneCount + workbenchCount;
    },
    [paneLayouts, workbenchLayouts],
  );

  const handleOpenTerminalInPane = useCallback(
    (paneId?: string) => {
      if (!activeWorkspaceId) return;
      if (countOpenTerminals(activeWorkspaceId) >= MAX_TERMINAL_SESSIONS) return;
      const terminalId = createTerminalId();
      commitPaneLayout(activeWorkspaceId, (current) =>
        openTerminalInPane(current, terminalId, '', paneId ?? current.focusedPaneId),
      );
    },
    [activeWorkspaceId, commitPaneLayout, countOpenTerminals],
  );

  const handleOpenBrowserInPane = useCallback(
    (paneId?: string, url = 'about:blank') => {
      if (!activeWorkspaceId) return;
      const browserId = createBrowserId();
      commitPaneLayout(activeWorkspaceId, (current) =>
        openBrowserInPane(current, browserId, url, paneId ?? current.focusedPaneId),
      );
    },
    [activeWorkspaceId, commitPaneLayout],
  );

  const openUntitledProjectFile = useCallback(
    (
      kind: 'document' | 'canvas',
      openIn:
        { type: 'pane'; paneId?: string } | { type: 'workbench'; placement: WorkbenchPlacement },
    ) => {
      if (!activeWorkspaceId) return;
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();
      if (!projectFolder) {
        setNewConversationError(
          kind === 'canvas' ? '新建绘图前请先绑定项目文件夹' : '新建文档前请先绑定项目文件夹',
        );
        return;
      }
      const workbench = workbenchLayouts[activeWorkspaceId];
      const openPaths = collectOpenFilePaths({
        panes: Object.values(paneLayouts[activeWorkspaceId]?.panes ?? {}),
        workbenchTabs: [...(workbench?.right.tabs ?? []), ...(workbench?.bottom.tabs ?? [])],
      });
      const api = window.syncThink?.runtime;
      if (!api?.writeProjectFile) {
        setNewConversationError('文件服务不可用');
        return;
      }
      void createUntitledProjectFile({
        kind,
        openPaths,
        canvasContent: emptyExcalidrawContent(),
        write: async (path, content) => {
          const saved = await api.writeProjectFile({
            root: projectFolder,
            path,
            content,
            expectedMtimeMs: null,
            expectedSize: null,
          });
          return {
            ok: saved.ok,
            conflict: saved.conflict,
            error: saved.error,
            path: saved.path,
          };
        },
      }).then((created) => {
        if ('error' in created) {
          setNewConversationError(created.error);
          return;
        }
        if (openIn.type === 'workbench') {
          commitWorkbenchLayout(activeWorkspaceId, (current) =>
            openWorkbenchTab(current, openIn.placement, fileWorkbenchTab(created.path)),
          );
          return;
        }
        handleOpenFileInPane(openIn.paneId ?? '', created.path);
      });
    },
    [
      activeWorkspaceId,
      commitWorkbenchLayout,
      data.workspaces,
      handleOpenFileInPane,
      paneLayouts,
      workbenchLayouts,
    ],
  );

  const handleNewCanvasInPane = useCallback(
    (paneId?: string) => {
      openUntitledProjectFile('canvas', { type: 'pane', paneId });
    },
    [openUntitledProjectFile],
  );

  const handleNewDocumentInPane = useCallback(
    (paneId?: string) => {
      openUntitledProjectFile('document', { type: 'pane', paneId });
    },
    [openUntitledProjectFile],
  );

  const handleOpenBrowserInWorkbench = useCallback(
    (placement: WorkbenchPlacement, url = 'about:blank') => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openWorkbenchTab(current, placement, browserWorkbenchTab(createBrowserId(), url)),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  const handleOpenHtmlInBrowser = useCallback(
    async (html: string, options: HtmlBrowserOpenOptions = {}) => {
      if (!activeWorkspaceId || !html.trim()) return;

      const api = bridge();
      const projectFolder = data.workspaces
        .find((workspace) => workspace.workspaceId === activeWorkspaceId)
        ?.folderPath?.trim();

      // A conversation can be created before a local project is selected. Keep
      // that existing path usable while project-backed previews use the same
      // tokenized local-page URL as NewMax.
      if (!projectFolder) {
        if (!api?.openHtmlInBrowser) throw new Error('当前对话没有绑定项目，无法打开浏览器预览');
        const result = await api.openHtmlInBrowser(html);
        if (!result.ok) throw new Error(result.error ?? '打开失败');
        return;
      }

      const browserId = createBrowserId();
      const partition = `pane-browser-${browserId}`;
      const relativePath = options.relativePath?.trim() || `designs/ai-preview-${browserId}.html`;
      if (!isSafeProjectRelativePath(relativePath)) {
        throw new Error('浏览器预览路径必须是项目内的 HTML 文件');
      }
      const absolutePath = resolveProjectRelativePath(projectFolder, relativePath);

      if (options.persist !== false) {
        if (!api?.readProjectFile || !api.writeProjectFile) {
          throw new Error('当前环境不支持保存浏览器预览文件');
        }
        const current = await api.readProjectFile({ root: projectFolder, path: relativePath });
        const metadataOnlyError =
          current.errorCode === 'file_too_large' &&
          current.mtimeMs !== null &&
          current.size !== null;
        if (current.error && current.errorCode !== 'file_not_found' && !metadataOnlyError) {
          throw new Error(current.error);
        }
        const saved = await api.writeProjectFile({
          root: projectFolder,
          path: relativePath,
          content: html,
          expectedMtimeMs: current.errorCode === 'file_not_found' ? null : current.mtimeMs,
          expectedSize: current.errorCode === 'file_not_found' ? null : current.size,
        });
        if (!saved.ok) {
          throw new Error(saved.error ?? (saved.conflict ? '文件已在磁盘上发生变化' : '保存失败'));
        }
      }

      if (!api?.createLocalPageUrl) throw new Error('当前环境不支持本地浏览器页面');
      const localPage = await api.createLocalPageUrl({ filePath: absolutePath, partition });
      if (!localPage.ok || !localPage.url) {
        throw new Error(localPage.error ?? '本地浏览器页面创建失败');
      }
      commitPaneLayout(activeWorkspaceId, (current) =>
        openBrowserInPane(current, browserId, localPage.url!, current.focusedPaneId),
      );
    },
    [activeWorkspaceId, commitPaneLayout, data.workspaces],
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

  /** Conversation browser tools open beside the chat on the right workbench. */
  const handleAiBrowserOpen = useCallback(
    (url: string) => {
      if (!activeWorkspaceId) return;
      const currentWorkbench =
        workbenchLayoutsRef.current[activeWorkspaceId] ?? createWorkspaceWorkbenchLayout();
      const existingSame = findWorkbenchBrowserByUrl(currentWorkbench, url);
      const browserId = existingSame?.tab.browserId ?? createBrowserId();
      setAiBrowserNav((current) => ({
        browserId,
        url,
        seq: existingSame ? (current?.seq ?? 0) + 1 : 1,
      }));
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openOrFocusWorkbenchBrowser(current, browserId, url),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
  );

  // AI browser_open tool.completed → open or focus a matching workbench browser.
  // First pass only registers historical events (no auto-navigation on reopen);
  // afterwards each fresh browser_open result opens a new tab when the URL is new.
  const seenBrowserOpenIdsRef = useRef<Set<string>>(new Set());
  const browserNavPrimedRef = useRef(false);
  const seenBrowserRequestIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // The embedded bridge must mount before ChatView tries to execute the
    // request. Open/focus the browser tab as soon as Runtime asks for a
    // navigation; the renderer command executor waits briefly for its guest
    // to attach before running the action.
    for (const event of eventHistory) {
      if (event.type !== 'browser.command_requested') continue;
      const payload = event.payload as {
        requestId?: unknown;
        toolName?: unknown;
        args?: unknown;
        toolCallId?: unknown;
      };
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (!requestId || seenBrowserRequestIdsRef.current.has(requestId)) continue;
      seenBrowserRequestIdsRef.current.add(requestId);
      if (
        payload.toolName !== 'browser_open' ||
        !payload.args ||
        typeof payload.args !== 'object'
      ) {
        continue;
      }
      const url = (payload.args as Record<string, unknown>).url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
      if (typeof payload.toolCallId === 'string' && payload.toolCallId) {
        seenBrowserOpenIdsRef.current.add(payload.toolCallId);
      }
      handleAiBrowserOpen(url);
    }
  }, [eventHistory, handleAiBrowserOpen]);

  useEffect(() => {
    const priming = !browserNavPrimedRef.current;
    browserNavPrimedRef.current = true;
    const pending: { id: string; url: string }[] = [];
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
          pending.push({ id: eventKey, url: parsed.url });
        } else {
          seenBrowserOpenIdsRef.current.add(eventKey);
        }
      } catch {
        seenBrowserOpenIdsRef.current.add(eventKey);
      }
    }
    for (const item of pending) {
      seenBrowserOpenIdsRef.current.add(item.id);
      handleAiBrowserOpen(item.url);
    }
  }, [eventHistory, handleAiBrowserOpen]);

  const handleCloseBrowserTab = useCallback(
    (paneId: string, browserId: string) => {
      if (!activeWorkspaceId) return;
      commitPaneLayout(activeWorkspaceId, (current) =>
        closeBrowserPaneTab(current, paneId, browserId),
      );
      setBrowserPageMeta((current) => {
        if (!(browserId in current)) return current;
        const next = { ...current };
        delete next[browserId];
        return next;
      });
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

  const handleToggleWorkspaceFilesWorkbench = useCallback(() => {
    if (!activeWorkspaceId) return;
    commitWorkbenchLayout(activeWorkspaceId, (current) =>
      toggleWorkspaceFilesWorkbench(current, 'right'),
    );
  }, [activeWorkspaceId, commitWorkbenchLayout]);

  const handleToggleWorkbench = useCallback(
    (placement: WorkbenchPlacement) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkspaceId, (current) => {
        const scope = current[placement];
        if (scope.open) return setWorkbenchOpen(current, placement, false);
        if (scope.tabs.length > 0) return setWorkbenchOpen(current, placement, true);
        if (placement === 'right') {
          return openWorkbenchTab(current, placement, workspaceFilesWorkbenchTab());
        }
        if (countOpenTerminals(activeWorkspaceId) >= MAX_TERMINAL_SESSIONS) return current;
        return openWorkbenchTab(current, placement, terminalWorkbenchTab(createTerminalId()));
      });
    },
    [activeWorkspaceId, commitWorkbenchLayout, countOpenTerminals],
  );

  const handleNewWorkbenchResource = useCallback(
    (placement: WorkbenchPlacement, resource: WorkbenchNewResource) => {
      if (!activeWorkspaceId) return;
      if (resource === 'conversation') return;
      if (resource === 'files') {
        commitWorkbenchLayout(activeWorkspaceId, (current) =>
          toggleWorkspaceFilesWorkbench(current, 'right'),
        );
        return;
      }
      if (resource === 'terminal') {
        if (countOpenTerminals(activeWorkspaceId) >= MAX_TERMINAL_SESSIONS) return;
        commitWorkbenchLayout(activeWorkspaceId, (current) =>
          openWorkbenchTab(current, placement, terminalWorkbenchTab(createTerminalId())),
        );
        return;
      }
      if (resource === 'canvas' || resource === 'document') {
        openUntitledProjectFile(resource, { type: 'workbench', placement });
        return;
      }
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        openWorkbenchTab(current, placement, browserWorkbenchTab(createBrowserId(), 'about:blank')),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout, countOpenTerminals, openUntitledProjectFile],
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
      } else if (
        tab.type === 'conversation' &&
        draftSessionRef.current?.id === tab.conversationId
      ) {
        pendingFirstMessageRef.current = null;
        setDraftSession(null);
        setNewConversationDraft('');
        writeNewConversationDraft('');
        setNewConversationError(undefined);
      }
      commitWorkbenchLayout(activeWorkspaceId, (current) =>
        closeWorkbenchTab(current, placement, tab.id),
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout, data.workspaces, dialog, setDraftSession],
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
      ensureDefaultDraftRef.current(workspaceId);
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
    const conversationsPromise = api.listConversations({ includeArchived: true });
    const extrasPromise = Promise.all([
      api.listGlobalAgents({}),
      api.listTeams(),
      api.listProviders({}),
      api.listWorkspaces({}),
      api.listSkills({}),
    ]);
    const conversations = await conversationsPromise;
    setData((current) => ({
      ...current,
      conversations: conversations.conversations,
    }));
    const [agents, teams, providers, workspaces, skills] = await extrasPromise;
    const modelNames = new Map<string, string>();
    const models: ModelOption[] = [];
    for (const provider of providers.providers) {
      if (provider.enabled === false) continue;
      if (provider.protocol === 'openai-images') continue;
      for (const model of provider.models) {
        if (
          model.capabilities.includes('image-generation') &&
          !model.capabilities.includes('text')
        ) {
          continue;
        }
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
    const nextData = {
      conversations: conversations.conversations,
      agents: agents.agents,
      teams: teams.teams,
      modelNames,
      models,
      workspaces: workspaces.workspaces,
      skills: skills.skills,
    };
    setData(nextData);
    writeShellBootSnapshot(nextData);

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
    const landingId = activeWorkspaceIdRef.current;
    if (landingId) ensureDefaultDraftRef.current(landingId);
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
    if (!hasShellBootSnapshot(readShellBootSnapshot())) setBootState('loading');
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
      workspaceId = activeWorkspaceId,
      workbenchPlacement?: WorkbenchPlacement,
    ): DraftConversationSession | null => {
      if (!workspaceId) {
        setNewConversationError('请先创建或打开一个工作区');
        return null;
      }
      const placeDraft = (draftId: string) => {
        if (workbenchPlacement) {
          commitPaneLayout(workspaceId, (current) => closeConversationInLayout(current, draftId));
          commitWorkbenchLayout(workspaceId, (current) =>
            openWorkbenchTab(current, workbenchPlacement, conversationWorkbenchTab(draftId)),
          );
          return;
        }
        commitWorkbenchLayout(workspaceId, (current) =>
          closeWorkbenchConversation(current, draftId),
        );
        commitPaneLayout(workspaceId, (current) =>
          openConversationInPane(current, draftId, targetPaneId),
        );
      };
      const existing = draftSessionRef.current;
      if (existing?.workspaceId === workspaceId) {
        placeDraft(existing.id);
        setNav((current) => openConversation(current, existing.id));
        return existing;
      }

      draftNonceRef.current += 1;
      const createdAt = new Date().toISOString();
      const draft: DraftConversationSession = {
        id: `draft:${workspaceId}:${createdAt}:${draftNonceRef.current}`,
        workspaceId,
        track,
        targetRef: targetRef?.trim() || undefined,
        createdAt,
      };
      setDraftSession(draft);
      placeDraft(draft.id);
      setNav((current) => openConversation({ ...current, stage: 'talk' }, draft.id));
      return draft;
    },
    [activeWorkspaceId, commitPaneLayout, commitWorkbenchLayout, setDraftSession],
  );

  ensureDefaultDraftRef.current = (workspaceId: string) => {
    if (layoutHasOpenTabs(paneLayoutsRef.current[workspaceId])) return;
    beginDraftConversation(lastTrackRef.current, undefined, undefined, workspaceId);
  };

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
        if (initialKernelId !== 'native') {
          setKernelOverrides((current) => ({
            ...current,
            [createdConversationId]: initialKernelId,
          }));
        }
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
        firstMessage &&
        (firstMessage.goalSettings?.condition.trim() ||
          firstMessage.goalCondition?.trim() ||
          firstMessage.text.trim() ||
          firstMessage.images.length > 0),
      );
      const firstGoalCondition =
        firstMessage?.goalSettings?.condition.trim() || firstMessage?.goalCondition?.trim();
      if (firstMessage && firstGoalCondition) {
        await api.setGoal({
          conversationId: created.conversation.id,
          condition: firstGoalCondition,
          ...(firstMessage.goalSettings
            ? {
                stopCondition: firstMessage.goalSettings.stopCondition,
                maxGoalRounds: firstMessage.goalSettings.maxGoalRounds,
                maxGoalTokens: firstMessage.goalSettings.maxGoalTokens,
              }
            : {}),
          ...(initialModelId
            ? {
                modelId: initialModelId as Parameters<typeof api.setGoal>[0]['modelId'],
              }
            : {}),
          kernelId: initialKernelId as Parameters<typeof api.setGoal>[0]['kernelId'],
          reasoningEffort: firstMessage.reasoningEffort,
          networkEnabled: firstMessage.networkEnabled,
        });
      } else if (firstMessage && hasFirstTurn) {
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
          helpMode: firstMessage.helpMode === true ? true : undefined,
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
        commitWorkbenchLayout(workspaceId, (current) =>
          replaceWorkbenchConversation(current, materializedDraft.id, createdConversationId),
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
      commitWorkbenchLayout,
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
      workbenchPlacement?: WorkbenchPlacement,
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
      const draft = beginDraftConversation(
        t,
        carriedTarget,
        workbenchPlacement ? undefined : targetPaneId,
        undefined,
        workbenchPlacement,
      );
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

  const handleStartBrowserAiTask = useCallback(
    (request: BrowserWorkflowAiTaskRequest) => {
      // Browser AI creation is a real conversation turn: seed the exact
      // tool-directed request into a model chat, then let Runtime execute the
      // existing browser_workflow_create_draft contract and approval flow.
      handleNewConversation('model');
      setNewConversationDraft(request.prompt);
      writeNewConversationDraft(request.prompt);
      setNewConversationError(undefined);
      setNav((current) => ({ ...current, stage: 'talk' }));
    },
    [handleNewConversation],
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
  const workbenchConversationMeta = useMemo(() => {
    const meta: Record<string, { title?: string; track?: ConversationTrack }> = {};
    for (const conversation of visibleConversations) {
      meta[String(conversation.id)] = {
        title: conversation.title,
        track: conversation.track,
      };
    }
    return meta;
  }, [visibleConversations]);

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
  const handleWorkbenchNewResource = useCallback(
    (placement: WorkbenchPlacement, resource: WorkbenchNewResource) => {
      if (resource === 'conversation') {
        handleNewConversation(undefined, undefined, undefined, placement);
        return;
      }
      handleNewWorkbenchResource(placement, resource);
    },
    [handleNewConversation, handleNewWorkbenchResource],
  );
  const handleWorkbenchFileBrowserWidthChange = useCallback(
    (width: number, commit: boolean) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(
        activeWorkspaceId,
        (current) => setWorkbenchFileBrowserWidth(current, 'right', width),
        commit,
      );
    },
    [activeWorkspaceId, commitWorkbenchLayout],
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
        handleToggleWorkbench('right');
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
    handleNewConversation,
    handleToggleWorkbench,
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
  const hasActiveConversationPane = Boolean(
    activePaneLayout &&
    Object.values(activePaneLayout.panes).some((pane) =>
      pane.tabs.some((tab) => tab.id === pane.activeTabId && tab.type === 'conversation'),
    ),
  );
  const shouldRenderWallpaperReadingLayers = !hasOpenPaneTabs || hasActiveConversationPane;
  const mountedConversationPaneIds = useMemo(() => {
    if (!activePaneLayout) return new Set<string>();
    const candidates = Object.values(activePaneLayout.panes)
      .filter((pane) => pane.tabs.some((tab) => tab.type === 'conversation'))
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
    // Re-read local model/kernel overrides so sidebar identity updates immediately
    // after a compose model or kernel switch (without waiting for a full runtime refresh).
    setModelOverrides(readConversationModelOverrides());
    setKernelOverrides(readConversationKernelOverrides());
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

  const nextNavigationRequestKey = useCallback(() => {
    navigationRequestSequenceRef.current += 1;
    return navigationRequestSequenceRef.current;
  }, []);

  const handleOpenModelSettings = useCallback(() => {
    setSettingsNavigation({
      initialSection: 'models',
      navigationKey: nextNavigationRequestKey(),
    });
    setSettingsOpen(true);
  }, [nextNavigationRequestKey]);

  const handleOpenPlanSettings = useCallback(() => {
    setSettingsNavigation({
      initialSection: 'models',
      initialModelDetail: 'plan-act',
      navigationKey: nextNavigationRequestKey(),
    });
    setSettingsOpen(true);
  }, [nextNavigationRequestKey]);

  const handleOpenMcpSettings = useCallback(() => {
    setSettingsNavigation({
      initialSection: 'connection',
      initialConnectionTab: 'mcp',
      navigationKey: nextNavigationRequestKey(),
    });
    setSettingsOpen(true);
  }, [nextNavigationRequestKey]);

  const handleCreateSkill = useCallback(() => {
    setSettingsOpen(false);
    setAbilityNavigation({
      initialView: 'create-skill',
      navigationKey: nextNavigationRequestKey(),
    });
    setNav((current) => selectStage(current, 'abilities'));
  }, [nextNavigationRequestKey]);

  const handleSelectStage = useCallback(
    (stage: ShellStage) => {
      if (stage === 'settings') {
        setSettingsNavigation({
          initialSection: 'general',
          navigationKey: nextNavigationRequestKey(),
        });
        setSettingsOpen(true);
        return;
      }
      if (stage === 'abilities') setAbilityNavigation(undefined);
      setNav((n) => selectStage(n, stage));
    },
    [nextNavigationRequestKey],
  );

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
      helpMode?: boolean;
      goalCondition?: string;
      goalSettings?: GoalSettingsValues;
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
      const goalCondition = options.goalSettings?.condition.trim() || options.goalCondition?.trim();
      if ((!text && !goalCondition && options.images.length === 0) || newConversationSending) {
        return false;
      }
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
        ...(options.helpMode === true ? { helpMode: true } : {}),
        ...(goalCondition ? { goalCondition } : {}),
        ...(options.goalSettings ? { goalSettings: options.goalSettings } : {}),
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

  const handleDraftIdentityPick = useCallback(
    (track: ConversationTrack, targetRef: string) => {
      rememberTrack(track);
      const resolvedTarget =
        track === 'model'
          ? targetRef || newConversationModel || data.models[0]?.modelId || ''
          : targetRef;
      const draft = beginDraftConversation(track, resolvedTarget);
      if (draft) {
        setDraftSession({
          ...draft,
          track,
          targetRef: resolvedTarget || undefined,
        });
      }
      setPickerTrack(null);
    },
    [beginDraftConversation, data.models, newConversationModel, rememberTrack, setDraftSession],
  );

  const emptyTalk = (
    <EmptyTalk
      hasWorkspace={Boolean(activeWorkspaceId)}
      workspaceId={activeWorkspaceId}
      workspaceFolder={activeProjectFolder}
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
        void handleOpenFolder();
      }}
      onPickTrack={handleDraftTrackPick}
      onPickIdentity={handleDraftIdentityPick}
      onOpenPlanSettings={handleOpenPlanSettings}
      onOpenModelSettings={handleOpenModelSettings}
      onOpenMcpSettings={handleOpenMcpSettings}
      onCreateSkill={handleCreateSkill}
    />
  );

  const renderWorkbenchContent = (placement: WorkbenchPlacement, tab: WorkbenchTab) => {
    if (tab.type === 'conversation') {
      const isDraft = tab.conversationId === draftSession?.id;
      const conversation = visibleConversations.find((item) => item.id === tab.conversationId);
      if (isDraft) {
        return (
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            data-testid="workbench-surface-conversation"
          >
            {emptyTalk}
          </div>
        );
      }
      if (!conversation) return null;
      return (
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="workbench-surface-conversation"
        >
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
            seedComposerText={readSeedComposerText(String(conversation.id))}
            onSeedComposerTextConsumed={(conversationId) => {
              seedComposerTextRef.current.delete(conversationId);
            }}
            onTitleUpdated={() => void refresh()}
            onConversationUpdated={handleConversationUpdated}
            onLatestReviewChange={handleLatestReviewChange}
            onOpenFile={(path, location) => handleOpenFileInWorkbench(placement, path, location)}
            onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
            onOpenWebUrl={(url) => handleOpenBrowserInWorkbench(placement, url)}
            onOpenReview={(view) => handleOpenReviewInWorkbench(placement, view)}
            onOpenPlanSettings={handleOpenPlanSettings}
            onOpenMcpSettings={handleOpenMcpSettings}
            onCreateSkill={handleCreateSkill}
          />
        </div>
      );
    }
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
          onDirtyChange={(dirty) => {
            if (activeWorkspaceId) handleFileDirtyChange(activeWorkspaceId, tab.path, dirty);
          }}
        />
      );
    }
    if (tab.type === 'review') {
      return (
        <ReviewPanel
          view={reviewViewsByRunId.get(tab.runId) ?? conversationReviewFromKey(tab.runId)}
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
          workspaceId={activeWorkspaceId}
          title="Terminal"
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
        onNewTab={(url) => handleOpenBrowserInWorkbench(placement, url)}
        onPageMeta={(meta) => {
          handleBrowserPageMeta(tab.browserId, meta);
          if (!activeWorkspaceId) return;
          commitWorkbenchLayout(activeWorkspaceId, (current) =>
            updateWorkbenchBrowserUrl(current, placement, tab.browserId, meta.url),
          );
        }}
        projectFolder={activeProjectFolder}
        partition={`workbench-browser-${tab.browserId}`}
        registerForAutomation
        automationActive={activeWorkbenchLayout?.[placement].activeTabId === tab.id}
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
          kernelOverrides={kernelOverrides}
          groups={groups}
          bootState={bootState}
          bootError={bootError}
          activeWorkspaceId={activeWorkspaceId}
          multiSelect={multiSelect}
          selectedIds={selectedIds}
          conversationActivity={conversationActivityView}
          onSelectStage={handleSelectStage}
          onToggleTrack={(track) => setNav((n) => toggleTrack(n, track))}
          onToggleSidebar={() => setNav((n) => setSidebarCollapsed(n, true))}
          onOpenConversation={(id) => focusConversation(id)}
          onNewConversation={handleNewConversation}
          onNewCanvas={() => void handleNewCanvasInPane(activePaneLayout?.focusedPaneId)}
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
          <div className="shell-stage-stack">
          <KeepAliveLayer
            active={nav.stage === 'talk'}
            className="shell-stage-layer"
            testId="stage-talk"
            preserveLayout
          >
            <div className="shell-workspace-content-frame" data-workspace-content-frame="true">
              <div className="shell-workspace-content-row" data-workspace-content-row="true">
                <div
                  className="shell-workspace-primary-content"
                  data-workspace-primary-content="true"
                  data-workspace-chrome-focus={
                    workspaceChromeFocus === 'primary' ? 'true' : 'false'
                  }
                  onPointerDownCapture={() => setWorkspaceChromeFocus('primary')}
                >
                  {shouldRenderWallpaperReadingLayers ? <WallpaperReadingLayers /> : null}
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
                        const localBrowserTabs = pane.tabs
                          .filter((tab) => tab.type === 'browser')
                          .map((tab) => {
                            const meta = browserPageMeta[tab.browserId];
                            return meta
                              ? { ...tab, title: meta.title, favicon: meta.favicon }
                              : tab;
                          });
                        const localReviewTabs = pane.tabs.filter((tab) => tab.type === 'review');
                        const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
                        const activeFilePath =
                          activeTab?.type === 'file' ? activeTab.path : undefined;
                        const activeTerminalId =
                          activeTab?.type === 'terminal' ? activeTab.terminalId : undefined;
                        const activeBrowserId =
                          activeTab?.type === 'browser' ? activeTab.browserId : undefined;
                        const activeReviewRunId =
                          activeTab?.type === 'review' ? activeTab.runId : undefined;
                        if (activeTab?.type === 'conversation') {
                          lastConversationIdByPaneRef.current.set(
                            pane.id,
                            activeTab.conversationId,
                          );
                        }
                        if (activeTab?.type === 'browser') {
                          lastBrowserIdByPaneRef.current.set(pane.id, activeTab.browserId);
                        }
                        const retainedSurfaces =
                          retainedSurfacesByPaneRef.current.get(pane.id) ??
                          emptyPaneRetainedSurfaces();
                        if (
                          activeTab?.type === 'conversation' &&
                          activeTab.conversationId !== draftSession?.id
                        ) {
                          retainedSurfaces.conversations = rememberRetainedKey(
                            retainedSurfaces.conversations,
                            activeTab.conversationId,
                            RETAINED_CONVERSATION_LIMIT,
                          );
                        } else if (activeTab?.type === 'file') {
                          retainedSurfaces.files = rememberRetainedKey(
                            retainedSurfaces.files,
                            activeTab.path,
                            RETAINED_FILE_LIMIT,
                          );
                        } else if (activeTab?.type === 'terminal') {
                          retainedSurfaces.terminals = rememberRetainedKey(
                            retainedSurfaces.terminals,
                            activeTab.terminalId,
                            RETAINED_TERMINAL_LIMIT,
                          );
                        } else if (activeTab?.type === 'review') {
                          retainedSurfaces.reviews = rememberRetainedKey(
                            retainedSurfaces.reviews,
                            activeTab.runId,
                            RETAINED_REVIEW_LIMIT,
                          );
                        }
                        retainedSurfacesByPaneRef.current.set(pane.id, retainedSurfaces);
                        const retainedConversationIds = retainedSurfaces.conversations.filter(
                          (id) => localConversationIds.includes(id) && id !== draftSession?.id,
                        );
                        const keepAliveConversationId = paneKeepAliveConversationId(
                          pane,
                          lastConversationIdByPaneRef.current.get(pane.id),
                        );
                        const keepAliveBrowserId = paneKeepAliveBrowserId(
                          pane,
                          lastBrowserIdByPaneRef.current.get(pane.id),
                        );
                        const conversationSurfaceActive = activeTab?.type === 'conversation';
                        const isDraftConversation =
                          conversationSurfaceActive && keepAliveConversationId === draftSession?.id;
                        const conversation = keepAliveConversationId
                          ? visibleConversations.find((item) => item.id === keepAliveConversationId)
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
                        const draggingFromThisPane = Boolean(
                          tabDragResource &&
                          pane.tabs.some((tab) => paneTabMatchesResource(tab, tabDragResource)),
                        );
                        return (
                          <div
                            className="shell-pane-frame relative flex min-h-0 flex-1 flex-col overflow-hidden"
                            data-pane-shell="true"
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
                              showAddButton={workspaceChromeFocus === 'primary' && focused}
                              conversations={conversationsForPane}
                              openIds={localConversationIds}
                              activeId={conversationSurfaceActive ? conversation?.id : undefined}
                              fileTabs={localFileTabs}
                              activeFilePath={activeFilePath}
                              terminalTabs={localTerminalTabs}
                              activeTerminalId={activeTerminalId}
                              browserTabs={localBrowserTabs}
                              activeBrowserId={activeBrowserId}
                              reviewTabs={localReviewTabs}
                              activeReviewRunId={activeReviewRunId}
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
                              onNewCanvas={() => void handleNewCanvasInPane(pane.id)}
                              onNewDocument={() => void handleNewDocumentInPane(pane.id)}
                              onSelectReview={(runId) => handleActivateReviewTab(pane.id, runId)}
                              onCloseReview={(runId) => handleCloseReviewTab(pane.id, runId)}
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
                            <div
                              className="shell-pane-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden"
                              data-surface={activeTab?.type ?? 'empty'}
                            >
                              {isDraftConversation ? (
                                <div
                                  className="shell-pane-surface"
                                  data-surface="conversation"
                                  data-active={conversationSurfaceActive ? 'true' : 'false'}
                                  data-testid="pane-surface-conversation"
                                >
                                  {emptyTalk}
                                </div>
                              ) : null}
                              {shouldMountConversation
                                ? visibleConversations
                                    .filter((item) => {
                                      const id = String(item.id);
                                      return (
                                        id !== draftSession?.id &&
                                        localConversationIds.includes(id) &&
                                        shouldMountRetainedSurface(
                                          id,
                                          conversationSurfaceActive &&
                                            keepAliveConversationId === id,
                                          retainedConversationIds,
                                        )
                                      );
                                    })
                                    .sort((left, right) => {
                                      const leftActive =
                                        conversationSurfaceActive &&
                                        keepAliveConversationId === left.id;
                                      const rightActive =
                                        conversationSurfaceActive &&
                                        keepAliveConversationId === right.id;
                                      if (leftActive === rightActive) return 0;
                                      return leftActive ? 1 : -1;
                                    })
                                    .map((item) => {
                                      const conversationActive =
                                        conversationSurfaceActive &&
                                        keepAliveConversationId === item.id;
                                      return (
                                        <div
                                          key={item.id}
                                          className="shell-pane-surface"
                                          data-surface="conversation"
                                          data-active={conversationActive ? 'true' : 'false'}
                                          data-testid={
                                            conversationActive
                                              ? 'pane-surface-conversation'
                                              : `pane-surface-conversation-${item.id}`
                                          }
                                        >
                                          <ChatView
                                            conversation={item}
                                            modelName={resolveTargetName(item)}
                                            models={data.models}
                                            agents={data.agents}
                                            teams={data.teams}
                                            workspaces={data.workspaces}
                                            eventHistory={eventHistory}
                                            runActivityAuthority={runActivityAuthority}
                                            runtimeConnectionRevision={runtimeConnectionRevision}
                                            runtimeConnectionNotice={runtimeConnectionNotice}
                                            initialSkillVersionIds={initialConversationSkillSelectionsRef.current.get(
                                              String(item.id),
                                            )}
                                            onInitialSkillSelectionConsumed={(conversationId) => {
                                              initialConversationSkillSelectionsRef.current.delete(
                                                conversationId,
                                              );
                                            }}
                                            seedComposerText={readSeedComposerText(
                                              String(item.id),
                                            )}
                                            onSeedComposerTextConsumed={(conversationId) => {
                                              seedComposerTextRef.current.delete(conversationId);
                                            }}
                                            onTitleUpdated={() => void refresh()}
                                            onConversationUpdated={handleConversationUpdated}
                                            onLatestReviewChange={handleLatestReviewChange}
                                            onOpenFile={(path, location) =>
                                              handleOpenFileInSplit(pane.id, path, location)
                                            }
                                            onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
                                            onOpenWebUrl={(url) =>
                                              handleOpenBrowserInPane(pane.id, url)
                                            }
                                            onOpenReview={(view) =>
                                              handleOpenReviewInSplit(pane.id, view)
                                            }
                                            onOpenPlanSettings={handleOpenPlanSettings}
                                            onOpenMcpSettings={handleOpenMcpSettings}
                                            onCreateSkill={handleCreateSkill}
                                          />
                                        </div>
                                      );
                                    })
                                : conversation && conversationSurfaceActive ? (
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
                                  ) : null}
                              {localBrowserTabs.map((tab) => {
                                const browserActive =
                                  activeTab?.type === 'browser' &&
                                  activeTab.browserId === tab.browserId;
                                return (
                                  <div
                                    key={tab.browserId}
                                    className="shell-pane-surface"
                                    data-surface="browser"
                                    data-active={browserActive ? 'true' : 'false'}
                                    data-testid={`pane-surface-browser-${tab.browserId}`}
                                  >
                                    <BrowserPanel
                                      initialUrl={tab.url}
                                      navigateUrl={
                                        aiBrowserNav?.browserId === tab.browserId
                                          ? aiBrowserNav.url
                                          : undefined
                                      }
                                      navigateSeq={
                                        aiBrowserNav?.browserId === tab.browserId
                                          ? aiBrowserNav.seq
                                          : undefined
                                      }
                                      onClose={() => handleCloseBrowserTab(pane.id, tab.browserId)}
                                      onNewTab={(url) => handleOpenBrowserInPane(pane.id, url)}
                                      onPageMeta={(meta) =>
                                        handleBrowserPageMeta(tab.browserId, meta)
                                      }
                                      projectFolder={activeProjectFolder}
                                      partition={`pane-browser-${tab.browserId}`}
                                      registerForAutomation
                                      automationActive={
                                        focused && keepAliveBrowserId === tab.browserId
                                      }
                                    />
                                  </div>
                                );
                              })}
                              {localReviewTabs
                                .filter((tab) =>
                                  shouldMountRetainedSurface(
                                    tab.runId,
                                    activeTab?.type === 'review' &&
                                      activeTab.runId === tab.runId,
                                    retainedSurfaces.reviews,
                                  ),
                                )
                                .map((tab) => {
                                  const reviewActive =
                                    activeTab?.type === 'review' &&
                                    activeTab.runId === tab.runId;
                                  return (
                                    <div
                                      key={tab.runId}
                                      className="shell-pane-surface"
                                      data-surface="review"
                                      data-active={reviewActive ? 'true' : 'false'}
                                    >
                                      <ReviewPanel
                                        view={
                                          reviewViewsByRunId.get(tab.runId) ??
                                          conversationReviewFromKey(tab.runId)
                                        }
                                        projectFolder={activeProjectFolder}
                                        standalone
                                        onOpenFile={(path, location) =>
                                          handleOpenFileInPane(pane.id, path, location)
                                        }
                                        onOpenFileInNewTab={(path, location) =>
                                          handleOpenFileInPane(pane.id, path, location)
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              {localFileTabs
                                .filter((tab) =>
                                  shouldMountRetainedSurface(
                                    tab.path,
                                    activeTab?.type === 'file' && activeTab.path === tab.path,
                                    retainedSurfaces.files,
                                  ),
                                )
                                .map((tab) => {
                                  const fileActive =
                                    activeTab?.type === 'file' && activeTab.path === tab.path;
                                  return (
                                    <div
                                      key={tab.path}
                                      className="shell-pane-surface"
                                      data-surface="file"
                                      data-active={fileActive ? 'true' : 'false'}
                                    >
                                      <WorkspaceFileView
                                        projectFolder={activeProjectFolder}
                                        path={tab.path}
                                        revealTarget={
                                          fileActive && activeWorkspaceId
                                            ? fileRevealTargets.get(
                                                fileTabDirtyKey(activeWorkspaceId, tab.path),
                                              )
                                            : undefined
                                        }
                                        onDirtyChange={(dirty) => {
                                          if (activeWorkspaceId) {
                                            handleFileDirtyChange(
                                              activeWorkspaceId,
                                              tab.path,
                                              dirty,
                                            );
                                          }
                                        }}
                                      />
                                    </div>
                                  );
                                })}
                              {localTerminalTabs
                                .filter((tab) =>
                                  shouldMountRetainedSurface(
                                    tab.terminalId,
                                    activeTab?.type === 'terminal' &&
                                      activeTab.terminalId === tab.terminalId,
                                    retainedSurfaces.terminals,
                                  ),
                                )
                                .map((tab) => {
                                  const terminalActive =
                                    activeTab?.type === 'terminal' &&
                                    activeTab.terminalId === tab.terminalId;
                                  return (
                                    <div
                                      key={tab.terminalId}
                                      className="shell-pane-surface"
                                      data-surface="terminal"
                                      data-active={terminalActive ? 'true' : 'false'}
                                    >
                                      <TerminalPane
                                        terminalId={tab.terminalId}
                                        projectFolder={activeProjectFolder}
                                        cwd={tab.cwd}
                                        workspaceId={activeWorkspaceId}
                                        title="Terminal"
                                        active={terminalActive}
                                        onCwdChange={(cwd) =>
                                          handleTerminalCwdChange(pane.id, tab.terminalId, cwd)
                                        }
                                      />
                                    </div>
                                  );
                                })}
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
                    <div className="shell-pane-canvas shell-pane-canvas--empty relative flex min-h-0 flex-1 flex-col overflow-hidden">
                      {emptyTalk}
                    </div>
                  )}
                </div>
                {activeWorkbenchLayout &&
                (activeWorkbenchLayout.right.open ||
                  activeWorkbenchLayout.right.tabs.length > 0) ? (
                  <WorkspaceWorkbench
                    placement="right"
                    open={activeWorkbenchLayout.right.open}
                    focused={workspaceChromeFocus === 'right'}
                    scope={activeWorkbenchLayout.right}
                    canOpenTerminal={Boolean(activeProjectFolder)}
                    renderContent={(tab) => renderWorkbenchContent('right', tab)}
                    browserPageMeta={browserPageMeta}
                    conversationTabMeta={workbenchConversationMeta}
                    renderFileBrowser={
                      activeProjectFolder
                        ? () => (
                            <WorkspaceFilesPanel
                              projectFolder={activeProjectFolder}
                              activeFilePath={undefined}
                              reviewView={latestReviewView}
                              onOpenReview={(view) => handleOpenReviewInWorkbench('right', view)}
                              onOpenFile={(path, location) =>
                                handleOpenFileInWorkbench('right', path, location)
                              }
                              onOpenFileInNewTab={(path, location) =>
                                handleOpenFileInWorkbench('right', path, location)
                              }
                            />
                          )
                        : undefined
                    }
                    onActivateTab={(tabId) => handleActivateWorkbenchTab('right', tabId)}
                    onCloseTab={(tab) => void handleCloseWorkbenchTab('right', tab)}
                    onNewResource={(resource) => handleWorkbenchNewResource('right', resource)}
                    onChromeFocus={() => setWorkspaceChromeFocus('right')}
                    onToggleFileBrowser={
                      activeProjectFolder ? handleToggleWorkspaceFilesWorkbench : undefined
                    }
                    onClose={() => handleCloseWorkbench('right')}
                    onSizeChange={(size, commit) =>
                      handleWorkbenchSizeChange('right', size, commit)
                    }
                    onFileBrowserWidthChange={handleWorkbenchFileBrowserWidthChange}
                  />
                ) : null}
              </div>
              {activeWorkbenchLayout &&
              (activeWorkbenchLayout.bottom.open ||
                activeWorkbenchLayout.bottom.tabs.length > 0) ? (
                <WorkspaceWorkbench
                  placement="bottom"
                  open={activeWorkbenchLayout.bottom.open}
                  focused={workspaceChromeFocus === 'bottom'}
                  scope={activeWorkbenchLayout.bottom}
                  canOpenTerminal={Boolean(activeProjectFolder)}
                  renderContent={(tab) => renderWorkbenchContent('bottom', tab)}
                  browserPageMeta={browserPageMeta}
                  conversationTabMeta={workbenchConversationMeta}
                  onActivateTab={(tabId) => handleActivateWorkbenchTab('bottom', tabId)}
                  onCloseTab={(tab) => void handleCloseWorkbenchTab('bottom', tab)}
                  onNewResource={(resource) => handleWorkbenchNewResource('bottom', resource)}
                  onChromeFocus={() => setWorkspaceChromeFocus('bottom')}
                  onClose={() => handleCloseWorkbench('bottom')}
                  onSizeChange={(size, commit) => handleWorkbenchSizeChange('bottom', size, commit)}
                />
              ) : null}
            </div>
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'agents'}
            className="shell-stage-layer"
            testId="stage-agents"
          >
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
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'teams'}
            className="shell-stage-layer"
            testId="stage-teams"
          >
            <TeamLibrary
              teams={data.teams}
              agents={data.agents}
              onRefresh={() => void refresh()}
              onStartConversation={(teamId) => {
                void handlePickTarget('team', teamId);
                setNav((n) => ({ ...n, stage: 'talk' }));
              }}
            />
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'browser'}
            className="shell-stage-layer"
            testId="stage-browser"
          >
            <BrowserStage onStartAiTask={handleStartBrowserAiTask} />
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'abilities'}
            className="shell-stage-layer"
            testId="stage-abilities"
          >
            <AbilitiesPage
              activeWorkspaceId={activeWorkspaceId}
              workspaces={data.workspaces}
              initialView={abilityNavigation?.initialView}
              navigationKey={abilityNavigation?.navigationKey}
              onCatalogChanged={() => {
                setSkillCatalogRevision((revision) => revision + 1);
                void refresh();
              }}
              onGoToAgents={() => setNav((n) => selectStage(n, 'agents'))}
            />
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'tasks'}
            className="shell-stage-layer"
            testId="stage-tasks"
          >
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
          </KeepAliveLayer>
          <KeepAliveLayer
            active={nav.stage === 'activity'}
            className="shell-stage-layer"
            testId="stage-activity"
          >
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
          </KeepAliveLayer>
          </div>
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
          initialSection={settingsNavigation.initialSection}
          initialModelDetail={settingsNavigation.initialModelDetail}
          initialConnectionTab={settingsNavigation.initialConnectionTab}
          navigationKey={settingsNavigation.navigationKey}
        />
      </Dialog.Root>
    </div>
  );
}

interface EmptyComposerSpeechRecognitionResult {
  readonly length: number;
  readonly [index: number]: { transcript: string };
}

interface EmptyComposerSpeechRecognitionEvent {
  readonly results: ArrayLike<EmptyComposerSpeechRecognitionResult>;
}

interface EmptyComposerSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: EmptyComposerSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type EmptyComposerSpeechRecognitionConstructor = new () => EmptyComposerSpeechRecognition;

export function EmptyTalk(props: {
  hasWorkspace: boolean;
  workspaceId?: string;
  workspaceFolder?: string;
  models: readonly ModelOption[];
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  draft: string;
  selectedModelId: string;
  draftConversationId?: string;
  /** Track/target carried from "new chat" while still a welcome draft. */
  draftTrack?: ConversationTrack;
  draftTargetRef?: string;
  sending: boolean;
  error?: string;
  onDraftChange(draft: string): void;
  onModelChange(modelId: string): void;
  onSend(options: {
    text: string;
    helpMode?: boolean;
    goalCondition?: string;
    goalSettings?: GoalSettingsValues;
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
  onPickIdentity?(track: ConversationTrack, targetRef: string): void;
  onOpenPlanSettings?(): void;
  onOpenModelSettings?(): void;
  onOpenMcpSettings?(): void;
  onCreateSkill?(): void;
}) {
  const [networkEnabled, setNetworkEnabled] = useState(true);
  const [appearance, setAppearance] = useState(() => readAppearancePreferences());
  useEffect(() => {
    const syncAppearance = () => setAppearance(readAppearancePreferences());
    window.addEventListener('shell-preferences-applied', syncAppearance);
    return () => window.removeEventListener('shell-preferences-applied', syncAppearance);
  }, []);
  const [userName, setUserName] = useState(() => readUserName());
  // Settings writes the name to localStorage; this event keeps the greeting
  // live without needing a restart or a shared store.
  useEffect(() => {
    const sync = () => setUserName(readUserName());
    window.addEventListener('shell-user-name-changed', sync);
    return () => window.removeEventListener('shell-user-name-changed', sync);
  }, []);
  const greeting = buildGreeting(new Date().getHours(), userName);
  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    if (!api?.getSettings) return;
    void api
      .getSettings({ keys: ['plan-act'] })
      .then((response) => {
        if (cancelled) return;
        setPlanActSetting(parseComposerPlanActSetting(response.settings?.['plan-act']));
      })
      .catch(() => setPlanActSetting(null));
    return () => {
      cancelled = true;
    };
  }, []);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    readDefaultPermission(),
  );
  const [agentPreferences, setAgentPreferences] = useState(() => readAgentPreferences());
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    () => readAgentPreferences().thinkingBudget,
  );
  useEffect(() => {
    const syncAgentDefaults = () => {
      const next = readAgentPreferences();
      setAgentPreferences(next);
      setReasoningEffort(next.thinkingBudget);
    };
    window.addEventListener(AGENT_PREFERENCES_CHANGED_EVENT, syncAgentDefaults);
    return () => window.removeEventListener(AGENT_PREFERENCES_CHANGED_EVENT, syncAgentDefaults);
  }, []);
  const [interactionMode, setInteractionMode] = useState<'plan' | 'execute'>('execute');
  const [dismissedModeHintText, setDismissedModeHintText] = useState<string | null>(null);
  const [goalSettingsOpen, setGoalSettingsOpen] = useState(false);
  const [goalSettingsSubmitting, setGoalSettingsSubmitting] = useState(false);
  const [pendingRiskGoal, setPendingRiskGoal] = useState<string | null>(null);
  const [riskGoalSubmitting, setRiskGoalSubmitting] = useState(false);
  const riskGoalSubmissionRef = useRef(false);
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const [composerAddOpen, setComposerAddOpen] = useState(false);
  const [planActSetting, setPlanActSetting] = useState<ComposerPlanActSetting | null>(null);
  const [kernelOverride, setKernelOverride] = useState(() => readNewConversationKernel());
  const [kernelRegistry, setKernelRegistry] = useState<KernelDetectionResult[] | null>(null);
  const [kernelInstallStates, setKernelInstallStates] = useState<
    Record<string, KernelInstallState | undefined>
  >({});
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | undefined>();
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(-1);
  const [slashCategory, setSlashCategory] = useState<ComposerSkillCategory>('all');
  const [availableSlashCategories, setAvailableSlashCategories] = useState<
    readonly ComposerSkillCategory[]
  >(['all']);
  const [resolvedSlashItems, setResolvedSlashItems] = useState<
    readonly ComposerSlashMenuResolvedItem[]
  >([]);
  const [slashSkills, setSlashSkills] = useState<SkillVersionSummary[]>([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
  const [slashSkillsResolved, setSlashSkillsResolved] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const dismissedSlashTextRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const identityButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const kernelInstallPromisesRef = useRef(new Map<string, Promise<void>>());
  const kernelDetectionGenerationRef = useRef(0);
  const kernelInstallMountedRef = useRef(true);
  const speechRecognitionRef = useRef<EmptyComposerSpeechRecognition | null>(null);
  const draftValueRef = useRef(props.draft);
  draftValueRef.current = props.draft;
  const composerToolbar = useComposerToolbarCollapse({
    permissionMenuOpen,
    onPermissionMenuOpenChange: setPermissionMenuOpen,
  });
  const updateResolvedSlashItems = useCallback(
    (items: readonly ComposerSlashMenuResolvedItem[]) => {
      setResolvedSlashItems((current) => {
        const unchanged =
          current.length === items.length &&
          current.every((item, index) => {
            const next = items[index];
            if (!next || item.kind !== next.kind) return false;
            return item.kind === 'command'
              ? next.kind === 'command' && item.command === next.command
              : next.kind === 'skill' && item.skill === next.skill;
          });
        return unchanged ? current : items;
      });
    },
    [],
  );
  const selectedModel =
    props.models.find((model) => model.modelId === props.selectedModelId) ?? props.models[0];
  const parsedComposerMode = parseSlashCommand(props.draft);
  const helpCommandPreview =
    parsedComposerMode.kind === 'help' || parsedComposerMode.kind === 'help-with-request';
  const planCommandPreview =
    parsedComposerMode.kind === 'plan' || parsedComposerMode.kind === 'plan-with-request';
  const goalCommandPreview =
    parsedComposerMode.kind === 'goal' || parsedComposerMode.kind === 'goal-with-condition';
  const composerMode: 'plan' | 'goal' | null = goalCommandPreview
    ? 'goal'
    : planCommandPreview || interactionMode === 'plan'
      ? 'plan'
      : null;
  const modelLabel = (modelId: string | null | undefined) =>
    props.models.find((model) => model.modelId === modelId)?.displayName ??
    modelId ??
    selectedModel?.displayName ??
    '选择模型';
  const planBannerModelLabel =
    planActSetting?.enabled && planActSetting.planModelId
      ? modelLabel(planActSetting.planModelId)
      : modelLabel(selectedModel?.modelId);
  const actBannerModelLabel =
    planActSetting?.enabled && planActSetting.actModelId
      ? modelLabel(planActSetting.actModelId)
      : modelLabel(selectedModel?.modelId);
  const composerModelSelection = resolveComposerModelSelection({
    planMode: composerMode === 'plan',
    setting: planActSetting,
    currentModelId: selectedModel?.modelId ?? '',
    currentReasoningEffort: reasoningEffort,
  });
  const composerModel =
    props.models.find((model) => model.modelId === composerModelSelection.modelId) ?? selectedModel;
  const promptEnhancementShortcutEnabled = usePromptEnhancementShortcutEnabled();
  const promptEnhancement = usePromptEnhancement({
    value: props.draft,
    onValueChange: props.onDraftChange,
    enabled: agentPreferences.promptEnhancementEnabled && promptEnhancementShortcutEnabled,
    configuredModelId: agentPreferences.promptEnhancementModelId,
    currentModelId: props.selectedModelId,
    models: props.models,
    disabled:
      props.sending ||
      pendingRiskGoal !== null ||
      riskGoalSubmitting ||
      goalSettingsSubmitting ||
      composerMode === 'goal',
  });
  const updatePlanActSetting = (next: ComposerPlanActSetting) => {
    const previous = planActSetting;
    setPlanActSetting(next);
    const api = bridge();
    if (!api?.setSetting) return;
    void api.setSetting({ key: 'plan-act', value: next }).catch(() => setPlanActSetting(previous));
  };
  const draftTrack = props.draftTrack ?? 'model';
  const identityAgent =
    draftTrack === 'agent'
      ? props.agents.find((agent) => String(agent.id) === String(props.draftTargetRef ?? ''))
      : undefined;
  const identityTeam =
    draftTrack === 'team'
      ? props.teams.find((team) => String(team.id) === String(props.draftTargetRef ?? ''))
      : undefined;
  const identityLabel =
    draftTrack === 'agent'
      ? (identityAgent?.name ?? '选择智能体')
      : draftTrack === 'team'
        ? (identityTeam?.name ?? '选择小队')
        : '直接跟模型聊';
  const identityAvatar = draftTrack === 'agent' ? identityAgent : identityTeam;
  const IdentityIcon = draftTrack === 'agent' ? Bot : draftTrack === 'team' ? Users : MessageSquare;
  const activeKernel = kernelRegistry?.find((kernel) => kernel.kernelId === kernelOverride) ?? null;
  const kernelExecutionIssue = isKernelExecutionSupported(
    activeKernel ?? { kernelId: kernelOverride },
  )
    ? undefined
    : (activeKernel?.executionUnavailableReason ??
      kernelExecutionUnavailableReason(
        resolveKernelDisplayName(kernelOverride, activeKernel?.name),
      ));
  const composerConfiguredContextWindow =
    (typeof composerModel?.contextWindow === 'number' && composerModel.contextWindow > 0
      ? composerModel.contextWindow
      : undefined) || estimateContextWindow(composerModel?.displayName || composerModel?.modelId);
  const composerKernelContextWindow = activeKernel?.capabilities?.contextWindow;
  const composerContextWindow =
    composerKernelContextWindow &&
    !composerKernelContextWindow.overridable &&
    composerConfiguredContextWindow > composerKernelContextWindow.nativeLimit
      ? composerKernelContextWindow.nativeLimit
      : composerConfiguredContextWindow;
  const composerContextWindowSource =
    composerKernelContextWindow &&
    !composerKernelContextWindow.overridable &&
    composerConfiguredContextWindow > composerKernelContextWindow.nativeLimit
      ? 'kernel-capped'
      : 'configured';
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

  useEffect(
    () => () => {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    },
    [],
  );

  const toggleVoiceInput = useCallback(() => {
    const activeRecognition = speechRecognitionRef.current;
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }

    const browserWindow = window as typeof window & {
      SpeechRecognition?: EmptyComposerSpeechRecognitionConstructor;
      webkitSpeechRecognition?: EmptyComposerSpeechRecognitionConstructor;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceInputActive(false);
      setComposeNotice('当前系统未提供语音识别服务。');
      return;
    }

    const recognition = new Recognition();
    const prefix = draftValueRef.current.trimEnd();
    recognition.lang = navigator.language || 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? '';
      }
      props.onDraftChange(`${prefix}${prefix && transcript ? ' ' : ''}${transcript}`);
      setComposeNotice(undefined);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    recognition.onerror = ({ error }) => {
      if (error === 'aborted' || error === 'no-speech') return;
      setComposeNotice(`语音输入失败：${error}`);
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
      setVoiceInputActive(false);
    };
    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceInputActive(true);
      setComposeNotice(undefined);
      inputRef.current?.focus();
    } catch (error) {
      speechRecognitionRef.current = null;
      setVoiceInputActive(false);
      setComposeNotice(
        `语音输入启动失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [props.onDraftChange]);

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

  const handleManagedKernelSnapshot = useCallback(
    (snapshot: Parameters<typeof applyManagedKernelSnapshotToInstallStates>[1]) => {
      setKernelInstallStates((current) =>
        applyManagedKernelSnapshotToInstallStates(current, snapshot),
      );
      void detectKernels();
    },
    [detectKernels],
  );
  useManagedKernelUpdateSync(handleManagedKernelSnapshot);

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
      if (skill.enabled === false || selectedSkillVersionIds.includes(skill.skillVersionId)) {
        return false;
      }
      if (!query) return true;
      return [skill.name, skill.description, skill.skillId, skill.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [selectedSkillVersionIds, slash, slashSkills]);
  const slashCandidateItemCount = slashCommands.length + filteredSlashSkills.length;
  const slashItemCount = resolvedSlashItems.length;
  const slashOpen = slash !== null;
  const slashMenuOpen = Boolean(
    slash &&
    (!slash.query.trim() ||
      slashCandidateItemCount > 0 ||
      slashSkillsLoading ||
      !slashSkillsResolved),
  );
  const detectedModeKeywordHint = parseComposerModeKeywordHint(props.draft);
  const modeKeywordHint =
    detectedModeKeywordHint &&
    dismissedModeHintText !== props.draft &&
    !helpCommandPreview &&
    !composerMode &&
    !slashMenuOpen &&
    !mcpMenuOpen &&
    !composerAddOpen &&
    !permissionMenuOpen &&
    !skillMenuOpen &&
    !identityMenuOpen &&
    !modelMenuOpen &&
    !props.sending
      ? detectedModeKeywordHint
      : null;
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
    if (!shouldLoadSlashSkills) {
      setSlashSkillsLoading(false);
      setSlashSkillsResolved(false);
      return;
    }
    const api = bridge();
    if (!api?.listSkills) {
      setSlashSkillsLoading(false);
      setSlashSkillsResolved(true);
      return;
    }
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
        if (!cancelled) {
          setSlashSkillsLoading(false);
          setSlashSkillsResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceId, shouldLoadSlashSkills]);

  useLayoutEffect(() => {
    if (!slashMenuOpen) return;
    keepListboxOptionVisible(slashListRef.current, slashIndex);
  }, [slashIndex, slashItemCount, slashMenuOpen]);

  const updatePickersFromCaret = useCallback((text: string, caret: number) => {
    if (dismissedSlashTextRef.current === text) {
      setSlash(null);
      setSlashIndex(-1);
      return;
    }
    dismissedSlashTextRef.current = null;
    const mention = detectMentionQuery(text, caret);
    if (mention) {
      setComposerAddOpen(true);
      setSlash(null);
      setSlashIndex(-1);
      return;
    }
    setComposerAddOpen(false);
    const nextSlash = detectSlashQuery(text, caret);
    setSlash(nextSlash);
    setSlashIndex(nextSlash ? 0 : -1);
  }, []);

  const selectSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (!slash) return;
      if (slash.slashIndex !== 0 && props.draft.slice(0, slash.slashIndex).trim().length > 0) {
        dismissedSlashTextRef.current = props.draft;
        setSlash(null);
        setSlashIndex(-1);
        setComposeNotice('斜杠命令只能出现在输入开头');
        window.requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (command.kind === 'action' || command.kind === 'panel') {
        const stripped = stripSlashToken(props.draft, slash);
        props.onDraftChange(stripped.text);
        setSlash(null);
        setSlashIndex(-1);
        if (command.id === 'compact') {
          setComposeNotice('新对话还没有可压缩的上下文');
        } else if (command.id === 'mcp') {
          setComposeNotice(undefined);
          setMcpMenuOpen(true);
        }
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(stripped.caret, stripped.caret);
        });
        return;
      }
      const replacement = replaceSlashTokenWithCommand(props.draft, slash, command.command);
      if (command.id === 'goal') setInteractionMode('execute');
      props.onDraftChange(replacement.text);
      setComposeNotice(undefined);
      setSlash(null);
      setSlashIndex(-1);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(replacement.caret, replacement.caret);
      });
    },
    [props, slash],
  );

  const toggleDraftMode = useCallback(
    (mode: 'plan' | 'goal') => {
      const parsed = parseSlashCommand(props.draft);
      const active =
        mode === 'plan'
          ? parsed.kind === 'plan' || parsed.kind === 'plan-with-request'
          : parsed.kind === 'goal' || parsed.kind === 'goal-with-condition';
      const next = active
        ? withoutComposerModeCommand(props.draft, mode)
        : withComposerModeCommand(props.draft, mode);
      if (mode === 'goal' || (mode === 'plan' && active)) setInteractionMode('execute');
      props.onDraftChange(next);
      setSlash(null);
      setSlashIndex(-1);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(next.length, next.length);
      });
    },
    [props],
  );

  const acceptModeKeywordHint = useCallback(() => {
    const next = withComposerModeKeywordHint(props.draft);
    if (next === props.draft) return;
    setDismissedModeHintText(null);
    props.onDraftChange(next);
    setSlash(null);
    setSlashIndex(-1);
    setMcpMenuOpen(false);
    setComposerAddOpen(false);
    setPermissionMenuOpen(false);
    setSkillMenuOpen(false);
    setIdentityMenuOpen(false);
    setModelMenuOpen(false);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  }, [props.draft, props.onDraftChange]);

  useEffect(() => {
    const matchesDraft = (event: globalThis.Event) =>
      String((event as CustomEvent<{ conversationId?: string }>).detail?.conversationId ?? '') ===
      String(props.draftConversationId ?? '');
    const togglePlan = (event: globalThis.Event) => {
      if (matchesDraft(event)) toggleDraftMode('plan');
    };
    const toggleGoal = (event: globalThis.Event) => {
      if (matchesDraft(event)) toggleDraftMode('goal');
    };
    window.addEventListener('shell-toggle-plan-mode', togglePlan);
    window.addEventListener('shell-toggle-goal-mode', toggleGoal);
    return () => {
      window.removeEventListener('shell-toggle-plan-mode', togglePlan);
      window.removeEventListener('shell-toggle-goal-mode', toggleGoal);
    };
  }, [props.draftConversationId, toggleDraftMode]);

  const selectSlashSkill = useCallback(
    (skill: SkillVersionSummary) => {
      if (!slash) return;
      const stripped = stripSlashToken(props.draft, slash);
      props.onDraftChange(stripped.text);
      setSelectedSkillVersionIds((current) =>
        resolveAppendSkillVersionIds(draftTrack, [...current, skill.skillVersionId]),
      );
      setSlash(null);
      setSlashIndex(-1);
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
    if (parsed.kind === 'help') {
      props.onDraftChange('/help ');
      setSlash(null);
      setComposeNotice(undefined);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(6, 6);
      });
      return false;
    }
    if (parsed.kind === 'plan') {
      toggleDraftMode('plan');
      setComposeNotice(undefined);
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
    if (parsed.kind === 'mcp') {
      props.onDraftChange('');
      setSlash(null);
      setSlashIndex(-1);
      setComposeNotice(undefined);
      setMcpMenuOpen(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return false;
    }
    if (parsed.kind === 'goal') {
      toggleDraftMode('goal');
      setComposeNotice(undefined);
      return false;
    }
    if (parsed.kind === 'goal-clear') {
      setComposeNotice('新对话还没有可清除的目标');
      return false;
    }
    if (parsed.kind === 'goal-with-condition' && parsed.condition.length > 4000) {
      setComposeNotice('目标条件过长（最多 4000 字符）');
      return false;
    }
    if (parsed.kind === 'goal-with-condition' && goalRequiresRiskConfirmation(parsed.condition)) {
      setPendingRiskGoal(parsed.condition);
      setSlash(null);
      setSlashIndex(-1);
      setComposerAddOpen(false);
      setMcpMenuOpen(false);
      inputRef.current?.blur();
      return false;
    }
    if (parsed.kind === 'unknown') {
      setComposeNotice(`未知命令：${parsed.command}`);
      return false;
    }

    if (kernelExecutionIssue) {
      setComposeNotice(kernelExecutionIssue);
      return false;
    }
    const draftText =
      parsed.kind === 'plan-with-request'
        ? parsed.request
        : parsed.kind === 'help-with-request'
          ? parsed.request
          : props.draft;
    const text = buildMessageWithAttachments(draftText, attachments);
    const modeForTurn = parsed.kind === 'plan-with-request' ? 'plan' : interactionMode;
    const skillVersionIds = resolveAppendSkillVersionIds(draftTrack, selectedSkillVersionIds);
    const sent = await props.onSend({
      text,
      ...(parsed.kind === 'help-with-request' ? { helpMode: true } : {}),
      ...(parsed.kind === 'goal-with-condition' ? { goalCondition: parsed.condition } : {}),
      images: messageImagesFromAttachments(attachments),
      // Keep the payload aligned with the model shown by the composer. When
      // Plan is active, this is the configured planning model rather than the
      // ordinary chat model.
      modelId: composerModelSelection.modelId || selectedModel?.modelId || '',
      kernelId: kernelOverride,
      interactionMode: modeForTurn,
      permissionMode,
      reasoningEffort: composerModelSelection.reasoningEffort,
      networkEnabled,
      skillVersionIds,
    });
    if (sent) {
      setAttachments([]);
      setComposeNotice(undefined);
    }
    return sent;
  };

  const confirmRiskGoal = async () => {
    if (!pendingRiskGoal || riskGoalSubmissionRef.current) return;
    if (kernelExecutionIssue) {
      setComposeNotice(kernelExecutionIssue);
      return;
    }
    riskGoalSubmissionRef.current = true;
    setRiskGoalSubmitting(true);
    try {
      const skillVersionIds = resolveAppendSkillVersionIds(draftTrack, selectedSkillVersionIds);
      const sent = await props.onSend({
        text: buildMessageWithAttachments(props.draft, attachments),
        goalCondition: pendingRiskGoal,
        images: messageImagesFromAttachments(attachments),
        modelId: composerModelSelection.modelId || selectedModel?.modelId || '',
        kernelId: kernelOverride,
        interactionMode,
        permissionMode,
        reasoningEffort: composerModelSelection.reasoningEffort,
        networkEnabled,
        skillVersionIds,
      });
      if (!sent) return;
      setPendingRiskGoal(null);
      setAttachments([]);
      setComposeNotice(undefined);
    } finally {
      riskGoalSubmissionRef.current = false;
      setRiskGoalSubmitting(false);
    }
  };

  const submitGoalSettings = async (values: GoalSettingsValues) => {
    if (goalSettingsSubmitting) return;
    if (kernelExecutionIssue) {
      setComposeNotice(kernelExecutionIssue);
      return;
    }
    setGoalSettingsSubmitting(true);
    try {
      const skillVersionIds = resolveAppendSkillVersionIds(draftTrack, selectedSkillVersionIds);
      const sent = await props.onSend({
        text: values.condition,
        goalSettings: values,
        images: [],
        modelId: composerModelSelection.modelId || selectedModel?.modelId || '',
        kernelId: kernelOverride,
        interactionMode: 'execute',
        permissionMode,
        reasoningEffort: composerModelSelection.reasoningEffort,
        networkEnabled,
        skillVersionIds,
      });
      if (!sent) return;
      setInteractionMode('execute');
      setGoalSettingsOpen(false);
      setAttachments([]);
      setComposeNotice(undefined);
    } finally {
      setGoalSettingsSubmitting(false);
    }
  };

  const emptyModeBanner =
    composerMode === 'plan' ? (
      <ComposerModeBanner
        mode="plan"
        planModelLabel={planBannerModelLabel}
        actModelLabel={actBannerModelLabel}
        onOpenPlanSettings={() => props.onOpenPlanSettings?.()}
      />
    ) : composerMode === 'goal' ? (
      <ComposerModeBanner
        mode="goal"
        pendingCondition={
          parsedComposerMode.kind === 'goal-with-condition'
            ? parsedComposerMode.condition
            : undefined
        }
        onConfigureGoal={() => setGoalSettingsOpen(true)}
        onClearGoal={() => toggleDraftMode('goal')}
      />
    ) : undefined;

  return (
    <div className="shell-chat-column shell-chat-column--empty-newmax flex min-h-0 flex-1 flex-col justify-center bg-chat">
      {props.hasWorkspace && props.models.length === 0 ? (
        <FirstLaunchGuide
          hasWorkspace
          hasProvider={false}
          onOpenWorkspaceMenu={props.onOpenWorkspaceMenu}
          onOpenModelSettings={props.onOpenModelSettings}
          onPickTrack={props.onPickTrack}
        />
      ) : props.hasWorkspace ? (
        <TipsCarousel />
      ) : null}
      <div className="shell-welcome shell-welcome--newmax flex min-h-0 shrink-0 flex-col items-center justify-center px-8">
        <h1
          data-testid="welcome-greeting"
          className="shell-welcome-title m-0 text-center font-medium text-text"
        >
          {greeting}
        </h1>
      </div>

      <div
        className="shell-chat-content-wrap shell-empty-newmax-composer-wrap shrink-0"
        data-locked={props.hasWorkspace ? undefined : 'true'}
        data-testid="empty-compose-wrap"
      >
        <div className="shell-chat-content shell-chat-content--composer mx-auto">
            <NewMaxComposerFrame
              variant="empty"
              modeBanner={emptyModeBanner}
              innerRef={composeRef}
              className={`relative ${dragOver ? 'is-dragover' : ''}`}
              data-testid="empty-compose"
              data-layout="tall"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {modeKeywordHint ? (
                <ComposerModeKeywordHint
                  kind={modeKeywordHint.kind}
                  onAccept={acceptModeKeywordHint}
                  onDismiss={() => setDismissedModeHintText(props.draft)}
                />
              ) : null}
              <ComposerSlashMenu
                open={slashMenuOpen}
                skills={slashSkills}
                loading={slashSkillsLoading}
                query={slash?.query ?? ''}
                selectedSkillVersionIds={selectedSkillVersionIds}
                activeIndex={slashIndex}
                onActiveIndexChange={setSlashIndex}
                category={slashCategory}
                onCategoryChange={setSlashCategory}
                onAvailableCategoriesChange={setAvailableSlashCategories}
                onResolvedItemsChange={updateResolvedSlashItems}
                onCommand={selectSlashCommand}
                onSkill={selectSlashSkill}
                onCreateSkill={() => {
                  setSlash(null);
                  setSlashIndex(-1);
                  props.onCreateSkill?.();
                }}
                placement="above"
                testId="empty-compose-slash-pop"
                className="shell-empty-slash-pop"
                listRef={slashListRef}
              />
              <ComposerMcpMenu
                open={mcpMenuOpen}
                onDismiss={() => {
                  setMcpMenuOpen(false);
                  window.requestAnimationFrame(() => inputRef.current?.focus());
                }}
                onOpenSettings={() => props.onOpenMcpSettings?.()}
                className="shell-empty-mcp-menu"
              />

              <div className="shell-compose__editor-area">
                <ComposerEditor
                  placeholder={
                    props.hasWorkspace
                      ? '输入消息…（输入 / 打开快捷面板）'
                      : '打开工作区后即可输入'
                  }
                  value={props.draft}
                  inputElementRef={inputRef}
                  inputTestId="empty-compose-input"
                  testId="empty-composer-editor"
                  attachments={attachments}
                  selectedSkills={selectedSlashSkills}
                  disabled={!props.hasWorkspace || props.sending}
                  minHeight={72}
                  maxHeight={200}
                  chatFontSize={appearance.chatFontSize}
                  serifFontFamily={
                    appearance.useSerifFont ? 'var(--font-serif)' : 'var(--font-sans)'
                  }
                  onRemoveAttachment={(path) =>
                    setAttachments((current) => removeAttachment(current, path))
                  }
                  onRemoveSkill={(skillVersionId) =>
                    updateSelectedSkillVersionIds(
                      selectedSkillVersionIds.filter((selected) => selected !== skillVersionId),
                    )
                  }
                  onChange={(value) => {
                    props.onDraftChange(value);
                    setComposeNotice(undefined);
                    if (composerAddOpen) {
                      setSlash(null);
                      setSlashIndex(-1);
                      return;
                    }
                    const caret = inputRef.current?.selectionStart ?? value.length;
                    updatePickersFromCaret(value, caret);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab' && event.shiftKey && modeKeywordHint) {
                      event.preventDefault();
                      acceptModeKeywordHint();
                      return;
                    }
                    if (tryHandlePromptEnhancementShortcut(event, promptEnhancement)) return;
                    if (event.key === 'Escape' && slashMenuOpen) {
                      event.preventDefault();
                      dismissedSlashTextRef.current = props.draft;
                      setSlash(null);
                      setSlashIndex(-1);
                      return;
                    }
                    if (slashMenuOpen) {
                      const action = resolveComposerSlashMenuKeyboardAction({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        isComposing:
                          event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
                        category: slashCategory,
                        activeIndex: slashIndex,
                        itemCount: slashItemCount,
                        availableCategories: availableSlashCategories,
                      });
                      if (action) {
                        event.preventDefault();
                        if (action.kind === 'change-category') {
                          setSlashCategory(action.category);
                          // Category changes select the first visible item so
                          // Enter remains useful immediately, including when
                          // the dynamic category list only contains `all`.
                          setSlashIndex(0);
                        } else if (action.kind === 'change-active-index') {
                          setSlashIndex(action.index);
                        } else {
                          const selected = resolvedSlashItems[action.index];
                          if (selected?.kind === 'command') selectSlashCommand(selected.command);
                          else if (selected?.kind === 'skill') selectSlashSkill(selected.skill);
                        }
                        return;
                      }
                    }
                  }}
                  onSubmit={() => void submit()}
                  onPaste={handlePaste}
                  onSelectionChange={({ start }) => {
                    if (composerAddOpen) return;
                    updatePickersFromCaret(inputRef.current?.value ?? props.draft, start);
                  }}
                  enhancing={promptEnhancement.busy}
                  trailingAction={
                    promptEnhancement.visible ? (
                      <PromptEnhancementAction
                        enhancement={promptEnhancement}
                        testId="empty-compose-prompt-enhance"
                      />
                    ) : undefined
                  }
                />
              </div>
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
              <div ref={composerToolbar.outerRef} className="shell-compose__bar">
                <div ref={composerToolbar.leftRef} className="shell-compose__bar-left">
                  <ComposerAddControl
                    variant="empty"
                    open={composerAddOpen}
                    inputRef={inputRef}
                    composerRef={composeRef}
                    value={props.draft}
                    onValueChange={props.onDraftChange}
                    onOpenChange={setComposerAddOpen}
                    onBeforeOpen={() => {
                      setSlash(null);
                      setSlashIndex(-1);
                      setMcpMenuOpen(false);
                      setPermissionMenuOpen(false);
                      setSkillMenuOpen(false);
                      setIdentityMenuOpen(false);
                      setModelMenuOpen(false);
                    }}
                    workspaceFolder={props.workspaceFolder}
                    selectedFilePaths={attachments
                      .filter((attachment) => attachment.kind !== 'image')
                      .map((attachment) => attachment.path)}
                    networkEnabled={networkEnabled}
                    permissionMode={permissionMode}
                    showPermissionItems={
                      composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL
                    }
                    disabled={props.sending}
                    attachDisabled={
                      attachments.filter((attachment) => attachment.kind === 'image').length >= 8
                    }
                    onAttach={() => imageInputRef.current?.click()}
                    onPlan={() => toggleDraftMode('plan')}
                    onGoal={() => toggleDraftMode('goal')}
                    onNetworkChange={setNetworkEnabled}
                    onPermissionChange={setPermissionMode}
                    onFile={(file) =>
                      setAttachments((current) =>
                        current.some((attachment) => attachment.path === file.path)
                          ? removeAttachment(current, file.path)
                          : addAttachment(current, {
                              path: file.path,
                              name: file.name || fileNameFromPath(file.path),
                              kind: file.kind,
                            }),
                      )
                    }
                    triggerTestId="empty-compose-add-trigger"
                    menuTestId="empty-compose-add-menu"
                  />
                  {helpCommandPreview ? (
                    <ComposerActiveModePill
                      mode="help"
                      onClick={() => {
                        const next = props.draft.replace(/^\s*\/help(?:\s+|$)/i, '');
                        props.onDraftChange(next);
                        window.requestAnimationFrame(() => {
                          inputRef.current?.focus();
                          inputRef.current?.setSelectionRange(next.length, next.length);
                        });
                      }}
                    />
                  ) : null}
                  {planCommandPreview || interactionMode === 'plan' ? (
                    <ComposerActiveModePill mode="plan" onClick={() => toggleDraftMode('plan')} />
                  ) : null}
                  {goalCommandPreview ? (
                    <ComposerActiveModePill mode="goal" onClick={() => toggleDraftMode('goal')} />
                  ) : null}
                  <div
                    ref={composerToolbar.permissionRef}
                    className="shell-compose__tool-wrap"
                    data-testid="empty-compose-permission-control"
                    hidden={
                      composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL
                    }
                  >
                    <button
                      ref={permissionButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={
                        permissionMenuOpen || permissionMode === 'full-access' ? '1' : '0'
                      }
                      title={`权限：${PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.title ?? '完全访问'}`}
                      onClick={() => {
                        setIdentityMenuOpen(false);
                        setModelMenuOpen(false);
                        setPermissionMenuOpen((value) => !value);
                      }}
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
                  <div
                    className="shell-compose__tool-wrap"
                    data-testid="empty-compose-skill-control"
                    hidden={composerToolbar.collapseLevel >= SKILL_COLLAPSED_TOOLBAR_LEVEL}
                  >
                    <TurnSkillControl
                      owner={skillOwner}
                      workspaceId={props.workspaceId}
                      open={skillMenuOpen}
                      selectedSkillVersionIds={selectedSkillVersionIds}
                      onOpenChange={(open) => {
                        if (open) {
                          setPermissionMenuOpen(false);
                          setIdentityMenuOpen(false);
                          setModelMenuOpen(false);
                        }
                        setSkillMenuOpen(open);
                      }}
                      onChange={updateSelectedSkillVersionIds}
                    />
                  </div>
                </div>
                <div ref={composerToolbar.rightRef} className="shell-compose__bar-right">
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={identityButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={draftTrack !== 'model' ? '1' : '0'}
                      data-open={identityMenuOpen ? '1' : '0'}
                      aria-haspopup="menu"
                      aria-expanded={identityMenuOpen}
                      data-testid="empty-compose-identity"
                      title={`对话对象：${identityLabel}`}
                      onClick={() => {
                        setPermissionMenuOpen(false);
                        setSkillMenuOpen(false);
                        setModelMenuOpen(false);
                        setIdentityMenuOpen((open) => !open);
                      }}
                    >
                      {identityAvatar?.avatar?.trim() ? (
                        <AgentAvatarView
                          name={identityAvatar.name}
                          avatar={identityAvatar.avatar}
                          size={18}
                        />
                      ) : (
                        <IdentityIcon size={15} />
                      )}
                      <span className="shell-compose__tool-label">{identityLabel}</span>
                    </button>
                    <IdentityPickerMenu
                      open={identityMenuOpen}
                      agents={props.agents.map((agent) => ({
                        id: String(agent.id),
                        name: agent.name,
                        description: agent.description,
                        avatar: agent.avatar,
                      }))}
                      teams={props.teams.map((team) => ({
                        id: String(team.id),
                        name: team.name,
                        description: team.mission,
                        avatar: team.avatar,
                      }))}
                      currentTrack={draftTrack}
                      currentTargetRef={String(props.draftTargetRef ?? '')}
                      anchorEl={identityButtonRef.current}
                      onClose={() => setIdentityMenuOpen(false)}
                      onPick={(option: IdentityOption) => {
                        const targetRef =
                          option.track === 'model'
                            ? (selectedModel?.modelId ?? '')
                            : option.targetRef;
                        if (props.onPickIdentity) {
                          props.onPickIdentity(option.track, targetRef);
                        } else {
                          props.onPickTrack(option.track);
                        }
                      }}
                    />
                  </div>
                  <ContextRing
                    used={Math.round(props.draft.length / 4)}
                    limit={composerContextWindow}
                    modelContextWindow={composerConfiguredContextWindow}
                    contextWindowSource={composerContextWindowSource}
                    kernelId={kernelOverride === 'native' ? undefined : kernelOverride}
                    kernelLabel={
                      kernelOverride === 'native'
                        ? undefined
                        : resolveKernelDisplayName(kernelOverride, activeKernel?.name)
                    }
                  />
                  <div className="shell-compose__tool-wrap">
                    <ModelPickerMenu
                      open={modelMenuOpen}
                      models={props.models}
                      selectedModelId={composerModelSelection.modelId}
                      defaultLabel="选择模型"
                      reasoningEffort={composerModelSelection.reasoningEffort}
                      kernels={kernelRegistry ?? undefined}
                      selectedKernelId={kernelOverride}
                      kernelInstallStates={kernelInstallStates}
                      anchorEl={modelButtonRef.current}
                      trigger={
                        <ModelTrigger
                          label={selectedModel?.displayName ?? selectedModel?.modelId ?? '选择模型'}
                          reasoningLabel={REASONING_LABELS[reasoningEffort]}
                          mode={composerMode ?? 'execute'}
                          planLabel={
                            composerModel?.displayName ??
                            composerModelSelection.modelId ??
                            '选择模型'
                          }
                          planReasoningLabel={
                            REASONING_LABELS[composerModelSelection.reasoningEffort]
                          }
                          open={modelMenuOpen}
                          buttonRef={modelButtonRef}
                          onClick={() => {
                            setPermissionMenuOpen(false);
                            setSkillMenuOpen(false);
                            setIdentityMenuOpen(false);
                            setModelMenuOpen((value) => !value);
                          }}
                        />
                      }
                      onClose={() => setModelMenuOpen(false)}
                      onInstallKernel={(kernelId) => void installKernel(kernelId)}
                      onPickKernel={(kernelId) => {
                        setKernelOverride(kernelId);
                        writeNewConversationKernel(kernelId);
                      }}
                      onPick={(modelId) => {
                        if (composerModelSelection.routed && planActSetting) {
                          updatePlanActSetting({ ...planActSetting, planModelId: modelId });
                          return;
                        }
                        props.onModelChange(modelId);
                      }}
                      onReasoningChange={(value) => {
                        if (composerModelSelection.routed && planActSetting) {
                          updatePlanActSetting({ ...planActSetting, planReasoningEffort: value });
                          return;
                        }
                        setReasoningEffort(value);
                      }}
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
                              {logo ? <BrandLogoMark logo={logo} size={18} /> : label}
                            </span>
                          );
                        })()
                      : null}
                  </div>
                  <ComposerActionSlot
                    testIdPrefix="empty-compose"
                    hasContent={Boolean(props.draft.trim() || attachments.length > 0)}
                    running={false}
                    voiceActive={voiceInputActive}
                    disabled={props.sending}
                    onVoice={toggleVoiceInput}
                    onSend={() => void submit()}
                    onStop={() => undefined}
                  />
                </div>
              </div>
              {props.error || composeNotice ? (
                <div className="px-3 pb-2 text-[11.5px] text-error" role="alert">
                  {props.error ?? composeNotice}
                </div>
              ) : null}
              {!props.hasWorkspace ? (
                <button
                  type="button"
                  className="shell-empty-workspace-gate"
                  data-testid="empty-workspace-gate"
                  onClick={props.onOpenWorkspaceMenu}
                >
                  打开工作区
                </button>
              ) : null}
            </NewMaxComposerFrame>
          </div>
        </div>
      {props.hasWorkspace ? (
        <HomeScenarios
          onSelectTemplate={(prompt) => {
            setComposerAddOpen(false);
            setSlash(null);
            setSlashIndex(-1);
            setMcpMenuOpen(false);
            props.onDraftChange(prompt);
            window.requestAnimationFrame(() => {
              const input = inputRef.current;
              if (!input) return;
              input.focus();
              input.setSelectionRange(prompt.length, prompt.length);
            });
          }}
        />
      ) : null}
      <GoalSettingsDialog
        open={goalSettingsOpen}
        initialValues={{
          condition:
            parsedComposerMode.kind === 'goal-with-condition' ? parsedComposerMode.condition : '',
        }}
        submitting={goalSettingsSubmitting}
        onOpenChange={setGoalSettingsOpen}
        onSubmit={submitGoalSettings}
      />
      <GoalRiskConfirmationDialog
        open={pendingRiskGoal !== null}
        submitting={riskGoalSubmitting}
        onOpenChange={(open) => {
          if (open || riskGoalSubmitting) return;
          setPendingRiskGoal(null);
          window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onContinue={() => void confirmRiskGoal()}
      />
    </div>
  );
}

function SettingsModal({
  onClose,
  onCatalogChanged,
  initialSection,
  initialModelDetail,
  initialConnectionTab,
  navigationKey,
}: {
  onClose(): void;
  onCatalogChanged(): void;
  initialSection?: SettingsSection;
  initialModelDetail?: ModelSettingsDetailView;
  initialConnectionTab?: ConnectionTab;
  navigationKey?: string | number;
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
            initialSection={initialSection}
            initialModelDetail={initialModelDetail}
            initialConnectionTab={initialConnectionTab}
            navigationKey={navigationKey}
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
