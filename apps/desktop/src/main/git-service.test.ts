import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortMerge,
  addWorktree,
  checkoutBranch,
  commitChanges,
  commitMerge,
  createBranch,
  discardFiles,
  getCommitFileDiff,
  getFileDiff,
  getGitBranches,
  getGitChanged,
  getGitLog,
  getGitStatus,
  listWorktrees,
  mergeBranch,
  previewMerge,
  readIdentity,
  removeWorktree,
  resolveRepository,
  stageFiles,
  undoCommit,
  unstageFiles,
  writeIdentity,
  watchRepository,
} from './git-service.js';

const roots: string[] = [];

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-think-git-'));
  roots.push(root);
  // 固定初始分支名，避免不同 git 版本的默认值（main / master）差异影响断言。
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'sync-think@example.test']);
  git(root, ['config', 'user.name', 'SYNC-THINK Test']);
  writeFileSync(path.join(root, 'README.md'), 'first\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows 上杀软可能短暂占用文件。
    }
  }
});

describe('git service repository resolution', () => {
  it('detects a repository root and reports subdirectory prefix', async () => {
    const root = repository();
    mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true });

    const top = await resolveRepository(root);
    expect(top.isRepo).toBe(true);
    // Windows 上 mkdtemp 给的是 8.3 短路径，实现需归一化后与真实路径一致。
    expect(top.root?.toLowerCase()).toBe(realpathSync.native(root).toLowerCase());
    expect(top.prefix).toBeUndefined();

    const nested = await resolveRepository(path.join(root, 'nested', 'deep'));
    expect(nested.isRepo).toBe(true);
    expect(nested.root?.toLowerCase()).toBe(realpathSync.native(root).toLowerCase());
    expect(nested.prefix).toBe('nested/deep/');
  });

  it('reports a non-repository folder without throwing', async () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'sync-think-plain-'));
    roots.push(plain);
    const resolved = await resolveRepository(plain);
    expect(resolved.isRepo).toBe(false);
    expect(resolved.root).toBeNull();
  });
});

describe('git status parsing and grouping', () => {
  it('counts every changed file beyond the former 500-file limit', async () => {
    const root = repository();
    for (let index = 0; index < 501; index += 1) {
      writeFileSync(path.join(root, 'change-' + index + '.txt'), 'new file', 'utf8');
    }
    const [status, summary] = await Promise.all([getGitStatus(root), getGitChanged(root)]);
    expect(status.changeCount).toBe(501);
    expect(status.files).toHaveLength(501);
    expect(summary.changeCount).toBe(501);
  });
  it('separates staged, unstaged and untracked entries', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nsecond\n', 'utf8');
    writeFileSync(path.join(root, 'staged.ts'), 'one\n', 'utf8');
    writeFileSync(path.join(root, 'untracked.ts'), 'alpha\nbeta\n', 'utf8');
    git(root, ['add', 'staged.ts']);

    const status = await getGitStatus(root);
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBeTruthy();
    expect(status.detached).toBe(false);

    const readme = status.files.filter((file) => file.path === 'README.md');
    expect(readme.map((file) => file.group)).toEqual(['unstaged']);
    expect(readme[0]?.kind).toBe('modified');

    const staged = status.files.find((file) => file.path === 'staged.ts');
    expect(staged?.group).toBe('staged');
    expect(staged?.kind).toBe('added');

    const untracked = status.files.find((file) => file.path === 'untracked.ts');
    expect(untracked?.group).toBe('untracked');
    expect(untracked?.kind).toBe('untracked');

    expect(status.changeCount).toBe(status.files.length);
    // README 的 1 行 + staged.ts 的 1 行 + untracked.ts 的 2 行
    expect(status.stats.added).toBe(4);
    expect(status.stats.removed).toBe(0);
  });

  it('lists a file in both staged and unstaged groups when both changed', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nstaged line\n', 'utf8');
    git(root, ['add', 'README.md']);
    writeFileSync(path.join(root, 'README.md'), 'first\nstaged line\nunstaged line\n', 'utf8');

    const status = await getGitStatus(root);
    const entries = status.files.filter((file) => file.path === 'README.md');
    expect(entries.map((file) => file.group).sort()).toEqual(['staged', 'unstaged']);
  });

  it('marks renamed files with their previous path', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'old-name.ts'), 'content\n', 'utf8');
    git(root, ['add', 'old-name.ts']);
    git(root, ['commit', '-m', 'add file']);
    git(root, ['mv', 'old-name.ts', 'new-name.ts']);

    const status = await getGitStatus(root);
    const renamed = status.files.find((file) => file.path === 'new-name.ts');
    expect(renamed?.kind).toBe('renamed');
    expect(renamed?.fromPath).toBe('old-name.ts');
  });

  it('marks conflicted files into the conflicted group', async () => {
    const root = repository();
    git(root, ['checkout', '-b', 'side']);
    writeFileSync(path.join(root, 'README.md'), 'side version\n', 'utf8');
    git(root, ['commit', '-am', 'side change']);
    git(root, ['checkout', 'main']);
    writeFileSync(path.join(root, 'README.md'), 'main version\n', 'utf8');
    git(root, ['commit', '-am', 'main change']);
    try {
      git(root, ['merge', 'side']);
    } catch {
      // 冲突是预期的。
    }

    const status = await getGitStatus(root);
    const conflicted = status.files.find((file) => file.path === 'README.md');
    expect(conflicted?.group).toBe('conflicted');
    expect(conflicted?.kind).toBe('conflicted');
    // NewMax `operation.merge`
    expect(status.operation).toBe('merge');
  });

  it('returns a lightweight changed summary for the banner', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'changed\n', 'utf8');
    const summary = await getGitChanged(root);
    expect(summary.isRepo).toBe(true);
    expect(summary.changeCount).toBe(1);
    expect(summary.operation).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(summary, 'files')).toBe(false);
  });
});

