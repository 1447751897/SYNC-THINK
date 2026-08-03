/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  subscribeState: vi.fn(),
};

beforeEach(() => {
  updates.getState.mockResolvedValue(baseSnapshot);
  updates.checkForUpdates.mockResolvedValue(actionResult({ ...baseSnapshot, phase: 'checking' }));
  updates.downloadUpdate.mockResolvedValue(
    actionResult({ ...baseSnapshot, phase: 'downloading', progressPercent: 0 }),
  );
  updates.installUpdate.mockResolvedValue(actionResult({ ...baseSnapshot, phase: 'installing' }));
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
  it('loads the release console and starts a manual update check', async () => {
    render(<DesktopUpdatePanel />);

    expect(await screen.findByText('桌面发布通道')).toBeTruthy();
    expect(screen.getByText('当前版本')).toBeTruthy();
    expect(screen.getByText('0.0.1')).toBeTruthy();
    expect(screen.getByText('发布通道')).toBeTruthy();
    expect(screen.getByText('latest')).toBeTruthy();
    expect(screen.getByText('SHA-512 完整性校验')).toBeTruthy();
    expect(screen.getByText('检查')).toBeTruthy();
    expect(screen.getByText('下载')).toBeTruthy();
    expect(screen.getByText('安装')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(updates.checkForUpdates).toHaveBeenCalledTimes(1));
    expect(screen.getByText('正在检查更新…')).toBeTruthy();
  });

  it('projects an available version and makes download the only primary action', async () => {
    let listener: ((snapshot: DesktopUpdateSnapshot) => void) | undefined;
    updates.subscribeState.mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    render(<DesktopUpdatePanel />);
    await screen.findByText('0.0.1');

    listener?.({
      ...baseSnapshot,
      phase: 'available',
      availableVersion: '0.0.2',
      checkedAt: '2026-08-02T08:00:00.000Z',
    });

    expect(await screen.findByText('发现新版本 0.0.2')).toBeTruthy();
    expect(screen.getByText('0.0.2')).toBeTruthy();
    const downloadButton = screen.getByRole('button', { name: '下载更新' });
    expect((downloadButton as HTMLButtonElement).disabled).toBe(false);
    expect(downloadButton.classList.contains('is-primary')).toBe(true);
    expect(
      screen.getByRole('button', { name: '重启并安装' }).classList.contains('is-primary'),
    ).toBe(false);

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
    expect(screen.getByText('正在接收安装包')).toBeTruthy();
    expect(screen.getByText('42.5%')).toBeTruthy();
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
    expect(installButton.classList.contains('is-primary')).toBe(true);

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

    expect(
      await screen.findByText('当前构建未配置私有更新通道。配置完成前，应用不会访问更新网络。'),
    ).toBeTruthy();
    for (const label of ['检查更新', '下载更新', '重启并安装']) {
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
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
    expect(screen.getByText('本次更新已停止')).toBeTruthy();
    expect(screen.getByText('安装包校验失败，已丢弃本次下载。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('provider');
    expect(document.body.textContent).not.toContain('stack');
  });
});
