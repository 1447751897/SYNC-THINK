/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateSnapshot,
} from '../../desktop-update-contract.js';
import { DesktopUpdatePanel } from './DesktopUpdatePanel.js';

const baseSnapshot: DesktopUpdateSnapshot = {
  schemaVersion: 1,
  phase: 'idle',
  configured: true,
  currentVersion: '0.0.1',
  channel: 'latest',
  availableVersion: null,
  releaseNotes: null,
  progressPercent: null,
  checkedAt: null,
  downloadedAt: null,
  errorCode: null,
};

function actionResult(state: DesktopUpdateSnapshot): DesktopUpdateActionResult {
  return { ok: true, state, errorCode: null };
}

const updates = {
  getState: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getAutoCheck: vi.fn(),
  setAutoCheck: vi.fn(),
  openLogDirectory: vi.fn(),
  subscribeState: vi.fn(),
};

beforeEach(() => {
  updates.getState.mockResolvedValue(baseSnapshot);
  updates.checkForUpdates.mockResolvedValue(actionResult({ ...baseSnapshot, phase: 'checking' }));
  updates.downloadUpdate.mockResolvedValue(
    actionResult({ ...baseSnapshot, phase: 'downloading', progressPercent: 0 }),
  );
  updates.installUpdate.mockResolvedValue(actionResult({ ...baseSnapshot, phase: 'installing' }));
  updates.getAutoCheck.mockResolvedValue({ enabled: true });
  updates.setAutoCheck.mockImplementation(async (payload: { enabled: boolean }) => payload);
  updates.openLogDirectory.mockResolvedValue({
    opened: true,
    path: 'C:\\Users\\fixture\\sync-think',
  });
  updates.subscribeState.mockReturnValue(() => undefined);
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { updates },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DesktopUpdatePanel', () => {
  it('loads the compact about controls and starts a manual update check', async () => {
    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('SYNC-THINK')).toBeTruthy();
    expect(screen.getByText('版本 v0.0.1')).toBeTruthy();
    expect(screen.getByText('启动时自动检查新版本')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '自动检查更新' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(updates.checkForUpdates).toHaveBeenCalledTimes(1));
    expect(screen.getByText('正在检查更新…')).toBeTruthy();
  });

  it('projects an available version into the single primary action', async () => {
    let listener: ((snapshot: DesktopUpdateSnapshot) => void) | undefined;
    updates.subscribeState.mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    render(<DesktopUpdatePanel />);
    await screen.findByText('版本 v0.0.1');

    listener?.({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.0.2',
      checkedAt: '2026-08-02T08:00:00.000Z',
    });

    expect(await screen.findByText('发现新版本 0.0.2')).toBeTruthy();
    // 主按钮直接说出要升到哪个版本，而不是泛泛的「下载更新」。
    const downloadButton = screen.getByRole('button', { name: '更新到 v0.0.2' });
    expect((downloadButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '检查更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重启并安装' })).toBeNull();

    fireEvent.click(downloadButton);
    await waitFor(() => expect(updates.downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it('renders detailed download progress with accessible progress semantics', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'downloading',
      availableVersion: '0.0.2',
      progressPercent: 42.5,
    });
    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('正在下载安装包 42.5%')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: '更新下载进度' });
    expect(progress.getAttribute('aria-valuenow')).toBe('42.5');
    expect((screen.getByRole('button', { name: '下载中…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables restart installation only after the package is downloaded', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'downloaded',
      availableVersion: '0.0.2',
      progressPercent: 100,
      downloadedAt: '2026-08-02T08:05:00.000Z',
    });
    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('安装包已就绪')).toBeTruthy();
    const installButton = screen.getByRole('button', { name: '重启并安装' });
    expect((installButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(installButton);
    await waitFor(() => expect(updates.installUpdate).toHaveBeenCalledTimes(1));
  });

  it('keeps an unconfigured build inert without exposing feed details or credentials', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      configured: false,
      phase: 'disabled',
    });
    render(<DesktopUpdatePanel />);

    const checkButton = await screen.findByRole('button', { name: '检查更新' });
    expect((checkButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('当前 Beta 为手动下载，未配置自动更新通道。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '下载更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重启并安装' })).toBeNull();
    expect(document.body.textContent).not.toContain('http');
    expect(document.body.textContent).not.toContain('token');
    expect(document.body.textContent).not.toContain('Bearer');
  });

  it('maps checksum failures to a stable renderer-safe error message', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'error',
      availableVersion: '0.0.2',
      errorCode: 'desktop.update.checksum-mismatch',
    });
    render(<DesktopUpdatePanel />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('安装包校验失败，已丢弃本次下载。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('provider');
    expect(document.body.textContent).not.toContain('stack');
  });

  it('persists the automatic startup check preference', async () => {
    updates.getAutoCheck.mockResolvedValue({ enabled: false });
    render(<DesktopUpdatePanel />);

    const toggle = await screen.findByRole('switch', { name: '自动检查更新' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(toggle);

    await waitFor(() => expect(updates.setAutoCheck).toHaveBeenCalledWith({ enabled: true }));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('opens the local log directory through preload', async () => {
    render(<DesktopUpdatePanel />);
    await screen.findByText('版本 v0.0.1');

    fireEvent.click(screen.getByRole('button', { name: '打开日志目录' }));

    await waitFor(() => expect(updates.openLogDirectory).toHaveBeenCalledTimes(1));
  });

  it('renders the pending release notes in the panel instead of linking out', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: '# 亮点\n- 应用内查看更新日志\n- 一键重启安装',
    });

    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('更新内容')).toBeTruthy();
    expect(screen.getByText('亮点')).toBeTruthy();
    expect(screen.getByText('应用内查看更新日志')).toBeTruthy();
    expect(screen.getByText('一键重启安装')).toBeTruthy();
    // 面板里直接可读，不需要任何跳转。
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the full release notes in an in-app dialog, never in a browser', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: '# 亮点\n- 应用内查看更新日志\n- 一键重启安装',
    });

    render(<DesktopUpdatePanel />);

    const openButton = await screen.findByRole('button', { name: '查看更新日志' });
    fireEvent.click(openButton);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('v0.1.0-rc.5 更新日志');
    // 正文在弹窗里依旧是逐行纯文本。
    expect(within(dialog).getByText('一键重启安装')).toBeTruthy();
    expect(within(dialog).getByText('亮点')).toBeTruthy();
  });

  it('closes the release notes dialog on Escape and restores focus', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: '- 一条日志',
    });

    render(<DesktopUpdatePanel />);

    const openButton = await screen.findByRole('button', { name: '查看更新日志' });
    openButton.focus();
    fireEvent.click(openButton);

    const dialog = await screen.findByRole('dialog');
    // 打开即把焦点移进弹窗，键盘用户不会留在背后的页面上。
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: '关闭更新日志' }),
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(openButton);
  });

  it('never ships release notes as markup inside the dialog either', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: '<img src=x onerror="alert(1)">',
    });

    render(<DesktopUpdatePanel />);
    fireEvent.click(await screen.findByRole('button', { name: '查看更新日志' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('img')).toBeNull();
    expect(within(dialog).getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
  });

  it('explains a missing release note instead of leaving the panel blank', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: null,
    });

    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('本次更新未提供更新日志。')).toBeTruthy();
  });

  it('never treats release notes as markup', async () => {
    updates.getState.mockResolvedValue({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.1.0-rc.5',
      releaseNotes: '<img src=x onerror="alert(1)">',
    });

    render(<DesktopUpdatePanel />);

    const line = await screen.findByText('<img src=x onerror="alert(1)">');
    expect(line.tagName).toBe('P');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
