/**
 * Real codex end-to-end verification (Slice 4 acceptance).
 *
 * Spawns the locally installed codex-cli through CodexKernelAdapter with the
 * local login state (reuseLocalLogin), asks it to call the platform file tools
 * through MCP, then verifies the normalized tool stream, final answer and
 * usage. Not part of the test suite — run manually:
 *
 *   pnpm tsx apps/runtime/src/kernel/codex-e2e-verify.ts
 */
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KernelEvent } from '@sync-think/shared';
import { CodexKernelAdapter } from './codex-adapter.js';
import { startKernelMcpBroker } from './mcp-broker.js';
import { executePlatformTool, PLATFORM_MCP_TOOL_DEFINITIONS } from './platform-tools.js';
import { getKernelRegistry } from './registry.js';

const PERMISSION_MODE = (process.env.E2E_PERMISSION_MODE ?? 'full-access') as
  'full-access' | 'ask' | 'workspace';
const ISOLATE_USER_TOOLS = process.env.E2E_ISOLATE_USER_TOOLS !== '0';
const PROMPT =
  process.env.E2E_PROMPT ??
  'Use the sync-think-platform MCP file_write tool to create codex-hello.txt with content "hi from codex". Then use its file_read tool to read the file and reply with exactly the file content.';
// Empty by default: let codex use its own config.toml model (matches the user's
// relay + reasoning-effort settings). Set E2E_MODEL to force --model.
const MODEL = process.env.E2E_MODEL ?? '';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 180_000);
const MCP_SERVER_ENTRY = fileURLToPath(
  new URL('../../../mcp-server/platform-mcp-server.mjs', import.meta.url),
);

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
  const adapter = new CodexKernelAdapter(
    ISOLATE_USER_TOOLS
      ? {
          globalArgs: [
            '--disable',
            'plugins',
            '--disable',
            'apps',
            '-c',
            'mcp_servers.node_repl.enabled=false',
          ],
          execArgs: ['--ignore-rules'],
        }
      : {},
  );
  console.log(
    '[codex-e2e] invocation',
    JSON.stringify({
      permissionMode: PERMISSION_MODE,
      isolateUserTools: ISOLATE_USER_TOOLS,
    }),
  );
  const startedAt = Date.now();
  let exitInfo: { code: number | null; stderrTail: string } | undefined;
  adapter.onExit((code, stderrTail) => {
    exitInfo = { code, stderrTail };
  });

  const events: KernelEvent[] = [];
  const timer = setTimeout(() => {
    console.error('[codex-e2e] TIMEOUT — terminating');
    void adapter.cancel();
  }, TIMEOUT_MS);

  try {
    for await (const event of adapter.start({
      kernelId: 'codex',
      model: MODEL || 'codex-default',
      providerModelId: MODEL,
      userText: PROMPT,
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
      contextWindowSource: 'configured',
      credential: { reuseLocalLogin: true },
      systemContext: '## AGENTS.md\n\nReply tersely.',
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
    })) {
      events.push(event);
      if (event.type === 'session-started')
        console.log('[kernel-event] session-started', event.sessionId);
      if (event.type === 'reasoning')
        console.log('[kernel-event] reasoning', JSON.stringify(event.text));
      if (event.type === 'delta') console.log('[kernel-event] delta', JSON.stringify(event.text));
      if (event.type === 'tool-call') console.log('[kernel-event] tool-call', event.name);
      if (event.type === 'tool-result')
        console.log('[kernel-event] tool-result', event.output.slice(0, 160));
      if (event.type === 'usage') console.log('[kernel-event] usage', JSON.stringify(event.usage));
      if (event.type === 'terminal') break;
    }
  } catch (error) {
    console.error('[codex-e2e] adapter error:', error);
    clearTimeout(timer);
    await adapter.stop();
    await broker.close();
    console.log('KERNEL_FAILED');
    return 1;
  }
  clearTimeout(timer);

  await adapter.stop();
  await broker.close();
  const elapsedMs = Date.now() - startedAt;
  const terminal = events[events.length - 1];
  console.log('[codex-e2e] events', JSON.stringify(events, null, 0));
  console.log('[codex-e2e] exit', JSON.stringify(exitInfo));
  console.log('[codex-e2e] elapsedMs', elapsedMs);

  const finalText = events
    .filter((event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  const reasoningText = events
    .filter(
      (event): event is Extract<KernelEvent, { type: 'reasoning' }> =>
        event.type === 'reasoning',
    )
    .map((event) => event.text)
    .join('\n');
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
  const written = join(workspaceDir, 'codex-hello.txt');
  const fileContent = existsSync(written) ? readFileSync(written, 'utf8') : '';
  const ok =
    terminal?.type === 'terminal' &&
    terminal.status === 'completed' &&
    fileContent === 'hi from codex' &&
    finalText.includes('hi from codex') &&
    reasoningText.trim().length > 0 &&
    toolCalls.some((event) => event.name.includes('file_write')) &&
    toolCalls.some((event) => event.name.includes('file_read')) &&
    toolResults.length >= 2 &&
    toolResults.every((event) => !event.isError) &&
    Boolean(usage && usage.usage.real > 0) &&
    Boolean(session?.sessionId);
  console.log(
    '[codex-e2e] summary',
    JSON.stringify({
      sessionId: session?.sessionId,
      toolCalls: toolCalls.map((event) => event.name),
      toolResults: toolResults.length,
      usage: usage?.usage,
      finalText,
      reasoningText,
      fileContent,
    }),
  );
  if (ok && usage) {
    console.log(
      `KERNEL_OK usage=${usage.usage.real} input=${usage.usage.input} output=${usage.usage.output} cached=${usage.usage.cached} elapsedMs=${elapsedMs}`,
    );
    return 0;
  }
  console.log('KERNEL_FAILED', terminal?.type === 'terminal' ? terminal.error : 'no terminal');
  return 1;
}

process.exitCode = await main();
