/**
 * Git 服务（主进程）。
 *
 * 设计沿革：原 `project-git.ts` 只暴露 6 个能力（info/review/checkout/
 * create-branch/commit/push）。本文件按 NewMax 的 `git:*` 通道族重建，补齐
 * 暂存区、提交历史、单文件 diff、pull/fetch、身份读写与仓库监听。
 *
 * 安全边界（沿用并强化原实现的做法）：
 * - Renderer 只发意图，命令字面量全部固定在主进程；
 * - 所有路径先 `path.resolve` 再校验落在仓库根内；
 * - 分支名先过 `git check-ref-format` 且拒绝 `-` 开头（防参数注入）；
 * - 二进制文件不做文本 diff；文本读取有字节上限；
 * - 所有列表有上限，避免超大仓库拖垮 renderer。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type {
  GitActionResult,
  GitBranch,
  GitBranchGroup,
  GitBranches,
  GitChangedSummary,
  GitCheckoutResult,
  GitCommitFileDiff,
  GitCommitResult,
  GitFetchResult,
  GitFileChange,
  GitFileDiff,
  GitFileGroup,
  GitFileKind,
  GitIdentityResult,
  GitIdentityScope,
  GitLogEntry,
  GitLogResult,
  GitMergeResult,
  GitMergeState,
  GitOperation,
  GitPullResult,
  GitPushResult,
  GitRepository,
  GitStatus,
  GitWorktree,
  GitWorktreeAddResult,
  GitWorktreeList,
  GitWorktreeRemoveResult,
} from '../git-contract.js';

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

const MAX_FILES_PER_COMMIT = 200;
const MAX_REVIEW_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BRANCHES = 300;
const MAX_LOG_ENTRIES = 100;
const DEFAULT_LOG_PAGE = 30;

function runGit(
  root: string,
  args: readonly string[],
  timeout = 20_000,
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd: root,
        timeout,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: error && typeof error.code === 'number' ? error.code : error ? undefined : 0,
        }),
    );
  });
}

function actionError(result: GitCommandResult, fallback: string): string {
  return result.stderr.trim() || result.stdout.trim() || fallback;
}

/** 目录穿越防线：解析后必须落在 root 内（root 本身除外）。 */
function insideRoot(root: string, relativePath: string): string | null {
  const absolute = path.resolve(root, relativePath);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

function readTextCapped(absolute: string): {
  content?: string;
  truncated?: boolean;
  binary: boolean;
} {
  let buffer: Buffer;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) return { binary: false };
    buffer = readFileSync(absolute);
  } catch {
    return { binary: false };
  }
  if (buffer.includes(0)) return { binary: true };
  const truncated = buffer.length > MAX_REVIEW_TEXT_BYTES;
  return {
    content: buffer.subarray(0, MAX_REVIEW_TEXT_BYTES).toString('utf8'),
    truncated: truncated || undefined,
    binary: false,
  };
}

function countLines(buffer: Buffer): number {
  if (buffer.length === 0 || buffer.includes(0)) return 0;
  const text = buffer.toString('utf8');
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

// ─── 仓库定位 ────────────────────────────────────────────────────────────────

/**
 * 归一化路径。
 *
 * Windows 上 `mkdtemp`、资源管理器、部分 IDE 会给出 8.3 短路径
 * （`C:\Users\ZHUZHE~1\...`），而 git 返回长路径（`C:/Users/zhuzheny/...`）。
 * 两者指向同一目录但字符串不同，会让后续所有 `insideRoot` 前缀校验失败，
 * 表现为「路径不合法」。这里统一解析成真实长路径。
 */
function canonicalize(target: string): string {
  try {
    return path.resolve(realpathSync.native(target));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // 目录不存在或权限不足时退回原值，交由调用方按 isRepo:false 处理。
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return path.resolve(target);
    throw error;
  }
}

export async function resolveRepository(inputRoot: string): Promise<GitRepository> {
  let root: string;
  try {
    root = canonicalize(inputRoot);
  } catch {
    return { isRepo: false, root: null, error: '项目文件夹不存在' };
  }
  if (!existsSync(root)) {
    return { isRepo: false, root: null, error: '项目文件夹不存在' };
  }
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], 8_000);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { isRepo: false, root: null, error: null };
  }
  const top = await runGit(root, ['rev-parse', '--show-toplevel'], 8_000);
  // git 在 Windows 上可能返回短路径或长路径，同样归一化后再作为仓库根。
  const repoRoot = top.ok && top.stdout.trim() ? canonicalize(top.stdout.trim()) : root;
  const prefixResult = await runGit(root, ['rev-parse', '--show-prefix'], 8_000);
  const prefix = prefixResult.ok ? prefixResult.stdout.trim() : '';
  return {
    isRepo: true,
    root: repoRoot,
    ...(prefix ? { prefix } : {}),
    error: null,
  };
}

// ─── status 解析 ─────────────────────────────────────────────────────────────

interface RawStatusEntry {
  code: string;
  path: string;
  fromPath?: string;
}

/**
 * 解析 `git status --porcelain=v1 -z`。
 * rename/copy 会多跟一个 NUL 分隔的原路径。忽略项（`!!`）直接丢弃。
 */
function parsePorcelainZ(stdout: string): RawStatusEntry[] {
  const entries: RawStatusEntry[] = [];
  const parts = stdout.split('\0');
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (!record || record.length < 3) continue;
    const code = record.slice(0, 2);
    if (code === '!!') continue;
    const filePath = record.slice(3);
    if (!filePath) continue;
    // rename/copy：下一个 NUL 段是原路径
    if (code[0] === 'R' || code[0] === 'C') {
      const fromPath = parts[index + 1];
      if (fromPath) index += 1;
      entries.push({ code, path: filePath, ...(fromPath ? { fromPath } : {}) });
    } else {
      entries.push({ code, path: filePath });
    }
  }
  return entries;
}

function isConflictedCode(code: string): boolean {
  if (code === 'DD' || code === 'AA' || code === 'UU') return true;
  return code[0] === 'U' || code[1] === 'U';
}

function kindFromCode(code: string, group: GitFileGroup): GitFileKind {
  if (group === 'conflicted') return 'conflicted';
  if (group === 'untracked') return 'untracked';
  const marker = group === 'staged' ? code[0] : code[1];
  if (marker === 'A') return 'added';
  if (marker === 'D') return 'deleted';
  if (marker === 'R' || marker === 'C') return 'renamed';
  return 'modified';
}

