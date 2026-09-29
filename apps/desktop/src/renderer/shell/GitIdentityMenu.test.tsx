/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitIdentityMenu } from './GitIdentityMenu.js';
import type { GitIdentityResult, GitIdentityScope } from '../../git-contract.js';

const local = { name: 'Project Author', email: 'project@example.test' };
const global = { name: 'Global Author', email: 'global@example.test' };
const read = vi.fn();
const write = vi.fn();
const result = (scope: GitIdentityScope): GitIdentityResult => ({
  ok: true,
  error: null,
  scope,
  identity: scope === 'local' ? local : global,
  effectiveIdentity: local,
});

beforeEach(() => {
  read.mockReset().mockImplementation(async ({ scope }) => result(scope));
  write.mockReset().mockImplementation(async ({ scope, identity }) => ({
    ok: true,
    error: null,
    scope,
    identity,
    effectiveIdentity: scope === 'local' ? identity : local,
  }));
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: { gitReadIdentity: read, gitWriteIdentity: write } },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.syncThink;
});
async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Git 提交身份' }));
  const panel = screen.getByRole('dialog', { name: 'Git 提交身份设置' });
  fireEvent.click(within(panel).getByRole('button', { name: /Git 设置/ }));
  await waitFor(() =>
    expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).disabled).toBe(false),
  );
  return panel;
}

describe('Git commit identity', () => {
  it('shows the active identity from an avatar and expands a compact settings form', async () => {
    render(<GitIdentityMenu root="D:/repo" />);
    fireEvent.click(screen.getByRole('button', { name: 'Git 提交身份' }));
    expect(await screen.findByText('Project Author')).toBeTruthy();
    expect(screen.getByText('project@example.test')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '提交者姓名' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Git 设置/ }));
    expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe(local.name);
    expect(screen.getByRole('button', { name: '当前仓库' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('edits global values while continuing to show the effective repository author', async () => {
    render(<GitIdentityMenu root="D:/repo" />);
    const panel = await openSettings();
    fireEvent.click(screen.getByRole('button', { name: '全局' }));
    await waitFor(() =>
      expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe(global.name),
    );
    expect(within(panel).getByText(local.name)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('提交者姓名'), {
      target: { value: 'New Global Author' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('全局身份已保存');
    expect(write).toHaveBeenCalledWith({
      root: 'D:/repo',
      scope: 'global',
      identity: { name: 'New Global Author', email: global.email },
    });
    expect(within(panel).getByText(local.name)).toBeTruthy();
  });

  it('does not submit the surrounding Git commit form when identity settings are saved', async () => {
    const commit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={commit}>
        <GitIdentityMenu root="D:/repo" />
      </form>,
    );
    await openSettings();
    fireEvent.change(screen.getByLabelText('提交者邮箱'), {
      target: { value: 'changed@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('当前仓库身份已保存');
    expect(write).toHaveBeenCalledWith({
      root: 'D:/repo',
      scope: 'local',
      identity: { name: local.name, email: 'changed@example.test' },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('changed@example.test')).toBeTruthy();
  });

  it('cancels the draft and dismisses with Escape without writing Git configuration', async () => {
    render(<GitIdentityMenu root="D:/repo" />);
    await openSettings();
    fireEvent.change(screen.getByLabelText('提交者姓名'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: /Git 设置/ }));
    expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe(local.name);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Git 提交身份' }));
    expect(write).not.toHaveBeenCalled();
  });

  it('shows inherited identity while leaving unset local inputs blank', async () => {
    read.mockResolvedValue({
      ok: true,
      error: null,
      scope: 'local',
      identity: { name: '', email: '' },
      effectiveIdentity: global,
    });
    render(<GitIdentityMenu root="D:/repo" />);
    const panel = await openSettings();
    expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe('');
    expect(within(panel).getByText(global.name)).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows clearing local overrides and retains a failed save draft for retry', async () => {
    write.mockResolvedValueOnce({
      ok: false,
      error: '配置文件被锁定',
      scope: 'local',
      identity: local,
    });
    render(<GitIdentityMenu root="D:/repo" />);
    await openSettings();
    fireEvent.change(screen.getByLabelText('提交者姓名'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('提交者邮箱'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('配置文件被锁定')).toBeTruthy();
    expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe('');
    expect(write).toHaveBeenCalledWith({
      root: 'D:/repo',
      scope: 'local',
      identity: { name: '', email: '' },
    });
  });

  it('ignores a stale scope response after switching from local to global', async () => {
    let resolveLocal!: (value: GitIdentityResult) => void;
    read.mockImplementation(({ scope }) =>
      scope === 'global'
        ? Promise.resolve(result(scope))
        : new Promise<GitIdentityResult>((resolve) => {
            resolveLocal = resolve;
          }),
    );
    render(<GitIdentityMenu root="D:/repo" />);
    fireEvent.click(screen.getByRole('button', { name: 'Git 提交身份' }));
    fireEvent.click(screen.getByRole('button', { name: /Git 设置/ }));
    fireEvent.click(screen.getByRole('button', { name: '全局' }));
    await waitFor(() =>
      expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe(global.name),
    );
    resolveLocal(result('local'));
    await waitFor(() =>
      expect((screen.getByLabelText('提交者姓名') as HTMLInputElement).value).toBe(global.name),
    );
  });
});

describe('Git identity avatar and folding', () => {
  it('loads the real GitHub avatar and falls back to a neutral icon on image failure', async () => {
    read.mockResolvedValue({
      ...result('local'),
      effectiveIdentity: {
        name: 'GitHub Author',
        email: '113440707+1447751897@users.noreply.github.com',
      },
    });
    render(<GitIdentityMenu root="D:/repo" />);
    const avatar = await screen.findByRole('img', { name: 'GitHub Author的头像' });
    expect(avatar.getAttribute('src')).toContain('avatars.githubusercontent.com/u/113440707?');
    fireEvent.error(avatar);
    expect(screen.queryByRole('img', { name: 'GitHub Author的头像' })).toBeNull();
    expect(document.querySelector('.shell-git-identity__avatar svg')).toBeTruthy();
  });

  it('keeps closing content mounted for animation but removes it from interaction', async () => {
    render(<GitIdentityMenu root="D:/repo" />);
    const panel = await openSettings();
    const fold = panel.querySelector('.shell-git-identity__collapse') as HTMLDivElement;
    expect(fold.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: /Git 设置/ }));
    expect(fold.getAttribute('data-expanded')).toBe('false');
    expect(fold.inert).toBe(true);
    expect(fold.getAttribute('aria-hidden')).toBe('true');
    expect(fold.querySelector('form')).toBeTruthy();
    expect(within(panel).queryByRole('textbox', { name: '提交者姓名' })).toBeNull();
  });
});
