// Runtime process entry. Started by `pnpm dev:runtime`.
import {
  FakeProvider,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter,
  OpenAIImagesAdapter,
  AnthropicMessagesAdapter,
  createProxyAwareFetch,
  resolveOutboundProxy,
  proxyLogLabel,
} from '@sync-think/adapters';
import type { ProtocolFamily } from '@sync-think/shared';
import { openPersistentRuntime, resolveRuntimeDatabasePath } from './persistence.js';
import { SUPERVISED_RUNTIME_READY_MESSAGE } from './daemon/runtime-child.js';

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
  const images = new OpenAIImagesAdapter(adapterOpts);
  const anthropic = new AnthropicMessagesAdapter(adapterOpts);
  return {
    'openai-chat': openAiCompatible,
    'openai-responses': responses,
    'openai-images': images,
    'anthropic-messages': anthropic,
  } satisfies Partial<
    Record<
      ProtocolFamily,
      OpenAIChatAdapter | OpenAIResponsesAdapter | OpenAIImagesAdapter | AnthropicMessagesAdapter
    >
  >;
}

async function main() {
  const installId = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
  // worker 模式（守护进程自拉）：禁用自身调度 tick，执行指定任务后退出。
  const daemonWorker = process.env.SYNC_THINK_DAEMON_WORKER === '1';
  const daemonTaskId = process.env.SYNC_THINK_DAEMON_TASK_ID;
  // Dev desktop sends no HMAC when SYNC_THINK_PIPE_SECRET is unset.
  // Allow no-token hello unless a pipe secret is configured, or DEV_NO_TOKEN=1.
  const allowNoToken =
    process.env.SYNC_THINK_DEV_NO_TOKEN === '1' || !process.env.SYNC_THINK_PIPE_SECRET;
  const eventPayloadSidecar =
    process.env.SYNC_THINK_EVENT_PAYLOAD_SIDECAR === '1'
      ? {
          enabled: true as const,
          ...(process.env.SYNC_THINK_EVENT_PAYLOAD_SIDECAR_ROOT
            ? { rootDirectory: process.env.SYNC_THINK_EVENT_PAYLOAD_SIDECAR_ROOT }
            : {}),
        }
      : undefined;
  const shutdownState: {
    run?: () => Promise<void>;
    pending: boolean;
  } = { pending: false };
  const session = await openPersistentRuntime({
    dbPath: resolveRuntimeDatabasePath(),
    installId,
    allowNoToken,
    helloSecret: process.env.SYNC_THINK_PIPE_SECRET,
    onShutdownRequested: () => {
      if (shutdownState.run) void shutdownState.run();
      else shutdownState.pending = true;
    },
    ...(eventPayloadSidecar ? { eventPayloadSidecar } : {}),
    daemonWorker,
    // The desktop client owns one visible embedded WebView. Chat browser tools
    // are bridged to that page; daemon workers keep the CDP fallback.
    useEmbeddedBrowser: !daemonWorker,
    demoProvider:
      process.env.SYNC_THINK_DISABLE_DEMO_PROVIDER === '1'
        ? undefined
        : new FakeProvider({ chunksPerWord: 2, tickMs: 35 }),
    discoveryByProtocol: buildDiscoveryByProtocol(),
  });
  await session.runtime.start();
  // The daemon uses this private IPC signal as the authoritative readiness
  // state. Named-pipe probing remains a compatibility fallback for older
  // Runtime processes that predate the signal.
  if (typeof process.send === 'function') {
    try {
      process.send(SUPERVISED_RUNTIME_READY_MESSAGE, () => undefined);
    } catch {
      // The parent may have already closed its IPC channel during shutdown.
    }
  }

  // worker 模式：执行指定任务后退出（跑完即退）。
  if (daemonWorker) {
    if (!daemonTaskId) {
      console.error('[worker] no SYNC_THINK_DAEMON_TASK_ID; exiting');
      await session.close();
      process.exit(1);
    }
    console.log(`[worker] executing task ${daemonTaskId}`);
    const result = await session.runtime.runDaemonTask(daemonTaskId);
    console.log(
      `[worker] task ${daemonTaskId} → ok=${result.ok}${result.reason ? ` reason=${result.reason}` : ''}`,
    );
    await session.close();
    process.exit(result.ok ? 0 : 1);
  }

  console.log('[runtime] started. installId=', installId, 'pid=', process.pid);
  console.log('[runtime] database ready', session.databasePath);
  console.log('[runtime] discovery: openai-compatible GET /models enabled');
  console.log(
    '[runtime] streaming: openai-chat + anthropic-messages live call via registered providers; fake fallback when no catalog',
  );

  let shuttingDown = false;
  shutdownState.run = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[runtime] shutting down');
    try {
      await session.close();
      process.exit(0);
    } catch (error) {
      console.error('[runtime] shutdown failed', error);
      process.exit(1);
    }
  };
  if (shutdownState.pending) void shutdownState.run();
  process.on('SIGINT', () => void shutdownState.run?.());
  process.on('SIGTERM', () => void shutdownState.run?.());
  process.on('message', (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'sync-think.runtime.shutdown'
    ) {
      void shutdownState.run?.();
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
