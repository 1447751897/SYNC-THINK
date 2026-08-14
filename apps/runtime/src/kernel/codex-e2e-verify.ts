/**
 * Real codex end-to-end verification (Slice 4 acceptance).
 *
 * Spawns the locally installed codex-cli through CodexKernelAdapter with the
 * local login state (reuseLocalLogin) and a short prompt, then prints the
 * normalized event stream + usage. Not part of the test suite — run manually:
 *
 *   pnpm tsx apps/runtime/src/kernel/codex-e2e-verify.ts
 */
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { KernelEvent } from '@sync-think/shared';
import { CodexKernelAdapter } from './codex-adapter.js';
import { getKernelRegistry } from './registry.js';

const PERMISSION_MODE = (process.env.E2E_PERMISSION_MODE ?? 'workspace') as
  | 'full-access'
  | 'ask'
  | 'workspace';
const PROMPT = process.env.E2E_PROMPT ?? 'Reply with exactly the word OK and nothing else.';
// Empty by default: let codex use its own config.toml model (matches the user's
// relay + reasoning-effort settings). Set E2E_MODEL to force --model.
const MODEL = process.env.E2E_MODEL ?? '';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 180_000);

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
  const adapter = new CodexKernelAdapter();
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
      credential: { reuseLocalLogin: true },
      systemContext: '## AGENTS.md\n\nReply tersely.',
      platformTools: [],
      permissionMode: PERMISSION_MODE,
      workspaceDir,
    })) {
      events.push(event);
      if (event.type === 'terminal') break;
    }
  } catch (error) {
    console.error('[codex-e2e] adapter error:', error);
    clearTimeout(timer);
    console.log('KERNEL_FAILED');
    return 1;
  }
  clearTimeout(timer);

  const elapsedMs = Date.now() - startedAt;
  const terminal = events[events.length - 1];
  console.log('[codex-e2e] events', JSON.stringify(events, null, 0));
  console.log('[codex-e2e] exit', JSON.stringify(exitInfo));
  console.log('[codex-e2e] elapsedMs', elapsedMs);

  const usage = events.find((event) => event.type === 'usage');
  if (terminal?.type === 'terminal' && terminal.status === 'completed' && usage?.type === 'usage') {
    console.log(
      `KERNEL_OK usage=${usage.usage.real} input=${usage.usage.input} output=${usage.usage.output} cached=${usage.usage.cached} elapsedMs=${elapsedMs}`,
    );
    return 0;
  }
  console.log('KERNEL_FAILED', terminal?.type === 'terminal' ? terminal.error : 'no terminal');
  return 1;
}

process.exitCode = await main();
