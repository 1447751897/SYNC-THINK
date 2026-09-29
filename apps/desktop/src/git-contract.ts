/**
 * Git 工具的共享契约（主进程 / preload / renderer 三方共用）。
 *
 * 类型命名与分组对齐 NewMax 的 `git:*` 通道族与其 i18n 分组
 * （见 docs/newmax-git/SPEC.md 与 i18n.json）：
 * - 文件分组 groups: conflicted / staged / unstaged / untracked
 * - 文件类型 kinds: modified / added / deleted / renamed / untracked / conflicted
 * - 仓库操作 operation: merge / rebase / cherry-pick / revert / bisect
 */

/** NewMax `groups`：文件在改动列表中的归属区块。 */
export type GitFileGroup = 'conflicted' | 'staged' | 'unstaged' | 'untracked';

/** NewMax `kinds`：单个文件的变更类型。 */
export type GitFileKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

/** NewMax `operation`：进行中的仓库操作（用于横幅提示）。 */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

export interface GitFileChange {
  /** 相对仓库根的路径，始终使用 `/` 分隔。 */
  path: string;
  /** 重命名前的路径（仅 `renamed` 有值）。 */
  fromPath?: string;
  kind: GitFileKind;
  group: GitFileGroup;
  /** 原始 porcelain XY 码，供 UI 显示或调试。 */
  code: string;
  /** 是否二进制（决定能否做文本 diff）。 */
  binary?: boolean;
}

export interface GitChangeStats {
  added: number;
  removed: number;
}

export interface GitStatus {
  root?: string;
  remoteName?: string;
  fetchedAt?: number;
  isRepo: boolean;
  /** 当前分支名；游离 HEAD 时为 null。 */
  branch: string | null;
  /** NewMax `banner.detached` / `detachedFrom`。 */
  detached: boolean;
  /** 游离时基于的分支名。 */
  detachedFrom?: string;
  /** 游离时基于的 commit sha（短）。 */
  detachedSha?: string;
  /** 上游分支名（如 `origin/main`）。 */
  upstream?: string;
  /** NewMax `banner.aheadBehindTitle`。 */
  ahead: number;
  behind: number;
  hasRemote: boolean;
  /** 进行中的操作，null 表示空闲。 */
  operation: GitOperation | null;
  files: GitFileChange[];
  stats: GitChangeStats;
  /** NewMax `banner.uncommitted` 的计数来源（按路径去重的改动文件数）。 */
  changeCount: number;
  /** 合并状态（`mergeBannerConflicts` / `mergeBannerResolved` 的数据来源）。 */
  merge?: GitMergeState;
}

/** NewMax `git:changed`：用于横幅的轻量摘要，避免拉全量文件列表。 */
export interface GitChangedSummary {
  isRepo: boolean;
  branch: string | null;
  detached: boolean;
  detachedFrom?: string;
  detachedSha?: string;
  ahead: number;
  behind: number;
  operation: GitOperation | null;
  changeCount: number;
}

/** NewMax `branchMenu`：分支按默认 / 最近 / 其他三组呈现。 */
export type GitBranchGroup = 'default' | 'recent' | 'other';

export interface GitBranch {
  name: string;
  group: GitBranchGroup;
  /** 是否为当前分支。 */
  current: boolean;
  /** 最近提交时间（Unix 秒），用于 recent 分组排序。 */
  committedAt?: number;
  /** 上游分支名（若有）。 */
  upstream?: string;
}

export interface GitBranches {
  /** 当前分支名（游离时为 null）。 */
  current: string | null;
  branches: GitBranch[];
  /** 仓库默认分支（origin/HEAD 指向），用于 `groupDefault`。 */
  defaultBranch?: string;
}

/** NewMax `dirtyTitle` / `dirtyDescription`：脏工作区切换需显式策略。 */
export interface GitCheckoutResult {
  ok: boolean;
  /** 工作区脏、需要用户确认时返回 true，并带上被影响文件。 */
  dirty: boolean;
  files: GitFileChange[];
  /** NewMax `stashPopConflict`：已切换但 stash 恢复冲突。 */
  stashed?: boolean;
  stashConflict?: boolean;
  error: string | null;
}

export interface GitActionResult {
  ok: boolean;
  error: string | null;
}

/** NewMax `lastCommit` / `undoCommit`。 */
export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  email: string;
  /** Unix 秒。 */
  committedAt: number;
  /** 父提交数量，>1 表示合并提交。 */
  parentCount: number;
  /** 是否已推送到上游（用于 `unpushed` 标记）。 */
  pushed: boolean;
  files: GitFileChange[];
  stats: GitChangeStats;
  /** 文件列表是否被截断。 */
  truncated: boolean;
}

export interface GitLogResult {
  entries: GitLogEntry[];
  /** 是否还有更早的提交可拉。 */
  hasMore: boolean;
}

export interface GitCommitResult extends GitActionResult {
  committed: boolean;
  pushed: boolean;
  /** 新提交的短 hash。 */
  hash?: string;
  /** NewMax `nothingStaged`。 */
  nothingStaged?: boolean;
}

/** NewMax `git:fileDiff`：单文件前后文本快照。 */
export interface GitFileDiff {
  path: string;
  /** 缺省表示该侧内容不可得。 */
  before?: string;
  after?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
  binary: boolean;
  stats: GitChangeStats;
}

