// Runtime process entry. Started by `pnpm dev:runtime`.
import {
  FakeProvider,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter,
  AnthropicMessagesAdapter,
  createProxyAwareFetch,
  resolveOutboundProxy,
  proxyLogLabel,
} from '@sync-think/adapters';
import type { ProtocolFamily } from '@sync-think/shared';
import { openPersistentRuntime, resolveRuntimeDatabasePath } from './persistence.js';

function buildDiscoveryByProtocol() {
  // Live OpenAI-compatible discovery for chat/responses/images gateways.
  // FakeProvider remains only for demo streaming runs.
  // Node does not inherit Windows system proxy; inject CONNECT-aware fetch
  // so Clash/system proxy hosts resolve (imported CC Switch providers, etc.).
  const outboundProxy = resolveOutboundProxy();
  const fetchImpl = createProxyAwareFetch(outboundProxy);
  console.log('[runtime] outbound proxy:', proxyLogLabel(outboundProxy));

  const adapterOpts = { fetchImpl };
  const openAiCompatible = new OpenAIChatAdapter(adapterOpts);
  const responses = new OpenAIResponsesAdapter(adapterOpts);
  const anthropic = new AnthropicMessagesAdapter(adapterOpts);
  return {
    'openai-chat': openAiCompatible,
    'openai-responses': responses,
    // Images gateways commonly share the same /models list endpoint.
    'openai-images': openAiCompatible,
    'anthropic-messages': anthropic,
  } satisfies Partial<
    Record<
      ProtocolFamily,
      OpenAIChatAdapter | OpenAIResponsesAdapter | AnthropicMessagesAdapter
    >
  >;
}

async function main() {
  const installId = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
  // Dev desktop sends no HMAC when SYNC_THINK_PIPE_SECRET is unset.
  // Allow no-token hello unless a pipe secret is configured, or DEV_NO_TOKEN=1.
  const allowNoToken =
    process.env.SYNC_THINK_DEV_NO_TOKEN === '1' || !process.env.SYNC_THINK_PIPE_SECRET;
  const session = await openPersistentRuntime({
    dbPath: resolveRuntimeDatabasePath(),
    installId,
    allowNoToken,
    helloSecret: process.env.SYNC_THINK_PIPE_SECRET,
    demoProvider:
      process.env.SYNC_THINK_DISABLE_DEMO_PROVIDER === '1'
        ? undefined
        : new FakeProvider({ chunksPerWord: 2, tickMs: 35 }),
    discoveryByProtocol: buildDiscoveryByProtocol(),
  });
  await session.runtime.start();
  console.log('[runtime] started. installId=', installId, 'pid=', process.pid);
  console.log('[runtime] database ready', session.databasePath);
  console.log('[runtime] discovery: openai-compatible GET /models enabled');
  console.log('[runtime] streaming: openai-chat + anthropic-messages live call via registered providers; fake fallback when no catalog');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[runtime] shutting down');
    await session.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