describe('git branches', () => {
  it('returns branches with the current one flagged', async () => {
    const root = repository();
    git(root, ['branch', 'feature/a']);
    git(root, ['branch', 'feature/b']);

    const branches = await getGitBranches(root);
    expect(branches.current).toBeTruthy();
    expect(branches.branches.map((branch) => branch.name)).toContain('feature/a');
    const current = branches.branches.find((branch) => branch.current);
    expect(current?.name).toBe(branches.current);
    expect(current?.committedAt).toBeGreaterThan(0);
  });
});

describe('git staging operations', () => {
  it('stages and unstages explicit paths', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'a.ts'), 'a\n', 'utf8');
    writeFileSync(path.join(root, 'b.ts'), 'b\n', 'utf8');

    expect((await stageFiles(root, ['a.ts'])).ok).toBe(true);
    let status = await getGitStatus(root);
    expect(status.files.find((file) => file.path === 'a.ts')?.group).toBe('staged');

    expect((await unstageFiles(root, ['a.ts'])).ok).toBe(true);
    status = await getGitStatus(root);
    expect(status.files.find((file) => file.path === 'a.ts')?.group).toBe('untracked');
  });

  it('rejects path traversal attempts', async () => {
    const root = repository();
    const escaped = await stageFiles(root, ['../outside.ts']);
    expect(escaped.ok).toBe(false);
    expect(escaped.error).toBe('路径不合法');

    const absolute = await stageFiles(root, ['/etc/passwd']);
    expect(absolute.ok).toBe(false);
  });

  it('discards unstaged edits back to HEAD', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'dirty\n', 'utf8');
    expect((await discardFiles(root, ['README.md'])).ok).toBe(true);
    const status = await getGitStatus(root);
    expect(status.files).toHaveLength(0);
  });
});

describe('git commits', () => {
  it('commits staged changes and supports undo', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'feature.ts'), 'export const x = 1;\n', 'utf8');
    git(root, ['add', 'feature.ts']);

    const committed = await commitChanges(root, { message: 'feat: add feature' });
    expect(committed.ok).toBe(true);
    expect(committed.committed).toBe(true);
    expect(committed.hash).toBeTruthy();

    const undone = await undoCommit(root);
    expect(undone.ok).toBe(true);
    // 撤销后改动回到暂存区
    const status = await getGitStatus(root);
    expect(status.files.some((file) => file.path === 'feature.ts')).toBe(true);
  });

  it('supports summary plus description and stageAll', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'loose.ts'), 'loose\n', 'utf8');
    const committed = await commitChanges(root, {
      message: 'feat: subject',
      description: 'body line',
      stageAll: true,
    });
    expect(committed.ok).toBe(true);
    expect(git(root, ['log', '-1', '--format=%B'])).toContain('body line');
  });

  it('reports nothingStaged instead of failing silently', async () => {
    const root = repository();
    const result = await commitChanges(root, { message: 'noop' });
    expect(result.ok).toBe(false);
    expect(result.nothingStaged).toBe(true);
  });
});

