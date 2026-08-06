import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import { FileSystemWorker, globToRegExp } from './file-worker.js';

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

  it('globToRegExp supports **, *, ?, and brace alternation', () => {
    expect(globToRegExp('**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('index.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/a/b.js')).toBe(false);
    expect(globToRegExp('src/**').test('src/deep/nested/x.ts')).toBe(true);
    expect(globToRegExp('src/**').test('other/x.ts')).toBe(false);
    expect(globToRegExp('*.{ts,tsx}').test('App.tsx')).toBe(true);
    expect(globToRegExp('*.{ts,tsx}').test('App.js')).toBe(false);
    expect(globToRegExp('src/?oo.ts').test('src/foo.ts')).toBe(true);
    expect(globToRegExp('src/?oo.ts').test('src/bar.ts')).toBe(false);
  });

  it('searches file contents and renders path:line matches', async () => {
    const root = fixture();
    writeFileSync(join(root, 'a.ts'), 'const alpha = 1;\nconst beta = 2;\n', 'utf8');
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'b.ts'), 'const beta = 3;\n', 'utf8');
    const events = await collect(
      new FileSystemWorker().exec(
        { workingDir: root, action: { kind: 'search', pattern: 'beta' } },
        { token: 'file-token', allowedRoot: root, timeoutMs: 5_000 },
      ),
    );
    const completed = events.at(-1);
    expect(completed).toMatchObject({ type: 'completed', output: { ok: true } });
    const output = completed.output.content;
    expect(output).toContain('a.ts');
    expect(output).toContain(':2: const beta = 2');
    expect(output).toContain('nested/b.ts');
    expect(output).toContain(':1: const beta = 3');
  });

  it('supports context lines, case insensitivity, and glob filters', async () => {
    const root = fixture();
    writeFileSync(join(root, 'main.ts'), 'one\nTARGET\nthree\n', 'utf8');
    writeFileSync(join(root, 'other.test.ts'), 'TARGET here\n', 'utf8');
    writeFileSync(join(root, 'notes.md'), 'TARGET in md\n', 'utf8');
    const worker = new FileSystemWorker();
    const token = { token: 'file-token', allowedRoot: root, timeoutMs: 5_000 };

    const ctx = await collect(
      worker.exec(
        {
          workingDir: root,
          action: { kind: 'search', pattern: 'target', caseInsensitive: true, contextLines: 1 },
        },
        token,
      ),
    );
    const ctxOutput = ctx.at(-1).output.content;
    expect(ctxOutput).toContain('-1: one');
    expect(ctxOutput).toContain(':2: TARGET');
    expect(ctxOutput).toContain('-3: three');

    const filtered = await collect(
      worker.exec(
        {
          workingDir: root,
          action: {
            kind: 'search',
            pattern: 'TARGET',
            globInclude: '**/*.ts',
            globExclude: '**/*.test.ts',
          },
        },
        token,
      ),
    );
    const filteredOutput = filtered.at(-1).output.content;
    expect(filteredOutput).toContain('main.ts');
    expect(filteredOutput).not.toContain('other.test.ts');
    expect(filteredOutput).not.toContain('notes.md');
  });

  it('ignores node_modules, binary files, and oversized files', async () => {
    const root = fixture();
    writeFileSync(join(root, 'real.ts'), 'secret-token-in-source\n', 'utf8');
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'pkg.js'), 'secret-token-in-dep\n', 'utf8');
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0, 115, 101, 99, 114, 101, 116]));
    const events = await collect(
      new FileSystemWorker().exec(
        { workingDir: root, action: { kind: 'search', pattern: 'secret-token' } },
        { token: 'file-token', allowedRoot: root, timeoutMs: 5_000 },
      ),
    );
    const output = events.at(-1).output.content;
    expect(output).toContain('real.ts');
    expect(output).not.toContain('pkg.js');
    expect(output).not.toContain('blob.bin');
  });

  it('rejects invalid or missing patterns and caps results', async () => {
    const root = fixture();
    writeFileSync(join(root, 'x.txt'), 'match\n'.repeat(10), 'utf8');
    const worker = new FileSystemWorker();
    const token = { token: 'file-token', allowedRoot: root, timeoutMs: 5_000 };

    const missing = await collect(
      worker.exec({ workingDir: root, action: { kind: 'search', pattern: '' } }, token),
    );
    expect(missing.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'acceptance',
      error: { code: 'worker.file-bad-pattern' },
    });

    const bad = await collect(
      worker.exec({ workingDir: root, action: { kind: 'search', pattern: '(' } }, token),
    );
    expect(bad.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'acceptance',
      error: { code: 'worker.file-bad-pattern' },
    });

    const capped = await collect(
      worker.exec(
        { workingDir: root, action: { kind: 'search', pattern: 'match', maxResults: 3 } },
        token,
      ),
    );
    const cappedOutput = capped.at(-1).output;
    expect(cappedOutput.ok).toBe(true);
    expect(cappedOutput.truncated).toBe(true);
  });

  it('search enforces the allowedRoot boundary', async () => {
    const root = fixture();
    const events = await collect(
      new FileSystemWorker().exec(
        { workingDir: root, action: { kind: 'search', pattern: 'x', relative: '../escape' } },
        { token: 'file-token', allowedRoot: root, timeoutMs: 5_000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'security.path_traversal' },
    });
  });
});
