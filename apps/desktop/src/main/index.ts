// Electron main entry. UI lifecycle is decoupled from the Runtime by design 闁?
// the Runtime runs as a separate process and survives UI restarts (閹?6).
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
  shell,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  isAllowedM1OpenDocId,
  isValidDogfoodDayDate,
  resolveDocsDevelopmentDir,
  resolveM1OpenDocPath,
  type M1OpenDocId,
} from './m1-open-doc.js';
import { listProjectFiles } from './project-files.js';
import { listDogfoodDayReports } from './m1-exit-evidence-load.js';
import { parseHandtestDocMarkdown } from '../m1-handtest-doc-parse.js';
import { fileURLToPath } from 'node:url';
import { encodeFrame, decodeFrames } from '@sync-think/protocol';
import type {
  AppendMessagePayload,
  AppendMessageResponse,
  CancelRunPayload,
  Frame,
} from '@sync-think/protocol';
import {
  parseArchiveTaskPayload,
  parseBindWorkspaceFolderPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
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
  parseSetModelPrioritiesPayload,
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
  parseDeleteGlobalAgentPayload,
  parseDeleteTeamPayload,
  parseListConversationsPayload,
  parseListGlobalAgentsPayload,
  parseRenameConversationPayload,
  parseSetConversationArchivedPayload,
  parseSetConversationExecutionModePayload,
  parseSetConversationPinnedPayload,
  parseSetTeamRunStatusPayload,
  parseStartTeamRunPayload,
  parseUpdateGlobalAgentPayload,
  parseUpdateTeamPayload,
  parseUpgradeConversationTrackPayload,
  parseConversationDecideToolApprovalPayload,
} from '../team-payloads.js';
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
import { ensureRuntimeProcess, stopManagedRuntime } from './runtime-supervisor.js';
import { stageChatImageDataUrl } from './image-staging.js';
import { messageImageUrl, persistMessageImages, readMessageImage } from './message-images.js';
import type { RuntimeConnectOutcome, RuntimeConnectResult } from '../runtime-bridge-contract.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sync-think-image',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const INSTALL_ID = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let trustedRendererLocation: TrustedRendererLocation | null = null;
let runtimeClient: RuntimePipeClient | null = null;
let runtimeSession: RuntimeSession | null = null;

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

async function ensureRuntimeConnection(): Promise<RuntimeConnectResult> {
  // Every IPC path that needs Runtime must tolerate cold start without a
  // pre-launched `pnpm dev:runtime`.
  await ensureRuntimeProcess(INSTALL_ID);
  return getRuntimeSession().connect();
}

async function connectRendererToRuntime(): Promise<RuntimeConnectOutcome> {
  try {
    // Auto-start the local Runtime pipe process when missing (dev + future release).
    // Without this, cold start shows「加载中…」forever if `pnpm dev:runtime` wasn't launched.
    const supervised = await ensureRuntimeProcess(INSTALL_ID);
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
      await ensureRuntimeProcess(INSTALL_ID);
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
  ipcMain.handle('runtime:provider-set-model-priorities', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'provider.setModelPriorities',
      parseSetModelPrioritiesPayload(value),
    );
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
  ipcMain.handle('runtime:conversation-decide-tool-approval', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.decideToolApproval',
      parseConversationDecideToolApprovalPayload(value),
    );
  });
  ipcMain.handle('runtime:conversation-upgrade-track', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request(
      'conversation.upgradeTrack',
      parseUpgradeConversationTrackPayload(value),
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

  ipcMain.handle('runtime:run-cancel', async (event, value: unknown) => {
    assertRuntimeIpcSource(event);
    await ensureRuntimeConnection();
    return getRuntimeClient().request('run.cancel', parseCancelRunPayload(value));
  });
}

void app
  .whenReady()
  .then(() => {
    protocol.handle('sync-think-image', (request) => {
      try {
        const url = new URL(request.url);
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
    setupRuntimeBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch(handleDesktopStartupFailure);

app.on('before-quit', () => {
  runtimeClient?.disconnect();
  stopManagedRuntime();
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
