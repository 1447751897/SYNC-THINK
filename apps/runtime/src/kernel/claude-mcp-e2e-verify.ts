/**
 * Real Claude Code + platform MCP channel verification (Slice 5 acceptance).
 *
 * Spawns the locally installed claude through ClaudeCodeKernelAdapter with the
 * platform broker wired, asks CC to call the host file tools over MCP, and
 * prints the normalized events. The permission bridge auto-approves (CC's own
 * tool calls); the platform MCP tool calls execute in-process.
 *
 *   pnpm tsx apps/runtime/src/kernel/claude-mcp-e2e-verify.ts
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KernelEvent } from '@sync-think/shared';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { startKernelMcpBroker } from './mcp-broker.js';
import { executePlatformTool, PLATFORM_MCP_TOOL_DEFINITIONS } from './platform-tools.js';

const PROMPT =
  process.env.E2E_PROMPT ??
  'Use the platform tool mcp__sync-think-platform__file_write to create a file cc-hello.txt with content "hi from cc". Then use mcp__sync-think-platform__file_read to read it back and reply with the file content.';
const MODEL = process.env.E2E_MODEL ?? 'claude-opus-5';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 240_000);
const MCP_SERVER_ENTRY = fileURLToPath(
  new URL('../../../mcp-server/platform-mcp-server.mjs', import.meta.url),
);

async function main(): Promise<number> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-cc-mcp-e2e-'));
  const broker = await startKernelMcpBroker({
    workspaceDir,
    tools: PLATFORM_MCP_TOOL_DEFINITIONS,
    onToolCall: async (call) => {
      console.log('[broker] tool-call', call.tool, JSON.stringify(call.input));
      try {
        return { ok: true, content: await executePlatformTool(call.tool, call.input, { workspaceDir }) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  const adapter = new ClaudeCodeKernelAdapter();
  adapter.onPermissionRequest((request) => {
    console.log('[cc] permission request', request.toolName, request.requestId);
    setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
  });
  adapter.onExit((code, stderrTail) => {
    console.log('[cc] process exit', code, 'stderrTail:', JSON.stringify(stderrTail.slice(-600)));
  });

  const events: KernelEvent[] = [];
  const timer = setTimeout(() => {
    console.error('[cc-mcp-e2e] TIMEOUT — terminating');
    void adapter.cancel();
  }, TIMEOUT_MS);

  try {
    for await (const event of adapter.start({
      kernelId: 'claude-code',
      model: MODEL,
      providerModelId: MODEL,
      userText: PROMPT,
      contextWindow: 200_000,
      credential: { reuseLocalLogin: true },
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
      if (event.type === 'tool-call') console.log('[kernel-event] tool-call', event.name);
      if (event.type === 'tool-result') console.log('[kernel-event] tool-result', event.name);
      if (event.type === 'terminal') {
        console.log('[kernel-event] terminal', event.status, event.error ?? '');
        break;
      }
    }
  } catch (error) {
    console.error('[cc-mcp-e2e] adapter error:', error);
  }
  clearTimeout(timer);

  const written = join(workspaceDir, 'cc-hello.txt');
  console.log('[cc-mcp-e2e] file written?', existsSync(written));
  if (existsSync(written)) console.log('[cc-mcp-e2e] file content:', readFileSync(written, 'utf8'));

  await adapter.stop();
  await broker.close();
  const terminal = events[events.length - 1];
  const ok = terminal?.type === 'terminal' && terminal.status === 'completed' && existsSync(written);
  console.log(ok ? 'CC_MCP_OK' : 'CC_MCP_FAILED');
  return ok ? 0 : 1;
}

process.exitCode = await main();
