/**
 * Git 通道的 IPC 注册。
 *
 * 单独成模块而不是塞进 `index.ts`：Git 有 20+ 个通道，逐个内联会让本已超过
 * 3000 行的 `index.ts` 进一步膨胀。约定与其它 handler 保持一致：
 * 每个 handler 先做渲染进程来源校验，再逐字段校验 payload，非法即 throw。
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { GIT_IPC_CHANNELS, type GitIdentityScope } from '../git-contract.js';
import {
  abortMerge,
  addWorktree,
  checkoutBranch,
  commitChanges,
  commitMerge,
  createBranch,
  discardFiles,
  fetchRepository,
  getCommitFileDiff,
  getFileDiff,
  getFileLines,
  getGitBranches,
  getGitChanged,
  getGitLog,
  getGitStatus,
  listWorktrees,
  mergeBranch,
  previewMerge,
  pullRepository,
  pushRepository,
  readIdentity,
  removeWorktree,
  resolveRepository,
  stageFiles,
  undoCommit,
  unstageFiles,
  watchRepository,
  writeIdentity,
  type GitWatchHandle,
} from './git-service.js';

export interface GitIpcHost {
  /** 渲染进程来源校验；与其它 handler 共用同一实现。 */
  assertSource(event: IpcMainInvokeEvent): void;
  /** 用于把仓库变更事件推回渲染进程。 */
  mainWindow(): WebContents | null;
}

interface RootPayload {
  root?: unknown;
}

function requireRoot(value: unknown, channel: string): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${channel} payload`);
  }
  const payload = value as RootPayload;
  if (typeof payload.root !== 'string' || !payload.root.trim()) {
    throw new Error(`Invalid ${channel} payload: root required`);
  }
  return payload.root;
}

function asRecord(value: unknown, channel: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${channel} payload`);
  }
  return value as Record<string, unknown>;
}

function requirePaths(record: Record<string, unknown>, channel: string): string[] {
  const raw = record.paths;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ${channel} payload: paths required`);
  }
  return raw as string[];
}

function requireString(record: Record<string, unknown>, key: string, channel: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${channel} payload: ${key} required`);
  }
  return value;
}

/**
 * 注册全部 Git 通道，返回一个释放函数（关闭所有仓库监听）。
 * 由 `setupRuntimeBridge()` 调用一次。
 */
