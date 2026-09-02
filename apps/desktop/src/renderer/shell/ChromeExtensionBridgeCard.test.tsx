/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChromeExtensionBridgeCard } from './ChromeExtensionBridgeCard.js';

const connectionInfo = {
  bundledVersion: '1.1.4',
  url: 'ws://127.0.0.1:17373/browser-extension/v1',
  token: 'pairing-token',
};

function createRuntime() {
  return {
    status: vi.fn(async () => ({
      state: 'disconnected' as const,
      hostAvailable: true,
      connected: false,
      installedVersion: '1.1.4',
      versionMismatch: false,
      busy: false,
      lastErrorCode: null,
      connectionInfo,
    })),
    restart: vi.fn(async () => ({
      state: 'connected' as const,
      hostAvailable: true,
      connected: true,
      installedVersion: '1.1.4',
      versionMismatch: false,
      busy: false,
      lastErrorCode: null,
      connectionInfo,
    })),
    resetPairing: vi.fn(async () => ({
      state: 'disconnected' as const,
      hostAvailable: true,
      connected: false,
      installedVersion: '1.1.4',
      versionMismatch: false,
      busy: false,
      lastErrorCode: null,
      connectionInfo: { ...connectionInfo, token: '' },
    })),
    openFolder: vi.fn(async () => ({ success: true as const })),
  };
}

afterEach(() => cleanup());

describe('ChromeExtensionBridgeCard', () => {
  it('loads NewMax bridge state and reveals connection details on expand', async () => {
    const runtime = createRuntime();
    render(<ChromeExtensionBridgeCard runtime={runtime} />);

    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('chrome-extension-status').textContent).toContain('未连接');
    expect(screen.queryByTestId('chrome-extension-url')).toBeNull();

    fireEvent.click(screen.getByTestId('chrome-extension-identity'));
    expect((screen.getByTestId('chrome-extension-url') as HTMLInputElement).value).toBe(
      connectionInfo.url,
    );
    expect((screen.getByTestId('chrome-extension-token') as HTMLInputElement).value).toBe(
      connectionInfo.token,
    );
    expect(screen.getByTestId('chrome-extension-install-title').textContent).toContain(
      '安装 Chrome 扩展',
    );
  });

  it('copies URL, opens the extension folder, retries, and confirms pairing reset', async () => {
    const runtime = createRuntime();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    render(<ChromeExtensionBridgeCard runtime={runtime} />);
    await waitFor(() => expect(runtime.status).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('chrome-extension-identity'));

    fireEvent.click(screen.getByRole('button', { name: '复制 WebSocket URL' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(connectionInfo.url),
    );
    fireEvent.click(screen.getByTestId('chrome-extension-open-folder'));
    await waitFor(() => expect(runtime.openFolder).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('chrome-extension-retry'));
    await waitFor(() => expect(runtime.restart).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('chrome-extension-status').textContent).toContain('已连接');

    fireEvent.click(screen.getByTestId('chrome-extension-reset'));
    expect(screen.getByText('重置 Chrome 扩展配对？')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chrome-extension-reset-confirm'));
    await waitFor(() => expect(runtime.resetPairing).toHaveBeenCalledTimes(1));
  });

  it('keeps a useful disconnected card when the bridge API is not present', async () => {
    render(<ChromeExtensionBridgeCard runtime={undefined} />);
    await waitFor(() => expect(screen.getByTestId('chrome-extension-status')).toBeTruthy());
    expect(screen.getByTestId('chrome-extension-status').textContent).toContain('未连接');
    fireEvent.click(screen.getByTestId('chrome-extension-identity'));
    fireEvent.click(screen.getByTestId('chrome-extension-retry'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '浏览器宿主尚未提供扩展桥接接口',
    );
  });
});
