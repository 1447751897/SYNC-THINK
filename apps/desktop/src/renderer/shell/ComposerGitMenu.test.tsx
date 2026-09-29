/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ComposerGitMenu,
  type ComposerGitNavigation,
  type ComposerGitMenuKind,
} from './ComposerGitMenu.js';
const runtime = {
  gitBranches: vi.fn(),
  gitWorktrees: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitMerge: vi.fn(),
  gitAddWorktree: vi.fn(),
};
let navigation: ComposerGitNavigation;
let anchor: HTMLButtonElement;
const dismiss = vi.fn();
const review = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  anchor = document.createElement('button');
  document.body.append(anchor);
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
  navigation = {
    workspaceId: 'one',
    workspaces: [
      { workspaceId: 'one', name: 'SYNC-THINK', folderPath: 'D:/repo' },
      { workspaceId: 'two', name: 'Another', folderPath: 'D:/another' },
    ],
    onSelectWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(async () => {}),
    onOpenWorktree: vi.fn(async () => {}),
  };
  runtime.gitBranches.mockResolvedValue({
    current: 'main',
    branches: [
      { name: 'main', current: true, group: 'default', committedAt: 1770000000 },
      { name: 'feature/test', current: false, group: 'recent', committedAt: 1780000000 },
    ],
  });
  runtime.gitWorktrees.mockResolvedValue({
    repoName: 'repo',
    worktrees: [
      { path: 'D:/repo', name: 'repo', main: true, active: true, branch: 'main', changeCount: 0 },
      {
        path: 'D:/tree',
        name: 'tree',
        main: false,
        active: false,
        branch: 'feature/tree',
        changeCount: 0,
      },
    ],
  });
  runtime.gitCheckout.mockResolvedValue({ ok: true, dirty: false, files: [], error: null });
  runtime.gitCreateBranch.mockResolvedValue({ ok: true });
  runtime.gitMerge.mockResolvedValue({ ok: true });
  runtime.gitAddWorktree.mockResolvedValue({ ok: true, path: 'D:/created', branch: 'codex/new' });
});
afterEach(() => {
  cleanup();
  anchor.remove();
  Reflect.deleteProperty(window, 'syncThink');
});
function open(kind: ComposerGitMenuKind) {
  return render(
    <ComposerGitMenu
      kind={kind}
      root="D:/repo"
      label="SYNC-THINK"
      currentBranch="main"
      anchor={anchor}
      navigation={navigation}
      onDismiss={dismiss}
      onReview={review}
    />,
  );
}
it('searches workspaces without reordering and selects the requested workspace', () => {
  open('workspace');
  const dialog = screen.getByRole('dialog');
  expect([...dialog.querySelectorAll('[data-menu-item]')].map((item) => item.textContent)).toEqual([
    'SYNC-THINK',
    'Another',
    '新建工作区',
  ]);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索工作区' }), {
    target: { value: 'another' },
  });
  expect(screen.queryByText('SYNC-THINK')).toBeNull();
  fireEvent.click(screen.getByText('Another'));
  expect(navigation.onSelectWorkspace).toHaveBeenCalledWith('two');
  expect(dismiss).toHaveBeenCalledOnce();
});
it('creates a workspace through the shell callback and surfaces errors', async () => {
  vi.mocked(navigation.onCreateWorkspace).mockRejectedValueOnce(new Error('选取目录失败'));
  open('workspace');
  fireEvent.click(screen.getByText('新建工作区'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '选取目录失败');
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('新建工作区'));
  await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
});
it('groups branches, renders dates, and switches with a non-destructive check first', async () => {
  open('branch');
  const current = await screen.findByRole('button', { name: /^main/ });
  expect(current.getAttribute('data-active')).toBe('true');
  expect(current.getAttribute('aria-current')).toBe('true');
  const target = screen.getByRole('button', { name: /feature\/test/ });
  expect(target.hasAttribute('data-active')).toBe(false);
  fireEvent.click(target);
  await waitFor(() =>
    expect(runtime.gitCheckout).toHaveBeenCalledWith({
      root: 'D:/repo',
      branch: 'feature/test',
      strategy: 'check',
    }),
  );
  expect(screen.getByText('默认分支')).toBeTruthy();
  expect(screen.getByText('最近分支')).toBeTruthy();
  expect(document.querySelectorAll('time')).toHaveLength(2);
  await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
});
it('requires choosing preserve changes before retrying a dirty checkout', async () => {
  runtime.gitCheckout.mockResolvedValueOnce({ ok: false, dirty: true, files: [], error: 'dirty' });
  open('branch');
  fireEvent.click(await screen.findByRole('button', { name: /feature\/test/ }));
  const preserve = await screen.findByRole('button', { name: '保留改动并切换' });
  expect(runtime.gitCheckout).toHaveBeenCalledTimes(1);
  fireEvent.click(preserve);
  await waitFor(() =>
    expect(runtime.gitCheckout).toHaveBeenLastCalledWith({
      root: 'D:/repo',
      branch: 'feature/test',
      strategy: 'stash',
    }),
  );
});
it('creates a named branch and checks it out', async () => {
  open('branch');
  await screen.findByText('默认分支');
  fireEvent.click(screen.getByText('新建分支…'));
  fireEvent.change(screen.getByLabelText('分支名称'), { target: { value: 'codex/new' } });
  fireEvent.click(screen.getByText('创建并切换'));
  await waitFor(() =>
    expect(runtime.gitCreateBranch).toHaveBeenCalledWith({ root: 'D:/repo', branch: 'codex/new' }),
  );
  await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
  expect(runtime.gitCheckout).not.toHaveBeenCalled();
});
it('merges only after target selection and explicit confirmation', async () => {
  open('branch');
  await screen.findByText('默认分支');
  fireEvent.click(screen.getByText('选择分支合并到 main…'));
  fireEvent.click(screen.getByRole('button', { name: /feature\/test/ }));
  expect(runtime.gitMerge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '合并到当前分支' }));
  await waitFor(() =>
    expect(runtime.gitMerge).toHaveBeenCalledWith({ root: 'D:/repo', branch: 'feature/test' }),
  );
});
it('opens an existing worktree using its real folder', async () => {
  open('environment');
  fireEvent.click(await screen.findByRole('button', { name: /tree feature\/tree/ }));
  await waitFor(() => expect(navigation.onOpenWorktree).toHaveBeenCalledWith('D:/tree', 'tree'));
});
it('creates a worktree and retries workspace opening without creating it twice', async () => {
  vi.mocked(navigation.onOpenWorktree).mockRejectedValueOnce(new Error('工作区连接中断'));
  open('environment');
  await screen.findByText('Local');
  fireEvent.click(screen.getByRole('button', { name: /新建本地 worktree/ }));
  fireEvent.change(screen.getByLabelText('worktree 分支'), { target: { value: 'codex/new' } });
  fireEvent.change(screen.getByLabelText('worktree 目录'), { target: { value: 'D:/created' } });
  fireEvent.click(screen.getByText('创建并打开工作区'));
  await screen.findByRole('alert');
  expect(runtime.gitAddWorktree).toHaveBeenCalledWith({
    root: 'D:/repo',
    path: 'D:/created',
    newBranch: 'codex/new',
  });
  fireEvent.click(screen.getByText('打开已创建的工作区'));
  await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
  expect(runtime.gitAddWorktree).toHaveBeenCalledTimes(1);
});
it('supports keyboard movement, Escape and focus return', () => {
  open('workspace');
  const search = screen.getByRole('textbox');
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'SYNC-THINK' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(dismiss).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchor);
});
it('does not switch workspaces after a worktree request outlives the menu', async () => {
  let resolve!: (result: unknown) => void;
  runtime.gitAddWorktree.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = open('environment');
  await screen.findByText('Local');
  fireEvent.click(screen.getByRole('button', { name: /新建本地 worktree/ }));
  fireEvent.click(screen.getByText('创建并打开工作区'));
  view.unmount();
  resolve({ ok: true, path: 'D:/created' });
  await Promise.resolve();
  await Promise.resolve();
  expect(navigation.onOpenWorktree).not.toHaveBeenCalled();
});
