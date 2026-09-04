import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  buildEventPayloadBackfillProjection,
  DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES,
  EVENT_PAYLOAD_BACKFILL_EVENT_TYPES,
  EVENT_PAYLOAD_PROJECTION_BUILDER_ID,
  EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION,
  EventPayloadSidecarStore,
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
  SqliteProviderStore,
  SqliteAgentStore,
  SqliteGlobalAgentStore,
  SqliteTeamStore,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteMemoryStore,
  SqliteSkillStore,
  SqliteMcpStore,
  SqliteCapabilityStore,
  SqliteApprovalStore,
  SqlitePolicyStore,
  SqliteAuthorizationStore,
  SqliteOrchestrationStore,
  SqliteArtifactStore,
  SqliteProductionExecutionStore,
  SqliteBrowserStore,
  SqliteDesktopStore,
  SqliteUnitOfWork,
  SqliteAppSettingStore,
  SqliteAgentContextStore,
  SqliteScheduledTaskStore,
  SqliteRunIndexStore,
  SqliteAssistantTimelineStore,
  SqliteExternalEventStore,
} from '@sync-think/storage';
import {
  SecureStore,
  WindowsDpapiBackend,
  XorDevBackend,
  type DpapiBridge,
  type SecureStoreBackend,
} from '@sync-think/secure-store';
import { Runtime, type RuntimeOptions } from './runtime.js';
import {
  UsageSummaryQueryService,
  refreshUsageSummarySnapshotFromDatabase,
} from './usage-summary-cache.js';
import { createProductionStepExecutor } from './orchestration/production-step-executor.js';
import { GeneratedImageStore } from './orchestration/generated-image-store.js';
import { BrowserHost, PersistentBrowserWorker, type BrowserHostLike } from '@sync-think/workers';
import { RuntimeBrowserController } from './browser/runtime-browser-controller.js';
import { RuntimeBrowserProfileService } from './browser/runtime-browser-profile-service.js';
import { RuntimeBrowserProfileGate } from './browser/runtime-browser-profile-gate.js';
import { RuntimeBrowserRecordingService } from './browser/runtime-browser-recording-service.js';
import { RuntimeDataManagementService } from './data-management-service.js';
import {
  BrowserExtensionHost,
  resolveBrowserExtensionDirectory,
} from './browser/browser-extension-host.js';

export interface RuntimeEventPayloadSidecarOptions {
  /** Explicit opt-in. Omitting this object keeps every Event payload inline. */
  enabled: true;
  rootDirectory?: string;
  minimumBytes?: number;
}

export interface OpenPersistentRuntimeOptions extends Omit<
  RuntimeOptions,
  | 'checkpoint'
  | 'stateStore'
  | 'workspaceStore'
  | 'providerStore'
  | 'agentStore'
  | 'globalAgentStore'
  | 'teamStore'
  | 'conversationStore'
  | 'messageStore'
  | 'assistantTimelineStore'
  | 'memoryStore'
  | 'skillStore'
  | 'mcpStore'
  | 'capabilityStore'
  | 'approvalStore'
  | 'policyStore'
  | 'authorizationStore'
  | 'orchestrationStore'
  | 'artifactStore'
  | 'productionExecutionStore'
  | 'browserStore'
  | 'desktopStore'
  | 'unitOfWork'
  | 'secureStore'
  | 'appSettingStore'
  | 'queryUsageSummary'
  | 'dataManagement'
  | 'runIndexStore'
  | 'externalEventStore'
> {
  dbPath: string;
  secureStoreBackend?: SecureStoreBackend;
  secureStoreKeyPath?: string;
  eventPayloadSidecar?: RuntimeEventPayloadSidecarOptions;
}

export const RUNTIME_EVENT_PAYLOAD_PROJECTION_BUILDER = Object.freeze({
  id: EVENT_PAYLOAD_PROJECTION_BUILDER_ID,
  version: EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION,
});

