import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandSessionStore } from '../apps/runtime/dist/command-sessions.js';

const durationMs = Number(process.argv[2] ?? 125_000);
assert(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= 600_000);
const root = await mkdtemp(join(tmpdir(), 'sync-think-long-command-'));
const scope = { threadId: 'long-command-selftest', workspaceRoot: root };
const sessions = new CommandSessionStore();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), durationMs + 30_000);
const startedAt = Date.now();
try {
  let result = await sessions.start(
    scope,
    {
      command: process.execPath,
      args: ['-e', `setTimeout(() => {}, ${durationMs})`],
      waitMs: Math.min(1_000, Math.floor(durationMs / 2)),
    },
    { runId: 'long-command-run', callId: 'silent-sleep', signal: controller.signal },
  );
  assert.equal(result.status, 'running');
  const sessionId = result.sessionId;
  do {
    console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, status: result.status }));
    result = await sessions.read(scope, sessionId, 30_000, controller.signal);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(result.ok, true);
  } while (result.status === 'running');
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert(Date.now() - startedAt >= durationMs);
  console.log(
    JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      status: result.status,
      exitCode: result.exitCode,
    }),
  );
} finally {
  clearTimeout(timer);
  await sessions.stopAll();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
