import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkoutProjectBranch,
  commitProjectChanges,
  createProjectBranch,
  getProjectGitInfo,
  getProjectGitReview,
  pushProjectBranch,
} from './project-git.js';

const roots: string[] = [];

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-think-git-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'sync-think@example.test']);
  git(root, ['config', 'user.name', 'SYNC-THINK Test']);
  writeFileSync(path.join(root, 'README.md'), 'first\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows antivirus can briefly retain Git files; temp cleanup is best effort.
    }
  }
});

describe('project Git operations', () => {
  it('returns branch, worktree files and real line statistics', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nsecond\n', 'utf8');
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'new.ts'), 'one\ntwo\n', 'utf8');

    const info = await getProjectGitInfo(root);

    expect(info.isRepo).toBe(true);
    expect(info.branch).toBeTruthy();
    expect(info.changes.map((change) => change.path)).toEqual(['README.md', 'src/new.ts']);
    expect(info.additions).toBe(3);
    expect(info.deletions).toBe(0);
  });

  it('returns reviewable before/after content for modified, added and deleted files', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nsecond\n', 'utf8');
    writeFileSync(path.join(root, 'added.txt'), 'added\n', 'utf8');
    writeFileSync(path.join(root, 'delete.txt'), 'gone\n', 'utf8');
    git(root, ['add', 'delete.txt']);
    git(root, ['commit', '-m', 'add delete fixture']);
    rmSync(path.join(root, 'delete.txt'));

    const review = await getProjectGitReview(root);

    expect(review.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'README.md',
          action: 'edited',
          previousContent: 'first\n',
          content: 'first\nsecond\n',
        }),
        expect.objectContaining({
          path: 'added.txt',
          action: 'created',
          previousContent: '',
          content: 'added\n',
        }),
        expect.objectContaining({
          path: 'delete.txt',
          action: 'deleted',
          previousContent: 'gone\n',
          content: '',
        }),
      ]),
    );
  });

  it('creates and switches branches while preserving the dirty-worktree gate', async () => {
    const root = repository();
    const initialBranch = git(root, ['branch', '--show-current']);
    const created = await createProjectBranch(root, 'feature/status-card');
    expect(created.ok).toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe('feature/status-card');

    writeFileSync(path.join(root, 'README.md'), 'dirty\n', 'utf8');
    const checked = await checkoutProjectBranch(root, initialBranch, 'check');
    expect(checked.ok).toBe(false);
    expect(checked.dirty).toBe(true);

    const switched = await checkoutProjectBranch(root, initialBranch, 'stash');
    expect(switched.ok).toBe(true);
    expect(switched.stashed).toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe(initialBranch);
  });

  it('commits unstaged changes and pushes through the configured upstream', async () => {
    const root = repository();
    const remote = mkdtempSync(path.join(tmpdir(), 'sync-think-remote-'));
    roots.push(remote);
    git(remote, ['init', '--bare']);
    git(root, ['remote', 'add', 'origin', remote]);
    await pushProjectBranch(root);

    writeFileSync(path.join(root, 'README.md'), 'committed\n', 'utf8');
    const result = await commitProjectChanges(root, {
      message: 'update readme',
      includeUnstaged: true,
      push: true,
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(git(root, ['status', '--short'])).toBe('');
    expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('committed\n');
  });
});
