// Electron main entry. UI lifecycle is decoupled from the Runtime by design 闁?
// the Runtime runs as a separate process and survives UI restarts (閹?6).
// The main process owns the safe-storage-based credential broker (TD-005).
//
// Phase 0: this file is type-only; the binary itself is blocked on installing
// Visual Studio Build Tools. Once installed and `pnpm rebuild electron` runs,
// `pnpm dev:desktop` launches this module.

import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  isAllowedM1OpenDocId,
  isValidDogfoodDayDate,
  resolveDocsDevelopmentDir,
  resolveM1OpenDocPath,
  type M1OpenDocId,
} from './m1-open-doc.js';
import { listDogfoodDayReports } from './m1-exit-evidence-load.js';
import { parseHandtestDocMarkdown } from '../m1-handtest-doc-parse.js';
import { fileURLToPath } from 'node:url';
import { encodeFrame, decodeFrames } from '@sync-think/protocol';
import type { AppendMessagePayload, CancelRunPayload, Frame } from '@sync-think/protocol';
import {
  parseArchiveTaskPayload,
  parseBindWorkspaceFolderPayload,
  parseBindWorkspaceGitRepositoryPayload,
  parseResolveWorktreeIntegrationPayload,
  parseCreateBrowserIdentityPayload,
  parseUpdateBrowserIdentityPayload,
  parseDeleteBrowserIdentityPayload,
  parseSetTaskBrowserIdentityPayload,
  parseDescribeTaskExecutionAccessPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseUnarchiveTaskPayload,
  parseDiscardEmptyTaskPayload,
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
} from '../provider-payloads.js';
import {
  createProviderPayloadFromClipboard,
  updateProviderPayloadFromClipboard,
} from './provider-clipboard.js';
import {
  parseGetAgentPayload,
  parseUpdateAgentBindingPayload,
  parseImportSkillPayload,
  parseListSkillsPayload,
  parseRegisterMcpServerPayload,
  parseListMcpServersPayload,
  parseProbeMcpPolicyPayload,
  parseRequestMcpToolPayload,
  parseProbeMcpSpawnPayload,
  parseCallMcpToolPayload,
  parseRefreshMcpToolsPayload,
} from '../agent-payloads.js';
import {
  parseCreateGroupPayload,
  parseGetGroupPayload,
  parseListGroupsPayload,
  parseUpdateGroupPayload,
  parseAddGroupMemberPayload,
  parseRemoveGroupMemberPayload,
  parseUpdateGroupMemberResponsibilityPayload,
  parseSetGroupLeadPayload,
  parseCreateGroupTaskPayload,
} from '../group-payloads.js';
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
  parsePeekContextPacketPayload,
  parseAmendContextPacketPayload,
} from '../context-payloads.js';
import {
  parseArtifactComparePayload,
  parseArtifactConflictListPayload,
  parseArtifactConflictResolutionPayload,
  parseArtifactGetVersionPayload,
  parseArtifactListPayload,
  parseArtifactMergePayload,
  parseArtifactSelectPayload,
  parseModeSetPayload,
  parseExecutionModeSetPayload,
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
import type { Event } from '@sync-think/shared';
import {
  assertTrustedRendererIpcSource,
  installNavigationGuards,
  isTrustedRendererUrl,
  parseLoopbackDevServerUrl,
  trustedFileLocation,
} from './renderer-security.js';
import type { TrustedRendererLocation } from './renderer-security.js';
import { classifyRuntimeConnectError, RuntimePipeClient } from './runtime-client.js';
import { RuntimeSession } from './runtime-session.js';
import type { RuntimeConnectOutcome, RuntimeConnectResult } from '../runtime-bridge-contract.js';
import { parseResolveApplicationToolConfirmationPayload } from '../application-tool-payloads.js';
import { avatarDataUrl, inspectAgentAvatar, parseStoredAgentAvatarPath } from './agent-avatar.js';
import {
  parseCreateAutomationPayload,
  parseDeleteAutomationPayload,
  parseGetAutomationPayload,
  parseListAutomationExecutionsPayload,
  parseListAutomationsPayload,
  parseTriggerAutomationPayload,
  parseUpdateAutomationPayload,
} from '../automation-payloads.js';
import {
  resolveDevelopmentUserDataPath,
  resolveInitialWindowSize,
  shouldDisableDevelopmentHardwareAcceleration,
} from './window-size.js';
import {
  MAX_MESSAGE_ATTACHMENTS,
  stageMessageAttachmentBuffers,
  stageMessageAttachments,
  loadMessageAttachmentPreviewOrNull,
} from './message-attachments.js';

const INSTALL_ID = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const developmentUserDataPath = resolveDevelopmentUserDataPath(
  app.isPackaged,
  process.env.SYNC_THINK_DEV_USER_DATA_PATH,
);
if (developmentUserDataPath) app.setPath('userData', developmentUserDataPath);
if (
  shouldDisableDevelopmentHardwareAcceleration(
    app.isPackaged,
    process.env.SYNC_THINK_DEV_DISABLE_HARDWARE_ACCELERATION,
  )
) {
  app.disableHardwareAcceleration();
}

let mainWindow: BrowserWindow | null = null;
let trustedRendererLocation: TrustedRendererLocation | null = null;
let runtimeClient: RuntimePipeClient | null = null;
let runtimeSession: RuntimeSession | null = null;

function createWindow(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const initialWindowSize = resolveInitialWindowSize({
    packaged: app.isPackaged,
    width: process.env.SYNC_THINK_DEV_WINDOW_WIDTH,
    height: process.env.SYNC_THINK_DEV_WINDOW_HEIGHT,
  });
  const parsedDevServerUrl =
    !app.isPackaged && devServerUrl ? parseLoopbackDevServerUrl(devServerUrl) : null;
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  const nextTrustedRendererLocation: TrustedRendererLocation = parsedDevServerUrl
    ? { kind: 'origin', value: parsedDevServerUrl.origin }
    : trustedFileLocation(rendererPath);

  const window = new BrowserWindow({
    width: initialWindowSize.width,
    height: initialWindowSize.height,
    minWidth: 1280,
    show: false,
    autoHideMenuBar: true,
    // Match resolved OS theme so light mode does not flash a dark frame.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151815' : '#f1f4f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  trustedRendererLocation = nextTrustedRendererLocation;
  installNavigationGuards(window.webContents, nextTrustedRendererLocation);
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error('[desktop] preload failed', error.message);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[desktop] renderer load failed', errorCode, errorDescription);
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
  console.error('[desktop] startup failed', errorMessage(error));
  app.quit();
}

function getRuntimeClient(): RuntimePipeClient {
  runtimeClient ??= new RuntimePipeClient({
    installId: INSTALL_ID,
    appVersion: app.getVersion(),
    helloSecret: process.env.SYNC_THINK_PIPE_SECRET,
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

function getRuntimeSession(): RuntimeSession {
  runtimeSession ??= new RuntimeSession(getRuntimeClient(), sendRuntimeEventToRenderer);
  return runtimeSession;
}

function ensureRuntimeConnection(): Promise<RuntimeConnectResult> {
  return getRuntimeSession().connect();
}

async function connectRendererToRuntime(): Promise<RuntimeConnectOutcome> {
  try {
    return { ok: true, result: await ensureRuntimeConnection() };
  } catch (error) {
    return { ok: false, error: classifyRuntimeConnectError(error) };
  }
}

function parseAppendMessagePayload(value: unknown): AppendMessagePayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid append-message payload');
  }
  const payload = value as Partial<AppendMessagePayload>;
  const validRoles = new Set(['user', 'assistant', 'system', 'tool']);
  if (
    typeof payload.threadId !== 'string' ||
    payload.threadId.length === 0 ||
    !Number.isInteger(payload.expectedTaskVersion) ||
    (payload.expectedTaskVersion ?? -1) < 0 ||
    typeof payload.role !== 'string' ||
    !validRoles.has(payload.role) ||
    typeof payload.text !== 'string' ||
    payload.text.trim().length === 0 ||
    payload.text.length > 100_000
  ) {
    throw new Error('Invalid append-message payload');
  }
  return payload as AppendMessagePayload;
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

function setupRuntimeBridge(): void {
  ipcMain.handle('runtime:connect', (event) => {
    assertRuntimeIpcSource(event);
    return connectRendererToRuntime();
  });
  ipcMain.handle('runtime:append-message', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.appendMessage', parseAppendMessagePayload(value));
  });
  ipcMain.handle('runtime:application-tool-confirm', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'application.tool.confirm',
      parseResolveApplicationToolConfirmationPayload(value),
    );
  });
  ipcMain.handle('runtime:application-tool-reject', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'application.tool.reject',
      parseResolveApplicationToolConfirmationPayload(value),
    );
  });
  ipcMain.handle('runtime:automation-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.create', parseCreateAutomationPayload(value));
  });
  ipcMain.handle('runtime:automation-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.update', parseUpdateAutomationPayload(value));
  });
  ipcMain.handle('runtime:automation-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.delete', parseDeleteAutomationPayload(value));
  });
  ipcMain.handle('runtime:automation-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.get', parseGetAutomationPayload(value));
  });
  ipcMain.handle('runtime:automation-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.list', parseListAutomationsPayload(value));
  });
  ipcMain.handle('runtime:automation-trigger', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('automation.trigger', parseTriggerAutomationPayload(value));
  });
  ipcMain.handle('runtime:automation-execution-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'automation.execution.list',
      parseListAutomationExecutionsPayload(value),
    );
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
  ipcMain.handle('runtime:workspace-bind-git-repository', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'workspace.bindGitRepository',
      parseBindWorkspaceGitRepositoryPayload(value),
    );
  });
  ipcMain.handle('runtime:workspace-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('workspace.list', parseListWorkspacesPayload(value));
  });
  ipcMain.handle('runtime:browser-identity-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('browserIdentity.list', value ?? {});
  });
  ipcMain.handle('runtime:browser-identity-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browserIdentity.create',
      parseCreateBrowserIdentityPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-identity-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browserIdentity.update',
      parseUpdateBrowserIdentityPayload(value),
    );
  });
  ipcMain.handle('runtime:browser-identity-delete', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'browserIdentity.delete',
      parseDeleteBrowserIdentityPayload(value),
    );
  });
  ipcMain.handle('runtime:task-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.create', parseCreateTaskPayload(value));
  });
  ipcMain.handle('runtime:task-resolve-worktree-integration', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'task.resolveWorktreeIntegration',
      parseResolveWorktreeIntegrationPayload(value),
    );
  });
  ipcMain.handle('runtime:task-set-browser-identity', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'task.setBrowserIdentity',
      parseSetTaskBrowserIdentityPayload(value),
    );
  });
  ipcMain.handle('runtime:task-describe-execution-access', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'task.describeExecutionAccess',
      parseDescribeTaskExecutionAccessPayload(value),
    );
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
  ipcMain.handle('runtime:execution-mode-set', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'task.setExecutionMode',
      parseExecutionModeSetPayload(value),
    );
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
  ipcMain.handle('runtime:task-discard-empty', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('task.discardEmpty', parseDiscardEmptyTaskPayload(value));
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
  ipcMain.handle('runtime:artifact-get-version', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('artifact.getVersion', parseArtifactGetVersionPayload(value));
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

  ipcMain.handle('runtime:group-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.create', parseCreateGroupPayload(value));
  });
  ipcMain.handle('runtime:group-get', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.get', parseGetGroupPayload(value));
  });
  ipcMain.handle('runtime:group-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.list', parseListGroupsPayload(value));
  });
  ipcMain.handle('runtime:group-update', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.update', parseUpdateGroupPayload(value));
  });
  ipcMain.handle('runtime:group-member-add', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.member.add', parseAddGroupMemberPayload(value));
  });
  ipcMain.handle('runtime:group-member-remove', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.member.remove', parseRemoveGroupMemberPayload(value));
  });
  ipcMain.handle('runtime:group-member-responsibility', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'group.member.updateResponsibility',
      parseUpdateGroupMemberResponsibilityPayload(value),
    );
  });
  ipcMain.handle('runtime:group-set-lead', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.setLead', parseSetGroupLeadPayload(value));
  });
  ipcMain.handle('runtime:group-task-create', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('group.task.create', parseCreateGroupTaskPayload(value));
  });

  ipcMain.handle('runtime:skill-import', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.import', parseImportSkillPayload(value));
  });
  ipcMain.handle('runtime:skill-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('skill.list', parseListSkillsPayload(value));
  });

  ipcMain.handle('runtime:mcp-register', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.register', parseRegisterMcpServerPayload(value));
  });
  ipcMain.handle('runtime:mcp-list', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('mcp.list', parseListMcpServersPayload(value));
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
        loadNote: '未找到 docs/development（手测清单/dogfood）',
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
  ipcMain.handle('desktop:pick-message-attachments', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const kind = value === 'folder' ? 'folder' : 'files';
    const win = BrowserWindow.fromWebContents(event.sender);
    const options =
      kind === 'folder'
        ? {
            title: '添加文件夹',
            properties: ['openDirectory'] as ['openDirectory'],
          }
        : {
            title: '添加图片或文件',
            properties: ['openFile', 'multiSelections'] as ['openFile', 'multiSelections'],
            filters: [
              {
                name: '支持的附件',
                extensions: [
                  'png',
                  'jpg',
                  'jpeg',
                  'webp',
                  'gif',
                  'pdf',
                  'doc',
                  'docx',
                  'xls',
                  'xlsx',
                  'txt',
                  'md',
                  'json',
                  'yaml',
                  'yml',
                  'xml',
                  'csv',
                  'tsv',
                  'js',
                  'jsx',
                  'mjs',
                  'cjs',
                  'ts',
                  'tsx',
                  'css',
                  'html',
                  'htm',
                  'py',
                  'java',
                  'c',
                  'h',
                  'cpp',
                  'hpp',
                  'cs',
                  'go',
                  'rs',
                  'sh',
                  'ps1',
                  'sql',
                  'toml',
                  'zip',
                ],
              },
            ],
          };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];
    return stageMessageAttachments(
      result.filePaths,
      path.join(app.getPath('userData'), 'message-attachments'),
    );
  });
  ipcMain.handle('desktop:stage-message-files', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (!Array.isArray(value) || value.length > MAX_MESSAGE_ATTACHMENTS) {
      throw new Error('附件路径无效');
    }
    const paths: string[] = [];
    const buffers: Array<{ name: string; mimeType?: string; bytes: Uint8Array }> = [];
    for (const entry of value) {
      if (typeof entry === 'string' && entry.length > 0 && entry.length <= 4_096) {
        paths.push(entry);
        continue;
      }
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        typeof (entry as { name?: unknown }).name !== 'string' ||
        ((entry as { mimeType?: unknown }).mimeType !== undefined &&
          typeof (entry as { mimeType?: unknown }).mimeType !== 'string') ||
        !((entry as { bytes?: unknown }).bytes instanceof Uint8Array)
      ) {
        throw new Error('附件路径无效');
      }
      buffers.push(entry as { name: string; mimeType?: string; bytes: Uint8Array });
    }
    const root = path.join(app.getPath('userData'), 'message-attachments');
    return [
      ...(await stageMessageAttachments(paths, root)),
      ...(await stageMessageAttachmentBuffers(buffers, root)),
    ];
  });
  ipcMain.handle('desktop:load-message-attachment-preview', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('附件无效');
    const input = value as { managedRef?: unknown; mimeType?: unknown; sha256?: unknown };
    if (typeof input.managedRef !== 'string' || typeof input.mimeType !== 'string') {
      throw new Error('附件无效');
    }
    return loadMessageAttachmentPreviewOrNull(
      {
        managedRef: input.managedRef,
        mimeType: input.mimeType,
        ...(typeof input.sha256 === 'string' ? { sha256: input.sha256 } : {}),
      },
      path.join(app.getPath('userData'), 'message-attachments'),
    );
  });
  ipcMain.handle('desktop:pick-agent-avatar', async (event) => {
    assertRuntimeIpcSource(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择智能体头像',
      properties: ['openFile'] as ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const };
    }
    const bytes = await readFile(result.filePaths[0]!);
    const metadata = inspectAgentAvatar(bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const relativePath = `avatars/${hash}.${metadata.extension}`;
    const avatarDirectory = path.join(app.getPath('userData'), 'avatars');
    const targetPath = path.join(avatarDirectory, `${hash}.${metadata.extension}`);
    await mkdir(avatarDirectory, { recursive: true });
    try {
      await writeFile(targetPath, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return {
      canceled: false as const,
      avatarPath: relativePath,
      avatarUrl: avatarDataUrl(bytes, metadata.mimeType),
      width: metadata.width,
      height: metadata.height,
    };
  });
  ipcMain.handle('desktop:load-agent-avatar', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    const relativePath = parseStoredAgentAvatarPath(value);
    const targetPath = path.join(app.getPath('userData'), ...relativePath.split('/'));
    const bytes = await readFile(targetPath);
    const metadata = inspectAgentAvatar(bytes);
    return {
      avatarPath: relativePath,
      avatarUrl: avatarDataUrl(bytes, metadata.mimeType),
      width: metadata.width,
      height: metadata.height,
    };
  });
  ipcMain.handle('runtime:run-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.cancel', parseCancelRunPayload(value));
  });
}

void app
  .whenReady()
  .then(() => {
    setupRuntimeBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch(handleDesktopStartupFailure);

app.on('before-quit', () => {
  runtimeClient?.disconnect();
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
