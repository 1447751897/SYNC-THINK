import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
  SqliteProviderStore,
  SqliteAgentStore,
  SqliteGroupStore,
  SqliteMemoryStore,
  SqliteSkillStore,
  SqliteMcpStore,
  SqliteApprovalStore,
  SqlitePolicyStore,
  SqliteAuthorizationStore,
  SqliteOrchestrationStore,
  SqliteArtifactStore,
  SqliteProductionExecutionStore,
  SqliteUnitOfWork,
  SqliteAutomationStore,
  SqliteExecutionEnvironmentStore,
} from '@sync-think/storage';
import {
  SecureStore,
  WindowsDpapiBackend,
  XorDevBackend,
  type DpapiBridge,
  type SecureStoreBackend,
} from '@sync-think/secure-store';
import { Runtime, type RuntimeOptions } from './runtime.js';
import { createProductionStepExecutor } from './orchestration/production-step-executor.js';
import { TaskExecutionEnvironmentManager } from './task-execution-environment.js';

export interface OpenPersistentRuntimeOptions
  extends Omit<RuntimeOptions, 'checkpoint' | 'stateStore' | 'workspaceStore' | 'executionEnvironmentStore' | 'taskEnvironmentManager' | 'providerStore' | 'agentStore' | 'groupStore' | 'memoryStore' | 'skillStore' | 'mcpStore' | 'approvalStore' | 'policyStore' | 'authorizationStore' | 'orchestrationStore' | 'artifactStore' | 'productionExecutionStore' | 'unitOfWork' | 'automationStore' | 'secureStore'> {
  dbPath: string;
  secureStoreBackend?: SecureStoreBackend;
  secureStoreKeyPath?: string;
}

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

export function resolveSecureStoreKeyPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_SECURE_KEY_PATH) return resolve(env.SYNC_THINK_SECURE_KEY_PATH);
  const dataRoot = env.LOCALAPPDATA ?? join(homeDirectory, '.sync-think');
  return join(dataRoot, 'SYNC-THINK', 'secure-store', 'dev-key.bin');
}

export function createRuntimeSecureStore(options: CreateRuntimeSecureStoreOptions = {}): SecureStore {
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
  const { dbPath, secureStoreBackend, secureStoreKeyPath, ...runtimeOptions } = options;
  const databasePath = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (databasePath !== ':memory:') {
    await mkdir(dirname(databasePath), { recursive: true });
  }
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });

  const secureStore = createRuntimeSecureStore({ secureStoreBackend, secureStoreKeyPath });

  let runtime: Runtime;
  try {
    const unitOfWork = new SqliteUnitOfWork(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const executionEnvironmentStore = new SqliteExecutionEnvironmentStore(connection.raw);
    const runtimeDataRoot = databasePath === ':memory:' ? join(homedir(), '.sync-think') : dirname(databasePath);
    for (const workspace of workspaceStore.listWorkspaces()) {
      executionEnvironmentStore.ensureWorkspaceDefaults({
        workspaceId: workspace.id,
        folderPath: workspace.folderPath,
        browserProfilePath: join(runtimeDataRoot, 'browser-profiles', 'default'),
      });
    }
    const taskEnvironmentManager = new TaskExecutionEnvironmentManager({
      store: executionEnvironmentStore,
      workspaceStore,
      worktreeRoot: join(runtimeDataRoot, 'worktrees'),
      repositoryCacheRoot: join(runtimeDataRoot, 'repository-cache'),
      browserProfileRoot: join(runtimeDataRoot, 'browser-profiles'),
    });
    taskEnvironmentManager.cleanupExpired();
    const providerStore = new SqliteProviderStore(connection.raw);
    const agentStore = new SqliteAgentStore(connection.raw);
    const groupStore = new SqliteGroupStore(connection.raw);
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const orchestrationStore = new SqliteOrchestrationStore(connection.raw);
    const artifactStore = new SqliteArtifactStore(connection.raw);
    const productionExecutionStore = new SqliteProductionExecutionStore(connection.raw);
    unitOfWork.run(() => workspaceStore.reconcileTaskVersionsFromMessageEvents());
    const stepExecutor =
      runtimeOptions.stepExecutor ??
      createProductionStepExecutor({
        agentStore,
        providerStore,
        workspaceStore,
        executionEnvironmentStore,
        groupStore,
        eventStore: stateStore,
        orchestrationStore,
        executionStore: productionExecutionStore,
        secureStore,
        adaptersByProtocol: runtimeOptions.discoveryByProtocol,
        fallbackAdapter: runtimeOptions.discoveryAdapter,
      });
    runtime = new Runtime({
      ...runtimeOptions,
      stateStore,
      workspaceStore,
      executionEnvironmentStore,
      taskEnvironmentManager,
      providerStore,
      agentStore,
      groupStore,
      automationStore: new SqliteAutomationStore(connection.raw),
      memoryStore: new SqliteMemoryStore(connection.raw),
      skillStore: new SqliteSkillStore(connection.raw),
      mcpStore: new SqliteMcpStore(connection.raw),
      approvalStore: new SqliteApprovalStore(connection.raw),
      policyStore: new SqlitePolicyStore(connection.raw),
      authorizationStore: new SqliteAuthorizationStore(connection.raw),
      orchestrationStore,
      artifactStore,
      productionExecutionStore,
      unitOfWork,
      secureStore,
      stepExecutor,
    });
  } catch (error) {
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

