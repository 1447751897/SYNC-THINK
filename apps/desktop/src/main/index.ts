// Electron main entry. UI lifecycle is decoupled from the Runtime by design — the Runtime runs as a separate process and survives UI restarts (ADR-006).
// The main process owns the safe-storage-based credential broker (TD-005).
//
// Phase 0: this file is type-only; the binary itself is blocked on installing
// Visual Studio Build Tools. Once installed and `pnpm rebuild electron` runs,
// `pnpm dev:desktop` launches this module.

import { registerConversationQueryHandlers } from './conversation-query-handlers.js';
import {
  registerConversationWriteHandlers,
  type StagedAppendMessagePayload,
} from './conversation-write-handlers.js';
import { registerConversationTransientHandlers } from './conversation-transient-handlers.js';
import { registerConversationApprovalHandlers } from './conversation-approval-handlers.js';
import { registerConversationBrowserHandlers } from './conversation-browser-handlers.js';
import { registerConversationManagementHandlers } from './conversation-management-handlers.js';
import { registerConversationRoutingHandlers } from './conversation-routing-handlers.js';
import { registerConversationPlanHandlers } from './conversation-plan-handlers.js';
import { registerConversationAskHandlers } from './conversation-ask-handlers.js';
import { registerScheduledTaskHandlers } from './scheduled-task-handlers.js';
import { registerActivityHandlers } from './activity-handlers.js';
import { registerGoalHandlers } from './goal-handlers.js';
import { registerSkillLocalHandlers } from './skill-local-handlers.js';
import { registerSkillMarketHandlers } from './skill-market-handlers.js';
import { registerSkillHandlers } from './skill-handlers.js';
import { registerMcpRegistryHandlers } from './mcp-registry-handlers.js';
import { registerMcpToolHandlers } from './mcp-tool-handlers.js';
import { registerBotChannelHandlers } from './bot-channel-handlers.js';
import { registerCapabilityGovernanceHandlers } from './capability-governance-handlers.js';
import { registerPromptDesignHandlers } from './prompt-design-handlers.js';
import { registerWorkspaceHandlers } from './workspace-handlers.js';
import { registerTaskHandlers } from './task-handlers.js';
import { registerParticipationModeHandlers } from './participation-mode-handlers.js';
import { registerPlanHandlers } from './plan-handlers.js';
import { registerRunControlHandlers } from './run-control-handlers.js';
import { registerArtifactHandlers } from './artifact-handlers.js';
import { registerProviderCatalogHandlers } from './provider-catalog-handlers.js';
import { registerProviderCredentialHandlers } from './provider-credential-handlers.js';
import { registerProviderModelHandlers } from './provider-model-handlers.js';
import { registerProviderDiscoveryHandlers } from './provider-discovery-handlers.js';
import { registerProviderBalanceHandlers } from './provider-balance-handlers.js';
import { registerProviderCcSwitchHandlers } from './provider-cc-switch-handlers.js';
import { registerWebSearchProviderHandlers } from './web-search-provider-handlers.js';
import { registerDataManagementHandlers } from './data-management-handlers.js';
import { registerBrowserProfileHandlers } from './browser-profile-handlers.js';
import { registerBrowserRecordingHandlers } from './browser-recording-handlers.js';
import { registerBrowserWorkflowHandlers } from './browser-workflow-handlers.js';
import { registerBrowserHandoffHandlers } from './browser-handoff-handlers.js';
import { registerDesktopCommandHandlers } from './desktop-command-handlers.js';
import { registerBrowserExtensionHandlers } from './browser-extension-handlers.js';
import { registerApprovalHandlers } from './approval-handlers.js';
import { registerMemoryHandlers } from './memory-handlers.js';
import { registerContextPacketHandlers } from './context-packet-handlers.js';
import { registerDiagnosticsHandlers } from './diagnostics-handlers.js';
import { registerGatewayHandlers } from './gateway-handlers.js';
import { registerKernelHandlers } from './kernel-handlers.js';
import { registerSettingsHandlers } from './settings-handlers.js';
import { registerPolicyHandlers } from './policy-handlers.js';
import { registerUsageHandlers } from './usage-handlers.js';
import { registerAgentHandlers } from './agent-handlers.js';
import { registerGlobalAgentHandlers } from './global-agent-handlers.js';
import { registerTeamHandlers } from './team-handlers.js';

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  createDesktopDiagnosticsBundle,
  DEFAULT_KNOWN_LIMITATIONS,
  DEFAULT_RECOVERY_INSTRUCTIONS,
  DesktopCrashJournal,
  writeDesktopDiagnosticsBundle,
} from './diagnostics-export.js';
import {
  parseExportDesktopDiagnosticsPayload,
  type ExportDesktopDiagnosticsResponse,
} from '../diagnostics-export-contract.js';
import type {
  ManagedKernelUpdateId,
  ManagedKernelUpdateSnapshot,
} from '../kernel-update-contract.js';
import {
  createDesktopTray,
  destroyDesktopTray,
  isDesktopTrayActive,
  type DesktopTrayConversation,
} from './desktop-tray.js';
import { FileRuntimeActivityCursorStore } from './runtime-activity-cursor-store.js';
import {
  isAllowedM1OpenDocId,
  isValidDogfoodDayDate,
  resolveDocsDevelopmentDir,
  resolveM1OpenDocPath,
  type M1OpenDocId,
} from './m1-open-doc.js';
import { listProjectFiles } from './project-files.js';
import {
  checkoutProjectBranch,
  commitProjectChanges,
  createProjectBranch,
  getProjectGitInfo,
  getProjectGitReview,
  pushProjectBranch,
} from './project-git.js';
import { ProjectContentSearchRegistry, searchProjectContent } from './project-content-search.js';
import { parseProjectTerminalCommand, resolveProjectTerminalCwd } from './project-terminal.js';
import { killAllPtys, killWindowPtys, registerPtyTerminalHandlers } from './pty-service.js';
import {
  ProjectTerminalRegistry,
  type ProjectTerminalReservation,
} from './project-terminal-registry.js';
import {
  LOCAL_WEB_PAGE_SCHEME,
  LocalWebPageRegistry,
  registerLocalWebPageProtocol,
} from './local-web-page-registry.js';
import { installBrowserWebviewPopupHandler } from './browser-webview-popup.js';
import {
  readProjectFile,
  watchProjectFile,
  writeProjectFile,
  type ProjectFileChange,
} from './project-file-editor.js';
import { findDeepLinkInArgv, parseDeepLinkUrl } from './deep-link.js';
import { listDogfoodDayReports } from './m1-exit-evidence-load.js';
import { parseHandtestDocMarkdown } from '../m1-handtest-doc-parse.js';
import { fileURLToPath } from 'node:url';
import { parseListDiagnosticsPayload } from '../memory-payloads.js';
import type { Event } from '@sync-think/shared';
import { ElectronSafeStorageBackend, SecureStore } from '@sync-think/secure-store';
import {
  assertTrustedRendererIpcSource,
  installNavigationGuards,
  isTrustedRendererUrl,
  parseLoopbackDevServerUrl,
  trustedFileLocation,
} from './renderer-security.js';
import { normalizeExternalUrl } from '../external-link-contract.js';
import type { TrustedRendererLocation } from './renderer-security.js';
import {
  DesktopUpdateController,
  resolveDesktopUpdateConfiguration,
  type DesktopUpdateBundledFeedOverrides,
  type DesktopUpdateConfiguration,
} from './desktop-updater.js';
import { readBundledDesktopUpdateFeedConfiguration } from './desktop-update-bundled-config.js';
import { createElectronUpdaterDriver } from './electron-updater-driver.js';
import {
  readDesktopUpdatePreferences,
  shouldAutoCheckDesktopUpdates,
  writeDesktopUpdatePreferences,
} from './desktop-update-preferences.js';
import {
  DesktopUpdateRollbackCoordinator,
  resolveDesktopUpdateRecoveryRoot,
} from './desktop-update-rollback-coordinator.js';
import {
  desktopUpdateInstallProbeHandoffPath,
  resolveDesktopUpdateInstallProbeBootstrap,
  runDesktopUpdateInstallProbe,
  writeDesktopUpdateInstallProbeHandoff,
} from './desktop-update-install-probe.js';
import { classifyRuntimeConnectError, RuntimePipeClient } from './runtime-client.js';
import { RuntimeSession } from './runtime-session.js';
import {
  ensureDaemonAutostartDefault,
  ensureDaemonProcess,
  ensureRuntimeProcess,
  probeDaemonPipe,
  probeRuntimePipe,
  readDaemonLogs,
  RUNTIME_COLD_START_TIMEOUT_MS,
  requestDaemonFrame,
  resolveManagedRuntimeDatabasePath,
  resolveNodeBinary,
  setDaemonAutostart,
  stopManagedDaemon,
  stopManagedRuntime,
  waitForRuntimeProcess,
} from './runtime-supervisor.js';
import {
  createKernelUpdateService,
  resolveKernelInstallerInvocation,
  type KernelUpdateService,
} from './kernel-update-service.js';
import { ArtifactImagePreviewRegistry } from './artifact-image-preview.js';
import {
  describeDesktopRuntimeIdentity,
  resolveDesktopRuntimeIdentity,
  type DesktopRuntimeIdentity,
} from './packaged-install-identity.js';
import { materializeChatImageDataUrl, stageChatImageDataUrl } from './image-staging.js';
import { messageImageUrl, persistMessageImages, readMessageImage } from './message-images.js';
import { readApprovalRequestImage } from './approval-request-images.js';
import {
  type RuntimeConnectOutcome,
  type RuntimeConnectResult,
} from '../runtime-bridge-contract.js';
import {
  executeDesktopShutdownPlan,
  planDesktopShutdown,
  type DesktopShutdownReason,
} from './desktop-runtime-lifecycle.js';
import { TerminalProcessWorker, type TerminalWorkerOutput } from '@sync-think/workers';
import type {
  CancelProjectTerminalPayload,
  ProjectTerminalEvent,
  SearchProjectContentPayload,
  StartProjectTerminalPayload,
  StartProjectTerminalResult,
} from '../workspace-tools-contract.js';

// The main process may outlive the console it was launched from (a dev shell
// that closed, a background job whose pipes were torn down). A console write to
// the closed pipe then raises EPIPE; without an 'error' listener Node turns it
// into an uncaught exception in the main process and Electron shows a
// "JavaScript error occurred in the main process" dialog on every log line
// (e.g. runtime stderr forwarded by the supervisor during message traffic).
// Logging is best-effort — never let a broken console crash the app.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {
    /* swallow: console/pipe may be gone; logging is best-effort */
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sync-think-image',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: LOCAL_WEB_PAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const defaultDesktopUserDataPath = app.getPath('userData');
const desktopUpdateInstallProbeHandoff = desktopUpdateInstallProbeHandoffPath(
  defaultDesktopUserDataPath,
);
const desktopUpdateInstallProbeBootstrap = resolveDesktopUpdateInstallProbeBootstrap({
  rawConfiguration: process.env.SYNC_THINK_UPDATE_INSTALL_E2E_CONFIG,
  handoffPath: desktopUpdateInstallProbeHandoff,
  executablePath: process.execPath,
});
for (const [key, value] of Object.entries(desktopUpdateInstallProbeBootstrap?.environment ?? {})) {
  process.env[key] = value;
}
const desktopUpdateInstallProbeConfiguration =
  desktopUpdateInstallProbeBootstrap?.configuration ?? null;
