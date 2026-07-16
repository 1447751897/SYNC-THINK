import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import { TerminalProcessWorker } from './terminal-worker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-terminal-worker-'));
  roots.push(root);
  return root;
}

describe('TerminalProcessWorker', () => {
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
