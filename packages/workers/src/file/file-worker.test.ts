import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import { FileSystemWorker } from './file-worker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-file-worker-'));
  roots.push(root);
  return root;
}

describe('FileSystemWorker', () => {
  it('reads, lists, and writes only inside the allowed workspace root', async () => {
    const root = fixture();
    writeFileSync(join(root, 'input.txt'), 'workspace input', 'utf8');
    const worker = new FileSystemWorker();
    const token = { token: 'file-token', allowedRoot: root, timeoutMs: 1_000 };

    const readEvents = await collect(
      worker.exec({ workingDir: root, action: { kind: 'read', relative: 'input.txt' } }, token),
    );
    expect(readEvents.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, content: 'workspace input' },
    });

    const listEvents = await collect(
      worker.exec({ workingDir: root, action: { kind: 'list', relative: '.' } }, token),
    );
    expect(listEvents.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, entries: ['input.txt'] },
    });

    const writeEvents = await collect(
      worker.exec(
        {
          workingDir: root,
          action: { kind: 'write', relative: 'nested/output.txt', content: 'written' },
        },
        token,
      ),
    );
    expect(writeEvents.at(-1)).toMatchObject({ type: 'completed', output: { ok: true } });
    expect(readFileSync(join(root, 'nested', 'output.txt'), 'utf8')).toBe('written');
  });

  it('rejects traversal and absolute paths before filesystem access', async () => {
    const root = fixture();
    const worker = new FileSystemWorker();
    const token = { token: 'file-token', allowedRoot: root, timeoutMs: 1_000 };

    for (const relative of ['../escape.txt', join(root, 'absolute.txt')]) {
      const events = await collect(
        worker.exec({ workingDir: root, action: { kind: 'read', relative } }, token),
      );
      expect(events.at(-1)).toMatchObject({
        type: 'failed',
        failureClass: 'permission',
        error: { code: 'security.path_traversal' },
      });
    }
  });

  it('enforces cancellation, the start fence, and bounded output', async () => {
    const root = fixture();
    writeFileSync(join(root, 'large.txt'), 'x'.repeat(128), 'utf8');
    const worker = new FileSystemWorker();
    const controller = new AbortController();
    controller.abort();

    const cancelled = await collect(
      worker.exec(
        { workingDir: root, action: { kind: 'read', relative: 'large.txt' } },
        {
          token: 'file-token',
          allowedRoot: root,
          timeoutMs: 1_000,
          signal: controller.signal,
        },
      ),
    );
    expect(cancelled.at(-1)).toMatchObject({ type: 'failed', error: { code: 'worker.aborted' } });

    const fenced = await collect(
      worker.exec(
        { workingDir: root, action: { kind: 'read', relative: 'large.txt' } },
        {
          token: 'file-token',
          allowedRoot: root,
          timeoutMs: 1_000,
          beforeStart: () => false,
        },
      ),
    );
    expect(fenced.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'worker.fence-rejected' },
    });

    const bounded = await collect(
      worker.exec(
        { workingDir: root, action: { kind: 'read', relative: 'large.txt' } },
        {
          token: 'file-token',
          allowedRoot: root,
          timeoutMs: 1_000,
          maxOutputBytes: 32,
        },
      ),
    );
    expect(bounded.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'acceptance',
      error: { code: 'worker.output-limit' },
    });
  });

  it('does not expose irreversible delete through the real worker', async () => {
    const root = fixture();
    writeFileSync(join(root, 'keep.txt'), 'keep', 'utf8');
    const events = await collect(
      new FileSystemWorker().exec(
        { workingDir: root, action: { kind: 'delete', relative: 'keep.txt' } },
        { token: 'file-token', allowedRoot: root, timeoutMs: 1_000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'failed', failureClass: 'permission' });
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('keep');
  });
});