/**
 * 把 porcelain 条目摊平成 (文件 × 分组) 记录。
 *
 * 同一文件可能同时有已暂存和未暂存改动（如 `MM`），保留两个快照，
 * 审阅列表按路径合并展示，Diff 仍按所选快照读取。
 */
function toFileChanges(entries: readonly RawStatusEntry[]): GitFileChange[] {
  const changes: GitFileChange[] = [];
  for (const entry of entries) {
    const { code, path: filePath, fromPath } = entry;
    const normalized = filePath.replace(/\\/g, '/');
    if (isConflictedCode(code)) {
      changes.push({
        path: normalized,
        ...(fromPath ? { fromPath: fromPath.replace(/\\/g, '/') } : {}),
        kind: 'conflicted',
        group: 'conflicted',
        code,
      });
      continue;
    }
    if (code === '??') {
      changes.push({ path: normalized, kind: 'untracked', group: 'untracked', code });
      continue;
    }
    if (code[0] !== ' ' && code[0] !== '?') {
      changes.push({
        path: normalized,
        ...(fromPath ? { fromPath: fromPath.replace(/\\/g, '/') } : {}),
        kind: kindFromCode(code, 'staged'),
        group: 'staged',
        code,
      });
    }
    if (code[1] !== ' ' && code[1] !== '?') {
      changes.push({
        path: normalized,
        kind: kindFromCode(code, 'unstaged'),
        group: 'unstaged',
        code,
      });
    }
  }
  return changes;
}

/** 检测进行中的仓库操作，对应 NewMax `operation` 分组。 */
function detectOperation(gitDir: string): GitOperation | null {
  const probe = (name: string) => existsSync(path.join(gitDir, name));
  if (probe('MERGE_HEAD')) return 'merge';
  if (
    existsSync(path.join(gitDir, 'rebase-merge')) ||
    existsSync(path.join(gitDir, 'rebase-apply'))
  )
    return 'rebase';
  if (probe('CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (probe('REVERT_HEAD')) return 'revert';
  if (probe('BISECT_LOG')) return 'bisect';
  return null;
}

async function gitDirOf(root: string): Promise<string | null> {
  const result = await runGit(root, ['rev-parse', '--git-dir'], 8_000);
  if (!result.ok) return null;
  const value = result.stdout.trim();
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

async function readAheadBehind(root: string): Promise<{ ahead: number; behind: number }> {
  const result = await runGit(
    root,
    ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
    8_000,
  );
  if (!result.ok) return { ahead: 0, behind: 0 };
  const [behindRaw = '0', aheadRaw = '0'] = result.stdout.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw, 10) || 0,
    behind: Number.parseInt(behindRaw, 10) || 0,
  };
}

/** 未跟踪文件的行数也要计入 additions，否则统计会明显偏小。 */
function countUntrackedAdditions(root: string, changes: readonly GitFileChange[]): number {
  let additions = 0;
  for (const change of changes) {
    if (change.group !== 'untracked') continue;
    const absolute = insideRoot(root, change.path);
    if (!absolute) continue;
    try {
      additions += countLines(readFileSync(absolute));
    } catch {
      // 文件可能在 status 与 stat 之间被删除。
    }
  }
  return additions;
}

async function readNumstat(root: string, args: readonly string[]): Promise<GitChangeStatsLike> {
  const result = await runGit(root, ['diff', '--numstat', ...args], 12_000);
  let added = 0;
  let removed = 0;
  if (result.ok) {
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [a, r] = line.split('\t');
      if (a && a !== '-') added += Number.parseInt(a, 10) || 0;
      if (r && r !== '-') removed += Number.parseInt(r, 10) || 0;
    }
  }
  return { added, removed };
}

interface GitChangeStatsLike {
  added: number;
  removed: number;
}

// ─── 读取接口 ────────────────────────────────────────────────────────────────

export async function getGitStatus(inputRoot: string): Promise<GitStatus> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return {
      isRepo: false,
      branch: null,
      detached: false,
      ahead: 0,
      behind: 0,
      hasRemote: false,
      operation: null,
      files: [],
      stats: { added: 0, removed: 0 },
      changeCount: 0,
    };
  }
  const root = repo.root;
  const [branchResult, statusResult, remoteResult, sync, gitDir] = await Promise.all([
    runGit(root, ['branch', '--show-current'], 8_000),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 12_000),
    runGit(root, ['remote'], 8_000),
    readAheadBehind(root),
    gitDirOf(root),
  ]);
  const files = toFileChanges(parsePorcelainZ(statusResult.stdout));
  const rawStats = await readNumstat(root, ['HEAD', '--']);
  const stats = {
    added: rawStats.added + countUntrackedAdditions(root, files),
    removed: rawStats.removed,
  };
  const branch = branchResult.stdout.trim() || null;
  let detachedFrom: string | undefined;
  let detachedSha: string | undefined;
  if (!branch) {
    const sha = await runGit(root, ['rev-parse', '--short', 'HEAD'], 8_000);
    if (sha.ok && sha.stdout.trim()) detachedSha = sha.stdout.trim();
    const describe = await runGit(root, ['describe', '--all', '--exact-match', 'HEAD'], 8_000);
    if (describe.ok && describe.stdout.trim()) {
      detachedFrom = describe.stdout.trim().replace(/^remotes\//, '');
    }
  }
  const mergeState = await readMergeState(root, branch);
  const remotes = remoteResult.stdout.trim().split(/\s+/).filter(Boolean);
  const configuredRemote = branch
    ? await runGit(root, ['config', '--get', 'branch.' + branch + '.remote'], 8_000)
    : undefined;
  let fetchedAt: number | undefined;
  try {
    if (gitDir) fetchedAt = statSync(path.join(gitDir, 'FETCH_HEAD')).mtimeMs;
  } catch {
    /* Never fetched. */
  }
  return {
    isRepo: true,
    branch,
    detached: !branch,
    ...(detachedFrom ? { detachedFrom } : {}),
    ...(detachedSha ? { detachedSha } : {}),
    ahead: sync.ahead,
    behind: sync.behind,
    hasRemote: remoteResult.stdout.trim().length > 0,
    operation: gitDir ? detectOperation(gitDir) : null,
    files,
    stats,
    changeCount: new Set(files.map((file) => file.path)).size,
    root,
    remoteName:
      configuredRemote?.ok && remotes.includes(configuredRemote.stdout.trim())
        ? configuredRemote.stdout.trim()
        : remotes.includes('origin')
          ? 'origin'
          : remotes[0],
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(mergeState ? { merge: mergeState } : {}),
  };
}

