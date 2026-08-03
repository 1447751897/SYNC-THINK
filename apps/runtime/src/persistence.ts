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
import { GeneratedImageStore } from './orchestration/generated-image-store.js';
import { BrowserHost, PersistentBrowserWorker, type BrowserHostLike } from '@sync-think/workers';
import { RuntimeBrowserController } from './browser/runtime-browser-controller.js';

export interface RuntimeEventPayloadSidecarOptions {
  /** Explicit opt-in. Omitting this object keeps every Event payload inline. */
  enabled: true;
  rootDirectory?: string;
  minimumBytes?: number;
}

export interface OpenPersistentRuntimeOptions
  extends Omit<RuntimeOptions, 'checkpoint' | 'stateStore' | 'workspaceStore' | 'providerStore' | 'agentStore' | 'globalAgentStore' | 'teamStore' | 'conversationStore' | 'messageStore' | 'memoryStore' | 'skillStore' | 'mcpStore' | 'approvalStore' | 'policyStore' | 'authorizationStore' | 'orchestrationStore' | 'artifactStore' | 'productionExecutionStore' | 'browserStore' | 'desktopStore' | 'unitOfWork' | 'secureStore' | 'appSettingStore' | 'queryUsageSummary'> {
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
  const {
    dbPath,
    secureStoreBackend,
    secureStoreKeyPath,
    eventPayloadSidecar,
    ...runtimeOptions
  } = options;
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
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    // 0026+: rebuild NewMax-style usage views from durable provider/run/tool events.
    const queryUsageSummary = (sinceIso?: string) => {
      const filter = sinceIso ?? '';
      const requestRows = connection.raw
        .prepare(
          `WITH usage_packets AS (
             SELECT COALESCE(
                      json_extract(payload_json, '$.requestId'),
                      json_extract(payload_json, '$.packetId'),
                      id
                    ) AS request_id,
                    task_id,
                    run_id,
                    step_id,
                    json_extract(payload_json, '$.modelId') AS model_id,
                    COALESCE(
                      json_extract(payload_json, '$.providerId'),
                      json_extract(payload_json, '$.run.providerId')
                    ) AS provider_id,
                    json_extract(payload_json, '$.providerModelId') AS provider_model_id,
                    json_extract(payload_json, '$.agentContextThreadId') AS agent_context_thread_id,
                    json_extract(payload_json, '$.contextEpochId') AS context_epoch_id,
                    json_extract(payload_json, '$.purpose') AS purpose,
                    MAX(COALESCE(json_extract(payload_json, '$.tokensIn'), 0)) AS tokens_in,
                    MAX(COALESCE(json_extract(payload_json, '$.tokensOut'), 0)) AS tokens_out,
                    MAX(json_extract(payload_json, '$.cachedTokensHit')) AS cached_tokens_hit,
                    MAX(json_extract(payload_json, '$.cachedTokensCreated')) AS cached_tokens_created,
                    MAX(COALESCE(json_extract(payload_json, '$.reasoningTokens'), 0)) AS reasoning_tokens,
                    MAX(COALESCE(json_extract(payload_json, '$.totalTokens'), 0)) AS total_tokens,
                    MIN(occurred_at) AS started_at,
                    MAX(occurred_at) AS usage_at
             FROM event
             WHERE type = 'provider.usage' AND occurred_at >= ?
             GROUP BY request_id, task_id, run_id, step_id, model_id, provider_id, provider_model_id, agent_context_thread_id, context_epoch_id, purpose
           ), terminal AS (
             SELECT run_id,
                    MAX(CASE WHEN type = 'run.completed' THEN occurred_at END) AS completed_at,
                    MAX(CASE WHEN type = 'run.failed' THEN occurred_at END) AS failed_at,
                    MAX(CASE WHEN type = 'run.failed' THEN json_extract(payload_json, '$.errorMessage') END) AS error_message
             FROM event
             WHERE run_id IS NOT NULL
               AND type IN ('run.completed', 'run.failed')
               AND occurred_at >= ?
             GROUP BY run_id
           )
           SELECT u.request_id, u.task_id, u.run_id, u.step_id, u.model_id, u.provider_id,
                   u.provider_model_id, u.agent_context_thread_id, u.context_epoch_id, u.purpose,
                   u.tokens_in, u.tokens_out, u.cached_tokens_hit, u.cached_tokens_created,
                   u.reasoning_tokens, u.total_tokens,
                   u.started_at, u.usage_at,
                   t.completed_at, t.failed_at, t.error_message
           FROM usage_packets u
           LEFT JOIN terminal t ON t.run_id = u.run_id
           WHERE u.model_id IS NOT NULL
           ORDER BY u.usage_at DESC`,
        )
        .all(filter, filter) as Array<{
         request_id: string;
         task_id: string | null;
         run_id: string | null;
         step_id: string | null;
         model_id: string;
         provider_id: string | null;
         provider_model_id: string | null;
         agent_context_thread_id: string | null;
         context_epoch_id: string | null;
         purpose: string | null;
         tokens_in: number;
         tokens_out: number;
         cached_tokens_hit: number | null;
         cached_tokens_created: number | null;
         reasoning_tokens: number;
         total_tokens: number;
        started_at: string;
        usage_at: string;
        completed_at: string | null;
        failed_at: string | null;
        error_message: string | null;
      }>;

      const requests = requestRows.map((row) => {
        const terminalAt = row.completed_at ?? row.failed_at;
        const startMs = Date.parse(row.started_at);
        const endMs = terminalAt ? Date.parse(terminalAt) : Number.NaN;
        return {
          requestId: row.request_id,
          taskId: row.task_id ?? undefined,
          runId: row.run_id ?? undefined,
          stepId: row.step_id ?? undefined,
          agentContextThreadId: row.agent_context_thread_id ?? undefined,
          contextEpochId: row.context_epoch_id ?? undefined,
          occurredAt: row.usage_at,
          modelId: row.model_id,
          providerId: row.provider_id ?? undefined,
          providerModelId: row.provider_model_id ?? undefined,
          purpose: row.purpose as import('@sync-think/shared').ProviderUsagePurpose | undefined,
          tokensIn: row.tokens_in,
          tokensOut: row.tokens_out,
          cachedTokensHit: row.cached_tokens_hit ?? undefined,
          cachedTokensCreated: row.cached_tokens_created ?? undefined,
          reasoningTokens: row.reasoning_tokens || undefined,
          totalTokens: row.total_tokens || row.tokens_in + row.tokens_out,
          status: row.failed_at ? ('failed' as const) : row.completed_at ? ('success' as const) : ('unknown' as const),
          latencyMs:
            Number.isFinite(startMs) && Number.isFinite(endMs)
              ? Math.max(0, endMs - startMs)
              : undefined,
          errorMessage: row.error_message ?? undefined,
        };
      });

      const byModel = new Map<
        string,
        {
          modelId: string;
          providerId?: string;
          requests: number;
          succeededRequests: number;
          failedRequests: number;
          tokensIn: number;
          tokensOut: number;
          cachedTokensHit: number;
          cachedTokensCreated: number;
          reasoningTokens: number;
          totalTokens: number;
          latencyTotalMs: number;
          latencySamples: number;
          averageLatencyMs?: number;
          lastUsedAt?: string;
        }
      >();
      for (const request of requests) {
        const key = `${request.providerId ?? ''}|${request.modelId}`;
        const current = byModel.get(key) ?? {
          modelId: request.modelId,
          providerId: request.providerId,
          requests: 0,
          succeededRequests: 0,
          failedRequests: 0,
          tokensIn: 0,
          tokensOut: 0,
          cachedTokensHit: 0,
          cachedTokensCreated: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          latencyTotalMs: 0,
          latencySamples: 0,
          lastUsedAt: request.occurredAt,
        };
        current.requests += 1;
        if (request.status === 'success') current.succeededRequests += 1;
        if (request.status === 'failed') current.failedRequests += 1;
        current.tokensIn += request.tokensIn;
        current.tokensOut += request.tokensOut;
        current.cachedTokensHit += request.cachedTokensHit ?? 0;
        current.cachedTokensCreated += request.cachedTokensCreated ?? 0;
        current.reasoningTokens += request.reasoningTokens ?? 0;
        current.totalTokens += request.totalTokens;
        if (typeof request.latencyMs === 'number') {
          current.latencyTotalMs += request.latencyMs;
          current.latencySamples += 1;
          current.averageLatencyMs = current.latencyTotalMs / current.latencySamples;
        }
        if (!current.lastUsedAt || request.occurredAt > current.lastUsedAt) {
          current.lastUsedAt = request.occurredAt;
        }
        byModel.set(key, current);
      }

      const toolRequestRows = connection.raw
        .prepare(
          `SELECT run_id, occurred_at, payload_json
           FROM event
           WHERE type = 'tool.requested' AND occurred_at >= ?
           ORDER BY occurred_at DESC`,
        )
        .all(filter) as Array<{ run_id: string | null; occurred_at: string; payload_json: string }>;
      const toolTerminalRows = connection.raw
        .prepare(
          `SELECT event.run_id, event.type, event.occurred_at, event.payload_json,
                  conversation.title AS conversation_title
           FROM event
           LEFT JOIN run ON run.id = event.run_id
           LEFT JOIN thread ON thread.id = json_extract(event.payload_json, '$.threadId')
           LEFT JOIN conversation ON conversation.task_id = COALESCE(run.task_id, thread.task_id)
           WHERE event.type IN ('tool.completed', 'tool.failed')
             AND event.occurred_at >= ?
           ORDER BY event.occurred_at DESC`,
        )
        .all(filter) as Array<{
        run_id: string | null;
        type: string;
        occurred_at: string;
        payload_json: string;
        conversation_title: string | null;
      }>;

      const parseJsonObject = (value: unknown): Record<string, unknown> | undefined => {
        if (typeof value !== 'string') {
          return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
        }
        try {
          const parsed = JSON.parse(value) as unknown;
          return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : undefined;
        } catch {
          return undefined;
        }
      };
      const requestByCall = new Map<
        string,
        { toolName: string; modelId?: string; providerId?: string; occurredAt: string }
      >();
      for (const row of toolRequestRows) {
        const payload = parseJsonObject(row.payload_json) ?? {};
        const toolCall = parseJsonObject(payload.toolCall);
        const run = parseJsonObject(payload.run);
        const toolCallId = String(payload.toolCallId ?? toolCall?.id ?? '');
        if (!toolCallId) continue;
        requestByCall.set(`${row.run_id ?? ''}\0${toolCallId}`, {
          toolName: String(payload.toolName ?? toolCall?.name ?? 'unknown'),
          modelId: typeof run?.modelId === 'string' ? run.modelId : undefined,
          providerId: typeof run?.providerId === 'string' ? run.providerId : undefined,
          occurredAt: row.occurred_at,
        });
      }

      const terminalByCall = new Map<
        string,
        { failed: boolean; occurredAt: string; errorSummary?: string; conversationTitle?: string }
      >();
      for (const row of toolTerminalRows) {
        const payload = parseJsonObject(row.payload_json) ?? {};
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
        if (!toolCallId) continue;
        const result = parseJsonObject(payload.result);
        const rawResult = typeof payload.result === 'string' ? payload.result : '';
        const failed =
          row.type === 'tool.failed' ||
          payload.failed === true ||
          result?.ok === false ||
          /<tool_use_error>|tool execution failed/i.test(rawResult);
        const rawError =
          typeof payload.errorSummary === 'string'
            ? payload.errorSummary
            : typeof result?.error === 'string'
              ? result.error
              : failed
                ? rawResult
                : undefined;
        terminalByCall.set(`${row.run_id ?? ''}\0${toolCallId}`, {
          failed,
          occurredAt: row.occurred_at,
          errorSummary: rawError?.slice(0, 500),
          conversationTitle: row.conversation_title ?? undefined,
        });
      }

      const toolStats = new Map<
        string,
        { toolName: string; calls: number; successes: number; failures: number; lastUsedAt?: string }
      >();
      const toolModelStats = new Map<
        string,
        { modelId: string; providerId?: string; calls: number; successes: number; failures: number }
      >();
      const toolFailures: Array<{
        occurredAt: string;
        toolName: string;
        modelId?: string;
        conversationTitle?: string;
        errorSummary: string;
      }> = [];
      for (const [key, request] of requestByCall) {
        const terminal = terminalByCall.get(key);
        const stats = toolStats.get(request.toolName) ?? {
          toolName: request.toolName,
          calls: 0,
          successes: 0,
          failures: 0,
          lastUsedAt: request.occurredAt,
        };
        stats.calls += 1;
        if (terminal?.failed) stats.failures += 1;
        else if (terminal) stats.successes += 1;
        if (!stats.lastUsedAt || request.occurredAt > stats.lastUsedAt) {
          stats.lastUsedAt = request.occurredAt;
        }
        toolStats.set(request.toolName, stats);

        if (request.modelId) {
          const modelStats = toolModelStats.get(request.modelId) ?? {
            modelId: request.modelId,
            providerId: request.providerId,
            calls: 0,
            successes: 0,
            failures: 0,
          };
          modelStats.calls += 1;
          if (terminal?.failed) modelStats.failures += 1;
          else if (terminal) modelStats.successes += 1;
          toolModelStats.set(request.modelId, modelStats);
        }
        if (terminal?.failed) {
          toolFailures.push({
            occurredAt: terminal.occurredAt,
            toolName: request.toolName,
            modelId: request.modelId,
            conversationTitle: terminal.conversationTitle,
            errorSummary: terminal.errorSummary || '工具调用失败',
          });
        }
      }

      return {
        rows: Array.from(byModel.values())
          .map(({ latencyTotalMs: _total, latencySamples: _samples, ...row }) => row)
          .sort((a, b) => b.tokensOut - a.tokensOut),
        requests,
        tools: Array.from(toolStats.values())
          .map((row) => ({
            ...row,
            successRate: row.calls > 0 ? (row.successes / row.calls) * 100 : 0,
          }))
          .sort((a, b) => b.calls - a.calls),
        toolModels: Array.from(toolModelStats.values())
          .map((row) => ({
            ...row,
            successRate: row.calls > 0 ? (row.successes / row.calls) * 100 : 0,
          }))
          .sort((a, b) => b.calls - a.calls),
        toolFailures: toolFailures
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, 200),
      };
    };
    const taskVersionRepairAt = new Date().toISOString();
    workspaceStore.reconcileTaskVersionFloorsFromMessages(taskVersionRepairAt);
    workspaceStore.reconcileTaskVersionFloorsFromTaskEvents(taskVersionRepairAt);
    browserHost ??= new BrowserHost({
      profileRoot: join(runtimeDataRoot, 'browser-profiles'),
      executablePath: process.env.SYNC_THINK_BROWSER_EXECUTABLE,
    });
    const productionBrowserController = new RuntimeBrowserController({
      worker: new PersistentBrowserWorker(browserHost),
      store: browserStore,
      profileId: runtimeOptions.browserProfileId,
      fallbackWorkingDir: runtimeOptions.browserFallbackWorkingDir ?? runtimeDataRoot,
      leaseHost: browserHost,
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
            shouldExternalize: (event) =>
              event.type === EVENT_PAYLOAD_BACKFILL_EVENT_TYPES[0],
            project: (event) => buildEventPayloadBackfillProjection(event.type, event.payload),
          }
        : undefined,
    );
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
      memoryStore: new SqliteMemoryStore(connection.raw),
      skillStore,
      mcpStore: new SqliteMcpStore(connection.raw),
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
      queryUsageSummary,
      browserHost,
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
