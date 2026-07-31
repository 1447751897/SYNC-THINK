import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import { TerminalProcessWorker } from './terminal-worker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-terminal-worker-'));
  roots.push(root);
  return root;
}

describe('TerminalProcessWorker', () => {
  it('emits stdout before a long-running process exits', async () => {
    const root = fixture();
    const controller = new AbortController();
    const events = new TerminalProcessWorker().exec(
        {
          workingDir: root,
          action: {
            command: process.execPath,
            args: [
              '-e',
              "process.stdout.write('first'); setTimeout(() => process.stdout.write('second'), 2500)",
            ],
          },
        },
        {
          token: 'terminal-stream-token',
          allowedRoot: root,
          allowedCommands: [process.execPath],
          timeoutMs: 10_000,
          maxOutputBytes: 1_024,
          signal: controller.signal,
        },
      );
    const iterator = events[Symbol.asyncIterator]();

    const first = await Promise.race([
      iterator.next(),
      new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), 4000),
      ),
    ]);

    if ('timeout' in first) {
      controller.abort();
      await iterator.return?.();
    }
    expect(first).not.toEqual({ timeout: true });
    expect('timeout' in first ? undefined : first.value).toEqual({ type: 'stdout', text: 'first' });

    const remaining = [];
    if (!('timeout' in first)) {
      for (;;) {
        const event = await iterator.next();
        if (event.done) break;
        remaining.push(event.value);
      }
    }
    expect(remaining).toEqual([
      { type: 'stdout', text: 'second' },
      expect.objectContaining({ type: 'completed' }),
    ]);
  }, 10_000);

  it('kills the spawned process tree when the event consumer closes early', async () => {
    const root = fixture();
    const events = new TerminalProcessWorker().exec(
        {
          workingDir: root,
          action: {
            command: process.execPath,
            args: [
              '-e',
              [
                "const { spawn } = require('node:child_process')",
                "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
                'process.stdout.write(String(child.pid))',
                'setInterval(() => {}, 1000)',
              ].join(';'),
            ],
          },
        },
        {
          token: 'terminal-tree-token',
          allowedRoot: root,
          allowedCommands: [process.execPath],
          timeoutMs: 15_000,
          maxOutputBytes: 1_024,
        },
      );
    const iterator = events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: 'stdout' });
    const childPid = Number(first.value && 'text' in first.value ? first.value.text : '');
    expect(Number.isInteger(childPid)).toBe(true);
    await iterator.return?.();

    await expectProcessToExit(childPid);
  }, 20_000);

  it('decodes a multibyte character split across streamed process chunks', async () => {
    const root = fixture();
    const events = await collect(
      new TerminalProcessWorker().exec(
        {
          workingDir: root,
          action: {
            command: process.execPath,
            args: [
              '-e',
              "const bytes=Buffer.from('\\u4f60'); process.stdout.write(bytes.subarray(0,1)); setTimeout(() => process.stdout.write(bytes.subarray(1)), 200)",
            ],
          },
        },
        {
          token: 'terminal-utf8-token',
          allowedRoot: root,
          allowedCommands: [process.execPath],
          timeoutMs: 5_000,
          maxOutputBytes: 1_024,
        },
      ),
    );

    expect(
      events
        .filter((event) => event.type === 'stdout')
        .map((event) => event.text)
        .join(''),
    ).toBe('\u4f60');
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      output: { stdout: '\u4f60' },
    });
  }, 10_000);

  it('spawns an allowlisted executable without a shell and captures bounded output', async () => {
    const root = fixture();
    const events = await collect(
      new TerminalProcessWorker().exec(
        {
          workingDir: root,
          action: {
            command: process.execPath,
            args: ['-e', "process.stdout.write('terminal-ok')"],
          },
        },
        {
          token: 'terminal-token',
          allowedRoot: root,
          allowedCommands: [process.execPath],
          timeoutMs: 15_000,
          maxOutputBytes: 1_024,
        },
      ),
    );

    expect(events.some((event) => event.type === 'stdout' && event.text === 'terminal-ok')).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, exitCode: 0, stdout: 'terminal-ok', shell: false },
    });
  }, 20_000);

  it('rejects a cwd outside the workspace and commands outside the token allowlist', async () => {
    const root = fixture();
    const worker = new TerminalProcessWorker();
    const token = {
      token: 'terminal-token',
      allowedRoot: root,
      allowedCommands: [process.execPath],
      timeoutMs: 1_000,
    };

    const escaped = await collect(
      worker.exec(
        {
          workingDir: root,
          action: { command: process.execPath, args: ['--version'], cwd: '..' },
        },
        token,
      ),
    );
    expect(escaped.at(-1)).toMatchObject({ type: 'failed', failureClass: 'permission' });

    const denied = await collect(
      worker.exec(
        { workingDir: root, action: { command: 'cmd.exe', args: ['/c', 'echo unsafe'] } },
        token,
      ),
    );
    expect(denied.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'worker.command-denied' },
    });
  });

  it('rejects a cwd whose directory link resolves outside the workspace', async () => {
    const root = fixture();
    const outside = fixture();
    symlinkSync(outside, join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');

    const events = await collect(
      new TerminalProcessWorker().exec(
        {
          workingDir: root,
          action: { command: process.execPath, args: ['--version'], cwd: 'escaped' },
        },
        {
          token: 'terminal-token',
          allowedRoot: root,
          allowedCommands: [process.execPath],
          timeoutMs: 2_000,
        },
      ),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'security.path_traversal' },
    });
  });

  it('terminates on timeout or cancellation and reports output truncation', async () => {
    const root = fixture();
    const worker = new TerminalProcessWorker();
    const baseToken = {
      token: 'terminal-token',
      allowedRoot: root,
      allowedCommands: [process.execPath],
      maxOutputBytes: 32,
    };

    const bounded = await collect(
      worker.exec(
        {
          workingDir: root,
          action: {
            command: process.execPath,
            args: ['-e', "process.stdout.write('x'.repeat(128))"],
          },
        },
        { ...baseToken, timeoutMs: 15_000 },
      ),
    );
    expect(bounded.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, truncated: true, stdout: 'x'.repeat(32) },
    });

    const timedOut = await collect(
      worker.exec(
        {
          workingDir: root,
          action: { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 5000)'] },
        },
        { ...baseToken, timeoutMs: 50 },
      ),
    );
    expect(timedOut.at(-1)).toMatchObject({ type: 'failed', failureClass: 'timeout' });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);
    const cancelled = await collect(
      worker.exec(
        {
          workingDir: root,
          action: { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 5000)'] },
        },
        { ...baseToken, timeoutMs: 15_000, signal: controller.signal },
      ),
    );
    expect(cancelled.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'worker.aborted' },
    });
  }, 20_000);

  it.runIf(process.platform === 'win32')(
    'runs an explicitly approved cmd shim with strict metacharacter rejection',
    async () => {
      const root = fixture();
      const shim = join(root, 'safe-tool.cmd');
      writeFileSync(shim, '@echo off\r\necho shim-%1\r\n', 'utf8');
      const worker = new TerminalProcessWorker();
      const token = {
        token: 'terminal-token',
        allowedRoot: root,
        allowedCommands: [shim],
        timeoutMs: 2_000,
      };
      const safe = await collect(
        worker.exec({ workingDir: root, action: { command: shim, args: ['ok'] } }, token),
      );
      expect(safe.at(-1)).toMatchObject({ type: 'completed', output: { ok: true, shell: false } });
      expect(JSON.stringify(safe)).toContain('shim-ok');

      const injected = await collect(
        worker.exec(
          { workingDir: root, action: { command: shim, args: ['ok&echo injected'] } },
          token,
        ),
      );
      expect(injected.at(-1)).toMatchObject({
        type: 'failed',
        error: { code: 'worker.spawn-failed' },
      });
    },
  );
});

async function expectProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Process exited between the final probe and cleanup.
  }
  throw new Error(`child process ${pid} remained alive after terminal cancellation`);
}