export interface CreateRuntimeSecureStoreOptions {
  secureStoreBackend?: SecureStoreBackend;
  /** Explicit test-only opt-in to the development backend. */
  secureStoreKeyPath?: string;
  platform?: NodeJS.Platform;
  legacyKeyPath?: string;
  vaultDirectory?: string;
  dpapiBridge?: DpapiBridge;
}

export interface PersistentRuntimeSession {
  runtime: Runtime;
  databasePath: string;
  close(): Promise<void>;
}

export function resolveRuntimeDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_DB_PATH) return resolve(env.SYNC_THINK_DB_PATH);
  const dataRoot = env.LOCALAPPDATA ?? join(homeDirectory, '.sync-think');
  return join(dataRoot, 'SYNC-THINK', 'sync-think.db');
}

export function resolveRuntimeEventPayloadSidecarRoot(
  databasePathInput: string,
  installId: string,
): string {
  const databasePath = databasePathInput === ':memory:' ? ':memory:' : resolve(databasePathInput);
  const identity = createHash('sha256')
    .update(databasePath, 'utf8')
    .update('\0', 'utf8')
    .update(installId, 'utf8')
    .digest('hex')
    .slice(0, 24);
  const dataRoot =
    databasePath === ':memory:' ? join(tmpdir(), 'sync-think-runtime') : dirname(databasePath);
  return join(dataRoot, 'event-payload-sidecars', identity);
}

function runtimeEventPayloadMinimumBytes(value: number | undefined): number {
  const minimumBytes = value ?? DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES;
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes < 1) {
    throw new Error('Runtime Event payload sidecar minimumBytes must be a positive safe integer');
  }
  return minimumBytes;
}

export function resolveSecureStoreKeyPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_SECURE_KEY_PATH) return resolve(env.SYNC_THINK_SECURE_KEY_PATH);
  const dataRoot = env.LOCALAPPDATA ?? join(homeDirectory, '.sync-think');
  return join(dataRoot, 'SYNC-THINK', 'secure-store', 'dev-key.bin');
}

export function createRuntimeSecureStore(
  options: CreateRuntimeSecureStoreOptions = {},
): SecureStore {
  if (options.secureStoreBackend) return new SecureStore(options.secureStoreBackend);
  if (options.secureStoreKeyPath) {
    return new SecureStore(new XorDevBackend(options.secureStoreKeyPath));
  }

  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('OS-backed secure storage is unavailable on this platform');
  }
  const legacyKeyPath = options.legacyKeyPath ?? resolveSecureStoreKeyPath();
  const vaultDirectory = options.vaultDirectory ?? join(dirname(legacyKeyPath), 'dpapi-vault');
  const legacyBackend = existsSync(legacyKeyPath) ? new XorDevBackend(legacyKeyPath) : undefined;
  return new SecureStore(
    new WindowsDpapiBackend({
      vaultDirectory,
      bridge: options.dpapiBridge,
      legacyBackend,
    }),
  );
}

