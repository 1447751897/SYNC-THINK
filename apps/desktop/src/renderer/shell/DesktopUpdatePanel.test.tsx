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
  getAutoCheck: vi.fn(),
  setAutoCheck: vi.fn(),
  openReleaseNotes: vi.fn(),
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
  updates.openReleaseNotes.mockResolvedValue({ opened: true, error: null });
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
    const downloadButton = screen.getByRole('button', { name: '下载更新' });
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

  it('opens release notes and the local log directory through preload', async () => {
    render(<DesktopUpdatePanel />);
    await screen.findByText('版本 v0.0.1');

    fireEvent.click(screen.getByRole('button', { name: '查看更新日志' }));
    fireEvent.click(screen.getByRole('button', { name: '打开日志目录' }));

    await waitFor(() => expect(updates.openReleaseNotes).toHaveBeenCalledTimes(1));
    expect(updates.openLogDirectory).toHaveBeenCalledTimes(1);
  });
});