describe('git checkout safety', () => {
  it('gates a dirty worktree and preserves the stash on request', async () => {
    const root = repository();
    git(root, ['branch', 'target']);
    const initial = git(root, ['branch', '--show-current']);
    writeFileSync(path.join(root, 'README.md'), 'dirty work\n', 'utf8');

    const blocked = await checkoutBranch(root, 'target', 'check');
    expect(blocked.ok).toBe(false);
    expect(blocked.dirty).toBe(true);
    expect(blocked.files.length).toBeGreaterThan(0);

    const switched = await checkoutBranch(root, 'target', 'stash');
    expect(switched.ok).toBe(true);
    expect(switched.stashed).toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe('target');
    // stash 恢复后改动应回到工作区
    expect(git(root, ['status', '--porcelain'])).not.toBe('');
    git(root, ['checkout', initial]);
  });

  it('rejects branch names that could be parsed as git options', async () => {
    const root = repository();
    const result = await checkoutBranch(root, '--force', 'check');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('分支名称无效');

    const created = await createBranch(root, '-D');
    expect(created.ok).toBe(false);
    expect(created.error).toBe('分支名称无效');
  });

  it('creates a branch and switches to it', async () => {
    const root = repository();
    const created = await createBranch(root, 'feature/new-ui');
    expect(created.ok).toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe('feature/new-ui');
  });
});

describe('git log and diffs', () => {
  it('returns recent commits with files and stats', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'second.ts'), 'a\nb\n', 'utf8');
    git(root, ['add', 'second.ts']);
    git(root, ['commit', '-m', 'feat: second']);

    const log = await getGitLog(root, { limit: 5 });
    expect(log.entries.length).toBeGreaterThanOrEqual(2);
    const latest = log.entries[0];
    expect(latest?.subject).toBe('feat: second');
    expect(latest?.author).toBe('SYNC-THINK Test');
    expect(latest?.stats.added).toBe(2);
    expect(log.hasMore).toBe(false);
  });

  it('produces before/after text for a modified file', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nsecond\n', 'utf8');

    const diff = await getFileDiff(root, 'README.md');
    expect(diff).not.toBeNull();
    expect(diff?.before).toBe('first\n');
    expect(diff?.after).toBe('first\nsecond\n');
    expect(diff?.stats.added).toBe(1);
    expect(diff?.stats.removed).toBe(0);
  });

  it('produces a commit file diff against the parent revision', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'first\nsecond\n', 'utf8');
    git(root, ['commit', '-am', 'update readme']);
    const hash = git(root, ['rev-parse', 'HEAD']);

    const diff = await getCommitFileDiff(root, hash, 'README.md');
    expect(diff?.hash).toBe(hash);
    expect(diff?.before).toBe('first\n');
    expect(diff?.after).toBe('first\nsecond\n');
  });

  it('refuses a diff for a path outside the repository', async () => {
    const root = repository();
    expect(await getFileDiff(root, '../../etc/hosts')).toBeNull();
  });
});