if (desktopUpdateInstallProbeConfiguration) {
  app.setPath('userData', desktopUpdateInstallProbeConfiguration.userDataPath);
}
const artifactImagePreviewRegistry = new ArtifactImagePreviewRegistry(
  path.join(path.dirname(resolveManagedRuntimeDatabasePath()), 'artifacts', 'generated-images'),
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopCrashJournal = new DesktopCrashJournal({
  root: path.join(app.getPath('userData'), 'diagnostics', 'crashes'),
  homeDirectory: app.getPath('home'),
});

let mainWindow: BrowserWindow | null = null;
let registeredQuickWindowShortcut: string | null = null;
/**
 * Set once a real quit is under way, so `close` stops diverting the window to
 * the tray. Without it the tray 退出 entry would be swallowed by the
 * close-to-tray interception and the app could never exit.
 */
let isQuitting = false;
let trustedRendererLocation: TrustedRendererLocation | null = null;
let runtimeClient: RuntimePipeClient | null = null;
let desktopRuntimeIdentity: DesktopRuntimeIdentity | null = null;
let shutdownStarted = false;
let runtimeShutdownComplete = false;
let runtimeSession: RuntimeSession | null = null;
let daemonAutostartFailureLogged = false;
let desktopUpdateController: DesktopUpdateController | null = null;
let kernelUpdateService: KernelUpdateService | null = null;
let desktopUpdateRollbackCoordinator: DesktopUpdateRollbackCoordinator | null = null;
let desktopUpdateRollbackHealthPromise: Promise<void> | null = null;
let desktopShutdownPromise: Promise<void> | null = null;
type KernelInstallResult = { ok: true } | { ok: false; error: string };
let piKernelInstallPromise: Promise<KernelInstallResult> | null = null;
const projectFileWatchCleanupRegisteredSenders = new Set<number>();
const projectFileWatchSubscriptions = new Map<string, { senderId: number; dispose: () => void }>();
const projectTerminalCleanupRegisteredSenders = new Set<number>();
const projectContentSearchCleanupRegisteredSenders = new Set<number>();
const projectContentSearchRegistry = new ProjectContentSearchRegistry();
const localWebPageRegistries = new Map<string, LocalWebPageRegistry>();
const DEFAULT_LOCAL_WEB_PARTITION = 'persist:browser-panel';

/**
 * Partition prefix that marks an interactive HTML / design-draft preview guest.
 * Mirrors NewMax (`newmax-visualization-<random>`): the renderer creates a
 * throwaway in-memory partition per preview component, and the main process is
 * the only place that turns that name into a preload. A guest page cannot
 * choose its own partition, so the prefix is a host-controlled capability
 * rather than page-controlled input.
 */
const VISUALIZATION_PARTITION_PREFIX = 'sync-think-visualization-';
const VISUALIZATION_PARTITION_RE = new RegExp(
  `^${VISUALIZATION_PARTITION_PREFIX}[a-z0-9-]{1,96}$`,
  'i',
);

function isVisualizationPartition(value: unknown): boolean {
  return typeof value === 'string' && VISUALIZATION_PARTITION_RE.test(value);
}

function localWebPagePersistencePath(partition: string): string {
  // Partition names contain `:` on purpose, so encode them instead of using
  // them directly as Windows file names. A fixed-size digest also keeps the
  // file name below the Windows component limit for 200-character partitions.
  const key = createHash('sha256').update(partition).digest('hex');
  return path.join(app.getPath('userData'), 'browser', 'local-pages', `${key}.json`);
}

function normalizeLocalWebPartition(value: unknown): string {
  if (value === undefined) return DEFAULT_LOCAL_WEB_PARTITION;
  if (typeof value !== 'string') throw new Error('Invalid local web partition');
  const partition = value.trim();
  if (
    !partition ||
    partition.length > 200 ||
    partition.includes('\0') ||
    !/^[A-Za-z0-9:_-]+$/.test(partition)
  ) {
    throw new Error('Invalid local web partition');
  }
  return partition;
}

function localWebPageRegistryForPartition(partition: string): LocalWebPageRegistry {
  const existing = localWebPageRegistries.get(partition);
  if (existing) return existing;
  const registry = new LocalWebPageRegistry({
    persistencePath: localWebPagePersistencePath(partition),
  });
  registerLocalWebPageProtocol(session.fromPartition(partition), registry);
  localWebPageRegistries.set(partition, registry);
  return registry;
}

function recordDesktopCrashEvidence(input: {
  source: 'main' | 'renderer' | 'runtime' | 'worker' | 'updater';
  kind: string;
  summary: string;
  detail?: Record<string, unknown>;
}): void {
  void desktopCrashJournal
    .append({
      source: input.source,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail ?? {},
    })
    .catch((error: unknown) => {
      console.warn('[desktop] crash evidence append failed', errorMessage(error));
    });
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  recordDesktopCrashEvidence({
    source: 'main',
    kind: 'uncaught-exception',
    summary: error.message,
    detail: { name: error.name, stack: error.stack, origin },
  });
});
process.on('unhandledRejection', (reason) => {
  recordDesktopCrashEvidence({
    source: 'main',
    kind: 'unhandled-rejection',
    summary: errorMessage(reason),
    detail: reason instanceof Error ? { name: reason.name, stack: reason.stack } : { reason },
  });
});
app.on('child-process-gone', (_event, details) => {
  recordDesktopCrashEvidence({
    source: details.type === 'Utility' ? 'worker' : 'runtime',
    kind: 'child-process-gone',
    summary: `${details.type} process ended: ${details.reason}`,
    detail: {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
    },
  });
});

interface ActiveProjectTerminalCommand {
  senderId: number;
  terminalId: string;
  commandId: string;
  root: string;
  cwd: string;
  controller: AbortController;
  sender: IpcMainInvokeEvent['sender'];
}

const projectTerminalRegistry = new ProjectTerminalRegistry<ActiveProjectTerminalCommand>();

function getKernelUpdateService(): KernelUpdateService {
  if (kernelUpdateService) return kernelUpdateService;
  const rootDir = path.join(path.dirname(resolveManagedRuntimeDatabasePath()), 'kernels');
  const nodeExecutable = resolveNodeBinary();
  kernelUpdateService = createKernelUpdateService({
    rootDir,
    installer: resolveKernelInstallerInvocation(nodeExecutable),
  });
  return kernelUpdateService;
}

function broadcastKernelUpdateState(snapshot: ManagedKernelUpdateSnapshot): void {
  const target = mainWindow?.webContents;
  if (target && !target.isDestroyed()) target.send('desktop:kernel-update-state', snapshot);
}

async function recyclePrivateKernel(kernelId: ManagedKernelUpdateId): Promise<void> {
  if (kernelId !== 'codex' && kernelId !== 'claude-code') return;
  try {
    await ensureRuntimeConnection();
    await getRuntimeClient().requestKernel('kernel.recycle', { kernelId });
  } catch (error) {
    console.warn('[desktop] private kernel installed but resident recycle failed', error);
  }
}

