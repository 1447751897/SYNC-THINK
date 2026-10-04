import './board-composer.css';
import './conversation-attention.css';
import type { ConversationActivityView } from '../../conversation-attention.js';
import type { ConversationAttentionProjection } from './ConversationAttentionController.js';
import { readSidebarMode, writeSidebarMode } from './agent-contacts.js';
import { PROJECTLESS_SCOPE, runtimeConversation, runtimeWorkspaceId, projectConversationScopes, projectWorkspaceScopes } from './projectless-scope.js';
import { repositoryKey } from './git-repository-events.js';
import { ComposerGitBar, type GitPanelSection, type ComposerGitNavigation } from './ComposerGitBar.js';
import { ContextMenuProvider } from './ContextMenu.js';
import { createBrowserCommandDispatcher } from './browser-command-dispatcher.js';
// New shell root — NewMax visual constitution (S3 / D3 first cut).
// Sidebar top actions + three tracks with groups · workspace tabs (no 全部) ·
// welcome empty state · settings modal.
import { reviewViewKey, conversationReviewFromKey, type ReviewView } from './review-view.js';
import { lazy, Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  isKernelExecutionSupported,
  kernelExecutionUnavailableReason,
  RefreshCoordinator,
} from '@sync-think/shared';
import type {
  Conversation,
  ConversationTrack,
  Event,
  GlobalAgent,
  KernelDetectionResult,
  Team,
  WorkspaceId,
} from '@sync-think/shared';
import type { BrowserRecordingStepInput } from '@sync-think/shared';
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
import type { WorkbenchNewResource } from './WorkspaceWorkbench.js';
import { emptyExcalidrawContent } from './ExcalidrawPreview.js';
import { ChatView, type RuntimeConnectionNotice } from './ChatView.js';
import { clearFilePaneSession, isFilePaneSessionDirty, type FileRevealTarget } from './FilePane.js';
import { collectOpenFilePaths, createUntitledProjectFile } from './untitled-project-file.js';
import { WorkspaceFileView } from './WorkspaceFileView.js';

import { disposeTerminalSession } from './terminal-session-store.js';

import { canonicalizeLocalWebPageUrl, isLocalWebPageUrl } from '../../local-web-page-contract.js';
import { materializeWorkbenchScope, migrateConversationWorkbenches, parseWorkbenchScopeKey, workbenchScopeKey, workbenchesForWorkspace } from './conversation-workbench.js';
import { migrateLocalPageBrowsersToWorkbench } from './local-page-workbench.js';

import type { AbilityCenterInitialView } from './abilities/AbilityCenterPage.js';
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
  ComposerIdentity,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL,
  SKILL_COLLAPSED_TOOLBAR_LEVEL,
  PermissionTrigger,
  REASONING_LABELS,
  useComposerToolbarCollapse,
  type KernelInstallState,
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
  messageImagesFromAttachments,
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
import { useComposerImageUploads } from './use-composer-image-uploads.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { loadSkillCatalog } from './skill-catalog-loader.js';
import { loadConversationCatalog } from './conversation-catalog-loader.js';
import { agentChatHistory } from './agent-contacts.js';
import { isAgentConversation, type AgentWorkspaceNavigation } from './conversation-surface.js';
import { isAgentTeamLibraryEvent } from './agent-team-library-events.js';
import { ComposerEditor } from './ComposerEditor.js';
import {
  PromptEnhancementAction,
  tryHandlePromptEnhancementShortcut,
  usePromptEnhancement,
  usePromptEnhancementShortcutEnabled,
} from './prompt-enhancement.js';
import { ComposerMcpMenu } from './ComposerMcpMenu.js';
import { ComposerModeBanner, NewMaxComposerFrame } from '@sync-think/ui-kit';
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
import { ComposerAddControl } from './ComposerAddMenu.js';
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
import { ToastProvider, toastApi, toastTypeFromTone, useToast } from './Toast.js';
import { classifyAppendMessageFailure } from '../append-message-error.js';
import { formatRuntimeIpcError } from '../provider-error-copy.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import {
  createShellBootSnapshotWriter,
  hasShellBootSnapshot,
  readShellBootSnapshot,
} from './shell-boot-snapshot.js';
import { htmlBrowserSourceMatches, INCOMPLETE_HTML_OPEN_ERROR, isDeferredHtmlPreview, type HtmlBrowserOpenOptions } from './html-browser.js';
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
  findWorkbenchBrowserByOwner,
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
  gitWorkbenchTab,
  toggleWorkspaceFilesWorkbench,
  updateWorkbenchBrowserUrl,
  workspaceFilesWorkbenchTab,
  type WorkbenchPlacement,
  type WorkbenchTab,
  type WorkspaceWorkbenchLayout,
  type WorkspaceWorkbenchLayouts,
} from './workspace-workbench.js';

const ConversationTabs = lazyPanel<import('./ConversationTabs.js').ConversationTabsProps>(() => import('./ConversationTabs.js').then(module => ({ default: module.ConversationTabs })), '会话标签', 'ConversationTabs');
const ConversationAttentionController = lazyPanel(() => import('./ConversationAttentionController.js'), '会话待处理', 'ConversationAttentionController');
const TipsCarousel = lazyPanel<import('./TipsCarousel.js').TipsCarouselProps>(() => import('./TipsCarousel.js').then((module) => ({ default: module.TipsCarousel })), '使用提示', 'TipsCarousel');

const WallpaperReadingLayers = lazy(() => import('./WallpaperReadingLayers.js').then(module => ({ default: module.WallpaperReadingLayers })));

// Split-pane rendering is only needed once a conversation surface is shown.
const WorkspacePaneHost = lazyPanel<ComponentProps<typeof import('./WorkspacePaneHost.js').WorkspacePaneHost>>(
  async () => ({ default: (await import('./WorkspacePaneHost.js')).WorkspacePaneHost }),
  '对话工作区',
);

