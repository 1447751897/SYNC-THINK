import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRipgrepArgs,
  parseRipgrepJson,
  ProjectContentSearchRegistry,
  searchProjectContent,
} from './project-content-search.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('project content search', () => {
  it('uses one exclusion set and the same ignore semantics for ripgrep', () => {
    const args = buildRipgrepArgs('Needle');
    expect(args).toContain('--no-ignore');
    for (const directory of [
      '.git',
      '.hg',
      '.svn',
      '.cache',
      '.venv',
      'venv',
      '__pycache__',
      'node_modules',
      'dist',
      'build',
      '.data',
    ]) {
      expect(args).toContain(`!${directory}/**`);
      expect(args).toContain(`!**/${directory}/**`);
    }
    for (const prefix of ['.electron-*', '.playwright-*', '.sync-think-*', '.tmp*']) {
      expect(args).toContain(`!${prefix}/**`);
      expect(args).toContain(`!**/${prefix}/**`);
    }
  });

  it('parses rg JSON into bounded project-relative line and column matches', () => {
    const output = [
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/app.ts' },
          lines: { text: 'const marker = "Needle";\n' },
          line_number: 7,
          submatches: [{ match: { text: 'Needle' }, start: 16, end: 22 }],
        },
      }),
      JSON.stringify({ type: 'summary', data: {} }),
    ].join('\n');

    expect(parseRipgrepJson(output, 10)).toEqual([
      {
        path: 'src/app.ts',
        line: 7,
        column: 17,
        preview: 'const marker = "Needle";',
        matchText: 'Needle',
      },
    ]);
  });

  it('falls back to a bounded filesystem scan and skips vendor and linked directories', async () => {
    const root = fixture('sync-think-search-root-');
    const outside = fixture('sync-think-search-outside-');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'ignored'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'first line\nNeedle in project\n', 'utf8');
    writeFileSync(join(root, 'node_modules', 'ignored', 'index.js'), 'Needle vendor', 'utf8');
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(outside, 'secret.txt'), 'Needle outside', 'utf8');
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await searchProjectContent({
      root,
      query: 'Needle',
      maxResults: 20,
      rgCommand: '__sync_think_missing_rg__',
    });

    expect(result.engine).toBe('fallback');
    expect(result.results).toEqual([
      {
        path: 'src/app.ts',
        line: 2,
        column: 1,
        preview: 'Needle in project',
        matchText: 'Needle',
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('keeps fallback scope aligned for ignored files, excluded folders, and deep paths', async () => {
    const root = fixture('sync-think-search-scope-');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n', 'utf8');
    writeFileSync(join(root, 'ignored.txt'), 'Needle ignored by git only', 'utf8');
    for (const directory of [
      '.git',
      '.hg',
      '.svn',
      '.cache',
      '.venv',
      'venv',
      '__pycache__',
      'node_modules',
      'dist',
      'build',
      'out',
      '.next',
      '.turbo',
      'coverage',
      '.data',
      '.electron-qa',
      '.playwright-mcp',
      '.sync-think-data',
      '.tmp-running-test',
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'excluded.txt'), 'Needle excluded', 'utf8');
    }
    let deep = root;
    for (let depth = 0; depth < 17; depth += 1) {
      deep = join(deep, `level-${depth}`);
      mkdirSync(deep);
    }
    writeFileSync(join(deep, 'deep.txt'), 'Needle deep', 'utf8');

    const result = await searchProjectContent({
      root,
      query: 'Needle',
      maxResults: 20,
      rgCommand: '__sync_think_missing_rg__',
    });

    expect(result.results.map((match) => match.path)).toEqual([
      'ignored.txt',
      `${Array.from({ length: 17 }, (_, depth) => `level-${depth}`).join('/')}/deep.txt`,
    ]);
    expect(result.truncated).toBe(false);
  });

  it('cancels the previous sender search and protects a replacement from stale release', () => {
    const registry = new ProjectContentSearchRegistry();
    const first = registry.begin(7);
    const second = registry.begin(7);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    registry.release(7, first);
    const third = registry.begin(7);
    expect(second.signal.aborted).toBe(true);
    expect(third.signal.aborted).toBe(false);
    registry.abortForSender(7);
    expect(third.signal.aborted).toBe(true);
  });

  it('honors cancellation before starting either search engine', async () => {
    const root = fixture('sync-think-search-cancel-');
    const controller = new AbortController();
    controller.abort(new Error('superseded search'));
    await expect(
      searchProjectContent({
        root,
        query: 'Needle',
        rgCommand: '__sync_think_missing_rg__',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/superseded/i);
  });

  it('rejects empty or oversized queries before scanning disk', async () => {
    const root = fixture('sync-think-search-invalid-');
    await expect(searchProjectContent({ root, query: '   ' })).rejects.toThrow(/query/i);
    await expect(searchProjectContent({ root, query: 'x'.repeat(257) })).rejects.toThrow(/query/i);
  });
});