/** NewMax `git:changed`：横幅只要计数与领先落后，不必拉全量文件。 */
export async function getGitChanged(inputRoot: string): Promise<GitChangedSummary> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return {
      isRepo: false,
      branch: null,
      detached: false,
      ahead: 0,
      behind: 0,
      operation: null,
      changeCount: 0,
    };
  }
  const root = repo.root;
  const [branchResult, statusResult, sync, gitDir] = await Promise.all([
    runGit(root, ['branch', '--show-current'], 8_000),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 12_000),
    readAheadBehind(root),
    gitDirOf(root),
  ]);
  const files = parsePorcelainZ(statusResult.stdout);
  const branch = branchResult.stdout.trim() || null;
  let detachedFrom: string | undefined;
  let detachedSha: string | undefined;
  if (!branch) {
    const sha = await runGit(root, ['rev-parse', '--short', 'HEAD'], 8_000);
    if (sha.ok && sha.stdout.trim()) detachedSha = sha.stdout.trim();
    const describe = await runGit(root, ['describe', '--all', '--exact-match', 'HEAD'], 8_000);
    if (describe.ok && describe.stdout.trim()) {
      detachedFrom = describe.stdout.trim().replace(/^remotes\//, '');
    }
  }
  return {
    isRepo: true,
    branch,
    detached: !branch,
    ...(detachedFrom ? { detachedFrom } : {}),
    ...(detachedSha ? { detachedSha } : {}),
    ahead: sync.ahead,
    behind: sync.behind,
    operation: gitDir ? detectOperation(gitDir) : null,
    changeCount: files.length,
  };
}

/**
 * NewMax `branchMenu`：分支按默认 / 最近 / 其他三组返回。
 * 最近分组取按提交时间倒序的前若干条，默认分支优先。
 */
export async function getGitBranches(inputRoot: string): Promise<GitBranches> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { current: null, branches: [] };
  const root = repo.root;
  const [currentResult, listResult, headResult] = await Promise.all([
    runGit(root, ['branch', '--show-current'], 8_000),
    runGit(
      root,
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)%00%(committerdate:unix)%00%(upstream:short)',
        'refs/heads',
        `--count=${MAX_BRANCHES}`,
      ],
      12_000,
    ),
    runGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 8_000),
  ]);
  const current = currentResult.stdout.trim() || null;
  const defaultBranch = headResult.ok
    ? headResult.stdout.trim().replace(/^origin\//, '')
    : undefined;
  const branches: GitBranch[] = [];
  for (const line of listResult.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, committedAt, upstream] = line.split('\0');
    if (!name) continue;
    let group: GitBranchGroup = 'other';
    if (defaultBranch && name === defaultBranch) group = 'default';
    else if (branches.filter((b) => b.group === 'recent').length < 8) group = 'recent';
    branches.push({
      name,
      group,
      current: name === current,
      ...(committedAt ? { committedAt: Number.parseInt(committedAt, 10) || undefined } : {}),
      ...(upstream ? { upstream } : {}),
    });
  }
  return { current, branches, ...(defaultBranch ? { defaultBranch } : {}) };
}

// ─── 分支操作 ────────────────────────────────────────────────────────────────

async function validateBranchName(root: string, branch: string): Promise<string | null> {
  const value = branch.trim();
  if (!value || value.startsWith('-')) return null;
  const checked = await runGit(root, ['check-ref-format', '--branch', value]);
  return checked.ok ? value : null;
}

/**
 * 切换分支。`strategy`:
 * - `check`（默认）：工作区脏则原样返回 dirty，由 UI 弹确认；
 * - `stash`：先 `git stash push -u` 再切换，成功后尝试恢复；
 * - `force`：`git checkout -f`，丢弃本地改动。
 */
export async function checkoutBranch(
  inputRoot: string,
  requestedBranch: string,
  strategy: 'check' | 'stash' | 'force' = 'check',
): Promise<GitCheckoutResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, dirty: false, files: [], error: '项目文件夹不存在' };
  }
  const root = repo.root;
  const branch = await validateBranchName(root, requestedBranch);
  if (!branch) return { ok: false, dirty: false, files: [], error: '分支名称无效' };

  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const files = toFileChanges(parsePorcelainZ(statusResult.stdout));
  if (files.length > 0 && strategy === 'check') {
    // NewMax `dirtyTitle` / `dirtyDescription` 的数据来源。
    return { ok: false, dirty: true, files, error: null };
  }

  let stashed = false;
  if (files.length > 0 && strategy === 'stash') {
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
        files,
        error: `暂存改动失败：${actionError(stash, '未知错误')}`,
      };
    }
    stashed = true;
  }

  const checkout = await runGit(
    root,
    strategy === 'force' ? ['checkout', '-f', branch] : ['checkout', branch],
    60_000,
  );
  if (!checkout.ok) {
    return {
      ok: false,
      dirty: false,
      files: [],
      error: `切换分支失败：${actionError(checkout, '未知错误')}${
        stashed ? '；改动已保存到 stash，可用 git stash pop 恢复' : ''
      }`,
      ...(stashed ? { stashed: true } : {}),
    };
  }

  // NewMax `stashPopConflict`：已切换但恢复暂存内容冲突。
  let stashConflict = false;
  if (stashed) {
    const pop = await runGit(root, ['stash', 'pop', '--index'], 60_000);
    if (!pop.ok) {
      stashConflict = true;
      return {
        ok: true,
        dirty: false,
        files: [],
        error: null,
        stashed: true,
        stashConflict: true,
      };
    }
  }
  return {
    ok: true,
    dirty: false,
    files: [],
    error: null,
    ...(stashed ? { stashed: true } : {}),
    ...(stashConflict ? { stashConflict: true } : {}),
  };
}

export async function createBranch(
  inputRoot: string,
  requestedBranch: string,
): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const branch = await validateBranchName(root, requestedBranch);
  if (!branch) return { ok: false, error: '分支名称无效' };
  const created = await runGit(root, ['checkout', '-b', branch], 30_000);
  return created.ok
    ? { ok: true, error: null }
    : { ok: false, error: `创建分支失败：${actionError(created, '未知错误')}` };
}

/** Treat a UI-selected filename literally without changing Git's internal commands. */
function literalPathspec(file: string): string {
  return ':(literal)' + file;
}

// ─── 暂存区 ──────────────────────────────────────────────────────────────────