export async function openPersistentRuntime(
  options: OpenPersistentRuntimeOptions,
): Promise<PersistentRuntimeSession> {
  const { dbPath, secureStoreBackend, secureStoreKeyPath, eventPayloadSidecar, ...runtimeOptions } =
    options;
  const databasePath = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (databasePath !== ':memory:') {
    await mkdir(dirname(databasePath), { recursive: true });
  }
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });

  const secureStore = createRuntimeSecureStore({ secureStoreBackend, secureStoreKeyPath });

  const runtimeDataRoot =
    databasePath === ':memory:'
      ? join(tmpdir(), 'sync-think-runtime', options.installId)
      : dirname(databasePath);
  let browserHost: BrowserHostLike | undefined = runtimeOptions.browserHost;
  let runtime: Runtime;
  try {
    const unitOfWork = new SqliteUnitOfWork(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const providerStore = new SqliteProviderStore(connection.raw);
    const agentStore = new SqliteAgentStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const teamStore = new SqliteTeamStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const orchestrationStore = new SqliteOrchestrationStore(connection.raw);
    const artifactStore = new SqliteArtifactStore(connection.raw);
    const productionExecutionStore = new SqliteProductionExecutionStore(connection.raw);
    const agentContextStore = new SqliteAgentContextStore(connection.raw);
    const browserStore = new SqliteBrowserStore(connection.raw);
    const desktopStore = new SqliteDesktopStore(connection.raw);
    const skillStore = new SqliteSkillStore(connection.raw);
    const capabilityStore = new SqliteCapabilityStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    // Usage aggregation runs in an isolated Worker for file-backed databases so a
    // first-time scan cannot block the Runtime pipe or its healthcheck.
    let inMemoryUsageSnapshot:
      ReturnType<typeof refreshUsageSummarySnapshotFromDatabase> | undefined;
    const usageSummaryService = new UsageSummaryQueryService({
      databasePath,
      cachePath: join(runtimeDataRoot, 'usage-summary-cache-v2.json'),
      ...(databasePath === ':memory:'
        ? {
            snapshotLoader: async () => {
              inMemoryUsageSnapshot = refreshUsageSummarySnapshotFromDatabase(
                connection.raw,
                inMemoryUsageSnapshot,
              );
              return inMemoryUsageSnapshot;
            },
          }
        : {}),
    });
    const queryUsageSummary = (sinceIso?: string) => usageSummaryService.query(sinceIso);
    const taskVersionRepairAt = new Date().toISOString();
    workspaceStore.reconcileTaskVersionFloorsFromMessages(taskVersionRepairAt);
    workspaceStore.reconcileTaskVersionFloorsFromTaskEvents(taskVersionRepairAt);
    browserHost ??= new BrowserHost({
      profileRoot: join(runtimeDataRoot, 'browser-profiles'),
      executablePath: process.env.SYNC_THINK_BROWSER_EXECUTABLE,
    });
    const browserProfileGate = runtimeOptions.browserProfileGate ?? new RuntimeBrowserProfileGate();
    const recordingRecovery = await new RuntimeBrowserRecordingService({
      store: browserStore,
      host: browserHost,
    }).recoverInterruptedRecordings();
    if (recordingRecovery.failedRecordingIds.length > 0) {
      console.warn(
        `[runtime] Browser recording cleanup pending: ${recordingRecovery.failedRecordingIds.length}`,
      );
    }
    const profileRecovery = await new RuntimeBrowserProfileService({
      store: browserStore,
      host: browserHost,
      profileGate: browserProfileGate,
    }).reconcileDeletedProfiles();
    if (profileRecovery.failedProfileIds.length > 0) {
      console.warn(
        `[runtime] Browser Profile cleanup pending: ${profileRecovery.failedProfileIds.length}`,
      );
    }
    const productionBrowserController = new RuntimeBrowserController({
      worker: new PersistentBrowserWorker(browserHost),
      store: browserStore,
      profileId: runtimeOptions.browserProfileId,
      fallbackWorkingDir: runtimeOptions.browserFallbackWorkingDir ?? runtimeDataRoot,
      leaseHost: browserHost,
      profileGate: browserProfileGate,
    });
    const stepExecutor =
      runtimeOptions.stepExecutor ??
      createProductionStepExecutor({
        agentStore,
        providerStore,
        workspaceStore,
        orchestrationStore,
        executionStore: productionExecutionStore,
        agentContextStore,
        skillStore,
        secureStore,
        adaptersByProtocol: runtimeOptions.discoveryByProtocol,
        fallbackAdapter: runtimeOptions.discoveryAdapter,
        browserController: productionBrowserController,
        generatedImageStore: new GeneratedImageStore(
          join(runtimeDataRoot, 'artifacts', 'generated-images'),
        ),
      });
    const eventPayloadStateStore = new SqliteEventCheckpointStore(
      connection.raw,
      eventPayloadSidecar?.enabled === true
        ? {
            sidecar: new EventPayloadSidecarStore(
              eventPayloadSidecar.rootDirectory
                ? resolve(eventPayloadSidecar.rootDirectory)
                : resolveRuntimeEventPayloadSidecarRoot(databasePath, options.installId),
            ),
            minimumBytes: runtimeEventPayloadMinimumBytes(eventPayloadSidecar.minimumBytes),
            shouldExternalize: (event) => event.type === EVENT_PAYLOAD_BACKFILL_EVENT_TYPES[0],
            project: (event) => buildEventPayloadBackfillProjection(event.type, event.payload),
          }
        : undefined,
    );
    // 0049: activity-centre read model. Any run still marked `running` belongs
    // to a Runtime that no longer exists, so it is closed out before the new
    // Runtime starts writing — otherwise a crashed run advertises itself as
    // active forever.
    const runIndexStore = new SqliteRunIndexStore(connection.raw);
    try {
      const stale = runIndexStore.listUnfinished();
      if (stale.length > 0) {
        runIndexStore.markInterrupted({
          runIds: stale.map((entry) => entry.runId),
          reason: 'Runtime 重启，该 Run 未留下终态',
        });
      }
    } catch (error) {
      console.warn(
        '[runtime] run_index interrupted sweep failed',
        error instanceof Error ? error.message : String(error),
      );
    }

    runtime = new Runtime({
      ...runtimeOptions,
      stateStore: eventPayloadStateStore,
      workspaceStore,
      providerStore,
      agentStore,
      globalAgentStore,
      teamStore,
      conversationStore,
      messageStore: new SqliteMessageStore(connection.raw),
      assistantTimelineStore: new SqliteAssistantTimelineStore(connection.raw),
      memoryStore: new SqliteMemoryStore(connection.raw),
      skillStore,
      mcpStore: new SqliteMcpStore(connection.raw),
      capabilityStore,
      approvalStore: new SqliteApprovalStore(connection.raw),
      policyStore: new SqlitePolicyStore(connection.raw),
      authorizationStore: new SqliteAuthorizationStore(connection.raw),
      orchestrationStore,
      artifactStore,
      productionExecutionStore,
      agentContextStore,
      browserStore,
      desktopStore,
      unitOfWork,
      secureStore,
      stepExecutor,
      appSettingStore,
      dataManagement: new RuntimeDataManagementService({
        raw: connection.raw,
        databasePath,
        dataRoot: runtimeDataRoot,
      }),
      scheduledTaskStore: new SqliteScheduledTaskStore(connection.raw),
      runIndexStore,
      // Read-only here: the daemon owns every write to this queue.
      externalEventStore: new SqliteExternalEventStore(connection.raw),
      queryUsageSummary,
      browserHost,
      browserExtensionHost:
        runtimeOptions.browserExtensionHost ??
        (options.daemonWorker
          ? undefined
          : new BrowserExtensionHost({
              appSettingStore,
              extensionDirectory: resolveBrowserExtensionDirectory(
                process.env.SYNC_THINK_BROWSER_EXTENSION_DIR ??
                  join(homedir(), '.newmax', 'chrome-extension'),
                process.cwd(),
              ),
            })),
      browserProfileGate,
      browserFallbackWorkingDir: runtimeOptions.browserFallbackWorkingDir ?? runtimeDataRoot,
    });
  } catch (error) {
    if (!runtimeOptions.browserHost) await browserHost?.shutdown();
    connection.raw.close();
    throw error;
  }

  let closed = false;
  return {
    runtime,
    databasePath,
    async close() {
      if (closed) return;
      closed = true;
      await runtime.stop();
      secureStore.shutdown();
      if (connection.raw.open) connection.raw.close();
    },
  };
}