async function bootstrapPrivateKernelsAtStartup(): Promise<void> {
  const service = getKernelUpdateService();
  const snapshot = service.getSnapshot();
  if (!snapshot.installerAvailable) return;
  const missing = snapshot.items.filter((item) => !item.managedVersion && item.kernelId !== 'pi');
  const results = await Promise.allSettled(
    missing.map(async (item) => {
      const result = await service.installUpdate(item.kernelId);
      broadcastKernelUpdateState(result.state);
      if (result.ok) await recyclePrivateKernel(item.kernelId);
      return result;
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const item = missing[index];
      console.warn(
        '[desktop] private kernel bootstrap operation failed',
        item?.kernelId ?? 'unknown',
        errorMessage(result.reason),
      );
      // The update service normally converts failures to an error snapshot.
      // Still publish the latest state when an unexpected boundary exception
      // escapes so the Renderer cannot remain on a stale progress frame.
      broadcastKernelUpdateState(service.getSnapshot());
    }
  }
  broadcastKernelUpdateState(service.getSnapshot());
}

/**
 * Installed builds carry a feed sidecar inside their resources directory, so a
 * double-clicked application is configured without any environment variable.
 * Development has no sidecar and keeps using the environment only.
 */
function readBundledUpdateFeed(): DesktopUpdateBundledFeedOverrides | null {
  if (!app.isPackaged) return null;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return readBundledDesktopUpdateFeedConfiguration(resourcesPath ?? null);
}

function initializeDesktopUpdater(): void {
  const recoveryRoot = app.isPackaged ? resolveDesktopUpdateRecoveryRoot(process.env) : null;
  if (recoveryRoot) {
    const unsignedFixture =
      desktopUpdateInstallProbeConfiguration !== null &&
      process.env.SYNC_THINK_UPDATE_ROLLBACK_ALLOW_UNSIGNED_FIXTURE === '1';
    const fixtureTimeout = Number(process.env.SYNC_THINK_UPDATE_ROLLBACK_HEALTH_TIMEOUT_MS);
    desktopUpdateRollbackCoordinator = new DesktopUpdateRollbackCoordinator({
      recoveryRoot,
      currentVersion: app.getVersion(),
      targetExecutablePath: process.execPath,
      allowUnsignedFixture: unsignedFixture,
      expectedSignerThumbprint: process.env.SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1 ?? null,
      ...(unsignedFixture && Number.isInteger(fixtureTimeout)
        ? { healthDeadlineMs: fixtureTimeout }
        : {}),
    });
  }

  const resolved = resolveDesktopUpdateConfiguration(process.env, {
    isPackaged: app.isPackaged,
    bundledFeed: readBundledUpdateFeed(),
  });
  let configuration: DesktopUpdateConfiguration = resolved;
  let driver = null;
  if (resolved.enabled) {
    try {
      driver = createElectronUpdaterDriver(resolved);
    } catch {
      configuration = {
        enabled: false,
        channel: resolved.channel,
        errorCode: 'desktop.update.initialization-failed',
      };
    }
  }
  desktopUpdateController = new DesktopUpdateController({
    currentVersion: app.getVersion(),
    configuration,
    driver,
    beforeInstall: async (context) => {
      await desktopUpdateRollbackCoordinator?.prepareInstall({
        targetVersion: context.targetVersion,
        downloadedFile: context.downloadedFile,
      });
      // T12：升级前按所有权顺序停止执行面：daemon 先优雅回收
      // Runtime，Desktop 随后只做有界残留兜底。
      await shutdownDesktopServices('update-install');
    },
    installSilently: desktopUpdateInstallProbeConfiguration !== null,
  });
  desktopUpdateController.subscribe((snapshot) => {
    const target = mainWindow?.webContents;
    if (target && !target.isDestroyed()) target.send('desktop:update-state', snapshot);
  });
}

function normalizeDesktopUpdateProbeCertificateData(value: string): string {
  return value.replace(/\s+/g, '');
}

function prepareDesktopUpdateInstallProbeCertificate(): void {
  const configuration = desktopUpdateInstallProbeConfiguration;
  if (
    desktopUpdateInstallProbeBootstrap?.source !== 'environment' ||
    !configuration?.trustedCertificateData
  ) {
    return;
  }
  const feedUrl = process.env.SYNC_THINK_UPDATE_FEED_URL;
  if (!feedUrl) throw new Error('desktop.update.probe-feed-missing');
  const trustedHostname = new URL(feedUrl).hostname;
  const trustedCertificateData = normalizeDesktopUpdateProbeCertificateData(
    configuration.trustedCertificateData,
  );
  const updaterSession = session.fromPartition('electron-updater', { cache: false });
  updaterSession.setCertificateVerifyProc((request, callback) => {
    const accepted =
      request.hostname === trustedHostname &&
      normalizeDesktopUpdateProbeCertificateData(request.certificate?.data ?? '') ===
        trustedCertificateData;
    callback(accepted ? 0 : -2);
  });
}

async function maybeRunDesktopUpdateInstallProbe(): Promise<void> {
  const configuration = desktopUpdateInstallProbeConfiguration;
  if (!configuration) return;
  const controller = getDesktopUpdateController();
  await runDesktopUpdateInstallProbe({
    configuration,
    currentVersion: app.getVersion(),
    controller,
    ensureRuntimeReady: async () => {
      await ensureRuntimeConnection();
    },
    createMarker: async (name) => {
      const created = await getRuntimeClient().requestWorkspace('workspace.create', { name });
      return created.workspaceId;
    },
    markerExists: async (name, markerId) => {
      const listed = await getRuntimeClient().requestWorkspace('workspace.list', {});
      return listed.workspaces.some(
        (workspace) => workspace.name === name && (!markerId || workspace.workspaceId === markerId),
      );
    },
    prepareInstallRelaunch: async () => {
      await writeDesktopUpdateInstallProbeHandoff({
        handoffPath: desktopUpdateInstallProbeHandoff,
        executablePath: process.execPath,
        configuration,
        environment: process.env,
      });
    },
  });
}

/**
 * Show/hide the main window. Shared by the global quick-window shortcut and the
 * tray icon so both paths behave identically: hide when the window is already
 * focused, otherwise restore + show + focus. Extracted from the shortcut
 * handler so the tray does not have to duplicate (and drift from) this logic.
 */
function toggleMainWindowVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isVisible() && window.isFocused()) {
    window.hide();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Bring the window back without toggling it off. The tray uses this for actions
 * whose result is only visible in the UI (检查更新), where hiding the window
 * would defeat the point.
 */
function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function trayIconPath(): string {
  // __dirname is dist/main at runtime; the icon ships in apps/desktop/build.
  // The .ico carries 16/20/24/32px frames, so Windows picks a crisp tray size.
  return path.join(__dirname, '../../build/icon.ico');
}

/**
 * Conversations for the tray submenu, newest first. Degrades to an empty list on
 * any failure — a tray menu must never throw or hang on the Runtime.
 */
async function listTrayRecentConversations(): Promise<DesktopTrayConversation[]> {
  try {
    await ensureRuntimeConnection();
    const response = await getRuntimeClient().requestConversation('conversation.list', {
      includeArchived: false,
    });
    return response.conversations
      .slice()
      .sort((a, b) =>
        (b.lastMessageAt ?? b.updatedAt ?? '').localeCompare(a.lastMessageAt ?? a.updatedAt ?? ''),
      )
      .map((conversation) => ({ id: conversation.id, title: conversation.title }));
  } catch (error) {
    console.warn('[desktop] tray: could not list recent conversations', error);
    return [];
  }
}

async function openDataDirectoryFromTray(): Promise<void> {
  try {
    await ensureRuntimeConnection();
    const stats = await getRuntimeClient().requestDataManagement('data.storageStats', {});
    const error = await shell.openPath(stats.dataDirectory);
    if (error) console.warn('[desktop] tray: could not open data directory', error);
  } catch (error) {
    console.warn('[desktop] tray: could not open data directory', error);
  }
}

/** Creates the tray icon, wiring its menu to the current window/Runtime state. */
function setupDesktopTray(): void {
  createDesktopTray(
    {
      isWindowVisible: () =>
        Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      toggleWindow: () => toggleMainWindowVisibility(),
      listRecentConversations: () => listTrayRecentConversations(),
      openConversation: (conversationId: string) => {
        // The conversation lives in the renderer, so surface the window first —
        // otherwise the navigation would happen invisibly.
        revealMainWindow();
        sendOpenConversationToRenderer(conversationId);
      },
      isRuntimeRunning: async () => {
        try {
          return await probeRuntimePipe(getDesktopRuntimeIdentity().installId, 500);
        } catch {
          return false;
        }
      },
      checkForUpdates: () => {
        // Show the window: update progress and errors are rendered in the UI, and
        // hiding the window would leave the user with no feedback at all.
        revealMainWindow();
        try {
          void getDesktopUpdateController()
            .checkForUpdates()
            .catch((error: unknown) => {
              console.warn('[desktop] tray: update check failed', error);
            });
        } catch (error) {
          console.warn('[desktop] tray: update controller unavailable', error);
        }
      },
      openDataDirectory: () => openDataDirectoryFromTray(),
      quit: () => {
        // Bypass close-to-tray so the app actually exits.
        isQuitting = true;
        app.quit();
      },
    },
    trayIconPath(),
  );
}

function getDesktopUpdateController(): DesktopUpdateController {
  if (!desktopUpdateController) throw new Error('desktop.update.not-initialized');
  return desktopUpdateController;
}

function desktopUpdatePreferencesRoot(): string {
  return app.getPath('userData');
}

async function maybeCheckForDesktopUpdatesAtStartup(): Promise<void> {
  if (desktopUpdateInstallProbeConfiguration) return;
  const preferences = readDesktopUpdatePreferences(desktopUpdatePreferencesRoot());
  const controller = getDesktopUpdateController();
  if (!shouldAutoCheckDesktopUpdates(preferences, controller.getSnapshot())) return;
  await controller.checkForUpdates();
}

function createWindow(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const parsedDevServerUrl =
    !app.isPackaged && devServerUrl ? parseLoopbackDevServerUrl(devServerUrl) : null;
  // The NewMax-style shell is the only product UI. The legacy task-board
  // renderer and its SYNC_THINK_SHELL escape hatch were removed once the shell
  // reached parity — there is nothing to switch between any more.
  const rendererPath =
    !app.isPackaged && process.env.SYNC_THINK_RENDERER_MODE === 'development'
      ? path.resolve(__dirname, '../../../../.data/renderer-builds/development/index.html')
      : path.join(__dirname, '../renderer-shell/index.html');
  const nextTrustedRendererLocation: TrustedRendererLocation = parsedDevServerUrl
    ? { kind: 'origin', value: parsedDevServerUrl.origin }
    : trustedFileLocation(rendererPath);

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false,
    autoHideMenuBar: true,
    // Match resolved OS theme so light mode does not flash a dark frame.
    // Values track --color-page in shell.css.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0c' : '#f2eee6',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Embedded browser guests never receive Node.js or a preload bridge.
      webviewTag: true,
    },
  });
  mainWindow = window;
  trustedRendererLocation = nextTrustedRendererLocation;
  installNavigationGuards(window.webContents, nextTrustedRendererLocation);
  // Harden every embedded webview before Electron creates its guest contents.
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // Interactive HTML / design-draft previews get the guest measurement
    // preload, exactly like NewMax's `newmax-visualization-*` partition. Every
    // other webview (embedded browser tabs, local project pages) keeps its
    // preload deleted. Both conditions must hold: the host-chosen partition
    // prefix and a local data: document, so the prefix alone cannot grant a
    // preload to a remote page. The sandbox/isolation settings above still
    // apply to the guest.
    const attachSrc = String(params.src ?? '');
    if (isVisualizationPartition(params.partition)) {
      if (/^data:text\/html(;|,)/i.test(attachSrc)) {
        (webPreferences as { preload?: string }).preload = path.join(
          __dirname,
          '../preload/visualization.cjs',
        );
      } else {
        // Loud on purpose: a preview without the measurement preload silently
        // stays at its initial height, which is hard to diagnose from the UI.
        console.warn(
          '[desktop] visualization partition without a data: document; preload not attached',
          attachSrc.slice(0, 64),
        );
      }
    }
    const src = String(params.src ?? '');
    if (new RegExp(`^${LOCAL_WEB_PAGE_SCHEME}://[^/]+/`, 'i').test(src)) {
      try {
        // A restored Browser tab can hit the protocol before the renderer has
        // had a chance to call createLocalPageUrl again. Hydrate its registry
        // from the durable per-partition index before the guest is created.
        localWebPageRegistryForPartition(normalizeLocalWebPartition(params.partition));
      } catch {
        event.preventDefault();
        return;
      }
    }
    // Allow interactive HTML sandboxes and tokenized local project pages. Other
    // data/local schemes stay blocked before Chromium creates the guest.
    if (
      src &&
      !/^https?:\/\//i.test(src) &&
      src !== 'about:blank' &&
      !/^data:text\/html(;|,)/i.test(src) &&
      !new RegExp(`^${LOCAL_WEB_PAGE_SCHEME}://[^/]+/`, 'i').test(src)
    ) {
      event.preventDefault();
    }
  });
  installBrowserWebviewPopupHandler(window.webContents, ({ openerWebContentsId, url }) => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:browser-new-tab', { openerWebContentsId, url });
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error('[desktop] preload failed', error.message);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[desktop] renderer load failed', errorCode, errorDescription);
    recordDesktopCrashEvidence({
      source: 'renderer',
      kind: 'load-failed',
      summary: errorDescription,
      detail: { errorCode },
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    recordDesktopCrashEvidence({
      source: 'renderer',
      kind: 'render-process-gone',
      summary: `Renderer process ended: ${details.reason}`,
      detail: { reason: details.reason, exitCode: details.exitCode },
    });
  });
  window.once('ready-to-show', () => window.show());
  // Close-to-tray: hide and keep the window alive instead of destroying it, so
  // the app stays one click away in the notification area. Two guards matter —
  // a real quit sets isQuitting, and a disabled tray must fall through to a real
  // close (a hidden window with no tray icon would be unreachable).
  window.on('close', (event) => {
    if (isQuitting) return;
    if (!isDesktopTrayActive()) return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed', () => killWindowPtys(window.id));
  const load = parsedDevServerUrl
    ? window.loadURL(parsedDevServerUrl.href)
    : window.loadFile(rendererPath);
  void load.catch((error: unknown) => handleRendererLoadFailure(window, error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function handleRendererLoadFailure(window: BrowserWindow, error: unknown): void {
  console.error('[desktop] renderer failed to load', errorMessage(error));
  if (mainWindow === window) {
    mainWindow = null;
    trustedRendererLocation = null;
  }
  if (!window.isDestroyed()) window.destroy();
}

function handleDesktopStartupFailure(error: unknown): void {
  const message = errorMessage(error);
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'DESKTOP_STARTUP_FAILED';
  console.error('[desktop] startup failed', { code, message });
  if (app.isReady()) dialog.showErrorBox('SYNC-THINK 启动失败', `${message}\n\n错误代码：${code}`);
  app.quit();
}

function getDesktopRuntimeIdentity(): DesktopRuntimeIdentity {
  if (!desktopRuntimeIdentity) {
    throw Object.assign(new Error('Desktop Runtime identity has not been initialized'), {
      code: 'DESKTOP_RUNTIME_IDENTITY_NOT_READY',
    });
  }
  return desktopRuntimeIdentity;
}

async function initializeDesktopRuntimeIdentity(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const secretStore = app.isPackaged
    ? new SecureStore(
        new ElectronSafeStorageBackend(
          {
            encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
            decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
          },
          path.join(userDataPath, 'secure-store', 'runtime-identity'),
        ),
      )
    : undefined;
  desktopRuntimeIdentity = await resolveDesktopRuntimeIdentity({
    isPackaged: app.isPackaged,
    userDataPath,
    environment: process.env,
    secretStore,
  });
  console.log(
    '[desktop] runtime identity ready',
    describeDesktopRuntimeIdentity(desktopRuntimeIdentity),
  );
}

function getRuntimeClient(): RuntimePipeClient {
  const identity = getDesktopRuntimeIdentity();
  runtimeClient ??= new RuntimePipeClient({
    installId: identity.installId,
    appVersion: app.getVersion(),
    helloSecret: identity.pipeSecret,
  });
  return runtimeClient;
}

function sendRuntimeEventToRenderer(event: Event): void {
  sendRuntimeEventsToRenderer([event]);
}

function sendRuntimeEventsToRenderer(events: readonly Event[]): void {
  if (events.length === 0) return;
  const window = mainWindow;
  const location = trustedRendererLocation;
  if (!window || !location || window.isDestroyed()) return;
  const webContents = window.webContents;
  if (webContents.isDestroyed() || !isTrustedRendererUrl(webContents.getURL(), location)) {
    return;
  }
  webContents.send('runtime:events', events);
}

function projectFileWatchKey(senderId: number, subscriptionId: string): string {
  return `${senderId}:${subscriptionId}`;
}

function disposeProjectFileWatchesForSender(senderId: number): void {
  for (const [key, subscription] of projectFileWatchSubscriptions) {
    if (subscription.senderId !== senderId) continue;
    subscription.dispose();
    projectFileWatchSubscriptions.delete(key);
  }
}

function sendProjectFileChangeToRenderer(
  sender: IpcMainInvokeEvent['sender'],
  subscriptionId: string,
  change: ProjectFileChange,
): void {
  const location = trustedRendererLocation;
  if (!location || sender.isDestroyed() || !isTrustedRendererUrl(sender.getURL(), location)) {
    return;
  }
  sender.send('desktop:project-file-changed', { subscriptionId, change });
}

function registerProjectContentSearchSenderCleanup(sender: IpcMainInvokeEvent['sender']): void {
  if (projectContentSearchCleanupRegisteredSenders.has(sender.id)) return;
  projectContentSearchCleanupRegisteredSenders.add(sender.id);
  sender.once('destroyed', () => {
    projectContentSearchCleanupRegisteredSenders.delete(sender.id);
    projectContentSearchRegistry.abortForSender(sender.id);
  });
}

function sendProjectTerminalEvent(
  sender: IpcMainInvokeEvent['sender'],
  event: ProjectTerminalEvent,
): void {
  const location = trustedRendererLocation;
  if (!location || sender.isDestroyed() || !isTrustedRendererUrl(sender.getURL(), location)) {
    return;
  }
  sender.send('desktop:project-terminal-event', event);
}

function abortProjectTerminalsForSender(senderId: number): void {
  projectTerminalRegistry.abortForSender(senderId);
}

function abortAllProjectTerminals(): void {
  projectTerminalRegistry.abortAll();
}

function registerProjectTerminalSenderCleanup(sender: IpcMainInvokeEvent['sender']): void {
  if (projectTerminalCleanupRegisteredSenders.has(sender.id)) return;
  projectTerminalCleanupRegisteredSenders.add(sender.id);
  sender.once('destroyed', () => {
    projectTerminalCleanupRegisteredSenders.delete(sender.id);
    abortProjectTerminalsForSender(sender.id);
  });
}

async function streamProjectTerminalCommand(
  command: ActiveProjectTerminalCommand,
  reservation: ProjectTerminalReservation<ActiveProjectTerminalCommand>,
  executable: string,
  args: string[],
): Promise<void> {
  try {
    const events = new TerminalProcessWorker({ timeoutMs: null, streamAllOutput: true }).exec(
      {
        workingDir: command.root,
        action: {
          command: executable,
          args,
          cwd: command.cwd || '.',
        },
      },
      {
        token: randomUUID(),
        allowedRoot: command.root,
        allowedCommands: [executable],
        timeoutMs: 10 * 60_000,
        maxOutputBytes: 256 * 1024,
        signal: command.controller.signal,
      },
    );
    for await (const workerEvent of events) {
      if (workerEvent.type === 'stdout' || workerEvent.type === 'stderr') {
        sendProjectTerminalEvent(command.sender, {
          terminalId: command.terminalId,
          commandId: command.commandId,
          type: workerEvent.type,
          text: workerEvent.text,
        });
        continue;
      }
      if (workerEvent.type === 'completed') {
        const output = workerEvent.output as TerminalWorkerOutput;
        sendProjectTerminalEvent(command.sender, {
          terminalId: command.terminalId,
          commandId: command.commandId,
          type: 'completed',
          exitCode: typeof output.exitCode === 'number' ? output.exitCode : null,
          truncated: output.truncated === true,
          cwd: command.cwd,
        });
        continue;
      }
      if (workerEvent.type === 'failed') {
        if (command.controller.signal.aborted || workerEvent.error.code === 'worker.aborted') {
          sendProjectTerminalEvent(command.sender, {
            terminalId: command.terminalId,
            commandId: command.commandId,
            type: 'cancelled',
            cwd: command.cwd,
          });
        } else {
          sendProjectTerminalEvent(command.sender, {
            terminalId: command.terminalId,
            commandId: command.commandId,
            type: 'failed',
            failureClass: workerEvent.failureClass,
            code: workerEvent.error.code,
            message: workerEvent.error.message,
            cwd: command.cwd,
          });
        }
      }
    }
  } catch (error) {
    if (command.controller.signal.aborted) {
      sendProjectTerminalEvent(command.sender, {
        terminalId: command.terminalId,
        commandId: command.commandId,
        type: 'cancelled',
        cwd: command.cwd,
      });
    } else {
      sendProjectTerminalEvent(command.sender, {
        terminalId: command.terminalId,
        commandId: command.commandId,
        type: 'failed',
        failureClass: 'unknown',
        code: 'terminal.stream-failed',
        message: errorMessage(error),
        cwd: command.cwd,
      });
    }
  } finally {
    projectTerminalRegistry.release(reservation);
  }
}

// ─── Deep links (syncthink://conversation/{id}) ───
// A conversation id that arrives before the renderer is ready (cold start) or
// before the trusted renderer URL is registered is queued here and flushed
// once the window reports it is ready.
let pendingDeepLinkConversationId: string | null = null;

function sendOpenConversationToRenderer(conversationId: string): boolean {
  const window = mainWindow;
  const location = trustedRendererLocation;
  if (!window || !location || window.isDestroyed()) return false;
  const webContents = window.webContents;
  if (webContents.isDestroyed() || !isTrustedRendererUrl(webContents.getURL(), location)) {
    return false;
  }
  webContents.send('desktop:open-conversation', { conversationId });
  return true;
}

function handleDeepLink(raw: string): void {
  const parsed = parseDeepLinkUrl(raw);
  if (!parsed) return;
  if (!sendOpenConversationToRenderer(parsed.conversationId)) {
    // Renderer not ready yet — hold the id; it will be flushed on first
    // 'desktop:renderer-ready'. Only the latest id is kept so a rapid burst
    // of links doesn't open a queue of stale conversations.
    pendingDeepLinkConversationId = parsed.conversationId;
    if (!mainWindow) createWindow();
  }
}

function getRuntimeSession(): RuntimeSession {
  runtimeSession ??= new RuntimeSession(
    getRuntimeClient(),
    sendRuntimeEventToRenderer,
    new FileRuntimeActivityCursorStore(
      path.join(app.getPath('userData'), 'runtime-activity-cursor.json'),
    ),
    sendRuntimeEventsToRenderer,
  );
  return runtimeSession;
}

async function ensureRuntimeConnection(): Promise<RuntimeConnectResult> {
  // The daemon is the long-lived execution owner. Start it first and let it
  // create the Runtime through its private IPC channel; Desktop only falls back
  // to a directly managed Runtime when daemon startup is unavailable.
  const identity = getDesktopRuntimeIdentity();
  const daemon = await ensureDaemonProcess(identity);
  const autostart = await ensureDaemonAutostartDefault(identity);
  if (!autostart.ok && !daemonAutostartFailureLogged) {
    daemonAutostartFailureLogged = true;
    console.warn('[desktop] daemon login startup registration failed');
  }
  if (daemon.ready) {
    const runtimeReady = await waitForRuntimeProcess(
      identity.installId,
      RUNTIME_COLD_START_TIMEOUT_MS,
    );
    if (!runtimeReady) {
      throw new Error('runtime.daemon-supervision-timeout');
    }
  } else {
    console.warn(
      '[desktop] daemon is not ready; starting fallback Runtime scheduler',
      daemon.error,
    );
    const fallback = await ensureRuntimeProcess(identity);
    if (!fallback.ready) throw new Error(fallback.error ?? 'runtime.spawn-timeout');
  }
  const result = await getRuntimeSession().connect();
  markDesktopUpdateRollbackHealthy();
  return result;
}

function markDesktopUpdateRollbackHealthy(): void {
  if (!desktopUpdateRollbackCoordinator || desktopUpdateRollbackHealthPromise) return;
  if (
    desktopUpdateInstallProbeConfiguration !== null &&
    process.env.SYNC_THINK_UPDATE_ROLLBACK_FAIL_VERSION === app.getVersion()
  ) {
    console.log('[desktop] update rollback health intentionally suppressed', app.getVersion());
    return;
  }
  desktopUpdateRollbackHealthPromise = desktopUpdateRollbackCoordinator
    .markRuntimeHealthy()
    .then((status) => {
      console.log('[desktop] update rollback health', status);
    })
    .catch((error: unknown) => {
      desktopUpdateRollbackHealthPromise = null;
      console.error('[desktop] update rollback health failed', errorMessage(error));
    });
}

async function connectRendererToRuntime(): Promise<RuntimeConnectOutcome> {
  try {
    return { ok: true, result: await ensureRuntimeConnection() };
  } catch (error) {
    // One more ownership-aware ensure+retry: the daemon or fallback Runtime may
    // have opened the pipe while the first authenticated handshake was racing.
    try {
      return { ok: true, result: await ensureRuntimeConnection() };
    } catch {
      return { ok: false, error: classifyRuntimeConnectError(error) };
    }
  }
}

/**
 * Convert renderer data-URL images into staging paths so task.appendMessage
 * stays under the protocol 1 MiB frame limit.
 */
function appendAttachmentContext(
  value: unknown,
): { conversationId: string; workspacePath: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context = (value as { attachmentContext?: unknown }).attachmentContext;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return undefined;
  const record = context as { conversationId?: unknown; workspacePath?: unknown };
  if (
    typeof record.conversationId !== 'string' ||
    record.conversationId.length === 0 ||
    record.conversationId.length > 256 ||
    typeof record.workspacePath !== 'string' ||
    record.workspacePath.length === 0 ||
    record.workspacePath.length > 2048 ||
    !path.isAbsolute(record.workspacePath)
  ) {
    return undefined;
  }
  return { conversationId: record.conversationId, workspacePath: record.workspacePath };
}

function stageAppendMessageImages(value: unknown): StagedAppendMessagePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { payload: value, images: [] };
  }
  const attachmentContext = appendAttachmentContext(value);
  const runtimePayload = { ...(value as Record<string, unknown>) };
  Reflect.deleteProperty(runtimePayload, 'attachmentContext');
  const payload = runtimePayload as { images?: unknown };
  if (!Array.isArray(payload.images) || payload.images.length === 0) {
    return { payload: runtimePayload, images: [] };
  }
  const durableImages: Array<{ name: string; mimeType: string; stagingPath: string }> = [];
  const images = payload.images.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const image = raw as {
      name?: string;
      id?: string;
      mimeType?: string;
      dataUrl?: string;
      stagingPath?: string;
    };
    if (typeof image.stagingPath === 'string' && image.stagingPath.length > 0) {
      const next = {
        name: image.name || 'image',
        mimeType: image.mimeType || 'image/png',
        stagingPath: image.stagingPath,
      };
      durableImages.push(next);
      return next;
    }
    if (typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/')) {
      const input = {
        name: image.name || 'image',
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      };
      // With a bound workspace, materialize before dispatch exactly as NewMax
      // does. Unbound conversations retain the application staging fallback.
      const staged = attachmentContext
        ? materializeChatImageDataUrl(input, {
            ...attachmentContext,
            attachmentId: image.id || randomUUID(),
          })
        : stageChatImageDataUrl(input);
      console.log('[desktop] staged chat image', {
        name: staged.name,
        mimeType: staged.mimeType,
        bytes: staged.bytes,
        stagingPath: staged.stagingPath,
      });
      const next = {
        name: staged.name,
        mimeType: staged.mimeType,
        stagingPath: staged.stagingPath,
      };
      durableImages.push(next);
      return next;
    }
    return raw;
  });
  return { payload: { ...runtimePayload, images }, images: durableImages };
}

function assertRuntimeIpcSource(event: IpcMainInvokeEvent): void {
  assertTrustedRendererIpcSource(
    event.sender,
    mainWindow?.webContents,
    event.senderFrame?.url ?? '',
    trustedRendererLocation ?? { kind: 'file', value: '' },
  );
}

function installPiKernel(): Promise<KernelInstallResult> {
  if (piKernelInstallPromise) return piKernelInstallPromise;
  piKernelInstallPromise = (async () => {
    const service = getKernelUpdateService();
    try {
      const result = await service.installUpdate('pi');
      broadcastKernelUpdateState(result.state);
      if (!result.ok) {
        return {
          ok: false as const,
          error: result.errorCode ?? 'kernel.update.install-failed',
        };
      }
      return { ok: true as const };
    } catch (error) {
      console.warn('[desktop] Pi private install failed', errorMessage(error));
      const errorCode = 'kernel.update.install-failed';
      broadcastKernelUpdateState(service.getSnapshot());
      return {
        ok: false as const,
        error: errorCode,
      };
    }
  })().finally(() => {
    piKernelInstallPromise = null;
  });
  return piKernelInstallPromise;
}

function setupRuntimeBridge(): void {
  ipcMain.handle('desktop:update-get-state', (event) => {
    assertRuntimeIpcSource(event);
    return getDesktopUpdateController().getSnapshot();
  });
  ipcMain.handle('desktop:update-check', async (event) => {
    assertRuntimeIpcSource(event);
    return getDesktopUpdateController().checkForUpdates();
  });
  ipcMain.handle('desktop:update-download', async (event) => {
    assertRuntimeIpcSource(event);
    return getDesktopUpdateController().downloadUpdate();
  });
  ipcMain.handle('desktop:update-install', async (event) => {
    assertRuntimeIpcSource(event);
    return getDesktopUpdateController().installUpdate();
  });
  ipcMain.handle('desktop:update-get-auto-check', (event) => {
    assertRuntimeIpcSource(event);
    return { enabled: readDesktopUpdatePreferences(desktopUpdatePreferencesRoot()).autoCheck };
  });
  ipcMain.handle('desktop:update-set-auto-check', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as { enabled?: unknown }).enabled !== 'boolean'
    ) {
      throw new Error('desktop.update.auto-check-invalid');
    }
    const enabled = (value as { enabled: boolean }).enabled;
    writeDesktopUpdatePreferences(desktopUpdatePreferencesRoot(), { autoCheck: enabled });
    return { enabled };
  });
  ipcMain.handle('desktop:open-external-url', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const url = normalizeExternalUrl(value);
    if (!url) return { opened: false, error: 'desktop.external-url-invalid' };
    try {
      await shell.openExternal(url);
      return { opened: true, error: null };
    } catch {
      return { opened: false, error: 'desktop.external-url-open-failed' };
    }
  });

  // Open a rendered HTML block (from the chat sandbox) in the system browser.
  // The snippet is written to a temp file so external links/relative assets
  // behave like a real page; the file lives in the OS temp dir and is never
  // added to any workspace.
  ipcMain.handle('desktop:open-html-file', async (event, html: unknown) => {
    assertRuntimeIpcSource(event);
    if (typeof html !== 'string' || html.length === 0 || html.length > 8 * 1024 * 1024) {
      return { ok: false, error: 'invalid html payload' };
    }
    try {
      const dir = path.join(tmpdir(), 'sync-think-html');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${randomUUID()}.html`);
      await fs.promises.writeFile(file, html, 'utf-8');
      const openErr = await shell.openPath(file);
      if (openErr) return { ok: false, error: openErr };
      return { ok: true, path: file };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'open failed' };
    }
  });

  // Create a NewMax-compatible token URL for a saved project HTML document.
  // The handler is installed on the same partition as the eventual BrowserPanel
  // so relative assets stay available without exposing arbitrary file:// paths.
  ipcMain.handle('desktop:create-local-page-url', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, url: null, error: 'invalid local page payload' };
    }
    const payload = value as { filePath?: unknown; partition?: unknown };
    if (typeof payload.filePath !== 'string' || !path.isAbsolute(payload.filePath.trim())) {
      return { ok: false, url: null, error: '本地页面路径必须是绝对路径' };
    }
    try {
      const partition = normalizeLocalWebPartition(payload.partition);
      const registry = localWebPageRegistryForPartition(partition);
      const url = await registry.createUrl(payload.filePath.trim());
      return url
        ? { ok: true, url, error: null }
        : { ok: false, url: null, error: '本地页面不存在或不是 HTML 文件' };
    } catch (error) {
      return { ok: false, url: null, error: errorMessage(error) };
    }
  });

  ipcMain.handle('runtime:connect', (event) => {
    assertRuntimeIpcSource(event);
    return connectRendererToRuntime();
  });
  ipcMain.handle('runtime:collaboration-command', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().requestCollaboration(value as import('@sync-think/shared').CollaborationCommand);
  });
  registerPolicyHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestPolicy: (command, payload, options) =>
      getRuntimeClient().requestPolicy(command, payload, options),
  });
  registerSettingsHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestSettings: (command, payload, options) =>
      getRuntimeClient().requestSettings(command, payload, options),
  });
  registerWebSearchProviderHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestWebSearchProvider: (command, payload, options) =>
      getRuntimeClient().requestWebSearchProvider(command, payload, options),
  });
  registerDataManagementHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestDataManagement: (command, payload, options) =>
      getRuntimeClient().requestDataManagement(command, payload, options),
    defaultExportFileName: () =>
      `sync-think-export-${new Date().toISOString().slice(0, 10)}.json`,
    selectExportFile: async (event, defaultFileName) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '导出数据',
        defaultPath: defaultFileName,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      };
      const selected = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      return selected.canceled ? undefined : selected.filePath;
    },
    selectImportFile: async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '导入数据',
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      };
      const selected = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    openPath: (targetPath) => shell.openPath(targetPath),
  });
  registerUsageHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestUsage: (command, payload, options) =>
      getRuntimeClient().requestUsage(command, payload, options),
  });
  registerAgentHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestAgent: (command, payload, options) =>
      getRuntimeClient().requestAgent(command, payload, options),
  });
  registerGlobalAgentHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestGlobalAgent: (command, payload, options) =>
      getRuntimeClient().requestGlobalAgent(command, payload, options),
  });
  registerTeamHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestTeam: (command, payload, options) =>
      getRuntimeClient().requestTeam(command, payload, options),
  });
  registerKernelHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestKernel: (command, payload, options) =>
      getRuntimeClient().requestKernel(command, payload, options),
  });
  registerGatewayHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestGateway: (command, payload, options) =>
      getRuntimeClient().requestGateway(command, payload, options),
  });
  ipcMain.handle('desktop:kernel-install', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value !== 'pi') {
      throw new Error('Unsupported kernel install request');
    }
    return installPiKernel();
  });
  ipcMain.handle('desktop:kernel-update-get-state', (event) => {
    assertRuntimeIpcSource(event);
    return getKernelUpdateService().getSnapshot();
  });
  ipcMain.handle('desktop:kernel-update-check', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    let kernelId: ManagedKernelUpdateId | undefined;
    if (value != null) {
      if (
        !value ||
        typeof value !== 'object' ||
        !['codex', 'claude-code', 'pi'].includes(String((value as { kernelId?: unknown }).kernelId))
      ) {
        throw new Error('kernel.update.kernel-invalid');
      }
      kernelId = (value as { kernelId: ManagedKernelUpdateId }).kernelId;
    }
    const service = getKernelUpdateService();
    try {
      const result = await service.checkForUpdates(kernelId);
      broadcastKernelUpdateState(result.state);
      return result;
    } catch (error) {
      console.warn('[desktop] kernel update check failed', errorMessage(error));
      const state = service.getSnapshot();
      const result = {
        ok: false as const,
        state,
        errorCode: 'kernel.update.check-failed',
      };
      broadcastKernelUpdateState(state);
      return result;
    }
  });
  ipcMain.handle('desktop:kernel-update-install', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (
      !value ||
      typeof value !== 'object' ||
      !['codex', 'claude-code', 'pi'].includes(String((value as { kernelId?: unknown }).kernelId))
    ) {
      throw new Error('kernel.update.kernel-invalid');
    }
    const kernelId = (value as { kernelId: ManagedKernelUpdateId }).kernelId;
    const service = getKernelUpdateService();
    try {
      const result = await service.installUpdate(kernelId);
      broadcastKernelUpdateState(result.state);
      if (result.ok) await recyclePrivateKernel(kernelId);
      return result;
    } catch (error) {
      console.warn('[desktop] kernel update install failed', kernelId, errorMessage(error));
      const state = service.getSnapshot();
      const result = {
        ok: false as const,
        state,
        errorCode: 'kernel.update.install-failed',
      };
      broadcastKernelUpdateState(state);
      return result;
    }
  });
  // Mutable Conversation commands (2026-07-22 model).
  registerConversationManagementHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationRoutingHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationPlanHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationAskHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerScheduledTaskHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestScheduledTask: (command, payload) =>
      getRuntimeClient().requestScheduledTask(command, payload),
  });
  registerActivityHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestActivity: (command, payload) => getRuntimeClient().requestActivity(command, payload),
  });
  registerGoalHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestGoal: (command, payload) => getRuntimeClient().requestGoal(command, payload),
  });
  registerConversationQueryHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationWriteHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    stageAppendMessageImages,
    persistMessageImages: (messageId, images) =>
      persistMessageImages(messageId, images).map((image) => ({
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        storageRef: image.storageRef,
        url: messageImageUrl(image.storageRef),
      })),
    requestConversation: (command, payload, options) =>
      getRuntimeClient().requestConversation(command, payload, options),
  });
  registerConversationApprovalHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationBrowserHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestConversation: (command, payload) =>
      getRuntimeClient().requestConversation(command, payload),
  });
  registerConversationTransientHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    senderId: (event) => event.sender.id,
    ensureConnection: ensureRuntimeConnection,
    subscribe: (input) => getRuntimeSession().subscribeConversationTransientStream(input),
    unsubscribe: (senderId, subscriptionId) =>
      getRuntimeSession().unsubscribeConversationTransientStream(senderId, subscriptionId),
    unsubscribeForSender: (senderId) =>
      getRuntimeSession().unsubscribeConversationTransientStreamsForSender(senderId),
    onSenderDestroyed: (event, listener) => event.sender.once('destroyed', listener),
    sendToSender: (event, subscriptionId, payload) => {
      const location = trustedRendererLocation;
      const sender = event.sender;
      if (!location || sender.isDestroyed() || !isTrustedRendererUrl(sender.getURL(), location)) {
        return;
      }
      sender.send('runtime:conversation-transient', { subscriptionId, ...payload });
    },
  });
  // ── 守护进程管理（T11）：走 daemon 独立管道，不经过 runtime。 ──────────
  ipcMain.handle('daemon:get-status', async (event) => {
    assertRuntimeIpcSource(event);
    return requestDaemonFrame(
      'daemon.status',
      {},
      getDesktopRuntimeIdentity().installId,
      getDesktopRuntimeIdentity().pipeSecret,
    );
  });
  ipcMain.handle('daemon:start', async (event) => {
    assertRuntimeIpcSource(event);
    const result = await ensureDaemonProcess(getDesktopRuntimeIdentity());
    return { ok: result.ready, spawned: result.spawned };
  });
  ipcMain.handle('daemon:stop', async (event) => {
    assertRuntimeIpcSource(event);
    const identity = getDesktopRuntimeIdentity();
    await executeDesktopShutdownPlan(planDesktopShutdown('background-stop'), {
      stopDaemon: () => stopManagedDaemon(12_000, identity),
      stopRuntime: () => stopManagedRuntime(12_000, identity),
    });
    const [daemonAlive, runtimeAlive] = await Promise.all([
      probeDaemonPipe(identity.installId, 500),
      probeRuntimePipe(identity.installId, 500),
    ]);
    return { ok: !daemonAlive && !runtimeAlive, daemonAlive, runtimeAlive };
  });
  ipcMain.handle('daemon:get-logs', async (event) => {
    assertRuntimeIpcSource(event);
    return readDaemonLogs();
  });
  ipcMain.handle('daemon:set-autostart', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const enabled = Boolean(
      value && typeof value === 'object' && (value as { enabled?: unknown }).enabled,
    );
    return setDaemonAutostart(enabled, getDesktopRuntimeIdentity());
  });
  ipcMain.handle('daemon:set-max-concurrent', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const n = Number((value as { maxConcurrent?: unknown } | null)?.maxConcurrent ?? 2);
    const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 2;
    await requestDaemonFrame(
      'daemon.setConfig',
      { maxConcurrent: clamped },
      getDesktopRuntimeIdentity().installId,
      getDesktopRuntimeIdentity().pipeSecret,
    );
    return { ok: true, maxConcurrent: clamped };
  });
  registerSkillLocalHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestSkillLocal: (command, payload) => getRuntimeClient().requestSkillLocal(command, payload),
  });
  registerSkillMarketHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestSkillMarket: (command, payload) =>
      getRuntimeClient().requestSkillMarket(command, payload),
  });
  ipcMain.handle(
    'runtime:conversation-read-approval-request-image',
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return readApprovalRequestImage(value, {
        listMessages: (payload) =>
          getRuntimeClient().requestConversation('conversation.listMessages', payload),
        readImage: readMessageImage,
      });
    },
  );
  // AI browser_screenshot：主进程对 webview guest 执行 capturePage，并把 PNG 写入
  // Capture the current embedded browser page into the project screenshot directory.
  const browserPreviewCaptures = new Map<number, Promise<{ imageDataUrl: string; url: string; capturedAt: string }>>();
  ipcMain.handle('desktop:browser-preview', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const id = (value as { webContentsId?: unknown } | null)?.webContentsId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Invalid browser preview id');
    const { webContents: webContentsModule } = await import('electron');
    const guest = webContentsModule.fromId(id);
    if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' ||
        guest.hostWebContents !== event.sender || !/^https?:\/\//i.test(guest.getURL())) {
      throw new Error('Browser preview page is closed or belongs to another window');
    }
    let pending = browserPreviewCaptures.get(id);
    if (!pending) {
      pending = (async () => {
    const image = await guest.capturePage();
    if (image.isEmpty()) throw new Error('Browser preview is empty');
    const resized = image.resize({ width: Math.min(960, image.getSize().width) });
    return { imageDataUrl: `data:image/jpeg;base64,${resized.toJPEG(45).toString('base64')}`,
      url: guest.getURL(), capturedAt: new Date().toISOString() };
      })().finally(() => { browserPreviewCaptures.delete(id); });
      browserPreviewCaptures.set(id, pending);
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Browser preview timed out')), 1800); })]);
    } finally { if (timeout) clearTimeout(timeout); }
  });
  ipcMain.handle('desktop:save-browser-screenshot', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid save-browser-screenshot payload');
    }
    const payload = value as { root?: unknown; webContentsId?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid save-browser-screenshot payload: root required');
    }
    if (typeof payload.webContentsId !== 'number' || !Number.isInteger(payload.webContentsId)) {
      throw new Error('Invalid save-browser-screenshot payload: webContentsId required');
    }
    const root = path.resolve(payload.root);
    if (!fs.existsSync(root)) {
      return { ok: false, error: '项目文件夹不存在' };
    }
    const { webContents: webContentsModule } = await import('electron');
    const guest = webContentsModule.fromId(payload.webContentsId);
    if (!guest || guest.isDestroyed()) {
      return { ok: false, error: '浏览器页面不存在或已关闭' };
    }
    // Only capture a live http(s) webview guest owned by this BrowserWindow.
    const guestUrl = guest.getURL();
    if (guest.getType() !== 'webview' || !/^https?:\/\//i.test(guestUrl)) {
      return { ok: false, error: '仅支持当前 http(s) WebView 页面截图' };
    }
    try {
      const image = await guest.capturePage();
      if (image.isEmpty()) {
        return { ok: false, error: '截图内容为空' };
      }
      const dir = path.join(root, '.sync-think', 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const fileName = `browser-${stamp}-${Math.random().toString(36).slice(2, 6)}.png`;
      const absolute = path.join(dir, fileName);
      // Defense in depth: the generated path must remain inside the project root.
      if (!absolute.startsWith(root + path.sep)) {
        return { ok: false, error: '截图路径超出项目目录' };
      }
      fs.writeFileSync(absolute, image.toPNG());
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      return {
        ok: true,
        path: absolute,
        relativePath,
        // Served by the sync-think-image protocol (screenshot host) — allowed
        // by the renderer CSP and the MarkdownContent urlTransform.
        embedUrl: `sync-think-image://screenshot/${encodeURIComponent(absolute)}`,
        pageUrl: guestUrl,
      };
    } catch (error) {
      return {
        ok: false,
        error: `截图失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
  ipcMain.handle('desktop:browser-trusted-click', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid browser-trusted-click payload');
    }
    const payload = value as { webContentsId?: unknown; x?: unknown; y?: unknown };
    if (typeof payload.webContentsId !== 'number' || !Number.isInteger(payload.webContentsId)) {
      throw new Error('Invalid browser-trusted-click payload: webContentsId required');
    }
    if (
      typeof payload.x !== 'number' ||
      typeof payload.y !== 'number' ||
      !Number.isFinite(payload.x) ||
      !Number.isFinite(payload.y)
    ) {
      throw new Error('Invalid browser-trusted-click payload: x and y required');
    }
    const { webContents: webContentsModule } = await import('electron');
    const guest = webContentsModule.fromId(payload.webContentsId);
    if (!guest || guest.isDestroyed()) {
      return { ok: false, error: '浏览器页面不存在或已关闭' };
    }
    const guestUrl = guest.getURL();
    if (guest.getType() !== 'webview' || !/^https?:\/\//i.test(guestUrl)) {
      return { ok: false, error: '仅支持当前 http(s) WebView 页面点击' };
    }
    const x = Math.round(payload.x);
    const y = Math.round(payload.y);
    if (x < 0 || y < 0 || x > 20_000 || y > 20_000) {
      return { ok: false, error: '点击坐标超出范围' };
    }
    try {
      guest.focus();
      guest.sendInputEvent({ type: 'mouseMove', x, y });
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `可信点击失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
  registerSkillHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestSkill: (command, payload, options) =>
      getRuntimeClient().requestSkill(command, payload, options),
  });
  registerMcpRegistryHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestMcpRegistry: (command, payload, options) =>
      getRuntimeClient().requestMcpRegistry(command, payload, options),
  });
  registerMcpToolHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestMcpTool: (command, payload, options) =>
      getRuntimeClient().requestMcpTool(command, payload, options),
  });
  registerBotChannelHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBotChannel: (command, payload, options) =>
      getRuntimeClient().requestBotChannel(command, payload, options),
  });
  registerCapabilityGovernanceHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestCapabilityGovernance: (command, payload, options) =>
      getRuntimeClient().requestCapabilityGovernance(command, payload, options),
  });
  registerPromptDesignHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestPromptDesign: (command, payload, options) =>
      getRuntimeClient().requestPromptDesign(command, payload, options),
  });
  registerWorkspaceHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestWorkspace: (command, payload, options) =>
      getRuntimeClient().requestWorkspace(command, payload, options),
  });
  registerTaskHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestTask: (command, payload, options) =>
      getRuntimeClient().requestTask(command, payload, options),
  });
  registerParticipationModeHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestParticipationMode: (command, payload, options) =>
      getRuntimeClient().requestParticipationMode(command, payload, options),
  });
  registerPlanHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestPlan: (command, payload, options) =>
      getRuntimeClient().requestPlan(command, payload, options),
  });
  registerRunControlHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestRunControl: (command, payload, options) =>
      getRuntimeClient().requestRunControl(command, payload, options),
  });
  registerArtifactHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestArtifact: (command, payload, options) =>
      getRuntimeClient().requestArtifact(command, payload, options),
    registerImagePreview: (version) =>
      artifactImagePreviewRegistry.register({
        artifactVersionId: String(version.id),
        contentRef: version.contentRef,
        contentHash: version.contentHash,
        mimeType: version.mimeType,
      }),
  });
  registerProviderCatalogHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    readClipboardText: () => clipboard.readText(),
    requestProviderCatalog: (command, payload, options) =>
      getRuntimeClient().requestProviderCatalog(command, payload, options),
  });
  registerProviderCredentialHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    readClipboardText: () => clipboard.readText(),
    requestProviderCredential: (command, payload, options) =>
      getRuntimeClient().requestProviderCredential(command, payload, options),
  });
  registerProviderModelHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestProviderModel: (command, payload, options) =>
      getRuntimeClient().requestProviderModel(command, payload, options),
  });
  registerProviderDiscoveryHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    readClipboardText: () => clipboard.readText(),
    requestProviderDiscovery: (command, payload, options) =>
      getRuntimeClient().requestProviderDiscovery(command, payload, options),
  });
  registerProviderBalanceHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestProviderBalance: (command, payload, options) =>
      getRuntimeClient().requestProviderBalance(command, payload, options),
  });
  registerProviderCcSwitchHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestProviderCcSwitch: (command, payload, options) =>
      getRuntimeClient().requestProviderCcSwitch(command, payload, options),
  });

  registerDesktopCommandHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestDesktopCommand: (command, payload, options) =>
      getRuntimeClient().requestDesktopCommand(command, payload, options),
  });
  registerMemoryHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestMemory: (command, payload, options) =>
      getRuntimeClient().requestMemory(command, payload, options),
  });
  registerBrowserExtensionHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBrowserExtension: (command, payload, options) =>
      getRuntimeClient().requestBrowserExtension(command, payload, options),
  });
  registerBrowserProfileHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBrowserProfile: (command, payload, options) =>
      getRuntimeClient().requestBrowserProfile(command, payload, options),
  });
  registerBrowserRecordingHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBrowserRecording: (command, payload, options) =>
      getRuntimeClient().requestBrowserRecording(command, payload, options),
  });
  registerBrowserWorkflowHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBrowserWorkflow: (command, payload, options) =>
      getRuntimeClient().requestBrowserWorkflow(command, payload, options),
  });
  registerBrowserHandoffHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestBrowserHandoff: (command, payload, options) =>
      getRuntimeClient().requestBrowserHandoff(command, payload, options),
  });

  registerApprovalHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestApproval: (command, payload, options) =>
      getRuntimeClient().requestApproval(command, payload, options),
  });
  registerContextPacketHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestContextPacket: (command, payload, options) =>
      getRuntimeClient().requestContextPacket(command, payload, options),
  });
  registerDiagnosticsHandlers({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    assertSource: assertRuntimeIpcSource,
    ensureConnection: ensureRuntimeConnection,
    requestDiagnostics: (command, payload, options) =>
      getRuntimeClient().requestDiagnostics(command, payload, options),
  });
  ipcMain.handle(
    'desktop:diagnostics-export',
    async (event, value: unknown): Promise<ExportDesktopDiagnosticsResponse> => {
      assertRuntimeIpcSource(event);
      const payload = parseExportDesktopDiagnosticsPayload(value);
      let runtime: Record<string, unknown> | null = null;
      let diagnostics: unknown[] = [];
      try {
        await ensureRuntimeConnection();
        const client = getRuntimeClient();
        const health = await client.request<Record<string, unknown>>('runtime.healthcheck', {});
        const listed = await client.requestDiagnostics(
          'diagnostics.list',
          parseListDiagnosticsPayload({ taskId: payload.taskId, runId: payload.runId, limit: 200 }),
        );
        runtime = { available: true, ...health };
        diagnostics = Array.isArray(listed.diagnostics) ? listed.diagnostics : [];
      } catch (error) {
        runtime = {
          available: false,
          failure: classifyRuntimeConnectError(error),
          message: errorMessage(error),
        };
      }

      const crashReports = await desktopCrashJournal.list();
      const updater = desktopUpdateController
        ? {
            state: desktopUpdateController.getSnapshot(),
            recoveryEvidence: desktopUpdateController.getRecoveryEvidence(),
          }
        : null;
      const bundle = createDesktopDiagnosticsBundle({
        homeDirectory: app.getPath('home'),
        application: {
          name: app.getName(),
          version: app.getVersion(),
          packaged: app.isPackaged,
          platform: process.platform,
          architecture: process.arch,
          locale: app.getLocale(),
          installId: process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
        },
        runtime,
        updater,
        diagnostics,
        crashReports,
        knownLimitations: DEFAULT_KNOWN_LIMITATIONS,
        recoveryInstructions: DEFAULT_RECOVERY_INSTRUCTIONS,
      });
      const stamp = bundle.generatedAt.replace(/[:.]/g, '-');
      const options = {
        title: '导出脱敏诊断',
        defaultPath: path.join(app.getPath('downloads'), `sync-think-diagnostics-${stamp}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<
          'createDirectory' | 'showOverwriteConfirmation'
        >,
      };
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (selected.canceled || !selected.filePath) {
        return {
          status: 'cancelled',
          diagnosticCount: diagnostics.length,
          crashReportCount: crashReports.length,
          generatedAt: bundle.generatedAt,
        };
      }
      await writeDesktopDiagnosticsBundle(selected.filePath, bundle);
      return {
        status: 'saved',
        path: selected.filePath,
        diagnosticCount: diagnostics.length,
        crashReportCount: crashReports.length,
        generatedAt: bundle.generatedAt,
      };
    },
  );
  ipcMain.handle('desktop:m1-exit-evidence', async (event) => {
    assertRuntimeIpcSource(event);
    // Resolve repo docs/ from packaged or monorepo layouts (never follow arbitrary paths).
    const candidates = [
      path.resolve(__dirname, '../../../../docs/development'),
      path.resolve(process.cwd(), 'docs/development'),
      path.resolve(process.cwd(), '../../docs/development'),
      path.resolve(app.getAppPath(), 'docs/development'),
      path.resolve(app.getAppPath(), '../../docs/development'),
    ];
    let docsDev: string | null = null;
    for (const c of candidates) {
      try {
        if (fs.existsSync(path.join(c, '14-external-gateway-handtest.md'))) {
          docsDev = c;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (!docsDev) {
      return {
        ok: false as const,
        handtestChecked: 0,
        handtestTotal: 0,
        handtestBoxes: [] as Array<{
          index: number;
          section: string;
          sectionTitle: string;
          label: string;
          checked: boolean;
          line: number;
        }>,
        dogfoodFileCount: 0,
        dogfoodRealDays: 0,
        dualAutomatedOk: true,
        loadNote: '未找到 docs/development，无法读取 handtest/dogfood 证据',
      };
    }

    const handtestPath = path.join(docsDev, '14-external-gateway-handtest.md');
    let handtestMd = '';
    try {
      handtestMd = await readFile(handtestPath, 'utf8');
    } catch {
      handtestMd = '';
    }
    // Pure parser: sectioned boxes (never writes; never closes M1)
    const handtestParsed = parseHandtestDocMarkdown(handtestMd);
    const handtestChecked = handtestParsed.checked;
    const handtestTotal = handtestParsed.total;
    const handtestBoxes = handtestParsed.boxes.map((b) => ({
      index: b.index,
      section: b.section,
      sectionTitle: b.sectionTitle,
      label: b.label,
      checked: b.checked,
      line: b.line,
    }));

    const dogfoodDir = path.join(docsDev, 'dogfood');
    const dogfoodReport = listDogfoodDayReports(dogfoodDir);
    const dogfoodFileCount = dogfoodReport.dogfoodFileCount;
    const dogfoodRealDays = dogfoodReport.dogfoodRealDays;
    const dogfoodDays = dogfoodReport.days;

    return {
      ok: true as const,
      handtestChecked,
      handtestTotal,
      handtestBoxes,
      dogfoodFileCount,
      dogfoodRealDays,
      dogfoodDays,
      dualAutomatedOk: true,
      loadNote: `已读 ${path.basename(docsDev)} · 手测 ${handtestChecked}/${handtestTotal} · dogfood 有效 ${dogfoodRealDays}/${dogfoodFileCount}`,
    };
  });

  ipcMain.handle('desktop:m1-open-doc', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const idRaw =
      value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value;
    const dateRaw =
      value && typeof value === 'object' && 'date' in value
        ? (value as { date: unknown }).date
        : undefined;
    if (!isAllowedM1OpenDocId(idRaw)) {
      return {
        ok: false as const,
        error: 'invalid-doc-id',
        path: null as string | null,
        created: false,
      };
    }
    if (idRaw === 'dogfood-day') {
      // date required + allowlisted
      if (!isValidDogfoodDayDate(dateRaw)) {
        return {
          ok: false as const,
          error: 'invalid-date',
          path: null as string | null,
          created: false,
        };
      }
    }
    const docsDev = resolveDocsDevelopmentDir();
    if (!docsDev) {
      return {
        ok: false as const,
        error: 'docs-not-found',
        path: null as string | null,
        created: false,
      };
    }
    const resolved = resolveM1OpenDocPath(docsDev, idRaw as M1OpenDocId, {
      ensureTodayFromTemplate: idRaw === 'dogfood-today',
      date: typeof dateRaw === 'string' ? dateRaw : undefined,
    });
    if (!resolved) {
      return {
        ok: false as const,
        error: 'path-not-found',
        path: null as string | null,
        created: false,
      };
    }
    // Open with OS default app (editor / explorer for dirs)
    try {
      const openErr = await shell.openPath(resolved.path);
      if (openErr) {
        // Fallback: show in folder
        shell.showItemInFolder(resolved.path);
      }
    } catch {
      try {
        shell.showItemInFolder(resolved.path);
      } catch {
        return {
          ok: false as const,
          error: 'open-failed',
          path: resolved.path,
          created: resolved.created,
        };
      }
    }
    return {
      ok: true as const,
      error: null as string | null,
      path: resolved.path,
      created: resolved.created,
    };
  });

  // The renderer owns the theme preference; the native frame can only follow it
  // via nativeTheme.themeSource. Without this the OS chrome stays on whatever
  // the system resolved while the renderer switched, so light mode kept a dark
  // title bar.
  ipcMain.handle('desktop:set-theme', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const source = value === 'light' || value === 'dark' ? value : 'system';
    nativeTheme.themeSource = source;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0d0d0c' : '#f2eee6');
    }
    return { dark: nativeTheme.shouldUseDarkColors };
  });

  ipcMain.handle('desktop:set-global-shortcut', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('desktop.global-shortcut-invalid');
    }
    const record = value as { accelerator?: unknown; enabled?: unknown };
    const accelerator =
      typeof record.accelerator === 'string' ? record.accelerator.trim().slice(0, 80) : '';
    if (!accelerator || typeof record.enabled !== 'boolean') {
      throw new Error('desktop.global-shortcut-invalid');
    }

    if (registeredQuickWindowShortcut) {
      globalShortcut.unregister(registeredQuickWindowShortcut);
      registeredQuickWindowShortcut = null;
    }
    if (!record.enabled) return { registered: false, error: null };

    const registered = globalShortcut.register(accelerator, () => {
      toggleMainWindowVisibility();
    });
    if (registered) registeredQuickWindowShortcut = accelerator;
    return {
      registered,
      error: registered ? null : '快捷键已被其他应用占用',
    };
  });

  // Tray visibility is a renderer preference (renderer localStorage), pushed on
  // startup and whenever the user toggles it — the same pattern as the
  // quick-window shortcut above, since the main process cannot read renderer
  // storage. Turning the tray off also re-arms plain close-to-quit behaviour.
  ipcMain.handle('desktop:set-tray-visible', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const visible = Boolean(value);
    if (visible) setupDesktopTray();
    else destroyDesktopTray();
    return { visible };
  });

  ipcMain.handle('desktop:pick-folder', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const requestedTitle =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as { title?: unknown }).title
        : undefined;
    const options = {
      title: '为项目绑定文件夹',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    };
    if (typeof requestedTitle === 'string' && requestedTitle.trim().length > 0) {
      options.title = requestedTitle.trim().slice(0, 80);
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const, path: null };
    }
    return { canceled: false as const, path: result.filePaths[0]! };
  });

  ipcMain.handle('desktop:pick-skill-zip', async (event) => {
    assertRuntimeIpcSource(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择 Skill ZIP 文件',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [
        { name: 'Skill ZIP', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const, path: null };
    }
    return { canceled: false as const, path: result.filePaths[0]! };
  });

  // Fetch a bounded public SKILL.md document; Runtime still validates imports.
  ipcMain.handle('desktop:fetch-skill-md', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid fetch-skill-md payload');
    }
    const rawUrl = (value as { url?: unknown }).url;
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new Error('Invalid fetch-skill-md payload: url required');
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error('URL 无效，请检查后重试');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('仅支持 http(s) 链接');
    }
    // Convert GitHub blob URLs to raw content URLs.
    if (parsed.hostname === 'github.com') {
      const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(parsed.pathname);
      if (m) {
        parsed = new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
      }
    }
    const MAX_BYTES = 2 * 1024 * 1024;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { Accept: 'text/markdown, text/plain, */*' },
      });
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_BYTES) {
        throw new Error('文件超过 2 MB 限制');
      }
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
      if (!text.trim()) throw new Error('下载内容为空');
      return { url: parsed.toString(), skillMd: text };
    } finally {
      clearTimeout(timer);
    }
  });

  // Compose @-mention: list files under a bound project folder (local FS only).
  ipcMain.handle('desktop:list-project-files', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid list-project-files payload');
    }
    const payload = value as { root?: unknown; query?: unknown; maxEntries?: unknown };
    if (typeof payload.root !== 'string' || payload.root.trim().length === 0) {
      throw new Error('Invalid list-project-files payload: root required');
    }
    const root = path.resolve(payload.root);
    // Soft root existence check — listProjectFiles also handles missing roots.
    if (!fs.existsSync(root)) {
      return { root, files: [] as Array<{ path: string; name: string; kind: 'file' | 'dir' }> };
    }
    const files = listProjectFiles({
      root,
      query: typeof payload.query === 'string' ? payload.query : '',
      maxEntries:
        typeof payload.maxEntries === 'number' && payload.maxEntries > 0
          ? Math.min(payload.maxEntries, 500)
          : 200,
    });
    return { root, files };
  });

  ipcMain.handle('desktop:search-project-content', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid search-project-content payload');
    }
    const payload = value as Partial<SearchProjectContentPayload>;
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid search-project-content payload: root required');
    }
    if (typeof payload.query !== 'string' || !payload.query.trim()) {
      throw new Error('Invalid search-project-content payload: query required');
    }
    if (
      payload.maxResults !== undefined &&
      (!Number.isFinite(payload.maxResults) || payload.maxResults < 1)
    ) {
      throw new Error('Invalid search-project-content payload: maxResults invalid');
    }
    const controller = projectContentSearchRegistry.begin(event.sender.id);
    registerProjectContentSearchSenderCleanup(event.sender);
    try {
      return await searchProjectContent({
        root: payload.root,
        query: payload.query,
        ...(payload.maxResults === undefined ? {} : { maxResults: payload.maxResults }),
        signal: controller.signal,
      });
    } finally {
      projectContentSearchRegistry.release(event.sender.id, controller);
    }
  });

  registerPtyTerminalHandlers(ipcMain, { assertSource: assertRuntimeIpcSource });

  ipcMain.handle('desktop:start-project-terminal', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid start-project-terminal payload');
    }
    const payload = value as Partial<StartProjectTerminalPayload>;
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid start-project-terminal payload: root required');
    }
    if (
      typeof payload.terminalId !== 'string' ||
      !payload.terminalId.trim() ||
      payload.terminalId.length > 200 ||
      payload.terminalId.includes('\0')
    ) {
      throw new Error('Invalid start-project-terminal payload: terminalId required');
    }
    if (typeof payload.commandLine !== 'string' || !payload.commandLine.trim()) {
      throw new Error('Invalid start-project-terminal payload: commandLine required');
    }
    if (typeof payload.cwd !== 'string' || payload.cwd.length > 4_096) {
      throw new Error('Invalid start-project-terminal payload: cwd required');
    }
    const terminalId = payload.terminalId.trim();
    const reservation = projectTerminalRegistry.reserve(event.sender.id, terminalId);
    if (!reservation) {
      throw new Error('Terminal session is already running a command');
    }
    registerProjectTerminalSenderCleanup(event.sender);
    let keepReservation = false;
    try {
      if (event.sender.isDestroyed() || reservation.controller.signal.aborted) {
        throw new Error('Terminal start was cancelled before validation');
      }
      const cwdInput = payload.cwd.trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (
        path.isAbsolute(cwdInput) ||
        path.win32.isAbsolute(cwdInput) ||
        cwdInput.split('/').some((part) => part === '..')
      ) {
        throw new Error('Terminal cwd must stay inside the project root');
      }
      const parsed = parseProjectTerminalCommand(payload.commandLine);
      const commandId = randomUUID();
      if (parsed.kind === 'cd') {
        const resolved = await resolveProjectTerminalCwd(payload.root, cwdInput, parsed.path);
        if (event.sender.isDestroyed() || reservation.controller.signal.aborted) {
          throw new Error('Terminal start was cancelled during validation');
        }
        return {
          terminalId,
          commandId,
          cwd: resolved.cwd,
          state: 'completed',
        } satisfies StartProjectTerminalResult;
      }
      const resolved = await resolveProjectTerminalCwd(payload.root, '', cwdInput || '.');
      if (event.sender.isDestroyed() || reservation.controller.signal.aborted) {
        throw new Error('Terminal start was cancelled during validation');
      }
      const command: ActiveProjectTerminalCommand = {
        senderId: event.sender.id,
        terminalId,
        commandId,
        root: resolved.root,
        cwd: resolved.cwd,
        controller: reservation.controller,
        sender: event.sender,
      };
      if (!projectTerminalRegistry.activate(reservation, command)) {
        throw new Error('Terminal start was cancelled during validation');
      }
      keepReservation = true;
      void streamProjectTerminalCommand(command, reservation, parsed.command, parsed.args);
      return {
        terminalId,
        commandId,
        cwd: resolved.cwd,
        state: 'running',
      } satisfies StartProjectTerminalResult;
    } finally {
      if (!keepReservation) projectTerminalRegistry.release(reservation);
    }
  });

  ipcMain.handle('desktop:cancel-project-terminal', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid cancel-project-terminal payload');
    }
    const payload = value as Partial<CancelProjectTerminalPayload>;
    if (typeof payload.terminalId !== 'string' || !payload.terminalId.trim()) {
      throw new Error('Invalid cancel-project-terminal payload: terminalId required');
    }
    if (typeof payload.commandId !== 'string' || !payload.commandId.trim()) {
      throw new Error('Invalid cancel-project-terminal payload: commandId required');
    }
    return {
      cancelled: projectTerminalRegistry.cancel(
        event.sender.id,
        payload.terminalId.trim(),
        payload.commandId.trim(),
      ),
    };
  });

  // Read a project file through the canonical project-root boundary.
  ipcMain.handle('desktop:read-project-file', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid read-project-file payload');
    }
    const payload = value as { root?: unknown; path?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid read-project-file payload: root required');
    }
    if (typeof payload.path !== 'string' || !payload.path.trim()) {
      throw new Error('Invalid read-project-file payload: path required');
    }
    return readProjectFile({ root: payload.root, path: payload.path });
  });

  ipcMain.handle('desktop:write-project-file', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid write-project-file payload');
    }
    const payload = value as {
      root?: unknown;
      path?: unknown;
      content?: unknown;
      expectedMtimeMs?: unknown;
      expectedSize?: unknown;
      force?: unknown;
    };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid write-project-file payload: root required');
    }
    if (typeof payload.path !== 'string' || !payload.path.trim()) {
      throw new Error('Invalid write-project-file payload: path required');
    }
    if (typeof payload.content !== 'string') {
      throw new Error('Invalid write-project-file payload: content required');
    }
    if (payload.expectedMtimeMs !== null && typeof payload.expectedMtimeMs !== 'number') {
      throw new Error('Invalid write-project-file payload: expectedMtimeMs required');
    }
    if (
      payload.expectedSize !== undefined &&
      payload.expectedSize !== null &&
      typeof payload.expectedSize !== 'number'
    ) {
      throw new Error('Invalid write-project-file payload: expectedSize invalid');
    }
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new Error('Invalid write-project-file payload: force invalid');
    }
    return writeProjectFile({
      root: payload.root,
      path: payload.path,
      content: payload.content,
      expectedMtimeMs: payload.expectedMtimeMs,
      ...(payload.expectedSize === undefined ? {} : { expectedSize: payload.expectedSize }),
      ...(payload.force === undefined ? {} : { force: payload.force }),
    });
  });

  ipcMain.handle('desktop:watch-project-file', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid watch-project-file payload');
    }
    const payload = value as { root?: unknown; path?: unknown; subscriptionId?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid watch-project-file payload: root required');
    }
    if (typeof payload.path !== 'string' || !payload.path.trim()) {
      throw new Error('Invalid watch-project-file payload: path required');
    }
    if (
      typeof payload.subscriptionId !== 'string' ||
      !payload.subscriptionId.trim() ||
      payload.subscriptionId.length > 200
    ) {
      throw new Error('Invalid watch-project-file payload: subscriptionId required');
    }
    const subscriptionId = payload.subscriptionId.trim();
    const key = projectFileWatchKey(event.sender.id, subscriptionId);
    projectFileWatchSubscriptions.get(key)?.dispose();
    projectFileWatchSubscriptions.delete(key);
    const dispose = await watchProjectFile({ root: payload.root, path: payload.path }, (change) =>
      sendProjectFileChangeToRenderer(event.sender, subscriptionId, change),
    );
    if (event.sender.isDestroyed()) {
      dispose();
      return { subscriptionId };
    }
    projectFileWatchSubscriptions.set(key, { senderId: event.sender.id, dispose });
    if (!projectFileWatchCleanupRegisteredSenders.has(event.sender.id)) {
      projectFileWatchCleanupRegisteredSenders.add(event.sender.id);
      event.sender.once('destroyed', () => {
        projectFileWatchCleanupRegisteredSenders.delete(event.sender.id);
        disposeProjectFileWatchesForSender(event.sender.id);
      });
    }
    return { subscriptionId };
  });

  ipcMain.handle('desktop:unwatch-project-file', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid unwatch-project-file payload');
    }
    const payload = value as { subscriptionId?: unknown };
    if (typeof payload.subscriptionId !== 'string' || !payload.subscriptionId.trim()) {
      throw new Error('Invalid unwatch-project-file payload: subscriptionId required');
    }
    const key = projectFileWatchKey(event.sender.id, payload.subscriptionId.trim());
    projectFileWatchSubscriptions.get(key)?.dispose();
    projectFileWatchSubscriptions.delete(key);
    return { subscriptionId: payload.subscriptionId.trim() };
  });

  // Lazily enumerate one project directory level without following escapes.
  ipcMain.handle('desktop:list-project-dir', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid list-project-dir payload');
    }
    const payload = value as { root?: unknown; dir?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid list-project-dir payload: root required');
    }
    const root = path.resolve(payload.root);
    const relDir = typeof payload.dir === 'string' ? payload.dir : '';
    const target = path.resolve(root, relDir);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('list-project-dir: path escapes the project root');
    }
    const HEAVY_DIRS = new Set([
      '.git',
      'node_modules',
      'dist',
      'build',
      'out',
      '.next',
      '.turbo',
      '.cache',
      'coverage',
      '.venv',
      'venv',
      '__pycache__',
    ]);
    try {
      const names = fs.readdirSync(target);
      const entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }> = [];
      for (const name of names) {
        if (HEAVY_DIRS.has(name)) continue;
        const abs = path.join(target, name);
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(abs);
        } catch {
          continue;
        }
        if (stat.isSymbolicLink()) continue;
        const rel = (relDir ? `${relDir}/${name}` : name).replace(/\\/g, '/');
        if (stat.isDirectory()) entries.push({ name, path: rel, kind: 'dir' });
        else if (stat.isFile()) entries.push({ name, path: rel, kind: 'file' });
        if (entries.length >= 500) break;
      }
      // Dirs first, then files; each group alphabetical (case-insensitive).
      entries.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'dir'
            ? -1
            : 1
          : a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
      return { dir: relDir, entries };
    } catch {
      return { dir: relDir, entries: [] };
    }
  });

  // Git stays in Main: Renderer sends typed intent and never constructs shell commands.
  ipcMain.handle('desktop:git-checkout', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-checkout payload');
    }
    const payload = value as { root?: unknown; branch?: unknown; strategy?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-checkout payload: root required');
    }
    if (typeof payload.branch !== 'string' || !payload.branch.trim()) {
      throw new Error('Invalid git-checkout payload: branch required');
    }
    const strategy =
      payload.strategy === 'stash' || payload.strategy === 'force' ? payload.strategy : 'check';
    return checkoutProjectBranch(payload.root, payload.branch, strategy);
  });

  ipcMain.handle('desktop:git-info', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-info payload');
    }
    const payload = value as { root?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-info payload: root required');
    }
    return getProjectGitInfo(payload.root);
  });

  ipcMain.handle('desktop:git-review', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-review payload');
    }
    const payload = value as { root?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-review payload: root required');
    }
    return getProjectGitReview(payload.root);
  });

  ipcMain.handle('desktop:git-create-branch', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-create-branch payload');
    }
    const payload = value as { root?: unknown; branch?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-create-branch payload: root required');
    }
    if (typeof payload.branch !== 'string' || !payload.branch.trim()) {
      throw new Error('Invalid git-create-branch payload: branch required');
    }
    return createProjectBranch(payload.root, payload.branch);
  });

  ipcMain.handle('desktop:git-commit', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-commit payload');
    }
    const payload = value as {
      root?: unknown;
      message?: unknown;
      includeUnstaged?: unknown;
      push?: unknown;
    };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-commit payload: root required');
    }
    if (typeof payload.message !== 'string' || !payload.message.trim()) {
      throw new Error('Invalid git-commit payload: message required');
    }
    return commitProjectChanges(payload.root, {
      message: payload.message,
      includeUnstaged: payload.includeUnstaged !== false,
      push: payload.push === true,
    });
  });

  ipcMain.handle('desktop:git-push', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-push payload');
    }
    const payload = value as { root?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-push payload: root required');
    }
    return pushProjectBranch(payload.root);
  });
}

void app
  .whenReady()
  .then(async () => {
    await initializeDesktopRuntimeIdentity();
    prepareDesktopUpdateInstallProbeCertificate();
    initializeDesktopUpdater();
    protocol.handle('sync-think-image', async (request) => {
      try {
        const url = new URL(request.url);
        // Serve only PNG screenshots stored under a project .sync-think/screenshots directory.
        if (url.hostname === 'screenshot') {
          const raw = decodeURIComponent(url.pathname.replace(/^\//, ''));
          const absolute = path.resolve(raw);
          const normalized = absolute.split(path.sep).join('/');
          if (
            !normalized.includes('/.sync-think/screenshots/') ||
            !absolute.toLowerCase().endsWith('.png') ||
            !fs.existsSync(absolute)
          ) {
            return new Response('Not found', { status: 404 });
          }
          return new Response(new Uint8Array(fs.readFileSync(absolute)), {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          });
        }
        if (url.hostname === 'generated') {
          const raw = decodeURIComponent(url.pathname.replace(/^\//, ''));
          const absolute = path.resolve(raw);
          const normalized = absolute.split(path.sep).join('/');
          const ext = path.extname(absolute).toLowerCase();
          const mime =
            ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.png'
                  ? 'image/png'
                  : null;
          if (
            !normalized.includes('/.sync-think/generated-images/') ||
            !mime ||
            !fs.existsSync(absolute)
          ) {
            return new Response('Not found', { status: 404 });
          }
          return new Response(new Uint8Array(fs.readFileSync(absolute)), {
            headers: {
              'Content-Type': mime,
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          });
        }
        if (url.hostname === 'artifact') {
          const token = decodeURIComponent(url.pathname.replace(/^\//, ''));
          if (!token || token.includes('/')) {
            return new Response('Not found', { status: 404 });
          }
          const image = await artifactImagePreviewRegistry.read(token);
          if (!image) return new Response('Not found', { status: 404 });
          return new Response(new Uint8Array(image.data), {
            headers: {
              'Content-Type': image.mimeType,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        if (url.hostname !== 'media') {
          return new Response('Not found', { status: 404 });
        }
        const storageRef = decodeURIComponent(url.pathname.replace(/^\//, ''));
        const image = readMessageImage(storageRef);
        if (!image) return new Response('Not found', { status: 404 });
        return new Response(new Uint8Array(image.data), {
          headers: {
            'Content-Type': image.mimeType,
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
    // Register syncthink:// as a system handler so OS-launched links route
    // back to this running app instance.
    app.setAsDefaultProtocolClient('syncthink');
    setupRuntimeBridge();
    createWindow();
    setupDesktopTray();
    void maybeCheckForDesktopUpdatesAtStartup().catch(() => undefined);
    void bootstrapPrivateKernelsAtStartup().catch((error: unknown) => {
      console.warn(
        '[desktop] private kernel first-run install failed',
        error instanceof Error ? error.message : error,
      );
    });
    void maybeRunDesktopUpdateInstallProbe().catch((error: unknown) => {
      console.error(
        '[desktop] update install probe failed',
        error instanceof Error ? error.message : 'desktop.update.probe-failed',
      );
    });

    // macOS: the OS passes a clicked syncthink:// URL here, including from a
    // second process launch while the first is running.
    app.on('open-url', (_event, url) => {
      _event.preventDefault();
      handleDeepLink(url);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Flush any deep link that arrived before the window showed its content.
    ipcMain.on('desktop:renderer-ready', (event) => {
      if (event.sender === mainWindow?.webContents && pendingDeepLinkConversationId) {
        const id = pendingDeepLinkConversationId;
        pendingDeepLinkConversationId = null;
        sendOpenConversationToRenderer(id);
      }
    });
  })
  .catch(handleDesktopStartupFailure);

// Single instance: a second launch (e.g. clicking a syncthink:// link in
// Windows/Linux) routes the argv to the already-running first instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Focus the existing window first, then deliver the link.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    const link = findDeepLinkInArgv(argv);
    if (link) handleDeepLink(link);
  });
}

// Cold start with a link in argv (Windows/Linux): resolve it after ready.
{
  const initialLink = findDeepLinkInArgv(process.argv);
  if (initialLink) {
    app.whenReady().then(() => handleDeepLink(initialLink));
  }
}

function shutdownDesktopServices(reason: DesktopShutdownReason = 'desktop-exit'): Promise<void> {
  if (desktopShutdownPromise) return desktopShutdownPromise;
  shutdownStarted = true;
  const plan = planDesktopShutdown(reason);
  projectContentSearchRegistry.abortAll();
  abortAllProjectTerminals();
  killAllPtys();
  for (const subscription of projectFileWatchSubscriptions.values()) subscription.dispose();
  projectFileWatchSubscriptions.clear();
  runtimeClient?.disconnect();
  runtimeClient = null;

  desktopShutdownPromise = Promise.allSettled([
    desktopUpdateController?.flushRecoveryEvidence() ?? Promise.resolve(),
    executeDesktopShutdownPlan(plan, {
      stopDaemon: () => stopManagedDaemon(12_000, getDesktopRuntimeIdentity()),
      stopRuntime: () => stopManagedRuntime(12_000, getDesktopRuntimeIdentity()),
    }),
  ]).then((results) => {
    runtimeShutdownComplete = true;
    const executionOwnerResult = results[1];
    if (executionOwnerResult?.status === 'rejected') throw executionOwnerResult.reason;
  });
  return desktopShutdownPromise;
}

app.on('before-quit', (event) => {
  // Mark the quit as real before anything can re-enter the close handler.
  isQuitting = true;
  if (registeredQuickWindowShortcut) {
    globalShortcut.unregister(registeredQuickWindowShortcut);
    registeredQuickWindowShortcut = null;
  }
  if (runtimeShutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  void shutdownDesktopServices().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // With close-to-tray active the window is hidden rather than destroyed, so
  // this fires only when the tray is off — and then quitting is correct, since
  // an app with neither window nor tray icon would be unreachable.
  if (isDesktopTrayActive()) return;
  app.quit();
});
