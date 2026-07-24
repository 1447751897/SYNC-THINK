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
  SqliteGlobalAgentStore,
  SqliteTeamStore,
  SqliteConversationStore,
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
  SqliteAppSettingStore,
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

export interface OpenPersistentRuntimeOptions
  extends Omit<RuntimeOptions, 'checkpoint' | 'stateStore' | 'workspaceStore' | 'providerStore' | 'agentStore' | 'globalAgentStore' | 'teamStore' | 'conversationStore' | 'memoryStore' | 'skillStore' | 'mcpStore' | 'approvalStore' | 'policyStore' | 'authorizationStore' | 'orchestrationStore' | 'artifactStore' | 'productionExecutionStore' | 'unitOfWork' | 'secureStore' | 'appSettingStore' | 'queryUsageSummary'> {
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
    const providerStore = new SqliteProviderStore(connection.raw);
    const agentStore = new SqliteAgentStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const teamStore = new SqliteTeamStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const orchestrationStore = new SqliteOrchestrationStore(connection.raw);
    const artifactStore = new SqliteArtifactStore(connection.raw);
    const productionExecutionStore = new SqliteProductionExecutionStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    // 0026: aggregate provider.usage events (max tokens per packet, summed per model).
    const queryUsageSummary = (sinceIso?: string) => {
      const rows = connection.raw
        .prepare(
          `WITH per_packet AS (
             SELECT COALESCE(json_extract(payload_json, '$.packetId'), id) AS packet_id,
                    json_extract(payload_json, '$.modelId') AS model_id,
                    json_extract(payload_json, '$.run.providerId') AS provider_id,
                    MAX(COALESCE(json_extract(payload_json, '$.tokensIn'), 0)) AS tokens_in,
                    MAX(COALESCE(json_extract(payload_json, '$.tokensOut'), 0)) AS tokens_out,
                    MAX(occurred_at) AS last_used_at
             FROM event
             WHERE type = 'provider.usage' AND occurred_at >= COALESCE(?, '')
             GROUP BY packet_id, model_id, provider_id
           )
           SELECT model_id, provider_id, COUNT(*) AS requests,
                  SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
                  MAX(last_used_at) AS last_used_at
           FROM per_packet
           WHERE model_id IS NOT NULL
           GROUP BY model_id, provider_id
           ORDER BY tokens_out DESC`,
        )
        .all(sinceIso ?? null) as Array<{
        model_id: string;
        provider_id: string | null;
        requests: number;
        tokens_in: number;
        tokens_out: number;
        last_used_at: string | null;
      }>;
      return rows.map((row) => ({
        modelId: row.model_id,
        providerId: row.provider_id ?? undefined,
        requests: row.requests,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        lastUsedAt: row.last_used_at ?? undefined,
      }));
    };
    unitOfWork.run(() => workspaceStore.reconcileTaskVersionsFromMessageEvents());
    const stepExecutor =
      runtimeOptions.stepExecutor ??
      createProductionStepExecutor({
        agentStore,
        providerStore,
        workspaceStore,
        orchestrationStore,
        executionStore: productionExecutionStore,
        secureStore,
        adaptersByProtocol: runtimeOptions.discoveryByProtocol,
        fallbackAdapter: runtimeOptions.discoveryAdapter,
      });
    runtime = new Runtime({
      ...runtimeOptions,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      workspaceStore,
      providerStore,
      agentStore,
      globalAgentStore,
      teamStore,
      conversationStore,
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
      appSettingStore,
      queryUsageSummary,
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