/** 校验一批相对路径，返回可安全传给 git 的 `/` 分隔形式。 */
function safePaths(root: string, paths: readonly string[]): string[] | null {
  const result: string[] = [];
  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..'))
      return null;
    const absolute = insideRoot(root, normalized);
    if (!absolute) return null;
    result.push(normalized);
  }
  return result;
}

export async function stageFiles(
  inputRoot: string,
  paths: readonly string[],
): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  if (!paths.length) return { ok: true, error: null };
  const safe = safePaths(root, paths);
  if (!safe) return { ok: false, error: '路径不合法' };
  const result = await runGit(root, ['add', '--', ...safe.map(literalPathspec)], 30_000);
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: `暂存失败：${actionError(result, '未知错误')}` };
}

export async function unstageFiles(
  inputRoot: string,
  paths: readonly string[],
): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  if (!paths.length) return { ok: true, error: null };
  const safe = safePaths(root, paths);
  if (!safe) return { ok: false, error: '路径不合法' };
  // HEAD 可能不存在（全新仓库无提交），此时用 `rm --cached`。
  const hasHead = await runGit(root, ['rev-parse', '--verify', 'HEAD'], 8_000);
  const result = hasHead.ok
    ? await runGit(root, ['restore', '--staged', '--', ...safe.map(literalPathspec)], 30_000)
    : await runGit(root, ['rm', '--cached', '-r', '--', ...safe.map(literalPathspec)], 30_000);
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: `取消暂存失败：${actionError(result, '未知错误')}` };
}

/**
 * 丢弃改动（NewMax `discard` / `discardAll`，UI 侧有确认）。
 * 已暂存文件丢弃到 HEAD；未暂存文件丢弃到 index；未跟踪文件会删除文件。
 */
export async function discardFiles(
  inputRoot: string,
  paths: readonly string[],
): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  if (!paths.length) return { ok: true, error: null };
  const safe = safePaths(root, paths);
  if (!safe) return { ok: false, error: '路径不合法' };
  const hasHead = await runGit(root, ['rev-parse', '--verify', 'HEAD'], 8_000);
  const result = hasHead.ok
    ? await runGit(
        root,
        ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...safe.map(literalPathspec)],
        30_000,
      )
    : await runGit(root, ['clean', '-f', '--', ...safe.map(literalPathspec)], 30_000);
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: `丢弃改动失败：${actionError(result, '未知错误')}` };
}

// ─── 提交 ────────────────────────────────────────────────────────────────────

export async function commitChanges(
  inputRoot: string,
  options: { message: string; description?: string; stageAll?: boolean; push?: boolean },
): Promise<GitCommitResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, committed: false, pushed: false, error: '项目文件夹不存在' };
  }
  const root = repo.root;
  const summary = options.message.trim();
  if (!summary) return { ok: false, committed: false, pushed: false, error: '请输入提交信息' };

  if (options.stageAll) {
    const staged = await runGit(root, ['add', '--all'], 30_000);
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
    // NewMax `commitNothingStaged`。
    return {
      ok: false,
      committed: false,
      pushed: false,
      error: '没有已暂存的更改',
      nothingStaged: true,
    };
  }

  const description = options.description?.trim();
  // 摘要 + 正文：NewMax 的提交区区分 summary 与 description。
  const message = description ? `${summary}\n\n${description}` : summary;
  const committed = await runGit(root, ['commit', '-m', message], 60_000);
  if (!committed.ok) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      error: `提交失败：${actionError(committed, '未知错误')}`,
    };
  }
  const head = await runGit(root, ['rev-parse', '--short', 'HEAD'], 8_000);
  const hash = head.ok ? head.stdout.trim() : undefined;

  if (!options.push) {
    return { ok: true, committed: true, pushed: false, error: null, ...(hash ? { hash } : {}) };
  }
  const pushed = await pushBranch(root);
  return {
    ok: pushed.ok,
    committed: true,
    pushed: pushed.pushed,
    error: pushed.error,
    ...(hash ? { hash } : {}),
  };
}

/** NewMax `undoCommit`：软重置到父提交，保留工作区与暂存区内容。 */
export async function undoCommit(inputRoot: string): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const parent = await runGit(root, ['rev-parse', '--verify', 'HEAD~1'], 8_000);
  if (!parent.ok) return { ok: false, error: '没有可撤销的提交' };
  const result = await runGit(root, ['reset', '--soft', 'HEAD~1'], 30_000);
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: `撤销提交失败：${actionError(result, '未知错误')}` };
}

// ─── 历史与 diff ─────────────────────────────────────────────────────────────

/**
 * 最近提交列表。
 *
 * 实现要点（踩过的坑，别回退）：
 * 1. `--format` 里的分隔符必须写成 git 的 `%x01` 转义，**不能写裸的 `\x01`**——
 *    裸字符会被当字面量原样输出，导致 header 无法按分隔符切分。
 * 2. `--name-status` 与 `--numstat` **同时给会被 git 忽略掉后者**，只能分两次调用。
 *    但两次调用是「每页固定 2 次」而不是「每提交 1 次」——早期实现给每个提交单独
 *    跑 numstat，30 条提交 = 30 次进程，实测近 20 秒；现为 2 次，毫秒级。
 */