/** NewMax `commitFileDiff`：某提交中某文件相对其父的差异。 */
export interface GitCommitFileDiff extends GitFileDiff {
  hash: string;
}

/** NewMax `identityLocal` / `identityGlobal`。 */
export type GitIdentityScope = 'local' | 'global';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitIdentityResult extends GitActionResult {
  identity: GitIdentity;
  /** Merged Git configuration used for this repository, including inherited values. */
  effectiveIdentity?: GitIdentity;
  scope: GitIdentityScope;
}

export interface GitPushResult extends GitActionResult {
  pushed: boolean;
  /** NewMax `pushRejectedTitle` / `pullThenPush`：需要先 pull。 */
  rejected?: boolean;
}

export interface GitPullResult extends GitActionResult {
  pulled: boolean;
  /** NewMax `pullMergeConflictStashKept` / `pullStashPopConflict`。 */
  conflict?: boolean;
  stashed?: boolean;
  stashConflict?: boolean;
  updatedFiles?: number;
}

export interface GitFetchResult extends GitActionResult {
  fetched: boolean;
  /** NewMax `lastFetched` 的数据来源。 */
  fetchedAt?: number;
  ahead: number;
  behind: number;
}

/** 仓库根定位结果，供 renderer 判断 Git 面板是否可用。 */
export interface GitRepository {
  isRepo: boolean;
  /** 仓库根绝对路径。 */
  root: string | null;
  /** 当前工作目录相对于仓库根的路径（子目录时非空）。 */
  prefix?: string;
  error: string | null;
}

/** NewMax `worktree`：本地 worktree 条目。 */
export interface GitWorktree {
  /** worktree 绝对路径。 */
  path: string;
  /** 目录名（用于 `workspaceName` 的 `{{name}}`）。 */
  name: string;
  /** 是否为主工作区（对应 `worktree.local` / `current`）。 */
  main: boolean;
  /** checkout 的分支名；游离时为 null。 */
  branch: string | null;
  /** 该 worktree 的未提交改动数（用于 `removeDirty`）。 */
  changeCount: number;
  /** 该 worktree 是否为当前项目文件夹。 */
  active: boolean;
}

export interface GitWorktreeList {
  worktrees: GitWorktree[];
  /** 仓库主目录（用于 `localHint` / `workspaceName`）。 */
  repoName: string;
}

export interface GitWorktreeAddResult extends GitActionResult {
  path?: string;
  branch?: string;
}

export interface GitWorktreeRemoveResult extends GitActionResult {
  removed?: boolean;
}

/** NewMax 合并相关状态。 */
export interface GitMergeState {
  /** 进行中的合并目标分支（`mergeConflictsTitle` 的 `{{branch}}`）。 */
  targetBranch?: string;
  /** 冲突文件。 */
  conflicts: GitFileChange[];
  /** 全部冲突是否已解决（对应 `mergeBannerResolved`）。 */
  resolved: boolean;
  /** 是否处于合并中。 */
  merging: boolean;
}

export interface GitMergeResult extends GitActionResult {
  merged?: boolean;
  /** 出现冲突需人工解决（`mergeBannerConflicts`）。 */
  conflict?: boolean;
  /** 冲突文件列表。 */
  conflicts?: GitFileChange[];
}

/**
 * IPC 通道名。集中定义以免主进程与 preload 两侧字符串漂移。
 * 命名沿用 SYNC-THINK 既有的 `desktop:` 前缀约定。
 */
export const GIT_IPC_CHANNELS = Object.freeze({
  repository: 'desktop:git-repository',
  status: 'desktop:git-status',
  changed: 'desktop:git-changed',
  branches: 'desktop:git-branches',
  checkout: 'desktop:git-checkout',
  createBranch: 'desktop:git-create-branch',
  stage: 'desktop:git-stage',
  unstage: 'desktop:git-unstage',
  discard: 'desktop:git-discard',
  commit: 'desktop:git-commit',
  undoCommit: 'desktop:git-undo-commit',
  log: 'desktop:git-log',
  commitFileDiff: 'desktop:git-commit-file-diff',
  fileDiff: 'desktop:git-file-diff',
  fileLines: 'desktop:git-file-lines',
  push: 'desktop:git-push',
  pull: 'desktop:git-pull',
  fetch: 'desktop:git-fetch',
  readIdentity: 'desktop:git-read-identity',
  writeIdentity: 'desktop:git-write-identity',
  watch: 'desktop:git-watch',
  unwatch: 'desktop:git-unwatch',
  /** 主进程 → renderer 的仓库变更推送。 */
  watched: 'desktop:git-watched',
  // ── worktree（NewMax `git:worktrees` / `addWorktree` / `removeWorktree`）──
  worktrees: 'desktop:git-worktrees',
  addWorktree: 'desktop:git-add-worktree',
  removeWorktree: 'desktop:git-remove-worktree',
  // ── 合并（NewMax `git:merge` / `mergePreview` / `abortMerge`）──
  merge: 'desktop:git-merge',
  mergePreview: 'desktop:git-merge-preview',
  abortMerge: 'desktop:git-abort-merge',
  commitMerge: 'desktop:git-commit-merge',
});

/** 推送载荷：哪个仓库发生了变更。 */
export interface GitWatchedEvent {
  root: string;
}

export interface GitWatchResult {
  ok: boolean;
  error: string | null;
}
