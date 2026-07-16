import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import { GitProcessWorker } from './git-worker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-git-worker-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'sync-think@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SYNC-THINK Test'], { cwd: root });
  writeFileSync(join(root, 'tracked.txt'), 'before\n', 'utf8');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root });
  writeFileSync(join(root, 'tracked.txt'), 'after\n', 'utf8');
  return root;
}

describe('GitProcessWorker', () => {
  it('returns real status and diff using fixed git argv', async () => {
    const root = repository();
    const worker = new GitProcessWorker();
    const token = { token: 'git-token', allowedRoot: root, timeoutMs: 15_000 };

    const status = await collect(
      worker.exec({ workingDir: root, action: { cmd: 'status' } }, token),
    );
    expect(status.at(-1)).toMatchObject({ type: 'completed', output: { ok: true, exitCode: 0 } });
    expect(JSON.stringify(status.at(-1))).toContain('tracked.txt');

    const diff = await collect(
      worker.exec({ workingDir: root, action: { cmd: 'diff', relative: 'tracked.txt' } }, token),
    );
    expect(diff.at(-1)).toMatchObject({ type: 'completed', output: { ok: true, exitCode: 0 } });
    expect(JSON.stringify(diff.at(-1))).toContain('-before');
    expect(JSON.stringify(diff.at(-1))).toContain('+after');
  }, 30_000);

  it('rejects path escape and supports cancellation before spawn', async () => {
    const root = repository();
    const worker = new GitProcessWorker();
    const escaped = await collect(
      worker.exec(
        { workingDir: root, action: { cmd: 'diff', relative: '../outside.txt' } },
        { token: 'git-token', allowedRoot: root, timeoutMs: 15_000 },
      ),
    );
    expect(escaped.at(-1)).toMatchObject({ type: 'failed', failureClass: 'permission' });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await collect(
      worker.exec(
        { workingDir: root, action: { cmd: 'status' } },
        {
          token: 'git-token',
          allowedRoot: root,
          timeoutMs: 15_000,
          signal: controller.signal,
        },
      ),
    );
    expect(cancelled.at(-1)).toMatchObject({ type: 'failed', error: { code: 'worker.aborted' } });
  }, 30_000);

  it('rejects a path whose directory link resolves outside the workspace', async () => {
    const root = repository();
    const outside = mkdtempSync(join(tmpdir(), 'sync-think-git-worker-outside-'));
    roots.push(outside);
    writeFileSync(join(outside, 'outside.txt'), 'outside\n', 'utf8');
    symlinkSync(outside, join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');

    const events = await collect(
      new GitProcessWorker().exec(
        { workingDir: root, action: { cmd: 'diff', relative: 'escaped/outside.txt' } },
        { token: 'git-token', allowedRoot: root, timeoutMs: 15_000 },
      ),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'security.path_traversal' },
    });
  }, 30_000);
});