export function registerGitIpc(host: GitIpcHost): () => void {
  const watchers = new Map<string, GitWatchHandle>();

  const disposeWatchers = () => {
    for (const handle of watchers.values()) handle.dispose();
    watchers.clear();
  };

  ipcMain.handle(GIT_IPC_CHANNELS.repository, async (event, value: unknown) => {
    host.assertSource(event);
    return resolveRepository(requireRoot(value, 'git-repository'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.status, async (event, value: unknown) => {
    host.assertSource(event);
    return getGitStatus(requireRoot(value, 'git-status'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.changed, async (event, value: unknown) => {
    host.assertSource(event);
    return getGitChanged(requireRoot(value, 'git-changed'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.branches, async (event, value: unknown) => {
    host.assertSource(event);
    return getGitBranches(requireRoot(value, 'git-branches'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.checkout, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-checkout');
    const root = requireRoot(record, 'git-checkout');
    const branch = requireString(record, 'branch', 'git-checkout');
    const strategy =
      record.strategy === 'stash' || record.strategy === 'force' ? record.strategy : 'check';
    return checkoutBranch(root, branch, strategy);
  });

  ipcMain.handle(GIT_IPC_CHANNELS.createBranch, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-create-branch');
    const root = requireRoot(record, 'git-create-branch');
    const branch = requireString(record, 'branch', 'git-create-branch');
    return createBranch(root, branch);
  });

  ipcMain.handle(GIT_IPC_CHANNELS.stage, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-stage');
    return stageFiles(requireRoot(record, 'git-stage'), requirePaths(record, 'git-stage'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.unstage, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-unstage');
    return unstageFiles(requireRoot(record, 'git-unstage'), requirePaths(record, 'git-unstage'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.discard, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-discard');
    return discardFiles(requireRoot(record, 'git-discard'), requirePaths(record, 'git-discard'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.commit, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-commit');
    return commitChanges(requireRoot(record, 'git-commit'), {
      message: requireString(record, 'message', 'git-commit'),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      stageAll: record.stageAll === true,
      push: record.push === true,
    });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.undoCommit, async (event, value: unknown) => {
    host.assertSource(event);
    return undoCommit(requireRoot(value, 'git-undo-commit'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.log, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-log');
    return getGitLog(requireRoot(record, 'git-log'), {
      ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
      ...(typeof record.skip === 'number' ? { skip: record.skip } : {}),
    });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.commitFileDiff, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-commit-file-diff');
    return getCommitFileDiff(
      requireRoot(record, 'git-commit-file-diff'),
      requireString(record, 'hash', 'git-commit-file-diff'),
      requireString(record, 'path', 'git-commit-file-diff'),
    );
  });

  ipcMain.handle(GIT_IPC_CHANNELS.fileDiff, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-file-diff');
    return getFileDiff(requireRoot(record, 'git-file-diff'), requireString(record, 'path', 'git-file-diff'), {
      staged: record.staged === true,
    });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.fileLines, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-file-lines');
    return getFileLines(
      requireRoot(record, 'git-file-lines'),
      requireString(record, 'path', 'git-file-lines'),
      {
        ...(typeof record.offset === 'number' ? { offset: record.offset } : {}),
        ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
        ...(typeof record.revision === 'string' && record.revision ? { revision: record.revision } : {}),
      },
    );
  });

  ipcMain.handle(GIT_IPC_CHANNELS.push, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-push');
    return pushRepository(requireRoot(record, 'git-push'), { force: record.force === true });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.pull, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-pull');
    const strategy = record.strategy === 'stash' ? 'stash' : 'check';
    return pullRepository(requireRoot(record, 'git-pull'), { strategy });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.fetch, async (event, value: unknown) => {
    host.assertSource(event);
    return fetchRepository(requireRoot(value, 'git-fetch'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.readIdentity, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-read-identity');
    const scope: GitIdentityScope = record.scope === 'global' ? 'global' : 'local';
    return readIdentity(requireRoot(record, 'git-read-identity'), scope);
  });

  ipcMain.handle(GIT_IPC_CHANNELS.writeIdentity, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-write-identity');
    const root = requireRoot(record, 'git-write-identity');
    const scope: GitIdentityScope = record.scope === 'global' ? 'global' : 'local';
    const identity = record.identity;
    if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) {
      throw new Error('Invalid git-write-identity payload: identity required');
    }
    const { name, email } = identity as { name?: unknown; email?: unknown };
    return writeIdentity(root, scope, {
      name: typeof name === 'string' ? name : '',
      email: typeof email === 'string' ? email : '',
    });
  });

  // 监听：同一 root 重复订阅时先释放旧的，避免句柄泄漏。
  ipcMain.handle(GIT_IPC_CHANNELS.watch, async (event, value: unknown) => {
    host.assertSource(event);
    const root = requireRoot(value, 'git-watch');
    watchers.get(root)?.dispose();
    watchers.delete(root);
    const handle = await watchRepository(root, () => {
      host.mainWindow()?.send(GIT_IPC_CHANNELS.watched, { root });
    });
    if (!handle) return { ok: false, error: '无法监听该仓库' };
    watchers.set(root, handle);
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_IPC_CHANNELS.unwatch, async (event, value: unknown) => {
    host.assertSource(event);
    const root = requireRoot(value, 'git-unwatch');
    watchers.get(root)?.dispose();
    watchers.delete(root);
    return { ok: true, error: null };
  });

  // ── worktree ──
  ipcMain.handle(GIT_IPC_CHANNELS.worktrees, async (event, value: unknown) => {
    host.assertSource(event);
    return listWorktrees(requireRoot(value, 'git-worktrees'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.addWorktree, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-add-worktree');
    return addWorktree(requireRoot(record, 'git-add-worktree'), {
      path: requireString(record, 'path', 'git-add-worktree'),
      ...(typeof record.branch === 'string' && record.branch ? { branch: record.branch } : {}),
      ...(typeof record.newBranch === 'string' && record.newBranch
        ? { newBranch: record.newBranch }
        : {}),
    });
  });

  ipcMain.handle(GIT_IPC_CHANNELS.removeWorktree, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-remove-worktree');
    return removeWorktree(requireRoot(record, 'git-remove-worktree'), {
      path: requireString(record, 'path', 'git-remove-worktree'),
      force: record.force === true,
      deleteBranch: record.deleteBranch === true,
    });
  });

  // ── 合并 ──
  ipcMain.handle(GIT_IPC_CHANNELS.merge, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-merge');
    return mergeBranch(requireRoot(record, 'git-merge'), requireString(record, 'branch', 'git-merge'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.mergePreview, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-merge-preview');
    return previewMerge(
      requireRoot(record, 'git-merge-preview'),
      requireString(record, 'branch', 'git-merge-preview'),
    );
  });

  ipcMain.handle(GIT_IPC_CHANNELS.abortMerge, async (event, value: unknown) => {
    host.assertSource(event);
    return abortMerge(requireRoot(value, 'git-abort-merge'));
  });

  ipcMain.handle(GIT_IPC_CHANNELS.commitMerge, async (event, value: unknown) => {
    host.assertSource(event);
    const record = asRecord(value, 'git-commit-merge');
    return commitMerge(requireRoot(record, 'git-commit-merge'), {
      ...(typeof record.message === 'string' && record.message ? { message: record.message } : {}),
    });
  });

  return disposeWatchers;
}
