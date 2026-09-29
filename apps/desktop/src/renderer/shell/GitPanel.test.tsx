/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '../../git-contract.js';
import { GitPanel } from './GitPanel.js';

function statusFixture(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    isRepo: true,
    branch: 'feature/git-panel',
    detached: false,
    ahead: 1,
    behind: 0,
    hasRemote: true,
    operation: null,
    files: [
      { path: 'src/staged.ts', kind: 'added', group: 'staged', code: 'A ' },
      { path: 'src/changed.ts', kind: 'modified', group: 'unstaged', code: ' M' },
      { path: 'src/new.ts', kind: 'untracked', group: 'untracked', code: '??' },
    ],
    stats: { added: 12, removed: 3 },
    changeCount: 3,
    ...overrides,
  };
}

const runtime = {
  gitStatus: vi.fn(),
  gitReadIdentity: vi.fn(),
  gitWriteIdentity: vi.fn(),
  gitBranches: vi.fn(),
  gitLog: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitDiscard: vi.fn(),
  gitCommit: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitPush: vi.fn(),
  gitPull: vi.fn(),
  gitFetch: vi.fn(),
  gitFileDiff: vi.fn(),
  gitWatch: vi.fn(),
  gitUnwatch: vi.fn(),
  onGitWatched: vi.fn(() => () => undefined),
  gitWorktrees: vi.fn(),
  gitAddWorktree: vi.fn(),
  gitRemoveWorktree: vi.fn(),
  gitMerge: vi.fn(),
  gitMergePreview: vi.fn(),
  gitAbortMerge: vi.fn(),
  gitCommitMerge: vi.fn(),
};

