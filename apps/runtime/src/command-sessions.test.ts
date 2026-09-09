import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isToolResultFailure } from '@sync-think/shared';
import { CommandSessionStore } from './command-sessions.js';
import { executeChatBuiltInTool, evaluateToolLoopGuard } from './chat-tools.js';

const roots: string[] = [];
const stores: CommandSessionStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.stopAll()));
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function sessionStore() {
  const store = new CommandSessionStore();
  stores.push(store);
  return store;
}

function scope() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-command-session-'));
  roots.push(root);
  return { threadId: 'thread-command-test', workspaceRoot: root };
}

describe('CommandSessionStore', () => {
  it('returns running after a bounded wait and completes on a later read', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const result = await store.start(
      commandScope,
      { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 160)'], waitMs: 20 },
      { runId: 'run-1', callId: 'call-1' },
    );
    expect(result).toMatchObject({ kind: 'command_session', status: 'running', ok: true });
    const completed = await store.read(commandScope, result.sessionId, 5_000);
    expect(completed).toMatchObject({ status: 'completed', ok: true, exitCode: 0 });
  });

  it('cancels an indefinitely running process and reports cancellation', async () => {
    const commandScope = scope();
    const store = sessionStore();
    const result = await store.start(
      commandScope,
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], background: true },
      { runId: 'run-2', callId: 'call-2' },
    );
    const stopped = await store.stop(commandScope, result.sessionId);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.ok).toBe(false);
  });

  it('retains the process across reads, rejects a different scope, and deduplicates launch calls', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const action = {
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      background: true,
    };
    const owner = { runId: 'run-existing', callId: 'same-call' };
    const first = await store.start(commandScope, action, owner);
    const repeated = await store.start(commandScope, action, owner);
    expect(repeated.sessionId).toBe(first.sessionId);
    for (let index = 0; index < 10; index++) {
      expect(await store.read(commandScope, first.sessionId, 10)).toMatchObject({
        status: 'running',
        ok: true,
      });
    }
    const foreign = { ...commandScope, threadId: 'other-thread' };
    expect(store.list(foreign)).toEqual([]);
    await expect(store.read(foreign, first.sessionId, 0)).rejects.toThrow('not found');
    await expect(store.stop(foreign, first.sessionId)).rejects.toThrow('not found');
    await expect(
      store.read({ ...commandScope, workspaceRoot: scope().workspaceRoot }, first.sessionId, 0),
    ).rejects.toThrow('not found');
    expect(store.list(commandScope)).toHaveLength(1);
    expect(store.list(commandScope)[0].status).toBe('running');
  });

  it('applies an explicit execution deadline and preserves real nonzero exits', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const deadline = await store.start(
      commandScope,
      {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 80,
        waitMs: 5_000,
      },
      { runId: 'run-errors', callId: 'deadline' },
    );
    expect(deadline).toMatchObject({ ok: false, status: 'timed_out', code: 'worker.timeout' });
    const failed = await store.start(
      commandScope,
      {
        command: process.execPath,
        args: ['-e', "process.stderr.write('expected failure'); process.exitCode = 7"],
        waitMs: 5_000,
      },
      { runId: 'run-errors', callId: 'exit' },
    );
    expect(failed).toMatchObject({
      ok: false,
      status: 'failed',
      exitCode: 7,
      stderr: 'expected failure',
    });
  });

  it('continues collecting new output after the capture cap and drains reads once', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const result = await store.start(
      commandScope,
      {
        command: process.execPath,
        args: [
          '-e',
          "process.stdout.write('x'.repeat(200000)); setTimeout(() => process.stdout.write('late-output'), 150)",
        ],
        waitMs: 5_000,
      },
      { runId: 'run-output', callId: 'large' },
    );
    expect(result).toMatchObject({ ok: true, status: 'completed', truncated: true });
    expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.stdout.endsWith('late-output')).toBe(true);
    expect(await store.read(commandScope, result.sessionId, 0)).toMatchObject({
      stdout: '',
      stderr: '',
      status: 'completed',
    });
  });

  it('cancels the owning run and rejects starts after shutdown', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const controller = new AbortController();
    const result = await store.start(
      commandScope,
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)'],
        waitMs: 700,
      },
      { runId: 'run-cancel', callId: 'pid', signal: controller.signal },
    );
    let pid = Number(result.stdout);
    await vi.waitFor(
      async () => {
        if (!pid) pid = Number((await store.read(commandScope, result.sessionId, 100)).stdout);
        expect(pid).toBeGreaterThan(0);
      },
      { timeout: 5_000 },
    );
    controller.abort();
    expect(await store.read(commandScope, result.sessionId, 5_000)).toMatchObject({
      status: 'cancelled',
    });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
    await store.stopAll();
    await expect(
      store.start(commandScope, { command: process.execPath }, { runId: 'late', callId: 'late' }),
    ).rejects.toThrow('stopped');
  });

  it('aborts one pending read without stopping a command started in an earlier turn', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const result = await store.start(
      commandScope,
      {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        background: true,
      },
      { runId: 'earlier-turn', callId: 'start' },
    );
    const controller = new AbortController();
    const reading = store.read(commandScope, result.sessionId, 5_000, controller.signal);
    const assertion = expect(reading).rejects.toThrow('cancelled');
    await expect(store.read(commandScope, result.sessionId, 0)).rejects.toThrow('already waiting');
    controller.abort();
    await assertion;
    expect(await store.read(commandScope, result.sessionId, 0)).toMatchObject({
      status: 'running',
    });
    await store.stopAll();
  });

  it('limits active commands without evicting a running session', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const action = {
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      background: true,
    };
    for (let index = 0; index < 8; index++) {
      await store.start(commandScope, action, { runId: 'run-capacity', callId: String(index) });
    }
    await expect(
      store.start(commandScope, action, { runId: 'run-capacity', callId: 'overflow' }),
    ).rejects.toThrow('capacity');
    expect(store.list(commandScope)).toHaveLength(8);
  });

  it('routes start, list, read, and stop through the production built-in tool executor', async () => {
    const store = sessionStore();
    const commandScope = scope();
    const call = async (name: string, args: object, runId = 'run-tools') =>
      JSON.parse(
        await executeChatBuiltInTool({
          ...commandScope,
          commandSessions: store,
          runId,
          toolCall: { id: `${runId}-${name}`, name, argumentsJson: JSON.stringify(args) },
        }),
      );
    const started = await call('run_command', {
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      background: true,
    });
    expect(started).toMatchObject({ ok: true, status: 'running' });
    expect((await call('list_commands', {}, 'next-turn')).sessions[0].sessionId).toBe(
      started.sessionId,
    );
    expect(
      await call('read_command', { sessionId: started.sessionId, waitMs: 0 }, 'next-turn'),
    ).toMatchObject({ ok: true, status: 'running' });
    const stopped = await call('stop_command', { sessionId: started.sessionId }, 'next-turn');
    expect(stopped).toMatchObject({ ok: true, session: { status: 'cancelled' } });
    expect(isToolResultFailure(stopped)).toBe(false);
    expect(
      await call('read_command', { sessionId: started.sessionId, waitMs: 'invalid' }),
    ).toMatchObject({ ok: false });
  });

  it('does not classify repeated live command waits as stagnant or exhausted work', () => {
    for (let round = 1; round <= 20; round++) {
      const result = evaluateToolLoopGuard({
        toolLoopRound: round,
        maxToolRounds: 8,
        stagnantRounds: round,
        completedResults: [
          { toolCallId: 'read', content: '{"ok":true,"status":"running"}', pendingCommand: true },
        ],
      });
      expect(result).toMatchObject({ kind: 'continue', stagnantRounds: 0, failedCount: 0 });
    }
    expect(
      evaluateToolLoopGuard({
        toolLoopRound: 8,
        maxToolRounds: 8,
        completedResults: [{ toolCallId: 'other-tool', content: '{"ok":true}' }],
      }).kind,
    ).toBe('force_final');
  });
});