export async function getGitLog(
  inputRoot: string,
  options: { limit?: number; skip?: number } = {},
): Promise<GitLogResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { entries: [], hasMore: false };
  const root = repo.root;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LOG_PAGE, 1), MAX_LOG_ENTRIES);
  const skip = Math.max(options.skip ?? 0, 0);
  const range = [`--max-count=${limit + 1}`, `--skip=${skip}`];

  const [metaResult, fileResult, statResult] = await Promise.all([
    runGit(
      root,
      ['log', ...range, '--format=%x01%H%x01%h%x01%an%x01%ae%x01%ct%x01%P%x01%s'],
      25_000,
    ),
    runGit(root, ['log', ...range, '--name-status', '--format=%x01%H'], 25_000),
    runGit(root, ['log', ...range, '--numstat', '--format=%x01%H'], 25_000),
  ]);
  if (!metaResult.ok) return { entries: [], hasMore: false };

  const entries: GitLogEntry[] = [];
  const byHash = new Map<string, GitLogEntry>();
  for (const line of metaResult.stdout.split('\n')) {
    const clean = line.replace(/\r$/, '');
    if (!clean.startsWith('\x01')) continue;
    const [, hash, shortHash, author, email, committedAt, parents, subject] = clean.split('\x01');
    if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) continue;
    const entry: GitLogEntry = {
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      subject: subject ?? '',
      author: author ?? '',
      email: email ?? '',
      committedAt: Number.parseInt(committedAt ?? '0', 10) || 0,
      parentCount: parents ? parents.trim().split(/\s+/).filter(Boolean).length : 0,
      pushed: false,
      files: [],
      stats: { added: 0, removed: 0 },
      truncated: false,
    };
    entries.push(entry);
    byHash.set(hash, entry);
  }

  /** 共用解析：`\x01<hash>` 开头的行是记录边界，其余按制表符切列。 */
  const scan = (stdout: string, onRow: (entry: GitLogEntry, columns: string[]) => void) => {
    let current: GitLogEntry | null = null;
    for (const line of stdout.split('\n')) {
      const clean = line.replace(/\r$/, '');
      if (!clean) continue;
      if (clean.startsWith('\x01')) {
        current = byHash.get(clean.slice(1).trim()) ?? null;
        continue;
      }
      if (!current) continue;
      const columns = clean.split('\t');
      if (columns.length >= 2) onRow(current, columns);
    }
  };

  scan(fileResult.stdout, (entry, columns) => {
    if (!/^[A-Z]\d*$/.test(columns[0] ?? '')) return;
    if (entry.files.length >= MAX_FILES_PER_COMMIT) {
      entry.truncated = true;
      return;
    }
    const status = columns[0];
    const marker = status[0] ?? 'M';
    const filePath = columns.at(-1) ?? '';
    if (!filePath) return;
    entry.files.push({
      path: filePath.replace(/\\/g, '/'),
      kind:
        marker === 'A'
          ? 'added'
          : marker === 'D'
            ? 'deleted'
            : marker === 'R'
              ? 'renamed'
              : 'modified',
      group: 'staged',
      code: status,
      ...(marker === 'R' && columns.length >= 3
        ? { fromPath: (columns[1] ?? '').replace(/\\/g, '/') }
        : {}),
    });
  });

  scan(statResult.stdout, (entry, columns) => {
    // numstat：`<added>\t<removed>\t<path>`，二进制两侧均为 `-`
    if (!/^(\d+|-)$/.test(columns[0] ?? '')) return;
    if (columns[0] !== '-') entry.stats.added += Number.parseInt(columns[0] ?? '0', 10) || 0;
    if (columns[1] !== '-') entry.stats.removed += Number.parseInt(columns[1] ?? '0', 10) || 0;
  });

  const hasMore = entries.length > limit;
  return { entries: entries.slice(0, limit), hasMore };
}

async function showAtRevision(
  root: string,
  revision: string,
  filePath: string,
): Promise<string | undefined> {
  const result = await runGit(
    root,
    ['show', `${revision}:${filePath.replace(/\\/g, '/')}`],
    12_000,
  );
  if (!result.ok) return undefined;
  return result.stdout;
}

/**
 * NewMax `git:fileDiff`：单文件前后文本。
 * `staged` 为 true 时比较 HEAD 与 index，否则比较 index 与工作区。
 */
export async function getFileDiff(
  inputRoot: string,
  filePath: string,
  options: { staged?: boolean } = {},
): Promise<GitFileDiff | null> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return null;
  const root = repo.root;
  const safe = safePaths(root, [filePath]);
  if (!safe) return null;
  const relative = safe[0];

  const staged = options.staged === true;
  let before: string | undefined;
  let after: string | undefined;

  if (staged) {
    before = await showAtRevision(root, 'HEAD', relative);
    after = await showAtRevision(root, '', relative);
    after ??= '';
    before ??= '';
  } else {
    before = await showAtRevision(root, '', relative);
    if (before === undefined) before = await showAtRevision(root, 'HEAD', relative);
    const absolute = insideRoot(root, relative);
    if (absolute && existsSync(absolute)) after = readTextCapped(absolute).content;
    else after = '';
  }

  const binary = [before, after].some((text) => text !== undefined && text.includes('\0'));
  const stats = await readNumstat(
    root,
    staged ? ['--cached', '--', literalPathspec(relative)] : ['--', literalPathspec(relative)],
  );
  return {
    path: relative,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    binary,
    stats,
  };
}

/** NewMax `commitFileDiff`：某提交中某文件相对其父的差异。 */
export async function getCommitFileDiff(
  inputRoot: string,
  hash: string,
  filePath: string,
): Promise<GitCommitFileDiff | null> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return null;
  const root = repo.root;
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return null;
  const safe = safePaths(root, [filePath]);
  if (!safe) return null;
  const relative = safe[0];
  const before = await showAtRevision(root, `${hash}^`, relative);
  const after = await showAtRevision(root, hash, relative);
  const stats = await readNumstat(root, [`${hash}^`, hash, '--', literalPathspec(relative)]);
  return {
    hash,
    path: relative,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    binary: [before, after].some((text) => text !== undefined && text.includes('\0')),
    stats,
  };
}

/** 大文件按行分页读取（NewMax `fileLines`）。 */
export async function getFileLines(
  inputRoot: string,
  filePath: string,
  options: { offset?: number; limit?: number; revision?: string } = {},
): Promise<{ lines: string[]; offset: number; totalLines: number; nextOffset?: number } | null> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return null;
  const root = repo.root;
  const safe = safePaths(root, [filePath]);
  if (!safe) return null;
  const relative = safe[0];
  const text = options.revision
    ? await showAtRevision(root, options.revision, relative)
    : (() => {
        const absolute = insideRoot(root, relative);
        return absolute && existsSync(absolute) ? readTextCapped(absolute).content : undefined;
      })();
  if (text === undefined || text.includes('\0')) return null;
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1_000);
  const lines = all.slice(offset, offset + limit);
  const end = offset + lines.length;
  return {
    lines,
    offset,
    totalLines: all.length,
    ...(end < all.length ? { nextOffset: end } : {}),
  };
}

// ─── 同步 ────────────────────────────────────────────────────────────────────

