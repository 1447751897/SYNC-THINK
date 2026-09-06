/**
 * Real Codex persistent-session verification.
 *
 * Uses the locally installed codex-cli and login state to verify three public
 * lifecycle guarantees:
 *   1. a first turn can stream MCP tools, usage and a final answer;
 *   2. a second turn reuses the same app-server process and native thread;
 *   3. a fresh app-server process can resume that native thread.
 *
 * Not part of the hermetic test suite. Run manually:
 *
 *   pnpm selftest:codex-persistent
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { CodexAppServerKernelAdapter } from './codex-app-server-adapter.js';
import { startKernelMcpBroker } from './mcp-broker.js';
import { executePlatformTool, PLATFORM_MCP_TOOL_DEFINITIONS } from './platform-tools.js';
import { startKernelProcess } from './process.js';
import { getKernelRegistry } from './registry.js';
import { evaluateCodexVerification } from './codex-verification.js';

const PERMISSION_MODE = (process.env.E2E_PERMISSION_MODE ?? 'full-access') as
  'full-access' | 'ask' | 'workspace';
const CUSTOM_FIRST_PROMPT = process.env.E2E_PROMPT?.trim() || undefined;
const MODEL = process.env.E2E_MODEL?.trim() ?? '';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 300_000);
const REQUIRE_REASONING = process.env.E2E_EXPECT_REASONING === '1';
const MEMORY_TOKEN =
  process.env.E2E_MEMORY_TOKEN?.trim() ||
  `st-memory-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const FILE_CONTENT = 'hi from codex';
const MCP_SERVER_ENTRY = fileURLToPath(
  new URL('../../../mcp-server/platform-mcp-server.mjs', import.meta.url),
);

type Phase = 'turn-1' | 'turn-2-same-process' | 'turn-3-new-process';

function finalText(events: readonly KernelEvent[]): string {
  return events
    .filter((event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
}

function sessionId(events: readonly KernelEvent[]): string | undefined {
  return events.find(
    (event): event is Extract<KernelEvent, { type: 'session-started' }> =>
      event.type === 'session-started',
  )?.sessionId;
}

function summarize(events: readonly KernelEvent[]): Record<string, unknown> {
  const usage = events
    .filter((event): event is Extract<KernelEvent, { type: 'usage' }> => event.type === 'usage')
    .at(-1);
  return {
    sessionId: sessionId(events),
    terminal: events.at(-1),
    finalText: finalText(events),
    toolCalls: events
      .filter(
        (event): event is Extract<KernelEvent, { type: 'tool-call' }> => event.type === 'tool-call',
      )
      .map((event) => event.name),
    toolResults: events.filter((event) => event.type === 'tool-result').length,
    usage: usage?.usage,
  };
}

async function runTurn(
  adapter: CodexAppServerKernelAdapter,
  phase: Phase,
  request: KernelRequest,
): Promise<KernelEvent[]> {
  const events: KernelEvent[] = [];
  for await (const event of adapter.start(request)) {
    events.push(event);
    if (event.type === 'session-started')
      console.log(`[${phase}] session-started`, event.sessionId);
    if (event.type === 'reasoning') console.log(`[${phase}] reasoning`, JSON.stringify(event.text));
    if (event.type === 'delta') console.log(`[${phase}] delta`, JSON.stringify(event.text));
    if (event.type === 'tool-call') console.log(`[${phase}] tool-call`, event.name);
    if (event.type === 'tool-result')
      console.log(`[${phase}] tool-result`, event.output.slice(0, 160));
    if (event.type === 'usage') console.log(`[${phase}] usage`, JSON.stringify(event.usage));
    if (event.type === 'terminal') break;
  }
  return events;
}

async function main(): Promise<number> {
  const registry = getKernelRegistry();
  const codexEntry = registry.find((entry) => entry.id === 'codex')!;
  const detection = await codexEntry.detect();
  console.log('[codex-e2e] detection', JSON.stringify(detection));
  if (!detection.installed || !detection.version) {
    console.log('KERNEL_NOT_INSTALLED');
    return 2;
  }

  const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-codex-e2e-'));
  const broker = await startKernelMcpBroker({
    workspaceDir,
    tools: PLATFORM_MCP_TOOL_DEFINITIONS,
    onToolCall: async (call) => {
      console.log('[broker] tool-call', call.tool, JSON.stringify(call.input));
      try {
        return {
          ok: true,
          content: await executePlatformTool(call.tool, call.input, {
            workspaceDir,
            kernelId: 'codex',
          }),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  const spawnPids: number[] = [];
  const adapters = new Set<CodexAppServerKernelAdapter>();
  let activeAdapter: CodexAppServerKernelAdapter | undefined;
  let timedOut = false;
  const createAdapter = (): CodexAppServerKernelAdapter => {
    const adapter = new CodexAppServerKernelAdapter({
      spawn: (args, env, cwd) => {
        const handle = startKernelProcess({ command: 'codex', args, cwd, env });
        if (handle.child.pid) spawnPids.push(handle.child.pid);
        return handle;
      },
    });
    adapter.onExit((code, stderrTail) => {
      console.log('[codex-e2e] app-server-exit', JSON.stringify({ code, stderrTail }));
    });
    adapters.add(adapter);
    return adapter;
  };
  const baseRequest: Omit<KernelRequest, 'userText' | 'session'> = {
    kernelId: 'codex',
    model: MODEL || 'codex-default',
    providerModelId: MODEL,
    contextWindow: 128_000,
    effectiveContextWindow: 128_000,
    contextWindowSource: 'configured',
    credential: { reuseLocalLogin: true },
    systemContext: '## AGENTS.md\n\nReply tersely and follow the requested output format.',
    platformTools: [],
    platformBroker: {
      host: broker.host,
      port: broker.port,
      token: broker.token,
      workspaceDir,
      command: process.execPath,
      args: [MCP_SERVER_ENTRY],
    },
    permissionMode: PERMISSION_MODE,
    workspaceDir,
  };
  const firstPrompt = `${
    CUSTOM_FIRST_PROMPT ??
    `Use the sync-think-platform MCP file_write tool to create codex-hello.txt with content "${FILE_CONTENT}". Then use its file_read tool to read the file and reply with exactly the file content.`
  }\n\nRemember this opaque token for later turns: ${MEMORY_TOKEN}. Do not write the token to a file.`;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error('[codex-e2e] TIMEOUT - interrupting active turn');
    void activeAdapter?.cancel();
  }, TIMEOUT_MS);

  try {
    console.log(
      '[codex-e2e] invocation',
      JSON.stringify({ permissionMode: PERMISSION_MODE, model: MODEL || '(app-server default)' }),
    );
    const startedAt = Date.now();
    const firstAdapter = createAdapter();
    activeAdapter = firstAdapter;
    const first = await runTurn(firstAdapter, 'turn-1', {
      ...baseRequest,
      userText: firstPrompt,
      session: { mode: 'create' },
    });
    const nativeThreadId = sessionId(first);
    if (!nativeThreadId) throw new Error('first turn did not report a native thread id');

    const second = await runTurn(firstAdapter, 'turn-2-same-process', {
      ...baseRequest,
      userText:
        'Without using any tool, reply with exactly the opaque memory token from my previous message.',
      session: { id: nativeThreadId, mode: 'resume' },
    });
    const sameProcessSpawnCount = spawnPids.length;

    await firstAdapter.stop();
    activeAdapter = undefined;
    const resumedAdapter = createAdapter();
    activeAdapter = resumedAdapter;
    const third = await runTurn(resumedAdapter, 'turn-3-new-process', {
      ...baseRequest,
      userText:
        'The app-server process was restarted. Without using any tool, reply with exactly the opaque memory token from the first turn.',
      session: { id: nativeThreadId, mode: 'resume' },
    });
    if (timedOut) throw new Error(`persistent-session verification exceeded ${TIMEOUT_MS}ms`);

    const written = join(workspaceDir, 'codex-hello.txt');
    const fileContent = existsSync(written) ? readFileSync(written, 'utf8') : '';
    const firstToolCalls = first.filter(
      (event): event is Extract<KernelEvent, { type: 'tool-call' }> => event.type === 'tool-call',
    );
    const firstToolResults = first.filter(
      (event): event is Extract<KernelEvent, { type: 'tool-result' }> =>
        event.type === 'tool-result',
    );
    const toolFlowOk = CUSTOM_FIRST_PROMPT
      ? undefined
      : fileContent === FILE_CONTENT &&
        finalText(first).includes(FILE_CONTENT) &&
        firstToolCalls.some((event) => event.name.includes('file_write')) &&
        firstToolCalls.some((event) => event.name.includes('file_read')) &&
        firstToolResults.length >= 2 &&
        firstToolResults.every((event) => !event.isError);
    const verdict = evaluateCodexVerification({
      first,
      second,
      third,
      memoryToken: MEMORY_TOKEN,
      spawnPids,
      sameProcessSpawnCount,
      toolFlow: toolFlowOk,
      requireReasoning: REQUIRE_REASONING,
    });

    console.log(
      '[codex-e2e] summary',
      JSON.stringify({
        nativeThreadId,
        spawnPids,
        sameProcessSpawnCount,
        elapsedMs: Date.now() - startedAt,
        fileContent,
        verification: verdict,
        turns: {
          first: summarize(first),
          second: summarize(second),
          third: summarize(third),
        },
      }),
    );
    if (verdict.ok) {
      console.log(
        `KERNEL_PERSISTENCE_OK thread=${nativeThreadId} processes=${spawnPids.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return 0;
    }
    console.log('KERNEL_PERSISTENCE_FAILED', verdict.failures.join(', '));
    return 1;
  } catch (error) {
    console.error('[codex-e2e] adapter error:', error);
    console.log('KERNEL_PERSISTENCE_FAILED');
    return 1;
  } finally {
    clearTimeout(timer);
    await Promise.allSettled([...adapters].map((adapter) => adapter.stop()));
    await broker.close();
  }
}

process.exitCode = await main();
