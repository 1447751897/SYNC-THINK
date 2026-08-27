import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ProjectGitActionResult,
  ProjectGitChange,
  ProjectGitCheckoutResult,
  ProjectGitCommitResult,
  ProjectGitInfo,
  ProjectGitPushResult,
  ProjectGitReview,
  ProjectGitReviewFile,
  ProjectGitRecentCommit,
} from '../project-git-contract.js';

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const MAX_STATUS_FILES = 100;
const MAX_FILES_PER_COMMIT = 100;
const MAX_REVIEW_TEXT_BYTES = 2 * 1024 * 1024;

function runGit(
  root: string,
  args: readonly string[],
  timeout = 20_000,
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd: root, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

function actionError(result: GitCommandResult, fallback: string): string {
  return result.stderr.trim() || result.stdout.trim() || fallback;
}

function emptyGitInfo(): ProjectGitInfo {
  return {
    branch: null,
    branches: [],
    changes: [],
    recentCommits: [],
    additions: 0,
    deletions: 0,
    ahead: 0,
    behind: 0,
    hasRemote: false,
    isRepo: false,
  };
}

function parseStatus(stdout: string): ProjectGitChange[] {
  return stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_STATUS_FILES)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3).trim().replace(/^"|"$/g, ''),
    }))
    .filter((change) => change.path.length > 0);
}

function parseRecentCommitBlocks(stdout: string): ProjectGitRecentCommit[] {
  const blocks = stdout
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0);
  const commits: ProjectGitRecentCommit[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const [hash, subject = ''] = (lines[0] ?? '').split('\x00');
    if (!hash) continue;
    const files: ProjectGitChange[] = [];
    let truncated = false;
    for (const line of lines.slice(1)) {
      if (files.length >= MAX_FILES_PER_COMMIT) {
        truncated = true;
        break;
      }
      const parts = line.split('\t');
      const status = parts[0]?.trim();
      const filePath = parts.at(-1)?.trim();
      if (status && filePath) files.push({ status, path: filePath });
    }
    commits.push({ hash, subject, files, truncated });
  }
  return commits;
}

function parseNumstat(stdout: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
    if (!line) continue;
    const [added, removed] = line.split('\t');
    if (added && added !== '-') additions += Number.parseInt(added, 10) || 0;
    if (removed && removed !== '-') deletions += Number.parseInt(removed, 10) || 0;
  }
  return { additions, deletions };
}

function countTextLines(buffer: Buffer): number {
  if (buffer.length === 0 || buffer.includes(0)) return 0;
  const text = buffer.toString('utf8');
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function readReviewText(
  root: string,
  relativePath: string,
): {
  content?: string;
  truncated?: boolean;
} {
  const absolute = path.resolve(root, relativePath);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) return {};
  try {
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) return {};
    const truncated = buffer.length > MAX_REVIEW_TEXT_BYTES;
    return {
      content: buffer.subarray(0, MAX_REVIEW_TEXT_BYTES).toString('utf8'),
      truncated: truncated || undefined,
    };
  } catch {
    return {};
  }
}

function reviewAction(status: string): ProjectGitReviewFile['action'] {
  if (status.includes('D')) return 'deleted';
  if (status === '??' || status.includes('A')) return 'created';
  return 'edited';
}

function countUntrackedAdditions(root: string, changes: readonly ProjectGitChange[]): number {
  let additions = 0;
  for (const change of changes) {
    if (change.status !== '??') continue;
    const absolute = path.resolve(root, change.path);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    try {
      additions += countTextLines(readFileSync(absolute));
    } catch {
      // A file may disappear between status and stat collection.
    }
  }
  return additions;
}

async function validateBranchName(root: string, branch: string): Promise<string | null> {
  const value = branch.trim();
  if (!value || value.startsWith('-')) return null;
  const checked = await runGit(root, ['check-ref-format', '--branch', value]);
  return checked.ok ? value : null;
}

export async function getProjectGitInfo(inputRoot: string): Promise<ProjectGitInfo> {
  const root = path.resolve(inputRoot);
  if (!existsSync(root)) return emptyGitInfo();
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], 8_000);
  if (!inside.ok || inside.stdout.trim() !== 'true') return emptyGitInfo();

  const [branchResult, branchesResult, statusResult, logResult, statsResult, remoteResult, sync] =
    await Promise.all([
      runGit(root, ['branch', '--show-current'], 8_000),
      runGit(root, ['branch', '--format=%(refname:short)'], 8_000),
      runGit(root, ['status', '--short', '--untracked-files=all'], 8_000),
      runGit(root, ['log', '-8', '--name-status', '--format=%h%x00%s'], 8_000),
      runGit(root, ['diff', '--numstat', 'HEAD', '--'], 8_000),
      runGit(root, ['remote'], 8_000),
      runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], 8_000),
    ]);
  const changes = parseStatus(statusResult.stdout);
  const stats = parseNumstat(statsResult.stdout);
  const [behindRaw = '0', aheadRaw = '0'] = sync.ok ? sync.stdout.trim().split(/\s+/) : ['0', '0'];
  return {
    branch: branchResult.stdout.trim() || null,
    branches: branchesResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 100),
    changes,
    recentCommits: parseRecentCommitBlocks(logResult.stdout),
    additions: stats.additions + countUntrackedAdditions(root, changes),
    deletions: stats.deletions,
    ahead: Number.parseInt(aheadRaw, 10) || 0,
    behind: Number.parseInt(behindRaw, 10) || 0,
    hasRemote: remoteResult.stdout.trim().length > 0,
    isRepo: true,
  };
}

