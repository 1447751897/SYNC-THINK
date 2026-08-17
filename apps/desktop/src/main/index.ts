// Electron main entry. UI lifecycle is decoupled from the Runtime by design — the Runtime runs as a separate process and survives UI restarts (ADR-006).
// The main process owns the safe-storage-based credential broker (TD-005).
//
// Phase 0: this file is type-only; the binary itself is blocked on installing
// Visual Studio Build Tools. Once installed and `pnpm rebuild electron` runs,
// `pnpm dev:desktop` launches this module.

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
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
import { FileRuntimeActivityCursorStore } from './runtime-activity-cursor-store.js';
import {
  isAllowedM1OpenDocId,
  isValidDogfoodDayDate,
  resolveDocsDevelopmentDir,
  resolveM1OpenDocPath,
  type M1OpenDocId,
} from './m1-open-doc.js';
import { listProjectFiles } from './project-files.js';
import { ProjectContentSearchRegistry, searchProjectContent } from './project-content-search.js';
import { parseProjectTerminalCommand, resolveProjectTerminalCwd } from './project-terminal.js';
import {
  ProjectTerminalRegistry,
  type ProjectTerminalReservation,
} from './project-terminal-registry.js';
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
import {
  encodeFrame,
  decodeFrames,
  normalizeSelectedSkillVersionIds,
  type ConversationTransientFrame,
  type ConversationTransientSnapshot,
  type GatewayLogsResponse,
  type KernelDetectResponse,
  type OpenGatewayStatusResponse,
} from '@sync-think/protocol';
import type {
  AppendMessagePayload,
  AppendMessageResponse,
  CancelRunPayload,
  Frame,
  GetArtifactVersionResponse,
} from '@sync-think/protocol';
import {
  parseArchiveTaskPayload,
  parseBindWorkspaceFolderPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseUpdateWorkspacePayload,
  parseDeleteWorkspacePayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseUnarchiveTaskPayload,
} from '../workspace-payloads.js';
import {
  parseCreateProviderPayload,
  parseUpdateProviderPayload,
  parsePreviewCcSwitchImportPayload,
  parseImportCcSwitchPayload,
  parseListProvidersPayload,
  parseDiscoverModelsPayload,
  parseAddModelsPayload,
  parseProbeCapabilitiesPayload,
  parseConfirmCapabilitiesPayload,
  parseReorderProvidersPayload,
  parseAddProviderCredentialMetadata,
  parseRemoveProviderCredentialPayload,
  parseRevealProviderCredentialPayload,
  parseUpdateProviderCredentialMetadata,
  parseSetModelPrioritiesPayload,
  parseUpdateModelPayload,
  parseRemoveModelPayload,
  parseGetSettingsPayload,
  parseSetSettingPayload,
  parseUsageSummaryPayload,
} from '../provider-payloads.js';
import {
  createProviderPayloadFromClipboard,
  updateProviderPayloadFromClipboard,
} from './provider-clipboard.js';
import {
  parseGetAgentPayload,
  parseUpdateAgentBindingPayload,
  parseImportSkillPayload,
  parseImportRemoteSkillPayload,
  parseListSkillsPayload,
  parseDeleteSkillPayload,
  parseGetSkillPayload,
  parseSetSkillEnabledPayload,
  parseRegisterMcpServerPayload,
  parseRegisterRemoteMcpPayload,
  parseListMcpServersPayload,
  parseSetMcpServerEnabledPayload,
  parseDeleteMcpServerPayload,
  parseProbeMcpPolicyPayload,
  parseRequestMcpToolPayload,
  parseProbeMcpSpawnPayload,
  parseCallMcpToolPayload,
  parseRefreshMcpToolsPayload,
} from '../agent-payloads.js';

function goalConversationId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.conversationId !== 'string' || !record.conversationId.trim()) return undefined;
  return record.conversationId.trim();
}

