import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  ulid,
  type BrowserIdentity,
  type BrowserIdentityId,
  type RunId,
  type TaskExecutionContext,
  type TaskId,
} from '@sync-think/shared';
import type {
  SqliteExecutionEnvironmentStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export interface TaskExecutionEnvironmentManagerOptions {
  store: SqliteExecutionEnvironmentStore;
  workspaceStore: SqliteWorkspaceStore;
  worktreeRoot: string;
  repositoryCacheRoot: string;
  browserProfileRoot: string;
}

export interface TaskWorktreeIntegrationResult {
  baseRef?: string;
  headRef?: string;
  changedFiles: string[];
  integrationStatus:
    | 'not-applicable'
    | 'clean'
    | 'pending-integration'
    | 'integrated'
    | 'conflicted'
    | 'kept-parent';
  integrationCommit?: string;
  targetTaskId?: TaskId;
  conflictFiles?: string[];
  error?: string;
}

export class TaskExecutionEnvironmentManager {
  private readonly preparations = new Map<string, Promise<TaskExecutionContext>>();

  constructor(private readonly options: TaskExecutionEnvironmentManagerOptions) {}

  ensureWorkspaceDefaults(workspaceId: Parameters<SqliteExecutionEnvironmentStore['ensureWorkspaceDefaults']>[0]['workspaceId'], folderPath?: string) {
    return this.options.store.ensureWorkspaceDefaults({
      workspaceId,
      folderPath,
      browserProfilePath: resolve(this.options.browserProfileRoot, 'default'),
    });
  }

  listBrowserIdentities(): BrowserIdentity[] {
    return this.options.store.listBrowserIdentities();
  }

  createBrowserIdentity(name: string, makeDefault = false): BrowserIdentity {
    const id = ulid() as BrowserIdentityId;
    return this.options.store.createBrowserIdentity({
      id,
      name,
      profilePath: resolve(this.options.browserProfileRoot, String(id)),
      isDefault: makeDefault,
    });
  }

  updateBrowserIdentity(
    id: BrowserIdentityId,
    input: { name?: string; makeDefault?: boolean },
  ): BrowserIdentity {
    return this.options.store.updateBrowserIdentity(id, input);
  }

  deleteBrowserIdentity(id: BrowserIdentityId): void {
    const identity = this.options.store.getBrowserIdentity(id);
    this.options.store.deleteBrowserIdentity(id);
    if (identity?.profilePath && existsSync(identity.profilePath)) {
      rmSync(identity.profilePath, { recursive: true, force: true });
    }
  }

  setTaskBrowserIdentity(taskId: TaskId, browserIdentityId: BrowserIdentityId): TaskExecutionContext {
    return this.options.store.setTaskBrowserIdentity(taskId, browserIdentityId);
  }

  prepareTask(taskId: TaskId): TaskExecutionContext {
    const task = this.options.workspaceStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    let context = this.options.store.getTaskContext(taskId);
    if (!context) {
      context = this.options.store.createTaskContext({
        taskId,
        workspaceId: task.workspaceId,
        parentTaskId: task.parentTaskId,
      });
    }
    if (context.state === 'ready' && context.executionPath && existsSync(context.executionPath)) {
      return context;
    }
    const resource = context.resourceId
      ? this.options.store.getRequiredResource(context.resourceId)
      : undefined;
    if (!resource) {
      return this.options.store.markTaskBlocked(taskId, '项目尚未绑定代码目录或 Git 仓库');
    }
    if (!resource.localPath && resource.repositoryUrl) {
      this.startRemotePreparation(taskId);
      return context;
    }
    return this.finishTaskPreparation(taskId, resource.localPath!);
  }

  async prepareTaskAsync(taskId: TaskId): Promise<TaskExecutionContext> {
    const immediate = this.prepareTask(taskId);
    const pending = this.preparations.get(String(taskId));
    return pending ? await pending : immediate;
  }

  private finishTaskPreparation(taskId: TaskId, checkoutSource: string): TaskExecutionContext {
    const task = this.options.workspaceStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const context = this.options.store.getRequiredTaskContext(taskId);
    const resource = context.resourceId
      ? this.options.store.getRequiredResource(context.resourceId)
      : undefined;
    if (!resource) return this.options.store.markTaskBlocked(taskId, '项目尚未绑定代码目录或 Git 仓库');
    const profile = context.executionProfileId
      ? this.options.store.getRequiredProfile(context.executionProfileId)
      : undefined;
    const parentContext = task.parentTaskId
      ? this.options.store.getTaskContext(task.parentTaskId)
      : undefined;
    try {
      const gitRoot = this.findGitRoot(checkoutSource);
      const forceLocal = profile?.mode === 'local';
      if (!gitRoot || forceLocal) {
        if (!resource.localPath) {
          throw new Error('远程 Git 仓库不能使用本地原地执行模式');
        }
        return this.options.store.markTaskReady({
          taskId,
          mode: 'local_serial',
          sourcePath: resource.localPath,
          executionPath: resource.localPath,
          baseRef: resource.defaultRef ?? profile?.defaultRef,
        });
      }
      if (resource.type !== 'git_repository') {
        this.options.store.promoteResourceToGit(resource.id, resource.defaultRef);
      }
      const snapshotSource = parentContext?.executionPath ?? resource.localPath;
      const baseRef = resource.defaultRef ?? profile?.defaultRef ?? 'HEAD';
      const target = resolve(this.options.worktreeRoot, String(task.workspaceId), String(task.id));
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
      this.git(gitRoot, ['worktree', 'add', '--detach', target, baseRef]);
      if (snapshotSource && this.findGitRoot(snapshotSource)) {
        this.copyWorkingSnapshot(snapshotSource, target);
      }
      const initialHead = this.git(target, ['rev-parse', 'HEAD']).trim();
      const headRef = task.parentTaskId
        ? this.createSnapshotCommit(
            target,
            initialHead,
            `SYNC-THINK child baseline ${String(task.id)}`,
          )
        : initialHead;
      return this.options.store.markTaskReady({
        taskId,
        mode: 'managed_worktree',
        sourcePath: gitRoot,
        executionPath: target,
        baseRef,
        headRef,
      });
    } catch (error) {
      return this.options.store.markTaskBlocked(
        taskId,
        error instanceof Error ? error.message : '任务执行环境准备失败',
      );
    }
  }

  private startRemotePreparation(taskId: TaskId): void {
    const key = String(taskId);
    if (this.preparations.has(key)) return;
    const context = this.options.store.getRequiredTaskContext(taskId);
    const resource = context.resourceId
      ? this.options.store.getRequiredResource(context.resourceId)
      : undefined;
    if (!resource?.repositoryUrl) return;
    const preparation = this.resolveRemoteSource(resource.repositoryUrl)
      .then((checkoutSource) => this.finishTaskPreparation(taskId, checkoutSource))
      .catch((error) =>
        this.options.store.markTaskBlocked(
          taskId,
          error instanceof Error ? error.message : '远程 Git 仓库准备失败',
        ),
      )
      .finally(() => this.preparations.delete(key));
    this.preparations.set(key, preparation);
  }

  acquireWriteLease(taskId: TaskId, runId: RunId): TaskExecutionContext {
    const context = this.prepareTask(taskId);
    if (context.state !== 'ready') {
      throw new Error(context.blockedReason ?? 'task.execution_environment_blocked');
    }
    return this.options.store.acquireWriteLease(taskId, runId);
  }

  releaseWriteLease(taskId: TaskId, runId: RunId): TaskExecutionContext {
    return this.options.store.releaseWriteLease(taskId, runId);
  }

  describeTaskChanges(taskId: TaskId): {
    baseRef?: string;
    headRef?: string;
    changedFiles: string[];
    integrationStatus: 'not-applicable' | 'clean' | 'pending-integration';
  } {
    const context = this.options.store.getRequiredTaskContext(taskId);
    if (context.mode !== 'managed_worktree' || !context.executionPath) {
      return {
        baseRef: context.baseRef,
        headRef: context.headRef,
        changedFiles: [],
        integrationStatus: 'not-applicable',
      };
    }
    const headRef = this.git(context.executionPath, ['rev-parse', 'HEAD']).trim();
    const changedFiles = this.git(context.executionPath, ['status', '--porcelain'])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    return {
      baseRef: context.baseRef,
      headRef,
      changedFiles,
      integrationStatus: changedFiles.length > 0 ? 'pending-integration' : 'clean',
    };
  }

  integrateChildTask(taskId: TaskId): TaskWorktreeIntegrationResult {
    const task = this.options.workspaceStore.getTask(taskId);
    const context = this.options.store.getRequiredTaskContext(taskId);
    if (!task?.parentTaskId || context.mode !== 'managed_worktree' || !context.executionPath) {
      return {
        baseRef: context.baseRef,
        headRef: context.headRef,
        changedFiles: [],
        integrationStatus: 'not-applicable',
      };
    }
    const parentContext = this.options.store.getTaskContext(task.parentTaskId);
    if (!parentContext?.executionPath || !this.findGitRoot(parentContext.executionPath)) {
      return {
        baseRef: context.baseRef,
        headRef: context.headRef,
        changedFiles: [],
        integrationStatus: 'pending-integration',
        targetTaskId: task.parentTaskId,
        error: '父任务没有可用的 Git 执行位置',
      };
    }
    const baseline = context.headRef ?? this.git(context.executionPath, ['rev-parse', 'HEAD']).trim();
    const resultCommit = this.createSnapshotCommit(
      context.executionPath,
      baseline,
      `SYNC-THINK child result ${String(task.id)}`,
    );
    const changedFiles = this.git(context.executionPath, [
      'diff',
      '--name-only',
      baseline,
      resultCommit,
    ])
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (resultCommit === baseline || changedFiles.length === 0) {
      return {
        baseRef: context.baseRef,
        headRef: resultCommit,
        changedFiles: [],
        integrationStatus: 'clean',
        targetTaskId: task.parentTaskId,
      };
    }

    const parentHead = this.git(parentContext.executionPath, ['rev-parse', 'HEAD']).trim();
    this.createSnapshotCommit(
      parentContext.executionPath,
      parentHead,
      `SYNC-THINK parent checkpoint ${String(task.parentTaskId)}`,
    );
    try {
      this.git(parentContext.executionPath, [
        '-c',
        'user.name=SYNC-THINK',
        '-c',
        'user.email=sync-think@local.invalid',
        'cherry-pick',
        '--no-gpg-sign',
        resultCommit,
      ]);
      return {
        baseRef: context.baseRef,
        headRef: resultCommit,
        changedFiles,
        integrationStatus: 'integrated',
        integrationCommit: this.git(parentContext.executionPath, ['rev-parse', 'HEAD']).trim(),
        targetTaskId: task.parentTaskId,
      };
    } catch (error) {
      const conflictFiles = this.conflictFiles(parentContext.executionPath);
      return {
        baseRef: context.baseRef,
        headRef: resultCommit,
        changedFiles,
        integrationStatus: 'conflicted',
        targetTaskId: task.parentTaskId,
        conflictFiles,
        error: error instanceof Error ? error.message : '子任务结果集成冲突',
      };
    }
  }

  resolveChildIntegration(
    taskId: TaskId,
    strategy: 'accept-child' | 'keep-parent',
  ): TaskWorktreeIntegrationResult {
    const task = this.options.workspaceStore.getTask(taskId);
    if (!task?.parentTaskId) throw new Error('Only child tasks have integration state');
    const childContext = this.options.store.getRequiredTaskContext(taskId);
    const parentContext = this.options.store.getRequiredTaskContext(task.parentTaskId);
    if (!parentContext.executionPath) throw new Error('Parent task execution location is unavailable');
    const conflictFiles = this.conflictFiles(parentContext.executionPath);
    if (conflictFiles.length === 0) throw new Error('No worktree integration conflict is active');
    if (strategy === 'keep-parent') {
      this.git(parentContext.executionPath, ['cherry-pick', '--abort']);
      return {
        baseRef: childContext.baseRef,
        headRef: childContext.headRef,
        changedFiles: [],
        integrationStatus: 'kept-parent',
        targetTaskId: task.parentTaskId,
      };
    }
    this.git(parentContext.executionPath, ['checkout', '--theirs', '--', ...conflictFiles]);
    this.git(parentContext.executionPath, ['add', '--', ...conflictFiles]);
    this.git(parentContext.executionPath, [
      '-c',
      'user.name=SYNC-THINK',
      '-c',
      'user.email=sync-think@local.invalid',
      'cherry-pick',
      '--continue',
    ]);
    return {
      baseRef: childContext.baseRef,
      headRef: childContext.headRef,
      changedFiles: conflictFiles,
      integrationStatus: 'integrated',
      integrationCommit: this.git(parentContext.executionPath, ['rev-parse', 'HEAD']).trim(),
      targetTaskId: task.parentTaskId,
    };
  }

  scheduleCleanup(taskId: TaskId): TaskExecutionContext {
    const context = this.options.store.getRequiredTaskContext(taskId);
    const profile = context.executionProfileId
      ? this.options.store.getRequiredProfile(context.executionProfileId)
      : undefined;
    return this.options.store.scheduleCleanup(taskId, profile?.retentionDays ?? 7);
  }

  discardPreparedTask(taskId: TaskId): void {
    this.preparations.delete(String(taskId));
    const context = this.options.store.getTaskContext(taskId);
    if (
      context?.mode !== 'managed_worktree' ||
      !context.executionPath ||
      !existsSync(context.executionPath)
    ) {
      return;
    }
    try {
      if (context.sourcePath) {
        this.git(context.sourcePath, ['worktree', 'remove', '--force', context.executionPath]);
      } else if (isInside(this.options.worktreeRoot, context.executionPath)) {
        rmSync(context.executionPath, { recursive: true, force: true });
      }
    } catch {
      if (isInside(this.options.worktreeRoot, context.executionPath)) {
        rmSync(context.executionPath, { recursive: true, force: true });
      }
    }
  }

  cleanupExpired(now = new Date()): TaskExecutionContext[] {
    const results: TaskExecutionContext[] = [];
    for (const context of this.options.store.listCleanupCandidates(now)) {
      if (context.leaseOwnerRunId) {
        results.push(this.options.store.markCleanupResult(context.taskId, 'retained', '任务仍在运行'));
        continue;
      }
      if (!context.executionPath || !context.sourcePath) {
        results.push(this.options.store.markCleanupResult(context.taskId, 'cleaned'));
        continue;
      }
      try {
        const dirty = this.git(context.executionPath, ['status', '--porcelain']).trim();
        if (dirty) {
          results.push(
            this.options.store.markCleanupResult(context.taskId, 'retained', '工作树存在未提交改动'),
          );
          continue;
        }
        this.git(context.sourcePath, ['worktree', 'remove', '--force', context.executionPath]);
        results.push(this.options.store.markCleanupResult(context.taskId, 'cleaned'));
      } catch (error) {
        results.push(
          this.options.store.markCleanupResult(
            context.taskId,
            'retained',
            error instanceof Error ? error.message : '工作树清理失败',
          ),
        );
      }
    }
    return results;
  }

  private async resolveRemoteSource(repositoryUrl: string): Promise<string> {
    const key = createHash('sha256').update(repositoryUrl).digest('hex').slice(0, 24);
    const cachePath = resolve(this.options.repositoryCacheRoot, `${key}.git`);
    mkdirSync(dirname(cachePath), { recursive: true });
    if (!existsSync(cachePath)) {
      await this.gitAsync(undefined, ['clone', '--mirror', repositoryUrl, cachePath]);
    } else {
      await this.gitAsync(cachePath, ['remote', 'update', '--prune']);
    }
    return cachePath;
  }

  private findGitRoot(path: string): string | undefined {
    try {
      return this.git(path, ['rev-parse', '--show-toplevel']).trim() || resolve(path);
    } catch {
      try {
        return this.git(path, ['rev-parse', '--git-dir']).trim() ? resolve(path) : undefined;
      } catch {
        return undefined;
      }
    }
  }

  private copyWorkingSnapshot(source: string, target: string): void {
    if (resolve(source) === resolve(target)) return;
    const raw = this.git(source, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const records = raw.split('\0').filter(Boolean);
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      if (record.length < 4) continue;
      const status = record.slice(0, 2);
      let relativePath = record.slice(3);
      if (status.includes('R') || status.includes('C')) {
        relativePath = records[++index] ?? relativePath;
      }
      const sourcePath = resolve(source, relativePath);
      const targetPath = resolve(target, relativePath);
      if (!isInside(source, sourcePath) || !isInside(target, targetPath)) continue;
      if (status.includes('D') || !existsSync(sourcePath)) {
        rmSync(targetPath, { recursive: true, force: true });
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      if (statSync(sourcePath).isDirectory()) cpSync(sourcePath, targetPath, { recursive: true });
      else copyFileSync(sourcePath, targetPath);
    }
  }

  private createSnapshotCommit(path: string, parentRef: string, message: string): string {
    this.git(path, ['add', '-A']);
    const tree = this.git(path, ['write-tree']).trim();
    const parentTree = this.git(path, ['rev-parse', `${parentRef}^{tree}`]).trim();
    if (tree === parentTree) {
      this.git(path, ['reset', '--mixed', parentRef]);
      return parentRef;
    }
    const commit = this.git(path, [
      '-c',
      'user.name=SYNC-THINK',
      '-c',
      'user.email=sync-think@local.invalid',
      'commit-tree',
      tree,
      '-p',
      parentRef,
      '-m',
      message,
    ]).trim();
    this.git(path, ['reset', '--mixed', commit]);
    return commit;
  }

  private conflictFiles(path: string): string[] {
    return this.git(path, ['diff', '--name-only', '--diff-filter=U'])
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private git(cwd: string | undefined, args: string[]): string {
    const commandArgs = cwd ? ['-C', cwd, ...args] : args;
    return execFileSync('git', commandArgs, {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private gitAsync(cwd: string | undefined, args: string[]): Promise<string> {
    const commandArgs = cwd ? ['-C', cwd, ...args] : args;
    return new Promise((resolveOutput, reject) => {
      execFile(
        'git',
        commandArgs,
        {
          encoding: 'utf8',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
          windowsHide: true,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_EDITOR: 'true',
            GIT_SEQUENCE_EDITOR: 'true',
          },
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolveOutput(stdout);
        },
      );
    });
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