describe('git identity', () => {
  it('reads and writes repository-local identity', async () => {
    const root = repository();
    const initial = await readIdentity(root, 'local');
    expect(initial.ok).toBe(true);
    expect(initial.identity.name).toBe('SYNC-THINK Test');

    const written = await writeIdentity(root, 'local', {
      name: 'New Name',
      email: 'new@example.test',
    });
    expect(written.ok).toBe(true);

    const reread = await readIdentity(root, 'local');
    expect(reread.identity.name).toBe('New Name');
    expect(reread.identity.email).toBe('new@example.test');
  });

  it('keeps global and local values separate and reports the effective identity', async () => {
    const root = repository();
    vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'isolated-global.gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    const global = await writeIdentity(root, 'global', { name: 'Global Author', email: 'global@example.test' });
    expect(global.ok).toBe(true);
    expect(global.identity.name).toBe('Global Author');
    expect(global.effectiveIdentity?.name).toBe('SYNC-THINK Test');
    const local = await readIdentity(root, 'local');
    expect(local.identity.email).toBe('sync-think@example.test');
    expect(git(root, ['config', '--global', '--get', 'user.email'])).toBe('global@example.test');
  });

  it('removes blank local overrides so the next commit inherits the global author', async () => {
    const root = repository();
    vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'isolated-global.gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    await writeIdentity(root, 'global', { name: 'Inherited Author', email: 'inherit@example.test' });
    const cleared = await writeIdentity(root, 'local', { name: '', email: '' });
    expect(cleared.ok).toBe(true);
    expect(cleared.identity).toEqual({ name: '', email: '' });
    expect(cleared.effectiveIdentity).toEqual({ name: 'Inherited Author', email: 'inherit@example.test' });
    expect((await writeIdentity(root, 'local', { name: '', email: '' })).ok).toBe(true);
    git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'verify inherited identity']);
    expect(git(root, ['log', '-1', '--format=%an <%ae>'])).toBe('Inherited Author <inherit@example.test>');
  });

  it('inherits each field independently and rejects multiline values before writing', async () => {
    const root = repository();
    vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'isolated-global.gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    await writeIdentity(root, 'global', { name: 'Global Author', email: 'global@example.test' });
    const partial = await writeIdentity(root, 'local', { name: 'Project Author', email: '' });
    expect(partial.effectiveIdentity).toEqual({ name: 'Project Author', email: 'global@example.test' });
    const invalid = await writeIdentity(root, 'local', { name: 'bad\nname', email: 'bad@example.test' });
    expect(invalid.ok).toBe(false);
    expect((await readIdentity(root, 'local')).identity).toEqual({ name: 'Project Author', email: '' });
  });

});

describe('git file lines paging', () => {
  it('pages large files by line', async () => {
    const root = repository();
    const lines = Array.from({ length: 250 }, (_, index) => `line-${index + 1}`).join('\n');
    writeFileSync(path.join(root, 'big.txt'), `${lines}\n`, 'utf8');

    const { getFileLines } = await import('./git-service.js');
    const first = await getFileLines(root, 'big.txt', { offset: 0, limit: 100 });
    expect(first?.lines).toHaveLength(100);
    expect(first?.totalLines).toBe(250);
    expect(first?.nextOffset).toBe(100);

    const last = await getFileLines(root, 'big.txt', { offset: 200, limit: 100 });
    expect(last?.lines).toHaveLength(50);
    expect(last?.nextOffset).toBeUndefined();
  });
});

describe('git worktrees', () => {
  it('lists the main worktree and reports its change count', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'dirty\n', 'utf8');

    const list = await listWorktrees(root);
    expect(list.worktrees.length).toBeGreaterThanOrEqual(1);
    const main = list.worktrees[0];
    expect(main?.main).toBe(true);
    expect(main?.active).toBe(true);
    expect(main?.branch).toBe('main');
    expect(main?.changeCount).toBe(1);
  });

  it('adds a worktree on a new branch and refuses to remove the main one', async () => {
    const root = repository();
    const target = path.join(path.dirname(root), `${path.basename(root)}-wt`);
    roots.push(target);

    const added = await addWorktree(root, { path: target, newBranch: 'feature/wt' });
    expect(added.ok).toBe(true);
    expect(added.branch).toBe('feature/wt');

    const list = await listWorktrees(root);
    expect(list.worktrees).toHaveLength(2);
    const secondary = list.worktrees.find((item) => !item.main);
    expect(secondary?.branch).toBe('feature/wt');

    // 主工作区不可移除
    const guarded = await removeWorktree(root, { path: root });
    expect(guarded.ok).toBe(false);
    expect(guarded.error).toBe('主工作区不能移除');

    const removed = await removeWorktree(root, { path: target });
    expect(removed.ok).toBe(true);
    expect(removed.removed).toBe(true);
  });

  it('blocks removing a dirty worktree until forced', async () => {
    const root = repository();
    const target = path.join(path.dirname(root), `${path.basename(root)}-wt2`);
    roots.push(target);
    await addWorktree(root, { path: target, newBranch: 'feature/wt2' });
    writeFileSync(path.join(target, 'dirty.txt'), 'x\n', 'utf8');

    const blocked = await removeWorktree(root, { path: target });
    expect(blocked.ok).toBe(false);
    // NewMax `removeDirty`
    expect(blocked.error).toContain('未提交改动');

    const forced = await removeWorktree(root, { path: target, force: true, deleteBranch: true });
    expect(forced.ok).toBe(true);
    const branches = await getGitBranches(root);
    expect(branches.branches.some((branch) => branch.name === 'feature/wt2')).toBe(false);
  });

  it('rejects a worktree path that already exists', async () => {
    const root = repository();
    const result = await addWorktree(root, { path: root, newBranch: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('目标路径已存在');
  });
});