export async function pushBranch(
  root: string,
  options: { force?: boolean } = {},
): Promise<GitPushResult> {
  const branchResult = await runGit(root, ['branch', '--show-current']);
  const branch = branchResult.stdout.trim();
  if (!branch) return { ok: false, pushed: false, error: '当前处于 detached HEAD' };
  const upstream = await runGit(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  const args = options.force ? ['push', '--force-with-lease'] : ['push'];
  const pushed = upstream.ok
    ? await runGit(root, args, 60_000)
    : await (async () => {
        const remotes = await runGit(root, ['remote']);
        const names = remotes.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const remote = names.includes('origin') ? 'origin' : names[0];
        if (!remote) return { ok: false, stdout: '', stderr: '未配置 Git remote' };
        return runGit(root, [...args, '--set-upstream', remote, branch], 60_000);
      })();
  if (pushed.ok) return { ok: true, pushed: true, error: null };
  const message = actionError(pushed, '未知错误');
  // NewMax `pushRejectedTitle` / `pullThenPush`。
  const rejected = /rejected|non-fast-forward|fetch first|behind/i.test(message);
  return {
    ok: false,
    pushed: false,
    error: `推送失败：${message}`,
    ...(rejected ? { rejected: true } : {}),
  };
}

export async function pushRepository(
  inputRoot: string,
  options: { force?: boolean } = {},
): Promise<GitPushResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, pushed: false, error: '项目文件夹不存在' };
  return pushBranch(repo.root, options);
}

/**
 * 拉取。工作区脏时按 NewMax 的做法先 stash，拉取后再恢复
 * （`pullDirtyTitle` / `stashAndPull` / `pullStashPopConflict`）。
 */
export async function pullRepository(
  inputRoot: string,
  options: { strategy?: 'check' | 'stash' } = {},
): Promise<GitPullResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, pulled: false, error: '项目文件夹不存在' };
  }
  const root = repo.root;
  const strategy = options.strategy ?? 'check';
  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const dirty = parsePorcelainZ(statusResult.stdout).length > 0;
  if (dirty && strategy === 'check') {
    return { ok: false, pulled: false, error: null };
  }

  let stashed = false;
  if (dirty && strategy === 'stash') {
    const stash = await runGit(root, ['stash', 'push', '-u', '-m', 'sync-think: pull']);
    if (!stash.ok) {
      return { ok: false, pulled: false, error: `暂存改动失败：${actionError(stash, '未知错误')}` };
    }
    stashed = true;
  }

  const pulled = await runGit(root, ['pull', '--ff-only'], 90_000);
  if (!pulled.ok) {
    const message = actionError(pulled, '未知错误');
    return {
      ok: false,
      pulled: false,
      error: `拉取失败：${message}`,
      ...(stashed ? { stashed: true } : {}),
      ...(/conflict/i.test(message) ? { conflict: true } : {}),
    };
  }

  let stashConflict = false;
  if (stashed) {
    const pop = await runGit(root, ['stash', 'pop'], 60_000);
    if (!pop.ok) stashConflict = true;
  }
  return {
    ok: true,
    pulled: true,
    error: null,
    ...(stashed ? { stashed: true } : {}),
    ...(stashConflict ? { stashConflict: true } : {}),
  };
}

export async function fetchRepository(inputRoot: string): Promise<GitFetchResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, fetched: false, error: '项目文件夹不存在', ahead: 0, behind: 0 };
  }
  const root = repo.root;
  const remotes = await runGit(root, ['remote']);
  if (!remotes.stdout.trim()) {
    return { ok: false, fetched: false, error: '未配置 Git remote', ahead: 0, behind: 0 };
  }
  const fetched = await runGit(root, ['fetch', '--prune'], 90_000);
  if (!fetched.ok) {
    return {
      ok: false,
      fetched: false,
      error: `获取失败：${actionError(fetched, '未知错误')}`,
      ahead: 0,
      behind: 0,
    };
  }
  const sync = await readAheadBehind(root);
  return {
    ok: true,
    fetched: true,
    error: null,
    fetchedAt: Math.floor(Date.now() / 1000),
    ahead: sync.ahead,
    behind: sync.behind,
  };
}

// ─── 身份 ────────────────────────────────────────────────────────────────────

export async function readIdentity(
  inputRoot: string,
  scope: GitIdentityScope = 'local',
): Promise<GitIdentityResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, error: '项目文件夹不存在', identity: { name: '', email: '' }, scope };
  }
  const root = repo.root;
  const flag = scope === 'global' ? '--global' : '--local';
  const [name, email, effectiveName, effectiveEmail] = await Promise.all([
    runGit(root, ['config', flag, '--get', 'user.name'], 8_000),
    runGit(root, ['config', flag, '--get', 'user.email'], 8_000),
    runGit(root, ['config', '--includes', '--get', 'user.name'], 8_000),
    runGit(root, ['config', '--includes', '--get', 'user.email'], 8_000),
  ]);
  // Git exits with 1 for an unset key; malformed/inaccessible config is an error.
  const failed = [name, email, effectiveName, effectiveEmail].find(
    (result) => !result.ok && result.exitCode !== 1,
  );
  return {
    ok: !failed,
    error: failed ? actionError(failed, '读取 Git 身份失败') : null,
    scope,
    identity: { name: name.stdout.trim(), email: email.stdout.trim() },
    effectiveIdentity: { name: effectiveName.stdout.trim(), email: effectiveEmail.stdout.trim() },
  };
}

export async function writeIdentity(
  inputRoot: string,
  scope: GitIdentityScope,
  identity: { name: string; email: string },
): Promise<GitIdentityResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, error: '项目文件夹不存在', identity: { name: '', email: '' }, scope };
  }
  const root = repo.root;
  const name = identity.name.trim();
  const email = identity.email.trim();
  if (/[\r\n\0]/.test(name + email)) {
    return { ok: false, error: '姓名和邮箱请使用单行文本', identity: { name, email }, scope };
  }
  const flag = scope === 'global' ? '--global' : '--local';
  for (const [key, value] of [['user.name', name], ['user.email', email]]) {
    const result = await runGit(
      root,
      value ? ['config', flag, '--replace-all', key, value] : ['config', flag, '--unset-all', key],
      8_000,
    );
    // An empty field removes the override. Exit 5 means there was no key to remove.
    if (!result.ok && !(value === '' && result.exitCode === 5)) {
      return {
        ok: false,
        error: '保存失败：' + actionError(result, '请检查 Git 配置文件'),
        identity: { name, email },
        scope,
      };
    }
  }
  return readIdentity(root, scope);
}

// ─── worktree ────────────────────────────────────────────────────────────────

/** 解析 `git worktree list --porcelain`。 */
function parseWorktreeList(stdout: string): Array<{ path: string; branch: string | null }> {
  const results: Array<{ path: string; branch: string | null }> = [];
  let current: { path?: string; branch: string | null } | null = null;
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      if (current?.path) results.push({ path: current.path, branch: current.branch ?? null });
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      // 形如 `branch refs/heads/feature/x`
      current.branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.branch = null;
    }
  }
  if (current?.path) results.push({ path: current.path, branch: current.branch ?? null });
  return results;
}