export async function getProjectGitReview(inputRoot: string): Promise<ProjectGitReview> {
  const root = path.resolve(inputRoot);
  const info = await getProjectGitInfo(root);
  if (!info.isRepo) return { files: [] };

  const files = await Promise.all(
    info.changes.map(async (change): Promise<ProjectGitReviewFile> => {
      const action = reviewAction(change.status);
      const current = action === 'deleted' ? {} : readReviewText(root, change.path);
      let previous: { content?: string; truncated?: boolean } = {};
      if (action !== 'created') {
        const shown = await runGit(
          root,
          ['show', `HEAD:${change.path.replace(/\\/g, '/')}`],
          12_000,
        );
        if (shown.ok && !shown.stdout.includes('\0')) {
          const bytes = Buffer.from(shown.stdout);
          previous = {
            content: bytes.subarray(0, MAX_REVIEW_TEXT_BYTES).toString('utf8'),
            truncated: bytes.length > MAX_REVIEW_TEXT_BYTES || undefined,
          };
        }
      }
      return {
        path: change.path,
        action,
        previousContent: action === 'created' ? '' : previous.content,
        content: action === 'deleted' ? '' : current.content,
        previousTruncated: previous.truncated || current.truncated || undefined,
      };
    }),
  );
  return { files };
}

export async function checkoutProjectBranch(
  inputRoot: string,
  requestedBranch: string,
  strategy: 'check' | 'stash' | 'force' = 'check',
): Promise<ProjectGitCheckoutResult> {
  const root = path.resolve(inputRoot);
  if (!existsSync(root)) {
    return { ok: false, error: '项目文件夹不存在', dirty: false, changes: [] };
  }
  const branch = await validateBranchName(root, requestedBranch);
  if (!branch) throw new Error('git-checkout: invalid branch name');
  const status = await runGit(root, ['status', '--short', '--untracked-files=all']);
  const changes = parseStatus(status.stdout);
  if (changes.length > 0 && strategy === 'check') {
    return { ok: false, dirty: true, changes, error: null };
  }
  if (changes.length > 0 && strategy === 'stash') {
    const stash = await runGit(root, [
      'stash',
      'push',
      '-u',
      '-m',
      `sync-think: switch to ${branch}`,
    ]);
    if (!stash.ok) {
      return {
        ok: false,
        dirty: true,
        changes,
        error: `保存 stash 失败：${actionError(stash, '未知错误')}`,
      };
    }
  }
  const checkout = await runGit(
    root,
    strategy === 'force' ? ['checkout', '-f', branch] : ['checkout', branch],
  );
  if (!checkout.ok) {
    return {
      ok: false,
      dirty: false,
      changes: [],
      error: `切换分支失败：${actionError(checkout, '未知错误')}${
        strategy === 'stash' && changes.length > 0
          ? '；更改已保存到 stash，可用 git stash pop 恢复'
          : ''
      }`,
    };
  }
  return {
    ok: true,
    dirty: false,
    changes: [],
    error: null,
    stashed: strategy === 'stash' && changes.length > 0,
  };
}

export async function createProjectBranch(
  inputRoot: string,
  requestedBranch: string,
): Promise<ProjectGitActionResult> {
  const root = path.resolve(inputRoot);
  const branch = await validateBranchName(root, requestedBranch);
  if (!branch) return { ok: false, error: '分支名称无效' };
  const created = await runGit(root, ['checkout', '-b', branch]);
  return created.ok
    ? { ok: true, error: null }
    : { ok: false, error: `创建分支失败：${actionError(created, '未知错误')}` };
}

export async function pushProjectBranch(inputRoot: string): Promise<ProjectGitPushResult> {
  const root = path.resolve(inputRoot);
  const branchResult = await runGit(root, ['branch', '--show-current']);
  const branch = branchResult.stdout.trim();
  if (!branch) return { ok: false, pushed: false, error: '当前处于 detached HEAD' };
  const upstream = await runGit(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  const pushed = upstream.ok
    ? await runGit(root, ['push'], 60_000)
    : await (async () => {
        const remotes = await runGit(root, ['remote']);
        const names = remotes.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const remote = names.includes('origin') ? 'origin' : names[0];
        return remote
          ? runGit(root, ['push', '--set-upstream', remote, branch], 60_000)
          : { ok: false, stdout: '', stderr: '未配置 Git remote' };
      })();
  return pushed.ok
    ? { ok: true, pushed: true, error: null }
    : { ok: false, pushed: false, error: `推送失败：${actionError(pushed, '未知错误')}` };
}

export async function commitProjectChanges(
  inputRoot: string,
  options: { message: string; includeUnstaged: boolean; push: boolean },
): Promise<ProjectGitCommitResult> {
  const root = path.resolve(inputRoot);
  const message = options.message.trim();
  if (!message) {
    return { ok: false, committed: false, pushed: false, error: '请输入提交信息' };
  }
  if (options.includeUnstaged) {
    const staged = await runGit(root, ['add', '--all']);
    if (!staged.ok) {
      return {
        ok: false,
        committed: false,
        pushed: false,
        error: `暂存更改失败：${actionError(staged, '未知错误')}`,
      };
    }
  }
  const stagedFiles = await runGit(root, ['diff', '--cached', '--name-only']);
  if (!stagedFiles.stdout.trim()) {
    return { ok: false, committed: false, pushed: false, error: '没有已暂存的更改' };
  }
  const committed = await runGit(root, ['commit', '-m', message], 60_000);
  if (!committed.ok) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      error: `提交失败：${actionError(committed, '未知错误')}`,
    };
  }
  if (!options.push) return { ok: true, committed: true, pushed: false, error: null };
  const pushed = await pushProjectBranch(root);
  return {
    ok: pushed.ok,
    committed: true,
    pushed: pushed.pushed,
    error: pushed.error,
  };
}