describe('git merge', () => {
  it('merges a fast-forwardable branch and reports success', async () => {
    const root = repository();
    git(root, ['checkout', '-b', 'feature']);
    writeFileSync(path.join(root, 'feature.ts'), 'export const a = 1;\n', 'utf8');
    git(root, ['add', 'feature.ts']);
    git(root, ['commit', '-m', 'feat']);
    git(root, ['checkout', 'main']);

    const preview = await previewMerge(root, 'feature');
    expect(preview.ok).toBe(true);
    expect(preview.conflict).toBe(false);

    const merged = await mergeBranch(root, 'feature');
    expect(merged.ok).toBe(true);
    expect(merged.merged).toBe(true);
    expect(existsSync(path.join(root, 'feature.ts'))).toBe(true);
  });

  it('keeps conflict files and lets the caller abort or commit the merge', async () => {
    const root = repository();
    git(root, ['checkout', '-b', 'side']);
    writeFileSync(path.join(root, 'README.md'), 'side\n', 'utf8');
    git(root, ['commit', '-am', 'side']);
    git(root, ['checkout', 'main']);
    writeFileSync(path.join(root, 'README.md'), 'main\n', 'utf8');
    git(root, ['commit', '-am', 'main']);

    const merged = await mergeBranch(root, 'side');
    expect(merged.ok).toBe(false);
    expect(merged.conflict).toBe(true);
    expect(merged.conflicts?.length).toBeGreaterThan(0);
    // 冲突现场保留
    const status = await getGitStatus(root);
    expect(status.operation).toBe('merge');
    expect(status.merge?.merging).toBe(true);
    expect(status.merge?.resolved).toBe(false);

    // 未解决冲突时拒绝提交合并（NewMax commitMergeConflicts）
    const blockedCommit = await commitMerge(root);
    expect(blockedCommit.ok).toBe(false);
    expect(blockedCommit.error).toContain('未解决的冲突');

    // 解决冲突后可以提交合并
    writeFileSync(path.join(root, 'README.md'), 'resolved\n', 'utf8');
    git(root, ['add', 'README.md']);
    const afterResolve = await getGitStatus(root);
    expect(afterResolve.merge?.resolved).toBe(true);

    const committed = await commitMerge(root);
    expect(committed.ok).toBe(true);
    expect(committed.committed).toBe(true);

    const finalStatus = await getGitStatus(root);
    expect(finalStatus.operation).toBeNull();
    expect(finalStatus.merge).toBeUndefined();
  });

  it('aborts a conflicted merge back to the previous state', async () => {
    const root = repository();
    git(root, ['checkout', '-b', 'side']);
    writeFileSync(path.join(root, 'README.md'), 'side\n', 'utf8');
    git(root, ['commit', '-am', 'side']);
    git(root, ['checkout', 'main']);
    writeFileSync(path.join(root, 'README.md'), 'main\n', 'utf8');
    git(root, ['commit', '-am', 'main']);
    await mergeBranch(root, 'side');

    const aborted = await abortMerge(root);
    expect(aborted.ok).toBe(true);
    // NewMax `abortMergeSuccess`：回到合并前状态
    const status = await getGitStatus(root);
    expect(status.operation).toBeNull();
    expect(status.merge).toBeUndefined();
    expect(git(root, ['branch', '--show-current'])).toBe('main');
  });

  it('rejects an invalid merge target', async () => {
    const root = repository();
    const result = await mergeBranch(root, '--abort');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('分支名称无效');
  });
});