beforeEach(() => {
  for (const value of Object.values(runtime)) {
    if (vi.isMockFunction(value)) (value as ReturnType<typeof vi.fn>).mockReset();
  }
  runtime.gitReadIdentity.mockResolvedValue({ ok: true, error: null, scope: 'local', identity: { name: 'Tester', email: 'tester@example.test' }, effectiveIdentity: { name: 'Tester', email: 'tester@example.test' } });
  runtime.gitStatus.mockResolvedValue(statusFixture());
  runtime.gitBranches.mockResolvedValue({
    current: 'feature/git-panel',
    branches: [
      { name: 'main', group: 'default', current: false },
      { name: 'feature/git-panel', group: 'recent', current: true },
    ],
  });
  runtime.gitLog.mockResolvedValue({
    entries: [
      {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaa',
        subject: 'feat: add git panel',
        author: 'Tester',
        email: 't@t.t',
        committedAt: 1_790_000_000,
        parentCount: 1,
        pushed: false,
        files: [],
        stats: { added: 5, removed: 1 },
        truncated: false,
      },
    ],
    hasMore: false,
  });
  runtime.gitStage.mockResolvedValue({ ok: true, error: null });
  runtime.gitUnstage.mockResolvedValue({ ok: true, error: null });
  runtime.gitDiscard.mockResolvedValue({ ok: true, error: null });
  runtime.gitCommit.mockResolvedValue({
    ok: true,
    committed: true,
    pushed: false,
    error: null,
    hash: 'bbbbbbb',
  });
  runtime.gitCheckout.mockResolvedValue({ ok: true, dirty: false, files: [], error: null });
  runtime.gitCreateBranch.mockResolvedValue({ ok: true, error: null });
  runtime.gitPush.mockResolvedValue({ ok: true, pushed: true, error: null });
  runtime.gitPull.mockResolvedValue({ ok: true, pulled: true, error: null });
  runtime.gitFetch.mockResolvedValue({ ok: true, fetched: true, error: null, ahead: 1, behind: 0 });
  runtime.gitFileDiff.mockResolvedValue({
    path: 'src/changed.ts',
    before: 'old\n',
    after: 'new\n',
    binary: false,
    stats: { added: 1, removed: 1 },
  });
  runtime.gitWatch.mockResolvedValue({ ok: true, error: null });
  runtime.gitUnwatch.mockResolvedValue({ ok: true, error: null });
  // 默认只有一个主 worktree，避免未声明 mock 时 refreshWorktrees 抛错。
  runtime.gitWorktrees.mockResolvedValue({
    repoName: 'repo',
    worktrees: [
      {
        path: 'D:/repo',
        name: 'repo',
        main: true,
        branch: 'feature/git-panel',
        changeCount: 0,
        active: true,
      },
    ],
  });
  runtime.gitAddWorktree.mockResolvedValue({ ok: true, error: null });
  runtime.gitRemoveWorktree.mockResolvedValue({ ok: true, error: null, removed: true });
  runtime.gitMerge.mockResolvedValue({
    ok: true,
    error: null,
    merged: true,
    conflict: false,
    conflicts: [],
  });
  runtime.gitMergePreview.mockResolvedValue({
    ok: true,
    error: null,
    conflict: false,
    conflicts: [],
  });
  runtime.gitAbortMerge.mockResolvedValue({ ok: true, error: null });
  runtime.gitCommitMerge.mockResolvedValue({
    ok: true,
    committed: true,
    pushed: false,
    error: null,
  });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('GitPanel', () => {
  it('renders unique selectable rows and a fixed commit box', async () => {
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    // 横幅：当前分支 + 未提交计数（NewMax banner.branchTitle / uncommitted）
    expect(panel.textContent).toContain('feature/git-panel');
    expect(panel.textContent).toContain('3 个改动文件');
    expect(runtime.gitStatus).toHaveBeenCalledWith({ root: 'D:/repo' });

    expect(panel.querySelectorAll('.shell-git__review-file')).toHaveLength(3);
    expect(
      within(panel)
        .getByRole('checkbox', { name: '取消暂存 src/staged.ts' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(panel)
        .getByRole('checkbox', { name: '暂存 src/changed.ts' })
        .getAttribute('aria-checked'),
    ).toBe('false');

    // 提交区（NewMax summaryPlaceholder / commitTo）
    expect(within(panel).getByLabelText('提交标题（必填）')).toBeTruthy();
    expect(panel.textContent).toContain('提交 1 个文件到 feature/git-panel');
  });

  it('stages and unstages a file through the row actions', async () => {
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'src/changed.ts' })).toBeTruthy(),
    );

    fireEvent.click(within(panel).getByRole('checkbox', { name: '暂存 src/changed.ts' }));
    await waitFor(() =>
      expect(runtime.gitStage).toHaveBeenCalledWith({ root: 'D:/repo', paths: ['src/changed.ts'] }),
    );

    fireEvent.click(within(panel).getByRole('checkbox', { name: '取消暂存 src/staged.ts' }));
    await waitFor(() =>
      expect(runtime.gitUnstage).toHaveBeenCalledWith({
        root: 'D:/repo',
        paths: ['src/staged.ts'],
      }),
    );
  });

  it('submits the commit with summary and description', async () => {
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');
    await waitFor(() => expect(within(panel).getByLabelText('提交标题（必填）')).toBeTruthy());

    fireEvent.change(within(panel).getByLabelText('提交标题（必填）'), {
      target: { value: 'feat: tidy git panel' },
    });
    fireEvent.change(within(panel).getByLabelText('描述（可选）'), {
      target: { value: 'body line' },
    });
    // 有已暂存文件时按钮显示计数（NewMax commitWithCount）
    fireEvent.click(within(panel).getByRole('button', { name: /提交 1 个文件/ }));

    await waitFor(() =>
      expect(runtime.gitCommit).toHaveBeenCalledWith({
        root: 'D:/repo',
        message: 'feat: tidy git panel',
        description: 'body line',
      }),
    );
  });

  it('gates a dirty branch switch behind the stash confirmation', async () => {
    runtime.gitCheckout.mockResolvedValueOnce({
      ok: false,
      dirty: true,
      files: [{ path: 'src/changed.ts', kind: 'modified', group: 'unstaged', code: ' M' }],
      error: null,
    });
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    fireEvent.click(within(panel).getByRole('button', { name: /^当前分支 feature\/git-panel$/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'main' }));

    // NewMax dirtyTitle / dirtyDescription
    const dialog = await screen.findByRole('dialog', { name: '有改动会被目标分支覆盖' });
    expect(dialog.textContent).toContain('切换到 main 会覆盖以下 1 个文件的未提交改动');
    expect(within(dialog).getByRole('button', { name: '暂存改动并切换' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '暂存改动并切换' }));
    await waitFor(() =>
      expect(runtime.gitCheckout).toHaveBeenLastCalledWith({
        root: 'D:/repo',
        branch: 'main',
        strategy: 'stash',
      }),
    );
  });

  it('switches to the history tab and renders commits', async () => {
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    fireEvent.click(within(panel).getByRole('tab', { name: /历史/ }));
    await waitFor(() => expect(within(panel).getByText('feat: add git panel')).toBeTruthy());
    expect(within(panel).getByText('aaaaaaa')).toBeTruthy();
  });

  it('subscribes to repository changes and unsubscribes on unmount', async () => {
    const { unmount } = render(<GitPanel projectFolder="D:/repo" />);
    await waitFor(() => expect(runtime.gitWatch).toHaveBeenCalledWith({ root: 'D:/repo' }));
    unmount();
    await waitFor(() => expect(runtime.gitUnwatch).toHaveBeenCalledWith({ root: 'D:/repo' }));
  });

  it('falls back to a friendly notice when the folder is not a repository', async () => {
    runtime.gitStatus.mockResolvedValue(
      statusFixture({ isRepo: false, files: [], changeCount: 0, branch: null }),
    );
    render(<GitPanel projectFolder="D:/not-a-repo" />);
    await waitFor(() => expect(screen.getByText('这个文件夹还不是 Git 仓库')).toBeTruthy());
  });

  it('surfaces an operation banner while a merge is in progress', async () => {
    runtime.gitStatus.mockResolvedValue(statusFixture({ operation: 'merge' }));
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');
    // NewMax operation.merge
    expect(within(panel).getByText('合并中')).toBeTruthy();
  });
});

