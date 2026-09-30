/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewMaxComposerFrame } from '@sync-think/ui-kit';
import { ComposerGitBar } from './ComposerGitBar.js';
import { invalidateGitRepository } from './git-repository-events.js';
const summary = (branch: string, changeCount: number) => ({
  isRepo: true,
  branch,
  changeCount,
  detached: false,
  ahead: 0,
  behind: 0,
  operation: null,
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  Reflect.deleteProperty(window, 'syncThink');
});
function install(gitChanged = vi.fn(async () => summary('main', 2))) {
  const runtime = {
    gitChanged,
    gitBranches: vi.fn(async () => ({
      current: 'main',
      branches: [{ name: 'main', current: true, group: 'default' }],
    })),
    gitWorktrees: vi.fn(async () => ({
      repoName: 'repo',
      worktrees: [
        { path: 'D:/repo', name: 'repo', main: true, active: true, branch: 'main', changeCount: 2 },
      ],
    })),
    gitWatch: vi.fn(async () => ({ ok: true })),
    gitUnwatch: vi.fn(async () => ({ ok: true })),
    onGitWatched: vi.fn(() => () => {}),
  };
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
  return runtime;
}
it('opens review for the count and contextual pickers for branch and environment', async () => {
  install();
  const open = vi.fn();
  render(
    <NewMaxComposerFrame
      variant="conversation"
      contextBar={<ComposerGitBar projectFolder="D:/repo" onOpenGit={open} />}
      input={<textarea aria-label="消息" />}
    />,
  );
  expect(screen.getByTestId('composer-git-bar').closest('.shell-compose')).toBeNull();
  fireEvent.click(await screen.findByText('2 个未提交'));
  expect(open).toHaveBeenLastCalledWith('D:/repo', 'changes');
  fireEvent.click(screen.getByText('main'));
  expect(await screen.findByRole('dialog', { name: '选择分支' })).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByText('Local'));
  expect(await screen.findByRole('dialog', { name: '工作在' })).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
});
it('ignores a stale response when switching workspace', async () => {
  let release!: (value: ReturnType<typeof summary>) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(summary('other', 3));
  install(load);
  const { rerender } = render(<ComposerGitBar projectFolder="D:/one" />);
  rerender(<ComposerGitBar projectFolder="D:/two" />);
  expect(await screen.findByText('other')).toBeTruthy();
  release(summary('old', 99));
  await waitFor(() => expect(screen.queryByText('old')).toBeNull());
  expect(screen.getByText('3 个未提交')).toBeTruthy();
});
it('shares a watcher and refreshes counts after panel operations', async () => {
  const runtime = install();
  const { rerender, unmount } = render(
    <>
      <ComposerGitBar projectFolder="D:/repo" />
      <ComposerGitBar projectFolder="D:/repo" />
    </>,
  );
  await screen.findAllByText('2 个未提交');
  expect(runtime.gitWatch).toHaveBeenCalledTimes(1);
  rerender(<ComposerGitBar projectFolder="D:/repo" />);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(runtime.gitUnwatch).not.toHaveBeenCalled();
  runtime.gitChanged.mockResolvedValue(summary('feature', 0));
  invalidateGitRepository('D:/repo');
  expect(await screen.findByText('无未提交改动')).toBeTruthy();
  expect(screen.getByText('feature')).toBeTruthy();
  unmount();
  await waitFor(() => expect(runtime.gitUnwatch).toHaveBeenCalledOnce());
});
it('hides the Git strip for a plain directory', async () => {
  install(vi.fn(async () => ({ ...summary('main', 0), isRepo: false })));
  render(
    <NewMaxComposerFrame
      variant="empty"
      contextBar={<ComposerGitBar projectFolder="D:/plain" />}
      input={<textarea aria-label="消息" />}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId('composer-git-bar')).toBeNull());
  const frame = screen.getByTestId('newmax-composer-frame');
  expect(frame.children).toHaveLength(1);
  expect(frame.firstElementChild?.classList.contains('shell-compose')).toBe(true);
});


it('omits the Git status for non-repository folders', async () => {
  install(vi.fn(async () => ({ ...summary('', 0), isRepo: false })));
  render(<ComposerGitBar projectFolder="D:/plain" onOpenGit={vi.fn()} />);
  await waitFor(() => expect(screen.queryByTestId('composer-git-bar')).toBeNull());
  expect(screen.queryByText('读取仓库…')).toBeNull();
});