function parseGoalSetPayloadLocal(value: unknown): import('@sync-think/protocol').GoalSetPayload | undefined {
  const conversationId = goalConversationId(value);
  if (!conversationId || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const condition = typeof (value as Record<string, unknown>).condition === 'string'
    ? ((value as Record<string, unknown>).condition as string).trim()
    : '';
  if (!condition || condition.length > 4000) return undefined;
  return { conversationId, condition };
}

function parseGoalGetPayloadLocal(value: unknown): import('@sync-think/protocol').GoalGetPayload | undefined {
  const conversationId = goalConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

function parseGoalClearPayloadLocal(value: unknown): import('@sync-think/protocol').GoalClearPayload | undefined {
  const conversationId = goalConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

function parseGoalPausePayloadLocal(value: unknown): import('@sync-think/protocol').GoalPausePayload | undefined {
  const conversationId = goalConversationId(value);
  return conversationId ? { conversationId } : undefined;
}

function parseGoalResumePayloadLocal(value: unknown): import('@sync-think/protocol').GoalResumePayload | undefined {
  const conversationId = goalConversationId(value);
  return conversationId ? { conversationId } : undefined;
}
import {
  parseCapabilityGovernanceListPayload,
  parseCapabilityWorkspaceListPayload,
  parseCapabilityWorkspaceSetActivePayload,
  parseGetLatestCapabilityOrganizePayload,
  parseGetSkillPublishDraftPayload,
  parseListSkillPublishDraftsPayload,
  parsePreviewCapabilityOrganizePayload,
  parseSaveSkillPublishDraftPayload,
  parseSubmitSkillPublishDraftPayload,
} from '../capability-payloads.js';
import {
  parseDecideMemoryPayload,
  parseRollbackMemoryPayload,
  parseListDiagnosticsPayload,
  parseListMemoryPayload,
} from '../memory-payloads.js';
import {
  parseListApprovalsPayload,
  parseEvaluateApprovalPayload,
  parseEnqueueApprovalPayload,
  parseDecideApprovalPayload,
} from '../approval-payloads.js';
import {
  parseCancelBrowserHandoffPayload,
  parseContinueBrowserHandoffPayload,
  parseListWaitingBrowserHandoffsPayload,
} from '../browser-handoff-payloads.js';
import {
  parseClearBrowserSiteSessionPayload,
  parseCreateBrowserProfilePayload,
  parseDeleteBrowserProfilePayload,
  parseListBrowserProfilesPayload,
  parseListBrowserSiteSessionsPayload,
  parseRenameBrowserProfilePayload,
} from '../browser-profile-payloads.js';
import {
  parseGetBrowserRecordingPayload,
  parseListBrowserRecordingsPayload,
  parseStartBrowserRecordingPayload,
  parseStopBrowserRecordingPayload,
} from '../browser-recording-payloads.js';
import {
  parseCreateBrowserWorkflowDraftPayload,
  parseCreateBrowserWorkflowRevisionDraftPayload,
  parseExecuteBrowserWorkflowPayload,
  parseGetBrowserWorkflowPayload,
  parseListBrowserWorkflowsPayload,
  parseApproveExecuteBrowserWorkflowPayload,
  parseReviewBrowserWorkflowDraftPayload,
  parseSubmitBrowserWorkflowDraftPayload,
} from '../browser-workflow-payloads.js';
import {
  parseCancelDesktopCommandPayload,
  parseContinueDesktopCommandPayload,
  parseListWaitingDesktopCommandsPayload,
} from '../desktop-command-payloads.js';
import {
  parsePeekContextPacketPayload,
  parseAmendContextPacketPayload,
} from '../context-payloads.js';
import {
  parseArtifactComparePayload,
  parseArtifactImagePreviewPayload,
  parseArtifactConflictListPayload,
  parseArtifactConflictResolutionPayload,
  parseArtifactListPayload,
  parseArtifactMergePayload,
  parseArtifactSelectPayload,
  parseModeSetPayload,
  parsePlanApprovePayload,
  parsePlanCreatePayload,
  parsePlanListPayload,
  parsePlanRevisePayload,
  parsePolicyListPayload,
  parsePolicySavePayload,
  parseRunGraphPayload,
  parseRunMutationPayload,
  parseAgentCreatePayload,
  parseAgentCreateVersionPayload,
  parseAgentListPayload,
  parseAgentVersionsPayload,
} from '../orchestration-payloads.js';
import {
  parseCreateConversationPayload,
  parseCreateGlobalAgentPayload,
  parseCreateTeamPayload,
  parseDeleteConversationPayload,
  parseConversationCompactPayload,
  parseDeleteGlobalAgentPayload,
  parseDeleteTeamPayload,
  parseListConversationsPayload,
  parseConversationListMessagesPayload,
  parseConversationGetContextStatusPayload,
  parseConversationGetRunProcessPayload,
  parseSubscribeConversationTransientStreamPayload,
  parseUnsubscribeConversationTransientStreamPayload,
  parseListGlobalAgentsPayload,
  parseRenameConversationPayload,
  parseSetConversationArchivedPayload,
  parseSetConversationExecutionModePayload,
  parseSetConversationInteractionModePayload,
  parseConversationPlanSubmitPayload,
  parseConversationPlanGetPayload,
  parseConversationPlanApprovePayload,
  parseConversationPlanRevisePayload,
  parseConversationPlanCancelPayload,
  parseConversationAskAnswerPayload,
  parseConversationAskCancelPayload,
  parseConversationAskPendingPayload,
  parseCreateScheduledTaskPayload,
  parseListScheduledTasksPayload,
  parseUpdateScheduledTaskPayload,
  parseDeleteScheduledTaskPayload,
  parseTriggerScheduledTaskPayload,
  parseSkillLocalScanPayload,
  parseSkillLocalImportPayload,
  parseSetConversationPinnedPayload,
  parseSetTeamRunStatusPayload,
  parseStartTeamRunPayload,
  parseUpdateGlobalAgentPayload,
  parseUpdateTeamPayload,
  parseUpgradeConversationTrackPayload,
  parseRebindConversationTargetPayload,
  parseConversationDecideToolApprovalPayload,
  parseConversationSubmitBrowserResultPayload,
} from '../team-payloads.js';
import type { Event } from '@sync-think/shared';
import { ElectronSafeStorageBackend, SecureStore } from '@sync-think/secure-store';
import {
  assertTrustedRendererIpcSource,
  installNavigationGuards,
  isTrustedRendererUrl,
  parseLoopbackDevServerUrl,
  trustedFileLocation,
} from './renderer-security.js';
import type { TrustedRendererLocation } from './renderer-security.js';
import {
  DesktopUpdateController,
  resolveDesktopUpdateConfiguration,
  type DesktopUpdateConfiguration,
} from './desktop-updater.js';
import { createElectronUpdaterDriver } from './electron-updater-driver.js';
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
  ensureRuntimeProcess,
  resolveManagedRuntimeDatabasePath,
  stopManagedRuntime,
} from './runtime-supervisor.js';
import { ArtifactImagePreviewRegistry } from './artifact-image-preview.js';
import {
  describeDesktopRuntimeIdentity,
  resolveDesktopRuntimeIdentity,
  type DesktopRuntimeIdentity,
} from './packaged-install-identity.js';
import { stageChatImageDataUrl } from './image-staging.js';
import { messageImageUrl, persistMessageImages, readMessageImage } from './message-images.js';
import {
  CAPABILITY_RUNTIME_IPC_CHANNELS,
  type RuntimeConnectOutcome,
  type RuntimeConnectResult,
} from '../runtime-bridge-contract.js';
import { TerminalProcessWorker, type TerminalWorkerOutput } from '@sync-think/workers';
import type {
  CancelProjectTerminalPayload,
  ProjectTerminalEvent,
  SearchProjectContentPayload,
  StartProjectTerminalPayload,
  StartProjectTerminalResult,
} from '../workspace-tools-contract.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sync-think-image',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
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
let trustedRendererLocation: TrustedRendererLocation | null = null;
let runtimeClient: RuntimePipeClient | null = null;
let desktopRuntimeIdentity: DesktopRuntimeIdentity | null = null;
let shutdownStarted = false;
let runtimeShutdownComplete = false;
let runtimeSession: RuntimeSession | null = null;
let desktopUpdateController: DesktopUpdateController | null = null;
let desktopUpdateRollbackCoordinator: DesktopUpdateRollbackCoordinator | null = null;
let desktopUpdateRollbackHealthPromise: Promise<void> | null = null;
let desktopShutdownPromise: Promise<void> | null = null;
type KernelInstallResult = { ok: true } | { ok: false; error: string };
let piKernelInstallPromise: Promise<KernelInstallResult> | null = null;
const transientCleanupRegisteredSenders = new Set<number>();
const projectFileWatchCleanupRegisteredSenders = new Set<number>();
const projectFileWatchSubscriptions = new Map<string, { senderId: number; dispose: () => void }>();
const projectTerminalCleanupRegisteredSenders = new Set<number>();
const projectContentSearchCleanupRegisteredSenders = new Set<number>();
const projectContentSearchRegistry = new ProjectContentSearchRegistry();

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
      await shutdownDesktopServices();
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
      const created = await getRuntimeClient().request<{ workspaceId: string }>(
        'workspace.create',
        {
          name,
        },
      );
      return created.workspaceId;
    },
    markerExists: async (name, markerId) => {
      const listed = await getRuntimeClient().request<{
        workspaces: Array<{ workspaceId: string; name: string }>;
      }>('workspace.list', {});
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

function getDesktopUpdateController(): DesktopUpdateController {
  if (!desktopUpdateController) throw new Error('desktop.update.not-initialized');
  return desktopUpdateController;
}

function createWindow(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const parsedDevServerUrl =
    !app.isPackaged && devServerUrl ? parseLoopbackDevServerUrl(devServerUrl) : null;
  // NewMax-style shell is the default product UI (dist/renderer-shell).
  // Set SYNC_THINK_SHELL=0 (or legacy) to force the old task-board renderer.
  const shellFlag = (process.env.SYNC_THINK_SHELL ?? '1').trim().toLowerCase();
  const useShell = !(shellFlag === '0' || shellFlag === 'false' || shellFlag === 'legacy');
  const rendererPath = path.join(
    __dirname,
    useShell ? '../renderer-shell/index.html' : '../renderer/index.html',
  );
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
    const src = String(params.src ?? '');
    // Allow the interactive-HTML sandbox (data:text/html, see HtmlSandbox.tsx)
    // alongside the trusted http(s)/about:blank set. data: of any other type
    // (images, scripts, etc.) stays blocked.
    if (
      src &&
      !/^https?:\/\//i.test(src) &&
      src !== 'about:blank' &&
      !/^data:text\/html(;|,)/i.test(src)
    ) {
      event.preventDefault();
    }
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
  const window = mainWindow;
  const location = trustedRendererLocation;
  if (!window || !location || window.isDestroyed()) return;
  const webContents = window.webContents;
  if (webContents.isDestroyed() || !isTrustedRendererUrl(webContents.getURL(), location)) {
    return;
  }
  webContents.send('runtime:event', event);
}

function sendRuntimeTransientFrameToRenderer(
  sender: IpcMainInvokeEvent['sender'],
  subscriptionId: string,
  payload:
    | { type: 'frame'; frame: ConversationTransientFrame }
    | {
        type: 'reset';
        latestStreamSequence: number;
        snapshot?: ConversationTransientSnapshot;
      },
): void {
  const location = trustedRendererLocation;
  if (!location || sender.isDestroyed() || !isTrustedRendererUrl(sender.getURL(), location)) {
    return;
  }
  sender.send('runtime:conversation-transient', { subscriptionId, ...payload });
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
    const events = new TerminalProcessWorker().exec(
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
  );
  return runtimeSession;
}

async function ensureRuntimeConnection(): Promise<RuntimeConnectResult> {
  // Every IPC path that needs Runtime must tolerate cold start without a
  // pre-launched `pnpm dev:runtime`.
  await ensureRuntimeProcess(getDesktopRuntimeIdentity());
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
    // Auto-start the local Runtime pipe process when missing (dev + future release).
    // Without this, cold start shows「加载中…」forever if pnpm dev:runtime wasn't launched.
    const supervised = await ensureRuntimeProcess(getDesktopRuntimeIdentity());
    if (!supervised.ready) {
      return {
        ok: false,
        error: {
          code: 'runtime.unavailable',
          retryable: true,
        },
      };
    }
    return { ok: true, result: await ensureRuntimeConnection() };
  } catch (error) {
    // One more ensure+retry: race where pipe appears mid-handshake.
    try {
      await ensureRuntimeProcess(getDesktopRuntimeIdentity());
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
interface StagedAppendMessagePayload {
  payload: unknown;
  images: Array<{ name: string; mimeType: string; stagingPath: string }>;
}

function stageAppendMessageImages(value: unknown): StagedAppendMessagePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { payload: value, images: [] };
  }
  const payload = value as { images?: unknown };
  if (!Array.isArray(payload.images) || payload.images.length === 0) {
    return { payload: value, images: [] };
  }
  const durableImages: Array<{ name: string; mimeType: string; stagingPath: string }> = [];
  const images = payload.images.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const image = raw as {
      name?: string;
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
      // Always stage: even "small" screenshots often exceed the 1 MiB frame after JSON.
      const staged = stageChatImageDataUrl({
        name: image.name || 'image',
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      });
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
  return { payload: { ...(value as object), images }, images: durableImages };
}

function parseAppendMessagePayload(value: unknown): AppendMessagePayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid append-message payload');
  }
  const payload = value as Partial<AppendMessagePayload>;
  const validRoles = new Set(['user', 'assistant', 'system', 'tool']);
  const hasImages = Array.isArray(payload.images) && payload.images.length > 0;
  if (
    typeof payload.threadId !== 'string' ||
    payload.threadId.length === 0 ||
    !Number.isInteger(payload.expectedTaskVersion) ||
    (payload.expectedTaskVersion ?? -1) < 0 ||
    typeof payload.role !== 'string' ||
    !validRoles.has(payload.role) ||
    typeof payload.text !== 'string' ||
    payload.text.length > 100_000 ||
    (!hasImages && payload.text.trim().length === 0)
  ) {
    throw new Error('Invalid append-message payload');
  }
  if (payload.images !== undefined) {
    if (!Array.isArray(payload.images) || payload.images.length > 8) {
      throw new Error('Invalid append-message images');
    }
    for (const image of payload.images) {
      if (
        !image ||
        typeof image !== 'object' ||
        typeof image.name !== 'string' ||
        typeof image.mimeType !== 'string' ||
        !image.mimeType.startsWith('image/')
      ) {
        throw new Error('Invalid append-message image item');
      }
      const hasDataUrl =
        typeof image.dataUrl === 'string' &&
        image.dataUrl.startsWith('data:image/') &&
        image.dataUrl.length <= 700_000;
      const hasStagingPath = typeof image.stagingPath === 'string' && image.stagingPath.length > 0;
      if (!hasDataUrl && !hasStagingPath) {
        throw new Error('Invalid append-message image item');
      }
    }
  }
  if (payload.networkEnabled !== undefined && typeof payload.networkEnabled !== 'boolean') {
    throw new Error('Invalid append-message networkEnabled');
  }
  const skillVersionIds = normalizeSelectedSkillVersionIds(payload.skillVersionIds);
  return {
    ...payload,
    ...(skillVersionIds === undefined ? {} : { skillVersionIds }),
  } as AppendMessagePayload;
}

function parseCancelRunPayload(value: unknown): CancelRunPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid cancel-run payload');
  }
  const payload = value as Partial<CancelRunPayload>;
  if (
    typeof payload.runId !== 'string' ||
    payload.runId.length === 0 ||
    payload.runId.length > 256
  ) {
    throw new Error('Invalid cancel-run payload');
  }
  return payload as CancelRunPayload;
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
  piKernelInstallPromise = new Promise<KernelInstallResult>((resolve) => {
    void import('node:child_process')
      .then(({ spawn }) => {
        const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
        const args =
          process.platform === 'win32'
            ? ['/d', '/s', '/c', 'npm', 'i', '-g', 'pi']
            : ['i', '-g', 'pi'];
        const child = spawn(executable, args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        const timeout = setTimeout(() => child.kill(), 5 * 60_000);
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          if (stderr.length < 8_192) stderr += chunk.slice(0, 8_192 - stderr.length);
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          resolve({ ok: false, error: `无法启动 npm：${error.message}` });
        });
        child.once('close', (code, signal) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve({ ok: true });
            return;
          }
          const detail = stderr.trim().split(/\r?\n/).slice(-4).join('\n');
          resolve({
            ok: false,
            error:
              detail ||
              (signal
                ? `npm 安装被终止（${signal}）`
                : `npm 安装失败（退出码 ${code ?? 'unknown'}）`),
          });
        });
      })
      .catch((error: unknown) => {
        resolve({ ok: false, error: `无法加载进程执行能力：${errorMessage(error)}` });
      });
  }).finally(() => {
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

  ipcMain.handle('runtime:connect', (event) => {
    assertRuntimeIpcSource(event);
    return connectRendererToRuntime();
  });
  ipcMain.handle('runtime:append-message', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    // Stage large images on disk first — named pipe frames are capped at 1 MiB.
    const staged = stageAppendMessageImages(value);
    const response = await getRuntimeClient().request<AppendMessageResponse>(
      'task.appendMessage',
      parseAppendMessagePayload(staged.payload),
    );
    if (staged.images.length === 0) return response;

    const images = persistMessageImages(String(response.messageId), staged.images).map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      storageRef: image.storageRef,
      url: messageImageUrl(image.storageRef),
    }));
    if (images.length > 0) {
      const eventDraft = {
        type: 'message.images-attached',
        threadId: (staged.payload as AppendMessagePayload).threadId,
        messageId: response.messageId,
        images: images.map(({ url: _url, ...image }) => image),
      };
      // The Runtime persists the lightweight attachment refs as a separate event.
      await getRuntimeClient().request('message.attachImages', eventDraft);
    }
    return { ...response, images };
  });
  ipcMain.handle('runtime:workspace-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('workspace.create', parseCreateWorkspacePayload(value));
  });
  ipcMain.handle('runtime:workspace-bind-folder', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'workspace.bindFolder',
      parseBindWorkspaceFolderPayload(value),
    );
  });
  ipcMain.handle('runtime:workspace-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('workspace.list', parseListWorkspacesPayload(value));
  });
  ipcMain.handle('runtime:workspace-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('workspace.update', parseUpdateWorkspacePayload(value));
  });
  ipcMain.handle('runtime:workspace-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('workspace.delete', parseDeleteWorkspacePayload(value));
  });
  ipcMain.handle('runtime:task-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.create', parseCreateTaskPayload(value));
  });
  ipcMain.handle('runtime:task-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.list', parseListTasksPayload(value));
  });
  ipcMain.handle('runtime:task-open', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.open', parseOpenTaskPayload(value));
  });
  ipcMain.handle('runtime:task-search', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.search', parseSearchTasksPayload(value));
  });
  ipcMain.handle('runtime:mode-set', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.setParticipationMode', parseModeSetPayload(value));
  });
  ipcMain.handle('runtime:task-archive', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.archive', parseArchiveTaskPayload(value));
  });
  ipcMain.handle('runtime:task-unarchive', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.unarchive', parseUnarchiveTaskPayload(value));
  });
  ipcMain.handle('runtime:plan-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('plan.draft', parsePlanCreatePayload(value));
  });
  ipcMain.handle('runtime:plan-revise', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('plan.revise', parsePlanRevisePayload(value));
  });
  ipcMain.handle('runtime:plan-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('plan.listRevisions', parsePlanListPayload(value));
  });
  ipcMain.handle('runtime:plan-approve', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('plan.approve', parsePlanApprovePayload(value));
  });
  ipcMain.handle('runtime:run-graph', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.getGraph', parseRunGraphPayload(value));
  });
  ipcMain.handle('runtime:orchestration-run-pause', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.pause', parseRunMutationPayload(value));
  });
  ipcMain.handle('runtime:orchestration-run-resume', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.resume', parseRunMutationPayload(value));
  });
  ipcMain.handle('runtime:orchestration-run-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.cancel', parseRunMutationPayload(value));
  });
  ipcMain.handle('runtime:policy-save', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('policy.save', parsePolicySavePayload(value));
  });
  ipcMain.handle('runtime:policy-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('policy.list', parsePolicyListPayload(value));
  });
  ipcMain.handle('runtime:artifact-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('artifact.list', parseArtifactListPayload(value));
  });
  ipcMain.handle('runtime:artifact-image-preview', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    const payload = parseArtifactImagePreviewPayload(value);
    const response = await getRuntimeClient().request<GetArtifactVersionResponse>(
      'artifact.getVersion',
      payload,
    );
    return artifactImagePreviewRegistry.register({
      artifactVersionId: String(response.version.id),
      contentRef: response.version.contentRef,
      contentHash: response.version.contentHash,
      mimeType: response.version.mimeType,
    });
  });
  ipcMain.handle('runtime:artifact-compare', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('artifact.compare', parseArtifactComparePayload(value));
  });
  ipcMain.handle('runtime:artifact-select', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('artifact.selectVersion', parseArtifactSelectPayload(value));
  });
  ipcMain.handle('runtime:artifact-merge', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('artifact.merge', parseArtifactMergePayload(value));
  });
  ipcMain.handle('runtime:artifact-conflict-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'artifact.listConflicts',
      parseArtifactConflictListPayload(value),
    );
  });
  ipcMain.handle('runtime:artifact-conflict-resolve', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'artifact.resolveConflict',
      parseArtifactConflictResolutionPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.create',
      createProviderPayloadFromClipboard(parseCreateProviderPayload(value), () =>
        clipboard.readText(),
      ),
    );
  });
  ipcMain.handle('runtime:provider-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.update',
      updateProviderPayloadFromClipboard(parseUpdateProviderPayload(value), () =>
        clipboard.readText(),
      ),
    );
  });
  ipcMain.handle('runtime:provider-preview-cc-switch', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.previewCcSwitchImport',
      parsePreviewCcSwitchImportPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-import-cc-switch', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.importCcSwitch', parseImportCcSwitchPayload(value));
  });
  ipcMain.handle('runtime:provider-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.list', parseListProvidersPayload(value));
  });
  ipcMain.handle('runtime:provider-discover', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.discoverModels', parseDiscoverModelsPayload(value));
  });
  ipcMain.handle('runtime:provider-add-models', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.addModels', parseAddModelsPayload(value));
  });
  ipcMain.handle('runtime:provider-probe-capabilities', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.probeCapabilities',
      parseProbeCapabilitiesPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-confirm-capabilities', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.confirmCapabilities',
      parseConfirmCapabilitiesPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-reorder', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.reorder', parseReorderProvidersPayload(value));
  });
  ipcMain.handle('runtime:provider-add-credential', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.addCredential',
      (() => {
        const metadata = parseAddProviderCredentialMetadata(value);
        const apiKey = clipboard.readText();
        if (!apiKey.trim() || apiKey.length > 8192) {
          throw new Error('Provider credential unavailable');
        }
        return {
          providerId: metadata.providerId,
          label: metadata.label,
          apiKey,
        };
      })(),
    );
  });
  ipcMain.handle('runtime:provider-remove-credential', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.removeCredential',
      parseRemoveProviderCredentialPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-reveal-credential', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.revealCredential',
      parseRevealProviderCredentialPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-update-credential', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    const metadata = parseUpdateProviderCredentialMetadata(value);
    let apiKey: string | undefined;
    if (metadata.rotateCredentialFromClipboard) {
      const clipboardValue = clipboard.readText();
      if (!clipboardValue.trim() || clipboardValue.length > 8192) {
        throw new Error('Provider credential unavailable');
      }
      apiKey = clipboardValue;
    }
    return getRuntimeClient().request('provider.updateCredential', {
      providerId: metadata.providerId,
      credentialRefId: metadata.credentialRefId,
      label: metadata.label,
      apiKey,
    });
  });
  ipcMain.handle('runtime:provider-set-model-priorities', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.setModelPriorities',
      parseSetModelPrioritiesPayload(value),
    );
  });
  ipcMain.handle('runtime:provider-update-model', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.updateModel', parseUpdateModelPayload(value));
  });
  ipcMain.handle('runtime:provider-remove-model', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('provider.removeModel', parseRemoveModelPayload(value));
  });
  ipcMain.handle('runtime:settings-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('settings.get', parseGetSettingsPayload(value));
  });
  ipcMain.handle('runtime:settings-set', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('settings.set', parseSetSettingPayload(value));
  });
  ipcMain.handle('runtime:usage-summary', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('usage.summary', parseUsageSummaryPayload(value));
  });
  ipcMain.handle('runtime:agent-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.get', parseGetAgentPayload(value));
  });
  ipcMain.handle('runtime:agent-update-binding', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.updateBinding', parseUpdateAgentBindingPayload(value));
  });
  ipcMain.handle('runtime:agent-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.list', parseAgentListPayload(value));
  });
  ipcMain.handle('runtime:kernel-detect', async (event) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request<KernelDetectResponse>('kernel.detect', {});
  });
  ipcMain.handle('runtime:gateway-status', async (event) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request<OpenGatewayStatusResponse>('gateway.status', {});
  });
  ipcMain.handle('runtime:gateway-logs', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    const query = (value ?? {}) as { offset?: number; limit?: number };
    return getRuntimeClient().request<GatewayLogsResponse>('gateway.logs', query);
  });
  ipcMain.handle('runtime:gateway-logs-clear', async (event) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('gateway.logs.clear', {});
  });
  ipcMain.handle('desktop:kernel-install', (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value !== 'pi') {
      throw new Error('Unsupported kernel install request');
    }
    return installPiKernel();
  });
  ipcMain.handle('runtime:agent-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.create', parseAgentCreatePayload(value));
  });
  ipcMain.handle('runtime:agent-list-versions', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.listVersions', parseAgentVersionsPayload(value));
  });
  ipcMain.handle('runtime:agent-create-version', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('agent.createVersion', parseAgentCreateVersionPayload(value));
  });

  // Mutable global Agent / Team / Conversation commands (2026-07-22 model).
  ipcMain.handle('runtime:global-agent-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('globalAgent.list', parseListGlobalAgentsPayload(value));
  });
  ipcMain.handle('runtime:global-agent-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('globalAgent.create', parseCreateGlobalAgentPayload(value));
  });
  ipcMain.handle('runtime:global-agent-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('globalAgent.update', parseUpdateGlobalAgentPayload(value));
  });
  ipcMain.handle('runtime:global-agent-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('globalAgent.delete', parseDeleteGlobalAgentPayload(value));
  });
  ipcMain.handle('runtime:team-list', async (event) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.list', {});
  });
  ipcMain.handle('runtime:team-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.create', parseCreateTeamPayload(value));
  });
  ipcMain.handle('runtime:team-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.update', parseUpdateTeamPayload(value));
  });
  ipcMain.handle('runtime:team-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.delete', parseDeleteTeamPayload(value));
  });
  ipcMain.handle('runtime:team-start-run', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.startRun', parseStartTeamRunPayload(value));
  });
  ipcMain.handle('runtime:team-set-run-status', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('team.setRunStatus', parseSetTeamRunStatusPayload(value));
  });
  ipcMain.handle('runtime:conversation-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('conversation.list', parseListConversationsPayload(value));
  });
  ipcMain.handle('runtime:conversation-list-messages', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.listMessages',
      parseConversationListMessagesPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-get-context-status', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.getContextStatus',
      parseConversationGetContextStatusPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-get-run-process', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.getRunProcess',
      parseConversationGetRunProcessPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-subscribe-transient', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const payload = parseSubscribeConversationTransientStreamPayload(value);
    await ensureRuntimeConnection();
    await getRuntimeSession().subscribeConversationTransientStream({
      senderId: event.sender.id,
      subscriptionId: payload.subscriptionId,
      threadId: payload.threadId,
      afterStreamSequence: payload.afterStreamSequence,
      listener: (frame) =>
        sendRuntimeTransientFrameToRenderer(event.sender, payload.subscriptionId, {
          type: 'frame',
          frame,
        }),
      snapshotListener: (latestStreamSequence, snapshot) =>
        sendRuntimeTransientFrameToRenderer(event.sender, payload.subscriptionId, {
          type: 'reset',
          latestStreamSequence,
          ...(snapshot ? { snapshot } : {}),
        }),
    });
    if (!transientCleanupRegisteredSenders.has(event.sender.id)) {
      transientCleanupRegisteredSenders.add(event.sender.id);
      event.sender.once('destroyed', () => {
        transientCleanupRegisteredSenders.delete(event.sender.id);
        void getRuntimeSession().unsubscribeConversationTransientStreamsForSender(event.sender.id);
      });
    }
    return { subscriptionId: payload.subscriptionId };
  });
  ipcMain.handle('runtime:conversation-unsubscribe-transient', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const payload = parseUnsubscribeConversationTransientStreamPayload(value);
    await getRuntimeSession().unsubscribeConversationTransientStream(
      event.sender.id,
      payload.subscriptionId,
    );
    return { subscriptionId: payload.subscriptionId };
  });
  ipcMain.handle('runtime:conversation-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('conversation.create', parseCreateConversationPayload(value));
  });
  ipcMain.handle('runtime:conversation-rename', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('conversation.rename', parseRenameConversationPayload(value));
  });
  ipcMain.handle('runtime:conversation-set-pinned', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.setPinned',
      parseSetConversationPinnedPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-set-archived', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.setArchived',
      parseSetConversationArchivedPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-set-execution-mode', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.setExecutionMode',
      parseSetConversationExecutionModePayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-set-interaction-mode', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.setInteractionMode',
      parseSetConversationInteractionModePayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-plan-submit', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.plan.submit',
      parseConversationPlanSubmitPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-plan-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.plan.get',
      parseConversationPlanGetPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-plan-approve', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.plan.approve',
      parseConversationPlanApprovePayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-plan-revise', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.plan.revise',
      parseConversationPlanRevisePayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-plan-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.plan.cancel',
      parseConversationPlanCancelPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-ask-answer', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.ask.answer',
      parseConversationAskAnswerPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-ask-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.ask.cancel',
      parseConversationAskCancelPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-ask-pending', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.ask.pending',
      parseConversationAskPendingPayload(value),
    );
  });
  ipcMain.handle('runtime:scheduled-task-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('scheduledTask.create', parseCreateScheduledTaskPayload(value));
  });
  ipcMain.handle('runtime:scheduled-task-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('scheduledTask.list', parseListScheduledTasksPayload(value));
  });
  ipcMain.handle('runtime:scheduled-task-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('scheduledTask.update', parseUpdateScheduledTaskPayload(value));
  });
  ipcMain.handle('runtime:scheduled-task-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('scheduledTask.delete', parseDeleteScheduledTaskPayload(value));
  });
  ipcMain.handle('runtime:scheduled-task-trigger', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'scheduledTask.trigger',
      parseTriggerScheduledTaskPayload(value),
    );
  });
  ipcMain.handle('runtime:goal-pause', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('goal.pause', parseGoalPausePayloadLocal(value));
  });
  ipcMain.handle('runtime:goal-resume', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('goal.resume', parseGoalResumePayloadLocal(value));
  });
  ipcMain.handle('runtime:skill-local-scan', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.local.scan', parseSkillLocalScanPayload(value));
  });
  ipcMain.handle('runtime:skill-local-import', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'skill.local.import',
      parseSkillLocalImportPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-decide-tool-approval', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.decideToolApproval',
      parseConversationDecideToolApprovalPayload(value),
    );
  });
  // Renderer-to-Runtime result channel for browser commands.
  ipcMain.handle('runtime:conversation-submit-browser-result', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.submitBrowserResult',
      parseConversationSubmitBrowserResultPayload(value),
    );
  });
  // AI browser_screenshot：主进程对 webview guest 执行 capturePage，并把 PNG 写入
  // Capture the current embedded browser page into the project screenshot directory.
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
  ipcMain.handle('runtime:conversation-upgrade-track', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.upgradeTrack',
      parseUpgradeConversationTrackPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-rebind-target', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.rebindTarget',
      parseRebindConversationTargetPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('conversation.delete', parseDeleteConversationPayload(value));
  });
  ipcMain.handle('runtime:conversation-send-message', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('conversation.sendMessage', value);
  });
  ipcMain.handle('runtime:conversation-compact', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    // Model-backed compact can take tens of seconds; client defaults to 120s for this type.
    return getRuntimeClient().request(
      'conversation.compact',
      parseConversationCompactPayload(value),
      { timeoutMs: 120_000 },
    );
  });

  ipcMain.handle('runtime:skill-import', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.import', parseImportSkillPayload(value));
  });
  ipcMain.handle('runtime:skill-import-remote', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.importRemote', parseImportRemoteSkillPayload(value), {
      timeoutMs: 30_000,
    });
  });
  ipcMain.handle('runtime:goal-set', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('goal.set', parseGoalSetPayloadLocal(value));
  });
  ipcMain.handle('runtime:goal-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('goal.get', parseGoalGetPayloadLocal(value));
  });
  ipcMain.handle('runtime:goal-clear', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('goal.clear', parseGoalClearPayloadLocal(value));
  });
  ipcMain.handle('runtime:skill-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.list', parseListSkillsPayload(value));
  });
  ipcMain.handle('runtime:skill-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.delete', parseDeleteSkillPayload(value));
  });
  ipcMain.handle('runtime:skill-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.get', parseGetSkillPayload(value));
  });
  ipcMain.handle('runtime:skill-set-enabled', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.setEnabled', parseSetSkillEnabledPayload(value));
  });

  ipcMain.handle('runtime:mcp-register', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.register', parseRegisterMcpServerPayload(value));
  });
  ipcMain.handle('runtime:mcp-register-remote', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.registerRemote', parseRegisterRemoteMcpPayload(value));
  });
  ipcMain.handle('runtime:mcp-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.list', parseListMcpServersPayload(value));
  });
  ipcMain.handle('runtime:mcp-set-enabled', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.setEnabled', parseSetMcpServerEnabledPayload(value));
  });
  ipcMain.handle('runtime:mcp-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.delete', parseDeleteMcpServerPayload(value));
  });
  ipcMain.handle('runtime:mcp-policy-probe', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.policy.probe', parseProbeMcpPolicyPayload(value));
  });

  ipcMain.handle('runtime:mcp-tool-request', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.tool.request', parseRequestMcpToolPayload(value));
  });

  ipcMain.handle('runtime:mcp-spawn-probe', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.spawn.probe', parseProbeMcpSpawnPayload(value));
  });

  ipcMain.handle('runtime:mcp-tool-call', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.tool.call', parseCallMcpToolPayload(value));
  });

  ipcMain.handle('runtime:mcp-tools-refresh', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.tools.refresh', parseRefreshMcpToolsPayload(value));
  });

  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.listWorkspaceActivations,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.workspace.list',
        parseCapabilityWorkspaceListPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.setWorkspaceActive,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.workspace.setActive',
        parseCapabilityWorkspaceSetActivePayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.governance.list',
        parseCapabilityGovernanceListPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.savePublishDraft,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.publishDraft.save',
        parseSaveSkillPublishDraftPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.publishDraft.list',
        parseListSkillPublishDraftsPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.getPublishDraft,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.publishDraft.get',
        parseGetSkillPublishDraftPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.submitPublishDraft,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.publishDraft.submit',
        parseSubmitSkillPublishDraftPayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.previewOrganize,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.organize.preview',
        parsePreviewCapabilityOrganizePayload(value),
      );
    },
  );
  ipcMain.handle(
    CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize,
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'capability.organize.getLatest',
        parseGetLatestCapabilityOrganizePayload(value),
      );
    },
  );

  ipcMain.handle('runtime:memory-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('memory.list', parseListMemoryPayload(value));
  });
  ipcMain.handle('runtime:memory-decide', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('memory.decide', parseDecideMemoryPayload(value));
  });

  ipcMain.handle('runtime:desktop-command-list-waiting', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'desktop.command.listWaiting',
      parseListWaitingDesktopCommandsPayload(value),
    );
  });
  ipcMain.handle('runtime:desktop-command-continue', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'desktop.command.continue',
      parseContinueDesktopCommandPayload(value),
    );
  });
  ipcMain.handle('runtime:desktop-command-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'desktop.command.cancel',
      parseCancelDesktopCommandPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.list',
      parseListBrowserProfilesPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.create',
      parseCreateBrowserProfilePayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-rename', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.rename',
      parseRenameBrowserProfilePayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.delete',
      parseDeleteBrowserProfilePayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-list-site-sessions', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.listSiteSessions',
      parseListBrowserSiteSessionsPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-profile-clear-site-session', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.profile.clearSiteSession',
      parseClearBrowserSiteSessionPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-recording-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.recording.list',
      parseListBrowserRecordingsPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-recording-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.recording.get',
      parseGetBrowserRecordingPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-recording-start', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.recording.start',
      parseStartBrowserRecordingPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-recording-stop', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.recording.stop',
      parseStopBrowserRecordingPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.list',
      parseListBrowserWorkflowsPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.get',
      parseGetBrowserWorkflowPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-create-draft', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.createDraft',
      parseCreateBrowserWorkflowDraftPayload(value),
    );
  });
  ipcMain.handle(
    'runtime:browser-workflow-create-revision-draft',
    async (event, value: unknown) => {
      assertRuntimeIpcSource(event);
      await ensureRuntimeConnection();
      return getRuntimeClient().request(
        'browser.workflow.createRevisionDraft',
        parseCreateBrowserWorkflowRevisionDraftPayload(value),
      );
    },
  );
  ipcMain.handle('runtime:browser-workflow-submit', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.submit',
      parseSubmitBrowserWorkflowDraftPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-review', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.review',
      parseReviewBrowserWorkflowDraftPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-execute', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.execute',
      parseExecuteBrowserWorkflowPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-workflow-approve-execute', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.workflow.approveAndExecute',
      parseApproveExecuteBrowserWorkflowPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-handoff-list-waiting', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.handoff.listWaiting',
      parseListWaitingBrowserHandoffsPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-handoff-continue', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.handoff.continue',
      parseContinueBrowserHandoffPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-handoff-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browser.handoff.cancel',
      parseCancelBrowserHandoffPayload(value),
    );
  });

  ipcMain.handle('runtime:approval-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('approval.list', parseListApprovalsPayload(value));
  });
  ipcMain.handle('runtime:approval-evaluate', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('approval.evaluate', parseEvaluateApprovalPayload(value));
  });
  ipcMain.handle('runtime:approval-enqueue', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('approval.enqueue', parseEnqueueApprovalPayload(value));
  });
  ipcMain.handle('runtime:approval-decide', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('approval.decide', parseDecideApprovalPayload(value));
  });
  ipcMain.handle('runtime:memory-rollback', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('memory.rollback', parseRollbackMemoryPayload(value));
  });
  ipcMain.handle('runtime:context-packet-peek', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('context.packet.peek', parsePeekContextPacketPayload(value));
  });
  ipcMain.handle('runtime:context-packet-amend', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'context.packet.amend',
      parseAmendContextPacketPayload(value),
    );
  });
  ipcMain.handle('runtime:diagnostics-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('diagnostics.list', parseListDiagnosticsPayload(value));
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
        const listed = await client.request<{ diagnostics?: unknown[] }>(
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

  ipcMain.handle('desktop:pick-folder', async (event) => {
    assertRuntimeIpcSource(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '为项目绑定文件夹',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
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

  ipcMain.handle('runtime:run-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.cancel', parseCancelRunPayload(value));
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

  // Switch branches only after the Renderer explicitly selects dirty-worktree handling.
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
    const branch = payload.branch.trim();
    // Branch-name guard: no flag injection / path tricks.
    const hasInvalidBranchCharacter = [...branch].some((character) => {
      const codePoint = character.charCodeAt(0);
      return (
        /\s/.test(character) ||
        ['~', '^', ':', '?', '*', '[', '\\'].includes(character) ||
        codePoint <= 0x1f ||
        codePoint === 0x7f
      );
    });
    if (branch.startsWith('-') || hasInvalidBranchCharacter) {
      throw new Error('git-checkout: invalid branch name');
    }
    const strategy =
      payload.strategy === 'stash' || payload.strategy === 'force' ? payload.strategy : 'check';
    const root = path.resolve(payload.root);
    if (!fs.existsSync(root)) {
      return { ok: false, error: '项目文件夹不存在', dirty: false, changes: [] };
    }
    const { execFile } = await import('node:child_process');
    const run = (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        execFile(
          'git',
          args,
          { cwd: root, timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) =>
            resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) }),
        );
      });
    const status = await run(['status', '--short']);
    const changes = status.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 100)
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }));
    if (changes.length > 0 && strategy === 'check') {
      // Dirty worktree: UI must ask the user first (stash or carry over).
      return { ok: false, dirty: true, changes, error: null };
    }
    if (changes.length > 0 && strategy === 'stash') {
      const stash = await run(['stash', 'push', '-u', '-m', `sync-think: switch to ${branch}`]);
      if (!stash.ok) {
        return {
          ok: false,
          dirty: true,
          changes,
          error: `保存 stash 失败：${stash.stderr.trim() || '未知错误'}`,
        };
      }
    }
    const checkout = await run(['checkout', branch]);
    if (!checkout.ok) {
      // Stash already happened (if requested); surface it so the user can recover.
      const detail = checkout.stderr.trim() || checkout.stdout.trim() || '未知错误';
      return {
        ok: false,
        dirty: false,
        changes: [],
        error: `切换分支失败：${detail}${strategy === 'stash' && changes.length > 0 ? '；更改已保存到 stash，可用 git stash pop 恢复' : ''}`,
      };
    }
    return {
      ok: true,
      dirty: false,
      changes: [],
      error: null,
      stashed: strategy === 'stash' && changes.length > 0,
    };
  });

  // Read-only Git branch, status, and recent-commit summary for the workspace panel.
  const MAX_FILES_PER_COMMIT = 100;
  function parseRecentCommitBlocks(
    stdout: string,
  ): Array<{ hash: string; subject: string; files: Array<{ status: string; path: string }>; truncated: boolean }> {
    const normalized = stdout.replace(/\r\n/g, '\n');
    const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim().length > 0);
    const commits: Array<{
      hash: string;
      subject: string;
      files: Array<{ status: string; path: string }>;
      truncated: boolean;
    }> = [];
    for (const block of blocks) {
      const lines = block.split('\n').filter((line) => line.length > 0);
      if (lines.length === 0) continue;
      const [hash, subject = ''] = lines[0]!.split('\x00');
      if (!hash) continue;
      const files: Array<{ status: string; path: string }> = [];
      let truncated = false;
      for (const line of lines.slice(1)) {
        if (files.length >= MAX_FILES_PER_COMMIT) {
          truncated = true;
          break;
        }
        const parts = line.split('\t');
        if (parts.length < 2) continue;
        const status = parts[0]!;
        // 重命名 R100\told\tnew → 以新路径作为树节点展示。
        const path = parts[parts.length - 1]!;
        if (!path) continue;
        files.push({ status, path });
      }
      commits.push({ hash, subject, files, truncated });
    }
    return commits;
  }

  ipcMain.handle('desktop:git-info', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid git-info payload');
    }
    const payload = value as { root?: unknown };
    if (typeof payload.root !== 'string' || !payload.root.trim()) {
      throw new Error('Invalid git-info payload: root required');
    }
    const root = path.resolve(payload.root);
    if (!fs.existsSync(root)) {
      return { branch: null, changes: [], recentCommits: [], isRepo: false };
    }
    const { execFile } = await import('node:child_process');
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve) => {
        execFile(
          'git',
          args,
          { cwd: root, timeout: 8_000, windowsHide: true, maxBuffer: 1024 * 1024 },
          (error, stdout) => resolve(error ? '' : String(stdout)),
        );
      });
    const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (!branch)
      return { branch: null, branches: [], changes: [], recentCommits: [], isRepo: false };
    const branchesRaw = await run(['branch', '--format=%(refname:short)']);
    const branches = branchesRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 100);
    const statusRaw = await run(['status', '--short']);
    const changes = statusRaw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 100)
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }));
    const logRaw = await run([
      'log',
      '-8',
      '--name-status',
      '--format=%h%x00%s',
    ]);
    const recentCommits = parseRecentCommitBlocks(logRaw);
    return { branch, branches, changes, recentCommits, isRepo: true };
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