describe('GitPanel merge and worktree', () => {
  it('shows the conflict banner and blocks committing the merge until resolved', async () => {
    runtime.gitStatus.mockResolvedValue(
      statusFixture({
        files: [{ path: 'README.md', kind: 'conflicted', group: 'conflicted', code: 'UU' }],
        changeCount: 1,
        operation: 'merge',
        merge: {
          targetBranch: 'main',
          conflicts: [{ path: 'README.md', kind: 'conflicted', group: 'conflicted', code: 'UU' }],
          resolved: false,
          merging: true,
        },
      }),
    );
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    // NewMax mergeBannerConflicts / conflictManual
    expect(panel.textContent).toContain('解决后提交即可合并到 main');
    expect(
      (within(panel).getByRole('checkbox', { name: '暂存 README.md' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // 未解决冲突时「提交合并」不可用（NewMax commitMergeConflicts）
    const commitMergeBtn = within(panel).getByRole('button', { name: '提交合并' });
    expect((commitMergeBtn as HTMLButtonElement).disabled).toBe(true);
    expect(commitMergeBtn.getAttribute('title')).toContain('还有未解决的冲突');

    // 放弃合并（NewMax abortMerge）
    fireEvent.click(within(panel).getByRole('button', { name: '放弃合并' }));
    await waitFor(() => expect(runtime.gitAbortMerge).toHaveBeenCalledWith({ root: 'D:/repo' }));
  });

  it('enables committing the merge once conflicts are resolved', async () => {
    runtime.gitStatus.mockResolvedValue(
      statusFixture({
        files: [
          { path: 'README.md', kind: 'conflicted', group: 'conflicted', code: 'UU' },
          { path: 'README.md', kind: 'modified', group: 'staged', code: 'M ' },
        ],
        changeCount: 1,
        operation: 'merge',
        merge: {
          targetBranch: 'main',
          conflicts: [],
          resolved: true,
          merging: true,
        },
      }),
    );
    runtime.gitCommitMerge.mockResolvedValue({
      ok: true,
      committed: true,
      pushed: false,
      error: null,
    });
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    // NewMax mergeBannerResolved
    expect(panel.textContent).toContain('冲突已解决，提交即可完成合并到 main');
    const commitMergeBtn = within(panel).getByRole('button', { name: '提交合并' });
    expect((commitMergeBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(commitMergeBtn);
    await waitFor(() => expect(runtime.gitCommitMerge).toHaveBeenCalledWith({ root: 'D:/repo' }));
  });

  it('lists worktrees and confirms removal with the dirty warning', async () => {
    runtime.gitWorktrees.mockResolvedValue({
      repoName: 'repo',
      worktrees: [
        {
          path: 'D:/repo',
          name: 'repo',
          main: true,
          branch: 'main',
          changeCount: 0,
          active: true,
        },
        {
          path: 'D:/wt-feature',
          name: 'wt-feature',
          main: false,
          branch: 'feature/x',
          changeCount: 2,
          active: false,
        },
      ],
    });
    runtime.gitRemoveWorktree.mockResolvedValue({ ok: true, error: null, removed: true });
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    fireEvent.click(within(panel).getByRole('button', { name: '工作副本' }));
    await waitFor(() => expect(within(panel).getByText('工作在')).toBeTruthy());
    expect(within(panel).getByText(/wt-feature/)).toBeTruthy();
    // NewMax worktreeLocal
    expect(within(panel).getByText('本地 worktree')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: '移除这个 worktree…' }));
    const dialog = await screen.findByRole('dialog', { name: '移除 worktree' });
    // NewMax removeDescription / removeDirty
    expect(dialog.textContent).toContain('会删除目录 D:/wt-feature');
    expect(dialog.textContent).toContain('这棵树里还有 2 个未提交改动，移除后会丢失。');
    // NewMax removeDeleteBranch
    expect(dialog.textContent).toContain('同时删除分支 feature/x');

    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }));
    await waitFor(() =>
      expect(runtime.gitRemoveWorktree).toHaveBeenCalledWith({
        root: 'D:/repo',
        path: 'D:/wt-feature',
        force: true,
        deleteBranch: false,
      }),
    );
  });

  it('merges a branch chosen from the menu', async () => {
    runtime.gitMerge.mockResolvedValue({
      ok: true,
      error: null,
      merged: true,
      conflict: false,
      conflicts: [],
    });
    render(<GitPanel projectFolder="D:/repo" />);
    const panel = await screen.findByTestId('git-panel');

    fireEvent.click(within(panel).getByRole('button', { name: /^当前分支 feature\/git-panel$/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /合并 main 到当前分支/ }));

    await waitFor(() =>
      expect(runtime.gitMerge).toHaveBeenCalledWith({ root: 'D:/repo', branch: 'main' }),
    );
  });
});

describe('review selection boundaries', () => {
  it('shows a partially staged path once and switches between index and working changes', async () => {
    runtime.gitStatus.mockResolvedValue(
      statusFixture({
        files: [
          { path: 'src/partial.ts', kind: 'modified', group: 'staged', code: 'MM' },
          { path: 'src/partial.ts', kind: 'modified', group: 'unstaged', code: 'MM' },
        ],
        changeCount: 1,
      }),
    );
    render(<GitPanel projectFolder="D:/repo" />);
    const check = await screen.findByRole('checkbox', { name: '暂存 src/partial.ts' });
    expect(check.getAttribute('aria-checked')).toBe('mixed');
    expect(document.querySelectorAll('.shell-git__review-file')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'src/partial.ts' }));
    await waitFor(() =>
      expect(runtime.gitFileDiff).toHaveBeenLastCalledWith({
        root: 'D:/repo',
        path: 'src/partial.ts',
        staged: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '未暂存' }));
    await waitFor(() =>
      expect(runtime.gitFileDiff).toHaveBeenLastCalledWith({
        root: 'D:/repo',
        path: 'src/partial.ts',
        staged: false,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消该文件暂存' }));
    await waitFor(() =>
      expect(runtime.gitUnstage).toHaveBeenCalledWith({
        root: 'D:/repo',
        paths: ['src/partial.ts'],
      }),
    );
  });
  it('selects only filtered paths and never combines selection with a commit', async () => {
    render(<GitPanel projectFolder="D:/repo" />);
    fireEvent.click(await screen.findByRole('button', { name: '搜索改动文件' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索改动文件' }), {
      target: { value: 'new.ts' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '全部暂存' }));
    await waitFor(() =>
      expect(runtime.gitStage).toHaveBeenCalledWith({ root: 'D:/repo', paths: ['src/new.ts'] }),
    );
    expect(runtime.gitCommit).not.toHaveBeenCalled();
  });
  it('does not allow an ordinary commit during a Git operation', async () => {
    runtime.gitStatus.mockResolvedValue(statusFixture({ operation: 'merge' }));
    render(<GitPanel projectFolder="D:/repo" />);
    fireEvent.change(await screen.findByLabelText('提交标题（必填）'), {
      target: { value: 'test' },
    });
    expect(
      (screen.getByRole('button', { name: /提交 1 个文件到/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('shows a loading error as retryable instead of declaring the folder not a repository', async () => {
    runtime.gitStatus.mockRejectedValueOnce(new Error('Git timed out'));
    render(<GitPanel projectFolder="D:/repo" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('这个文件夹还不是 Git 仓库')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByLabelText('提交标题（必填）')).toBeTruthy();
  });
});