const WorkspaceWorkbench = lazyPanel(
  async () => ({ default: (await import('./WorkspaceWorkbench.js')).WorkspaceWorkbench }),
  '工作台',
  'WorkspaceWorkbench',
);
// 与工作台同样按需加载：Git 面板只在「Git」页签激活时才拉取，
// 不进入初始 bundle（初始 JS 有硬预算）。
const GitPanel = lazyPanel(
  async () => ({ default: (await import('./GitPanel.js')).GitPanel }),
  'Git 工具',
  'GitPanel',
);
// 协作会话（群聊/单聊）只在打开协作会话时加载，不占初始 bundle。
const CollaborationChatView = lazyPanel<ComponentProps<typeof import('./CollaborationChatView.js').CollaborationChatView>>(
  async () => ({ default: (await import('./CollaborationChatView.js')).CollaborationChatView }),
  '协作会话',
  'CollaborationChatView',
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
const ReviewPanel = lazyPanel<ComponentProps<typeof import('./RightDock.js').ReviewPanel>>(
  async () => ({ default: (await import('./RightDock.js')).ReviewPanel }),
  '文件变更',
);
const WorkspaceFilesPanel = lazyPanel<ComponentProps<typeof import('./RightDock.js').WorkspaceFilesPanel>>(
  async () => ({ default: (await import('./RightDock.js')).WorkspaceFilesPanel }),
  '工作区文件',
);
const TerminalPane = lazyPanel<ComponentProps<typeof import('./TerminalPane.js').TerminalPane>>(
  async () => ({ default: (await import('./TerminalPane.js')).TerminalPane }),
  '终端',
  'TerminalPane',
);
const BrowserPanel = lazyPanel<ComponentProps<typeof import('./BrowserPanel.js').BrowserPanel>>(
  async () => ({ default: (await import('./BrowserPanel.js')).BrowserPanel }),
  '浏览器',
);
const BrowserStage = lazyPanel<{ onStartAiTask?(request: BrowserWorkflowAiTaskRequest): void; workspaces?: Array<{ workspaceId: string; name: string }>; activeWorkspaceId?: string; active?: boolean }>(
  async () => ({ default: (await import('./BrowserStage.js')).BrowserStage }),
  '浏览器',
  'BrowserStage',
);
const AbilitiesPage = lazyPanel(
  async () => ({
    default: (await import('./abilities/AbilityCenterPage.lazy.js')).AbilitiesPage,
  }),
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
  '收件箱',
  'ActivityCenterPage',
);
const SettingsPage = lazyPanel(
  async () => ({ default: (await import('./SettingsPage.js')).SettingsPage }),
  '设置',
  'SettingsPage',
);
/**
 * The sidebar is a click-heavy surface whose entire prop set is rebuilt by
 * ShellApp on every render. `memo` keeps updates that have nothing to do with
 * it — streaming output, panel/layout churn — from re-rendering the whole
 * conversation list. This only pays off because every callback it receives is
 * memoised; see `sidebarCallbacks` below.
 */
const SidebarSurface = memo(Sidebar);
const AgentWorkspace = lazyPanel(
  () => import('./AgentWorkspace.js'),
  '智能体工作区',
  'AgentWorkspace',
  props => props.embedded && props.sidebarVisible && !props.contentActive ? props.sidebarHost : null,
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

type ShellRefreshResult =
  | { ok: true; conversations: Conversation[] }
  | { ok: false; error: string };

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

const CHAT_BROWSER_AUTOMATION_SAVE_KEY = 'browser.chat-automation-save';

function browserToolCompletedSuccessfully(event: Event): string | undefined {
  if (event.type !== 'tool.completed' && event.type !== 'execution.tool.completed')
    return undefined;
  const toolCallId = event.payload.toolCallId;
  if (typeof toolCallId !== 'string' || !toolCallId) return undefined;
  const result = event.payload.result;
  if (result && typeof result === 'object') {
    return (result as { ok?: unknown }).ok === false ? undefined : toolCallId;
  }
  try {
    const parsed = JSON.parse(String(result ?? '{}')) as { ok?: unknown };
    return parsed.ok === false ? undefined : toolCallId;
  } catch {
    return toolCallId;
  }
}

function chatBrowserSteps(
  events: readonly Event[],
  runId: string,
): {
  profileId?: string;
  startUrl?: string;
  steps: BrowserRecordingStepInput[];
} {
  const successfulToolCalls = new Set(
    events
      .filter((event) => String(event.runId ?? '') === runId)
      .map(browserToolCompletedSuccessfully)
      .filter((value): value is string => Boolean(value)),
  );
  let profileId: string | undefined;
  let startUrl: string | undefined;
  let inputIndex = 0;
  const steps: BrowserRecordingStepInput[] = [];
  for (const event of events) {
    if (String(event.runId ?? '') !== runId || event.type !== 'browser.command.started') continue;
    const toolCallId = event.payload.toolCallId;
    if (typeof toolCallId !== 'string' || !successfulToolCalls.has(toolCallId)) continue;
    if (!profileId && typeof event.payload.profileId === 'string')
      profileId = event.payload.profileId;
    const toolName = String(event.payload.toolName ?? '');
    const args =
      event.payload.args && typeof event.payload.args === 'object'
        ? (event.payload.args as Record<string, unknown>)
        : {};
    if (toolName === 'browser_open' && typeof args.url === 'string') {
      const url = args.url;
      startUrl ??= url;
      steps.push({ kind: 'navigate', url });
    } else if (toolName === 'browser_click') {
      if (typeof args.selector === 'string' && args.selector) {
        steps.push({ kind: 'click', locator: { strategy: 'css', value: args.selector } });
      } else if (typeof args.text === 'string' && args.text) {
        steps.push({
          kind: 'click',
          locator: { strategy: 'role', role: 'button', name: args.text },
        });
      }
    } else if (toolName === 'browser_type' && typeof args.selector === 'string' && args.selector) {
      inputIndex += 1;
      steps.push({
        kind: 'fill',
        locator: { strategy: 'css', value: args.selector },
        value: { kind: 'variable', name: `输入值${inputIndex}` },
      });
    }
  }
  return { profileId, startUrl, steps };
}

function persistPaneLayouts(layouts: WorkspacePaneLayouts): void {
  writeWorkspacePaneLayouts(layouts);
  const legacyTabs: Record<string, string[]> = {};
  const legacySelected: Record<string, string> = {};
  const previousSelected = readSelectedConversationByWorkspace();
  for (const [workspaceId, layout] of Object.entries(layouts)) {
    const ids = paneConversationIds(layout);
    if (ids.length > 0) legacyTabs[workspaceId] = ids;
    const selected = paneKeepAliveConversationId(layout.panes[layout.focusedPaneId], previousSelected[workspaceId]);
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
      <ToastProvider>
        <ContextMenuProvider><ShellAppInner /></ContextMenuProvider>
      </ToastProvider>
    </DialogProvider>
  );
}

function ShellAppInner() {
  const dialog = useDialog();
  const [nav, setNav] = useState<ShellNavState>(() => ({
    ...INITIAL_NAV,
    lastTrack: 'model',
  }));
  // Sidebar preference is independent of the conversation displayed on the right.
  const [sidebarMode, setSidebarMode] = useState(readSidebarMode);
  const changeSidebarMode = useCallback((mode: 'conversations' | 'agents') => {
    setSidebarMode(mode);
    writeSidebarMode(mode);
  }, []);
  const [agentSidebarHost, setAgentSidebarHost] = useState<HTMLDivElement | null>(null);
  const [agentActionsHost, setAgentActionsHost] = useState<HTMLDivElement | null>(null);
  const [agentWorkspaceOpen, setAgentWorkspaceOpen] = useState(false);
  const enterAgentWorkspace = useCallback(() => {
    setAgentWorkspaceOpen(true);
    changeSidebarMode('agents');
    const narrow = window.matchMedia?.('(max-width: 767px)')?.matches === true;
    setNav(n => ({ ...selectStage(n, 'talk'), ...(narrow ? { sidebarCollapsed: true } : {}) }));
  }, [changeSidebarMode]);
  const exitAgentWorkspace = useCallback(() => { setAgentWorkspaceOpen(false); changeSidebarMode('conversations'); }, [changeSidebarMode]);
  const [agentNavigation, setAgentNavigation] = useState<AgentWorkspaceNavigation>();
  const agentNavigationNonce = useRef(0);
  const restoredConversationSurface = useRef(false);
  const navigateAgentWorkspace = useCallback((target: Omit<AgentWorkspaceNavigation, 'nonce'>) => {
    setAgentNavigation({ ...target, nonce: ++agentNavigationNonce.current });
    enterAgentWorkspace();
  }, [enterAgentWorkspace]);

  const ensureDefaultDraftRef = useRef<(workspaceId: string) => void>(() => {});
  const [data, setData] = useState<ShellData>(() => readShellBootSnapshot() ?? EMPTY);
  const [projectlessExecutionScopes, setProjectlessExecutionScopes] = useState<readonly string[]>([]);
  const bootSnapshotWriterRef = useRef<ReturnType<typeof createShellBootSnapshotWriter> | null>(
    null,
  );
  if (bootSnapshotWriterRef.current === null) {
    bootSnapshotWriterRef.current = createShellBootSnapshotWriter();
  }
  const [skillCatalogRevision, setSkillCatalogRevision] = useState(0);
  const [eventHistory, setEventHistory] = useState<readonly Event[]>([]);
  const [pendingChatBrowserWorkflow, setPendingChatBrowserWorkflow] = useState<{
    runId: string;
    profileId: string;
    startUrl: string;
    steps: BrowserRecordingStepInput[];
    partial: boolean;
  }>();
  const [savingChatBrowserWorkflow, setSavingChatBrowserWorkflow] = useState(false);
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
  const [projectlessFolders, setProjectlessFolders] = useState<Record<string, string>>({});
  const projectlessIdsKey = data.conversations.filter(conversation => conversation.workspaceId === PROJECTLESS_SCOPE).map(conversation => String(conversation.id)).sort().join('|');
  useEffect(() => {
    const api = bridge();
    const ids = projectlessIdsKey ? projectlessIdsKey.split('|') : [];
    if (!api || ids.length === 0) return;
    let cancelled = false;
    void api.getSettings({ keys: ids.map(id => 'data.projectless.conversation.' + id) }).then(result => {
      if (cancelled) return;
      const folders: Record<string, string> = {};
      for (const id of ids) {
        const directory = result.settings['data.projectless.conversation.' + id];
        if (typeof directory === 'string') folders[id] = resolveProjectRelativePath(directory, 'files');
      }
      setProjectlessFolders(folders);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectlessIdsKey]);

  const currentDataFolder = useCallback((path?: string) => {
    if (activeWorkspaceId !== PROJECTLESS_SCOPE) return data.workspaces.find(workspace => workspace.workspaceId === activeWorkspaceId)?.folderPath?.trim();
    if (path) {
      const normalized = path.replace(/\\/g, '/').toLowerCase();
      const owner = Object.values(projectlessFolders).find(folder => normalized.startsWith(folder.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '') + '/'));
      if (owner) return owner;
    }
    return nav.selectedConversationId ? projectlessFolders[nav.selectedConversationId] : undefined;
  }, [activeWorkspaceId, data.workspaces, nav.selectedConversationId, projectlessFolders]);

  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>(() =>
    hasShellBootSnapshot(readShellBootSnapshot()) ? 'ready' : 'loading',
  );
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  // Mirror for event-time reads: the drag effect below binds once, so it must
  // not close over a stale width when committing and persisting the final value.
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
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
  const [initialLayouts] = useState(() => {
    const selected = readSelectedConversationByWorkspace();
    const local = migrateLocalPageBrowsersToWorkbench(
      migrateLegacyPaneLayouts(readWorkspacePaneLayouts(), readOpenConversationTabs(), selected),
      readWorkspaceWorkbenchLayouts(),
    );
    const scoped = migrateConversationWorkbenches(local.workbenches, local.panes, selected);
    return { panes: local.panes, workbenches: scoped.layouts, migrated: local.migrated || scoped.migrated };
  });
  const [paneLayouts, setPaneLayouts] = useState<WorkspacePaneLayouts>(initialLayouts.panes);
  const initialPaneLayoutsRef = useRef(paneLayouts);
  const paneLayoutsRef = useRef(paneLayouts);
  paneLayoutsRef.current = paneLayouts;
  const [workbenchLayouts, setWorkbenchLayouts] = useState<WorkspaceWorkbenchLayouts>(initialLayouts.workbenches);
  const initialWorkbenchMigrationRef = useRef(initialLayouts.migrated ? initialLayouts.workbenches : null);
  const [workspaceChromeFocus, setWorkspaceChromeFocus] = useState<WorkspaceChromeFocus>('primary');
  const workbenchLayoutsRef = useRef(workbenchLayouts);
  workbenchLayoutsRef.current = workbenchLayouts;
  const workbenchPane = activeWorkspaceId ? paneLayouts[activeWorkspaceId] : undefined;
  const workbenchConversationId = nav.selectedConversationId ?? (workbenchPane
    ? paneKeepAliveConversationId(workbenchPane.panes[workbenchPane.focusedPaneId], readSelectedConversationByWorkspace()[activeWorkspaceId!]) : undefined);
  const activeWorkbenchKey = activeWorkspaceId ? workbenchScopeKey(activeWorkspaceId, workbenchConversationId) : undefined;
  // Mount only visited scopes (plus explicitly opened background tasks). Hidden
  // guests keep their DOM/history while the active scope owns the visible tabs.
  const [retainedWorkbenchKeys, setRetainedWorkbenchKeys] = useState(() => new Set(activeWorkbenchKey ? [activeWorkbenchKey] : []));
  useEffect(() => {
    if (activeWorkbenchKey) setRetainedWorkbenchKeys(keys => keys.has(activeWorkbenchKey) ? keys : new Set([...keys, activeWorkbenchKey]));
  }, [activeWorkbenchKey]);
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
  const [attentionHost, setAttentionHost] = useState<HTMLSpanElement | null>(null);
  const [attentionProjection, setAttentionProjection] = useState<ConversationAttentionProjection>(() => ({ requests: new Map(), failedIds: new Set() }));
  const conversationAttention = attentionProjection.requests;
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
  const draftAttachmentCountRef = useRef(0);
  const handleDraftAttachmentCount = useCallback((count: number) => {
    draftAttachmentCountRef.current = count;
  }, []);
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

  const [sidebarGroupsRevision, setSidebarGroupsRevision] = useState(0);
  const updateWorkspaceGroups = useCallback((workspaceId: string | undefined, update: (current: ConversationGroupsByTrack) => ConversationGroupsByTrack) => {
    const id = workspaceId ?? activeWorkspaceIdRef.current;
    if (!id) return;
    const next = update(readConversationGroups(id));
    writeConversationGroups(id, next);
    if (id === activeWorkspaceIdRef.current) setGroups(next);
    setSidebarGroupsRevision(value => value + 1);
  }, []);

  const persistGroups = useCallback(
    (next: ConversationGroupsByTrack) => {
      setGroups(next);
      if (activeWorkspaceId) writeConversationGroups(activeWorkspaceId, next);
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    // Write the destination first: an interrupted migration can leave duplicates,
    // but never lose a local preview before its original pane tab is removed.
    if (initialWorkbenchMigrationRef.current) {
      persistWorkbenchLayouts(initialWorkbenchMigrationRef.current);
    }
    // Persist migrations from the former openTabs/selected and local-browser routes.
    persistPaneLayouts(initialPaneLayoutsRef.current);
    // The initial snapshot is intentionally written once; later writes happen
    // at reducer commit points so divider drags do not churn localStorage.
  }, []);

  const commitPaneLayout = useCallback(
    (workspaceId: string, update: (currentLayout: WorkspacePaneLayout) => WorkspacePaneLayout) => {
      // Compute the next layout from the mirror BEFORE calling setState so the
      // persistence side effect lives OUTSIDE the state updater. React requires
      // updaters to be pure: StrictMode invokes them twice, and
      // persistPaneLayouts is 3 JSON.stringify + 3 synchronous localStorage
      // writes, so every layout commit used to pay that cost twice — on the
      // click path. The mirror is kept authoritative here so back-to-back
      // commits in one batch accumulate instead of clobbering each other.
      const current = paneLayoutsRef.current;
      const currentLayout = current[workspaceId] ?? createWorkspacePaneLayout(workspaceId);
      const layout = update(currentLayout);
      if (layout === currentLayout && Object.hasOwn(current, workspaceId)) return;
      const next = { ...current, [workspaceId]: layout };
      paneLayoutsRef.current = next;
      setPaneLayouts(next);
      persistPaneLayouts(next);
    },
    [],
  );

  const commitWorkbenchLayout = useCallback(
    (
      scopeKey: string,
      update: (currentLayout: WorkspaceWorkbenchLayout) => WorkspaceWorkbenchLayout,
      persist = true,
    ) => {
      // Same reasoning as commitPaneLayout: keep the updater pure and the
      // localStorage write on the caller's side, exactly once.
      const current = workbenchLayoutsRef.current;
      const currentLayout = current[scopeKey] ?? createWorkspaceWorkbenchLayout();
      const layout = update(currentLayout);
      if (layout === currentLayout) return;
      const next = { ...current, [scopeKey]: layout };
      workbenchLayoutsRef.current = next;
      setWorkbenchLayouts(next);
      if (persist) persistWorkbenchLayouts(next);
    },
    [],
  );

  const focusConversation = useCallback(
    (conversationId: string, workspaceId?: string, resolved?: Conversation) => {
      const conversation = resolved ?? data.conversations.find((c) => c.id === conversationId);
      const ws = workspaceId ?? conversation?.workspaceId ?? activeWorkspaceIdRef.current;
      if (conversation && isAgentConversation(conversation)) {
        navigateAgentWorkspace({ workspaceId: ws ?? PROJECTLESS_SCOPE, conversationId });
        return;
      }
      exitAgentWorkspace();
      if (ws) {
        const found = findWorkbenchConversation(
          workbenchLayoutsRef.current[workbenchScopeKey(ws, conversationId)] ?? createWorkspaceWorkbenchLayout(),
          conversationId,
        );
        if (found) {
          commitWorkbenchLayout(workbenchScopeKey(ws, conversationId), (current) =>
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
    [commitPaneLayout, commitWorkbenchLayout, data.conversations, exitAgentWorkspace, navigateAgentWorkspace],
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
      const folder = currentDataFolder();
      if (activeWorkspaceId === PROJECTLESS_SCOPE && folder && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)) path = resolveProjectRelativePath(folder, path);
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
    [currentDataFolder, activeWorkspaceId, commitPaneLayout],
  );

  const handleOpenFileInWorkbench = useCallback(
    (placement: WorkbenchPlacement, path: string, location?: ProjectTextLocation) => {
      if (!activeWorkspaceId) return;
      const folder = currentDataFolder();
      if (activeWorkspaceId === PROJECTLESS_SCOPE && folder && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)) path = resolveProjectRelativePath(folder, path);
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
      commitWorkbenchLayout(activeWorkbenchKey!, (current) => {
        const opened = openWorkbenchTab(current, placement, fileWorkbenchTab(path));
        return placement === 'right' ? setWorkbenchFileBrowserOpen(opened, 'right', true) : opened;
      });
    },
    [currentDataFolder, activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  const handleOpenFileInSplit = useCallback(
    (_paneId: string, path: string, location?: ProjectTextLocation) => {
      handleOpenFileInWorkbench('right', path, location);
    },
    [handleOpenFileInWorkbench],
  );

  const [gitRequest, setGitRequest] = useState<{ root: string; section: GitPanelSection; revision: number }>();
  const handleOpenGit = useCallback((root: string, section: GitPanelSection) => {
    if (!activeWorkspaceId) return;
    setGitRequest(current => ({ root, section, revision: (current?.revision ?? 0) + 1 }));
    commitWorkbenchLayout(activeWorkbenchKey!, current => {
      const next = openWorkbenchTab(current, 'right', gitWorkbenchTab(root));
      return { ...next, right: { ...next.right, size: current.right.open ? Math.max(current.right.size, 400) : 520 } };
    });
  }, [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout]);

  const handleOpenReviewInWorkbench = useCallback(
    (placement: WorkbenchPlacement, view: ReviewView) => {
      if (!activeWorkspaceId) return;
      const runId = reviewViewKey(view);
      setReviewViewsByRunId((current) => {
        const next = new Map(current);
        next.set(runId, view);
        return next;
      });
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        openWorkbenchTab(current, placement, reviewWorkbenchTab(runId)),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
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
      const workbenchCount = workbenchesForWorkspace(workbenchLayouts, workspaceId)
        .flatMap(([, layout]) => [...layout.right.tabs, ...layout.bottom.tabs])
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
      if (isLocalWebPageUrl(url)) {
        commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
          openWorkbenchTab(current, 'right', browserWorkbenchTab(browserId, canonicalizeLocalWebPageUrl(url))),
        );
        return;
      }
      commitPaneLayout(activeWorkspaceId, (current) =>
        openBrowserInPane(current, browserId, url, paneId ?? current.focusedPaneId),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitPaneLayout, commitWorkbenchLayout],
  );

  const openUntitledProjectFile = useCallback(
    (
      kind: 'document' | 'canvas',
      openIn:
        { type: 'pane'; paneId?: string } | { type: 'workbench'; placement: WorkbenchPlacement },
    ) => {
      if (!activeWorkspaceId) return;
      const projectFolder = currentDataFolder();
      if (!projectFolder) {
        setNewConversationError(
          kind === 'canvas' ? '新建绘图前请先绑定项目文件夹' : '新建文档前请先绑定项目文件夹',
        );
        return;
      }
      const openPaths = collectOpenFilePaths({
        panes: Object.values(paneLayouts[activeWorkspaceId]?.panes ?? {}),
        workbenchTabs: workbenchesForWorkspace(workbenchLayouts, activeWorkspaceId)
          .flatMap(([, layout]) => [...layout.right.tabs, ...layout.bottom.tabs]),
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
          commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
            openWorkbenchTab(current, openIn.placement, fileWorkbenchTab(created.path)),
          );
          return;
        }
        handleOpenFileInPane(openIn.paneId ?? '', created.path);
      });
    },
    [currentDataFolder,
      activeWorkspaceId,
      activeWorkbenchKey,
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
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        openWorkbenchTab(current, placement, browserWorkbenchTab(createBrowserId(), url)),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  const handleOpenHtmlInBrowser = useCallback(
    async (html: string, options: HtmlBrowserOpenOptions = {}) => {
      if (!activeWorkspaceId || !html.trim()) return;

      const api = bridge();
      const projectFolder = currentDataFolder();

      const browserId = createBrowserId();
      const incomplete = isDeferredHtmlPreview(html);
      // Projectless snippets still open beside the chat, never in the OS browser.
      if (!projectFolder) {
        if (incomplete) throw new Error(INCOMPLETE_HTML_OPEN_ERROR);
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
          openWorkbenchTab(current, 'right', browserWorkbenchTab(browserId, url)),
        );
        return;
      }

      const partition = `pane-browser-${browserId}`;
      let relativePath = options.relativePath?.trim();
      let persist = options.persist !== false;
      let verifiedSource = false;
      // A Markdown path is only a hint: verify the disk source before reusing it.
      // Never overwrite a file based on prose, or open an unrelated stale document.
      const sourcePath = incomplete && relativePath && !persist
        ? relativePath
        : options.sourcePath?.trim();
      if (
        (!relativePath || (incomplete && !persist)) &&
        sourcePath &&
        isSafeProjectRelativePath(sourcePath) &&
        api?.readProjectFile
      ) {
        const source = await api.readProjectFile({ root: projectFolder, path: sourcePath });
        if (
          !source.error &&
          typeof source.content === 'string' &&
          htmlBrowserSourceMatches(html, source.content)
        ) {
          relativePath = sourcePath;
          persist = false;
          verifiedSource = true;
        }
      }
      // History projections can stop inside <style>, leaving a background-only page.
      // A verified source file is safe to open; the truncated excerpt is never persisted.
      if (incomplete && !verifiedSource) throw new Error(INCOMPLETE_HTML_OPEN_ERROR);
      relativePath ||= `designs/ai-preview-${browserId}.html`;
      if (!isSafeProjectRelativePath(relativePath)) {
        throw new Error('浏览器预览路径必须是项目内的 HTML 文件');
      }
      const absolutePath = resolveProjectRelativePath(projectFolder, relativePath);

      if (persist) {
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
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        openWorkbenchTab(current, 'right', browserWorkbenchTab(browserId, localPage.url!)),
      );
    },
    [currentDataFolder, activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
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
    (url: string, ownerId?: string, workspaceId = activeWorkspaceId) => {
      if (!workspaceId) return;
      const scopeKey = ownerId ? workbenchScopeKey(workspaceId, ownerId) :
        (workspaceId === activeWorkspaceId ? activeWorkbenchKey! : workbenchScopeKey(workspaceId));
      setRetainedWorkbenchKeys(keys => keys.has(scopeKey) ? keys : new Set([...keys, scopeKey]));
      const currentWorkbench = workbenchLayoutsRef.current[scopeKey] ?? createWorkspaceWorkbenchLayout();
      const existingSame = (ownerId ? findWorkbenchBrowserByOwner(currentWorkbench, ownerId) : null) ?? findWorkbenchBrowserByUrl(currentWorkbench, url, ownerId);
      const browserId = existingSame?.tab.browserId ?? createBrowserId();
      setAiBrowserNav((current) => ({ browserId, url, seq: (current?.seq ?? 0) + 1 }));
      commitWorkbenchLayout(scopeKey, (current) =>
        openOrFocusWorkbenchBrowser(current, browserId, url, 'right', ownerId),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  // AI browser_open tool.completed → open or focus a matching workbench browser.
  // First pass only registers historical events (no auto-navigation on reopen);
  // Live renderer commands own their tab; only external completions use this fallback.
  const seenBrowserOpenIdsRef = useRef<Set<string>>(new Set());
  const browserNavPrimedRef = useRef(false);
  const browserCommandContextRef = useRef({ data, handleAiBrowserOpen, activeWorkspaceId, projectlessExecutionScopes, projectlessFolders, currentDataFolder });
  browserCommandContextRef.current = { data, handleAiBrowserOpen, activeWorkspaceId, projectlessExecutionScopes, projectlessFolders, currentDataFolder };

  useEffect(() => {
    const priming = !browserNavPrimedRef.current;
    browserNavPrimedRef.current = true;
    const pending: { id: string; url: string; ownerId?: string; workspaceId: string }[] = [];
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
          const ownerId = typeof event.payload.ownerId === 'string' ? event.payload.ownerId :
            typeof event.payload.threadId === 'string' ? event.payload.threadId :
            typeof event.payload.conversationId === 'string' ? event.payload.conversationId :
            event.taskId ? data.conversations.find(conversation => conversation.taskId === event.taskId)?.id : undefined;
          const workspaceId = projectlessExecutionScopes.includes(String(event.workspaceId)) ? PROJECTLESS_SCOPE : String(event.workspaceId);
          pending.push({ id: eventKey, url: parsed.url, ownerId, workspaceId });
        } else {
          seenBrowserOpenIdsRef.current.add(eventKey);
        }
      } catch {
        seenBrowserOpenIdsRef.current.add(eventKey);
      }
    }
    for (const item of pending) {
      seenBrowserOpenIdsRef.current.add(item.id);
      handleAiBrowserOpen(item.url, item.ownerId, item.workspaceId);
    }
  }, [eventHistory, handleAiBrowserOpen, projectlessExecutionScopes, data.conversations]);

  const chatBrowserSettingSnapshotsRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const handledChatBrowserRunsRef = useRef<Set<string>>(new Set());
  const chatBrowserCapturePrimedRef = useRef(false);
  useEffect(() => {
    for (const event of eventHistory) {
      const runId = String(event.runId ?? '');
      if (
        !runId ||
        event.type !== 'run.started' ||
        chatBrowserSettingSnapshotsRef.current.has(runId)
      ) {
        continue;
      }
      const snapshot =
        bridge()
          ?.getSettings({ keys: [CHAT_BROWSER_AUTOMATION_SAVE_KEY] })
          .then((response) => {
            const value = response.settings[CHAT_BROWSER_AUTOMATION_SAVE_KEY];
            return value === true || (value as { enabled?: unknown })?.enabled === true;
          })
          .catch(() => false) ?? Promise.resolve(false);
      chatBrowserSettingSnapshotsRef.current.set(runId, snapshot);
    }

    const terminalEvents = eventHistory.filter(
      (event) => event.type === 'run.completed' || event.type === 'run.failed',
    );
    if (!chatBrowserCapturePrimedRef.current) {
      chatBrowserCapturePrimedRef.current = true;
      for (const event of terminalEvents) {
        const runId = String(event.runId ?? '');
        if (runId) handledChatBrowserRunsRef.current.add(runId);
      }
      return;
    }

    for (const terminal of terminalEvents) {
      const runId = String(terminal.runId ?? '');
      if (!runId || handledChatBrowserRunsRef.current.has(runId)) continue;
      handledChatBrowserRunsRef.current.add(runId);
      const settingSnapshot =
        chatBrowserSettingSnapshotsRef.current.get(runId) ?? Promise.resolve(false);
      void settingSnapshot.then((enabled) => {
        if (!enabled) return;
        const capture = chatBrowserSteps(eventHistory, runId);
        if (!capture.profileId || !capture.startUrl || capture.steps.length === 0) return;
        setPendingChatBrowserWorkflow({
          runId,
          profileId: capture.profileId,
          startUrl: capture.startUrl,
          steps: capture.steps,
          partial: terminal.type === 'run.failed',
        });
      });
    }
  }, [eventHistory]);

  const importChatBrowserWorkflow = useCallback(
    async (publish: boolean) => {
      if (!pendingChatBrowserWorkflow || savingChatBrowserWorkflow) return;
      setSavingChatBrowserWorkflow(true);
      try {
        await bridge()?.browserWorkflow.importChat({
          profileId: pendingChatBrowserWorkflow.profileId,
          name: `对话浏览器任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          instruction: `复用对话运行 ${pendingChatBrowserWorkflow.runId} 中的浏览器操作。`,
          startUrl: pendingChatBrowserWorkflow.startUrl,
          steps: pendingChatBrowserWorkflow.steps,
          publish,
        });
        setPendingChatBrowserWorkflow(undefined);
        toastApi.toast({
          type: 'success',
          title: publish ? '浏览器自动化任务已发布' : '浏览器自动化草稿已保存',
        });
      } catch (error) {
        toastApi.toast({
          type: 'error',
          title: error instanceof Error ? error.message : '浏览器自动化任务保存失败',
        });
      } finally {
        setSavingChatBrowserWorkflow(false);
      }
    },
    [pendingChatBrowserWorkflow, savingChatBrowserWorkflow],
  );

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
    commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
      toggleWorkspaceFilesWorkbench(current, 'right'),
    );
  }, [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout]);

  const handleToggleWorkbench = useCallback(
    (placement: WorkbenchPlacement) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkbenchKey!, (current) => {
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
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout, countOpenTerminals],
  );

  const handleNewWorkbenchResource = useCallback(
    (placement: WorkbenchPlacement, resource: WorkbenchNewResource) => {
      if (!activeWorkspaceId) return;
      if (resource === 'conversation') return;
      if (resource === 'files') {
        commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
          toggleWorkspaceFilesWorkbench(current, 'right'),
        );
        return;
      }
      if (resource === 'terminal') {
        if (countOpenTerminals(activeWorkspaceId) >= MAX_TERMINAL_SESSIONS) return;
        commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
          openWorkbenchTab(current, placement, terminalWorkbenchTab(createTerminalId())),
        );
        return;
      }
      if (resource === 'canvas' || resource === 'document') {
        openUntitledProjectFile(resource, { type: 'workbench', placement });
        return;
      }
      if (resource === 'git') {
        commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
          openWorkbenchTab(current, placement, gitWorkbenchTab(data.workspaces.find(workspace => workspace.workspaceId === activeWorkspaceId)?.folderPath || undefined)),
        );
        return;
      }
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        openWorkbenchTab(current, placement, browserWorkbenchTab(createBrowserId(), 'about:blank')),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, data.workspaces, commitWorkbenchLayout, countOpenTerminals, openUntitledProjectFile],
  );

  const handleActivateWorkbenchTab = useCallback(
    (placement: WorkbenchPlacement, tabId: string) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        activateWorkbenchTab(current, placement, tabId),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  const handleCloseWorkbench = useCallback(
    (placement: WorkbenchPlacement) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        setWorkbenchOpen(current, placement, false),
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  const handleWorkbenchSizeChange = useCallback(
    (placement: WorkbenchPlacement, size: number, commit: boolean) => {
      if (!activeWorkspaceId) return;
      commitWorkbenchLayout(
        activeWorkbenchKey!,
        (current) => setWorkbenchSize(current, placement, size),
        commit,
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
  );

  const handleCloseWorkbenchTab = useCallback(
    async (placement: WorkbenchPlacement, tab: WorkbenchTab) => {
      if (!activeWorkspaceId) return;
      const projectFolder = currentDataFolder(tab.type === 'file' ? tab.path : undefined);
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
      commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
        closeWorkbenchTab(current, placement, tab.id),
      );
    },
    [currentDataFolder, activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout, data.workspaces, dialog, setDraftSession],
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
      const projectFolder = currentDataFolder(path);
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
    [currentDataFolder, activeWorkspaceId, commitPaneLayout, data.workspaces, dialog, handleFileDirtyChange],
  );

  const handleClosePane = useCallback(
    async (paneId: string) => {
      if (!activeWorkspaceId) return;
      const projectFolder = currentDataFolder();
      const filePaths = (paneLayouts[activeWorkspaceId]?.panes[paneId]?.tabs ?? [])
        .filter((tab) => tab.type === 'file')
        .map((tab) => tab.path);
      const terminalIds = (paneLayouts[activeWorkspaceId]?.panes[paneId]?.tabs ?? [])
        .filter((tab) => tab.type === 'terminal')
        .map((tab) => tab.terminalId);
      const dirtyPaths = filePaths.filter(path => { const folder = currentDataFolder(path); return folder && isFilePaneSessionDirty(folder, path); });
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
    [currentDataFolder, activeWorkspaceId, commitPaneLayout, data.workspaces, dialog, paneLayouts],
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
      const current = paneLayoutsRef.current;
      const layout = current[activeWorkspaceId] ?? createWorkspacePaneLayout(activeWorkspaceId);
      const nextLayout = setSplitRatio(layout, splitNodeId, ratio);
      const next = { ...current, [activeWorkspaceId]: nextLayout };
      paneLayoutsRef.current = next;
      setPaneLayouts(next);
      // Divider drags pass commit=false for intermediate frames; only the final
      // committed ratio reaches localStorage (unchanged behaviour).
      if (commit) persistPaneLayouts(next);
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    setGroups(readConversationGroups(activeWorkspaceId));
  }, [activeWorkspaceId]);

  const performRefresh = useCallback(async (): Promise<ShellRefreshResult> => {
    const api = bridge();
    if (!api) {
      const error = '渲染进程未注入 runtime bridge';
      toastApi.toast({
        id: 'shell-refresh-error',
        type: 'error',
        title: '刷新工作区数据失败',
        description: error,
      });
      return { ok: false, error };
    }

    try {
      const [conversations, agents, teams, providers, workspaces, skills] = await Promise.all([
        loadConversationCatalog(api, { includeArchived: true }),
        api.listGlobalAgents({}),
        api.listTeams(),
        api.listProviders({}),
        api.listWorkspaces({}),
        loadSkillCatalog(api, { refresh: true }),
      ]);
      const modelNames = new Map<string, string>();
      const models: ModelOption[] = [];
      for (const provider of providers.providers) {
        if (provider.enabled === false) continue;
        if (provider.protocol === 'openai-images') continue;
        for (const model of provider.models) {
          const capabilities = model.capabilities ?? [];
          if (capabilities.includes('image-generation') && !capabilities.includes('text')) {
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
      setProjectlessExecutionScopes(current => {
        const ids = workspaces.workspaces.filter(workspace => workspace.name === '__inbox__').map(workspace => String(workspace.workspaceId));
        return current.join('|') === ids.join('|') ? current : ids;
      });
      const scopedConversations = projectConversationScopes(conversations.conversations, workspaces.workspaces);
      const scopedWorkspaces = projectWorkspaceScopes(workspaces.workspaces);
      const nextData = {
        conversations: scopedConversations,
        agents: agents.agents,
        teams: teams.teams,
        modelNames,
        models,
        workspaces: scopedWorkspaces,
        skills: skills.skills,
      };
      setData(nextData);
      bootSnapshotWriterRef.current?.schedule(nextData);

      // Recover an old agent tab in its own surface, never as a workbench tab.
      if (!restoredConversationSurface.current) {
        restoredConversationSurface.current = true;
        const ws = activeWorkspaceIdRef.current;
        const layout = ws ? paneLayoutsRef.current[ws] : undefined;
        const selectedId = layout ? focusedConversationId(layout) : undefined;
        const selected = scopedConversations.find(c => c.id === selectedId);
        if (selected && isAgentConversation(selected)) {
          navigateAgentWorkspace({ workspaceId: selected.workspaceId ?? PROJECTLESS_SCOPE, conversationId: selected.id });
        }
      }
      // Drop stale tabs per workspace and collapse empty branches without ever
      // using another workspace's conversation as a valid reference.
      const prunedLayouts: WorkspacePaneLayouts = {};
      for (const [workspaceId, layout] of Object.entries(paneLayoutsRef.current)) {
        const validIds = new Set(
          scopedConversations
            .filter((conversation) => conversation.workspaceId === workspaceId && !isAgentConversation(conversation))
            .map((conversation) => String(conversation.id)),
        );
        const draft = draftSessionRef.current;
        if (draft?.workspaceId === workspaceId && draft.track === 'model') validIds.add(draft.id);
        prunedLayouts[workspaceId] = pruneWorkspacePaneLayout(layout, validIds);
      }
      paneLayoutsRef.current = prunedLayouts;
      setPaneLayouts(prunedLayouts);
      persistPaneLayouts(prunedLayouts);
      const validWorkspaceIds = new Set<string>(
        scopedWorkspaces.map((workspace) => String(workspace.workspaceId)),
      );
      const prunedWorkbench: WorkspaceWorkbenchLayouts = Object.fromEntries(
        Object.entries(workbenchLayoutsRef.current).filter(([key]) =>
          validWorkspaceIds.has(parseWorkbenchScopeKey(key)?.workspaceId ?? '') || parseWorkbenchScopeKey(key)?.workspaceId === PROJECTLESS_SCOPE,
        ).map(([key, layout]) => {
          const workspaceId = parseWorkbenchScopeKey(key)!.workspaceId;
          const validIds = new Set(scopedConversations.filter(c => c.workspaceId === workspaceId && !isAgentConversation(c)).map(c => String(c.id)));
          const draft = draftSessionRef.current;
          if (draft?.workspaceId === workspaceId && draft.track === 'model') validIds.add(draft.id);
          let next = layout;
          for (const scope of [layout.right, layout.bottom]) {
            for (const tab of scope.tabs) {
              if (tab.type === 'conversation' && !tab.conversationId.startsWith('draft:') && !validIds.has(tab.conversationId)) next = closeWorkbenchConversation(next, tab.conversationId);
            }
          }
          return [key, next];
        }),
      );
      workbenchLayoutsRef.current = prunedWorkbench;
      setWorkbenchLayouts(prunedWorkbench);
      persistWorkbenchLayouts(prunedWorkbench);

      // No「全部」: always land on a concrete workspace when possible.
      setActiveWorkspaceId((current) => {
        const list = scopedWorkspaces;
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
      return { ok: true, conversations: nextData.conversations };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : '加载工作区数据失败';
      toastApi.toast({
        id: 'shell-refresh-error',
        type: 'error',
        title: '刷新工作区数据失败',
        description: error,
      });
      return { ok: false, error };
    }
  }, [navigateAgentWorkspace]);

  const refreshCoordinatorRef = useRef<RefreshCoordinator<ShellRefreshResult> | null>(null);
  if (refreshCoordinatorRef.current === null) {
    refreshCoordinatorRef.current = new RefreshCoordinator(performRefresh);
  }
  const refresh = useCallback(
    (): Promise<ShellRefreshResult> => refreshCoordinatorRef.current!.request(),
    [],
  );

  useEffect(
    () => () => {
      bootSnapshotWriterRef.current?.flush();
    },
    [],
  );

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

    // Coalesce event batches into at most one commit per frame. Runtime publishes
    // step/tool/stream boundaries as separate IPC messages, and every commit
    // re-renders the whole shell plus the conversation view. Committing per
    // message is what makes the interface stall while a run is producing output;
    // merging per frame keeps the same information with one commit.
    let eventsFrame: number | null = null;
    let pendingEvents: Event[] = [];
    const commitRuntimeEvents = () => {
      eventsFrame = null;
      const batch = pendingEvents;
      pendingEvents = [];
      if (batch.length === 0 || cancelled) return;
      setEventHistory((prev) => mergeEventHistory(prev, batch));
      // Chat tools save real agent/team configurations; refresh the library and
      // pickers on those events, without refetching on every task/message step.
      if (batch.some(event => isAgentTeamLibraryEvent(event.type))) void refresh();
    };
    const dispatchBrowserCommand = createBrowserCommandDispatcher({
      open: (url, workspaceId, ownerId) => {
        const context = browserCommandContextRef.current;
        const targetWorkspace = context.projectlessExecutionScopes.includes(workspaceId) ? PROJECTLESS_SCOPE : workspaceId;
        context.handleAiBrowserOpen(url, ownerId, targetWorkspace);
      },
      projectFolder: (workspaceId, ownerId) => {
        const context = browserCommandContextRef.current;
        return context.projectlessExecutionScopes.includes(workspaceId)
          ? (ownerId ? context.projectlessFolders[ownerId] : context.currentDataFolder())
          : context.data.workspaces.find(workspace => String(workspace.workspaceId) === workspaceId)?.folderPath?.trim();
      },
      submit: (result) => api.submitBrowserResult(result),
      saveScreenshot: api.saveBrowserScreenshot ? (input) => api.saveBrowserScreenshot(input) : undefined,
      sendTrustedClick: api.sendBrowserTrustedClick ? (input) => api.sendBrowserTrustedClick(input) : undefined,
    });
    const handleRuntimeEvents = (events: Event[]) => {
      if (events.length === 0) return;
      // Execute live commands before animation-frame batching, which can pause
      // when the window is hidden. Never execute commands from connect snapshots.
      for (const event of events) {
        if (event.type === 'browser.command_requested') {
          // A live embedded open already owns navigation. Its durable completion
          // may contain a redirect URL; replaying it would create a second guest.
          if (event.payload.toolName === 'browser_open' && typeof event.payload.toolCallId === 'string') seenBrowserOpenIdsRef.current.add(event.payload.toolCallId);
          void dispatchBrowserCommand(event).catch(() => {
            console.warn('[desktop] browser result delivery failed');
          });
        } else {
          pendingEvents.push(event);
        }
      }
      if (eventsFrame !== null) return;
      eventsFrame = window.requestAnimationFrame(commitRuntimeEvents);
    };
    const unsub = api.onEvents
      ? api.onEvents(handleRuntimeEvents)
      : api.onEvent?.((event: Event) => handleRuntimeEvents([event]));

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
        void refresh().then((result) => {
          if (!cancelled) {
            if (result.ok) {
              setBootState('ready');
              setBootError(undefined);
            } else {
              setBootState('error');
              setBootError(result.error);
            }
          }
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
        void refresh().then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setBootState('ready');
          } else {
            setBootState('error');
            setBootError(result.error);
          }
        });
      },
    });

    return () => {
      cancelled = true;
      if (eventsFrame !== null) {
        window.cancelAnimationFrame(eventsFrame);
        eventsFrame = null;
      }
      pendingEvents = [];
      stopConnect();
      unsub?.();
    };
  }, [refresh]);

  const pendingOpenRef = useRef<string | null>(null);

  const openConversationById = useCallback(
    async (conversationId: string) => {
      const draft = draftSessionRef.current;
      if (draft?.id === conversationId) {
        pendingOpenRef.current = null;
        focusConversation(conversationId, draft.workspaceId);
        return;
      }
      pendingOpenRef.current = conversationId;
      let target = data.conversations.find((c) => c.id === conversationId);
      if (!target) {
        // Background tasks create conversations after the shell catalog loads.
        // Fetch them now instead of waiting for an unrelated catalog refresh.
        const result = await refresh();
        if (pendingOpenRef.current !== conversationId) return;
        if (!result.ok) {
          pendingOpenRef.current = null;
          return;
        }
        target = result.conversations.find((c) => c.id === conversationId);
        if (!target) {
          pendingOpenRef.current = null;
          toastApi.toast({ type: 'error', title: '对话未找到，可能已被删除' });
          return;
        }
      }
      pendingOpenRef.current = null;
      // Deep links can target a conversation in another workspace. Switch there
      // first so the workspace-scoped main stage can resolve the selection.
      const workspaceId = target.workspaceId ?? PROJECTLESS_SCOPE;
      if (workspaceId !== activeWorkspaceIdRef.current) selectWorkspace(workspaceId);
      focusConversation(conversationId, workspaceId, target);
    },
    [data.conversations, focusConversation, selectWorkspace, refresh],
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
    if (
      pendingOpenRef.current &&
      data.conversations.some((conversation) => conversation.id === pendingOpenRef.current)
    ) {
      void openConversationById(pendingOpenRef.current);
    }
  }, [data.conversations, openConversationById]);

  // Sidebar drag resize.
  useEffect(() => {
    let frame: number | null = null;
    let pending: number | null = null;
    const commitPending = () => {
      frame = null;
      if (pending === null) return;
      const next = pending;
      pending = null;
      setSidebarWidth(next);
    };
    const onMove = (e: MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, drag.startWidth + (e.clientX - drag.startX)),
      );
      // Coalesce to at most one commit per frame. A high-rate pointer emits
      // mousemove at 500-1000 Hz, and every commit re-renders the whole shell
      // and re-runs flex layout for the chat column, so committing per event is
      // what makes the panel visibly lag behind the cursor.
      pending = next;
      if (frame === null) frame = window.requestAnimationFrame(commitPending);
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      const finalWidth = pending ?? sidebarWidthRef.current;
      pending = null;
      if (finalWidth !== sidebarWidthRef.current) setSidebarWidth(finalWidth);
      // Persist outside the state updater: a side effect inside an updater runs
      // twice under StrictMode and pays a synchronous localStorage write on
      // every commit.
      writeSidebarWidth(finalWidth);
      delete document.documentElement.dataset.sidebarResizing;
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
          commitWorkbenchLayout(workbenchScopeKey(workspaceId, draftId), (current) =>
            openWorkbenchTab(current, workbenchPlacement, conversationWorkbenchTab(draftId)),
          );
          return;
        }
        commitWorkbenchLayout(workbenchScopeKey(workspaceId, draftId), (current) =>
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
      const assigned = materializeWorkbenchScope(workbenchLayoutsRef.current, workspaceId, undefined, draft.id);
      if (assigned !== workbenchLayoutsRef.current) {
        workbenchLayoutsRef.current = assigned;
        setWorkbenchLayouts(assigned);
        persistWorkbenchLayouts(assigned);
      }
      placeDraft(draft.id);
      setNav((current) => openConversation({ ...current, stage: 'talk' }, draft.id));
      return draft;
    },
    [activeWorkspaceId, commitPaneLayout, commitWorkbenchLayout, setDraftSession],
  );

  ensureDefaultDraftRef.current = (workspaceId: string) => {
    const pane = paneLayoutsRef.current[workspaceId];
    const focused = pane ? focusedConversationId(pane) : undefined;
    const docked = workbenchesForWorkspace(workbenchLayoutsRef.current, workspaceId)
      .flatMap(([, layout]) => [...layout.right.tabs, ...layout.bottom.tabs])
      .find(tab => tab.type === 'conversation' && tab.conversationId.startsWith('draft:'));
    const draftId = focused?.startsWith('draft:') ? focused :
      !layoutHasOpenTabs(pane) && docked?.type === 'conversation' ? docked.conversationId : undefined;
    if (draftId) {
      setDraftSession({ id: draftId, workspaceId, track: 'model', createdAt: new Date().toISOString() });
      setNav(current => openConversation(current, draftId));
      return;
    }
    if (layoutHasOpenTabs(pane)) return;
    beginDraftConversation('model', undefined, undefined, workspaceId);
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
        workspaceId: runtimeWorkspaceId(workspaceId),
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
        // Bind the turn to the workspace folder so Desktop materializes the
        // attachments beside the conversation instead of dropping them in the
        // shared chat-image-staging directory. That staging path is outside the
        // workspace the model is fenced to, so a text-only model handed it can
        // only fail — it reads the absolute path, decides the file is out of
        // bounds, and burns a turn on `ocr_image` (which then rejects it too).
        // The ChatView send path passes the same context; this one must match.
        let workspaceFolderPath = data.workspaces
          .find((workspace) => workspace.workspaceId === workspaceId)
          ?.folderPath?.trim();
        if (!workspaceFolderPath && workspaceId === PROJECTLESS_SCOPE && firstMessage.images.length > 0) {
          const key = 'data.projectless.conversation.' + created.conversation.id;
          const result = await api.getSettings({ keys: [key] });
          const directory = result.settings[key];
          if (typeof directory === 'string') workspaceFolderPath = resolveProjectRelativePath(directory, 'files');
        }
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
          attachmentContext:
            firstMessage.images.length > 0 && workspaceFolderPath
              ? { conversationId: created.conversation.id, workspacePath: workspaceFolderPath }
              : undefined,
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
        commitWorkbenchLayout(workbenchScopeKey(workspaceId, materializedDraft.id), (current) =>
          replaceWorkbenchConversation(current, materializedDraft.id, createdConversationId),
        );
        const nextWorkbenches = materializeWorkbenchScope(workbenchLayoutsRef.current, workspaceId, materializedDraft.id, createdConversationId);
        workbenchLayoutsRef.current = nextWorkbenches;
        setWorkbenchLayouts(nextWorkbenches);
        persistWorkbenchLayouts(nextWorkbenches);
        setDraftSession(null);
        setNav((current) => openConversation(current, createdConversationId));
      }

      await refresh();
      focusConversation(createdConversationId, workspaceId, created.conversation);
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
      data.workspaces,
      focusConversation,
      refresh,
      rememberTrack,
      setDraftSession,
    ],
  );

  const handlePickTarget = useCallback(
    async (track: ConversationTrack, targetRef: string) => {
      if (track !== 'model') {
        setPickerTrack(null);
        navigateAgentWorkspace({ workspaceId: activeWorkspaceId ?? PROJECTLESS_SCOPE, ...(track === 'team' ? { teamId: targetRef } : { agentId: targetRef }), fresh: true });
        return;
      }
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
    [activeWorkspaceId, beginDraftConversation, createConversationWithTarget, navigateAgentWorkspace, rememberTrack, setDraftSession],
  );

  const handleAgentChat = useCallback(
    async (agentId: string, workspaceId: string, fresh = false) => {
      if (activeWorkspaceIdRef.current !== workspaceId) return;
      const latest = agentChatHistory(data.conversations, workspaceId, agentId)[0];
      navigateAgentWorkspace({ workspaceId, ...(latest && !fresh ? { conversationId: latest.id } : { agentId, fresh: true }) });
    },
    [data.conversations, navigateAgentWorkspace],
  );

  const handleNewConversation = useCallback(
    (
      track?: ConversationTrack,
      sourceConversation?: Conversation | null,
      targetPaneId?: string,
      workbenchPlacement?: WorkbenchPlacement,
      workspaceId = activeWorkspaceId,
    ) => {
      const current =
        sourceConversation === undefined
          ? data.conversations.find((c) => c.id === nav.selectedConversationId)
          : (sourceConversation ?? undefined);
      const t = track ?? current?.track ?? 'model';
      if (t !== 'model') {
        navigateAgentWorkspace({ workspaceId: workspaceId ?? PROJECTLESS_SCOPE, ...(t === 'team' ? { teamId: current?.targetRef ?? '' } : {}), fresh: true });
        return;
      }
      exitAgentWorkspace();
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
        workspaceId,
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
      // An explicit sidebar choice may reuse the unsent draft, but its target
      // must belong to the newly selected track.
      if (track) setDraftSession({ ...draft, track, targetRef: carriedTarget });
    },
    [
      beginDraftConversation,
      data.conversations,
      data.models,
      activeWorkspaceId,
      exitAgentWorkspace,
      navigateAgentWorkspace,
      nav.selectedConversationId,
      newConversationModel,
      rememberTrack,
      setDraftSession,
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

  const composerGitNavigation = useMemo<ComposerGitNavigation>(() => ({
    workspaces: data.workspaces,
    workspaceId: activeWorkspaceId,
    onSelectWorkspace: selectWorkspace,
    onCreateWorkspace: handleOpenFolder,
    onOpenWorktree: async (folderPath, name) => {
      const existing = data.workspaces.find(workspace => workspace.folderPath && repositoryKey(workspace.folderPath) === repositoryKey(folderPath));
      if (existing) selectWorkspace(existing.workspaceId);
      else await handleCreateWorkspace({ name, folderPath });
    },
  }), [activeWorkspaceId, data.workspaces, handleCreateWorkspace, handleOpenFolder, selectWorkspace]);

  const handleUpdateWorkspace = useCallback(
    async (input: {
      workspaceId: string;
      name?: string;
      folderPath?: string;
      icon?: string | null;
    }): Promise<boolean> => {
      const api = bridge();
      if (input.workspaceId === PROJECTLESS_SCOPE || !api?.updateWorkspace) return false;
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
      if (workspaceId === PROJECTLESS_SCOPE) return false;
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
        if (workspace.workspaceId === PROJECTLESS_SCOPE) continue;
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
      if (workspaceId === PROJECTLESS_SCOPE || !api?.deleteWorkspace) return false;
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
        const nextLayouts = { ...paneLayoutsRef.current };
        delete nextLayouts[workspaceId];
        paneLayoutsRef.current = nextLayouts;
        setPaneLayouts(nextLayouts);
        persistPaneLayouts(nextLayouts);
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
      const ownerWorkspaceId = data.conversations.find(c => c.id === id)?.workspaceId ?? activeWorkspaceId;
      if (ownerWorkspaceId) {
        commitPaneLayout(ownerWorkspaceId, (current) => closeConversationInLayout(current, id));
      } else {
        setNav((n) =>
          n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
        );
      }
      // Drop from local groups.
      updateWorkspaceGroups(ownerWorkspaceId, current => ({
        model: current.model.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        agent: current.agent.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        team: current.team.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
      }));
      await refresh();
    },
    [activeWorkspaceId, commitPaneLayout, data.conversations, dialog, updateWorkspaceGroups, refresh],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      const source = data.conversations.find((c) => c.id === id);
      if (!source) return;
      const workspaceId = source.workspaceId ?? activeWorkspaceId;
      const initiatingWorkspaceId = activeWorkspaceIdRef.current;
      // Copy conversation config (track, target, workspace, execution permission,
      // bound model) and the title in a single create. Message history is NOT
      // copied: there is no Runtime command to list a conversation's messages,
      // so duplicating messages would require a new protocol command.
      const created = await api.createConversation({
        track: source.track,
        targetRef: source.targetRef,
        workspaceId: runtimeWorkspaceId(workspaceId),
        title: source.title ? `${source.title}（副本）` : undefined,
        executionMode: source.executionMode,
      });
      // Preserve group membership (front-end only; no Runtime call needed).
      const track = source.track;
      const ownerGroups = readConversationGroups(workspaceId);
      const sourceGroup = ownerGroups[track].find((g) => g.conversationIds.includes(id));
      if (sourceGroup && workspaceId) {
        updateWorkspaceGroups(workspaceId, current => moveConversationToGroup(current, track, created.conversation.id, sourceGroup.id));
      }
      await refresh();
      if (workspaceId && activeWorkspaceIdRef.current === initiatingWorkspaceId && workspaceId !== initiatingWorkspaceId) selectWorkspace(workspaceId);
      focusConversation(created.conversation.id, workspaceId, created.conversation);
    },
    [activeWorkspaceId, data.conversations, focusConversation, selectWorkspace, updateWorkspaceGroups, refresh],
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
    const conversations = filterByWorkspace(data.conversations, activeWorkspaceId).filter(c => !isAgentConversation(c));
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
  const sidebarConversations = useMemo(() => [
    ...visibleConversations,
    ...data.conversations.filter(conversation => conversation.workspaceId !== activeWorkspaceId && !isAgentConversation(conversation)),
  ], [activeWorkspaceId, data.conversations, visibleConversations]);
  const sidebarWorkspaceGroups = useMemo(() => {
    // Inactive branches read persisted groups; their writes invalidate this snapshot.
    void sidebarGroupsRevision;
    return Object.fromEntries(data.workspaces.map(workspace => [workspace.workspaceId, workspace.workspaceId === activeWorkspaceId ? groups : readConversationGroups(workspace.workspaceId)]));
  }, [activeWorkspaceId, data.workspaces, groups, sidebarGroupsRevision]);

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
        ? (workbenchLayouts[activeWorkbenchKey!] ?? createWorkspaceWorkbenchLayout())
        : undefined,
    [activeWorkspaceId, activeWorkbenchKey, workbenchLayouts],
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
        activeWorkbenchKey!,
        (current) => setWorkbenchFileBrowserWidth(current, 'right', width),
        commit,
      );
    },
    [activeWorkspaceId, activeWorkbenchKey, commitWorkbenchLayout],
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
        if (sidebarMode === 'agents') window.dispatchEvent(new CustomEvent('shell-new-agent-chat'));
        else handleNewConversation();
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
    sidebarMode,
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
  const projectlessActiveId = nav.selectedConversationId ?? (activePaneLayout ? paneConversationIds(activePaneLayout)[0] : undefined);
  const conversationFilePath = (conversation: Conversation, path: string) => {
    const root = projectlessFolders[String(conversation.id)];
    return root && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path) ? resolveProjectRelativePath(root, path) : path;
  };
  const activeProjectFolder = useMemo(
    () =>
      activeWorkspaceId === PROJECTLESS_SCOPE
        ? (projectlessActiveId ? projectlessFolders[projectlessActiveId] : undefined)
        : data.workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId)?.folderPath?.trim(),
    [activeWorkspaceId, data.workspaces, projectlessActiveId, projectlessFolders],
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
  // Panes whose conversation surface is actually mounted. NewMax has no
  // per-pane chat mount cap — `TabContent` keeps every activated conversation
  // alive — so this set is only used to decide which panes clear unread state,
  // never to park (unload) a conversation. Focused pane first is retained so the
  // visible conversation is the first to be considered watched.
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
    return new Set(ordered.filter((paneId) => candidates.includes(paneId)));
  }, [activePaneLayout]);

  useEffect(() => {
    if (nav.stage !== 'talk') return;
    setNav((current) => {
      const selectedConversationId = activePaneLayout
        ? paneKeepAliveConversationId(activePaneLayout.panes[activePaneLayout.focusedPaneId], current.selectedConversationId)
        : undefined;
      const selectedWorkbench = current.selectedConversationId && activeWorkspaceId
        ? workbenchLayoutsRef.current[workbenchScopeKey(activeWorkspaceId, current.selectedConversationId)] : undefined;
      if (selectedWorkbench && findWorkbenchConversation(selectedWorkbench, current.selectedConversationId!)) return current;
      if (current.stage !== 'talk' || current.selectedConversationId === selectedConversationId) {
        return current;
      }
      return { ...current, selectedConversationId };
    });
  }, [activePaneLayout, activeWorkspaceId, nav.stage]);

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
    () => {
      const activity = buildConversationActivity(eventHistory, data.conversations, runActivityAuthority);
      for (const [id, requests] of conversationAttention) {
        const entry = activity.get(id);
        if (entry && requests.length) activity.set(id, { ...entry, running: false });
      }
      return activity;
    },
    [eventHistory, data.conversations, runActivityAuthority, conversationAttention],
  );
  const acknowledgeAgentResults = useCallback((id: string, runIds: readonly string[]) => {
    if (!agentWorkspaceOpen || settingsOpen || !runIds.length) return;
    const visible = new Set(runIds);
    const sequence = eventHistory.reduce((latest, event) =>
      ['run.completed', 'run.failed', 'run.cancelled', 'run.paused'].includes(event.type) && visible.has(String(event.runId ?? event.payload?.runId ?? ''))
        ? Math.max(latest, event.sequence) : latest, -1);
    if (sequence < 0) return;
    setConversationLastSeen(current => {
      const next = markConversationSeen(current, id, sequence);
      if (next !== current) writeConversationLastSeen(next);
      return next;
    });
  }, [agentWorkspaceOpen, settingsOpen, eventHistory]);
  /** 对话级 running/unread map（对话 tab 与侧栏用）。 */
  const conversationActivityView = useMemo(() => {
    const map = new Map<string, ConversationActivityView>();
    for (const conversation of data.conversations) {
      const id = String(conversation.id);
      const activity = conversationActivity.get(id);
      if (!activity) continue;
      map.set(id, {
        running: activity.running,
        unread: !conversationAttention.get(id)?.length && isConversationUnread(activity, conversationLastSeen, id),
        attention: conversationAttention.get(id)?.[0]?.kind,
        failed: !conversationAttention.get(id)?.length && !activity.running && isConversationUnread(activity, conversationLastSeen, id) &&
          attentionProjection.failedIds.has(id),
      });
    }
    return map;
  }, [data.conversations, conversationActivity, conversationLastSeen, conversationAttention, attentionProjection.failedIds]);
  /** 工作区级聚合（顶部工作区 tab 用）。 */
  const workspaceActivity = useMemo(
    () => {
      const aggregate = buildWorkspaceActivity(data.conversations, conversationActivity, conversationLastSeen) as Map<string, ConversationActivityView>;
      for (const conversation of data.conversations) {
        const id = String(conversation.id);
        const workspaceId = conversation.workspaceId ?? PROJECTLESS_SCOPE;
        const attention = conversationAttention.get(id)?.[0]?.kind;
        if (attention && aggregate.get(workspaceId)?.attention !== 'answer') aggregate.set(workspaceId, { ...(aggregate.get(workspaceId) ?? { running: false, unread: false }), attention });
      }
      return aggregate;
    },
    [data.conversations, conversationActivity, conversationLastSeen, conversationAttention],
  );
  const visibleNoticeConversationIds = useMemo(() => {
    if (settingsOpen || agentWorkspaceOpen || nav.stage !== 'talk') return new Set<string>();
    return new Set(activePaneLayout ? Object.values(activePaneLayout.panes)
      .filter(pane => mountedConversationPaneIds.has(pane.id))
      .map(pane => pane.tabs.find(tab => tab.id === pane.activeTabId))
      .filter(tab => tab?.type === 'conversation').map(tab => tab.conversationId) : []);
  }, [activePaneLayout, mountedConversationPaneIds, settingsOpen, agentWorkspaceOpen, nav.stage]);
  // Only mounted talk-stage Runtime conversations count as viewed. Draft tabs
  // are ignored, while other visible panes can still clear their unread state.
  useEffect(() => {
    if (agentWorkspaceOpen || nav.stage !== 'talk' || settingsOpen) return;
    const watched = activePaneLayout
      ? Object.values(activePaneLayout.panes)
          .filter((pane) => mountedConversationPaneIds.has(pane.id))
          .map((pane) => pane.tabs.find((tab) => tab.id === pane.activeTabId))
          .filter((tab) => tab?.type === 'conversation')
          .map((tab) => tab.conversationId)
          .filter((id) => id !== draftSession?.id)
      : [];
    if (watched.length === 0) return;
    const acknowledge = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
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
    };
    acknowledge();
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => {
      window.removeEventListener('focus', acknowledge);
      document.removeEventListener('visibilitychange', acknowledge);
    };
  }, [
    activePaneLayout,
    agentWorkspaceOpen,
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
      setAgentWorkspaceOpen(false);
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
      if (track !== 'model') {
        handleNewConversation(track);
        return;
      }
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
    },
    [beginDraftConversation, data.models, handleNewConversation, newConversationModel, rememberTrack, setDraftSession],
  );

  const emptyTalk = (
    <EmptyTalk
      onAttachmentCountChange={handleDraftAttachmentCount}
      hasWorkspace={Boolean(activeWorkspaceId)}
      workspaceId={runtimeWorkspaceId(activeWorkspaceId)}
      workspaceFolder={activeWorkspaceId === PROJECTLESS_SCOPE ? undefined : activeProjectFolder}
      onOpenGit={handleOpenGit}
      gitNavigation={composerGitNavigation}
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
      onOpenPlanSettings={handleOpenPlanSettings}
      onOpenModelSettings={handleOpenModelSettings}
      onOpenMcpSettings={handleOpenMcpSettings}
      onCreateSkill={handleCreateSkill}
    />
  );

  const workbenchBrowserContexts = new Map<string, { scopeKey: string; workspaceId: string; conversationId?: string; placement: WorkbenchPlacement }>();
  const retainedWorkbenchBrowsers: Record<WorkbenchPlacement, WorkbenchTab[]> = { right: [], bottom: [] };
  for (const [scopeKey, layout] of Object.entries(workbenchLayouts)) {
    if (scopeKey !== activeWorkbenchKey && !retainedWorkbenchKeys.has(scopeKey)) continue;
    const owner = parseWorkbenchScopeKey(scopeKey);
    if (!owner) continue;
    for (const placement of ['right', 'bottom'] as const) {
      for (const tab of layout[placement].tabs) {
        if (tab.type !== 'browser') continue;
        workbenchBrowserContexts.set(tab.browserId, { scopeKey, ...owner, placement });
        retainedWorkbenchBrowsers[placement].push(tab);
      }
    }
  }

  const renderWorkbenchContent = (placement: WorkbenchPlacement, tab: WorkbenchTab) => {
    if (tab.type === 'conversation') {
      const isDraft =
        tab.conversationId === draftSession?.id || tab.conversationId.startsWith('draft:');
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
          {conversation.collaborationKind ? (
            <CollaborationChatView
              conversation={conversation}
              agents={data.agents}
              onOpenConversation={(id) => void openConversationById(id)}
              onAgentsChanged={() => void refresh()}
            />
          ) : (
            <ChatView
              key={conversation.id}
              conversation={runtimeConversation(conversation)}
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
              onOpenFile={(path, location) => handleOpenFileInWorkbench(placement, conversationFilePath(conversation, path), location)}
              onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
              onOpenWebUrl={(url) => handleOpenBrowserInWorkbench(placement, url)}
              onOpenGit={handleOpenGit}
      gitNavigation={composerGitNavigation}
              onOpenReview={(view) => handleOpenReviewInWorkbench(placement, view)}
              onOpenPlanSettings={handleOpenPlanSettings}
              onOpenMcpSettings={handleOpenMcpSettings}
              onCreateSkill={handleCreateSkill}
            />
          )}
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
          projectFolder={currentDataFolder(tab.path)}
          path={tab.path}
          onOpenPath={(path) => handleOpenFileInWorkbench(placement, path)}
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
            commitWorkbenchLayout(activeWorkbenchKey!, (current) =>
              openWorkbenchTab(current, placement, terminalWorkbenchTab(tab.terminalId, cwd)),
            );
          }}
        />
      );
    }
    if (tab.type === 'git') {
      const gitRoot = tab.projectFolder || activeProjectFolder;
      if (!gitRoot) {
        return (
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[12px] text-text-faint">未绑定项目文件夹</p>
            <p className="text-[11px] text-text-faint opacity-70">
              绑定后可在此查看分支、改动与提交
            </p>
          </div>
        );
      }
      return <GitPanel key={gitRoot} projectFolder={gitRoot} request={gitRequest?.root === gitRoot ? gitRequest : undefined} />;
    }
    const owner = workbenchBrowserContexts.get(tab.browserId);
    const scopeKey = owner?.scopeKey ?? activeWorkbenchKey!;
    const browserFolder = owner?.workspaceId === PROJECTLESS_SCOPE
      ? (owner.conversationId ? projectlessFolders[owner.conversationId] : undefined)
      : data.workspaces.find(workspace => String(workspace.workspaceId) === owner?.workspaceId)?.folderPath;
    return (
      <BrowserPanel
        key={tab.browserId}
        automationOwnerId={tab.ownerId ?? owner?.conversationId}
        initialUrl={tab.url}
        navigateUrl={aiBrowserNav?.browserId === tab.browserId ? aiBrowserNav.url : undefined}
        navigateSeq={aiBrowserNav?.browserId === tab.browserId ? aiBrowserNav.seq : undefined}
        onClose={() => commitWorkbenchLayout(scopeKey, current => closeWorkbenchTab(current, placement, tab.id))}
        onNewTab={(url = 'about:blank') => commitWorkbenchLayout(scopeKey, current =>
          openWorkbenchTab(current, placement, browserWorkbenchTab(createBrowserId(), url)))}
        onPageMeta={(meta) => {
          handleBrowserPageMeta(tab.browserId, meta);
          commitWorkbenchLayout(scopeKey, (current) =>
            updateWorkbenchBrowserUrl(current, placement, tab.browserId, meta.url),
          );
        }}
        projectFolder={browserFolder}
        partition={isLocalWebPageUrl(tab.url) ? `pane-browser-${tab.browserId}` : undefined}
        registerForAutomation
        automationActive={scopeKey === activeWorkbenchKey && activeWorkbenchLayout?.[placement].open === true && activeWorkbenchLayout[placement].activeTabId === tab.id}
      />
    );
  };

  // Stable callback bag for <SidebarSurface>. Every entry is memoised (or a
  // module-level function), so the sidebar can bail out of re-renders that have
  // nothing to do with it. The dependency list below is the complete set of
  // values these callbacks close over.
  const sidebarCallbacks = useMemo(
    () => ({
      onSelectStage: handleSelectStage,
      onToggleTrack: (track: ConversationTrack) => setNav((n) => toggleTrack(n, track)),
      onToggleSidebar: () => setNav((n) => setSidebarCollapsed(n, true)),
      onOpenConversation: (id: string) => void openConversationById(id),
      onNewConversation: (track?: ConversationTrack, workspaceId?: string) => {
        if (!workspaceId) { handleNewConversation(track); return; }
        if (workspaceId !== activeWorkspaceIdRef.current) selectWorkspace(workspaceId);
        handleNewConversation(track, null, undefined, undefined, workspaceId);
      },
      onTogglePin: (id: string, pinned: boolean) => void handleTogglePin(id, pinned),
      onRename: (id: string, currentTitle: string) => void handleRename(id, currentTitle),
      onArchive: (id: string) => void handleArchive(id),
      onUnarchive: (id: string) => void handleUnarchive(id),
      onDelete: (id: string) => void handleDelete(id),
      onDuplicate: (id: string) => void handleDuplicate(id),
      onCopyLink: (id: string) => void handleCopyLink(id),
      onCreateGroup: (track: ConversationTrack, name: string, workspaceId?: string) => {
        updateWorkspaceGroups(workspaceId, current => createConversationGroup(current, track, name));
      },
      onRenameGroup: (track: ConversationTrack, groupId: string, name: string, workspaceId?: string) => {
        updateWorkspaceGroups(workspaceId, current => renameConversationGroup(current, track, groupId, name));
      },
      onDeleteGroup: (track: ConversationTrack, groupId: string, workspaceId?: string) => {
        updateWorkspaceGroups(workspaceId, current => deleteConversationGroup(current, track, groupId));
      },
      onToggleGroupCollapsed: (track: ConversationTrack, groupId: string, workspaceId?: string) => {
        updateWorkspaceGroups(workspaceId, current => toggleConversationGroupCollapsed(current, track, groupId));
      },
      onMoveToGroup: (track: ConversationTrack, conversationId: string, groupId: string | null, workspaceId?: string) => {
        updateWorkspaceGroups(workspaceId ?? data.conversations.find(c => c.id === conversationId)?.workspaceId, current => moveConversationToGroup(current, track, conversationId, groupId));
      },
      onToggleMultiSelect: () => {
        setMultiSelect((v) => !v);
        setSelectedIds(new Set<string>());
      },
      onToggleSelected: (id: string) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      onBulkArchive: () => void handleBulkArchive(),
      onBulkDelete: () => void handleBulkDelete(),
      onBulkMoveToGroup: handleBulkMoveToGroup,
      onResizeStart: (clientX: number) => {
        if (nav.sidebarCollapsed) return;
        resizeRef.current = { startX: clientX, startWidth: sidebarWidth };
        // Drop the width transition for the duration of the drag so the panel
        // tracks the pointer 1:1 (the pattern .shell-workbench--* already uses
        // via data-resizing). Set on <html> so toggling it costs no re-render.
        document.documentElement.dataset.sidebarResizing = 'true';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      },
    }),
    [
      openConversationById,
      selectWorkspace,
      updateWorkspaceGroups,
      data.conversations,
      handleArchive,
      handleBulkArchive,
      handleBulkDelete,
      handleBulkMoveToGroup,
      handleCopyLink,
      handleDelete,
      handleDuplicate,
      handleNewConversation,
      handleRename,
      handleSelectStage,
      handleTogglePin,
      handleUnarchive,
      nav.sidebarCollapsed,
      sidebarWidth,
    ],
  );

  const headerConversation = visibleConversations.find((conversation) => conversation.id === nav.selectedConversationId);
  const workspaceHeader = (
    <TopBar
            chatLayout={nav.stage === 'talk'}
            chatTitle={headerConversation ? headerConversation.title || targetName(headerConversation, data.agents, data.teams, data.modelNames, modelOverrides) : '新对话'}
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
            attentionCenter={<span ref={setAttentionHost} className="flex shrink-0" data-testid="conversation-attention-host" />}
          />
  );

  return (
    <div className="shell-app-root flex h-full flex-col bg-page">
      <ConversationAttentionController api={bridge()} conversations={data.conversations} portalHost={attentionHost}
        workspaces={data.workspaces} events={eventHistory} authority={runActivityAuthority}
        connectionRevision={runtimeConnectionRevision} lastSeen={conversationLastSeen}
        visibleIds={visibleNoticeConversationIds} titleFor={resolveTargetName}
        onOpenConversation={id => void openConversationById(id)} onProjection={setAttentionProjection} />
      <div className="shell-normal-workspace">
      <div className="shell-boards flex min-h-0 flex-1 bg-page">
        {/* Keep sidebar mounted so width can animate on collapse/expand. */}
        <SidebarSurface
          nav={agentWorkspaceOpen ? { ...nav, selectedConversationId: undefined } : nav}
          width={sidebarWidth || SIDEBAR_WIDTH_DEFAULT}
          collapsed={nav.sidebarCollapsed}
          settingsOpen={settingsOpen}
          conversations={sidebarConversations}
          agents={data.agents}
          teams={data.teams}
          modelNames={data.modelNames}
          modelOverrides={modelOverrides}
          kernelOverrides={kernelOverrides}
          groups={groups}
          workspaceGroups={sidebarWorkspaceGroups}
          bootState={bootState}
          bootError={bootError}
          activeWorkspaceId={activeWorkspaceId}
          workspaces={data.workspaces}
          sidebarMode={sidebarMode}
          onSidebarModeChange={changeSidebarMode}
          onAgentSidebarMount={setAgentSidebarHost}
          onAgentActionsMount={setAgentActionsHost}
          onSelectWorkspace={selectWorkspace}
          workspaceActivity={workspaceActivity}
          onAgentChat={handleAgentChat}
          onAgentsRefresh={refresh}
          multiSelect={multiSelect}
          selectedIds={selectedIds}
          conversationActivity={conversationActivityView}
          {...sidebarCallbacks}
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

        <KeepAliveLayer active={!agentWorkspaceOpen} className="shell-workbench-surface">
        <main
          className={`shell-board flex min-w-0 flex-1 flex-col overflow-hidden bg-panel${nav.stage === 'talk' ? ' shell-stage--talk' : ''}`}
          data-testid="shell-stage"
        >
          {/* Workspace tabs live inside the stage board (NewMax mid-stage),
              not as a full-window chrome bar above the pure sidebar. */}
          {nav.stage !== 'talk' ? workspaceHeader : null}
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
                    {nav.stage === 'talk' ? workspaceHeader : null}
                    {shouldRenderWallpaperReadingLayers ? <Suspense fallback={null}><WallpaperReadingLayers /></Suspense> : null}
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
                          if (activeTab?.type === 'conversation') {
                            // DSH 路线：会话面不保活（RETAINED_CONVERSATION_LIMIT = 0），
                            // rememberRetainedKey 返回空数组，只有当前激活会话挂载。
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
                          // DSH 路线：会话面不保活，retained 集合恒为空，这里只保留对
                          // 已关闭会话 tab 的清理（防御性，保持存储集合与打开的 tab 一致）。
                          retainedSurfaces.conversations = retainedSurfaces.conversations.filter(
                            (id) => localConversationIds.includes(id) && id !== draftSession?.id,
                          );
                          retainedSurfacesByPaneRef.current.set(pane.id, retainedSurfaces);
                          // DSH 路线：只有当前激活的会话面挂载，其余靠
                          // `conversationScrollPositions`（无上限锚点 Map）在重挂载时恢复。
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
                            conversationSurfaceActive &&
                            keepAliveConversationId === draftSession?.id;
                          const conversation = keepAliveConversationId
                            ? visibleConversations.find(
                                (item) => item.id === keepAliveConversationId,
                              )
                            : undefined;
                          const conversationsForPane = visibleConversations.filter(
                            (item) =>
                              localConversationIds.includes(String(item.id)) ||
                              !openIdsForWorkspace.includes(String(item.id)),
                          );
                          // Every pane that has a conversation tab keeps a conversation
                          // surface mounted (the active one); splitting is always offered.
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
                                hideConversationTabs
                                compactHeader={Object.keys(activePaneLayout.panes).length === 1 && pane.tabs.every(tab => tab.type === 'conversation')}
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
                                canSplit
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
                                            {item.collaborationKind ? (
                                              <CollaborationChatView
                                                conversation={item}
                                                agents={data.agents}
                                                active={conversationActive}
                                                onOpenConversation={(id) =>
                                                  void openConversationById(id)
                                                }
                                                onAgentsChanged={() => void refresh()}
                                              />
                                            ) : (
                                              <ChatView
                                                conversation={runtimeConversation(item)}
                                                modelName={resolveTargetName(item)}
                                                models={data.models}
                                                agents={data.agents}
                                                teams={data.teams}
                                                workspaces={data.workspaces}
                                                eventHistory={eventHistory}
                                                runActivityAuthority={runActivityAuthority}
                                                runtimeConnectionRevision={
                                                  runtimeConnectionRevision
                                                }
                                                runtimeConnectionNotice={runtimeConnectionNotice}
                                                active={conversationActive}
                                                initialSkillVersionIds={initialConversationSkillSelectionsRef.current.get(
                                                  String(item.id),
                                                )}
                                                onInitialSkillSelectionConsumed={(
                                                  conversationId,
                                                ) => {
                                                  initialConversationSkillSelectionsRef.current.delete(
                                                    conversationId,
                                                  );
                                                }}
                                                seedComposerText={readSeedComposerText(
                                                  String(item.id),
                                                )}
                                                onSeedComposerTextConsumed={(conversationId) => {
                                                  seedComposerTextRef.current.delete(
                                                    conversationId,
                                                  );
                                                }}
                                                onTitleUpdated={() => void refresh()}
                                                onConversationUpdated={handleConversationUpdated}
                                                onLatestReviewChange={handleLatestReviewChange}
                                                onOpenFile={(path, location) =>
                                                  handleOpenFileInSplit(pane.id, conversationFilePath(item, path), location)
                                                }
                                                onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
                                                onOpenWebUrl={(url) =>
                                                  handleOpenBrowserInWorkbench('right', url)
                                                }
                                                onOpenGit={handleOpenGit}
      gitNavigation={composerGitNavigation}
                                                onOpenReview={(view) =>
                                                  handleOpenReviewInSplit(pane.id, view)
                                                }
                                                onOpenPlanSettings={handleOpenPlanSettings}
                                                onOpenMcpSettings={handleOpenMcpSettings}
                                                onCreateSkill={handleCreateSkill}
                                              />
                                            )}
                                          </div>
                                        );
                                      })
                                  : null}
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
                                        automationOwnerId={tab.ownerId}
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
                                        onClose={() =>
                                          handleCloseBrowserTab(pane.id, tab.browserId)
                                        }
                                        onNewTab={(url) => handleOpenBrowserInPane(pane.id, url)}
                                        onPageMeta={(meta) =>
                                          handleBrowserPageMeta(tab.browserId, meta)
                                        }
                                        projectFolder={activeProjectFolder}
                                        partition={isLocalWebPageUrl(tab.url) ? `pane-browser-${tab.browserId}` : undefined}
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
                                      activeTab?.type === 'review' && activeTab.runId === tab.runId,
                                      retainedSurfaces.reviews,
                                    ),
                                  )
                                  .map((tab) => {
                                    const reviewActive =
                                      activeTab?.type === 'review' && activeTab.runId === tab.runId;
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
                                          projectFolder={currentDataFolder(tab.path)}
                                          path={tab.path}
                                          onOpenPath={(path) => handleOpenFileInPane(pane.id, path)}
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
                    activeWorkbenchLayout.right.tabs.length > 0 || retainedWorkbenchBrowsers.right.length > 0) ? (
                    <WorkspaceWorkbench
                      placement="right"
                      chatLayout
                      open={activeWorkbenchLayout.right.open}
                      focused={workspaceChromeFocus === 'right'}
                      scope={activeWorkbenchLayout.right}
                      retainedBrowserTabs={retainedWorkbenchBrowsers.right}
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
                  activeWorkbenchLayout.bottom.tabs.length > 0 || retainedWorkbenchBrowsers.bottom.length > 0) ? (
                  <WorkspaceWorkbench
                    placement="bottom"
                    open={activeWorkbenchLayout.bottom.open}
                    focused={workspaceChromeFocus === 'bottom'}
                    scope={activeWorkbenchLayout.bottom}
                    retainedBrowserTabs={retainedWorkbenchBrowsers.bottom}
                    canOpenTerminal={Boolean(activeProjectFolder)}
                    renderContent={(tab) => renderWorkbenchContent('bottom', tab)}
                    browserPageMeta={browserPageMeta}
                    conversationTabMeta={workbenchConversationMeta}
                    onActivateTab={(tabId) => handleActivateWorkbenchTab('bottom', tabId)}
                    onCloseTab={(tab) => void handleCloseWorkbenchTab('bottom', tab)}
                    onNewResource={(resource) => handleWorkbenchNewResource('bottom', resource)}
                    onChromeFocus={() => setWorkspaceChromeFocus('bottom')}
                    onClose={() => handleCloseWorkbench('bottom')}
                    onSizeChange={(size, commit) =>
                      handleWorkbenchSizeChange('bottom', size, commit)
                    }
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
                workspaces={data.workspaces.filter(workspace => workspace.workspaceId !== PROJECTLESS_SCOPE)}
                onRefresh={() => void refresh()}
                onManageSkills={() => setNav((n) => selectStage(n, 'abilities'))}
                onGoToAbilities={() => setNav((n) => selectStage(n, 'abilities'))}
                onBack={() => setNav((n) => ({ ...n, stage: 'talk' }))}
                skillCatalogRevision={skillCatalogRevision}
                onStartConversation={(agentId) => {
                  void handlePickTarget('agent', agentId);
                  setNav((n) => ({ ...n, stage: 'talk' }));
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
              <BrowserStage onStartAiTask={handleStartBrowserAiTask} workspaces={data.workspaces.filter(workspace => workspace.workspaceId !== PROJECTLESS_SCOPE)} activeWorkspaceId={runtimeWorkspaceId(activeWorkspaceId)} active={nav.stage === 'browser'} />
            </KeepAliveLayer>
            <KeepAliveLayer
              active={nav.stage === 'abilities'}
              className="shell-stage-layer"
              testId="stage-abilities"
            >
              <AbilitiesPage
                activeWorkspaceId={runtimeWorkspaceId(activeWorkspaceId)}
                workspaces={data.workspaces.filter(workspace => workspace.workspaceId !== PROJECTLESS_SCOPE)}
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
                workspaces={data.workspaces.filter(workspace => workspace.workspaceId !== PROJECTLESS_SCOPE)}
                skills={data.skills}
                onNotify={(tone, text) => {
                  toastApi.toast({ type: toastTypeFromTone(tone), title: text });
                }}
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
                workspaces={data.workspaces}
                conversations={data.conversations}
                onNewConversation={() => {
                  selectWorkspace(PROJECTLESS_SCOPE);
                  beginDraftConversation('model', newConversationModel, undefined, PROJECTLESS_SCOPE);
                  setNav(n => selectStage(n, 'talk'));
                }}
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
        </KeepAliveLayer>
      <div className="shell-agent-chat-mode shell-board" hidden={!agentWorkspaceOpen}>
      <KeepAliveLayer active={sidebarMode === 'agents' || agentWorkspaceOpen} className="shell-agent-content-host">
        <AgentWorkspace
          embedded
          sidebarHost={agentSidebarHost}
          actionsHost={agentActionsHost}
          sidebarVisible={sidebarMode === 'agents'}
          contentActive={agentWorkspaceOpen}
          onContentSelected={enterAgentWorkspace}
          onOpenSidebar={() => { changeSidebarMode('agents'); setNav(n => ({ ...n, sidebarCollapsed: false })); }}
          key={activeWorkspaceId ?? PROJECTLESS_SCOPE}
          workspaceId={activeWorkspaceId ?? PROJECTLESS_SCOPE}
          workspaces={data.workspaces}
          conversations={data.conversations}
          agents={data.agents}
          teams={data.teams}
          models={data.models}
          onResultsViewed={acknowledgeAgentResults}
          navigation={agentNavigation?.workspaceId === (activeWorkspaceId ?? PROJECTLESS_SCOPE) ? agentNavigation : undefined}
          onNavigationHandled={() => setAgentNavigation(undefined)}
          loading={bootState === 'loading'}
          conversationActivity={conversationActivityView}
          onExit={exitAgentWorkspace}
          onSelectWorkspace={selectWorkspace}
          onRefresh={refresh}
          onSettings={() => handleSelectStage('settings')}
          onManageAgents={() => { exitAgentWorkspace(); handleSelectStage('agents'); }}
          onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
          onRename={(id, title) => void handleRename(id, title)}
          onArchive={(id) => void handleArchive(id)}
          onUnarchive={(id) => void handleUnarchive(id)}
          renderAgentLibrary={(onBack, onStartConversation, initialAgentId) => <AgentLibrary
            initialAgentId={initialAgentId}
            agents={data.agents}
            models={data.models}
            teams={data.teams}
            workspaces={data.workspaces.filter(workspace => workspace.workspaceId !== PROJECTLESS_SCOPE)}
            onRefresh={() => void refresh()}
            onBack={onBack}
            onStartConversation={onStartConversation}
            onManageSkills={() => { onBack(); exitAgentWorkspace(); handleSelectStage('abilities'); }}
            onGoToAbilities={() => { onBack(); exitAgentWorkspace(); handleSelectStage('abilities'); }}
            skillCatalogRevision={skillCatalogRevision}
          />}
          renderLegacyConversation={(conversation, onEditAgent, agents, onResultsViewed) => <ChatView onResultsViewed={onResultsViewed} agentWorkspace onEditAgent={onEditAgent}
            key={conversation.id}
            conversation={runtimeConversation(conversation)}
            modelName={resolveTargetName(conversation)}
            models={data.models}
            agents={agents}
            teams={data.teams}
            workspaces={data.workspaces}
            eventHistory={eventHistory}
            runActivityAuthority={runActivityAuthority}
            runtimeConnectionRevision={runtimeConnectionRevision}
            runtimeConnectionNotice={runtimeConnectionNotice}
            onTitleUpdated={() => void refresh()}
            onConversationUpdated={handleConversationUpdated}
            onOpenFile={(path, location) => { exitAgentWorkspace(); handleOpenFileInWorkbench('right', conversationFilePath(conversation, path), location); }}
            onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
            onOpenPlanSettings={handleOpenPlanSettings}
            onOpenMcpSettings={handleOpenMcpSettings}
            onCreateSkill={handleCreateSkill}
          />}
        />
      </KeepAliveLayer>
      </div>
      </div>
      </div>

      <Dialog.Root
        open={Boolean(pendingChatBrowserWorkflow)}
        onOpenChange={(open) => {
          if (!open && !savingChatBrowserWorkflow) setPendingChatBrowserWorkflow(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/35" />
          <Dialog.Content
            data-testid="chat-browser-workflow-save-dialog"
            className="fixed left-1/2 top-1/2 z-[81] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-5 shadow-2xl"
          >
            <Dialog.Title className="text-[14px] font-semibold text-text">
              保存本次浏览器操作
            </Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[11.5px] leading-5 text-text-faint">
              {pendingChatBrowserWorkflow?.partial
                ? '本次任务部分完成，已产生可复用浏览器步骤。保存为草稿后可让 AI 继续改进。'
                : '本次任务已完成并产生可复用浏览器步骤。可以保存草稿或直接发布。'}
            </Dialog.Description>
            <div className="mt-3 rounded-md border border-border bg-elevated px-3 py-2 text-[10.5px] text-text-secondary">
              <span className="tabular-nums">
                {pendingChatBrowserWorkflow?.steps.length ?? 0} 个有效步骤
              </span>
              <span className="mx-2 text-text-faint">·</span>
              <span className="break-all">{pendingChatBrowserWorkflow?.startUrl}</span>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded-md px-3 text-[11.5px] text-text-secondary hover:bg-hover"
                  disabled={savingChatBrowserWorkflow}
                >
                  关闭
                </button>
              </Dialog.Close>
              <button
                type="button"
                data-testid="chat-browser-workflow-save-draft"
                className="h-8 rounded-md border border-border px-3 text-[11.5px] font-medium text-text hover:bg-hover disabled:opacity-50"
                disabled={savingChatBrowserWorkflow}
                onClick={() => void importChatBrowserWorkflow(false)}
              >
                保存为草稿
              </button>
              {!pendingChatBrowserWorkflow?.partial ? (
                <button
                  type="button"
                  data-testid="chat-browser-workflow-publish"
                  className="h-8 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
                  disabled={savingChatBrowserWorkflow}
                  onClick={() => void importChatBrowserWorkflow(true)}
                >
                  发布正式任务
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
  onOpenGit?: (root: string, section: GitPanelSection) => void;
  gitNavigation?: ComposerGitNavigation;
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
  onAttachmentCountChange?(count: number): void;
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
  onOpenPlanSettings?(): void;
  onOpenModelSettings?(): void;
  onOpenMcpSettings?(): void;
  onCreateSkill?(): void;
}) {
  const { toast } = useToast();
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
  const onAttachmentCountChange = props.onAttachmentCountChange;
  const [dragOver, setDragOver] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | undefined>();
  const imageUploads = useComposerImageUploads({
    attachments, setAttachments,
    scopeKey: JSON.stringify([props.workspaceId, props.draftConversationId]),
    onError: (file) => setComposeNotice(`图片读取失败：${file.name || '未命名图片'}`),
  });
  useEffect(() => {
    onAttachmentCountChange?.(imageUploads.items.length);
    return () => onAttachmentCountChange?.(0);
  }, [imageUploads.items.length, onAttachmentCountChange]);
  useEffect(() => {
    if (!props.error) return;
    const title =
      /Error invoking|Runtime(?:Transient|Response)Error|Runtime request timed out/i.test(
        props.error,
      )
        ? classifyAppendMessageFailure(props.error).message
        : formatRuntimeIpcError(props.error, props.error);
    toast({
      type: 'error',
      title,
      id: 'empty-talk-error',
    });
  }, [props.error, toast]);
  useEffect(() => {
    if (!composeNotice) return;
    toast({
      type: /失败/.test(composeNotice) ? 'error' : 'warning',
      title: composeNotice,
      id: 'empty-talk-notice',
    });
  }, [composeNotice, toast]);
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
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<HTMLDivElement | null>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const dismissedSlashTextRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
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
    void loadSkillCatalog(api, { workspaceId: props.workspaceId as WorkspaceId | undefined })
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

  const addImageFiles = imageUploads.addFiles;

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
    if (imageUploads.isBusy()) return false;
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

  // Existing runtime controls, arranged in the attachment composer footer.
  const pillAttachControl = (
    <ComposerAddControl
      variant="empty"
      showReferenceTrigger={draftTrack !== 'model'}
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
        setModelMenuOpen(false);
      }}
      workspaceFolder={props.workspaceFolder}
      selectedFilePaths={attachments
        .filter((attachment) => attachment.kind !== 'image')
        .map((attachment) => attachment.path)}
      networkEnabled={networkEnabled}
      permissionMode={permissionMode}
      showPermissionItems={composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL}
      disabled={props.sending}
      attachDisabled={
        imageUploads.items.filter((attachment) => attachment.kind === 'image').length >= 8
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
  );
  const pillStatusControls = (
    <>
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
        hidden={composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL}
      >
        <PermissionTrigger
          ref={permissionButtonRef}
          value={permissionMode}
          open={permissionMenuOpen}
          onClick={() => {
            setModelMenuOpen(false);
            setPermissionMenuOpen((value) => !value);
          }}
        />
        <PermissionMenu
          open={permissionMenuOpen}
          value={permissionMode}
          anchorEl={permissionButtonRef.current}
          onClose={() => setPermissionMenuOpen(false)}
          onChange={setPermissionMode}
        />
      </div>
      <div className="shell-compose__tool-wrap" data-testid="empty-compose-skill-control" hidden={composerToolbar.collapseLevel >= SKILL_COLLAPSED_TOOLBAR_LEVEL}>
        <TurnSkillControl
          owner={skillOwner}
          workspaceId={props.workspaceId}
          open={skillMenuOpen}
          selectedSkillVersionIds={selectedSkillVersionIds}
          onOpenChange={(open) => {
            if (open) {
              setPermissionMenuOpen(false);
              setModelMenuOpen(false);
            }
            setSkillMenuOpen(open);
          }}
          onChange={updateSelectedSkillVersionIds}
        />
      </div>
    </>
  );
  const pillKernelStatus = (
    <>
      {kernelOverride !== 'native'
        ? (() => {
            const label = resolveKernelDisplayName(kernelOverride, activeKernel?.name);
            const logo = resolveKernelBrandLogo(activeKernel ? activeKernel.icon : kernelOverride);
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
    </>
  );
  const pillIdentityStatus = (
    <>
      <ComposerIdentity
        track={draftTrack}
        label={identityLabel}
        avatar={identityAvatar}
        testId="empty-compose-identity"
      />
      <ContextRing
        showUsageLabel
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
    </>
  );

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
        <p className="shell-welcome-description">描述你的想法，或选择一个场景开始。</p>
      </div>

      <div
        className="shell-chat-content-wrap shell-empty-newmax-composer-wrap shrink-0"
        data-locked={props.hasWorkspace ? undefined : 'true'}
        data-testid="empty-compose-wrap"
      >
        <div className="shell-chat-content shell-chat-content--composer mx-auto">
          <NewMaxComposerFrame
            variant="empty"
            presentation="attachments"


            contextBar={
              props.workspaceFolder && props.onOpenGit ? (
                <ComposerGitBar
                  projectFolder={props.workspaceFolder}
                  navigation={props.gitNavigation}
                  onOpenGit={props.onOpenGit}
                />
              ) : null
            }
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
                  props.hasWorkspace ? '输入消息…（输入 / 打开快捷面板）' : '打开工作区后即可输入'
                }
                value={props.draft}
                inputElementRef={inputRef}
                inputTestId="empty-compose-input"
                testId="empty-composer-editor"
                attachments={imageUploads.items}
                selectedSkills={selectedSlashSkills}
                disabled={!props.hasWorkspace || props.sending}
                minHeight={36}
                maxHeight={200}
                chatFontSize={appearance.chatFontSize}
                serifFontFamily={appearance.useSerifFont ? 'var(--font-serif)' : 'var(--font-sans)'}
                onRemoveAttachment={imageUploads.remove}
                onRemoveSkill={(skillVersionId) =>
                  updateSelectedSkillVersionIds(
                    selectedSkillVersionIds.filter((selected) => selected !== skillVersionId),
                  )
                }
                onChange={(value, selection) => {
                  props.onDraftChange(value);
                  setComposeNotice(undefined);
                  const caret = selection.start;
                  if (composerAddOpen && !detectSlashQuery(value, caret)) {
                    setSlash(null);
                    setSlashIndex(-1);
                    return;
                  }
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
                  const value = inputRef.current?.value ?? props.draft;
                  if (composerAddOpen && !detectSlashQuery(value, start)) return;
                  updatePickersFromCaret(value, start);
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
            <div ref={composerToolbar.outerRef} className="shell-compose__bar" data-testid="empty-compose-toolbar">
              <div ref={composerToolbar.leftRef} className="shell-compose__bar-left">
                {pillAttachControl}{pillStatusControls}
              </div>

              <div ref={composerToolbar.rightRef} className="shell-compose__bar-right">
                {pillIdentityStatus}{pillKernelStatus}

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
                          composerModel?.displayName ?? composerModelSelection.modelId ?? '选择模型'
                        }
                        planReasoningLabel={
                          REASONING_LABELS[composerModelSelection.reasoningEffort]
                        }
                        open={modelMenuOpen}
                        buttonRef={modelButtonRef}
                        onClick={() => {
                          setPermissionMenuOpen(false);
                          setSkillMenuOpen(false);
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

                </div>
                <ComposerActionSlot
                  presentation="paired"
                  testIdPrefix="empty-compose"
                  hasContent={Boolean(props.draft.trim() || imageUploads.items.length > 0)}
                  running={false}
                  voiceActive={voiceInputActive}
                  disabled={props.sending}
                  sendDisabled={imageUploads.pending}
                  onVoice={toggleVoiceInput}
                  onSend={() => void submit()}
                  onStop={() => undefined}
                />
              </div>
            </div>
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
          const target = event.target as Node | null;
          if (
            typeof document !== 'undefined' &&
            document.querySelector('[data-testid="app-dialog"]')?.contains(target)
          ) {
            event.preventDefault();
            return;
          }
          if (
            target instanceof Element &&
            (target.closest('.image-api-select__menu') ||
              target.closest('.model-overflow-menu') ||
              target.closest('.model-list-select__menu'))
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