function shutdownDesktopServices(): Promise<void> {
  if (desktopShutdownPromise) return desktopShutdownPromise;
  shutdownStarted = true;
  projectContentSearchRegistry.abortAll();
  abortAllProjectTerminals();
  for (const subscription of projectFileWatchSubscriptions.values()) subscription.dispose();
  projectFileWatchSubscriptions.clear();
  runtimeClient?.disconnect();
  runtimeClient = null;

  desktopShutdownPromise = Promise.allSettled([
    desktopUpdateController?.flushRecoveryEvidence() ?? Promise.resolve(),
    stopManagedRuntime(),
  ]).then((results) => {
    runtimeShutdownComplete = true;
    const runtimeResult = results[1];
    if (runtimeResult?.status === 'rejected') throw runtimeResult.reason;
  });
  return desktopShutdownPromise;
}

app.on('before-quit', (event) => {
  if (runtimeShutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  void shutdownDesktopServices().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Exposed for integration probes; Renderer uses only the fixed preload bridge.
export async function connectToRuntime(): Promise<RuntimePipeClient> {
  await ensureRuntimeConnection();
  return getRuntimeClient();
}

// Frame-level decoder correctness probe (used by smoke tests / demos).
export function probeFrameRoundtrip(payload: Frame): Frame | null {
  const enc = encodeFrame(payload);
  const { frames } = decodeFrames(enc);
  return frames[0] ?? null;
}