/**
 * 列出全部 worktree，并附带各自未提交改动数。
 * 对应 NewMax `git:worktrees` 与 `worktree` 分组文案。
 */
export async function listWorktrees(inputRoot: string): Promise<GitWorktreeList> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { worktrees: [], repoName: '' };
  const root = repo.root;
  const result = await runGit(root, ['worktree', 'list', '--porcelain'], 12_000);
  if (!result.ok) return { worktrees: [], repoName: path.basename(root) };

  const raw = parseWorktreeList(result.stdout);
  const active = canonicalizeSafe(inputRoot);
  const worktrees: GitWorktree[] = [];
  for (const entry of raw) {
    let changeCount = 0;
    try {
      // 逐个 worktree 统计未提交数（NewMax `removeDirty` 需要）。
      const status = await runGit(
        entry.path,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        8_000,
      );
      if (status.ok) changeCount = parsePorcelainZ(status.stdout).length;
    } catch {
      // worktree 目录可能已被外部删除。
    }
    const canonicalEntry = canonicalizeSafe(entry.path);
    worktrees.push({
      path: entry.path,
      name: path.basename(entry.path),
      main: worktrees.length === 0,
      branch: entry.branch,
      changeCount,
      active: canonicalEntry === active,
    });
  }
  return { worktrees, repoName: path.basename(root) };
}

/** 归一化但容忍失败（worktree 路径可能已不存在）。 */
function canonicalizeSafe(target: string): string {
  try {
    return path.resolve(realpathSync.native(target));
  } catch {
    return path.resolve(target);
  }
}

/**
 * 新建 worktree。对应 NewMax `worktree.create` / `createHint`。
 * 不指定分支时按当前 HEAD 派生一个新分支。
 */
export async function addWorktree(
  inputRoot: string,
  options: { path: string; branch?: string; newBranch?: string } = { path: '' },
): Promise<GitWorktreeAddResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const target = options.path.trim();
  if (!target) return { ok: false, error: '请提供 worktree 路径' };
  if (existsSync(target)) return { ok: false, error: '目标路径已存在' };

  const args = ['worktree', 'add'];
  let branch = options.branch?.trim();
  if (options.newBranch?.trim()) {
    const name = await validateBranchName(root, options.newBranch.trim());
    if (!name) return { ok: false, error: '分支名称无效' };
    branch = name;
    args.push('-b', name);
  }
  args.push(target);
  if (branch && !options.newBranch) args.push(branch);

  const created = await runGit(root, args, 60_000);
  if (!created.ok) {
    return { ok: false, error: `创建 worktree 失败：${actionError(created, '未知错误')}` };
  }
  return { ok: true, error: null, path: target, ...(branch ? { branch } : {}) };
}

/**
 * 移除 worktree。对应 NewMax `removeTitle` / `removeDescription` /
 * `removeDirty` / `removeDeleteBranch`。
 *
 * `force` 用于用户已确认「树里有未提交改动会丢失」的场景。
 */
export async function removeWorktree(
  inputRoot: string,
  options: { path: string; force?: boolean; deleteBranch?: boolean },
): Promise<GitWorktreeRemoveResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const target = options.path.trim();
  if (!target) return { ok: false, error: '请提供 worktree 路径' };

  // 主工作区不允许移除。
  const list = await listWorktrees(root);
  const entry = list.worktrees.find(
    (item) => canonicalizeSafe(item.path) === canonicalizeSafe(target),
  );
  if (entry?.main) return { ok: false, error: '主工作区不能移除' };
  if (entry && entry.changeCount > 0 && !options.force) {
    return { ok: false, error: `这棵树里还有 ${entry.changeCount} 个未提交改动，移除后会丢失。` };
  }

  const args = ['worktree', 'remove'];
  if (options.force) args.push('--force');
  args.push(target);
  const removed = await runGit(root, args, 60_000);
  if (!removed.ok) {
    // 目录被外部删除时 git 会报错但仍需清理元数据。
    await runGit(root, ['worktree', 'prune'], 30_000);
    return { ok: false, error: `移除 worktree 失败：${actionError(removed, '未知错误')}` };
  }

  if (options.deleteBranch && entry?.branch) {
    // 未合并的提交会一并丢失，调用方需在 UI 明确告知。
    await runGit(root, ['branch', '-D', entry.branch], 30_000);
  }
  return { ok: true, error: null, removed: true };
}

// ─── 合并 ────────────────────────────────────────────────────────────────────

/** 读取当前合并状态；无合并时返回 undefined。 */
async function readMergeState(
  root: string,
  currentBranch: string | null,
): Promise<GitMergeState | undefined> {
  const gitDir = await gitDirOf(root);
  if (!gitDir) return undefined;
  const merging = existsSync(path.join(gitDir, 'MERGE_HEAD'));
  if (!merging) return undefined;
  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const files = toFileChanges(parsePorcelainZ(statusResult.stdout));
  const conflicts = files.filter((file) => file.group === 'conflicted');
  return {
    ...(currentBranch ? { targetBranch: currentBranch } : {}),
    conflicts,
    resolved: conflicts.length === 0,
    merging: true,
  };
}

/** 合并预览：先做一次 `--no-commit --no-ff` 试合并，随后立即中止。 */
export async function previewMerge(inputRoot: string, branch: string): Promise<GitMergeResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const target = await validateBranchName(root, branch);
  if (!target) return { ok: false, error: '分支名称无效' };

  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  if (parsePorcelainZ(statusResult.stdout).length > 0) {
    return { ok: false, error: '工作区有未提交改动，无法预览合并', conflict: false };
  }

  // 逐文件判定是否会产生冲突：`merge-tree` 无副作用，适合做预览。
  const probe = await runGit(root, ['merge-tree', '--write-tree', 'HEAD', target], 30_000);
  if (!probe.ok) {
    // 旧版 git 不支持 --write-tree 时退回简化判定。
    const base = await runGit(root, ['merge-base', 'HEAD', target], 12_000);
    if (!base.ok) return { ok: false, error: '无法比较两个分支', conflict: false };
    return { ok: true, error: null, merged: false, conflict: false, conflicts: [] };
  }
  // merge-tree 冲突时输出以 `CONFLICT` 开头的行。
  const conflictLines = probe.stdout
    .split('\n')
    .filter((line) => line.startsWith('CONFLICT')).length;
  return {
    ok: true,
    error: null,
    merged: false,
    conflict: conflictLines > 0,
    conflicts: [],
  };
}