describe('review repository integration', () => {
  it('preserves staged, working and untracked changes when switching branches with stash', async () => {
    const root = repository();
    git(root, ['branch', 'feature/keep']);
    writeFileSync(path.join(root, 'README.md'), 'staged\n');
    git(root, ['add', 'README.md']);
    writeFileSync(path.join(root, 'README.md'), 'working\n');
    writeFileSync(path.join(root, 'new-file.txt'), 'new\n');
    const result = await checkoutBranch(root, 'feature/keep', 'stash');
    expect(result.ok).toBe(true);
    expect(result.stashConflict).not.toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe('feature/keep');
    expect(git(root, ['show', ':README.md'])).toBe('staged');
    const diff = await getFileDiff(root, 'README.md');
    expect(diff?.after?.replace(/\r\n/g, '\n')).toBe('working\n');
    expect(
      (await getGitStatus(root)).files.some(
        (file) => file.path === 'new-file.txt' && file.group === 'untracked',
      ),
    ).toBe(true);
    expect(git(root, ['stash', 'list'])).toBe('');
  });
  it('stages and unstages literal filenames containing glob characters', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'test[1].ts'), 'literal\n');
    writeFileSync(path.join(root, 'test1.ts'), 'other\n');
    expect((await stageFiles(root, ['test[1].ts'])).ok).toBe(true);
    expect(git(root, ['diff', '--cached', '--name-only'])).toBe('test[1].ts');
    expect((await stageFiles(root, ['test1.ts'])).ok).toBe(true);
    expect((await unstageFiles(root, ['test[1].ts'])).ok).toBe(true);
    expect(git(root, ['diff', '--cached', '--name-only'])).toBe('test1.ts');
  });
  it('deduplicates partially staged files and previews the exact staged snapshot', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'README.md'), 'staged version\n');
    git(root, ['add', 'README.md']);
    writeFileSync(path.join(root, 'README.md'), 'working version\n');
    const status = await getGitStatus(root),
      summary = await getGitChanged(root);
    expect(status.files).toHaveLength(2);
    expect(status.changeCount).toBe(1);
    expect(summary.changeCount).toBe(1);
    const staged = await getFileDiff(root, 'README.md', { staged: true });
    expect(staged?.before).toBe('first\n');
    expect(staged?.after).toBe('staged version\n');
    const working = await getFileDiff(root, 'README.md');
    expect(working?.before).toBe('staged version\n');
    expect(working?.after).toBe('working version\n');
    writeFileSync(path.join(root, 'unselected.ts'), 'keep outside commit\n');
    const committed = await commitChanges(root, {
      message: 'selected snapshot',
      description: 'body',
    });
    expect(committed.ok).toBe(true);
    expect(git(root, ['show', 'HEAD:README.md'])).toBe('staged version');
    expect(git(root, ['show', '--pretty=', '--name-only', 'HEAD'])).toBe('README.md');
    expect((await getGitStatus(root)).files.map((file) => file.path)).toContain('unselected.ts');
  });
  it('ignores runtime output while observing ordinary worktree edits', async () => {
    const root = repository();
    mkdirSync(path.join(root, '.data'));
    writeFileSync(path.join(root, '.gitignore'), '.data/\n');
    writeFileSync(path.join(root, '.data', 'runtime.log'), 'initial');
    let changes = 0;
    const handle = await watchRepository(root, () => {
      changes += 1;
    });
    expect(handle).not.toBeNull();
    try {
      writeFileSync(path.join(root, '.data', 'runtime.log'), 'updated');
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(changes).toBe(0);
      writeFileSync(path.join(root, 'README.md'), 'edited');
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(changes).toBeGreaterThan(0);
    } finally {
      handle?.dispose();
    }
  });
  it('refreshes after an external edit without an index change', async () => {
    const root = repository();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'count.ts'), '1');
    let notify!: () => void;
    const changed = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const handle = await watchRepository(root, notify);
    expect(handle).not.toBeNull();
    try {
      writeFileSync(path.join(root, 'src', 'count.ts'), '2');
      await changed;
    } finally {
      handle?.dispose();
    }
  });
});
