/**
 * Real Claude Code + platform MCP channel verification (Slice 5 acceptance).
 *
 * Spawns the locally installed claude through ClaudeCodeKernelAdapter with the
 * platform broker wired, routes Claude's Anthropic request through the open
 * gateway into an enabled OpenAI provider, asks CC to call the host file tools
 * over MCP, and prints the normalized events. The permission bridge
 * auto-approves (CC's own tool calls); the platform MCP tool calls execute
 * in-process.
 *
 *   E2E_DB_PATH=<active-db> pnpm tsx apps/runtime/src/kernel/claude-mcp-e2e-verify.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGatewayBaseUrls } from '@sync-think/protocol';
import type { KernelEvent } from '@sync-think/shared';
import {
  openDatabaseAsync,
  SqliteProviderStore,
  type ModelRecord,
  type ProviderRecord,
} from '@sync-think/storage';
import {
  createExternalGatewayToken,
  startOpenGatewayServer,
  type OpenGatewayServer,
} from '../gateway/server.js';
import {
  GatewayTicketRegistry,
  toGatewayUpstreamProtocol,
  type GatewayRunUsage,
  type GatewayUpstreamProtocol,
} from '../gateway/tickets.js';
import { createRuntimeSecureStore, resolveRuntimeDatabasePath } from '../persistence.js';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { startKernelMcpBroker } from './mcp-broker.js';
import { executePlatformTool, PLATFORM_MCP_TOOL_DEFINITIONS } from './platform-tools.js';

const PROMPT =
  process.env.E2E_PROMPT ??
  'Use the platform tool mcp__sync-think-platform__file_write to create a file cc-hello.txt with content "hi from cc". Then use mcp__sync-think-platform__file_read to read it back and reply with the file content.';
const DATABASE_PATH = process.env.E2E_DB_PATH ?? resolveRuntimeDatabasePath();
const PROVIDER_ID = process.env.E2E_PROVIDER_ID?.trim() ?? '';
const MODEL_SELECTOR = process.env.E2E_MODEL?.trim() ?? '';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 240_000);
const MCP_SERVER_ENTRY = fileURLToPath(
  new URL('../../../mcp-server/platform-mcp-server.mjs', import.meta.url),
);

interface GatewayTarget {
  provider: ProviderRecord;
  model: ModelRecord;
  protocol: GatewayUpstreamProtocol;
  credentialStoreHandle: string;
}

function selectGatewayTarget(providerStore: SqliteProviderStore): GatewayTarget {
  const candidates = providerStore
    .listProviders()
    .filter(({ provider }) => provider.enabled && (!PROVIDER_ID || provider.id === PROVIDER_ID))
    .flatMap(({ provider, models }) =>
      models
        .filter((model) => {
          if (MODEL_SELECTOR) {
            const selector = MODEL_SELECTOR.toLowerCase();
            if (
              model.id.toLowerCase() !== selector &&
              model.providerModelId.toLowerCase() !== selector &&
              model.displayName.toLowerCase() !== selector
            ) {
              return false;
            }
          }
          return (
            model.capabilities.includes('text') &&
            toGatewayUpstreamProtocol(model.protocol) !== undefined
          );
        })
        .map((model) => ({ provider, model })),
    )
    .filter(({ provider, model }) => {
      const protocol = toGatewayUpstreamProtocol(model.protocol);
      return (
        provider.baseUrl.trim() !== '' &&
        (protocol === 'openai-chat' || protocol === 'openai-responses')
      );
    })
    .sort(
      (left, right) =>
        left.provider.sortOrder - right.provider.sortOrder ||
        left.model.priority - right.model.priority ||
        left.model.providerModelId.localeCompare(right.model.providerModelId),
    );

  const selected =
    candidates.find(({ model }) => model.capabilities.includes('tool-calling')) ??
    (MODEL_SELECTOR ? candidates[0] : undefined);
  if (!selected) {
    const available = providerStore
      .listProviders()
      .filter(({ provider }) => provider.enabled)
      .flatMap(({ provider, models }) =>
        models
          .filter((model) => {
            const protocol = toGatewayUpstreamProtocol(model.protocol);
            return protocol === 'openai-chat' || protocol === 'openai-responses';
          })
          .map(
            (model) =>
              `${provider.name}/${model.providerModelId} (${model.protocol}; ${model.capabilities.join(', ') || 'no capabilities'})`,
          ),
      );
    throw new Error(
      `No enabled OpenAI provider model with text + tool-calling is available. ` +
        `Set E2E_PROVIDER_ID/E2E_MODEL to select an explicit model. Candidates: ${available.join('; ') || 'none'}`,
    );
  }

  const credentialRef = selected.model.credentialRefId
    ? providerStore.getCredentialRef(selected.model.credentialRefId)
    : providerStore.getPrimaryCredentialRef(selected.provider.id);
  if (!credentialRef) {
    throw new Error(
      `No credential reference is configured for ${selected.provider.name}/${selected.model.providerModelId}.`,
    );
  }
  const protocol = toGatewayUpstreamProtocol(selected.model.protocol);
  if (protocol !== 'openai-chat' && protocol !== 'openai-responses') {
    throw new Error(
      `Selected model protocol is not an OpenAI gateway target: ${selected.model.protocol}`,
    );
  }
  return {
    provider: selected.provider,
    model: selected.model,
    protocol,
    credentialStoreHandle: credentialRef.storeHandle,
  };
}

async function main(): Promise<number> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-cc-mcp-e2e-'));
  const events: KernelEvent[] = [];
  const tickets = new GatewayTicketRegistry();
  let connection: Awaited<ReturnType<typeof openDatabaseAsync>> | undefined;
  let secureStore: ReturnType<typeof createRuntimeSecureStore> | undefined;
  let gateway: OpenGatewayServer | undefined;
  let broker: Awaited<ReturnType<typeof startKernelMcpBroker>> | undefined;
  let adapter: ClaudeCodeKernelAdapter | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runId: string | undefined;
  let providerUsage: GatewayRunUsage[] = [];

  try {
    connection = await openDatabaseAsync({
      path: DATABASE_PATH,
      readonly: true,
      fileMustExist: true,
    });
    const providerStore = new SqliteProviderStore(connection.raw);
    const target = selectGatewayTarget(providerStore);
    secureStore = createRuntimeSecureStore();
    const upstreamApiKey = await secureStore.retrieveSecret(target.credentialStoreHandle);
    if (!upstreamApiKey) {
      throw new Error(
        `The stored credential for ${target.provider.name}/${target.model.providerModelId} is empty.`,
      );
    }

    gateway = await startOpenGatewayServer({
      port: 0,
      externalToken: createExternalGatewayToken(),
      resolveTicket: (key) => tickets.resolveWithRun(key),
      recordRunUsage: (runId, usage) => tickets.recordRunUsage(runId, usage),
      resolveResponseForFunctionCall: (scopeId, callId) =>
        tickets.resolveResponseForFunctionCall(scopeId, callId),
      recordResponseForFunctionCall: (scopeId, callId, responseId) =>
        tickets.recordResponseForFunctionCall(scopeId, callId, responseId),
      onLog: (message) => console.log('[gateway]', message),
    });
    runId = `claude-mcp-e2e-${randomUUID()}`;
    const responseContinuationScopeId = `kernel_e2e_${randomUUID()}`;
    const ticket = tickets.issue(runId, {
      baseUrl: target.provider.baseUrl,
      protocol: target.protocol,
      providerModelId: target.model.providerModelId,
      apiKey: upstreamApiKey,
      providerId: target.provider.id,
      ...(target.protocol === 'openai-responses' ? { responseContinuationScopeId } : {}),
    });
    const gatewayUrls = openGatewayBaseUrls(gateway.host, gateway.port);
    console.log(
      '[cc-mcp-e2e] route',
      JSON.stringify({
        databasePath: DATABASE_PATH,
        providerId: target.provider.id,
        providerName: target.provider.name,
        providerProtocol: target.protocol,
        providerModelId: target.model.providerModelId,
        inboundProtocol: 'anthropic-messages',
        inboundBaseUrl: gatewayUrls.anthropicBaseUrl,
      }),
    );

    broker = await startKernelMcpBroker({
      workspaceDir,
      tools: PLATFORM_MCP_TOOL_DEFINITIONS,
      onToolCall: async (call) => {
        console.log('[broker] tool-call', call.tool, JSON.stringify(call.input));
        try {
          return {
            ok: true,
            content: await executePlatformTool(call.tool, call.input, { workspaceDir }),
          };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    adapter = new ClaudeCodeKernelAdapter();
    adapter.onPermissionRequest((request) => {
      console.log('[cc] permission request', request.toolName, request.requestId);
      setTimeout(() => adapter?.respondPermission(request.requestId, { allow: true }), 30);
    });
    adapter.onExit((code, stderrTail) => {
      console.log('[cc] process exit', code, 'stderrTail:', JSON.stringify(stderrTail.slice(-600)));
    });
    timer = setTimeout(() => {
      console.error('[cc-mcp-e2e] TIMEOUT - terminating');
      void adapter?.cancel();
    }, TIMEOUT_MS);

    for await (const event of adapter.start({
      kernelId: 'claude-code',
      model: target.model.id,
      providerModelId: target.model.providerModelId,
      userText: PROMPT,
      contextWindow: 200_000,
      credential: {
        baseUrl: gatewayUrls.anthropicBaseUrl,
        apiKey: ticket.id,
      },
      systemContext: '## CLAUDE.md\n\nReply tersely.',
      platformTools: [],
      platformBroker: {
        host: broker.host,
        port: broker.port,
        token: broker.token,
        workspaceDir,
        command: process.execPath,
        args: [MCP_SERVER_ENTRY],
      },
      permissionMode: 'full-access',
      workspaceDir,
    })) {
      events.push(event);
      if (event.type === 'session-started')
        console.log('[kernel-event] session-started', event.sessionId);
      if (event.type === 'delta') console.log('[kernel-event] delta', JSON.stringify(event.text));
      if (event.type === 'tool-call') console.log('[kernel-event] tool-call', event.name);
      if (event.type === 'tool-result')
        console.log('[kernel-event] tool-result', event.output.slice(0, 160));
      if (event.type === 'usage')
        console.log(
          '[kernel-event] usage',
          JSON.stringify({
            real: event.usage.real,
            input: event.usage.input,
            output: event.usage.output,
            cached: event.usage.cached,
            cachedTokensCreated: event.usage.cachedTokensCreated,
          }),
        );
      if (event.type === 'terminal') {
        console.log('[kernel-event] terminal', event.status, event.error ?? '');
        break;
      }
    }
  } catch (error) {
    console.error('[cc-mcp-e2e] error:', error instanceof Error ? error.message : String(error));
  } finally {
    if (timer) clearTimeout(timer);
    if (adapter) {
      try {
        await adapter.stop();
      } catch (error) {
        console.error('[cc-mcp-e2e] adapter cleanup failed:', error);
      }
    }
    if (broker) {
      try {
        await broker.close();
      } catch (error) {
        console.error('[cc-mcp-e2e] broker cleanup failed:', error);
      }
    }
    if (gateway) {
      try {
        await gateway.close();
      } catch (error) {
        console.error('[cc-mcp-e2e] gateway cleanup failed:', error);
      }
    }
    if (runId) providerUsage = tickets.consumeRunUsage(runId);
    tickets.clear();
    secureStore?.shutdown();
    connection?.raw.close();
  }

  const written = join(workspaceDir, 'cc-hello.txt');
  console.log('[cc-mcp-e2e] file written?', existsSync(written));
  if (existsSync(written)) console.log('[cc-mcp-e2e] file content:', readFileSync(written, 'utf8'));

  const terminal = events[events.length - 1];
  const finalText = events
    .filter((event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  const toolCalls = events.filter(
    (event): event is Extract<KernelEvent, { type: 'tool-call' }> => event.type === 'tool-call',
  );
  const toolResults = events.filter(
    (event): event is Extract<KernelEvent, { type: 'tool-result' }> => event.type === 'tool-result',
  );
  const usage = events.find(
    (event): event is Extract<KernelEvent, { type: 'usage' }> => event.type === 'usage',
  );
  const session = events.find(
    (event): event is Extract<KernelEvent, { type: 'session-started' }> =>
      event.type === 'session-started',
  );
  const fileContent = existsSync(written) ? readFileSync(written, 'utf8') : '';
  const ok =
    terminal?.type === 'terminal' &&
    terminal.status === 'completed' &&
    fileContent === 'hi from cc' &&
    finalText.includes('hi from cc') &&
    toolCalls.some((event) => event.name.includes('file_write')) &&
    toolCalls.some((event) => event.name.includes('file_read')) &&
    toolResults.length >= 2 &&
    toolResults.every((event) => !event.isError) &&
    providerUsage.some((entry) => entry.totalTokens > 0) &&
    Boolean(session?.sessionId);
  console.log(
    '[cc-mcp-e2e] summary',
    JSON.stringify({
      sessionId: session?.sessionId,
      toolCalls: toolCalls.map((event) => event.name),
      toolResults: toolResults.length,
      kernelUsage: usage?.usage,
      providerUsage,
      finalText,
    }),
  );
  console.log(ok ? 'CC_MCP_OK' : 'CC_MCP_FAILED');
  return ok ? 0 : 1;
}

process.exitCode = await main();