/**
 * 合并分支。对应 NewMax `mergeInto` / `mergeConflictsTitle` /
 * `mergeConflictsDescription`。
 *
 * 冲突时不回滚：保留冲突现场供 UI 逐文件解决，与 NewMax 的行为一致。
 */
export async function mergeBranch(inputRoot: string, branch: string): Promise<GitMergeResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const target = await validateBranchName(root, branch);
  if (!target) return { ok: false, error: '分支名称无效' };

  const merged = await runGit(root, ['merge', '--no-edit', target], 90_000);
  const currentResult = await runGit(root, ['branch', '--show-current'], 8_000);
  const currentBranch = currentResult.stdout.trim() || null;

  if (merged.ok) {
    return { ok: true, error: null, merged: true, conflict: false, conflicts: [] };
  }

  // 冲突：保留现场，返回冲突文件供 UI 展示。
  const state = await readMergeState(root, currentBranch);
  if (state) {
    return {
      ok: false,
      error: null,
      merged: false,
      conflict: true,
      conflicts: state.conflicts,
    };
  }
  return { ok: false, error: `合并失败：${actionError(merged, '未知错误')}`, merged: false };
}

/** 放弃合并（NewMax `abortMerge` / `abortMergeSuccess`）。 */
export async function abortMerge(inputRoot: string): Promise<GitActionResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return { ok: false, error: '项目文件夹不存在' };
  const root = repo.root;
  const result = await runGit(root, ['merge', '--abort'], 60_000);
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: `放弃合并失败：${actionError(result, '未知错误')}` };
}

/**
 * 提交合并（NewMax `commitMerge` / `commitMergeConflicts`）。
 * 仍有冲突时拒绝提交并给出明确原因。
 */
export async function commitMerge(
  inputRoot: string,
  options: { message?: string } = {},
): Promise<GitCommitResult> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) {
    return { ok: false, committed: false, pushed: false, error: '项目文件夹不存在' };
  }
  const root = repo.root;
  const currentResult = await runGit(root, ['branch', '--show-current'], 8_000);
  const state = await readMergeState(root, currentResult.stdout.trim() || null);
  if (!state) {
    return { ok: false, committed: false, pushed: false, error: '当前没有进行中的合并' };
  }
  if (!state.resolved) {
    // NewMax `commitMergeConflicts`
    return {
      ok: false,
      committed: false,
      pushed: false,
      error: '还有未解决的冲突，解决后才能提交合并',
    };
  }

  const gitDir = await gitDirOf(root);
  let subject = options.message?.trim() ?? '';
  if (!subject && gitDir) {
    // 沿用 git 的默认合并标题（`Merge branch 'x'`）。
    try {
      const head =
        readFileSync(path.join(gitDir, 'MERGE_HEAD'), 'utf8').trim().split('\n')[0] ?? '';
      const name = await runGit(root, ['name-rev', '--name-only', head], 8_000);
      const branchName = name.stdout.trim();
      if (branchName) subject = `Merge branch '${branchName}'`;
    } catch {
      // 读不到就用兜底标题。
    }
  }
  if (!subject) subject = 'Merge branch';

  const committed = await runGit(root, ['commit', '--no-edit', '-m', subject], 60_000);
  if (!committed.ok) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      error: `提交合并失败：${actionError(committed, '未知错误')}`,
    };
  }
  const head = await runGit(root, ['rev-parse', '--short', 'HEAD'], 8_000);
  return {
    ok: true,
    committed: true,
    pushed: false,
    error: null,
    ...(head.ok && head.stdout.trim() ? { hash: head.stdout.trim() } : {}),
  };
}

// ─── 仓库监听 ────────────────────────────────────────────────────────────────

export interface GitWatchHandle {
  dispose(): void;
}

/**
 * NewMax `git:watch` / `git:unwatch`：监听仓库元数据变化，代替轮询。
 * 监听 HEAD / index / refs 与操作标记文件；事件做去抖后回调。
 */
export async function watchRepository(
  inputRoot: string,
  onChange: () => void,
): Promise<GitWatchHandle | null> {
  const repo = await resolveRepository(inputRoot);
  if (!repo.isRepo || !repo.root) return null;
  const gitDir = await gitDirOf(repo.root);
  if (!gitDir || !existsSync(gitDir)) return null;

  // Keep ignored build/runtime output from continuously refreshing the review UI.
  // --directory collapses ignored trees; tracked files remain eligible for updates.
  let ignoredPaths: string[] = [];
  const refreshIgnoredPaths = async () => {
    const result = await runGit(
      repo.root!,
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
      8_000,
    );
    if (result.ok) ignoredPaths = result.stdout.split('\0').filter(Boolean);
  };
  await refreshIgnoredPaths();
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(), 220);
  };

  const watchPath = (target: string) => {
    if (!existsSync(target)) return;
    try {
      watchers.push(watch(target, { persistent: false }, debounced));
    } catch {
      // 某些文件系统不支持监听；忽略即可，UI 仍有手动刷新。
    }
  };
  watchPath(gitDir);
  watchPath(path.join(gitDir, 'refs'));
  watchPath(path.join(gitDir, 'refs', 'heads'));
  // Working files may change without touching the Git index (agent/editor writes).
  try {
    watchers.push(
      watch(repo.root, { persistent: false, recursive: true }, (_event, file) => {
        const segments = String(file ?? '')
          .replace(/\\/g, '/')
          .split('/');
        if (segments.some((segment) => segment === '.git')) return;
        const relative = segments.join('/');
        if (segments.at(-1) === '.gitignore') void refreshIgnoredPaths();
        if (
          ignoredPaths.some((ignored) =>
            ignored.endsWith('/')
              ? relative === ignored.slice(0, -1) || relative.startsWith(ignored)
              : relative === ignored,
          )
        )
          return;
        debounced();
      }),
    );
  } catch {
    watchPath(repo.root);
  }
  // Worktree refs live in a shared Git directory while HEAD/index remain local.
  const common = await runGit(repo.root, ['rev-parse', '--git-common-dir'], 8_000);
  if (common.ok) {
    const commonDir = path.resolve(repo.root, common.stdout.trim());
    if (commonDir !== gitDir) {
      watchPath(commonDir);
      watchPath(path.join(commonDir, 'refs'));
    }
  }

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // 忽略关闭失败。
        }
      }
      watchers.length = 0;
    },
  };
}
