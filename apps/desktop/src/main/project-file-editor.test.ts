import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readProjectFile,
  watchProjectFile,
  writeProjectFile,
  type ProjectFileChange,
} from './project-file-editor.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(prefix = 'sync-think-file-editor-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for file change');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('project file editor service', () => {
  it('reads UTF-8 text with the metadata required for optimistic saves', async () => {
    const root = fixture();
    writeFileSync(join(root, 'notes.txt'), 'before', 'utf8');

    const result = await readProjectFile({ root, path: 'notes.txt' });

    expect(result).toMatchObject({
      path: 'notes.txt',
      content: 'before',
      error: null,
      errorCode: null,
      size: 6,
    });
    expect(result.mtimeMs).toEqual(expect.any(Number));
  });

  it('rejects a stale save, then replaces atomically after an explicit overwrite', async () => {
    const root = fixture();
    const target = join(root, 'notes.txt');
    writeFileSync(target, 'before', 'utf8');
    const initial = await readProjectFile({ root, path: 'notes.txt' });

    writeFileSync(target, 'changed outside', 'utf8');
    const changedAt = new Date(Date.now() + 2_000);
    utimesSync(target, changedAt, changedAt);

    const conflict = await writeProjectFile({
      root,
      path: 'notes.txt',
      content: 'draft',
      expectedMtimeMs: initial.mtimeMs,
      expectedSize: initial.size,
    });
    expect(conflict).toMatchObject({
      ok: false,
      conflict: true,
      errorCode: 'file_conflict',
    });
    expect(readFileSync(target, 'utf8')).toBe('changed outside');

    const saved = await writeProjectFile({
      root,
      path: 'notes.txt',
      content: 'draft',
      expectedMtimeMs: initial.mtimeMs,
      expectedSize: initial.size,
      force: true,
    });
    expect(saved).toMatchObject({
      path: 'notes.txt',
      ok: true,
      conflict: false,
      error: null,
      errorCode: null,
      size: 5,
    });
    expect(saved.mtimeMs).toEqual(expect.any(Number));
    expect(readFileSync(target, 'utf8')).toBe('draft');
    expect(readdirSync(root).filter((name) => name.endsWith('.sync-think.tmp'))).toEqual([]);
  });

  it('rejects traversal, absolute paths, and junctions that escape the workspace root', async () => {
    const root = fixture();
    const outside = fixture('sync-think-file-editor-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside', 'utf8');
    symlinkSync(outside, join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readProjectFile({ root, path: '../secret.txt' })).rejects.toThrow(
      'security.path_traversal',
    );
    await expect(readProjectFile({ root, path: join(root, 'absolute.txt') })).rejects.toThrow(
      'security.path_traversal',
    );
    await expect(readProjectFile({ root, path: 'escaped/secret.txt' })).rejects.toThrow(
      'security.path_traversal',
    );
  });

  it('falls back to polling and emits one debounced metadata change', async () => {
    const root = fixture();
    const target = join(root, 'notes.txt');
    writeFileSync(target, 'before', 'utf8');
    const changes: ProjectFileChange[] = [];

    const dispose = await watchProjectFile(
      { root, path: 'notes.txt' },
      (change) => changes.push(change),
      {
        debounceMs: 5,
        pollIntervalMs: 20,
        watchFactory: () => {
          throw new Error('watch unavailable');
        },
      },
    );
    try {
      writeFileSync(target, 'changed outside', 'utf8');
      const changedAt = new Date(Date.now() + 2_000);
      utimesSync(target, changedAt, changedAt);
      await waitFor(() => changes.length > 0);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: 'notes.txt',
        exists: true,
        size: 15,
      });
      expect(changes[0]?.mtimeMs).toEqual(expect.any(Number));
    } finally {
      dispose();
    }
  });
});
